// Who may receive a personal reservation link from the public return form.
// The form never proves an account. Paid, refunded, held, and unsubscribed
// inboxes are suppressed. A previous campaign send is not a suppression:
// the person is asking again because that link is not in this browser.
// This module does not write a lead, mint a signup, or read Stripe.
import { IDEMPOTENCY_WINDOW_MS } from "../reservation-mail/campaign.ts";
import { parseReservationMarker } from "../reservation-mail/campaign.ts";
import { reservationLocale } from "../reservation-mail/audience.ts";
import { parseLaunchMarker } from "../launchMail/audience.ts";
import { conversionBlocked } from "../verification/contracts.ts";
import { isLeadId } from "../verification/token.ts";
import { reservationCanonicalEmail } from "./emailIdentity.ts";
import { isReservationEmail } from "./invite.ts";
import type { ReservationPaymentState } from "../reservation-mail/audience.ts";
import type { Locale } from "../i18n/locale.ts";

/** One provider idempotency bucket. Resend keeps a key for 24h; this stays inside that. */
export const RETURN_WINDOW_MS = IDEMPOTENCY_WINDOW_MS;

const BLOCKED_MIRROR = new Set([
  "paid",
  "refunded",
  "partially_refunded",
  "refund_pending",
  "disputed",
]);

export type ReturnAccount = {
  leadId: string;
  email: string;
  status: string;
  emailVerified: boolean;
  suspect: boolean;
  duplicate: boolean;
  flags: string[];
  launchMail?: string;
  reservationMail?: string;
  landingPath?: string;
  browserLanguage?: string;
  locale?: string;
  signupCountry?: string;
  /** Read only. The return flow never writes this. */
  verifiedAt?: string;
  payment: ReservationPaymentState;
  /** Live `Reservation status` select. Null when the column or cell is absent. */
  mirrorStatus: string | null;
  refundedCents: number | null;
  refundPendingCents: number | null;
  /** Live `Reservation dispute` select. Null when absent. */
  dispute: string | null;
};

export type ReturnRowDecision = "send" | "poison" | "skip";

export function returnWindowBucket(nowMs: number, windowMs = RETURN_WINDOW_MS): number {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("Invalid return clock");
  return Math.floor(nowMs / windowMs);
}

export function returnWindowStartMs(bucket: number, windowMs = RETURN_WINDOW_MS): number {
  if (!Number.isSafeInteger(bucket) || bucket < 0) throw new Error("Invalid return window");
  return bucket * windowMs;
}

/** Stable for one lead inside one window, so a replay is the same provider body. */
export function reservationReturnIdempotencyKey(leadId: string, bucket: number): string {
  return `watchdive-reservation-return-${leadId.toLowerCase()}-${bucket}`;
}

export function returnRowDecision(row: ReturnAccount): ReturnRowDecision {
  const launch = parseLaunchMarker(row.launchMail);
  const reservation = parseReservationMarker(row.reservationMail);
  if (row.status === "suppressed" || row.status === "unsubscribed") return "poison";
  if (launch.kind === "unsubscribed" || reservation.kind === "unsubscribed") return "poison";
  if (launch.kind === "unknown" || reservation.kind === "unknown") return "poison";
  if (reservation.kind === "hold") return "poison";
  if (row.payment === "live" || row.payment === "unreadable") return "poison";
  if (row.mirrorStatus && BLOCKED_MIRROR.has(row.mirrorStatus)) return "poison";
  if ((row.refundedCents ?? 0) > 0 || (row.refundPendingCents ?? 0) > 0) return "poison";
  if (row.dispute === "open") return "poison";
  if (row.suspect) return "poison";
  if (conversionBlocked(row.flags)) return "poison";
  if (row.status !== "verified" || row.emailVerified !== true) return "skip";
  if (row.duplicate) return "skip";
  if (!isLeadId(row.leadId)) return "skip";
  const email = row.email.trim().toLowerCase();
  if (!isReservationEmail(email)) return "skip";
  return "send";
}

/**
 * One verified unpaid row for this reservation inbox, or nothing.
 * Any poisoned alias suppresses the whole inbox. The stored row email is the
 * only delivery address. Gmail aliases share an inbox; other plus-tags do not.
 */
export function chooseReturnRecipient(
  rows: readonly ReturnAccount[],
  submittedEmail: string,
): ReturnAccount | null {
  const canonical = reservationCanonicalEmail(submittedEmail);
  const typed = submittedEmail.trim().toLowerCase();
  const inbox = rows.filter((row) => {
    const stored = row.email.trim().toLowerCase();
    return stored === typed || reservationCanonicalEmail(stored) === canonical;
  });
  if (inbox.length === 0) return null;
  const decisions = inbox.map((row) => returnRowDecision(row));
  if (decisions.some((decision) => decision === "poison")) return null;
  const eligible = inbox.filter((_, index) => decisions[index] === "send");
  if (eligible.length === 0) return null;
  return [...eligible].sort((left, right) => verifiedOrder(left) - verifiedOrder(right))[0] ?? null;
}

function verifiedOrder(row: ReturnAccount): number {
  const parsed = Date.parse(row.verifiedAt ?? "");
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

export function returnMailLocale(row: ReturnAccount): Locale {
  return reservationLocale({
    locale: row.locale,
    landingPath: row.landingPath,
    browserLanguage: row.browserLanguage,
    signupCountry: row.signupCountry,
  });
}
