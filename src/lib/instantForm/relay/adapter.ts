import { canonicalEmail } from "../../api/abuse.ts";
import { rowOptedOut } from "../../referral/notices.ts";
import type { LeadRecord, LeadStore, PendingResponse } from "../../verification/contracts.ts";
import {
  MEASUREMENT_CONSENT_WITHHELD,
  VERIFICATION_MAX_SENDS,
  VERIFICATION_RESEND_COOLDOWN_MS,
  VERIFICATION_TTL_MS,
} from "../../verification/contracts.ts";
import type { RequestVerificationInput, ServiceDependencies } from "../../verification/service.ts";
import type { VerificationMailer } from "../../verification/resend.ts";
import { isLeadId, parseVerificationToken } from "../../verification/token.ts";

import { nativeAttributionProperties, NativeSchemaError, type NativeAttribution } from "./attribution.ts";
import { authenticateConfirmation, type NonceStore } from "./auth.ts";
import { SIGNATURE_HEADER } from "./constants.ts";
import { EMAIL_VERIFIED_CUSTOM_CONVERSION_ID, STAGE_SCORE_WEIGHTS } from "./constants.ts";
import { confirmationGate, cutoffMs, type GateEnv } from "./gate.ts";
import { parseNativeIntent, type NativeIntent } from "./intent.ts";
import type { ConfirmationLedger, LedgerEntry } from "./ledger.ts";
import { reminderExclusionInstalled } from "./reminderExclusion.ts";

export type VerificationRequester = (
  input: RequestVerificationInput,
  dependencies: ServiceDependencies,
) => Promise<PendingResponse>;

export type PhoneHold = {
  leadgen_id: string;
  phone_e164: string;
  sms_consent: true;
  market: NativeIntent["market"];
  held_at: string;
};

export type ConfirmationDeps = {
  env: GateEnv;
  now: () => Date;
  allowlist: Parameters<typeof confirmationGate>[1];
  store: LeadStore;
  mailer: VerificationMailer;
  requestVerification: VerificationRequester;
  writeAttribution: (pageId: string, properties: Record<string, unknown>) => Promise<void>;
  reminderSkipReason: (record: LeadRecord, nowMs: number) => string | undefined;
  ledger: ConfirmationLedger;
  nonces: NonceStore;
  phoneHold?: (hold: PhoneHold) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

export type PortOutcome = "accepted" | "known_not_sent" | "unknown";

/**
 * `mail_provider_sends` is this call's observation: 1 only after one accepted
 * verification send, otherwise 0. The ingester keeps its own
 * confirmation_mail_sent at 0. `outcome` `accepted` with 0 means this call
 * finished and sent nothing. `known_not_sent` may be retried. `unknown` is not.
 */
export type ConfirmationResult = {
  http: number;
  ok: boolean;
  error?: string;
  result: string;
  outcome: PortOutcome;
  mail_provider_sends: 0 | 1;
  idempotency_key: string;
  mail_sent: false | true;
  custom_conversion_emit: false;
  custom_conversion_id: typeof EMAIL_VERIFIED_CUSTOM_CONVERSION_ID;
  email_verified: false;
  sms_sent: false;
  stage_score_emit: false;
  stage_score_weights_are_revenue: false;
  phone_held: boolean;
  side_effects: boolean;
};

const locks = new Map<string, Promise<void>>();

function locked<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(run);
  locks.set(
    key,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
}

export function configurationClosed(result = "not_configured", http = 404): ConfirmationResult {
  return closed(result, http, "");
}

function classify(result: string, mailSent: boolean): { outcome: PortOutcome; sends: 0 | 1 } {
  if (result === "confirmation_requested" && mailSent) return { outcome: "accepted", sends: 1 };
  if (result === "duplicate" || result === "suppressed" || result === "website_row_untouched") {
    return { outcome: "accepted", sends: 0 };
  }
  if (
    result === "lookup_failed" ||
    result === "not_configured" ||
    result === "phone_hold_failed" ||
    result === "phone_hold_unwired"
  ) {
    return { outcome: "known_not_sent", sends: 0 };
  }
  if (
    result === "not_allowlisted" ||
    result === "before_cutoff" ||
    result === "disposable" ||
    result === "missing_consent" ||
    result === "bad_body" ||
    result === "resend_without_row" ||
    result === "armed" ||
    result === "unknown_outcome" ||
    result === "mail_failed" ||
    result === "schema_blocked" ||
    result === "unexpected_conversion" ||
    result === "token_rejected" ||
    result === "unauthorized" ||
    result === "stale" ||
    result === "replayed"
  ) {
    return { outcome: "unknown", sends: 0 };
  }
  return { outcome: "accepted", sends: 0 };
}

function closed(result: string, http: number, idempotencyKey: string): ConfirmationResult {
  const mapped = classify(result, false);
  return {
    http,
    ok: false,
    error: result,
    result,
    outcome: idempotencyKey ? mapped.outcome : "unknown",
    mail_provider_sends: 0,
    idempotency_key: idempotencyKey,
    mail_sent: false,
    custom_conversion_emit: false,
    custom_conversion_id: EMAIL_VERIFIED_CUSTOM_CONVERSION_ID,
    email_verified: false,
    sms_sent: false,
    stage_score_emit: false,
    stage_score_weights_are_revenue: false,
    phone_held: false,
    side_effects: false,
  };
}

function done(
  result: string,
  http: number,
  idempotencyKey: string,
  outcome: PortOutcome,
  sends: 0 | 1,
  extra: { mail_sent?: true; phone_held?: true; side_effects?: true } = {},
): ConfirmationResult {
  return {
    ...closed(result, http, idempotencyKey),
    ok: outcome === "accepted",
    error: outcome === "accepted" ? undefined : result,
    outcome,
    mail_provider_sends: sends,
    mail_sent: extra.mail_sent ?? false,
    phone_held: extra.phone_held ?? false,
    side_effects: extra.side_effects ?? extra.mail_sent ?? false,
  };
}

function replay(prior: LedgerEntry): ConfirmationResult {
  if (prior.result === "confirmation_requested") {
    return done("duplicate", 200, prior.idempotency_key, "accepted", 0);
  }
  const name = prior.result === "armed" ? "unknown_outcome" : prior.result;
  const mapped = classify(name, false);
  return done(name, 200, prior.idempotency_key, mapped.outcome, 0);
}

function cooled(record: LeadRecord, nowMs: number): boolean {
  const sentAt = record.sentAt ? Date.parse(record.sentAt) : Number.NaN;
  if (Number.isFinite(sentAt)) return nowMs - sentAt >= VERIFICATION_RESEND_COOLDOWN_MS;
  const expiresAt = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAt)) {
    return nowMs - (expiresAt - VERIFICATION_TTL_MS) >= VERIFICATION_RESEND_COOLDOWN_MS;
  }
  return true;
}

