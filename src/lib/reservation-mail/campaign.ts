// Stable identity for the reservation invitation. One campaign id, forever:
// a second send of this id is a resume, not a new mailing. A future mailing
// needs a new id in code so old receipts cannot be reused by a flag typo.
//
// Kept free of path-alias imports so `npm test` can load it directly.

export const RESERVATION_CAMPAIGN_ID = "wd-reservation-invite-v1";

/**
 * Resend keeps an idempotency key for 24h. A crash before any provider
 * outcome may resume inside this window with the same key. An unknown
 * outcome is not replayed, including after this window.
 */
export const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;

export const FAILURE_CLASSES = [
  "provider_rejected",
  "transport_error",
  "invalid_provider_response",
  "unexpected_error",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const HOLD_REASONS = ["expired_intent", "provider_conflict", "unknown_outcome"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

const ISO_TIME = "\\d{4}-\\d{2}-\\d{2}T\\S+";

export type ReservationMarker =
  | { kind: "none" }
  | { kind: "unsubscribed" }
  | { kind: "sent"; at?: string }
  | { kind: "failed"; failureClass: FailureClass; at?: string }
  | { kind: "hold"; reason: HoldReason; at?: string }
  | { kind: "unknown" };

function trailingTime(value: string): string | undefined {
  const match = /(\d{4}-\d{2}-\d{2}T\S+)$/.exec(value);
  if (!match) return undefined;
  const parsed = Date.parse(match[1]);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/**
 * Anything that is not one of the markers this job writes is "do not mail"
 * until a person looks at the cell. A hand-typed unsubscribe stops mail too.
 */
export function parseReservationMarker(raw: string | undefined): ReservationMarker {
  const value = (raw ?? "").trim();
  if (!value) return { kind: "none" };
  if (/unsub/i.test(value)) return { kind: "unsubscribed" };
  const sent = new RegExp(`^${RESERVATION_CAMPAIGN_ID} sent ${ISO_TIME}$`).exec(value);
  if (sent) return { kind: "sent", at: trailingTime(value) };
  const failed = new RegExp(
    `^${RESERVATION_CAMPAIGN_ID} failed (${FAILURE_CLASSES.join("|")}) ${ISO_TIME}$`,
  ).exec(value);
  if (failed && isFailureClass(failed[1])) {
    return { kind: "failed", failureClass: failed[1], at: trailingTime(value) };
  }
  const hold = new RegExp(
    `^${RESERVATION_CAMPAIGN_ID} hold (${HOLD_REASONS.join("|")}) ${ISO_TIME}$`,
  ).exec(value);
  if (hold && isHoldReason(hold[1])) {
    return { kind: "hold", reason: hold[1], at: trailingTime(value) };
  }
  return { kind: "unknown" };
}

export function isFailureClass(value: string): value is FailureClass {
  return (FAILURE_CLASSES as readonly string[]).includes(value);
}

export function isHoldReason(value: string): value is HoldReason {
  return (HOLD_REASONS as readonly string[]).includes(value);
}

export function sentMarker(at: Date): string {
  return `${RESERVATION_CAMPAIGN_ID} sent ${at.toISOString()}`;
}

export function failedMarker(failureClass: FailureClass, at: Date): string {
  return `${RESERVATION_CAMPAIGN_ID} failed ${failureClass} ${at.toISOString()}`;
}

export function holdMarker(reason: HoldReason, at: Date): string {
  return `${RESERVATION_CAMPAIGN_ID} hold ${reason} ${at.toISOString()}`;
}

/** Same key for every attempt of this campaign and lead. A retry cannot fork. */
export function reservationIdempotencyKey(leadId: string): string {
  return `watchdive-reservation-${RESERVATION_CAMPAIGN_ID}-${leadId.toLowerCase()}`;
}

export function withinIdempotencyWindow(firstIntentAtIso: string, now: Date): boolean {
  const started = Date.parse(firstIntentAtIso);
  if (Number.isNaN(started)) return false;
  return now.getTime() - started <= IDEMPOTENCY_WINDOW_MS;
}
