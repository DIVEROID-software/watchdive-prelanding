// How many people are on the pre-launch list, and how close that is to the cap.
//
// The number shown publicly is a factual claim, so it is assembled from two
// parts that can each be pointed at a source rather than one hard-coded total:
//
//   off-platform baseline  — signups collected before this page existed
//   live count             — confirmed rows this page itself produced
//
// Kept free of path-alias imports so `npm test` can load it directly.

/**
 * Signups gathered through other channels before this page went live.
 *
 * Stated by the founder on 2026-07-30 and recorded in `docs/06-decision-log.md`.
 * It is a constant, not a drifting estimate: if the underlying figure is ever
 * restated, change it here so the public number always has one provenance.
 */
export const OFF_PLATFORM_BASELINE = 26_321;

/** The advertised ceiling. Reaching it must actually close signups. */
export const WAITLIST_CAP = 30_000;

/** Below this many spots left, the UI leans harder on scarcity. */
export const LOW_REMAINING_THRESHOLD = 5_000;

export type WaitlistProgress = {
  total: number;
  cap: number;
  remaining: number;
  /** 0–100, already clamped, safe to drop straight into a style width. */
  percent: number;
  full: boolean;
};

function safeCount(liveCount: number | null | undefined): number {
  if (typeof liveCount !== "number" || !Number.isFinite(liveCount) || liveCount < 0) return 0;
  return Math.floor(liveCount);
}

/**
 * The public figure. A live count that somehow overshoots the cap is clamped
 * rather than shown, so the bar can never render past full or claim a negative
 * number of remaining spots.
 */
export function waitlistProgress(
  liveCount: number | null | undefined,
  baseline: number = OFF_PLATFORM_BASELINE,
  cap: number = WAITLIST_CAP,
): WaitlistProgress {
  const total = Math.min(baseline + safeCount(liveCount), cap);
  const remaining = Math.max(0, cap - total);
  const percent = cap > 0 ? Math.min(100, Math.max(0, (total / cap) * 100)) : 0;
  return { total, cap, remaining, percent, full: remaining === 0 };
}

/**
 * Whether the list must stop accepting.
 *
 * A cap that is only ever drawn is invented scarcity: the page says places run
 * out, so places have to actually run out. This is the predicate the form and
 * the server both read, so the drawn bar and the accepted signup can never
 * disagree.
 */
export function waitlistClosed(
  liveCount: number | null | undefined,
  baseline: number = OFF_PLATFORM_BASELINE,
  cap: number = WAITLIST_CAP,
): boolean {
  return waitlistProgress(liveCount, baseline, cap).full;
}

/** `26,321` — grouped for readability, in the page's own locale-free form. */
export function formatCount(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}
