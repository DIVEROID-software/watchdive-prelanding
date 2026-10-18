// Paid state is a function of Stripe objects retrieved by the API client.
// Replaying a webhook cannot add the fee or the refund a second time, because
// nothing here increments a counter. Notion is not consulted: it has no
// compare-and-set, and this flow does not add a reservation column.
import {
  FEE_POLICY,
  LATER_PRODUCT_PRICE_CENTS,
  META_ACCEPTED_TERMS,
  META_CURRENCY,
  META_EMAIL_SHA256,
  META_FEE_CENTS,
  META_FEE_POLICY,
  META_LATER_PRICE_CENTS,
  META_OFFER_VERSION,
  META_PRICE_GUARANTEE,
  META_PRODUCT,
  META_REFUND_POLICY,
  META_TERMS_VERSION,
  PRICE_GUARANTEE,
  PRODUCT_CODE,
  REFUND_POLICY,
  RESERVATION_CURRENCY,
  RESERVATION_FEE_CENTS,
  RESERVATION_OFFER_VERSION,
  TERMS_VERSION,
} from "./constants.ts";
import type {
  StripeApi,
  StripeCharge,
  StripeCheckoutSession,
  StripeDispute,
  StripeLineItem,
  StripeMetadata,
  StripePaymentIntent,
  StripeRefund,
} from "./stripeApi.ts";

export type ReservationStatus =
  | "unpaid"
  | "open"
  | "paid"
  | "refunded"
  | "partially_refunded"
  | "refund_pending"
  | "disputed"
  | "invalid";

export type ReservationSnapshot = {
  status: ReservationStatus;
  /** True only for a contract-matching Stripe payment with no refund and no open dispute. */
  paid: boolean;
  sessionId: string | null;
  url: string | null;
  amountTotal: number | null;
  currency: string | null;
  amountRefunded: number;
  amountRefundPending: number;
  duplicatePaid: boolean;
  leadId: string | null;
  source: "stripe";
};

export type RefundState = "none" | "partial" | "full" | "pending";
export type DisputeState = "none" | "open";

/** Merchant-won dispute statuses. Anything else, including an empty list, is open. */
const DISPUTE_WON = new Set(["won", "warning_closed", "prevented"]);

export type InspectedSession =
  | { kind: "foreign" }
  | { kind: "invalid"; session: StripeCheckoutSession }
  | { kind: "open"; session: StripeCheckoutSession }
  | { kind: "terminal_unpaid"; session: StripeCheckoutSession }
  | {
      kind: "paid";
      session: StripeCheckoutSession;
      amountRefunded: number;
      amountRefundPending: number;
      refundState: RefundState;
      dispute: DisputeState;
    };

const EMPTY: ReservationSnapshot = {
  status: "unpaid",
  paid: false,
  sessionId: null,
  url: null,
  amountTotal: null,
  currency: null,
  amountRefunded: 0,
  amountRefundPending: 0,
  duplicatePaid: false,
  leadId: null,
  source: "stripe",
};

function meta(metadata: StripeMetadata, key: string): string {
  return metadata[key] ?? "";
}

/** Identity of our offer, before the money fields are checked. */
export function isOurProduct(session: StripeCheckoutSession): boolean {
  return (
    meta(session.metadata, META_PRODUCT) === PRODUCT_CODE &&
    meta(session.metadata, META_OFFER_VERSION) === RESERVATION_OFFER_VERSION
  );
}

const EMAIL_SHA256 = /^[a-f0-9]{64}$/;

/** The session metadata and client reference are the canonical inbox, not a lead id. */
export function sessionOwnedByInbox(
  session: StripeCheckoutSession,
  emailSha256: string,
): boolean {
  return (
    isOurProduct(session) &&
    emailSha256.length === 64 &&
    meta(session.metadata, META_EMAIL_SHA256) === emailSha256 &&
    session.clientReferenceId === emailSha256
  );
}

