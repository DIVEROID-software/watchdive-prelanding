// Prospective retargeting measurement. Historical GA4 form_start / sign_up and
// the 2026-09-26 submit Lead stay on their existing functions.

import { SUPPORTED_LOCALES, type Locale } from "../i18n/locale.ts";
import { META_LEAD_CURRENCY, META_LEAD_VALUE } from "../metaLeadValue.ts";
import { RESERVATION_CURRENCY, RESERVATION_FEE_CENTS } from "../reservation/constants.ts";

export const RETARGETING_PHASE = "retargeting-events-20261026";

export const RETARGETING_EVENTS = ["Lead", "CompleteRegistration", "Purchase"] as const;
export type RetargetingEventName = (typeof RETARGETING_EVENTS)[number];

export const RETARGETING_CONTENT = {
  Lead: "watchdive_durable_signup",
  CompleteRegistration: "watchdive_verified_registration",
  Purchase: "watchdive_reservation_fee",
} as const satisfies Record<RetargetingEventName, string>;

/** Non-revenue signal shared with the historical Lead. Not the reservation fee. */
export const REGISTRATION_VALUE = META_LEAD_VALUE;
export const REGISTRATION_CURRENCY = META_LEAD_CURRENCY;

/** Stripe reservation fee. 300 cents is USD 3, not a percentage and not $149. */
export const PURCHASE_VALUE = RESERVATION_FEE_CENTS / 100;
export const PURCHASE_CURRENCY = RESERVATION_CURRENCY.toUpperCase();

export const SIGNUP_SOURCES = ["hero", "offer", "email", "google", "apple"] as const;
export type SignupSource = (typeof SIGNUP_SOURCES)[number];

export function expectedMeasurement(name: RetargetingEventName): { value: number; currency: string } {
  if (name === "Purchase") return { value: PURCHASE_VALUE, currency: PURCHASE_CURRENCY };
  return { value: REGISTRATION_VALUE, currency: REGISTRATION_CURRENCY };
}

export function isRetargetingEventName(value: string): value is RetargetingEventName {
  return (RETARGETING_EVENTS as readonly string[]).includes(value);
}

export function signupLocaleOrNull(value: string | undefined | null): Locale | null {
  if (!value) return null;
  return (SUPPORTED_LOCALES as readonly string[]).includes(value) ? (value as Locale) : null;
}

export function signupSourceOrNull(value: string | undefined | null): SignupSource | null {
  if (!value) return null;
  return (SIGNUP_SOURCES as readonly string[]).includes(value) ? (value as SignupSource) : null;
}
