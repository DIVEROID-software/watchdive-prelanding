// Internal audience facts for one signup row and its current payment snapshot.
// C is every canonical signup, including an unverified row. That fact is the
// acquisition exclusion and stays on the row after a privacy refusal.
// B is a canonical signup with no $3 payment and no payment hold. An
// unverified signup is still B. Payment ads use B only when upload is allowed.
// Measurement withdrawal, measurement denial, and unsubscribe block platform
// upload and payment ads. Callers set measurementWithdrawn for both a
// withdrawal and a denial. This module does not read the raw consent cell.
// D is a clean Stripe USD 3 only. That is the only Purchase proof. A refund,
// dispute, other Stripe history, Notion paid flag, success URL, or unknown
// snapshot does not prove D. Those holds stop payment ads and payment drip.
// Reservation-mail eligibility is a separate hint: verified, still clear-unpaid,
// and not unsubscribed. It is not a send. The reservation-mail module decides
// delivery and does not read measurement consent.
// A and A1 are browser audiences. They have no signup row to export.
// Notion's paid checkbox and the success URL are not payment proof.

import { signupLocaleOrNull } from "./constants.ts";
import type { Locale } from "../i18n/locale.ts";
import { RESERVATION_CURRENCY, RESERVATION_FEE_CENTS } from "../reservation/constants.ts";
import type { PurchaseEvidence } from "./events.ts";

export type AudiencePayment = {
  evidence: PurchaseEvidence;
  status: string;
  paid: boolean;
  amountCents: number | null;
  currency: string | null;
  refundedCents: number;
  refundPendingCents: number;
  disputed: boolean;
};

export type AudiencePerson = {
  durableSignup: boolean;
  verified: boolean;
  duplicateRow: boolean;
  abusive: boolean;
  suspect: boolean;
  unsubscribed: boolean;
  /**
   * Measurement withdrawn or denied on the row. Does not erase the signup.
   * Callers fold a withheld or denied choice into this flag with withdrawal.
   */
  measurementWithdrawn: boolean;
  signupLocale?: string | null;
  payment: AudiencePayment;
};

export type AudienceLabel = "B" | "C" | "D" | "payment_hold" | "excluded";

export type AudienceDripReason = "paid" | "payment_hold";

export type AudienceDecision = {
  /** False means this row must not be written to an ad-platform customer file. */
  upload: boolean;
  /** Internal signup fact. True for every canonical row, including a refusal. */
  acquisitionExclusion: boolean;
  /** Internal B. Includes an unverified signup. Opt-out does not erase it. */
  internalUnpaidSignup: boolean;
  /** Payment-ad eligibility. Internal B and allowed to upload. */
  paymentRetargeting: boolean;
  /** Clean Stripe USD 3 on a canonical row. This is label D and the only Purchase proof. */
  paidSuppression: boolean;
  /** Stop payment ads because of D or a payment hold. Opt-out is upload, not this flag. */
  paymentAdsSuppressed: boolean;
  /** Refund, dispute, other Stripe history, Notion, success URL, or unknown. Never D. */
  paymentHold: boolean;
  /** Stop payment-solicitation drip for D or a hold. Unsubscribe is a separate mail gate. */
  dripSuppressed: boolean;
  /** "paid" is clean Stripe proof. "payment_hold" stops drip without proving a purchase. */
  dripReason: AudienceDripReason | null;
  /**
   * Hint only: verified, clear-unpaid, and not unsubscribed. Measurement refusal
   * is not an input. This does not send mail and does not replace reservation-mail.
   */
  reservationEmailEligible: boolean;
  verified: boolean;
  signupLocale: Locale | null;
  labels: AudienceLabel[];
};

export function cleanStripePaid(payment: AudiencePayment): boolean {
  return (
    payment.evidence === "stripe_inspection" &&
    payment.status === "paid" &&
    payment.paid === true &&
    payment.amountCents === RESERVATION_FEE_CENTS &&
    (payment.currency ?? "").toLowerCase() === RESERVATION_CURRENCY &&
    payment.refundedCents === 0 &&
    payment.refundPendingCents === 0 &&
    payment.disputed === false
  );
}

/** A snapshot that is still able to pay the reservation fee. Every other snapshot holds. */
function clearUnpaid(payment: AudiencePayment): boolean {
  if (
    payment.paid ||
    payment.disputed ||
    payment.refundedCents !== 0 ||
    payment.refundPendingCents !== 0
  ) {
    return false;
  }
  if (payment.evidence === "none") return payment.status === "none" || payment.status === "unpaid";
  if (payment.evidence !== "stripe_inspection") return false;
  return payment.status === "unpaid" || payment.status === "open";
}

function canonicalSignup(person: AudiencePerson): boolean {
  return person.durableSignup && !person.abusive && !person.suspect && !person.duplicateRow;
}

export function classifyAudience(person: AudiencePerson): AudienceDecision {
  const signupLocale = signupLocaleOrNull(person.signupLocale);
  if (!canonicalSignup(person)) {
    return {
      upload: false,
      acquisitionExclusion: false,
      internalUnpaidSignup: false,
      paymentRetargeting: false,
      paidSuppression: false,
      paymentAdsSuppressed: false,
      paymentHold: false,
      dripSuppressed: false,
      dripReason: null,
      reservationEmailEligible: false,
      verified: false,
      signupLocale,
      labels: person.durableSignup ? ["excluded"] : [],
    };
  }

  const purchaseProven = cleanStripePaid(person.payment);
  const unpaid = clearUnpaid(person.payment);
  const hold = !purchaseProven && !unpaid;
  const platformBlocked = person.unsubscribed || person.measurementWithdrawn;
  const labels: AudienceLabel[] = ["C"];
  if (purchaseProven) labels.push("D");
  else if (hold) labels.push("payment_hold");
  else labels.push("B");

  return {
    upload: !platformBlocked,
    acquisitionExclusion: true,
    internalUnpaidSignup: unpaid,
    paymentRetargeting: unpaid && !platformBlocked,
    paidSuppression: purchaseProven,
    paymentAdsSuppressed: !unpaid,
    paymentHold: hold,
    dripSuppressed: !unpaid,
    dripReason: purchaseProven ? "paid" : hold ? "payment_hold" : null,
    reservationEmailEligible: unpaid && person.verified && !person.unsubscribed,
    verified: person.verified,
    signupLocale,
    labels,
  };
}

/**
 * Root's payment stop for D0/D1/D3/D7. True for a clean Stripe USD 3 and for
 * every payment hold, including a refund, a dispute, a Notion flag, a success
 * URL, and an unknown snapshot. False does not authorize a send.
 */
export function paidDripSuppressed(person: AudiencePerson): boolean {
  return classifyAudience(person).dripSuppressed;
}

/**
 * Visitors who have not created a durable signup.
 * A is no form start. A1 is form start without a signup. Neither is an upload row.
 */
export function classifyBrowserVisitor(input: {
  durableSignup: boolean;
  formStarted: boolean;
}): "A" | "A1" | null {
  if (input.durableSignup) return null;
  return input.formStarted ? "A1" : "A";
}
