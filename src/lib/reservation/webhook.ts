// Snapshot webhook verification. The signature covers the exact raw body
// bytes (HMAC-SHA256 of `${timestamp}.${payload}`, hex digest in v1), as
// documented at https://docs.stripe.com/webhooks.md. JSON is parsed only
// after that check. Payment state is then re-read from Stripe.
import { createHmac, timingSafeEqual } from "node:crypto";

import { reservationCanonicalEmail } from "./emailIdentity.ts";
import { META_EMAIL_SHA256, META_PRODUCT, PRODUCT_CODE } from "./constants.ts";
import type { EnabledReservationConfig } from "./config.ts";
import {
  collapseOpenSessions,
  expireOpenSessions,
  loadReservationState,
  reservationEmailHash,
  retirePastDueOpenSessions,
} from "./checkout.ts";
import {
  StripeApiError,
  type StripeApi,
  type StripeCheckoutSession,
} from "./stripeApi.ts";
import {
  aggregateInspections,
  blockingError,
  inspectSession,
  isOurProduct,
  type ReservationSnapshot,
} from "./state.ts";

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
  "charge.refund.updated",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "refund.created",
  "refund.updated",
  "refund.failed",
]);

export type WebhookResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Verifies a Stripe-Signature header against the raw body. Returns false for
 * a missing header, a bad MAC, or a timestamp outside the tolerance window.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowMs: number,
  toleranceSeconds = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  if (!payload || !header || !secret) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1" && value) signatures.push(value);
  }
  if (!/^[0-9]+$/.test(timestamp) || signatures.length === 0) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  if (!signatures.some((signature) => safeEqual(signature, expected))) return false;
  const age = Math.floor(nowMs / 1000) - timestampSeconds;
  return age <= toleranceSeconds && age >= -toleranceSeconds;
}

