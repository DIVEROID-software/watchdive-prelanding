// When a verified person may be invited.
//
// The clock is `Verified at` plus three minutes. Signup time, the Notion
// `Signed up` cell, and created_time are not this clock. A missing or unusable
// timestamp is not eligible. A date-only value is unusable because its
// timezone is ambiguous. A prospective start is required before any send so a
// tick cannot mail the historical backlog.
import type { ReservationRow, SkipReason } from "./audience.ts";

/** Three minutes. Eligible at this many milliseconds after Verified at, not before. */
export const RESERVATION_INVITE_DELAY_MS = 180_000;

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export type MailSchedule = {
  nowMs: number;
  /**
   * Epoch milliseconds. Rows verified before this instant are historic and
   * are not invited. Omit it and no row is invited.
   */
  notBeforeMs?: number;
};

export function parseVerifiedInstant(
  value: string,
): { ok: true; ms: number } | { ok: false } {
  const trimmed = value.trim();
  if (!INSTANT.test(trimmed)) return { ok: false };
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return { ok: false };
  return { ok: true, ms };
}

/**
 * Why this row is not yet invitable. Call it only after the static
 * reservation checks have passed. `undefined` means the delay and the
 * prospective start both allow this row at `schedule.nowMs`.
 */
export function delaySkipReason(
  row: Pick<ReservationRow, "verifiedAt">,
  schedule: MailSchedule,
): SkipReason | undefined {
  if (row.verifiedAt === undefined || row.verifiedAt.trim() === "") return "missing_verified_at";
  const parsed = parseVerifiedInstant(row.verifiedAt);
  if (!parsed.ok) return "invalid_verified_at";
  if (schedule.notBeforeMs === undefined) {
    if (parsed.ms + RESERVATION_INVITE_DELAY_MS > schedule.nowMs) return "not_due";
    return "cutoff_unconfigured";
  }
  if (parsed.ms < schedule.notBeforeMs) return "before_cutoff";
  if (parsed.ms + RESERVATION_INVITE_DELAY_MS > schedule.nowMs) return "not_due";
  return undefined;
}
