// Signed Buddy Invite status links and the other referral URLs.
//
// The status page shows one person their own count and lets them set a
// nickname, so its link must not be guessable from the public share code: a
// share link `/r/<code>` is handed to friends, the status link is mailed only
// to the owner. The token is the ref code plus an HMAC over it, with a key
// derived from the verification secret under its own label so a status MAC can
// never be replayed as (or forged from) a confirmation-token MAC.
//
// Token: `<refCode>.<version>.<mac>` — `[a-z0-9]{8}`, `1`, and 24 base64url
// characters (the first 18 bytes of HMAC-SHA256, 144 bits). All URL-safe, no
// `=`, so quoted-printable mail bodies cannot mangle it (see r.$code.tsx).
// The link does not expire: the page shows only counts and the owner's own
// settings, and a welcome mail sent in October must still work at the close.
// Bumping TOKEN_VERSION (or rotating the verification secret) revokes all links.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { createHmac, timingSafeEqual } from "node:crypto";

import { localizePath, type Locale } from "../i18n/locale.ts";
import { referralUrl } from "../verification/resend.ts";
import { requireSecret, type TokenEnvironment } from "../verification/token.ts";

const TOKEN_VERSION = "1";
const KEY_LABEL = "watchdive-referral-status-key:v1";
const MAC_BYTES = 18;
const REF_CODE = /^[a-z0-9]{8}$/;
const MAC_PATTERN = /^[A-Za-z0-9_-]{24}$/;

/** Derived status-link key. Throws when the verification secret is missing or short. */
export function referralSecret(env: TokenEnvironment = process.env): string {
  return createHmac("sha256", requireSecret(env)).update(KEY_LABEL).digest("base64url");
}

function mac(refCode: string, version: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`wd-buddy-status|${version}|${refCode}`)
    .digest()
    .subarray(0, MAC_BYTES)
    .toString("base64url");
}

export function signStatusToken(refCode: string, secret: string): string {
  if (!REF_CODE.test(refCode)) throw new Error("Invalid referral code");
  if (!secret) throw new Error("A referral secret is required");
  return `${refCode}.${TOKEN_VERSION}.${mac(refCode, TOKEN_VERSION, secret)}`;
}

/** The ref code the token was signed for, or null for anything else. */
export function verifyStatusToken(token: unknown, secret: string): string | null {
  if (typeof token !== "string" || token.length > 64 || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [refCode, version, given] = parts;
  if (!REF_CODE.test(refCode) || version !== TOKEN_VERSION || !MAC_PATTERN.test(given)) {
    return null;
  }
  const expected = Buffer.from(mac(refCode, version, secret), "utf8");
  const actual = Buffer.from(given, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return refCode;
}

function absolute(origin: string, path: string, locale: Locale): string {
  return new URL(localizePath(path, locale), origin).toString();
}

/**
 * `/buddy#<token>` for English, `/<segment>/buddy#<token>` otherwise. The
 * token rides in the fragment, as the verification link's does: browsers never
 * send a fragment to the server, so it stays out of access logs, CDN and
 * analytics URLs, Referer headers and link prefetchers. The page reads it
 * client-side and POSTs it (StatusPage).
 */
export function statusUrl(origin: string, refCode: string, locale: Locale, secret: string): string {
  return `${absolute(origin, "/buddy", locale)}#${signStatusToken(refCode, secret)}`;
}

export function rulesUrl(origin: string, locale: Locale): string {
  return absolute(origin, "/buddy-rules", locale);
}

/**
 * The share link is the existing `/r/<code>` path (never `?ref=`, which
 * quoted-printable mail mangles), always unprefixed: the friend's own browser
 * language picks their locale, not the referrer's.
 */
export function shareUrl(origin: string, refCode: string): string {
  return referralUrl(origin, refCode);
}
