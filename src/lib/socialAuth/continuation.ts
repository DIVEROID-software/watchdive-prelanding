// Short-lived proof that this browser's provider subject is bound to one
// canonical verified lead. The presentation acknowledgement is not read here
// and is never a credential. The payload has no email address. The value
// returned to the page is the existing confirmation token, so phone opt-in
// and the onsite reservation offer keep their current checks.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { DEFAULT_LOCALE, isLocale } from "../i18n/locale.ts";
import { conversionBlocked, type LeadRecord, type LeadStore } from "../verification/contracts.ts";
import { createVerificationToken, isLeadId } from "../verification/token.ts";
import type { SocialProvider } from "./config.ts";
import { readRequestCookie } from "./state.ts";

export const SOCIAL_CONTINUATION_COOKIE = "__Host-wd_social_continue";
export const SOCIAL_CONTINUATION_TTL_SECONDS = 600;
/** Hero and offer each mount once, and React strict mode mounts twice. */
export const SOCIAL_CONTINUATION_EXCHANGE_LIMIT = 8;

const MAC_LABEL = "social-continue:v1:";
const exchanges = new Map<string, { expMs: number; count: number }>();

export type ContinuationGrant = {
  leadId: string;
  provider: SocialProvider;
  sub: string;
};

export type ContinuationCredential = { kind: "confirmation"; value: string };

export type ContinuationFailure =
  | "missing"
  | "tampered"
  | "expired"
  | "replay"
  | "unavailable"
  | "retry";

export type ContinuationExchange =
  | { status: "ready"; credential: ContinuationCredential }
  | { status: "unavailable"; reason: ContinuationFailure };

type ContinuationClaims = ContinuationGrant & { exp: number; jti: string };

export function resetSocialContinuationForTests(): void {
  exchanges.clear();
}

function mac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`${MAC_LABEL}${payload}`).digest("base64url");
}

function pruneExchanges(nowMs: number): void {
  if (exchanges.size < 200) return;
  for (const [jti, entry] of exchanges) {
    if (entry.expMs <= nowMs) exchanges.delete(jti);
  }
  if (exchanges.size > 5000) exchanges.clear();
}

/**
 * The lead phone opt-in and onsite reservation will both accept. Subject
 * binding is required, so an unbound external Google login cannot pass.
 */
export function socialContinuationAllowed(
  row: LeadRecord | undefined,
  provider: SocialProvider,
  sub: string,
): string | undefined {
  if (!row || !isLeadId(row.leadId) || !sub) return undefined;
  if (row.emailVerified !== true || row.status !== "verified") return undefined;
  if (row.duplicate || row.suspect || !row.email) return undefined;
  if (conversionBlocked(row.flags)) return undefined;
  const bound = provider === "google" ? row.googleSubject : row.appleSubject;
  if (bound !== sub) return undefined;
  return row.leadId;
}

export function issueSocialContinuationCookie(
  grant: ContinuationGrant,
  secret: string,
  nowMs: number,
): string | undefined {
  if (!isLeadId(grant.leadId) || (grant.provider !== "google" && grant.provider !== "apple")) return undefined;
  if (!grant.sub || grant.sub.length > 255) return undefined;
  const claims: ContinuationClaims = {
    ...grant,
    exp: Math.floor(nowMs / 1000) + SOCIAL_CONTINUATION_TTL_SECONDS,
    jti: randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const token = `${payload}.${mac(secret, payload)}`;
  const header = [
    `${SOCIAL_CONTINUATION_COOKIE}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SOCIAL_CONTINUATION_TTL_SECONDS}`,
  ].join("; ");
  if (header.length > 4096 || token.includes("=")) return undefined;
  return header;
}

export function clearSocialContinuationCookie(): string {
  return `${SOCIAL_CONTINUATION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readSocialContinuation(
  token: string | undefined,
  secret: string,
  nowMs: number,
): { ok: true; claims: ContinuationClaims } | { ok: false; reason: "missing" | "tampered" | "expired" } {
  if (!token) return { ok: false, reason: "missing" };
  if (token.length > 3500 || token === "1") return { ok: false, reason: "tampered" };
  const dot = token.indexOf(".");
  if (dot < 1 || token.indexOf(".", dot + 1) !== -1) return { ok: false, reason: "tampered" };
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = mac(secret, payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { ok: false, reason: "tampered" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "tampered" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "tampered" };
  const row = parsed as Partial<ContinuationClaims>;
  if (row.leadId === undefined || !isLeadId(row.leadId)) return { ok: false, reason: "tampered" };
  if (row.provider !== "google" && row.provider !== "apple") return { ok: false, reason: "tampered" };
  if (typeof row.sub !== "string" || row.sub.length < 1 || row.sub.length > 255) return { ok: false, reason: "tampered" };
  if (typeof row.jti !== "string" || row.jti.length < 16 || row.jti.length > 64) return { ok: false, reason: "tampered" };
  if (typeof row.exp !== "number" || !Number.isSafeInteger(row.exp)) return { ok: false, reason: "tampered" };
  if (row.exp * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return {
    ok: true,
    claims: { leadId: row.leadId, provider: row.provider, sub: row.sub, exp: row.exp, jti: row.jti },
  };
}

function takeExchange(jti: string, expMs: number, nowMs: number): "ok" | "replay" {
  pruneExchanges(nowMs);
  const entry = exchanges.get(jti);
  if (entry && entry.count >= SOCIAL_CONTINUATION_EXCHANGE_LIMIT) return "replay";
  if (entry) entry.count += 1;
  else exchanges.set(jti, { expMs, count: 1 });
  return "ok";
}

export async function exchangeSocialContinuation(input: {
  cookieHeader: string | null;
  socialSecret: string;
  verificationSecret: string;
  now: Date;
  store: Pick<LeadStore, "findByLeadId">;
}): Promise<ContinuationExchange> {
  const token = readRequestCookie(input.cookieHeader, SOCIAL_CONTINUATION_COOKIE);
  const read = readSocialContinuation(token, input.socialSecret, input.now.getTime());
  if (!read.ok) return { status: "unavailable", reason: read.reason };
  if (takeExchange(read.claims.jti, read.claims.exp * 1000, input.now.getTime()) === "replay") {
    return { status: "unavailable", reason: "replay" };
  }
  let row: LeadRecord | undefined;
  try {
    row = await input.store.findByLeadId(read.claims.leadId);
  } catch {
    const entry = exchanges.get(read.claims.jti);
    if (entry) entry.count = Math.max(0, entry.count - 1);
    return { status: "unavailable", reason: "retry" };
  }
  const leadId = socialContinuationAllowed(row, read.claims.provider, read.claims.sub);
  if (!leadId || leadId !== read.claims.leadId || !row) return { status: "unavailable", reason: "unavailable" };
  const locale = isLocale(row.signupLocale) ? row.signupLocale : DEFAULT_LOCALE;
  const value = createVerificationToken(
    leadId,
    // An exchange never extends the original OAuth grant's lifetime, even
    // after a cold start or a later exchange on another server instance.
    read.claims.exp * 1000,
    false,
    input.verificationSecret,
    locale,
  );
  return { status: "ready", credential: { kind: "confirmation", value } };
}
