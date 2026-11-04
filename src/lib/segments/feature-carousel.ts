import type { DiveSegment } from "./copy";

/**
 * Four-card feature carousel.
 * Pointer and automatic moves travel forward. The loop uses one extra visual
 * copy of the first card, then resets without animating backward.
 * Keyboard and reduced motion change the card in place.
 * Reduced motion starts paused. Play opts into the same six-second steps
 * with no spatial tween, and turning reduced motion back on pauses again.
 * A visitor's pause stays until they press Play. Hover, hiding, and
 * off-screen time only hold the clock; they do not skip cards.
 */

export const FEATURE_DWELL_MS = 6000;
export const FEATURE_MOVE_MS = 360;
/** Arrival curve. Fast first movement, no bounce, no overshoot. */
export const FEATURE_EASE = { x1: 0.16, y1: 1, x2: 0.3, y2: 1 } as const;

export type FeatureSlideId = "data" | "safety" | "tech" | "modes";
export type FeatureIcon =
  | "depth"
  | "temperature"
  | "deco"
  | "ndl"
  | "safety-stop"
  | "ascent"
  | "deep-stop"
  | "compass"
  | "nitrox"
  | "heading"
  | "scuba"
  | "freedive"
  | "battery";
export type FeatureScope = "shared" | "scuba";
export type FeatureCopySide = "start" | "end";
export type FeatureMoveVia = "keyboard" | "pointer" | "auto";
export type FeatureMoveBehavior = "auto" | "tween";
export type FeatureScrollLock = { target: number } | null;
export type FeatureHold = "none" | "reduced-default" | "user";
export type FeatureHoldEvent =
  | { type: "play" }
  | { type: "pause" }
  | { type: "manual" }
  | { type: "blocking-focus" }
  | { type: "reduced-on" }
  | { type: "reduced-off" };

export type FeatureSlideFrame = {
  id: FeatureSlideId;
  image: "underwater" | "safety-buoy" | "wrist-pool" | "modes";
  focus: string;
  side: FeatureCopySide;
};

export const FEATURE_LINE_PLAN: readonly {
  id: FeatureSlideId;
  lines: readonly { icon: FeatureIcon; scope: FeatureScope }[];
}[] = [
  {
    id: "data",
    lines: [
      { icon: "depth", scope: "shared" },
      { icon: "temperature", scope: "shared" },
      { icon: "deco", scope: "scuba" },
      { icon: "ndl", scope: "scuba" },
    ],
  },
  {
    id: "safety",
    lines: [
      { icon: "safety-stop", scope: "scuba" },
      { icon: "ascent", scope: "scuba" },
      { icon: "deep-stop", scope: "scuba" },
    ],
  },
  {
    id: "tech",
    lines: [
      { icon: "compass", scope: "shared" },
      { icon: "nitrox", scope: "scuba" },
      { icon: "heading", scope: "shared" },
    ],
  },
  {
    id: "modes",
    lines: [
      { icon: "scuba", scope: "shared" },
      { icon: "freedive", scope: "shared" },
      { icon: "battery", scope: "shared" },
    ],
  },
];

const FEATURE_FRAMES: readonly FeatureSlideFrame[] = [
  { id: "data", image: "underwater", focus: "18% 55%", side: "end" },
  { id: "safety", image: "safety-buoy", focus: "50% 50%", side: "start" },
  { id: "tech", image: "wrist-pool", focus: "68% 32%", side: "start" },
  { id: "modes", image: "modes", focus: "40% 58%", side: "end" },
];

export const FEATURE_SLIDE_FRAMES: Record<DiveSegment, readonly FeatureSlideFrame[]> = {
  scuba: FEATURE_FRAMES,
  freediving: FEATURE_FRAMES,
};

export type CarouselAction =
  | { type: "step"; delta: number }
  | { type: "jump"; index: number }
  | { type: "key"; key: string; modified?: boolean };

export type AutoplayGate = {
  hold: FeatureHold;
  visible: boolean;
  documentHidden: boolean;
  reducedMotion: boolean;
  fineHover: boolean;
  dragging: boolean;
  blockingFocus: boolean;
};

export type DwellScheduler = {
  generation: number;
  armedGeneration: number | null;
  dueAt: number | null;
};

export function clampIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

/** One step, wrapping. A large delta still moves that many places, once. */
export function loopIndex(index: number, count: number, delta: number): number {
  if (count <= 0 || !Number.isFinite(delta)) return 0;
  const step = Math.trunc(delta);
  if (step === 0) return clampIndex(index, count);
  const current = clampIndex(index, count);
  return ((current + step) % count + count) % count;
}