export function sessionMoneyMatches(
  session: StripeCheckoutSession,
  livemode: boolean,
  emailSha256: string,
): boolean {
  return (
    sessionOwnedByInbox(session, emailSha256) &&
    session.livemode === livemode &&
    session.mode === "payment" &&
    session.currency === RESERVATION_CURRENCY &&
    session.amountTotal === RESERVATION_FEE_CENTS &&
    meta(session.metadata, META_FEE_CENTS) === String(RESERVATION_FEE_CENTS) &&
    meta(session.metadata, META_CURRENCY) === RESERVATION_CURRENCY &&
    meta(session.metadata, META_FEE_POLICY) === FEE_POLICY &&
    meta(session.metadata, META_LATER_PRICE_CENTS) === String(LATER_PRODUCT_PRICE_CENTS) &&
    meta(session.metadata, META_PRICE_GUARANTEE) === PRICE_GUARANTEE &&
    meta(session.metadata, META_REFUND_POLICY) === REFUND_POLICY &&
    meta(session.metadata, META_ACCEPTED_TERMS) === "true" &&
    meta(session.metadata, META_TERMS_VERSION) === TERMS_VERSION &&
    EMAIL_SHA256.test(emailSha256)
  );
}

export function lineItemsMatch(items: StripeLineItem[]): boolean {
  if (items.length !== 1) return false;
  const item = items[0];
  if (!item) return false;
  return (
    item.quantity === 1 &&
    item.currency === RESERVATION_CURRENCY &&
    item.amountTotal === RESERVATION_FEE_CENTS &&
    item.unitAmount === RESERVATION_FEE_CENTS &&
    item.recurring === false
  );
}

export function refundStateOf(
  charge: StripeCharge,
  refunds: StripeRefund[],
): { state: RefundState; succeeded: number; pending: number } {
  const succeeded = charge.amountRefunded;
  const pending = refunds
    .filter((refund) => refund.status === "pending" || refund.status === "requires_action")
    .reduce((sum, refund) => sum + refund.amount, 0);
  if (charge.refunded || succeeded >= RESERVATION_FEE_CENTS) {
    return { state: "full", succeeded, pending };
  }
  if (pending > 0) return { state: "pending", succeeded, pending };
  if (succeeded > 0) return { state: "partial", succeeded, pending };
  return { state: "none", succeeded, pending };
}

export function disputeStateOf(charge: StripeCharge, disputes: StripeDispute[]): DisputeState {
  if (!charge.disputed) return "none";
  if (disputes.length > 0 && disputes.every((dispute) => DISPUTE_WON.has(dispute.status))) {
    return "none";
  }
  return "open";
}

function snapshotFrom(
  status: ReservationStatus,
  session: StripeCheckoutSession | null,
  extra: Partial<ReservationSnapshot> = {},
): ReservationSnapshot {
  return {
    ...EMPTY,
    status,
    sessionId: session?.id ?? null,
    url: status === "open" ? (session?.url ?? null) : null,
    amountTotal: session?.amountTotal ?? null,
    currency: session?.currency ?? null,
    leadId: null,
    ...extra,
  };
}

function byCreated(a: StripeCheckoutSession, b: StripeCheckoutSession): number {
  return a.created - b.created || a.id.localeCompare(b.id);
}

export function aggregateInspections(items: InspectedSession[]): ReservationSnapshot {
  const paid = items.filter((item) => item.kind === "paid");
  const full = paid
    .filter((item) => item.refundState === "full")
    .sort((a, b) => byCreated(a.session, b.session));
  const firstFull = full[0];
  if (firstFull) {
    return snapshotFrom("refunded", firstFull.session, {
      amountRefunded: firstFull.amountRefunded,
      amountRefundPending: firstFull.amountRefundPending,
    });
  }

  const disputed = paid
    .filter((item) => item.dispute === "open")
    .sort((a, b) => byCreated(a.session, b.session));
  const firstDisputed = disputed[0];
  if (firstDisputed) {
    return snapshotFrom("disputed", firstDisputed.session, {
      amountRefunded: firstDisputed.amountRefunded,
      amountRefundPending: firstDisputed.amountRefundPending,
    });
  }

  const clean = paid
    .filter((item) => item.refundState === "none" && item.dispute === "none")
    .sort((a, b) => byCreated(a.session, b.session));
  const firstClean = clean[0];
  if (firstClean) {
    return snapshotFrom("paid", firstClean.session, {
      paid: true,
      amountRefunded: 0,
      amountRefundPending: 0,
      duplicatePaid: clean.length > 1,
    });
  }

  const pending = paid
    .filter((item) => item.refundState === "pending")
    .sort((a, b) => byCreated(a.session, b.session));
  const firstPending = pending[0];
  if (firstPending) {
    return snapshotFrom("refund_pending", firstPending.session, {
      amountRefunded: firstPending.amountRefunded,
      amountRefundPending: firstPending.amountRefundPending,
    });
  }

  const partial = paid
    .filter((item) => item.refundState === "partial")
    .sort((a, b) => byCreated(a.session, b.session));
  const firstPartial = partial[0];
  if (firstPartial) {
    return snapshotFrom("partially_refunded", firstPartial.session, {
      amountRefunded: firstPartial.amountRefunded,
      amountRefundPending: firstPartial.amountRefundPending,
    });
  }

  const open = items
    .filter((item) => item.kind === "open")
    .map((item) => item.session)
    .sort(byCreated);
  const firstOpen = open[0];
  if (firstOpen) return snapshotFrom("open", firstOpen);

  const invalid = items.find((item) => item.kind === "invalid");
  if (invalid && invalid.kind === "invalid") return snapshotFrom("invalid", invalid.session);

  return EMPTY;
}

