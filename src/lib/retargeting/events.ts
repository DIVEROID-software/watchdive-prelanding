// Pure decisions. Nothing here talks to Meta, Google, Stripe, or Notion.
// A skipped plan has a null browser payload, so a caller cannot fire it by accident.

import type { RetargetingConsent } from "./consent.ts";
import { retargetingConsentAllows } from "./consent.ts";
import {
  expectedMeasurement,
  RETARGETING_CONTENT,
  signupLocaleOrNull,
  signupSourceOrNull,
  type RetargetingEventName,
  type SignupSource,
} from "./constants.ts";
import { retargetingEventId } from "./eventId.ts";
import { retargetingEventIsFresh, retargetingTimeReason } from "./freshness.ts";
import { isRetargetingEventId, landingPathOrNull } from "./privacy.ts";
import type { Locale } from "../i18n/locale.ts";
import { RESERVATION_CURRENCY, RESERVATION_FEE_CENTS } from "../reservation/constants.ts";

export type BrowserRetargetingEvent = {
  eventName: RetargetingEventName;
  eventId: string;
  /** Unix seconds of the original occurrence. Not the time the tag happens to run. */
  eventTime: number;
  contentName: string;
  value: number;
  currency: string;
  signupLocale: Locale | null;
  source: SignupSource | null;
  /**
   * Set only on a Purchase proof while the durable server sender is enabled.
   * The browser must not call the Meta pixel. Google and GA guards still run.
   * Absent means the legacy browser pixel may fire.
   */
  metaDelivery?: "server";
};

export type MeasurementPlan = {
  emit: boolean;
  reason: string;
  eventId: string | null;
  /** Original occurrence, in unix seconds. Null when the plan does not emit. */
  eventTime: number | null;
  browser: BrowserRetargetingEvent | null;
};

export type LeadPlanInput = {
  /** True only when this request inserted the canonical CRM row. */
  rowCreated: boolean;
  /** True for startAttempt, a second submit, or a social retry of an existing row. */
  resend: boolean;
  duplicate: boolean;
  abusive: boolean;
  suspect: boolean;
  unsubscribed: boolean;
  /** CRM page id. Stable across resends. Not the rotating attempt id. */
  pageId: string;
  /** Existing server secret. Never copied into the browser payload. */
  secret: string;
  consent: RetargetingConsent;
  source?: string | null;
  signupLocale?: string | null;
  /** When the row was created. Defaults to nowSeconds. */
  occurredAtSeconds?: number;
  /** Request clock. Defaults to the wall clock when the caller has no test clock. */
  nowSeconds?: number;
};

export type RegistrationSource =
  | "email_link"
  | "social_authoritative"
  | "deduped_retry"
  | "url"
  | "success_screen"
  | "notion_flag"
  | "poll_unverified"
  | "social_unverified";

export type RegistrationPlanInput = {
  verified: boolean;
  source: RegistrationSource;
  pageId: string;
  secret: string;
  consent: RetargetingConsent;
  duplicate: boolean;
  abusive: boolean;
  suspect: boolean;
  unsubscribed: boolean;
  signupLocale?: string | null;
  /** Original verification time. Required for deduped_retry. Defaults to nowSeconds otherwise. */
  occurredAtSeconds?: number;
  nowSeconds?: number;
};

export type PurchaseEvidence = "stripe_inspection" | "notion_paid_flag" | "success_url" | "none";

export type PurchasePlanInput = {
  evidence: PurchaseEvidence;
  status: string;
  paid: boolean;
  amountCents: number | null;
  currency: string | null;
  refundedCents: number;
  refundPendingCents: number;
  disputed: boolean;
  /** Canonical Checkout Session id. Hashed into the event id. Never sent raw. */
  sessionId: string | null;
  secret: string;
  consent: RetargetingConsent;
  verifiedLead: boolean;
  suspect: boolean;
  abusive: boolean;
  duplicatePerson: boolean;
  unsubscribed: boolean;
  /** Two clean fees still count as one purchase on the canonical session. */
  duplicatePaid?: boolean;
  signupLocale?: string | null;
  /** Charge.created seconds. Not Checkout Session.created and not webhook delivery time. */
  paidAtSeconds: number | null;
  /** Request clock. A replay uses the same paidAtSeconds, so event_time does not move. */
  nowSeconds: number;
};

const TRUE_REGISTRATION = new Set<RegistrationSource>([
  "email_link",
  "social_authoritative",
  "deduped_retry",
]);

function refuse(reason: string): MeasurementPlan {
  return { emit: false, reason, eventId: null, eventTime: null, browser: null };
}

function browserEvent(
  name: RetargetingEventName,
  eventId: string,
  eventTime: number,
  signupLocale: string | null | undefined,
  source: string | null | undefined,
): BrowserRetargetingEvent | null {
  if (!isRetargetingEventId(eventId) || !Number.isInteger(eventTime)) return null;
  const measurement = expectedMeasurement(name);
  return {
    eventName: name,
    eventId,
    eventTime,
    contentName: RETARGETING_CONTENT[name],
    value: measurement.value,
    currency: measurement.currency,
    signupLocale: signupLocaleOrNull(signupLocale),
    source: signupSourceOrNull(source),
  };
}

