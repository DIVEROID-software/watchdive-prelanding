import { createHash } from "node:crypto";

import { canonicalEmail, isDisposableEmail } from "../../api/abuse.ts";

import type { AllowlistForm, AdSegment } from "./allowlist.ts";
import {
  EMAIL_CONSENT_KEY,
  EMAIL_CONSENT_VERSION,
  META_ID,
  SMS_CONSENT_VERSION,
  WEBSITE_CAMPAIGN_IDS,
  type Market,
  type SignupLocale,
} from "./constants.ts";

const E164 = /^\+[1-9]\d{7,14}$/;
const KEY = /^[a-f0-9]{64}$/;

/**
 * The body the ingester posts. Field names match ConfirmationIntent in
 * integration/candidate/src/decide.ts. confirmation_consent is not a separate
 * boolean there: the checkbox key and version are the consent.
 */
export type NativeIntent = {
  canonical_email: string;
  submitted_email: string;
  locale: SignupLocale;
  market: Market;
  leadgen_id: string;
  form_id: string;
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  segment: AdSegment;
  observed_campaign_id: string;
  utm_campaign: string;
  landing_path: string;
  resend: boolean;
  phone_present: boolean;
  phone_e164: string | null;
  phone_unparsed: boolean;
  sms_consent_claimed: boolean;
  sms_consent_version: typeof SMS_CONSENT_VERSION | null;
  email_consent_key: typeof EMAIL_CONSENT_KEY;
  email_consent_version: typeof EMAIL_CONSENT_VERSION;
  email_key: string;
  idempotency_key: string;
  form: AllowlistForm;
};

export type IntentError =
  | "bad_body"
  | "missing_consent"
  | "not_allowlisted"
  | "before_cutoff"
  | "disposable"
  | "phone_hold_unwired";

export type ParsedIntent =
  | { ok: true; intent: NativeIntent }
  | { ok: false; error: IntentError; idempotency_key: string };

export function emailKey(canonical: string): string {
  return createHash("sha256").update(`watchdive-instant-email\0${canonical}`).digest("hex");
}

