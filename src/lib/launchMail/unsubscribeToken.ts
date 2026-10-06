// Signed one-click unsubscribe links for the launch mails.
//
// `u1.<leadId>.<locale>.<mac>`, an HMAC over the same server secret as the
// confirmation token but in its own domain, so neither token can stand in for
// the other. It names the signup by its opaque `Lead ID` — never an address and
// never a Notion page id — and the locale only picks the language of the page.
//
// It does not expire. An unsubscribe link has to keep working for as long as
// the mail it came in can be opened (CAN-SPAM wants at least 30 days), and all
// it can ever do is take that one person off the launch mails.
//
// The token rides in a path segment, not `?t=`: a literal `=` followed by two
// hex digits is eaten by quoted-printable, see `verificationUrl`.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { createHmac, timingSafeEqual } from "node:crypto";

import { isLocale, LOCALE_PATH_SEGMENTS, type Locale } from "../i18n/locale.ts";
import { isLeadId } from "../verification/token.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const SEGMENT = `(?:${Object.values(LOCALE_PATH_SEGMENTS).join("|")})`;

export const UNSUBSCRIBE_TOKEN_PATTERN = new RegExp(
  `^u1\\.${UUID}\\.${SEGMENT}\\.[A-Za-z0-9_-]{43}$`,
);

export const UNSUBSCRIBE_PATH_PREFIX = "/unsubscribe/";

const LOCALE_BY_SEGMENT = new Map<string, Locale>(
  Object.entries(LOCALE_PATH_SEGMENTS).map(([locale, segment]) => [segment, locale as Locale]),
);

function mac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`unsubscribe:v1:${payload}`).digest("base64url");
}

export function createUnsubscribeToken(leadId: string, locale: Locale, secret: string): string {
  if (!isLeadId(leadId)) throw new Error("Invalid lead id");
  if (!isLocale(locale)) throw new Error("Invalid locale");
  // The lowercase path slug, so the whole token is URL-safe as it stands.
  const payload = `u1.${leadId.toLowerCase()}.${LOCALE_PATH_SEGMENTS[locale]}`;
  return `${payload}.${mac(secret, payload)}`;
}

export type ParsedUnsubscribeToken = { leadId: string; locale: Locale };

export function parseUnsubscribeToken(
  token: unknown,
  secret: string,
): ParsedUnsubscribeToken | undefined {
  if (typeof token !== "string" || !UNSUBSCRIBE_TOKEN_PATTERN.test(token)) return undefined;
  const [version, leadId, segment, signature] = token.split(".");
  const locale = LOCALE_BY_SEGMENT.get(segment);
  if (!locale) return undefined;
  const expected = mac(secret, `${version}.${leadId}.${segment}`);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"))
  ) {
    return undefined;
  }
  return { leadId, locale };
}

export function unsubscribeUrl(publicOrigin: string, token: string): string {
  if (!UNSUBSCRIBE_TOKEN_PATTERN.test(token)) throw new Error("Invalid unsubscribe token");
  return new URL(`${UNSUBSCRIBE_PATH_PREFIX}${token}`, publicOrigin).toString();
}

/** Presentation language from an unauthenticated token, for error pages only. */
export function unsubscribeTokenLocale(token: unknown): Locale | undefined {
  if (typeof token !== "string") return undefined;
  return LOCALE_BY_SEGMENT.get(token.split(".")[2] ?? "");
}
