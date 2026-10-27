// Blocks raw identifiers from retargeting event names, URLs, and tag params.
// Hashed email belongs only in the server Conversions API user_data field.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const QUERY_OR_AT = /[?@#]/;
const SECRETISH = /(sk_live|sk_test|whsec_|rk_live|rk_test)/i;

const FORBIDDEN_KEYS = new Set([
  "email",
  "phone",
  "em",
  "ph",
  "token",
  "invite",
  "secret",
  "password",
  "session_id",
  "sessionid",
  "client_reference",
  "name",
  "first_name",
  "last_name",
  "external_id",
  "lead_id",
  "page_id",
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "ttclid",
  "user_id",
]);

export function isRetargetingEventId(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export function textHasIdentifier(value: string): boolean {
  return EMAIL.test(value) || QUERY_OR_AT.test(value) || SECRETISH.test(value);
}

export function landingPathOrNull(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (textHasIdentifier(value)) return null;
  if (!/^\/[A-Za-z0-9/_-]*$/.test(value)) return null;
  return value;
}

export function cookieIdOrNull(value: string | undefined | null): string | null {
  if (!value) return null;
  if (value.length > 200 || textHasIdentifier(value)) return null;
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

export function paramsAreMeasurementSafe(params: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(params)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) return false;
    if (typeof value === "string") {
      if (key === "eventId" || key === "event_id" || key === "transaction_id") {
        if (!isRetargetingEventId(value)) return false;
        continue;
      }
      if (textHasIdentifier(value)) return false;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
      continue;
    }
    return false;
  }
  return true;
}
