// Server leg of the prospective retargeting events. Refuses a plan that did not emit.
// Does not replace deliverMetaLead, sendMetaEmailVerified, or the CRM LeadVerified event.

import { deliverRetargetingStandardEvent } from "../api/metaCapi.ts";
import { retargetingConsentAllows, type RetargetingConsent } from "./consent.ts";
import type { RetargetingEventName } from "./constants.ts";
import type { MeasurementPlan } from "./events.ts";
import { retargetingEventIsFresh } from "./freshness.ts";
import { cookieIdOrNull, landingPathOrNull } from "./privacy.ts";

export type RetargetingDelivery = {
  delivery: "sent" | "disabled" | "error" | "refused";
  reason: string;
};

export type RetargetingDeliveryInput = {
  plan: MeasurementPlan;
  /** Passed again so a hand-built plan cannot skip the opt-out gate. */
  consent: RetargetingConsent;
  email: string;
  landingPath?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  ua?: string | null;
  /** Request clock. Purchase replays pass the handler clock, not a new timestamp. */
  nowSeconds?: number;
};

async function deliver(
  expected: RetargetingEventName,
  input: RetargetingDeliveryInput,
): Promise<RetargetingDelivery> {
  if (!retargetingConsentAllows(input.consent)) {
    return { delivery: "refused", reason: "consent" };
  }
  if (!input.plan.emit || !input.plan.browser || !input.plan.eventId) {
    return { delivery: "refused", reason: input.plan.reason };
  }
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!retargetingEventIsFresh(input.plan.eventTime, nowSeconds)) {
    return { delivery: "refused", reason: "stale" };
  }
  const browser = input.plan.browser;
  if (browser.eventName !== expected) {
    return { delivery: "refused", reason: "event_name" };
  }
  const delivery = await deliverRetargetingStandardEvent({
    eventName: browser.eventName,
    eventId: input.plan.eventId,
    eventTime: input.plan.eventTime ?? undefined,
    email: input.email,
    consentGranted: true,
    contentName: browser.contentName,
    value: browser.value,
    currency: browser.currency,
    ...(browser.source ? { source: browser.source } : {}),
    ...(browser.signupLocale ? { signupLocale: browser.signupLocale } : {}),
    ...(landingPathOrNull(input.landingPath) ? { landingPath: landingPathOrNull(input.landingPath)! } : {}),
    ...(cookieIdOrNull(input.fbp) ? { fbp: cookieIdOrNull(input.fbp)! } : {}),
    ...(cookieIdOrNull(input.fbc) ? { fbc: cookieIdOrNull(input.fbc)! } : {}),
    ...(input.ip ? { ip: input.ip } : {}),
    ...(input.ua ? { ua: input.ua } : {}),
  });
  return {
    delivery,
    reason: delivery === "sent" ? input.plan.reason : delivery === "error" ? "transport" : "disabled",
  };
}

export function deliverRetargetingLead(input: RetargetingDeliveryInput): Promise<RetargetingDelivery> {
  return deliver("Lead", input);
}

export function deliverRetargetingRegistration(
  input: RetargetingDeliveryInput,
): Promise<RetargetingDelivery> {
  return deliver("CompleteRegistration", input);
}

export function deliverRetargetingPurchase(
  input: RetargetingDeliveryInput,
): Promise<RetargetingDelivery> {
  return deliver("Purchase", input);
}
