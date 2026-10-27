// Server-only callsite helper. A planner or transport failure returns no event.
// This file must not import or mention stage scoring.

import type { ReservationSnapshot } from "../reservation/state.ts";
import { RESERVATION_CURRENCY, RESERVATION_FEE_CENTS } from "../reservation/constants.ts";
import { conversionBlocked, type LeadRecord } from "../verification/contracts.ts";
import { requireSecret, type TokenEnvironment } from "../verification/token.ts";
import {
  deliverRetargetingLead,
  deliverRetargetingPurchase,
  deliverRetargetingRegistration,
} from "./capi.ts";
import { retargetingConsentFromRow, type RetargetingConsent } from "./consent.ts";
import type { BrowserRetargetingEvent, MeasurementPlan } from "./events.ts";
import { planCompleteRegistration, planDurableLead, planPurchase } from "./events.ts";

export type MeasuredSignup = {
  pageId: string;
  emailVerified: boolean;
  status: string;
  suspect: boolean;
  duplicate: boolean;
  abusive: boolean;
  unsubscribed: boolean;
  measurementConsent: string | null;
  signupLocale: string | null;
  source: string | null;
  landingPath: string | null;
  fbc: string | null;
};

export type DurableMeasurementInput = {
  plan: MeasurementPlan;
  consent: RetargetingConsent;
  email: string;
  landingPath?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  ua?: string | null;
  nowSeconds?: number;
};

export function cleanPaidSnapshot(snapshot: ReservationSnapshot): boolean {
  return (
    snapshot.status === "paid" &&
    snapshot.paid === true &&
    snapshot.amountTotal === RESERVATION_FEE_CENTS &&
    (snapshot.currency ?? "").toLowerCase() === RESERVATION_CURRENCY &&
    snapshot.amountRefunded === 0 &&
    snapshot.amountRefundPending === 0
  );
}

export function measuredSignupFromRow(row: LeadRecord): MeasuredSignup {
  return {
    pageId: row.pageId,
    emailVerified: row.emailVerified === true,
    status: row.status,
    suspect: row.suspect === true,
    duplicate: row.duplicate === true,
    abusive: conversionBlocked(row.flags),
    unsubscribed: row.status === "unsubscribed",
    measurementConsent: row.measurementConsent ?? null,
    signupLocale: row.signupLocale ?? null,
    source: row.source ?? null,
    landingPath: row.landingPath ?? null,
    fbc: row.metaFbc ?? null,
  };
}

export function verificationSecretOrNull(env: TokenEnvironment | undefined): string | null {
  try {
    return requireSecret(env ?? {});
  } catch {
    return null;
  }
}

export function planMeasuredPurchase(input: {
  snapshot: ReservationSnapshot;
  signup: MeasuredSignup;
  secret: string;
  gpc: boolean;
  nowSeconds: number;
}): { plan: MeasurementPlan; consent: RetargetingConsent } {
  const consent = retargetingConsentFromRow({
    measurementConsent: input.signup.measurementConsent,
    gpc: input.gpc,
    unsubscribed: input.signup.unsubscribed,
  });
  const verifiedLead =
    input.signup.emailVerified &&
    input.signup.status === "verified" &&
    !input.signup.suspect &&
    !input.signup.duplicate &&
    !input.signup.abusive;
  const plan = planPurchase({
    evidence: "stripe_inspection",
    status: input.snapshot.status,
    paid: input.snapshot.paid,
    amountCents: input.snapshot.amountTotal,
    currency: input.snapshot.currency,
    refundedCents: input.snapshot.amountRefunded,
    refundPendingCents: input.snapshot.amountRefundPending,
    disputed: input.snapshot.status === "disputed",
    sessionId: input.snapshot.sessionId,
    secret: input.secret,
    consent,
    verifiedLead,
    suspect: input.signup.suspect,
    abusive: input.signup.abusive,
    duplicatePerson: input.signup.duplicate,
    unsubscribed: input.signup.unsubscribed,
    duplicatePaid: input.snapshot.duplicatePaid,
    signupLocale: input.signup.signupLocale,
    paidAtSeconds: input.snapshot.paidAtSeconds ?? null,
    nowSeconds: input.nowSeconds,
  });
  return { plan, consent };
}

async function deliverPlanned(input: DurableMeasurementInput): Promise<void> {
  if (!input.plan.emit || !input.plan.browser) return;
  const payload = {
    plan: input.plan,
    consent: input.consent,
    email: input.email,
    landingPath: input.landingPath,
    fbp: input.fbp,
    fbc: input.fbc,
    ip: input.ip,
    ua: input.ua,
    nowSeconds: input.nowSeconds,
  };
  if (input.plan.browser.eventName === "Lead") await deliverRetargetingLead(payload);
  else if (input.plan.browser.eventName === "CompleteRegistration") {
    await deliverRetargetingRegistration(payload);
  } else await deliverRetargetingPurchase(payload);
}

export async function deliverMeasuredPurchase(input: DurableMeasurementInput): Promise<void> {
  try {
    if (input.plan.browser?.eventName !== "Purchase") return;
    await deliverPlanned(input);
  } catch {
    // Payment acknowledgement must stand.
  }
}

export async function measureSocialSignup(input: {
  row: LeadRecord;
  rowCreated: boolean;
  verifiedNow: boolean;
  secret: string;
  gpc: boolean;
  source?: string | null;
  landingPath?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  ua?: string | null;
  nowSeconds?: number;
}): Promise<BrowserRetargetingEvent[]> {
  try {
    const signup = measuredSignupFromRow(input.row);
    const consent = retargetingConsentFromRow({
      measurementConsent: signup.measurementConsent,
      gpc: input.gpc,
      unsubscribed: signup.unsubscribed,
    });
    const events: BrowserRetargetingEvent[] = [];
    const deliver = async (plan: MeasurementPlan) => {
      if (!plan.emit || !plan.browser) return;
      events.push(plan.browser);
      await deliverPlanned({
        plan,
        consent,
        email: input.row.email,
        landingPath: input.landingPath ?? signup.landingPath,
        fbp: input.fbp,
        fbc: input.fbc ?? signup.fbc,
        ip: input.ip,
        ua: input.ua,
        nowSeconds: input.nowSeconds,
      });
    };
    if (input.rowCreated) {
      await deliver(planDurableLead({
        rowCreated: true,
        resend: false,
        duplicate: signup.duplicate,
        abusive: signup.abusive,
        suspect: signup.suspect,
        unsubscribed: signup.unsubscribed,
        pageId: signup.pageId,
        secret: input.secret,
        consent,
        source: input.source ?? signup.source,
        signupLocale: signup.signupLocale,
        occurredAtSeconds: input.nowSeconds,
        nowSeconds: input.nowSeconds,
      }));
    }
    if (input.verifiedNow) {
      await deliver(planCompleteRegistration({
        verified: true,
        source: "social_authoritative",
        pageId: signup.pageId,
        secret: input.secret,
        consent,
        duplicate: signup.duplicate,
        abusive: signup.abusive,
        suspect: signup.suspect,
        unsubscribed: signup.unsubscribed,
        signupLocale: signup.signupLocale,
        occurredAtSeconds: input.nowSeconds,
        nowSeconds: input.nowSeconds,
      }));
    }
    return events;
  } catch {
    return [];
  }
}
