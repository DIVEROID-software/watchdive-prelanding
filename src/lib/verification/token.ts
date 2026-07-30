// Signed confirmation tokens, poll handles, the deterministic Meta event id,
// and the keyed network key. All are HMACs over one server-only secret.
//
// The design goal is that Notion never holds anything replayable. It holds an
// opaque `Lead ID` and nothing else that matters; the token is that id plus a
// signature over it and the attempt's terms. Minting a new `Lead ID` therefore
// kills the previous link with no revocation list, and a leaked CRM export
// cannot be turned back into a working confirmation URL.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAC_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type TokenEnvironment = {
  WATCHDIVE_VERIFICATION_SECRET?: string;
  WATCHDIVE_PUBLIC_ORIGIN?: string;
};

export function requireSecret(env: TokenEnvironment): string {
  const value = (env.WATCHDIVE_VERIFICATION_SECRET ?? "").trim();
  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("WATCHDIVE_VERIFICATION_SECRET must be at least 32 bytes");
  }
  return value;
}

/**
 * The public origin is configuration, never a request header. Building a
 * confirmation link from Host or X-Forwarded-Host would let a spoofed header
 * mail somebody a link pointing at an attacker's site.
 */
export function requirePublicOrigin(env: TokenEnvironment): string {
  const raw = (env.WATCHDIVE_PUBLIC_ORIGIN ?? "").trim();
  if (!raw) throw new Error("WATCHDIVE_PUBLIC_ORIGIN is not set");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("WATCHDIVE_PUBLIC_ORIGIN must be an absolute URL");
  }
  if (parsed.protocol !== "https:") throw new Error("WATCHDIVE_PUBLIC_ORIGIN must use https");
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new Error("WATCHDIVE_PUBLIC_ORIGIN must be a bare origin");
  }
  return parsed.origin;
}

export function isLeadId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function newLeadId(): string {
  return randomUUID();
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

const CONSENT_GRANTED = "1";
const CONSENT_DENIED = "0";

function consentFlag(consent: boolean): string {
  return consent ? CONSENT_GRANTED : CONSENT_DENIED;
}

// --- confirmation token ----------------------------------------------------

export type ParsedToken = { leadId: string; expiresAtMs: number; measurementConsent: boolean };

/**
 * `<leadId>.<expiry seconds>.<consent>.<mac>`.
 *
 * The consent bit is the browser's measurement choice at submit time, carried
 * signed rather than stored: it is not CRM data, and the confirming click may
 * happen in a different browser whose own defaults must not be allowed to grant
 * something this person declined. It is one bit and no more — never an address,
 * never an identifier.
 */
export function createVerificationToken(
  leadId: string,
  expiresAtMs: number,
  measurementConsent: boolean,
  secret: string,
): string {
  if (!isLeadId(leadId)) throw new Error("Invalid lead id");
  const expiresAtSeconds = Math.floor(expiresAtMs / 1000);
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0) {
    throw new Error("Invalid token expiry");
  }
  const payload = `${leadId.toLowerCase()}.${expiresAtSeconds}.${consentFlag(measurementConsent)}`;
  return `${payload}.${sign(secret, `verify:v1:${payload}`)}`;
}

/** Shape check only — safe to run on untrusted input before any I/O. */
export function isVerificationTokenShape(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    UUID_PATTERN.test(parts[0]) &&
    /^\d{1,11}$/.test(parts[1]) &&
    (parts[2] === CONSENT_GRANTED || parts[2] === CONSENT_DENIED) &&
    MAC_PATTERN.test(parts[3])
  );
}

export function parseVerificationToken(
  token: string,
  secret: string,
  nowMs: number,
): ParsedToken | undefined {
  if (!isVerificationTokenShape(token)) return undefined;
  const [leadId, expiresAtSeconds, consent, mac] = token.split(".");
  const payload = `${leadId.toLowerCase()}.${expiresAtSeconds}.${consent}`;
  // Flipping the consent bit changes the signed payload, so a tampered token
  // cannot upgrade a denial into a grant.
  if (!safeEqual(mac, sign(secret, `verify:v1:${payload}`))) return undefined;
  const expiresAtMs = Number(expiresAtSeconds) * 1000;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) return undefined;
  return {
    leadId: leadId.toLowerCase(),
    expiresAtMs,
    measurementConsent: consent === CONSENT_GRANTED,
  };
}