function paymentMatches(intent: StripePaymentIntent, charge: StripeCharge): boolean {
  return (
    intent.amount === RESERVATION_FEE_CENTS &&
    intent.currency === RESERVATION_CURRENCY &&
    charge.amount === RESERVATION_FEE_CENTS &&
    charge.currency === RESERVATION_CURRENCY &&
    charge.paymentIntentId === intent.id
  );
}

/**
 * Classifies one retrieved session. Line items, the PaymentIntent, the Charge,
 * and the refund list are read from Stripe when the session claims to be paid
 * or when it is still open (so a wrong open amount is not reused).
 */
export async function inspectSession(
  stripe: StripeApi,
  session: StripeCheckoutSession,
  livemode: boolean,
  nowMs: number,
  emailSha256: string,
): Promise<InspectedSession> {
  if (!isOurProduct(session) || meta(session.metadata, META_EMAIL_SHA256) !== emailSha256) {
    return { kind: "foreign" };
  }
  if (!sessionMoneyMatches(session, livemode, emailSha256)) return { kind: "invalid", session };

  const items = await stripe.listLineItems(session.id);
  if (!lineItemsMatch(items)) return { kind: "invalid", session };

  if (session.status === "open") {
    if (session.expiresAt * 1000 <= nowMs) return { kind: "terminal_unpaid", session };
    return { kind: "open", session };
  }

  if (session.status !== "complete" || session.paymentStatus !== "paid") {
    return { kind: "terminal_unpaid", session };
  }
  if (!session.paymentIntentId) return { kind: "invalid", session };

  const intent = await stripe.retrievePaymentIntent(session.paymentIntentId);
  if (!intent.latestChargeId) return { kind: "invalid", session };
  const charge = await stripe.retrieveCharge(intent.latestChargeId);
  if (!paymentMatches(intent, charge)) return { kind: "invalid", session };
  const refunds = await stripe.listRefunds(charge.id);
  const disputes = charge.disputed ? await stripe.listDisputes(charge.id) : [];
  const refund = refundStateOf(charge, refunds);
  return {
    kind: "paid",
    session,
    amountRefunded: refund.succeeded,
    amountRefundPending: refund.pending,
    refundState: refund.state,
    dispute: disputeStateOf(charge, disputes),
  };
}

export async function inspectSessions(
  stripe: StripeApi,
  sessions: StripeCheckoutSession[],
  livemode: boolean,
  nowMs: number,
  emailSha256: string,
): Promise<InspectedSession[]> {
  const inspected: InspectedSession[] = [];
  for (const session of sessions) {
    inspected.push(await inspectSession(stripe, session, livemode, nowMs, emailSha256));
  }
  return inspected;
}

export function blockingError(
  status: ReservationStatus,
): "already_paid" | "refunded" | "partially_refunded" | "refund_pending" | "disputed" | null {
  if (status === "paid") return "already_paid";
  if (status === "refunded") return "refunded";
  if (status === "partially_refunded") return "partially_refunded";
  if (status === "refund_pending") return "refund_pending";
  if (status === "disputed") return "disputed";
  return null;
}
