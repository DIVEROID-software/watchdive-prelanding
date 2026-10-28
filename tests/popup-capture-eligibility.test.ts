import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAPTURE_MIN_ELAPSED_MS,
  desktopExitAllowed,
  evaluateCaptureOpen,
  latchAfterOpen,
  previewTouchFixtureActive,
  readCaptureSuppressed,
  readPointerSignals,
  resolveCaptureSignals,
  scheduleMobileDwellRetry,
  usesMobileScrollTrigger,
  type CapturePointerSignals,
} from "../src/components/retargeting/capture-eligibility.ts";
import { type CaptureFacts } from "../src/components/retargeting/policy.ts";

const fine: CapturePointerSignals = { fineHover: true };
const coarse: CapturePointerSignals = { fineHover: false };
const clear: CaptureFacts = {
  knownSignup: false,
  paid: false,
  seen: false,
  dismissed: false,
  activeForm: false,
  dialog: false,
  playingVideo: false,
  fullscreen: false,
  hidden: false,
};

function open(kind: "mobile-scroll" | "desktop-exit", patch: Record<string, unknown> = {}) {
  return evaluateCaptureOpen({
    kind,
    signals: coarse,
    facts: clear,
    elapsedMs: CAPTURE_MIN_ELAPSED_MS,
    progress: 0.5,
    clientY: 0,
    relatedTarget: false,
    suppressed: false,
    ...patch,
  });
}

test("original pointer policy is one media query and is not a viewport-width rule", () => {
  const helper = readFileSync(
    new URL("../src/components/retargeting/capture-eligibility.ts", import.meta.url),
    "utf8",
  );
  assert.equal(helper.includes("any-pointer"), false);
  assert.equal(helper.includes("hover: none"), false);
  assert.equal(helper.includes("pointer: coarse"), false);
  assert.equal(readPointerSignals((query) => query.includes("pointer: fine")).fineHover, true);
  assert.equal(usesMobileScrollTrigger(coarse), true);
  assert.equal(desktopExitAllowed(coarse), false);
  assert.equal(usesMobileScrollTrigger(fine), false);
  assert.equal(desktopExitAllowed(fine), true);
  assert.equal(open("mobile-scroll", { signals: fine, progress: 1, elapsedMs: 60_000 }), false);
  assert.equal(
    open("desktop-exit", { signals: fine, elapsedMs: 0, clientY: 0, relatedTarget: false }),
    true,
  );
  assert.equal(open("desktop-exit", { signals: coarse, clientY: 0 }), false);
});

test("mobile opens around halfway only after the dwell", () => {
  assert.equal(open("mobile-scroll", { progress: 0.49 }), false);
  assert.equal(
    open("mobile-scroll", { progress: 0.5, elapsedMs: CAPTURE_MIN_ELAPSED_MS - 1 }),
    false,
  );
  assert.equal(open("mobile-scroll", { progress: 0.5, elapsedMs: CAPTURE_MIN_ELAPSED_MS }), true);
  assert.equal(open("mobile-scroll", { progress: 1, elapsedMs: 0 }), false);
  assert.equal(open("desktop-exit", { signals: fine, elapsedMs: 0, clientY: 1 }), false);
});

test("a touch visit already past halfway gets one dwell retry, and nothing else does", () => {
  const waiting = {
    mobile: true,
    progress: 0.5,
    elapsedMs: 400,
    suppressed: false,
    knownSignup: false,
    paid: false,
    seen: false,
    alreadyScheduled: false,
  };
  assert.equal(scheduleMobileDwellRetry(waiting), CAPTURE_MIN_ELAPSED_MS - 400);
  assert.equal(scheduleMobileDwellRetry({ ...waiting, mobile: false }), null);
  assert.equal(scheduleMobileDwellRetry({ ...waiting, progress: 0.49 }), null);
  assert.equal(scheduleMobileDwellRetry({ ...waiting, elapsedMs: CAPTURE_MIN_ELAPSED_MS }), null);
  assert.equal(scheduleMobileDwellRetry({ ...waiting, knownSignup: true }), null);
  assert.equal(scheduleMobileDwellRetry({ ...waiting, paid: true }), null);
  assert.equal(scheduleMobileDwellRetry({ ...waiting, seen: true }), null);
  assert.equal(scheduleMobileDwellRetry({ ...waiting, suppressed: true }), null);
  assert.equal(scheduleMobileDwellRetry({ ...waiting, alreadyScheduled: true }), null);
});

test("signup, payment, dismiss, and a stored session each block both arms", () => {
  for (const facts of [
    { ...clear, knownSignup: true },
    { ...clear, paid: true },
    { ...clear, dismissed: true },
    { ...clear, activeForm: true },
  ]) {
    assert.equal(open("mobile-scroll", { facts }), false);
    assert.equal(open("desktop-exit", { signals: fine, facts, clientY: 0 }), false);
  }
  assert.equal(open("mobile-scroll", { suppressed: true }), false);
  assert.equal(
    readCaptureSuppressed(() => "shown"),
    true,
  );
  assert.equal(
    readCaptureSuppressed(() => "dismissed"),
    true,
  );
  assert.equal(
    readCaptureSuppressed(() => null),
    false,
  );
  assert.equal(
    readCaptureSuppressed(() => {
      throw new Error("storage blocked");
    }),
    true,
  );
});

test("a blocked dialog does not consume the only chance; a shown dialog does", () => {
  assert.deepEqual(latchAfterOpen("blocked"), { seen: false, persist: null });
  assert.deepEqual(latchAfterOpen("shown"), { seen: true, persist: "shown" });
  const source = readFileSync(
    new URL("../src/components/retargeting/ExitIntentCapture.tsx", import.meta.url),
    "utf8",
  );
  const show = source.indexOf("node.showModal()");
  const persist = source.indexOf("sessionStorage.setItem(CAPTURE_SESSION_KEY, latch.persist)");
  assert.ok(show > 0 && persist > show);
  assert.equal(source.includes('sessionStorage.setItem(CAPTURE_SESSION_KEY, "shown")'), false);
  assert.equal(source.includes("setInterval"), false);
  assert.equal(source.includes("scheduleMobileDwellRetry"), true);
});

test("qaTouch forces the touch path only when the preview flag is compiled", () => {
  const forced = resolveCaptureSignals(fine, previewTouchFixtureActive("?qaTouch=1", "1"));
  assert.equal(usesMobileScrollTrigger(forced), true);
  assert.equal(desktopExitAllowed(forced), false);
  assert.equal(open("mobile-scroll", { signals: forced, progress: 0.5 }), true);
  assert.equal(previewTouchFixtureActive("?qaTouch=1", undefined), false);
  assert.equal(previewTouchFixtureActive("?qaTouch=1", ""), false);
  assert.equal(previewTouchFixtureActive("", "1"), false);
  assert.equal(usesMobileScrollTrigger(resolveCaptureSignals(fine, false)), false);
});
