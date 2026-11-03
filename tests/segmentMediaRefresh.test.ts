/** Media expansion checks. No browser, signup, mail, or network. */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { SEGMENT_COPY } from "../src/lib/segments/copy.ts";
import { MEDIA_COPY, PRESS_LINKS, mediaCopy } from "../src/lib/segments/media-copy.ts";

const DARK_TITLES: Record<Locale, string> = {
  en: "Be the first in line",
  ko: "가장 먼저 만나보세요",
  ja: "いち早く最新情報を。",
  "zh-CN": "抢先获取最新消息",
  "zh-TW": "搶先掌握最新消息",
  es: "Sé de los primeros.",
  fr: "Soyez parmi les premiers.",
  de: "Sei von Anfang an dabei.",
  "pt-BR": "Seja um dos primeiros.",
  nl: "Wees er als eerste bij.",
};

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("every locale has distinct scuba and freediving captions and the two press links", () => {
  assert.equal(Object.keys(MEDIA_COPY).length, SUPPORTED_LOCALES.length);
  for (const locale of SUPPORTED_LOCALES) {
    const copy = mediaCopy(locale);
    assert.equal(copy.benefitAlt.scuba.length, 3, locale);
    assert.equal(copy.benefitAlt.freediving.length, 3, locale);
    assert.equal(copy.galleryAlt.scuba.length, 1, locale);
    assert.equal(copy.galleryAlt.freediving.length, 1, locale);
    assert.equal(copy.logStillAlt.length > 8, true, locale);
    assert.notEqual(copy.galleryTitle.scuba, copy.galleryTitle.freediving, locale);
    assert.equal(copy.logClip.body.toLowerCase().includes("freediv") || copy.logClip.title.toLowerCase().includes("프리"), false);
    for (const value of [
      ...copy.benefitAlt.scuba,
      ...copy.benefitAlt.freediving,
      ...copy.galleryAlt.scuba,
      ...copy.galleryAlt.freediving,
      copy.seal.title, copy.seal.body, copy.controls.body, copy.clipError, copy.pressTitle,
    ]) {
      assert.equal(value.trim().length > 8, true, `${locale} empty caption`);
    }
    const packed = JSON.stringify(copy);
    assert.equal(/samsung|nvidia|aws|perfect diving|500 dives|guaranteed safety/i.test(packed), false, locale);
  }
  assert.deepEqual(PRESS_LINKS.map(link => link.href), [
    "https://www.thescubanews.com/2026/11/01/diveroid-watchdive-smartwatch-dive-computer-2026/",
    "https://xray-mag.com/content/watchdive-puts-dive-data-smartwatches",
  ]);
  assert.equal(mediaCopy("ko").benefitAlt.freediving[2], "DIVEROID 앱의 프리다이빙 프로필");
});

