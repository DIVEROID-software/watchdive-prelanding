// Schedule for the original tab's wait on a confirmation.
//
// The naive version — a fixed 2-second interval for five minutes — costs 150
// Notion reads per waiting tab, keeps firing in a backgrounded tab nobody is
// looking at, and can stack requests when one is slower than the interval.
// This backs off instead: twelve polls, spread over roughly five minutes,
// jittered so a crowd arriving together does not stay in lockstep.
//
// The first delay is 8s rather than something snappier because the opening
// poll is the one every waiting tab makes at once. Twenty tabs on a 2s opener
// is an 8-13 req/s first wave, which is already over Notion's average quota
// before anyone has confirmed anything; at 8s the same crowd lands inside it.
// A confirmation takes a person tens of seconds to perform anyway, so nothing
// is lost by not asking in the first few.
//
// Kept free of path-alias imports so `npm test` can load it directly.

/** Total polls one waiting tab may ever make. */
export const VERIFY_POLL_MAX_ATTEMPTS = 12;

const FIRST_DELAY_MS = 8000;
const BACKOFF_FACTOR = 1.6;
const MAX_DELAY_MS = 30_000;

/** Fraction of a delay that jitter may add or remove. */
const JITTER = 0.25;

/**
 * Delay before poll number `attempt` (1-based). Exponential up to a ceiling,
 * then flat, with symmetric jitter around each step.
 *
 * `random` is injected so the schedule is testable; it must return [0, 1).
 */
export function nextPollDelayMs(attempt: number, random: () => number = Math.random): number {
  const step = Math.max(1, attempt);
  const base = Math.min(FIRST_DELAY_MS * BACKOFF_FACTOR ** (step - 1), MAX_DELAY_MS);
  // random() - 0.5 spreads the result across ±JITTER of the base delay, so two
  // tabs that submitted in the same second drift apart instead of arriving
  // together on every subsequent poll.
  return Math.max(500, Math.round(base * (1 + (random() - 0.5) * 2 * JITTER)));
}

/** Total wall-clock the schedule covers with no jitter, for documentation and tests. */
export function totalScheduleMs(attempts = VERIFY_POLL_MAX_ATTEMPTS): number {
  let total = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    total += nextPollDelayMs(attempt, () => 0.5);
  }
  return total;
}
