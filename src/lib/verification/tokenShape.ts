// Browser-safe verification-token parsing. This module deliberately imports no
// cryptography or server configuration: a client may use it to reject malformed
// fragments and choose presentation language, but only token.ts authenticates a
// token before any state change.
import { DEFAULT_LOCALE, isLocale, type Locale } from "../i18n/locale.ts";

const UUID =
  "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}";
const EXPIRY = "\\d{1,11}";
const CONSENT = "[01]";
const LOCALE = "(?:en|ko|zh-CN|zh-TW|ja|es|fr|de|pt-BR)";
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

/**
 * Returns presentation language only. This proves shape, not authenticity;
 * never use the result to authorize a mutation or infer consent.
 */
export function verificationTokenLocale(token: string): Locale | undefined {
  if (!isVerificationTokenShape(token)) return undefined;
  const parts = token.split(".");
  return parts.length === 6 && isLocale(parts[4]) ? parts[4] : DEFAULT_LOCALE;
}