export function confirmationIdempotencyKey(canonical: string): string {
  return `watchdive-instant-form-${emailKey(canonical)}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function plausible(email: string): boolean {
  if (email.length < 3 || email.length > 320 || /\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return false;
  return email.slice(at + 1).includes(".");
}

export function parseNativeIntent(
  raw: string,
  forms: readonly AllowlistForm[],
  cutoff: number | null,
  nowMs: number,
): ParsedIntent {
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "bad_body", idempotency_key: "" };
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, error: "bad_body", idempotency_key: "" };
  }

  const fail = (error: IntentError, idempotencyKey = ""): ParsedIntent => ({
    ok: false,
    error,
    idempotency_key: idempotencyKey,
  });

  const submitted = text(body.submitted_email).toLowerCase();
  const canonical = text(body.canonical_email);
  if (!plausible(submitted) || canonicalEmail(submitted) !== canonical) return fail("bad_body");
  const expectedKey = confirmationIdempotencyKey(canonical);
  const presentedKey = text(body.idempotency_key);
  const presentedHash = text(body.email_key);
  if (presentedKey !== expectedKey || presentedHash !== emailKey(canonical) || !KEY.test(presentedHash)) {
    return fail("bad_body");
  }
  if (isDisposableEmail(canonical)) return fail("disposable", expectedKey);
  if (
    body.email_consent_key !== EMAIL_CONSENT_KEY ||
    body.email_consent_version !== EMAIL_CONSENT_VERSION ||
    body.confirmation_consent === false
  ) {
    return fail("missing_consent", expectedKey);
  }
  if (
    body.measurement_consent !== false ||
    body.email_verified !== false ||
    body.custom_conversion_emit !== false ||
    body.stage_score_emit !== false ||
    body.sms_send !== false ||
    body.verified_count_delta !== 0 ||
    body.paid_attribution !== true ||
    body.source !== "meta_instant_form" ||
    body.notion_source_select !== "instant-form" ||
    body.acquisition_path !== "instant_form" ||
    body.utm_source !== "meta" ||
    body.utm_medium !== "paid_social"
  ) {
    return fail("not_allowlisted", expectedKey);
  }

  const form = forms.find((item) => item.form_id === text(body.form_id));
  if (!form || form.test) return fail("not_allowlisted", expectedKey);
  if (text(body.market) !== form.market || text(body.locale) !== form.locale) {
    return fail("not_allowlisted", expectedKey);
  }
  if (text(body.utm_campaign) !== form.utm_campaign || text(body.landing_path) !== form.landing_path) {
    return fail("not_allowlisted", expectedKey);
  }
  const ad = form.ads.find((item) => item.ad_id === text(body.ad_id));
  if (!ad) return fail("not_allowlisted", expectedKey);
  const leadgen = text(body.leadgen_id);
  if (!META_ID.test(leadgen) || leadgen === ad.ad_id || text(body.form_id) !== form.form_id) {
    return fail("not_allowlisted", expectedKey);
  }
  if (text(body.adset_id) !== ad.adset_id || text(body.campaign_id) !== ad.campaign_id) {
    return fail("not_allowlisted", expectedKey);
  }
  if (text(body.observed_campaign_id) !== ad.campaign_id || text(body.segment) !== ad.segment) {
    return fail("not_allowlisted", expectedKey);
  }
  if (ad.campaign_id !== form.campaign_id || ad.adset_id !== form.adset_id) {
    return fail("not_allowlisted", expectedKey);
  }
  const website = WEBSITE_CAMPAIGN_IDS as readonly string[];
  if (website.includes(ad.campaign_id)) return fail("not_allowlisted", expectedKey);

  if (typeof body.submitted_at === "string" && body.submitted_at.trim()) {
    const submittedAtMs = Date.parse(body.submitted_at);
    if (!Number.isFinite(submittedAtMs)) return fail("before_cutoff", expectedKey);
    if (cutoff == null || submittedAtMs < cutoff || submittedAtMs > nowMs + 5 * 60 * 1000) {
      return fail("before_cutoff", expectedKey);
    }
  }

  if (typeof body.resend !== "boolean" || typeof body.sms_consent_claimed !== "boolean") {
    return fail("bad_body", expectedKey);
  }
  if (typeof body.phone_present !== "boolean" || typeof body.phone_unparsed !== "boolean") {
    return fail("bad_body", expectedKey);
  }
  const phone = body.phone_e164 == null || body.phone_e164 === "" ? null : text(body.phone_e164);
  if (phone != null && !E164.test(phone)) return fail("bad_body", expectedKey);
  if (body.phone_present === true && phone == null && body.phone_unparsed !== true) return fail("bad_body", expectedKey);
  if (body.phone_present === true && phone != null && body.phone_unparsed !== false) return fail("bad_body", expectedKey);
  if (body.phone_present === false && (phone != null || body.phone_unparsed !== false)) return fail("bad_body", expectedKey);

  const sms = body.sms_consent_claimed === true;
  if (sms && body.sms_consent_version !== SMS_CONSENT_VERSION) return fail("missing_consent", expectedKey);
  if (!sms && body.sms_consent_version !== null) return fail("bad_body", expectedKey);
  // An unparsed number is not E.164 evidence. Email can continue. The number
  // stays out of Notion and out of the phone hold.

  return {
    ok: true,
    intent: {
      canonical_email: canonical,
      submitted_email: submitted,
      locale: form.locale,
      market: form.market,
      leadgen_id: leadgen,
      form_id: form.form_id,
      ad_id: ad.ad_id,
      adset_id: ad.adset_id,
      campaign_id: ad.campaign_id,
      segment: ad.segment,
      observed_campaign_id: ad.campaign_id,
      utm_campaign: form.utm_campaign,
      landing_path: form.landing_path,
      resend: body.resend,
      phone_present: body.phone_present,
      phone_e164: sms ? phone : null,
      phone_unparsed: body.phone_unparsed,
      sms_consent_claimed: sms,
      sms_consent_version: sms ? SMS_CONSENT_VERSION : null,
      email_consent_key: EMAIL_CONSENT_KEY,
      email_consent_version: EMAIL_CONSENT_VERSION,
      email_key: presentedHash,
      idempotency_key: expectedKey,
      form,
    },
  };
}
