/**
 * Frontend side of the reservation HTTP contract implemented in
 * src/lib/reservation/handlers.ts.
 *
 * The page reads `#invite=` once, then keeps that value in sessionStorage.
 * POST /api/reservation/checkout
 *   JSON { "inviteToken", "acceptedTerms": true, "termsVersion": "2026-10-18" }
 *   200 JSON { "url": "https://checkout.stripe.com/..." }
 *   400 rejected_terms when the terms fields are missing.
 *   409 refreshes status instead of opening another checkout.
 *
 * GET /api/reservation/status?session_id=cs_test_...
 *   Authorization: Bearer <invite>
 *   session_id is optional. A session id without the bearer is not sent.
 *   200 JSON: status, paid, source "stripe", amountTotal, currency,
 *   amountRefunded, amountRefundPending, duplicatePaid, sessionId.
 *   Paid is shown only when status is "paid", paid is true, source is "stripe",
 *   currency is "usd", amountTotal is the 300-cent fee, and no refund,
 *   pending refund, or dispute is present. A disputed status stays closed.
 */
import { TERMS_VERSION } from "../../lib/reservation/constants.ts";
import { RESERVATION_FEE_USD_CENTS, assertReservationPricing } from "./pricing.ts";

assertReservationPricing();

export const CHECKOUT_PATH = "/api/reservation/checkout";
export const STATUS_PATH = "/api/reservation/status";
export const RESERVATION_RETURN_PATH = "/reservation";

/** Retries after the first immediate status read, only while a Checkout return is unresolved. */
export const STATUS_RETRY_DELAYS_MS = [1_500, 3_000, 5_000] as const;

/** Signed invite or pending reservation token. The server still verifies it. */
const INVITE_TOKEN = /^(?:v1|pv1)\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Same Checkout Session shape accepted by handleReservationStatus. */
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{1,200}$/;

export const SERVER_STATUSES = [
  "unpaid",
  "open",
  "paid",
  "refunded",
  "partially_refunded",
  "refund_pending",
  "disputed",
  "invalid",
] as const;

export type ServerReservationStatus = (typeof SERVER_STATUSES)[number];

export type ReservationStatus = {
  serverStatus: ServerReservationStatus;
  /** Mirrors the server only when the paid claim also matches the fee. */
  paid: boolean;
  authoritativePaid: boolean;
  amountTotal: number | null;
  currency: "usd" | null;
};

const REFUND_STATUSES = new Set<ServerReservationStatus>([
  "refunded",
  "partially_refunded",
  "refund_pending",
]);

export function isRefundStatus(status: ServerReservationStatus): boolean {
  return REFUND_STATUSES.has(status);
}

export function isTerminalReservationStatus(status: ReservationStatus): boolean {
  return status.authoritativePaid || isRefundStatus(status.serverStatus) || status.serverStatus === "disputed";
}

function refundCents(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

export function normalizeInviteToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length < 20 || token.length > 4096) return null;
  if (!INVITE_TOKEN.test(token) || token.includes("@")) return null;
  return token;
}

export function normalizeCheckoutSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sessionId = value.trim();
  return SESSION_ID.test(sessionId) ? sessionId : null;
}

export function checkoutPayload(inviteToken: string): {
  inviteToken: string;
  acceptedTerms: true;
  termsVersion: typeof TERMS_VERSION;
} {
  const token = normalizeInviteToken(inviteToken);
  if (!token) {
    throw new Error("Refusing to build a checkout request without the reservation link");
  }
  return { inviteToken: token, acceptedTerms: true, termsVersion: TERMS_VERSION };
}

export function isHostedStripeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim() || /[\s\\]/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === "checkout.stripe.com" &&
    url.username === "" &&
    url.password === "" &&
    (url.port === "" || url.port === "443")
  );
}

export function parseCheckoutResponse(body: unknown): { url: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const url = (body as { url?: unknown }).url;
  return isHostedStripeCheckoutUrl(url) ? { url } : null;
}

function isServerStatus(value: unknown): value is ServerReservationStatus {
  return typeof value === "string" && SERVER_STATUSES.includes(value as ServerReservationStatus);
}

/**
 * Fail closed. `paid: true` without a Stripe-sourced 300-cent `status: "paid"`
 * is not a reservation payment. The older paymentState/stripeVerified shape is ignored.
 */
export function parseReservationStatus(body: unknown): ReservationStatus | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as {
    status?: unknown;
    paid?: unknown;
    amountTotal?: unknown;
    currency?: unknown;
    source?: unknown;
    amountRefunded?: unknown;
    amountRefundPending?: unknown;
  };
  if (
    record.source !== "stripe" ||
    !isServerStatus(record.status) ||
    typeof record.paid !== "boolean"
  ) {
    return null;
  }
  const amountTotal = record.amountTotal;
  if (amountTotal !== null && (typeof amountTotal !== "number" || !Number.isInteger(amountTotal))) {
    return null;
  }
  if (record.currency !== null && record.currency !== "usd") return null;
  const refunded = refundCents(record.amountRefunded);
  const refundPending = refundCents(record.amountRefundPending);
  if (refunded === null || refundPending === null) return null;
  const currency = record.currency === "usd" ? "usd" : null;
  const amount = amountTotal === null ? null : amountTotal;
  const blocksPaid =
    isRefundStatus(record.status) ||
    record.status === "disputed" ||
    refunded > 0 ||
    refundPending > 0;
  const authoritativePaid =
    record.status === "paid" &&
    record.paid === true &&
    amount === RESERVATION_FEE_USD_CENTS &&
    currency === "usd" &&
    !blocksPaid;
  return {
    serverStatus: authoritativePaid ? "paid" : record.status === "paid" ? "invalid" : record.status,
    paid: authoritativePaid,
    authoritativePaid,
    amountTotal: amount,
    currency,
  };
}

/** Session id only. The invite travels in Authorization, never in this query. */
export function statusRequestPath(sessionId: string | null): string {
  if (!sessionId) return STATUS_PATH;
  return `${STATUS_PATH}?session_id=${encodeURIComponent(sessionId)}`;
}