function optedOut(record: LeadRecord): boolean {
  return rowOptedOut({
    status: String(record.status),
    launchMail: record.launchMail,
    reservationMail: record.reservationMail,
  });
}

function entry(intent: NativeIntent, result: string, at: string, mail: false | true): LedgerEntry {
  return {
    leadgen_id: intent.leadgen_id,
    idempotency_key: intent.idempotency_key,
    result,
    terminal: true,
    mail_sent: mail,
    at,
  };
}

function schemaError(error: unknown): boolean {
  if (error instanceof NativeSchemaError) return true;
  const message = error instanceof Error ? error.message : "";
  return message.includes("validation_error") || message.includes("native_schema_missing");
}

export async function confirmNativeIntent(
  rawBody: string,
  signature: string | null,
  deps: ConfirmationDeps,
): Promise<ConfirmationResult> {
  if (rawBody.length > 8192) return closed("bad_body", 400, "");
  const nowMs = deps.now().getTime();
  const auth = authenticateConfirmation(
    signature,
    rawBody,
    (deps.env.INSTANT_FORM_CONFIRMATION_SECRET ?? "").trim(),
    nowMs,
    deps.nonces,
  );
  if (!auth.ok) return closed(auth.error, 401, "");
  const cutoff = cutoffMs(deps.env);
  const parsed = parseNativeIntent(rawBody, deps.allowlist, cutoff, nowMs);
  if (!parsed.ok) return closed(parsed.error, 200, parsed.idempotency_key);
  const reasons = confirmationGate(deps.env, deps.allowlist);
  if (reasons.length > 0 || !deps.ledger || !deps.nonces) {
    return closed("not_configured", 200, parsed.intent.idempotency_key);
  }
  if (!reminderExclusionInstalled(deps.reminderSkipReason)) {
    return closed("not_configured", 200, parsed.intent.idempotency_key);
  }
  return locked(parsed.intent.idempotency_key, () => confirmParsed(parsed.intent, deps, nowMs));
}

