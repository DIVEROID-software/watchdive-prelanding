/** Feature carousel state, endpoints, locales, and segment claims. No browser. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { mediaCopy } from "../src/lib/segments/media-copy.ts";
import { FEATURE_CAROUSEL_COPY, featureCarouselCopy, formatFeaturePosition } from "../src/lib/segments/feature-carousel-copy.ts";
import {
  FEATURE_SLIDE_FRAMES,
  applyCarousel,
  carouselScrollBehavior,
  endpointState,
  featureSlideAlt,
  featureSlidePlan,
  indexFromScroll,
  measureStride,
  reduceCarousel,
  resizeAlignment,
  scrollEventIndex,
  scrollTarget,
} from "../src/lib/segments/feature-carousel.ts";

const FREE_FORBIDDEN = /ndl|no-deco|no-decompress|decompress|dekompress|descompress|d[ée]compress|\bdeco\b|ascent alert|safety stop|deep stop|무감압|감압|상승|안전정지|安全停留|免减压|免減壓|减压|減壓|安全停止|無減圧|浮上|parada de seguran[çc]a|palier de s[ée]curit|sicherheitsstopp|aufstiegswarn|nullzeit|veiligheidsstop|stijgwaarschuwing|no-decompressietijd|indicaciones de descompresi|avisos de ascenso|alertes de remont[ée]e|alertas de subida/i;
const DEEP_STOP = /deep stop|deepstop|딥\s*스톱|ディープストップ|深停/i;

const SCUBA_REQUIRED: Record<Locale, readonly string[]> = {
  en: ["Compass", "Depth", "Dive time", "Water temperature", "No-decompression time", "Deco guidance", "Ascent alerts", "Safety stop"],
  ko: ["나침반", "수심", "다이빙 시간", "수온", "무감압 시간", "감압 안내", "상승 알림", "안전정지"],
  "zh-CN": ["指南针", "水深", "潜水时间", "水温", "免减压时间", "减压指引", "上升提醒", "安全停留"],
  "zh-TW": ["指南針", "深度", "潛水時間", "水溫", "免減壓時間", "減壓指引", "上升提醒", "安全停留"],
  ja: ["コンパス", "深度", "潜水時間", "水温", "無減圧潜水時間", "減圧ガイダンス", "浮上アラート", "安全停止"],
  es: ["Brújula", "Profundidad", "Tiempo de inmersión", "Temperatura del agua", "Tiempo sin descompresión", "Indicaciones de descompresión", "Avisos de ascenso", "Parada de seguridad"],
  fr: ["Compas", "Profondeur", "Durée de plongée", "Température de l’eau", "Temps sans palier", "Indications de décompression", "Alertes de remontée", "Palier de sécurité"],
  de: ["Kompass", "Tiefe", "Tauchzeit", "Wassertemperatur", "Nullzeit", "Dekompressionshinweise", "Aufstiegswarnung", "Sicherheitsstopp"],
  "pt-BR": ["Bússola", "Profundidade", "Tempo de mergulho", "Temperatura da água", "Tempo sem descompressão", "Orientações de descompressão", "Alertas de subida", "Parada de segurança"],
  nl: ["Kompas", "Diepte", "Duiktijd", "Watertemperatuur", "No-decompressietijd", "Stijgwaarschuwing", "Veiligheidsstop"],
};

const FREE_REQUIRED: Record<Locale, readonly string[]> = {
  en: ["Depth", "Dive time", "Water temperature", "Freediving profiles", "seal check"],
  ko: ["수심", "다이빙 시간", "수온", "프리다이빙 프로필", "실링 확인"],
  "zh-CN": ["水深", "潜水时间", "水温", "自由潜水曲线", "密封检查"],
  "zh-TW": ["深度", "潛水時間", "水溫", "自由潛水曲線", "密封檢查"],
  ja: ["深度", "潜水時間", "水温", "フリーダイビングの記録", "圧力を確認"],
  es: ["Profundidad", "Tiempo de inmersión", "Temperatura del agua", "Perfiles de apnea", "presión"],
  fr: ["Profondeur", "Durée", "Température de l’eau", "Profils d’apnée", "pression"],
  de: ["Tiefe", "Zeit", "Wassertemperatur", "Apnoe-Profile", "Druckprüfung"],
  "pt-BR": ["Profundidade", "Tempo de mergulho", "Temperatura da água", "mergulho livre", "pressão"],
  nl: ["Diepte", "Duiktijd", "Watertemperatuur", "Freediveprofielen", "Drukcheck"],
};

test("rapid steps use the latest index and stop at the ends", () => {
  assert.equal(applyCarousel(3, [{ type: "step", delta: 1 }, { type: "step", delta: 1 }, { type: "step", delta: 1 }]), 2);
  assert.equal(applyCarousel(3, Array.from({ length: 20 }, () => ({ type: "step" as const, delta: 1 }))), 2);
  assert.equal(applyCarousel(3, [{ type: "step", delta: 1 }, { type: "step", delta: 1 }, { type: "step", delta: -1 }]), 1);
  assert.equal(applyCarousel(3, [{ type: "step", delta: -1 }, { type: "step", delta: -1 }]), 0);
  const closedOverStart = [1, 1, 1].map(() => 0 + 1);
  assert.deepEqual(closedOverStart, [1, 1, 1]);
  assert.equal(applyCarousel(3, closedOverStart.map(() => ({ type: "step" as const, delta: 1 }))), 2);
  assert.deepEqual(endpointState(0, 3), { prevDisabled: true, nextDisabled: false });
  assert.deepEqual(endpointState(1, 3), { prevDisabled: false, nextDisabled: false });
  assert.deepEqual(endpointState(2, 3), { prevDisabled: false, nextDisabled: true });
  assert.deepEqual(endpointState(0, 1), { prevDisabled: true, nextDisabled: true });
  assert.deepEqual(endpointState(5, 3), { prevDisabled: false, nextDisabled: true });
});

test("keyboard moves one slide and leaves unrelated keys alone", () => {
  assert.deepEqual(reduceCarousel(0, 3, { type: "key", key: "ArrowRight" }), { index: 1, handled: true });
  assert.deepEqual(reduceCarousel(1, 3, { type: "key", key: "ArrowLeft" }), { index: 0, handled: true });
  assert.deepEqual(reduceCarousel(1, 3, { type: "key", key: "Home" }), { index: 0, handled: true });
  assert.deepEqual(reduceCarousel(0, 3, { type: "key", key: "End" }), { index: 2, handled: true });
  assert.deepEqual(reduceCarousel(2, 3, { type: "key", key: "ArrowRight" }), { index: 2, handled: true });
  assert.deepEqual(reduceCarousel(0, 3, { type: "key", key: "ArrowLeft" }), { index: 0, handled: true });
  for (const key of ["ArrowUp", "ArrowDown", "Tab", "PageDown", " ", "Enter"]) {
    assert.deepEqual(reduceCarousel(1, 3, { type: "key", key }), { index: 1, handled: false }, key);
  }
  assert.deepEqual(reduceCarousel(0, 3, { type: "key", key: "ArrowRight", modified: true }), { index: 0, handled: false });
});

test("keyboard and reduced motion are instant, and an in-flight scroll does not rewind", () => {
  assert.equal(carouselScrollBehavior({ reducedMotion: false, via: "pointer" }), "smooth");
  assert.equal(carouselScrollBehavior({ reducedMotion: true, via: "pointer" }), "auto");
  assert.equal(carouselScrollBehavior({ reducedMotion: false, via: "keyboard" }), "auto");
  assert.equal(measureStride(280, 14), 294);
  assert.equal(measureStride(0, 14), 0);
  assert.equal(measureStride(280, Number.NaN), 280);
  const stride = 300;
  assert.equal(scrollTarget(2, stride, 3), 600);
  const first = scrollEventIndex({ scrollLeft: 0, stride, count: 3, lock: { target: 600 }, current: 2 });
  assert.deepEqual(first, { index: 2, lock: { target: 600 } });
  const midway = scrollEventIndex({ scrollLeft: 300, stride, count: 3, lock: { target: 600 }, current: 2 });
  assert.equal(midway.index, 2);
  assert.notEqual(midway.lock, null);
  const arrived = scrollEventIndex({ scrollLeft: 600, stride, count: 3, lock: { target: 600 }, current: 2 });
  assert.deepEqual(arrived, { index: 2, lock: null });
  const manual = scrollEventIndex({ scrollLeft: 300, stride, count: 3, lock: null, current: 2 });
  assert.deepEqual(manual, { index: 1, lock: null });
  const resized = indexFromScroll(250, 200, 3);
  assert.equal(resized, 1);
  assert.equal(indexFromScroll(250, 100, 3), 2);
  const realigned = resizeAlignment(300, 1, 480, 3);
  assert.deepEqual(realigned, { target: 480, needsScroll: true });
  assert.equal(resizeAlignment(480, 1, 480, 3).needsScroll, false);
  assert.equal(indexFromScroll(-40, 100, 3), 0);
  assert.equal(indexFromScroll(20, 0, 3), 0);
});

test("every locale has three segment-safe slides and matching frames", () => {
  assert.deepEqual(Object.keys(FEATURE_CAROUSEL_COPY).sort(), [...SUPPORTED_LOCALES].sort());
  for (const locale of SUPPORTED_LOCALES) {
    const copy = featureCarouselCopy(locale);
    assert.notEqual(copy.heading.scuba, copy.heading.freediving, locale);
    assert.notEqual(copy.previous, copy.next, locale);
    assert.equal(copy.position.includes("{current}") && copy.position.includes("{total}"), true, locale);
    assert.equal(formatFeaturePosition(copy.position, 2, 3).includes("2"), true, locale);
    assert.equal(formatFeaturePosition(copy.position, 2, 3).includes("3"), true, locale);
    assert.deepEqual(copy.slides.scuba.map((slide) => slide.id), ["readings", "guidance", "logbook"], locale);
    assert.deepEqual(copy.slides.freediving.map((slide) => slide.id), ["readings", "logbook", "housing"], locale);
    for (const segment of ["scuba", "freediving"] as const) {
      assert.equal(copy.heading[segment].length <= 48, true, `${locale} ${segment} heading`);
      const plan = featureSlidePlan(segment, copy.slides[segment]);
      assert.equal(plan.length, 3, locale);
      const packed = copy.slides[segment].flatMap((slide) => [slide.title, ...slide.lines]).join("\n");
      assert.equal(DEEP_STOP.test(packed), false, `${locale} ${segment}`);
      for (const slide of copy.slides[segment]) {
        assert.equal(slide.lines.length >= 3 && slide.lines.length <= 4, true, `${locale} ${slide.id}`);
        for (const line of [slide.title, ...slide.lines]) {
          assert.equal(line.trim().length >= 2 && line.trim().length <= 64, true, `${locale} ${line}`);
        }
      }
      if (segment === "freediving") assert.equal(FREE_FORBIDDEN.test(packed), false, `${locale} ${packed}`);
    }
    const scubaText = copy.slides.scuba.flatMap((slide) => slide.lines).join("\n");
    for (const phrase of SCUBA_REQUIRED[locale]) assert.equal(scubaText.includes(phrase), true, `${locale} ${phrase}`);
    const freeText = copy.slides.freediving.flatMap((slide) => [slide.title, ...slide.lines]).join("\n");
    for (const phrase of FREE_REQUIRED[locale]) assert.equal(freeText.includes(phrase), true, `${locale} ${phrase}`);
    assert.deepEqual(FEATURE_SLIDE_FRAMES.scuba.map((frame) => frame.image), ["step2", "underwater", "loghand"]);
    assert.deepEqual(FEATURE_SLIDE_FRAMES.freediving.map((frame) => frame.image), ["buoy", "free-log", "gear"]);
    assert.equal(FEATURE_SLIDE_FRAMES.freediving.find((frame) => frame.id === "housing")?.layout, "stack");
    assert.equal(FEATURE_SLIDE_FRAMES.freediving.some((frame) => frame.image === "underwater" || frame.image === "loghand"), false);
    if (locale === "nl") {
      const guidance = copy.slides.scuba.find((slide) => slide.id === "guidance");
      assert.deepEqual(guidance?.lines, ["No-decompressietijd", "Veiligheidsstop", "Stijgwaarschuwing"]);
    }
    const media = mediaCopy(locale);
    assert.equal(featureSlideAlt("scuba", "guidance", media), media.benefitAlt.scuba[1], locale);
    assert.equal(featureSlideAlt("freediving", "housing", media), media.benefitAlt.freediving[0], locale);
    assert.equal(featureSlideAlt("freediving", "logbook", media).toLowerCase().includes("scuba"), false, locale);
  }
});

test("the carousel view does not autoplay or mount a video", () => {
  const view = readFileSync(new URL("../src/components/segments/SegmentFeatureCarousel.tsx", import.meta.url), "utf8");
  assert.equal(/autoPlay|autoplay|setInterval|<video|\.mp4|scuba-pool-overhead/.test(view), false);
  assert.match(view, /loading="lazy"/);
  assert.match(view, /ArrowLeft ArrowRight Home End/);
  assert.match(view, /carouselScrollBehavior/);
  assert.match(view, /scrollEventIndex/);
  assert.match(view, /aria-live="polite"/);
  assert.match(view, /buoy-1400\.webp/);
  assert.equal(view.includes("buoy-2200"), false);
  assert.equal(view.includes("scuba-pool-overhead"), false);
  const css = readFileSync(new URL("../src/components/segments/segments.css", import.meta.url), "utf8");
  assert.match(css, /\.wd-feature-track\{[^}]*scroll-snap-type:x mandatory/);
  assert.match(css, /\.wd-feature-nav button\{[^}]*min-width:48px/);
  assert.match(css, /@media\(max-width:389px\)/);
  assert.match(view, /data-feature-image=/);
  assert.match(css, /data-feature-image="loghand"[^}]*aspect-ratio:2\/3/);
});
