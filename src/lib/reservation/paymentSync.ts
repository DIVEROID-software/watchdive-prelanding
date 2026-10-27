// Classifies a Stripe reservation snapshot against the signup mirror.
// This does not charge, refund, replay a webhook, or write Notion.
import { createHash } from "node:crypto";

import { reservationMirrorRequiresLead, type ReservationNotionView } from "./notionMirror.ts";
import { isPriceGuaranteeEligible, type ReservationSnapshot } from "./state.ts";

export function paymentFingerprint(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex").slice(0, 12);
}

export type PaymentSyncClass =
  | "livemode_mismatch"
  | "not_reservation"
  | "not_bound"
  | "unaddressed"
  | "lead_missing"
  | "skipped_no_lead"
  | "in_sync"
  | "notion_stale";

export type PaymentSyncDecision = {
  classification: PaymentSyncClass;
  httpStatus: number;
  retryable: boolean;
  /** True only when an already-found signup row differs and a later repair could patch it. */
  wouldWrite: boolean;
  priceGuaranteeEligible: boolean;
};

function sameMoney(snapshot: ReservationSnapshot, view: ReservationNotionView): boolean {
  return (
    view.status === snapshot.status &&
    view.paid === snapshot.paid &&
    view.refundedCents === snapshot.amountRefunded &&
    view.refundPendingCents === snapshot.amountRefundPending &&
    view.duplicatePaid === snapshot.duplicatePaid &&
    view.sessionId === snapshot.sessionId
  );
}

function viewMatches(
  snapshot: ReservationSnapshot,
  view: ReservationNotionView,
  mode: "test" | "live",
): boolean {
  if (view.mode !== mode) return false;
  if (reservationMirrorRequiresLead(snapshot)) return sameMoney(snapshot, view);
  return view.status === snapshot.status && view.paid === snapshot.paid && view.duplicatePaid === false;
}

/**
 * Decides what the webhook would do with this snapshot, and whether Notion
 * already shows it. A missing signup row is not a page create. `wouldWrite`
 * is a dry-run signal for an existing row that is behind Stripe.
 */
export function classifyPaymentSync(input: {
  ourProduct: boolean;
  bound: boolean;
  livemodeMatches: boolean;
  addressed: boolean;
  snapshot: ReservationSnapshot;
  leads: ReservationNotionView[];
  mode: "test" | "live";
}): PaymentSyncDecision {
  const eligible =
    input.ourProduct && input.bound && input.livemodeMatches && input.addressed
      ? isPriceGuaranteeEligible(input.snapshot)
      : false;
  const idle = {
    priceGuaranteeEligible: false,
    wouldWrite: false,
    retryable: false,
  };
  if (!input.livemodeMatches) {
    return { ...idle, classification: "livemode_mismatch", httpStatus: 200 };
  }
  if (!input.ourProduct) {
    return { ...idle, classification: "not_reservation", httpStatus: 200 };
  }
  if (!input.bound) {
    return { ...idle, classification: "not_bound", httpStatus: 200 };
  }
  if (!input.addressed) {
    if (reservationMirrorRequiresLead(input.snapshot)) {
      return {
        classification: "unaddressed",
        httpStatus: 500,
        retryable: true,
        wouldWrite: false,
        priceGuaranteeEligible: false,
      };
    }
    return { ...idle, classification: "skipped_no_lead", httpStatus: 200 };
  }
  if (input.leads.length === 0) {
    if (reservationMirrorRequiresLead(input.snapshot)) {
      return {
        classification: "lead_missing",
        httpStatus: 500,
        retryable: true,
        wouldWrite: false,
        priceGuaranteeEligible: eligible,
      };
    }
    return {
      classification: "skipped_no_lead",
      httpStatus: 200,
      retryable: false,
      wouldWrite: false,
      priceGuaranteeEligible: eligible,
    };
  }
  const synced = input.leads.every((view) => viewMatches(input.snapshot, view, input.mode));
  if (synced) {
    return {
      classification: "in_sync",
      httpStatus: 200,
      retryable: false,
      wouldWrite: false,
      priceGuaranteeEligible: eligible,
    };
  }
  return {
    classification: "notion_stale",
    httpStatus: 200,
    retryable: false,
    wouldWrite: true,
    priceGuaranteeEligible: eligible,
  };
}