async function confirmParsed(
  intent: NativeIntent,
  deps: ConfirmationDeps,
  nowMs: number,
): Promise<ConfirmationResult> {
  const prior = deps.ledger.get(intent.leadgen_id);
  if (prior?.terminal) return replay(prior);
  let existing: LeadRecord | undefined;
  let peers: LeadRecord[];
  try {
    existing = await deps.store.findByEmail(intent.canonical_email, intent.submitted_email);
    if (!deps.store.listByAddress) return finish(intent, "lookup_failed");
    peers = await deps.store.listByAddress(intent.canonical_email, intent.submitted_email);
  } catch {
    return finish(intent, "lookup_failed");
  }
  if (peers.some((row) => optedOut(row) || String(row.status) === "legacy")) {
    return remember(deps, intent, "suppressed");
  }
  if (
    existing &&
    (existing.emailVerified ||
      existing.status === "verified" ||
      existing.status === "legacy" ||
      String(existing.status) === "suppressed")
  ) {
    return remember(deps, intent, "suppressed");
  }
  if (existing && existing.source !== "instant-form") {
    return remember(deps, intent, "website_row_untouched");
  }
  if (existing?.source === "instant-form") {
    if (!intent.resend || !cooled(existing, nowMs) || existing.sends >= VERIFICATION_MAX_SENDS) {
      return remember(deps, intent, "duplicate");
    }
  } else if (intent.resend) {
    return remember(deps, intent, "resend_without_row");
  }
  if (intent.sms_consent_claimed && intent.phone_e164) {
    if (!deps.phoneHold) return finish(intent, "phone_hold_unwired");
    try {
      await deps.phoneHold({
        leadgen_id: intent.leadgen_id,
        phone_e164: intent.phone_e164,
        sms_consent: true,
        market: intent.market,
        held_at: deps.now().toISOString(),
      });
    } catch {
      return finish(intent, "phone_hold_failed");
    }
  }
  const at = deps.now().toISOString();
  if (!deps.ledger.claim(intent.idempotency_key, intent.leadgen_id)) {
    return finish(intent, "unknown_outcome");
  }
  deps.ledger.commit(entry(intent, "armed", at, false));
  const conversions: string[] = [];
  const mail = { calls: 0, failed: false, token: "", leadId: "", idempotencyKey: "" };
  const wrapped: VerificationMailer = {
    async send(input) {
      if (input.locale !== intent.locale || !isLeadId(input.leadId) || input.leadId === intent.leadgen_id) {
        mail.failed = true;
        throw new Error("native_mail_rejected");
      }
      try {
        const mailed = { ...input, idempotencyKey: intent.idempotency_key };
        await deps.mailer.send(mailed);
      } catch {
        mail.failed = true;
        throw new Error("mail_failed");
      }
      mail.calls += 1;
      mail.token = input.token;
      mail.leadId = input.leadId;
      mail.idempotencyKey = intent.idempotency_key;
    },
    async sendWelcome() {
      mail.failed = true;
      throw new Error("native_submit_does_not_send_welcome");
    },
  };
  const secret = (deps.env.WATCHDIVE_VERIFICATION_SECRET ?? "").trim();
  try {
    await deps.requestVerification(serviceInput(intent), {
      store: proxiedStore(deps, intent),
      mailer: wrapped,
      env: {
        WATCHDIVE_VERIFICATION_SECRET: secret,
        WATCHDIVE_PUBLIC_ORIGIN: deps.env.WATCHDIVE_PUBLIC_ORIGIN,
      },
      now: deps.now,
      sleep: deps.sleep ?? (async () => undefined),
      compatibilityEnabled: false,
      dispatchVerifiedLead: async () => {
        conversions.push("verified");
        return false;
      },
      dispatchSubmitLead: async () => {
        conversions.push("submit");
        return false;
      },
      dispatchGoogleVerified: async () => {
        conversions.push("google");
      },
      dispatchDurableMeasurement: async () => {
        conversions.push("durable");
      },
    });
  } catch (error) {
    if (schemaError(error)) return remember(deps, intent, "schema_blocked", true);
    return remember(deps, intent, "mail_failed", true);
  }
  if (conversions.length > 0) return remember(deps, intent, "unexpected_conversion", true);
  if (mail.failed || mail.calls !== 1) return remember(deps, intent, "mail_failed", true);
  const parsed = parseVerificationToken(mail.token, secret, deps.now().getTime());
  if (!parsed || parsed.measurementConsent || parsed.locale !== intent.locale || parsed.leadId !== mail.leadId) {
    return remember(deps, intent, "token_rejected", true);
  }
  if (parsed.leadId === intent.leadgen_id || !isLeadId(parsed.leadId)) {
    return remember(deps, intent, "token_rejected", true);
  }
  if (mail.idempotencyKey !== intent.idempotency_key) return remember(deps, intent, "token_rejected", true);
  if (canonicalEmail(intent.submitted_email) !== intent.canonical_email) {
    return remember(deps, intent, "mail_failed", true);
  }
  deps.ledger.commit(entry(intent, "confirmation_requested", deps.now().toISOString(), true));
  return done("confirmation_requested", 200, intent.idempotency_key, "accepted", 1, {
    mail_sent: true,
    side_effects: true,
    ...(intent.sms_consent_claimed && intent.phone_e164 ? { phone_held: true as const } : {}),
  });
}

