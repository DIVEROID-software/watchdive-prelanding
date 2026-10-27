import type { LeadStore } from "./contracts.ts";
import { MIN_RESPONSE_MS, POLL_HANDLE_TTL_MS } from "./contracts.ts";
import {
  parseVerificationToken,
  verifyPollHandle,
  requireSecret,
  type TokenEnvironment,
} from "./token.ts";
import { normalizePhone } from "../phoneNumbers.ts";
import { PHONE_CONSENT_VERSION } from "../phoneOptInCopy.ts";
import { noteStagePhoneSaved } from "../stageScore/observe.ts";
import { SUPPORTED_LOCALES, type Locale } from "../i18n/locale.ts";

export type PhoneCredential = { kind: "attempt" | "confirmation"; value: string };
export type PhoneOptInInput = {
  credential: PhoneCredential;
  phone: string;
  country?: string;
  consent: boolean;
  locale: Locale;
};
export type PhoneOptInResult = { status: "accepted" | "saved" | "invalid" | "expired" | "retry" };
type Dependencies = {
  store: LeadStore;
  env?: TokenEnvironment;
  now?: () => Date;
  gate?: (key: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

const attempts = new Map<string, { since: number; count: number }>();
function allow(key: string): boolean {
  const now = Date.now();
  for (const [id, entry] of attempts) if (now - entry.since > 600_000) attempts.delete(id);
  const entry = attempts.get(key) || { since: now, count: 0 };
  if (entry.count >= 6 || (!attempts.has(key) && attempts.size >= 2_000)) return false;
  entry.count += 1;
  attempts.set(key, entry);
  return true;
}

/** No address lookup, mail send, verification, or advertising conversion in this path. */
export async function savePhoneOptInService(
  input: PhoneOptInInput,
  deps: Dependencies,
): Promise<PhoneOptInResult> {
  const started = Date.now();
  try {
    return await save(input, deps);
  } finally {
    const wait = Math.max(0, MIN_RESPONSE_MS - (Date.now() - started));
    await (deps.sleep || ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(wait);
  }
}

async function save(input: PhoneOptInInput, deps: Dependencies): Promise<PhoneOptInResult> {
  const phone = normalizePhone(input.phone, input.country);
  if (!phone || input.consent !== true || !SUPPORTED_LOCALES.includes(input.locale))
    return { status: "invalid" };
  const now = (deps.now || (() => new Date()))();
  const secret = requireSecret(deps.env || process.env);
  const parsed =
    input.credential.kind === "attempt"
      ? verifyPollHandle(input.credential.value, secret, now.getTime(), POLL_HANDLE_TTL_MS)
      : parseVerificationToken(input.credential.value, secret, now.getTime());
  if (!parsed) return { status: "expired" };
  if (!(deps.gate || allow)(parsed.leadId)) return { status: "retry" };
  try {
    const record = await deps.store.findByLeadId(parsed.leadId);
    // Attempt handles for repeat/abuse-filtered signups intentionally name no row.
    // Acknowledging the request uniformly must not turn them into an email-existence oracle.
    const unavailable = {
      status: input.credential.kind === "attempt" ? "accepted" : "expired",
    } as const;
    if (!record || record.status === "unsubscribed" || record.suspect) return unavailable;
    if (input.credential.kind === "confirmation" && !record.emailVerified)
      return { status: "expired" };
    if (!deps.store.recordPhoneOptIn) return { status: "retry" };
    const consent = JSON.stringify({
      version: PHONE_CONSENT_VERSION,
      at: now.toISOString(),
      locale: input.locale,
      surface: input.credential.kind,
    });
    if (record.phone !== phone || !record.smsConsent?.includes(PHONE_CONSENT_VERSION)) {
      await deps.store.recordPhoneOptIn(record.pageId, phone, consent);
    }
    const saved = await deps.store.reread(record.pageId);
    if (
      !saved ||
      saved.leadId !== parsed.leadId ||
      saved.status === "unsubscribed" ||
      saved.phone !== phone ||
      !saved.smsConsent?.includes(PHONE_CONSENT_VERSION)
    )
      return { status: "retry" };
    if (process.env.WATCHDIVE_STAGE_SCORE_INTEGRATION === "enabled") {
      await noteStagePhoneSaved({
        email: saved.email,
        at: now.toISOString(),
        sms: "granted",
      });
    }
    return { status: input.credential.kind === "attempt" ? "accepted" : "saved" };
  } catch {
    return { status: "retry" };
  }
}