// --- deterministic Meta event id -------------------------------------------

/**
 * Derived from the attempt, not from the moment of confirmation. Notion offers
 * no compare-and-set, so two racing confirmations can genuinely both reach the
 * dispatch. They compute the identical id, which is what makes that safe: Meta
 * collapses the pair into one conversion. The guarantee is dedupe, not
 * exactly-once, and the only downstream action is this idempotent one.
 *
 * Hex keeps it inside the pixel's accepted id alphabet.
 */
export function deterministicMetaEventId(leadId: string, secret: string): string {
  if (!isLeadId(leadId)) throw new Error("Invalid lead id");
  return createHmac("sha256", secret).update(`meta-event:v1:${leadId.toLowerCase()}`).digest("hex");
}

// --- poll handle -----------------------------------------------------------

export type ParsedHandle = { leadId: string; issuedAtMs: number; measurementConsent: boolean };

/**
 * What the original tab holds while it waits. It names an attempt, not a
 * person: no address, no page id, nothing that outlives the attempt. A submit
 * that deliberately started no attempt still gets a well-formed handle, so
 * polling cannot tell "already confirmed" or "suppressed" from "waiting".
 */
export function signPollHandle(
  leadId: string,
  issuedAtMs: number,
  measurementConsent: boolean,
  secret: string,
): string {
  if (!isLeadId(leadId)) throw new Error("Invalid lead id");
  const payload = `${leadId.toLowerCase()}.${issuedAtMs}.${consentFlag(measurementConsent)}`;
  return `${payload}.${sign(secret, `poll:v1:${payload}`)}`;
}

export function verifyPollHandle(
  handle: string,
  secret: string,
  nowMs: number,
  ttlMs: number,
): ParsedHandle | undefined {
  const parts = handle.split(".");
  if (parts.length !== 4) return undefined;
  const [leadId, issuedAt, consent, mac] = parts;
  if (
    !UUID_PATTERN.test(leadId) ||
    !/^\d{1,15}$/.test(issuedAt) ||
    (consent !== CONSENT_GRANTED && consent !== CONSENT_DENIED) ||
    !MAC_PATTERN.test(mac)
  ) {
    return undefined;
  }
  const payload = `${leadId.toLowerCase()}.${issuedAt}.${consent}`;
  if (!safeEqual(mac, sign(secret, `poll:v1:${payload}`))) return undefined;
  const issuedAtMs = Number(issuedAt);
  if (!Number.isSafeInteger(issuedAtMs)) return undefined;
  // A forged or clock-skewed issue time must not buy an unbounded window.
  if (issuedAtMs > nowMs + 60_000 || nowMs - issuedAtMs > ttlMs) return undefined;
  return {
    leadId: leadId.toLowerCase(),
    issuedAtMs,
    measurementConsent: consent === CONSENT_GRANTED,
  };
}

// --- network key -----------------------------------------------------------

/**
 * A domain-separated keyed digest of the client address. This is what the
 * repeat-signup heuristic groups by, so the heuristic keeps working without the
 * database ever holding a network address. Not reversible, and useless in
 * another deployment because it is bound to this secret.
 */
export function networkKey(ip: string, secret: string): string | undefined {
  const normalized = ip.trim();
  if (!normalized) return undefined;
  return createHmac("sha256", secret).update(`network:v1:${normalized}`).digest("hex").slice(0, 32);
}

// --- confirmation URL ------------------------------------------------------

/**
 * The token rides in the fragment. A fragment is never sent to a server, never
 * lands in an access log, and is not forwarded in a Referer — so outside the
 * mail itself the raw token exists only in the confirming tab's memory.
 *
 * The fragment carries the bare token, not a `key=value` pair. A literal `=`
 * here does not survive mail: bodies are transferred as quoted-printable, where
 * `=` introduces an escape, so an unescaped `token=32ab…` is decoded as
 * `token` + byte 0x32 + `ab…` and the first two characters of the token are
 * silently destroyed. Every character the token can contain — hex, base64url,
 * `.`, `-` — passes quoted-printable untouched, so dropping the `=` makes the
 * link independent of the transfer encoding.
 */
export function verificationUrl(publicOrigin: string, token: string): string {
  if (!isVerificationTokenShape(token)) throw new Error("Invalid verification token");
  const url = new URL("/verify", publicOrigin);
  url.hash = token;
  return url.toString();
}
