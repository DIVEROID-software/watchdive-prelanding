import type { DiveSegment } from "./copy";

/**
 * Scroll-snap carousel state. The component threads the latest index through
 * these helpers so a fast second click cannot reuse a stale render.
 * Pointer moves may scroll smoothly. Keyboard and reduced motion stay instant.
 */
export type FeatureSlideId = "readings" | "guidance" | "logbook" | "housing";
export type FeatureCopySide = "start" | "end";
export type FeatureScrollBehavior = "auto" | "smooth";
export type FeatureScrollLock = { target: number } | null;

export type FeatureSlideFrame = {
  id: FeatureSlideId;
  image: "step2" | "underwater" | "loghand" | "buoy" | "free-log" | "gear";
  focus: string;
  side: FeatureCopySide;
  /** Gear is a busy flat lay. Type sits under the photo at every width. */
  layout: "overlay" | "stack";
};

export const FEATURE_SLIDE_FRAMES: Record<DiveSegment, readonly FeatureSlideFrame[]> = {
  scuba: [
    { id: "readings", image: "step2", focus: "18% 42%", side: "end", layout: "overlay" },
    { id: "guidance", image: "underwater", focus: "22% 48%", side: "end", layout: "overlay" },
    { id: "logbook", image: "loghand", focus: "50% 50%", side: "start", layout: "overlay" },
  ],
  freediving: [
    { id: "readings", image: "buoy", focus: "62% 42%", side: "start", layout: "overlay" },
    { id: "logbook", image: "free-log", focus: "70% 45%", side: "start", layout: "overlay" },
    { id: "housing", image: "gear", focus: "42% 55%", side: "start", layout: "stack" },
  ],
};

export type CarouselAction =
  | { type: "step"; delta: number }
  | { type: "jump"; index: number }
  | { type: "key"; key: string; modified?: boolean };

export function clampIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

export function stepIndex(index: number, count: number, delta: number): number {
  if (count <= 0 || !Number.isFinite(delta)) return 0;
  return clampIndex(clampIndex(index, count) + Math.trunc(delta), count);
}

export function endpointState(index: number, count: number): { prevDisabled: boolean; nextDisabled: boolean } {
  const current = clampIndex(index, count);
  return {
    prevDisabled: count <= 1 || current <= 0,
    nextDisabled: count <= 1 || current >= count - 1,
  };
}

export function reduceCarousel(index: number, count: number, action: CarouselAction): { index: number; handled: boolean } {
  const current = clampIndex(index, count);
  if (action.type === "key") {
    if (action.modified) return { index: current, handled: false };
    if (action.key === "ArrowRight") return { index: stepIndex(current, count, 1), handled: true };
    if (action.key === "ArrowLeft") return { index: stepIndex(current, count, -1), handled: true };
    if (action.key === "Home") return { index: 0, handled: true };
    if (action.key === "End") return { index: Math.max(0, count - 1), handled: true };
    return { index: current, handled: false };
  }
  if (action.type === "step") return { index: stepIndex(current, count, action.delta), handled: true };
  return { index: clampIndex(action.index, count), handled: true };
}

/** Apply each action to the index the previous action produced. */
export function applyCarousel(count: number, actions: readonly CarouselAction[], start = 0): number {
  return actions.reduce((index, action) => reduceCarousel(index, count, action).index, start);
}

export function carouselScrollBehavior(input: { reducedMotion: boolean; via: "keyboard" | "pointer" }): FeatureScrollBehavior {
  if (input.reducedMotion || input.via === "keyboard") return "auto";
  return "smooth";
}

export function measureStride(slideWidth: number, gap: number): number {
  if (!(slideWidth > 0)) return 0;
  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0;
  return slideWidth + safeGap;
}

export function indexFromScroll(scrollLeft: number, stride: number, count: number): number {
  if (count <= 1 || !(stride > 0) || !Number.isFinite(scrollLeft)) return 0;
  return clampIndex(Math.round(Math.max(0, scrollLeft) / stride), count);
}

export function scrollTarget(index: number, stride: number, count: number): number {
  if (!(stride > 0)) return 0;
  return clampIndex(index, count) * stride;
}

/** After a resize, keep the selected slide instead of trusting the old scroll offset. */
export function resizeAlignment(scrollLeft: number, index: number, stride: number, count: number): { target: number; needsScroll: boolean } {
  const target = scrollTarget(index, stride, count);
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
}): { index: number; lock: FeatureScrollLock } {
  const current = clampIndex(input.current, input.count);
  if (!(input.stride > 0)) return { index: current, lock: input.lock };
  if (input.lock) {
    const near = Math.abs(input.scrollLeft - input.lock.target) <= Math.max(2, input.stride * 0.08);
    if (!near) return { index: current, lock: input.lock };
  }
  return { index: indexFromScroll(input.scrollLeft, input.stride, input.count), lock: null };
}

export function featureSlidePlan<T extends { id: FeatureSlideId }>(segment: DiveSegment, slides: readonly T[]) {
  return FEATURE_SLIDE_FRAMES[segment].map((frame) => {
    const slide = slides.find((item) => item.id === frame.id);
    if (!slide) throw new Error(`Missing ${segment} feature slide ${frame.id}`);
    return { frame, slide };
  });
}

export function featureSlideAlt(
  segment: DiveSegment,
  id: FeatureSlideId,
  media: { benefitAlt: Record<DiveSegment, readonly string[]>; logStillAlt: string },
): string {
  if (segment === "scuba") {
    if (id === "readings") return media.benefitAlt.scuba[2] ?? "";
    if (id === "guidance") return media.benefitAlt.scuba[1] ?? "";
    return media.logStillAlt;
  }
  if (id === "logbook") return media.benefitAlt.freediving[2] ?? "";
  if (id === "housing") return media.benefitAlt.freediving[0] ?? "";
  return media.benefitAlt.freediving[1] ?? "";
}
