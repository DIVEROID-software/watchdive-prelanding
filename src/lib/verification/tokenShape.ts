// Browser-safe verification-token parsing. This module deliberately imports no
// cryptography or server configuration: a client may use it to reject malformed
// fragments and choose presentation language, but only token.ts authenticates a
// token before any state change.
import { DEFAULT_LOCALE, isLocale, type Locale } from "../i18n/locale.ts";

const UUID =
  "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}";
const EXPIRY = "\\d{1,11}";
const CONSENT = "[01]";
const LOCALE = "(?:en|ko|zh-CN|zh-TW|ja|es|fr|de|pt-BR|nl)";
const MAC = "[A-Za-z0-9_-]{43}";

/** Links sent before localization. They remain valid and resolve to English. */
export const LEGACY_VERIFICATION_TOKEN_PATTERN = new RegExp(
  `^${UUID}\\.${EXPIRY}\\.${CONSENT}\\.${MAC}$`,
);

/** Current signed token, including the language selected at form submission. */
export const VERIFICATION_TOKEN_V2_PATTERN = new RegExp(
  `^v2\\.${UUID}\\.${EXPIRY}\\.${CONSENT}\\.${LOCALE}\\.${MAC}$`,
);

export function isVerificationTokenShape(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (LEGACY_VERIFICATION_TOKEN_PATTERN.test(value) || VERIFICATION_TOKEN_V2_PATTERN.test(value))
  );
}

const EMBEDDED_V2 = new RegExp(`v2\\.${UUID}\\.${EXPIRY}\\.${CONSENT}\\.${LOCALE}\\.${MAC}`);
const EMBEDDED_LEGACY = new RegExp(`${UUID}\\.${EXPIRY}\\.${CONSENT}\\.${MAC}`);
const MAIL_NOISE = /[\u0000-\u001F\u007F\u00A0\u200B-\u200D\u2060\uFEFF\s]/g;
const FRAGMENT_LIMIT = 4_096;

/**
 * Pulls a shaped token out of a mail-client fragment.
 * Quoted-printable soft breaks, whitespace, zero-width characters, a legacy
 * `token=` prefix, and trailing tracking junk are removed. The match is not
 * authenticated and is not case-folded: only token.ts accepts it. A query
 * string is never read; the value must already be the URL fragment.
 */
export function verificationTokenFromFragment(hash: string): string | undefined {
  if (typeof hash !== "string" || !hash.startsWith("#") || hash.length > FRAGMENT_LIMIT) {
    return undefined;
  }
  const unfolded = hash.slice(1).replace(/=\r\n|=\n|=\r/g, "");
  let raw: string;
  try {
    raw = decodeURIComponent(unfolded);
  } catch {
    raw = unfolded;
  }
  raw = raw.replace(MAIL_NOISE, "");
  const nested = raw.lastIndexOf("#");
  if (nested >= 0) raw = raw.slice(nested + 1).replace(MAIL_NOISE, "");
  if (raw.startsWith("token=")) raw = raw.slice("token=".length);
  if (isVerificationTokenShape(raw)) return raw;
  const current = raw.match(EMBEDDED_V2);
  if (current && isVerificationTokenShape(current[0])) return current[0];
  const legacy = raw.match(EMBEDDED_LEGACY);
  if (legacy && isVerificationTokenShape(legacy[0])) return legacy[0];
  return undefined;
}

/**
 * Returns presentation language only. This proves shape, not authenticity;
 * never use the result to authorize a mutation or infer consent.
 */
export function verificationTokenLocale(token: string): Locale | undefined {
  if (!isVerificationTokenShape(token)) return undefined;
  const parts = token.split(".");
  return parts.length === 6 && isLocale(parts[4]) ? parts[4] : DEFAULT_LOCALE;
}
