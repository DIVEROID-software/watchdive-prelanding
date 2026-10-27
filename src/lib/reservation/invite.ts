// Signed reservation invites. The email worker mints these for a lead whose
// email is already verified. Checkout verifies the signature and rechecks the
// live signup row, never an email field on the request. Notion does not store the token.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { reservationCanonicalEmail } from "./emailIdentity.ts";
import { isLeadId } from "../verification/token.ts";
import { RESERVATION_INVITE_PURPOSE, RESERVATION_OFFER_VERSION } from "./constants.ts";
import { assertTokenSecret } from "./config.ts";

const TOKEN_PREFIX = "v1";
const JTI_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
// Plus stays in the pattern because a non-Gmail address keeps its plus-tag.
// Gmail tags are removed before this check. The local part still cannot start with +.
const EMAIL_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const MAX_TOKEN_LENGTH = 4096;

export type ReservationInvite = {
  leadId: string;
  email: string;
  expiresAtMs: number;
  jti: string;
  offerVersion: string;
  emailVerified: true;
};

export type IssueReservationInviteInput = {
  leadId: string;
  email: string;
  /** Must be exactly true. The helper throws otherwise so a caller cannot mint a token for an unverified address. */
  emailVerified: boolean;
  /** Absolute expiry in milliseconds. There is no default business date. */
  expiresAtMs: number;
  /** WATCHDIVE_RESERVATION_TOKEN_SECRET. Not the verification secret. */
  secret: string;
  jti?: string;
  nowMs?: number;
};

type InvitePayload = {
  v: 1;
  purpose: typeof RESERVATION_INVITE_PURPOSE;
  leadId: string;
  email: string;
  exp: number;
  jti: string;
  offerVersion: string;
  emailVerified: true;
};

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret)
    .update(`reservation-invite:v1:${body}`)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function isReservationEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

function isJti(value: string): boolean {
  return JTI_PATTERN.test(value);
}

/**
 * Mints an opaque invite. The token stores the reservation authorization
 * identity. Gmail and googlemail.com lose plus-tags and dots and share one
 * inbox. Every other domain keeps plus-tags and dots, so those addresses
 * stay distinct. The mailed To address is the verified row email, not this key.
 */
export function issueReservationInvite(input: IssueReservationInviteInput): string {
  if (input.emailVerified !== true) {
    throw new Error("emailVerified must be true");
  }
  const secret = assertTokenSecret(input.secret);
  if (!isLeadId(input.leadId)) throw new Error("Invalid lead id");
  const email = reservationCanonicalEmail(input.email);
  if (!isReservationEmail(email)) throw new Error("Invalid email");
  const nowMs = input.nowMs ?? Date.now();
  const expSeconds = Math.floor(input.expiresAtMs / 1000);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(expSeconds) || expSeconds <= nowSeconds) {
    throw new Error("Invalid token expiry");
  }
  const jti = input.jti ?? randomBytes(16).toString("base64url");
  if (!isJti(jti)) throw new Error("Invalid jti");

  const payload: InvitePayload = {
    v: 1,
    purpose: RESERVATION_INVITE_PURPOSE,
    leadId: input.leadId.toLowerCase(),
    email,
    exp: expSeconds,
    jti,
    offerVersion: RESERVATION_OFFER_VERSION,
    emailVerified: true,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${TOKEN_PREFIX}.${body}.${sign(secret, body)}`;
}

function readPayload(body: string): InvitePayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1 || record.purpose !== RESERVATION_INVITE_PURPOSE) return undefined;
  if (record.emailVerified !== true) return undefined;
  if (record.offerVersion !== RESERVATION_OFFER_VERSION) return undefined;
  if (typeof record.leadId !== "string" || !isLeadId(record.leadId)) return undefined;
  if (typeof record.email !== "string" || !isReservationEmail(record.email)) return undefined;
  if (reservationCanonicalEmail(record.email) !== record.email) return undefined;
  if (typeof record.exp !== "number" || !Number.isSafeInteger(record.exp) || record.exp <= 0) {
    return undefined;
  }
  if (typeof record.jti !== "string" || !isJti(record.jti)) return undefined;
  return {
    v: 1,
    purpose: RESERVATION_INVITE_PURPOSE,
    leadId: record.leadId.toLowerCase(),
    email: record.email,
    exp: record.exp,
    jti: record.jti,
    offerVersion: RESERVATION_OFFER_VERSION,
    emailVerified: true,
  };
}

/** Returns the claims, or undefined when the token is missing, tampered, or expired. */
export function verifyReservationInvite(
  token: string,
  secret: string,
  nowMs: number,
): ReservationInvite | undefined {
  if (typeof token !== "string" || token.length < 20 || token.length > MAX_TOKEN_LENGTH) {
    return undefined;
  }
  if (Buffer.byteLength(secret, "utf8") < 32) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return undefined;
  const body = parts[1] ?? "";
  const mac = parts[2] ?? "";
  if (!body || !mac || !safeEqual(mac, sign(secret, body))) return undefined;
  const payload = readPayload(body);
  if (!payload) return undefined;
  const expiresAtMs = payload.exp * 1000;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) return undefined;
  return {
    leadId: payload.leadId,
    email: payload.email,
    expiresAtMs,
    jti: payload.jti,
    offerVersion: payload.offerVersion,
    emailVerified: true,
  };
}