test("the page keeps the old phase, adds a visual phase, and puts the first form before the long media", () => {
  const page = read("src/components/segments/SegmentLanding.tsx");
  assert.match(page, /data-landing-phase="segments-mobile-20261025"/);
  assert.match(page, /data-visual-phase="media-rich-20261103"/);
  assert.equal((page.match(/data-landing-phase=/g) ?? []).length, 1);
  assert.match(page, /id=\{position === 'middle' \? 'hero' : 'offer'\}/);
  assert.equal((page.match(/<EmailForm /g) ?? []).length, 1);
  const hero = page.indexOf('id="segment-hero"');
  const middle = page.indexOf("signup('middle').form");
  const benefits = page.indexOf('id="segment-benefits"');
  const how = page.indexOf('id="segment-how"');
  const gallery = page.indexOf("<SegmentGallery ");
  const bottom = page.indexOf("signup('bottom').form");
  const demos = page.indexOf("<SegmentDemos ");
  const cost = page.indexOf("<SegmentCostComparison");
  const prices = page.indexOf("signup('middle').prices");
  const faq = page.indexOf('id="segment-faq"');
  const end = page.indexOf("wd-segment-end-signup");
  assert.ok(hero < middle && middle < benefits && benefits < how && how < gallery && gallery < bottom && bottom < demos && demos < cost && cost < prices && prices < faq && faq < end);
  assert.ok(end < page.indexOf("wd-segment-switch"));
  assert.equal((page.match(/<EmailForm /g) ?? []).length, 1);
  assert.match(page, /position === 'middle' && <PricePaths locale=\{locale\} referralOn=\{referralOn\} \/>/);
  assert.ok(page.indexOf("<HowPhotoRow />") < page.indexOf("<SegmentHowCompat "));
  assert.ok(page.indexOf("<SegmentHowInsert ") < page.indexOf('id="how-title"'));
  const media = read("src/components/segments/SegmentMedia.tsx");
  const css = read("src/components/segments/segments.css");
  assert.match(media, /segment === 'scuba'/);
  assert.match(media, /preload="none"/);
  assert.match(media, /playsInline/);
  assert.match(media, /loading="lazy"/);
  // No DOM harness. These source contracts lock the playback decision and the
  // removed index labels. Reduced motion stays in the page CSS, not this clip.
  assert.equal(media.includes("useReducedMotion"), false);
  assert.equal(media.includes("prefers-reduced-motion"), false);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.equal(page.includes("wd-segment-eyebrow"), false);
  assert.equal(page.includes("wd-segment-number"), false);
  assert.equal(media.includes("wd-segment-eyebrow"), false);
  assert.match(page, /<ol>\{[\s\S]*\{i \+ 1\}/);
  assert.equal(css.includes("wd-segment-marker-pulse"), false);
  assert.match(css, /\.wd-segment-page \.wd-segment-eyebrow\{display:none\}/);
  assert.match(media, /sizes="\(min-width:960px\) calc\(\(min\(1120px, 100vw - 96px\) - 28px\) \/ 3\), \(max-width:359px\) calc\(100vw - 32px\), min\(650px, calc\(100vw - 48px\)\)"/);
  assert.equal(media.includes("32vw"), false);
  const playback = media.slice(media.indexOf("const attempt = element.play()"), media.indexOf("const pauseIfHidden"));
  assert.equal(playback.includes("setFailed"), false);
  assert.match(media, /element\.focus\(\{ preventScroll: true \}\)/);
  assert.match(media, /retryRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(media, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.equal(media.includes("autoPlay"), true);
  assert.equal(media.includes("autoPlay={!reduced}"), false);
  assert.match(media, /element\.play\(\)/);
  assert.equal(media.includes("watchdive-functions"), false);
  assert.equal(/samsung|nvidia|aws/i.test(media + page), false);
});

test("new media stays small and names its source", () => {
  const dir = "src/assets/live/media-refresh-20261103/";
  const provenance = JSON.parse(read(`${dir}PROVENANCE.json`));
  assert.equal(provenance.outputs.length >= 10, true);
  const caps: Record<string, number> = { photo: 180_000, poster: 40_000, video: 400_000 };
  for (const item of provenance.outputs) {
    const file = statSync(new URL(dir + item.file, root));
    assert.equal(file.size, item.bytes, item.file);
    assert.ok(file.size < caps[item.kind], `${item.file} is ${file.size}`);
    assert.equal(typeof item.source_sha256, "string");
    assert.equal(item.source_sha256.length, 64);
  }
  const page = read("src/components/segments/SegmentMedia.tsx");
  for (const name of ["seal.mp4", "controls.mp4", "logbook.mp4", "buoy-1400.webp", "buoy-2200.webp", "overhead-1800.webp"]) {
    assert.equal(page.includes(name), true, name);
  }
});

const LAUNCH_BODIES: Record<Locale, string> = {
  en: "We'll email you the WatchDive Kickstarter launch link.",
  ko: "WatchDive Kickstarter 출시 링크를 이메일로 보내드립니다.",
  "zh-CN": "我们会把 WatchDive 的 Kickstarter 上线链接发到你的邮箱。",
  "zh-TW": "我們會把 WatchDive 的 Kickstarter 上線連結寄到你的信箱。",
  ja: "WatchDiveのKickstarter公開リンクをメールでお送りします。",
  es: "Te enviamos por correo el enlace de lanzamiento de WatchDive en Kickstarter.",
  fr: "Nous vous envoyons par e-mail le lien de lancement WatchDive sur Kickstarter.",
  de: "Wir senden dir den WatchDive-Link für den Kickstarter-Start per E-Mail.",
  "pt-BR": "Enviamos por e-mail o link de lançamento do WatchDive no Kickstarter.",
  nl: "Je krijgt de WatchDive-lanceringslink op Kickstarter per e-mail.",
};

const SEAL_BODIES: Record<Locale, string> = {
  en: "Before the dive, the housing runs a pressure check and shows the result on the watch.",
  ko: "입수 전에 하우징이 압력을 확인하고, 그 결과를 워치 화면에 보여 줍니다.",
  "zh-CN": "下水前，外壳会做一次压力检查，并把结果显示在手表上。",
  "zh-TW": "下水前，外殼會做一次壓力檢查，並把結果顯示在手錶上。",
  ja: "入水前にハウジングが圧力を確認し、その結果をウォッチに表示します。",
  es: "Antes de bucear, la carcasa hace una comprobación de presión y muestra el resultado en el reloj.",
  fr: "Avant la plongée, le boîtier lance un contrôle de pression et affiche le résultat sur la montre.",
  de: "Vor dem Tauchgang prüft das Gehäuse den Druck und zeigt das Ergebnis auf der Uhr.",
  "pt-BR": "Antes do mergulho, a caixa faz uma checagem de pressão e mostra o resultado no relógio.",
  nl: "Voor de duik doet de behuizing een drukcheck en toont het resultaat op het horloge.",
};

test("dark signup titles follow the root review and the launch bodies stay", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const segment of ["scuba", "freediving"] as const) {
      const copy = SEGMENT_COPY[locale][segment];
      assert.equal(copy.finalTitle, DARK_TITLES[locale], `${locale} ${segment}`);
      assert.equal(copy.finalBody, LAUNCH_BODIES[locale], `${locale} ${segment}`);
    }
    assert.equal(mediaCopy(locale).seal.body, SEAL_BODIES[locale], locale);
  }
  assert.match(SEGMENT_COPY.ja.scuba.finalBody, /WatchDive/);
  assert.match(SEGMENT_COPY.ja.freediving.finalBody, /WatchDive/);
});
