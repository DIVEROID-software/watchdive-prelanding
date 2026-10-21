// Short-lived HMAC state. The OAuth state parameter is only the random id.
// The verifier, nonce, and signup context stay in the HttpOnly cookie.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { SignupCountryProbe } from "../attribution.ts";
import type { ExperimentContext } from "../conversionExperimentContract.ts";
import type { LeadAttribution } from "../verification/contracts.ts";
import { isLocale, type Locale } from "../i18n/locale.ts";
import {
  isAllowedSocialOrigin,
  type SocialEnv,
  type SocialProvider,
} from "./config.ts";

export const SOCIAL_STATE_COOKIE = "__Host-wd_social_state";
const STATE_TTL_SECONDS = 600;
const STATE_TOKEN_LIMIT = 4000;
const SET_COOKIE_LIMIT = 4096;

export type SocialState = {
  v: 1;
  provider: SocialProvider;
  state: string;
  nonce: string;
  verifier: string;
  source: "hero" | "offer";
  locale: Locale;
  origin: string;
  attribution: LeadAttribution;
  measurementConsent: boolean;
  experiment?: ExperimentContext;
  country: SignupCountryProbe;
  fbp?: string;
  fbc?: string;
  referredBy?: string;
  /** Press link reference (pressAttribution.server.ts); opaque, never a person. */
  pressRef?: string;
  exp: number;
  jti: string;
};

const consumed = new Map<string, number>();

export function resetSocialStateForTests(): void {
  consumed.clear();
}

function pruneConsumed(nowMs: number): void {
  if (consumed.size < 200) return;
  for (const [jti, expMs] of consumed) {
    if (expMs <= nowMs) consumed.delete(jti);
  }
  if (consumed.size > 5000) consumed.clear();
}

/** Synchronous check-and-set. Call it before any await so a replay cannot pass. */
export function consumeJti(jti: string, expMs: number, nowMs: number): boolean {
  pruneConsumed(nowMs);
  if (consumed.has(jti)) return false;
  consumed.set(jti, expMs);
  return true;
}

function mac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSocialState(state: SocialState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${payload}.${mac(secret, payload)}`;
}

export function readSocialState(
  token: string | undefined,
  secret: string,
  env: SocialEnv,
  nowMs: number,
): SocialState | undefined {
  if (!token || token.length > 4000) return undefined;
  const dot = token.indexOf(".");
  if (dot < 1 || token.indexOf(".", dot + 1) !== -1) return undefined;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = mac(secret, payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const row = parsed as Partial<SocialState>;
  if (row.v !== 1) return undefined;
  if (row.provider !== "google" && row.provider !== "apple") return undefined;
  if (row.source !== "hero" && row.source !== "offer") return undefined;
  if (!isLocale(row.locale)) return undefined;
  if (typeof row.state !== "string" || typeof row.nonce !== "string") return undefined;
  if (typeof row.verifier !== "string" || typeof row.jti !== "string") return undefined;
  if (typeof row.origin !== "string" || !isAllowedSocialOrigin(row.origin, env)) return undefined;
  if (typeof row.exp !== "number" || row.exp * 1000 <= nowMs) return undefined;
  if (row.measurementConsent !== true && row.measurementConsent !== false) return undefined;
  const country = row.country;
  if (!country || typeof country !== "object") return undefined;
  if (country.trustedVercel !== true && country.trustedVercel !== false) return undefined;
  if (country.header !== null && typeof country.header !== "string") return undefined;
  if (!row.attribution || typeof row.attribution !== "object") return undefined;
  if (row.referredBy !== undefined && (typeof row.referredBy !== "string" || !/^[a-z0-9]{1,8}$/.test(row.referredBy))) {
    return undefined;
  }
  if (row.pressRef !== undefined && (typeof row.pressRef !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(row.pressRef))) {
    return undefined;
  }
  return row as SocialState;
}

export function newSocialState(input: Omit<SocialState, "v" | "state" | "nonce" | "verifier" | "exp" | "jti">, nowMs: number): SocialState {
  return {
    v: 1,
    ...input,
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    exp: Math.floor(nowMs / 1000) + STATE_TTL_SECONDS,
    jti: randomBytes(16).toString("base64url"),
  };
}

export function socialStateCookie(value: string, maxAge: number): string {
  const parts = [
    `${SOCIAL_STATE_COOKIE}=${value}`,
    "HttpOnly",
    "Secure",
    "SameSite=None",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  return parts.join("; ");
}

/** Undefined when the browser would drop the cookie or the reader would refuse it. */
export function issueSocialStateCookie(token: string): string | undefined {
  if (token.length > STATE_TOKEN_LIMIT) return undefined;
  const header = socialStateCookie(token, STATE_TTL_SECONDS);
  if (header.length > SET_COOKIE_LIMIT) return undefined;
  return header;
}

export function clearSocialStateCookie(): string {
  return socialStateCookie("", 0);
}

export function readRequestCookie(header: string | null, name: string): string | undefined {
  if (!header || header.length > 16_384) return undefined;
  let found: string | undefined;
  let count = 0;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    count += 1;
    found = part.slice(separator + 1).trim();
  }
  if (count !== 1) return undefined;
  return found;
}