function finish(intent: NativeIntent, result: string): ConfirmationResult {
  const mapped = classify(result, false);
  return done(result, 200, intent.idempotency_key, mapped.outcome, mapped.sends);
}

function remember(
  deps: ConfirmationDeps,
  intent: NativeIntent,
  result: string,
  sideEffects = false,
): ConfirmationResult {
  deps.ledger.commit(entry(intent, result, deps.now().toISOString(), false));
  const mapped = classify(result, false);
  return done(result, 200, intent.idempotency_key, mapped.outcome, mapped.sends, sideEffects ? { side_effects: true } : {});
}

function serviceInput(intent: NativeIntent): RequestVerificationInput {
  return {
    email: intent.submitted_email,
    canonical: intent.canonical_email,
    source: "instant-form",
    flags: [],
    suspect: false,
    measurementConsent: false,
    networkSendBlocked: false,
    locale: intent.locale,
    signupLocale: intent.locale,
    signupMethod: "email",
    attribution: {
      utmSource: "meta",
      utmMedium: "paid_social",
      utmCampaign: intent.utm_campaign,
      landingPath: intent.landing_path,
    },
    nativeConfirmationKey: intent.idempotency_key,
  };
}

function proxiedStore(deps: ConfirmationDeps, intent: NativeIntent): LeadStore {
  const attribution: NativeAttribution = {
    adId: intent.ad_id,
    adsetId: intent.adset_id,
    campaignId: intent.campaign_id,
    leadgenId: intent.leadgen_id,
  };
  // A class instance's methods live on the prototype. Spreading it would drop
  // findByEmail and the service would throw before any guarded write.
  return new Proxy(deps.store, {
    get(target, prop, receiver) {
      if (prop === "createPending") {
        return async (input: Parameters<LeadStore["createPending"]>[0]) => {
          if (input.source !== "instant-form" || input.phone || input.measurementState !== MEASUREMENT_CONSENT_WITHHELD) {
            throw new NativeSchemaError();
          }
          if (input.signupLocale !== intent.locale) throw new NativeSchemaError();
          if (!isLeadId(input.leadId) || input.leadId === intent.leadgen_id) throw new NativeSchemaError();
          const record = await target.createPending({
            ...input,
            nativeCrm: {
              leadgenId: intent.leadgen_id,
              adId: intent.ad_id,
              adsetId: intent.adset_id,
              campaignId: intent.campaign_id,
            },
          });
          if (record.emailVerified || record.status === "verified" || record.leadId === intent.leadgen_id) {
            throw new NativeSchemaError();
          }
          if (record.signupLocale !== intent.locale) throw new NativeSchemaError();
          await deps.writeAttribution(record.pageId, nativeAttributionProperties(attribution));
          return { ...record, source: "instant-form" };
        };
      }
      if (prop === "startAttempt") {
        return async (pageId: string, input: Parameters<LeadStore["startAttempt"]>[1]) => {
          if (!intent.resend || !isLeadId(input.leadId) || input.leadId === intent.leadgen_id) {
            throw new NativeSchemaError();
          }
          await deps.writeAttribution(pageId, nativeAttributionProperties(attribution));
          await target.startAttempt(pageId, input);
        };
      }
      if (prop === "recordPhoneOptIn") {
        return async () => {
          throw new NativeSchemaError();
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function signatureHeader(): string {
  return SIGNATURE_HEADER;
}

export { STAGE_SCORE_WEIGHTS };