function objectId(event: Record<string, unknown>): string {
  const data = event.data;
  if (!data || typeof data !== "object") return "";
  const object = (data as { object?: unknown }).object;
  if (!object || typeof object !== "object") return "";
  const id = (object as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

function expandedId(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

function objectString(event: Record<string, unknown>, key: string): string {
  const data = event.data;
  if (!data || typeof data !== "object") return "";
  const object = (data as { object?: unknown }).object;
  if (!object || typeof object !== "object") return "";
  return expandedId((object as Record<string, unknown>)[key]);
}

/** A charge id from a string or from an expanded charge object. */
function chargeIdFrom(value: string): string {
  if (!value.startsWith("ch_") || value.length < 4 || /\s/.test(value)) return "";
  return value;
}

function snapshotBody(
  eventId: string,
  snapshot: ReservationSnapshot,
  extra: Record<string, unknown> = {},
): WebhookResult {
  return {
    httpStatus: 200,
    body: {
      received: true,
      eventId,
      status: snapshot.status,
      paid: snapshot.paid,
      sessionId: snapshot.sessionId,
      amountRefunded: snapshot.amountRefunded,
      duplicatePaid: snapshot.duplicatePaid,
      source: "stripe",
      ...extra,
    },
  };
}

async function sessionForPaymentIntent(
  stripe: StripeApi,
  paymentIntentId: string,
): Promise<StripeCheckoutSession | null> {
  const sessions = await stripe.listCheckoutSessions({ paymentIntentId });
  return sessions.find((session) => isOurProduct(session)) ?? sessions[0] ?? null;
}

async function resolveSession(
  stripe: StripeApi,
  eventType: string,
  event: Record<string, unknown>,
): Promise<StripeCheckoutSession | null> {
  if (eventType.startsWith("checkout.session.")) {
    const id = objectId(event);
    if (!id.startsWith("cs_")) return null;
    return stripe.retrieveCheckoutSession(id);
  }

  if (eventType.startsWith("payment_intent.")) {
    const id = objectId(event);
    if (!id.startsWith("pi_")) return null;
    return sessionForPaymentIntent(stripe, id);
  }

  if (eventType.startsWith("charge.dispute.")) {
    const chargeId = chargeIdFrom(objectString(event, "charge"));
    if (!chargeId) return null;
    const charge = await stripe.retrieveCharge(chargeId);
    if (!charge.paymentIntentId) return null;
    return sessionForPaymentIntent(stripe, charge.paymentIntentId);
  }

  if (eventType.startsWith("charge.")) {
    const id = objectId(event);
    if (!id.startsWith("ch_")) return null;
    const charge = await stripe.retrieveCharge(id);
    if (!charge.paymentIntentId) return null;
    return sessionForPaymentIntent(stripe, charge.paymentIntentId);
  }

  if (eventType.startsWith("refund.")) {
    const chargeId = chargeIdFrom(objectString(event, "charge"));
    const paymentIntentId = objectString(event, "payment_intent");
    if (chargeId) {
      const charge = await stripe.retrieveCharge(chargeId);
      if (!charge.paymentIntentId) return null;
      return sessionForPaymentIntent(stripe, charge.paymentIntentId);
    }
    if (paymentIntentId.startsWith("pi_")) return sessionForPaymentIntent(stripe, paymentIntentId);
    return null;
  }

  return null;
}

/**
 * Verifies the raw body, re-reads Stripe, and returns the derived state.
 * Calling this twice for the same Stripe objects returns the same paid and
 * refund amounts. It does not create a charge and it does not refund.
 */
export async function processReservationWebhook(input: {
  rawBody: string;
  signatureHeader: string | null;
  config: EnabledReservationConfig;
  stripe: StripeApi;
  nowMs: number;
}): Promise<WebhookResult> {
  const secret = input.config.webhookSecret;
  if (!secret) return { httpStatus: 503, body: { error: "reservation_misconfigured" } };
  if (!verifyStripeSignature(input.rawBody, input.signatureHeader, secret, input.nowMs)) {
    return { httpStatus: 400, body: { error: "invalid_signature" } };
  }

  let event: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input.rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { httpStatus: 400, body: { error: "invalid_payload" } };
    }
    event = parsed as Record<string, unknown>;
  } catch {
    return { httpStatus: 400, body: { error: "invalid_payload" } };
  }

  const eventId = typeof event.id === "string" ? event.id : "";
  const eventType = typeof event.type === "string" ? event.type : "";
  if (!eventId || !eventType) return { httpStatus: 400, body: { error: "invalid_payload" } };
  if (event.livemode !== input.config.livemode) {
    return { httpStatus: 200, body: { received: true, eventId, ignored: "livemode_mismatch" } };
  }
  if (!HANDLED_EVENTS.has(eventType)) {
    return { httpStatus: 200, body: { received: true, eventId, ignored: "event_type" } };
  }

  let session: StripeCheckoutSession | null;
  try {
    session = await resolveSession(input.stripe, eventType, event);
  } catch (error) {
    if (error instanceof StripeApiError && error.status === 404) {
      return { httpStatus: 200, body: { received: true, eventId, ignored: "missing_object" } };
    }
    throw error;
  }
  if (!session || !isOurProduct(session)) {
    return { httpStatus: 200, body: { received: true, eventId, ignored: "not_reservation" } };
  }
  if (metaProduct(session) !== PRODUCT_CODE) {
    return { httpStatus: 200, body: { received: true, eventId, ignored: "not_reservation" } };
  }

  const sessionHash = session.metadata[META_EMAIL_SHA256] ?? "";
  if (!session.customerId) {
    const inspected = await inspectSession(
      input.stripe,
      session,
      input.config.livemode,
      input.nowMs,
      sessionHash,
    );
    return snapshotBody(eventId, aggregateInspections([inspected]));
  }

  const customer = await input.stripe.retrieveCustomer(session.customerId);
  if (!customer.email) {
    const inspected = await inspectSession(
      input.stripe,
      session,
      input.config.livemode,
      input.nowMs,
      sessionHash,
    );
    return snapshotBody(eventId, aggregateInspections([inspected]));
  }
  const email = reservationCanonicalEmail(customer.email);
  if (sessionHash !== reservationEmailHash(email)) {
    return { httpStatus: 200, body: { received: true, eventId, ignored: "not_bound" } };
  }

  const initial = await loadReservationState(
    input.stripe,
    email,
    input.config.livemode,
    input.nowMs,
  );
  const retired = await retirePastDueOpenSessions(
    input.stripe,
    email,
    input.config.livemode,
    input.nowMs,
    initial,
  );
  if (retired === "fail_closed") {
    throw new StripeApiError(502, "expire_not_observed", "api_error", null);
  }
  if (blockingError(retired.snapshot.status)) {
    await expireOpenSessions(input.stripe, retired.inspected, input.nowMs);
  } else if (retired.snapshot.status === "open") {
    await collapseOpenSessions(input.stripe, retired.inspected);
  }
  const after = await loadReservationState(
    input.stripe,
    email,
    input.config.livemode,
    input.nowMs,
  );
  return snapshotBody(eventId, after.snapshot);
}

function metaProduct(session: StripeCheckoutSession): string {
  return session.metadata[META_PRODUCT] ?? "";
}