function resolveOccurrence(input: {
  occurredAtSeconds?: number;
  nowSeconds?: number;
  requireOriginal: boolean;
}): { eventTime: number } | { reason: string } {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (input.requireOriginal && input.occurredAtSeconds == null) return { reason: "occurred_at" };
  const eventTime = input.occurredAtSeconds ?? nowSeconds;
  const timing = retargetingTimeReason(eventTime, nowSeconds);
  if (timing === "ok" && retargetingEventIsFresh(eventTime, nowSeconds)) return { eventTime };
  if (timing === "future") return { reason: "future" };
  if (timing === "missing") return { reason: "occurred_at" };
  return { reason: "stale" };
}

function blockedPerson(input: {
  duplicate?: boolean;
  abusive?: boolean;
  suspect?: boolean;
  unsubscribed?: boolean;
  consent: RetargetingConsent;
}): string | null {
  if (input.abusive) return "abuse";
  if (input.suspect) return "suspect";
  if (input.duplicate) return "duplicate";
  if (input.unsubscribed) return "unsubscribed";
  if (!retargetingConsentAllows(input.consent)) return "consent";
  return null;
}

/** Lead only for the request that created the canonical signup row. */
export function planDurableLead(input: LeadPlanInput): MeasurementPlan {
  if (input.rowCreated && input.resend) return refuse("conflict");
  if (!input.rowCreated) return refuse(input.resend ? "resend" : "not_durable");
  if (input.resend) return refuse("resend");
  const blocked = blockedPerson(input);
  if (blocked) return refuse(blocked);
  const timing = resolveOccurrence({
    occurredAtSeconds: input.occurredAtSeconds,
    nowSeconds: input.nowSeconds,
    requireOriginal: false,
  });
  if (!("eventTime" in timing)) return refuse(timing.reason);
  const eventId = retargetingEventId("lead", input.pageId, input.secret);
  if (!eventId) return refuse("event_id");
  const browser = browserEvent("Lead", eventId, timing.eventTime, input.signupLocale, input.source);
  if (!browser) return refuse("event_id");
  return { emit: true, reason: "durable_signup", eventId, eventTime: timing.eventTime, browser };
}

/**
 * CompleteRegistration only for a true verification.
 * email_link and social_authoritative are the first send.
 * deduped_retry repeats that same id only when the caller still has the original time
 * and that time is inside 48 hours. A later login is not a deduped_retry.
 * A URL, a success screen, a Notion checkbox, or an unverified social claim never qualifies.
 */
export function planCompleteRegistration(input: RegistrationPlanInput): MeasurementPlan {
  if (!input.verified || !TRUE_REGISTRATION.has(input.source)) return refuse("not_true_verified");
  const blocked = blockedPerson(input);
  if (blocked) return refuse(blocked);
  const timing = resolveOccurrence({
    occurredAtSeconds: input.occurredAtSeconds,
    nowSeconds: input.nowSeconds,
    requireOriginal: input.source === "deduped_retry",
  });
  if (!("eventTime" in timing)) return refuse(timing.reason);
  const eventId = retargetingEventId("registration", input.pageId, input.secret);
  if (!eventId) return refuse("event_id");
  const browser = browserEvent("CompleteRegistration", eventId, timing.eventTime, input.signupLocale, null);
  if (!browser) return refuse("event_id");
  return {
    emit: true,
    reason: input.source === "deduped_retry" ? "deduped_retry" : "true_verified",
    eventId,
    eventTime: timing.eventTime,
    browser,
  };
}

/** Purchase only for a Stripe-inspected clean USD 3 reservation fee. */
export function planPurchase(input: PurchasePlanInput): MeasurementPlan {
  if (input.evidence !== "stripe_inspection") return refuse(input.evidence);
  if (!input.verifiedLead) return refuse("unverified_lead");
  const blocked = blockedPerson({ ...input, duplicate: input.duplicatePerson });
  if (blocked) return refuse(blocked);
  if (input.disputed || input.status === "disputed") return refuse("disputed");
  if (input.refundPendingCents > 0 || input.status === "refund_pending") return refuse("refund_pending");
  if (input.refundedCents > 0 || input.status === "refunded" || input.status === "partially_refunded") {
    return refuse("refunded");
  }
  if (input.status !== "paid" || input.paid !== true) return refuse("unpaid");
  if (
    input.amountCents !== RESERVATION_FEE_CENTS ||
    (input.currency ?? "").toLowerCase() !== RESERVATION_CURRENCY
  ) {
    return refuse("amount");
  }
  if (!input.sessionId) return refuse("session");
  const timing = retargetingTimeReason(input.paidAtSeconds, input.nowSeconds);
  if (timing === "missing") return refuse("paid_at");
  if (timing !== "ok" || input.paidAtSeconds == null) return refuse(timing === "future" ? "future" : "stale");
  const eventId = retargetingEventId("purchase", input.sessionId, input.secret);
  if (!eventId) return refuse("event_id");
  const browser = browserEvent("Purchase", eventId, input.paidAtSeconds, input.signupLocale, null);
  if (!browser) return refuse("event_id");
  return { emit: true, reason: "stripe_usd3", eventId, eventTime: input.paidAtSeconds, browser };
}

export function safeLandingPath(path: string | undefined | null): string | null {
  return landingPathOrNull(path);
}