export function endpointState(index: number, count: number): { prevDisabled: boolean; nextDisabled: boolean } {
  void index;
  return { prevDisabled: count <= 1, nextDisabled: count <= 1 };
}

export function reduceCarousel(index: number, count: number, action: CarouselAction): { index: number; handled: boolean } {
  const current = clampIndex(index, count);
  if (action.type === "key") {
    if (action.modified) return { index: current, handled: false };
    if (action.key === "ArrowRight") return { index: loopIndex(current, count, 1), handled: true };
    if (action.key === "ArrowLeft") return { index: loopIndex(current, count, -1), handled: true };
    if (action.key === "Home") return { index: 0, handled: true };
    if (action.key === "End") return { index: Math.max(0, count - 1), handled: true };
    return { index: current, handled: false };
  }
  if (action.type === "step") return { index: loopIndex(current, count, action.delta), handled: true };
  return { index: clampIndex(action.index, count), handled: true };
}

/** Apply each action to the index the previous action produced. */
export function applyCarousel(count: number, actions: readonly CarouselAction[], start = 0): number {
  return actions.reduce((index, action) => reduceCarousel(index, count, action).index, start);
}

export function carouselScrollBehavior(input: { reducedMotion: boolean; via: FeatureMoveVia }): FeatureMoveBehavior {
  if (input.reducedMotion || input.via === "keyboard") return "auto";
  return "tween";
}

/**
 * Forward wrap tweens onto the visual copy of the first card.
 * A reverse wrap, a key, or reduced motion jumps. Neither animates backward through the row.
 */
export function planCarouselMove(input: {
  from: number;
  to: number;
  count: number;
  via: FeatureMoveVia;
  reducedMotion: boolean;
}): { kind: "direct" | "wrap-forward"; behavior: FeatureMoveBehavior; index: number } {
  const from = clampIndex(input.from, input.count);
  const dest = clampIndex(input.to, input.count);
  const instant = input.reducedMotion || input.via === "keyboard" || from === dest;
  const reverseWrap = input.count > 1 && from === 0 && dest === input.count - 1;
  if (instant || reverseWrap) return { kind: "direct", behavior: "auto", index: dest };
  if (from === input.count - 1 && dest === 0) return { kind: "wrap-forward", behavior: "tween", index: dest };
  return { kind: "direct", behavior: carouselScrollBehavior(input), index: dest };
}

/** A button click with detail 0 is Enter or Space. Pointer clicks report a positive detail. */
export function carouselClickVia(detail: number): "keyboard" | "pointer" {
  return detail === 0 ? "keyboard" : "pointer";
}

export function measureStride(slideWidth: number, gap: number): number {
  if (!(slideWidth > 0)) return 0;
  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0;
  return slideWidth + safeGap;
}

export function indexFromScroll(scrollLeft: number, stride: number, count: number, maxScroll?: number): number {
  if (count <= 1 || !(stride > 0) || !Number.isFinite(scrollLeft)) return 0;
  if (maxScroll !== undefined && maxScroll > 2 && scrollLeft >= maxScroll - 2) return clampIndex(count - 1, count);
  return clampIndex(Math.round(Math.max(0, scrollLeft) / stride), count);
}

export function scrollTarget(index: number, stride: number, count: number): number {
  if (!(stride > 0)) return 0;
  return clampIndex(index, count) * stride;
}

/** The browser will not scroll past the padding edge, even when the raw target is further. */
export function boundScrollTarget(index: number, stride: number, count: number, maxScroll: number): number {
  const raw = scrollTarget(index, stride, count);
  if (!Number.isFinite(maxScroll)) return raw;
  return Math.min(raw, Math.max(0, maxScroll));
}

/** Scroll position of the visual copy that follows the last real card. */
export function cloneScrollTarget(stride: number, count: number, maxScroll: number): number {
  return boundScrollTarget(count, stride, count + 1, maxScroll);
}

/** True only when the copy can sit a full stride past the last real card and the scroll has arrived there. */
export function cloneSettled(scrollLeft: number, stride: number, count: number, maxScroll: number): boolean {
  if (!(stride > 0) || count <= 1 || !Number.isFinite(scrollLeft)) return false;
  const last = boundScrollTarget(count - 1, stride, count, maxScroll);
  const clone = cloneScrollTarget(stride, count, maxScroll);
  if (clone - last < stride * 0.45) return false;
  return Math.abs(scrollLeft - clone) <= Math.max(2, stride * 0.08);
}

