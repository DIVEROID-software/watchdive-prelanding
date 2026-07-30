// The Kickstarter launch instant and the countdown arithmetic.
//
// Kept pure and free of path-alias imports so `npm test` can load it directly:
// a countdown that is wrong is a promise broken in public, so the maths is
// tested rather than eyeballed in a browser.

/**
 * Fixed by the founder on 2026-07-30. The hour is the part still worth a second
 * look — it decides what "2 days left" flips to midnight in — and changing it
 * is a one-line edit here rather than a hunt through components.
 */
export const KICKSTARTER_LAUNCH_ISO = "2026-08-10T00:00:00.000Z";

export const KICKSTARTER_LAUNCH_MS = Date.parse(KICKSTARTER_LAUNCH_ISO);

export type Countdown = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** True once the launch instant has passed. Every field is 0 from then on. */
  launched: boolean;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Remaining time split into whole units. Never returns a negative field: once
 * the date passes the countdown reads all zeros and `launched`, so the UI can
 * swap its message instead of rendering a growing negative number.
 */
export function countdownFrom(nowMs: number, targetMs: number = KICKSTARTER_LAUNCH_MS): Countdown {
  const remaining = targetMs - nowMs;
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, launched: true };
  }
  return {
    days: Math.floor(remaining / DAY),
    hours: Math.floor((remaining % DAY) / HOUR),
    minutes: Math.floor((remaining % HOUR) / MINUTE),
    seconds: Math.floor((remaining % MINUTE) / SECOND),
    launched: false,
  };
}

/** Two digits everywhere, so the row does not jitter as numbers shrink. */
export function pad2(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(2, "0");
}
