// Payment authority for a signup, never proof that its inbox was verified.
// Domain-separated from verification and verified reservation invites.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { LeadRecord } from "../verification/contracts.ts";
import { conversionBlocked } from "../verification/contracts.ts";
import { isLeadId } from "../verification/token.ts";
import { assertTokenSecret, type EnvSource } from "./config.ts";
import { isReservationEmail } from "./invite.ts";
import { reservationCanonicalEmail } from "./emailIdentity.ts";
import { RESERVATION_OFFER_VERSION } from "./constants.ts";

export const PENDING_RESERVATION_TTL_MS = 15 * 60 * 1000;
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
export type PendingReservation = {
  leadId: string;
  pageId: string;
  email: string;
  issuedAtMs: number;
  expiresAtMs: number;
};
const mac = (body: string, secret: string) =>
  createHmac("sha256", secret).update(`reservation-pending:pv1:${body}`).digest("base64url");
const pageIdValid = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9-]{1,100}$/.test(value);

export function issuePendingReservationToken(input: {
  leadId: string;
  pageId: string;
  email: string;
  secret: string;
  nowMs: number;
}): string {
  assertTokenSecret(input.secret);
  const email = reservationCanonicalEmail(input.email);
  if (
    !isLeadId(input.leadId) ||
    !pageIdValid(input.pageId) ||
    !isReservationEmail(email) ||
    !Number.isSafeInteger(input.nowMs)
  )
    throw new Error("Invalid pending reservation");
  const body = Buffer.from(
    JSON.stringify({
      purpose: "reservation-pending",
      v: 1,
      offer: RESERVATION_OFFER_VERSION,
      leadId: input.leadId.toLowerCase(),
      pageId: input.pageId,
      email,
      iat: input.nowMs,
      exp: input.nowMs + PENDING_RESERVATION_TTL_MS,
    }),
  ).toString("base64url");
  return `pv1.${body}.${mac(body, input.secret)}`;
}

export function verifyPendingReservationToken(
  token: string,
  secret: string,
  nowMs: number,
  forStatus = false,
): PendingReservation | undefined {
  if (
    typeof token !== "string" ||
    token.length > 4096 ||
    Buffer.byteLength(secret) < 32 ||
    !Number.isSafeInteger(nowMs)
  )
    return;
  const [version, body, signature, extra] = token.split(".");
  if (
    version !== "pv1" ||
    !body ||
    !signature ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
    extra !== undefined ||
    !/^[A-Za-z0-9_-]+$/.test(body)
  )
    return;
  const expected = mac(body, secret);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      p.purpose !== "reservation-pending" ||
      p.v !== 1 ||
      p.offer !== RESERVATION_OFFER_VERSION ||
      typeof p.leadId !== "string" ||
      !isLeadId(p.leadId) ||
      !pageIdValid(p.pageId) ||
      typeof p.email !== "string" ||
      !isReservationEmail(p.email) ||
      reservationCanonicalEmail(p.email) !== p.email ||
      !Number.isSafeInteger(p.iat) ||
      !Number.isSafeInteger(p.exp) ||
      p.exp - p.iat !== PENDING_RESERVATION_TTL_MS ||
      p.iat > nowMs ||
      (forStatus ? p.iat + STATUS_TTL_MS : p.exp) <= nowMs
    )
      return;
    return {
      leadId: p.leadId,
      pageId: p.pageId,
      email: p.email,
      issuedAtMs: p.iat,
      expiresAtMs: p.exp,
    };
  } catch {
    return;
  }
}

export function pendingReservationForRow(
  row: LeadRecord,
  env: EnvSource,
  nowMs: number,
  leadId = row.leadId,
): { pendingReservationToken?: string } {
  if (
    env.WATCHDIVE_RESERVATION_ENABLED?.trim() !== "true" ||
    row.suspect ||
    row.duplicate ||
    conversionBlocked(row.flags) ||
    (row.status !== "pending" && row.status !== "verified")
  )
    return {};
  try {
    return {
      pendingReservationToken: issuePendingReservationToken({
        leadId,
        pageId: row.pageId,
        email: row.email,
        secret: env.WATCHDIVE_RESERVATION_TOKEN_SECRET?.trim() ?? "",
        nowMs,
      }),
    };
  } catch {
    return {};
  }
}