/** After a resize, keep the selected slide instead of trusting the old scroll offset. */
export function resizeAlignment(
  scrollLeft: number,
  index: number,
  stride: number,
  count: number,
  maxScroll = Number.POSITIVE_INFINITY,
): { target: number; needsScroll: boolean } {
  const target = boundScrollTarget(index, stride, count, maxScroll);
  return { target, needsScroll: stride > 0 && Math.abs(scrollLeft - target) > 2 };
}

/**
 * Ignore scroll positions that belong to an in-flight programmatic move.
 * A manual scroll passes a null lock and updates the index immediately.
 */
export function scrollEventIndex(input: {
  scrollLeft: number;
  stride: number;
  count: number;
  lock: FeatureScrollLock;
  current: number;
  maxScroll?: number;
}): { index: number; lock: FeatureScrollLock; atClone: boolean } {
  const current = clampIndex(input.current, input.count);
  if (!(input.stride > 0)) return { index: current, lock: input.lock, atClone: false };
  if (input.lock) {
    const near = Math.abs(input.scrollLeft - input.lock.target) <= Math.max(2, input.stride * 0.08);
    if (!near) return { index: current, lock: input.lock, atClone: false };
  }
  const maxScroll = input.maxScroll ?? Number.POSITIVE_INFINITY;
  if (cloneSettled(input.scrollLeft, input.stride, input.count, maxScroll)) {
    return { index: current, lock: null, atClone: true };
  }
  return {
    index: indexFromScroll(input.scrollLeft, input.stride, input.count, input.maxScroll),
    lock: null,
    atClone: false,
  };
}

function bezierComponent(c1: number, c2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t;
}

/** Map time in 0..1 through FEATURE_EASE. Values stay inside 0..1. */
export function featureEase(amount: number): number {
  if (!(amount > 0)) return 0;
  if (amount >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 20; step += 1) {
    const mid = (lo + hi) / 2;
    if (bezierComponent(FEATURE_EASE.x1, FEATURE_EASE.x2, mid) < amount) lo = mid;
    else hi = mid;
  }
  return bezierComponent(FEATURE_EASE.y1, FEATURE_EASE.y2, (lo + hi) / 2);
}

export function tweenScrollLeft(start: number, target: number, amount: number): number {
  return start + (target - start) * featureEase(amount);
}

export function initialFeatureHold(reducedMotion: boolean): FeatureHold {
  return reducedMotion ? "reduced-default" : "none";
}

export function reduceFeatureHold(hold: FeatureHold, event: FeatureHoldEvent): FeatureHold {
  switch (event.type) {
    case "play":
      return "none";
    case "pause":
    case "manual":
    case "blocking-focus":
      return "user";
    case "reduced-on":
      return hold === "user" ? "user" : "reduced-default";
    case "reduced-off":
      return hold === "reduced-default" ? "none" : hold;
    default:
      return hold;
  }
}

/** The Play control is the rotation control. Focusing it does not stop the sequence. */
export function holdAfterFocus(hold: FeatureHold, onRotationControl: boolean): FeatureHold {
  if (onRotationControl) return hold;
  return reduceFeatureHold(hold, { type: "blocking-focus" });
}

/**
 * Reduced motion is not an eligibility veto. The default hold pauses it,
 * and Play clears that hold. The move planner still refuses a spatial tween
 * while `reducedMotion` is true, so an opted-in sequence only changes cards.
 */
export function autoplayEligible(gate: AutoplayGate): boolean {
  if (gate.hold !== "none") return false;
  if (!gate.visible || gate.documentHidden || gate.fineHover || gate.dragging || gate.blockingFocus) return false;
  return true;
}

export function idleScheduler(): DwellScheduler {
  return { generation: 0, armedGeneration: null, dueAt: null };
}

/**
 * Arm a full dwell when eligible and idle.
 * An armed clock keeps its deadline. Becoming ineligible cancels it and
 * retires the generation so a late callback cannot advance.
 */
