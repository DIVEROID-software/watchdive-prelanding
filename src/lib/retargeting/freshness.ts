// Meta deduplicates the same event name and event id for about 48 hours.
// A later send with a new event_time can count again. These helpers keep the
// original occurrence time and refuse anything outside that window.

export const RETARGETING_FRESHNESS_SECONDS = 48 * 60 * 60;
export const RETARGETING_CLOCK_SKEW_SECONDS = 300;

export function retargetingEventIsFresh(
  eventTime: number | null | undefined,
  nowSeconds: number,
): boolean {
  if (typeof eventTime !== "number" || !Number.isInteger(eventTime) || eventTime < 0) return false;
  if (typeof nowSeconds !== "number" || !Number.isInteger(nowSeconds)) return false;
  if (eventTime > nowSeconds + RETARGETING_CLOCK_SKEW_SECONDS) return false;
  if (nowSeconds - eventTime > RETARGETING_FRESHNESS_SECONDS) return false;
  return true;
}

/** "stale" is too old. "future" is past the skew allowance. "paid_at" is missing. */
export function retargetingTimeReason(
  eventTime: number | null | undefined,
  nowSeconds: number,
): "ok" | "stale" | "future" | "missing" {
  if (eventTime == null) return "missing";
  if (typeof eventTime !== "number" || !Number.isInteger(eventTime) || eventTime < 0) return "missing";
  if (typeof nowSeconds !== "number" || !Number.isInteger(nowSeconds)) return "stale";
  if (eventTime > nowSeconds + RETARGETING_CLOCK_SKEW_SECONDS) return "future";
  if (nowSeconds - eventTime > RETARGETING_FRESHNESS_SECONDS) return "stale";
  return "ok";
}
