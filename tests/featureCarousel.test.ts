/** Feature carousel content, loop, and autoplay gates. No browser. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { FEATURE_CAROUSEL_COPY, featureCarouselCopy, featureLineText, formatFeaturePosition } from "../src/lib/segments/feature-carousel-copy.ts";
import {
  FEATURE_DWELL_MS,
  FEATURE_EASE,
  FEATURE_LINE_PLAN,
  FEATURE_MOVE_MS,
  FEATURE_SLIDE_FRAMES,
  applyCarousel,
  autoplayEligible,
  boundScrollTarget,
  carouselClickVia,
  carouselScrollBehavior,
  cloneScrollTarget,
  cloneSettled,
  endpointState,
  featureCopyStructure,
  featureEase,
  featureSlideAlt,
  featureSlidePlan,
  holdAfterFocus,
  idleScheduler,
  indexFromScroll,
  initialFeatureHold,
  loopIndex,
  measureStride,
  planCarouselMove,
  reduceCarousel,
  reduceFeatureHold,
  resizeAlignment,
  scrollEventIndex,
  scrollTarget,
  syncDwell,
  takeDwell,
  tweenScrollLeft,
  type AutoplayGate,
  type DwellScheduler,
} from "../src/lib/segments/feature-carousel.ts";

const ENGLISH_LINES = [
  "Live depth tracking",
  "Water temperature monitoring",
  "Decompression stop guidance",
  "NDL",
  "Safety stop alerts",
  "Ascent rate alerts",
  "Deep stop alerts",
  "Digital compass",
  "Nitrox (EANx) support",
  "Compass heading marker",
  "Scuba mode",
  "Freedive mode",
  "Low-battery warning",
] as const;

const ALT_TOKENS: Record<Locale, { safety: RegExp; modes: RegExp; wrist: RegExp }> = {
  en: { safety: /buoy/i, modes: /hose/i, wrist: /wrist/i },
  ko: { safety: /부표/, modes: /호스/, wrist: /손목/ },
  "zh-CN": { safety: /浮标/, modes: /软管/, wrist: /腕/ },
  "zh-TW": { safety: /浮標/, modes: /軟管/, wrist: /腕/ },
  ja: { safety: /ブイ/, modes: /ホース/, wrist: /手首/ },
  es: { safety: /boya/i, modes: /latiguillo/i, wrist: /muñeca/i },
  fr: { safety: /bouée/i, modes: /flexible/i, wrist: /poignet/i },
  de: { safety: /Boje/, modes: /Schlauch/, wrist: /Handgelenk/ },
  "pt-BR": { safety: /boia/i, modes: /mangueira/i, wrist: /pulso/i },
  nl: { safety: /boei/i, modes: /slang/i, wrist: /pols/i },
};

function openGate(overrides: Partial<AutoplayGate> = {}): AutoplayGate {
  return {
    hold: "none",
    visible: true,
    documentHidden: false,
    reducedMotion: false,
    fineHover: false,
    dragging: false,
    blockingFocus: false,
    ...overrides,
  };
}

test("forward steps loop one card at a time and the ends stay available", () => {
  const steps = Array.from({ length: 20 }, () => ({ type: "step" as const, delta: 1 }));
  assert.equal(applyCarousel(4, steps), 0);
  assert.equal(applyCarousel(4, [...steps, { type: "step", delta: 1 }]), 1);
  assert.equal(applyCarousel(4, [{ type: "step", delta: -1 }]), 3);
  assert.equal(applyCarousel(4, [{ type: "step", delta: 1 }, { type: "step", delta: -1 }]), 0);
  assert.equal(loopIndex(3, 4, 1), 0);
  assert.deepEqual(endpointState(0, 4), { prevDisabled: false, nextDisabled: false });
  assert.deepEqual(endpointState(3, 4), { prevDisabled: false, nextDisabled: false });
  assert.deepEqual(endpointState(0, 1), { prevDisabled: true, nextDisabled: true });
});

test("keyboard wraps one slide and leaves modified keys alone", () => {
  assert.deepEqual(reduceCarousel(0, 4, { type: "key", key: "ArrowRight" }), { index: 1, handled: true });
  assert.deepEqual(reduceCarousel(3, 4, { type: "key", key: "ArrowRight" }), { index: 0, handled: true });
  assert.deepEqual(reduceCarousel(0, 4, { type: "key", key: "ArrowLeft" }), { index: 3, handled: true });
  assert.deepEqual(reduceCarousel(2, 4, { type: "key", key: "Home" }), { index: 0, handled: true });
  assert.deepEqual(reduceCarousel(0, 4, { type: "key", key: "End" }), { index: 3, handled: true });
  for (const key of ["ArrowUp", "ArrowDown", "Tab", "PageDown", " ", "Enter"]) {
    assert.deepEqual(reduceCarousel(1, 4, { type: "key", key }), { index: 1, handled: false }, key);
  }
  assert.deepEqual(reduceCarousel(1, 4, { type: "key", key: "ArrowRight", modified: true }), { index: 1, handled: false });
  assert.equal(carouselClickVia(0), "keyboard");
  assert.equal(carouselClickVia(1), "pointer");
});

test("pointer and auto moves ease forward, and the return trip does not animate backward", () => {
  assert.equal(FEATURE_MOVE_MS >= 300 && FEATURE_MOVE_MS <= 400, true);
  assert.equal(FEATURE_DWELL_MS, 6000);
  assert.deepEqual(FEATURE_EASE, { x1: 0.16, y1: 1, x2: 0.3, y2: 1 });
  assert.equal(carouselScrollBehavior({ reducedMotion: false, via: "pointer" }), "tween");
  assert.equal(carouselScrollBehavior({ reducedMotion: false, via: "auto" }), "tween");
  assert.equal(carouselScrollBehavior({ reducedMotion: true, via: "pointer" }), "auto");
  assert.equal(carouselScrollBehavior({ reducedMotion: false, via: "keyboard" }), "auto");
  assert.deepEqual(planCarouselMove({ from: 3, to: 0, count: 4, via: "pointer", reducedMotion: false }), { kind: "wrap-forward", behavior: "tween", index: 0 });
  assert.deepEqual(planCarouselMove({ from: 3, to: 0, count: 4, via: "auto", reducedMotion: false }), { kind: "wrap-forward", behavior: "tween", index: 0 });
  assert.deepEqual(planCarouselMove({ from: 3, to: 0, count: 4, via: "keyboard", reducedMotion: false }), { kind: "direct", behavior: "auto", index: 0 });
  assert.deepEqual(planCarouselMove({ from: 3, to: 0, count: 4, via: "pointer", reducedMotion: true }), { kind: "direct", behavior: "auto", index: 0 });
  assert.deepEqual(planCarouselMove({ from: 0, to: 3, count: 4, via: "pointer", reducedMotion: false }), { kind: "direct", behavior: "auto", index: 3 });
  assert.deepEqual(planCarouselMove({ from: 1, to: 2, count: 4, via: "auto", reducedMotion: false }), { kind: "direct", behavior: "tween", index: 2 });
  assert.equal(featureEase(0), 0);
  assert.equal(featureEase(1), 1);
  assert.equal(featureEase(-0.2), 0);
  assert.ok(featureEase(0.15) > 0.15);
  let previous = 0;
  for (let step = 0; step <= 20; step += 1) {
    const value = featureEase(step / 20);
    assert.ok(value >= 0 && value <= 1, String(value));
    assert.ok(value + 1e-6 >= previous);
    previous = value;
  }
  assert.equal(tweenScrollLeft(10, 310, 0), 10);
  assert.equal(tweenScrollLeft(10, 310, 1), 310);
  assert.ok(tweenScrollLeft(0, 300, 0.2) > 60);
});

test("scroll math keeps the selected card, ignores an in-flight move, and recognizes only a reachable loop copy", () => {
  assert.equal(measureStride(280, 14), 294);
  assert.equal(measureStride(0, 14), 0);
  assert.equal(measureStride(280, Number.NaN), 280);
  assert.equal(scrollTarget(2, 300, 4), 600);
  assert.equal(boundScrollTarget(3, 300, 4, 500), 500);
  assert.equal(cloneScrollTarget(300, 4, 1200), 1200);
  assert.equal(cloneSettled(1200, 300, 4, 1200), true);
  assert.equal(cloneSettled(900, 300, 4, 1200), false);
  assert.equal(cloneSettled(1000, 300, 4, 1000), false);
  const stride = 300;
  const locked = scrollEventIndex({ scrollLeft: 300, stride, count: 4, lock: { target: 900 }, current: 3, maxScroll: 1200 });
  assert.equal(locked.index, 3);
  assert.deepEqual(locked.lock, { target: 900 });
  assert.equal(locked.atClone, false);
  const arrived = scrollEventIndex({ scrollLeft: 1200, stride, count: 4, lock: { target: 1200 }, current: 3, maxScroll: 1200 });
  assert.equal(arrived.atClone, true);
  assert.equal(arrived.lock, null);
  const manual = scrollEventIndex({ scrollLeft: 600, stride, count: 4, lock: null, current: 0, maxScroll: 1200 });
  assert.deepEqual(manual, { index: 2, lock: null, atClone: false });
  assert.equal(indexFromScroll(1200, stride, 4, 1200), 3);
  assert.equal(indexFromScroll(520, stride, 3, 520), 2);
  assert.deepEqual(resizeAlignment(50, 2, stride, 4, 1200), { target: 600, needsScroll: true });
  assert.equal(resizeAlignment(600, 2, stride, 4, 1200).needsScroll, false);
});

test("a dwell advances one card, a stale callback does not, and a hidden gap does not catch up", () => {
  const idle = idleScheduler();
  assert.equal(syncDwell(idle, false, 0).scheduler.generation, 0);
  const armed = syncDwell(idle, true, 1_000);
  assert.equal(armed.scheduleIn, 6_000);
  assert.equal(armed.scheduler.dueAt, 7_000);
  assert.equal(armed.scheduler.armedGeneration, 0);
  const kept = syncDwell(armed.scheduler, true, 2_000);
  assert.equal(kept.scheduler.dueAt, 7_000);
  assert.equal(kept.scheduleIn, 5_000);
  assert.equal(kept.scheduler.generation, armed.scheduler.generation);
  const hidden = syncDwell(armed.scheduler, false, 1_500);
  assert.equal(hidden.scheduleIn, null);
  assert.equal(hidden.scheduler.dueAt, null);
  assert.equal(hidden.scheduler.generation, armed.scheduler.generation + 1);
  const resumed = syncDwell(hidden.scheduler, true, 9_000);
  assert.equal(resumed.scheduleIn, 6_000);
  assert.equal(resumed.scheduler.dueAt, 15_000);
  const first = takeDwell(armed.scheduler, 0, true, 3, 4);
  assert.equal(first.advanced, true);
  assert.equal(first.index, 0);
  assert.equal(first.scheduler.armedGeneration, null);
  const repeat = takeDwell(first.scheduler, 0, true, first.index, 4);
  assert.equal(repeat.advanced, false);
  assert.equal(repeat.index, 0);
  assert.equal(repeat.scheduler.generation, first.scheduler.generation);
  const stale = takeDwell(armed.scheduler, 99, true, 1, 4);
  assert.equal(stale.advanced, false);
  assert.equal(stale.index, 1);
  assert.equal(stale.scheduler.generation, armed.scheduler.generation);
  const blocked = takeDwell(armed.scheduler, 0, false, 1, 4);
  assert.equal(blocked.advanced, false);
  assert.equal(blocked.index, 1);
  assert.equal(blocked.scheduler.generation, armed.scheduler.generation + 1);
  const again = takeDwell(blocked.scheduler, 0, true, 1, 4);
  assert.equal(again.advanced, false);
  assert.equal(again.scheduler.generation, blocked.scheduler.generation);
});

test("playback stops for each gate, and only Play clears a visitor pause", () => {
  assert.equal(autoplayEligible(openGate()), true);
  for (const gate of [
    openGate({ hold: "user" }),
    openGate({ hold: "reduced-default" }),
    openGate({ visible: false }),
    openGate({ documentHidden: true }),
    openGate({ reducedMotion: true }),
    openGate({ fineHover: true }),
    openGate({ dragging: true }),
    openGate({ blockingFocus: true }),
  ]) {
    assert.equal(autoplayEligible(gate), false);
  }
  assert.equal(initialFeatureHold(true), "reduced-default");
  assert.equal(initialFeatureHold(false), "none");
  const optedIn = reduceFeatureHold("reduced-default", { type: "play" });
  assert.equal(optedIn, "none");
  assert.equal(autoplayEligible(openGate({ hold: optedIn, reducedMotion: true })), false);
  assert.equal(reduceFeatureHold("user", { type: "reduced-on" }), "user");
  assert.equal(reduceFeatureHold("none", { type: "reduced-on" }), "reduced-default");
  assert.equal(reduceFeatureHold("reduced-default", { type: "reduced-off" }), "none");
  assert.equal(reduceFeatureHold("user", { type: "reduced-off" }), "user");
  assert.equal(reduceFeatureHold("none", { type: "pause" }), "user");
  assert.equal(reduceFeatureHold("user", { type: "play" }), "none");
  assert.equal(holdAfterFocus("none", true), "none");
  assert.equal(holdAfterFocus("user", true), "user");
  assert.equal(holdAfterFocus("none", false), "user");
  const hiddenWhilePlaying = syncDwell(syncDwell(idleScheduler(), true, 0).scheduler, false, 1_000);
  const stillPaused: DwellScheduler = hiddenWhilePlaying.scheduler;
  assert.equal(syncDwell(stillPaused, false, 8_000).scheduler.generation, stillPaused.generation);
});

test("all ten locales show the same four cards, and freediving names scuba procedures", () => {
  assert.deepEqual(Object.keys(FEATURE_CAROUSEL_COPY).sort(), [...SUPPORTED_LOCALES].sort());
  assert.deepEqual(FEATURE_SLIDE_FRAMES.scuba.map((frame) => frame.id), ["data", "safety", "tech", "modes"]);
  assert.equal(FEATURE_SLIDE_FRAMES.scuba, FEATURE_SLIDE_FRAMES.freediving);
  assert.deepEqual(FEATURE_SLIDE_FRAMES.scuba.map((frame) => frame.image), ["underwater", "buoy", "wrist-pool", "modes"]);
  assert.deepEqual(FEATURE_SLIDE_FRAMES.scuba.map((frame) => frame.side), ["end", "start", "start", "end"]);
  const packed = JSON.stringify(FEATURE_CAROUSEL_COPY);
  assert.equal(/beta|\$|149/i.test(packed), false);
  for (const locale of SUPPORTED_LOCALES) {
    const copy = featureCarouselCopy(locale);
    assert.equal(copy.slides.scuba, copy.slides.freediving, locale);
    assert.equal(copy.heading.scuba, copy.heading.freediving, locale);
    assert.equal(copy.heading.scuba.length >= 8 && copy.heading.scuba.length <= 160, true, locale);
    assert.notEqual(copy.previous, copy.next, locale);
    assert.notEqual(copy.play, copy.pause, locale);
    assert.equal(copy.play.length > 2 && copy.pause.length > 2, true, locale);
    assert.equal(copy.scopeLabel.length > 2, true, locale);
    assert.equal(formatFeaturePosition(copy.position, 2, 4).includes("2"), true, locale);
    assert.equal(formatFeaturePosition(copy.position, 2, 4).includes("4"), true, locale);
    assert.equal(featureCopyStructure(copy.slides.scuba), true, locale);
    assert.deepEqual(featureSlidePlan(locale === "en" ? "scuba" : "freediving", copy.slides.scuba).map((item) => item.frame.id), ["data", "safety", "tech", "modes"]);
    const icons = copy.slides.scuba.flatMap((slide) => slide.lines.map((line) => line.icon));
    assert.deepEqual(icons, FEATURE_LINE_PLAN.flatMap((slide) => slide.lines.map((line) => line.icon)), locale);
    const stored = copy.slides.scuba.flatMap((slide) => slide.lines.map((line) => line.text)).join("\n");
    assert.equal(stored.includes("NDL"), true, locale);
    assert.equal(/EANx/.test(stored), true, locale);
    for (const segment of ["scuba", "freediving"] as const) {
      for (const slide of copy.slides[segment]) {
        assert.equal(slide.title.trim().length >= 2 && slide.title.trim().length <= 80, true, `${locale} ${slide.title}`);
        for (const line of slide.lines) {
          const shown = featureLineText(line, segment, copy.scopeLabel);
          assert.equal(shown.trim().length >= 2 && shown.trim().length <= 120, true, `${locale} ${shown}`);
          if (segment === "freediving" && line.scope === "scuba") assert.equal(shown.endsWith(` · ${copy.scopeLabel}`), true, shown);
          else assert.equal(shown, line.text, `${locale} ${segment} ${line.icon}`);
        }
      }
    }
    const modesLine = copy.slides.freediving.find((slide) => slide.id === "modes")?.lines[0];
    assert.equal(modesLine?.scope, "shared");
    assert.equal(featureLineText(modesLine!, "freediving", copy.scopeLabel), modesLine?.text);
    for (const id of ["data", "safety", "tech", "modes"] as const) {
      assert.equal(featureSlideAlt(id, copy.alt).includes("WatchDive"), true, `${locale} ${id}`);
    }
    assert.match(copy.alt.safety, ALT_TOKENS[locale].safety, locale);
    assert.match(copy.alt.modes, ALT_TOKENS[locale].modes, locale);
    assert.match(copy.alt.tech, ALT_TOKENS[locale].wrist, locale);
    assert.match(copy.alt.data, ALT_TOKENS[locale].wrist, locale);
  }
  const english = featureCarouselCopy("en");
  assert.equal(english.heading.scuba, "Everything Your Dive Needs, Right On Your Wrist.");
  assert.deepEqual(english.slides.scuba.flatMap((slide) => slide.lines.map((line) => line.text)), ENGLISH_LINES);
  assert.deepEqual(english.slides.scuba.map((slide) => slide.title), ["Data", "Safety", "Dive Tech", "Modes"]);
  const freedivingData = english.slides.freediving[0].lines.map((line) => featureLineText(line, "freediving", english.scopeLabel));
  assert.deepEqual(freedivingData, [
    "Live depth tracking",
    "Water temperature monitoring",
    "Decompression stop guidance · Scuba mode",
    "NDL · Scuba mode",
  ]);
  assert.equal(featureLineText(english.slides.scuba[0].lines[2], "scuba", english.scopeLabel), "Decompression stop guidance");
});

test("the carousel view wires four stills, a rotation control, and one dwell timer", () => {
  const view = readFileSync(new URL("../src/components/segments/SegmentFeatureCarousel.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/components/segments/segments.css", import.meta.url), "utf8");
  assert.equal((view.match(/setTimeout/g) ?? []).length, 1);
  assert.equal((view.match(/setInterval/g) ?? []).length, 0);
  assert.match(view, /clearTimeout/);
  assert.match(view, /cancelAnimationFrame/);
  assert.match(view, /IntersectionObserver/);
  assert.match(view, /visibilitychange/);
  assert.match(view, /prefers-reduced-motion/);
  assert.match(view, /syncDwell/);
  assert.match(view, /takeDwell/);
  assert.match(view, /data-feature-rotation/);
  assert.match(view, /aria-pressed/);
  assert.match(view, /aria-live="polite"/);
  assert.match(view, /inert=\{clone \? true : undefined\}/);
  assert.match(view, /loading="lazy"/);
  assert.match(view, /ArrowLeft ArrowRight Home End/);
  assert.match(view, /featureLineText/);
  assert.match(view, /FeatureGlyph/);
  assert.match(view, /modes-bcd-1376\.webp/);
  assert.match(view, /modes-bcd-800\.webp/);
  assert.match(view, /underwater-1600\.webp/);
  assert.match(view, /underwater-1000\.webp/);
  assert.match(view, /underwater-640\.webp/);
  assert.match(view, /buoy-1400\.webp/);
  assert.match(view, /wrist-pool-1000\.webp/);
  assert.equal(view.includes("buoy-2200"), false);
  assert.equal(view.includes("underwater-mobile"), false);
  assert.equal(view.includes("gear-"), false);
  assert.equal(view.includes("scuba-pool-overhead"), false);
  assert.equal(/<video|\.mp4/.test(view), false);
  assert.match(css, /\.wd-feature-track\{[^}]*scroll-behavior:auto/);
  assert.match(css, /\.wd-feature-track\{[^}]*scroll-snap-type:x mandatory/);
  assert.match(css, /--feature-peek:72px/);
  assert.match(css, /--feature-peek:44px/);
  assert.match(css, /scroll-snap-stop:always/);
  assert.match(css, /\.wd-feature-nav button\{[^}]*min-width:48px/);
  assert.match(css, /\.wd-feature-icon\{[^}]*stroke:currentColor/);
  assert.match(css, /letter-spacing:-\.03em/);
  assert.match(css, /#1a1438 72%/);
  assert.match(css, /@media\(max-width:389px\)/);
  assert.match(css, /flex:1 1 auto;align-self:stretch;justify-content:flex-start/);
  assert.equal(css.includes(".wd-feature-copy li::before"), false);
});