export function syncDwell(
  scheduler: DwellScheduler,
  eligible: boolean,
  now: number,
  dwellMs = FEATURE_DWELL_MS,
): { scheduler: DwellScheduler; scheduleIn: number | null } {
  if (!eligible) {
    if (scheduler.armedGeneration === null && scheduler.dueAt === null) return { scheduler, scheduleIn: null };
    return {
      scheduler: { generation: scheduler.generation + 1, armedGeneration: null, dueAt: null },
      scheduleIn: null,
    };
  }
  if (scheduler.armedGeneration !== null && scheduler.dueAt !== null) {
    return { scheduler, scheduleIn: Math.max(0, scheduler.dueAt - now) };
  }
  const wait = dwellMs > 0 ? dwellMs : FEATURE_DWELL_MS;
  return {
    scheduler: { generation: scheduler.generation, armedGeneration: scheduler.generation, dueAt: now + wait },
    scheduleIn: wait,
  };
}

/**
 * One callback advances one card, and only if that arm is still the current one.
 * A stale generation leaves the live deadline untouched.
 */
export function takeDwell(
  scheduler: DwellScheduler,
  generation: number,
  eligible: boolean,
  index: number,
  count: number,
): { scheduler: DwellScheduler; index: number; advanced: boolean } {
  if (scheduler.armedGeneration !== generation) return { scheduler, index, advanced: false };
  const next: DwellScheduler = { generation: scheduler.generation + 1, armedGeneration: null, dueAt: null };
  if (!eligible || count <= 0) return { scheduler: next, index, advanced: false };
  return { scheduler: next, index: loopIndex(index, count, 1), advanced: true };
}

/**
 * A timeout that no longer owns `activeTimer` must not clear a newer arm
 * or ask the caller to start another timer.
 */
export function settleDwellTimer(input: {
  scheduler: DwellScheduler;
  callbackTimer: number;
  activeTimer: number;
  generation: number;
  eligible: boolean;
  index: number;
  count: number;
}): { ignored: boolean; scheduler: DwellScheduler; index: number; advanced: boolean } {
  if (input.callbackTimer === 0 || input.callbackTimer !== input.activeTimer) {
    return { ignored: true, scheduler: input.scheduler, index: input.index, advanced: false };
  }
  const taken = takeDwell(input.scheduler, input.generation, input.eligible, input.index, input.count);
  return { ignored: false, scheduler: taken.scheduler, index: taken.index, advanced: taken.advanced };
}

export type FeatureScrollDisposition = "ignore" | "silent-wrap" | "manual-wrap" | "manual-move" | "stay";

/**
 * Scroll events during a quiet write, a tween, or an automatic 4→1 reset
 * do not become a visitor pause. A drag onto the loop copy still does.
 */
export function classifyFeatureScroll(input: {
  quiet: boolean;
  tweening: boolean;
  wrapLocked: boolean;
  atClone: boolean;
  nextIndex: number;
  currentIndex: number;
  automaticWrap: boolean;
}): FeatureScrollDisposition {
  if (input.quiet || input.tweening || input.wrapLocked) return "ignore";
  if (input.atClone) return input.automaticWrap ? "silent-wrap" : "manual-wrap";
  if (input.nextIndex !== input.currentIndex) return "manual-move";
  return "stay";
}

/** Put the loop copy back on card 1. Call `writeScrollLeft` while scroll events are ignored. */
export function finishAutomaticWrap(
  track: { scrollSnapType: string; willChange: string },
  writeScrollLeft: (left: number) => void,
): void {
  track.scrollSnapType = "none";
  writeScrollLeft(0);
  track.scrollSnapType = "";
  track.willChange = "";
}

export function featureSlidePlan<T extends { id: FeatureSlideId }>(segment: DiveSegment, slides: readonly T[]) {
  return FEATURE_SLIDE_FRAMES[segment].map((frame) => {
    const slide = slides.find((item) => item.id === frame.id);
    if (!slide) throw new Error(`Missing ${segment} feature slide ${frame.id}`);
    return { frame, slide };
  });
}

export function featureCopyStructure(
  slides: readonly { id: FeatureSlideId; lines: readonly { icon: FeatureIcon; scope: FeatureScope; text: string }[] }[],
): boolean {
  if (slides.length !== FEATURE_LINE_PLAN.length) return false;
  return FEATURE_LINE_PLAN.every((plan, slideIndex) => {
    const slide = slides[slideIndex];
    if (!slide || slide.id !== plan.id || slide.lines.length !== plan.lines.length) return false;
    return plan.lines.every((line, lineIndex) => {
      const actual = slide.lines[lineIndex];
      return Boolean(actual && actual.icon === line.icon && actual.scope === line.scope && actual.text.trim().length > 1);
    });
  });
}

export function featureSlideAlt(id: FeatureSlideId, alt: Record<FeatureSlideId, string>): string {
  return alt[id] ?? "";
}
