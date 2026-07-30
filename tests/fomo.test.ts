// The countdown, the progress bar and the review set. All three make a public
// factual claim, so the arithmetic behind them is tested rather than trusted.
import assert from "node:assert/strict";
import { test } from "node:test";

import { BETA_REVIEWS, PUBLISHABLE_REVIEWS } from "../src/data/beta-reviews.ts";
import { BETA_REVIEWS_KO } from "../src/data/beta-reviews.ko.ts";
import { countdownFrom, KICKSTARTER_LAUNCH_MS, pad2 } from "../src/lib/launch.ts";
import {
  formatCount,
  OFF_PLATFORM_BASELINE,
  WAITLIST_CAP,
  waitlistClosed,
  waitlistProgress,
} from "../src/lib/waitlistProgress.ts";

// --- countdown -------------------------------------------------------------

test("the countdown splits the remaining time into whole units", () => {
  const target = Date.parse("2026-08-10T00:00:00.000Z");
  const now = Date.parse("2026-08-07T21:45:30.000Z");

  assert.deepEqual(countdownFrom(now, target), {
    days: 2,
    hours: 2,
    minutes: 14,
    seconds: 30,
    launched: false,
  });
});

test("the countdown reads zero and launched once the date passes", () => {
  const target = Date.parse("2026-08-10T00:00:00.000Z");

  // A timer that ticks into negative numbers is worse than a changed message.
  for (const now of [target, target + 1, target + 86_400_000]) {
    assert.deepEqual(countdownFrom(now, target), {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      launched: true,
    });
  }
});

test("the launch instant is the announced date", () => {
  assert.equal(new Date(KICKSTARTER_LAUNCH_MS).toISOString(), "2026-08-10T00:00:00.000Z");
});

test("units are padded so the row does not jitter", () => {
  assert.equal(pad2(0), "00");
  assert.equal(pad2(7), "07");
  assert.equal(pad2(42), "42");
});

// --- waitlist progress -----------------------------------------------------

test("the public figure is the recorded baseline plus the live count", () => {
  const progress = waitlistProgress(4);
  assert.equal(progress.total, OFF_PLATFORM_BASELINE + 4);
  assert.equal(progress.remaining, WAITLIST_CAP - OFF_PLATFORM_BASELINE - 4);
  assert.equal(progress.cap, WAITLIST_CAP);
  assert.equal(progress.full, false);
});

test("a missing or nonsense live count degrades to the baseline alone", () => {
  for (const bad of [undefined, null, Number.NaN, -12, Infinity]) {
    assert.equal(waitlistProgress(bad).total, OFF_PLATFORM_BASELINE);
  }
});

test("the bar can never exceed the cap or promise negative spots", () => {
  const over = waitlistProgress(WAITLIST_CAP * 2);
  assert.equal(over.total, WAITLIST_CAP);
  assert.equal(over.remaining, 0);
  assert.equal(over.percent, 100);
  assert.equal(over.full, true);
});

test("the percentage stays inside 0–100", () => {
  for (const count of [0, 1, 1_000, WAITLIST_CAP, WAITLIST_CAP * 10]) {
    const { percent } = waitlistProgress(count);
    assert.ok(percent >= 0 && percent <= 100, `percent out of range: ${percent}`);
  }
});

// A cap the page draws but never enforces is invented scarcity. The predicate
// the submit gate reads has to flip at exactly the point the bar fills.
test("the list closes exactly when the bar fills", () => {
  const roomLeft = WAITLIST_CAP - OFF_PLATFORM_BASELINE;
  assert.equal(waitlistClosed(roomLeft - 1), false);
  assert.equal(waitlistClosed(roomLeft), true);
  assert.equal(waitlistClosed(roomLeft + 1_000), true);
  assert.equal(waitlistProgress(roomLeft).full, waitlistClosed(roomLeft));
});

test("counts are grouped for reading", () => {
  assert.equal(formatCount(26_321), "26,321");
  assert.equal(formatCount(30_000), "30,000");
});

// --- reviews ---------------------------------------------------------------

test("every review carries an attributable identity and both languages", () => {
  for (const review of BETA_REVIEWS) {
    assert.ok(review.name.trim().length > 0, `review ${review.id} has no name`);
    assert.ok(review.city.trim().length > 0, `review ${review.id} has no city`);
    assert.ok(review.en.trim().length > 0, `review ${review.id} has no English text`);
    assert.ok(
      (BETA_REVIEWS_KO[review.id] ?? "").trim().length > 0,
      `review ${review.id} has no Korean copy`,
    );
    assert.ok(review.rating === 4 || review.rating === 5, `review ${review.id} rating`);
  }
});

// The Korean copy is a separate module so the English page never ships it.
// That only holds if the two stay joinable on id.
test("every review has Korean copy, and the Korean module carries nothing else", () => {
  assert.equal(Object.keys(BETA_REVIEWS_KO).length, BETA_REVIEWS.length);
  const ids = new Set(BETA_REVIEWS.map((review) => review.id));
  for (const key of Object.keys(BETA_REVIEWS_KO)) {
    assert.ok(ids.has(Number(key)), `Korean copy ${key} matches no review`);
  }
});

test("review ids are unique", () => {
  const ids = new Set(BETA_REVIEWS.map((review) => review.id));
  assert.equal(ids.size, BETA_REVIEWS.length);
});

// A testimonial we publish is our own advertising claim. Anything asserting a
// price, an algorithm or a safety feature that `docs/01-product-truth.md` still
// lists as unconfirmed stays out until it has evidence.
test("reviews asserting unverified product claims are withheld by default", () => {
  const withheld = BETA_REVIEWS.filter((review) => review.unverifiedClaim);
  assert.ok(withheld.length > 0, "expected the claims gate to be holding something back");

  for (const review of withheld) {
    assert.ok(
      !PUBLISHABLE_REVIEWS.includes(review),
      `review ${review.id} carries an unverified claim but is publishable`,
    );
  }
  assert.equal(PUBLISHABLE_REVIEWS.length, BETA_REVIEWS.length - withheld.length);
});
