import { shouldOpenCapture, type CaptureFacts, type CaptureTrigger } from "./policy.ts";

/** Mobile must not open on the first paint when scroll is already past halfway. Desktop exit has no clock. */
export const CAPTURE_MIN_ELAPSED_MS = 2_000;

/** Original production pointer: `(hover: hover) and (pointer: fine)`. Width is not a trigger. */
export type CapturePointerSignals = {
  fineHover: boolean;
};

export type CaptureAttemptKind = "mobile-scroll" | "desktop-exit";

export function usesMobileScrollTrigger(signals: CapturePointerSignals): boolean {
  return !signals.fineHover;
}

export function desktopExitAllowed(signals: CapturePointerSignals): boolean {
  return signals.fineHover;
}

export function readPointerSignals(match: (query: string) => boolean): CapturePointerSignals {
  return { fineHover: match("(hover: hover) and (pointer: fine)") };
}

/** Compiled only by the serve-only popup preview. Production leaves the flag unset. */
export function previewTouchFixtureActive(search: string, flag?: string): boolean {
  let compiled = flag;
  if (compiled === undefined) {
    try {
      compiled = import.meta.env.VITE_WD_PREVIEW_CAPTURE;
    } catch {
      compiled = undefined;
    }
  }
  if (compiled !== "1") return false;
  try {
    return new URLSearchParams(search).get("qaTouch") === "1";
  } catch {
    return false;
  }
}

/** Preview fixture only. A measured fine pointer is returned unchanged. */
export function resolveCaptureSignals(
  measured: CapturePointerSignals,
  touchFixture: boolean,
): CapturePointerSignals {
  if (!touchFixture) return measured;
  return { fineHover: false };
}

/** Original fail-closed read. A storage throw is not treated as a new visitor. */
export function readCaptureSuppressed(read: () => string | null): boolean {
  try {
    return Boolean(read());
  } catch {
    return true;
  }
}

/** A blocked showModal must not consume the session. Only a real modal does. */
export function latchAfterOpen(result: "shown" | "blocked"): {
  seen: boolean;
  persist: "shown" | null;
} {
  if (result === "blocked") return { seen: false, persist: null };
  return { seen: true, persist: "shown" };
}

/**
 * One delay for a touch visit already past halfway and still inside the dwell.
 * Returns null for desktop, signup, paid, seen, storage suppression, or a timer already armed.
 * This is not a poll.
 */
export function scheduleMobileDwellRetry(input: {
  mobile: boolean;
  progress: number;
  elapsedMs: number;
  suppressed: boolean;
  knownSignup: boolean;
  paid: boolean;
  seen: boolean;
  alreadyScheduled: boolean;
}): number | null {
  if (
    !input.mobile ||
    input.suppressed ||
    input.knownSignup ||
    input.paid ||
    input.seen ||
    input.alreadyScheduled
  )
    return null;
  if (!(input.progress >= 0.5) || !Number.isFinite(input.elapsedMs)) return null;
  if (input.elapsedMs >= CAPTURE_MIN_ELAPSED_MS) return null;
  return CAPTURE_MIN_ELAPSED_MS - input.elapsedMs;
}

export function evaluateCaptureOpen(input: {
  kind: CaptureAttemptKind;
  signals: CapturePointerSignals;
  facts: CaptureFacts;
  elapsedMs: number;
  progress: number;
  clientY?: number;
  relatedTarget?: boolean;
  suppressed: boolean;
}): boolean {
  if (input.suppressed || input.facts.seen) return false;
  if (input.kind === "desktop-exit") {
    if (!desktopExitAllowed(input.signals)) return false;
    const trigger: CaptureTrigger = {
      kind: "desktop-exit",
      finePointer: true,
      clientY: input.clientY ?? 1,
      relatedTarget: Boolean(input.relatedTarget),
    };
    return shouldOpenCapture(input.facts, trigger);
  }
  if (!usesMobileScrollTrigger(input.signals)) return false;
  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs < CAPTURE_MIN_ELAPSED_MS) return false;
  const trigger: CaptureTrigger = {
    kind: "mobile-scroll",
    finePointer: false,
    progress: input.progress,
  };
  return shouldOpenCapture(input.facts, trigger);
}
