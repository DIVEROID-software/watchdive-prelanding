/** Media expansion checks. No browser, signup, mail, or network. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { BETA_REVIEWS_DE } from "../src/data/beta-reviews.de.ts";
import { BETA_REVIEWS_NL } from "../src/data/beta-reviews.nl.ts";
import { BETA_REVIEWS_ES } from "../src/data/beta-reviews.es.ts";
import { BETA_REVIEWS_FR } from "../src/data/beta-reviews.fr.ts";
import { BETA_REVIEWS_JA } from "../src/data/beta-reviews.ja.ts";
import { BETA_REVIEWS_KO } from "../src/data/beta-reviews.ko.ts";
import { BETA_REVIEWS_PT_BR } from "../src/data/beta-reviews.pt-BR.ts";
import { BETA_REVIEWS_ZH_CN } from "../src/data/beta-reviews.zh-CN.ts";
import { BETA_REVIEWS_ZH_TW } from "../src/data/beta-reviews.zh-TW.ts";
import { PUBLICATION_APPROVED_REVIEW_IDS, PUBLISHABLE_REVIEWS } from "../src/data/beta-reviews.ts";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { SEGMENT_COPY } from "../src/lib/segments/copy.ts";
import { SEGMENT_BETA_COPY } from "../src/lib/segments/beta-review-copy.ts";
import { MEDIA_COPY, mediaCopy } from "../src/lib/segments/media-copy.ts";
import { PRESS_LOGO_META } from "../src/lib/segments/press-logo-meta.ts";
import { loadSegmentReviewBodies } from "../src/lib/segments/review-bodies.ts";

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

test("every locale has distinct scuba and freediving captions and eight publisher logos", () => {
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
  assert.deepEqual(PRESS_LOGO_META.map(logo => logo.href), [
    "https://gearjunkie.com/emerging-gear/emerging-gear-10-30-2026",
    "https://www.thescubanews.com/2026/11/01/diveroid-watchdive-smartwatch-dive-computer-2026/",
    "https://xray-mag.com/content/watchdive-puts-dive-data-smartwatches",
    "https://www.tuttoandroid.net/news/2026/10/26/watchdive-diveroid-computer-subacqueo-smartwatch-kickstarter-1179439/",
    "https://techadvisor.com.br/watchdive-caixa-estanque-transforma-apple-watch-e-galaxy-watch-em-computador-de-mergulho",
    "https://www.teknotalk.com/watchdive-akilli-saat-dalis-bilgisayari-212212/",
    "https://www.estamosenlinea.co/2026/11/01/convierta-el-reloj-inteligente-que-ya-usa-en-una-computadora-de-buceo/",
    "https://www.scubatimes.co.kr/articles/diveroid-watchdive-aims-to-turn-everyday-smartwatches-into-mvxpzv11-2ow4dd",
  ]);
  assert.equal(PRESS_LOGO_META.find(logo => logo.id === "tech-advisor-brasil")?.name, "Tech Advisor Brasil");
  assert.equal(PRESS_LOGO_META.find(logo => logo.id === "scubatimes")?.coverageType, "licensed_translation");
  assert.equal(PRESS_LOGO_META.find(logo => logo.id === "scubatimes")?.syndicatedFrom, "The Scuba News");
  assert.deepEqual(PRESS_LOGO_META.filter(logo => logo.ground === "dark").map(logo => logo.id), ["gearjunkie", "x-ray-mag"]);
  assert.equal(PRESS_LOGO_META.find(logo => logo.id === "the-scuba-news")?.wide, true);
  const provenance = JSON.parse(read("src/assets/press/watchdive-20261104/PROVENANCE.json"));
  assert.equal(provenance.assets.length, 8);
  assert.deepEqual(PRESS_LOGO_META.map(logo => logo.file), provenance.assets.map((asset: { file: string }) => asset.file));
  assert.deepEqual(PRESS_LOGO_META.map(logo => logo.ground), provenance.assets.map((asset: { ground: string }) => asset.ground));
  for (const asset of provenance.assets) {
    const bytes = readFileSync(new URL(`src/assets/press/watchdive-20261104/${asset.file}`, root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.file);
  }
  const gear = read("src/assets/press/watchdive-20261104/gearjunkie.svg");
  assert.equal(/<image|xlink:href|href="http|<use/i.test(gear), false);
  assert.equal(mediaCopy("en").pressTitle, "As featured on");
  assert.equal(mediaCopy("ko").pressTitle, "미디어에 소개된 WatchDive");
  assert.equal(mediaCopy("ko").benefitAlt.freediving[2], "DIVEROID 앱의 프리다이빙 프로필");
  for (const locale of SUPPORTED_LOCALES) {
    const beta = SEGMENT_BETA_COPY[locale];
    assert.equal(/\b122\b|\b50\b/.test(`${beta.title} ${beta.context} ${beta.more}`), false, locale);
  }
  assert.equal(SEGMENT_BETA_COPY.en.title, "From our beta testers");
  assert.equal(SEGMENT_BETA_COPY.ko.title, "베타테스터의 이야기");
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
  const press = page.indexOf("<SegmentPress ");
  const benefits = page.indexOf('id="segment-benefits"');
  const how = page.indexOf('id="segment-how"');
  const features = page.indexOf("<SegmentFeatureCarousel ");
  const gallery = page.indexOf("<SegmentGallery ");
  const bottom = page.indexOf("signup('bottom').form");
  const demos = page.indexOf("<SegmentDemos ");
  const log = page.indexOf('id="segment-logbook"');
  const camera = page.indexOf('id="segment-camera"');
  const reviews = page.indexOf("<SegmentBetaReviews />");
  const cost = page.indexOf("<SegmentCostComparison");
  const prices = page.indexOf("signup('middle').prices");
  const faq = page.indexOf('id="segment-faq"');
  const end = page.indexOf("wd-segment-end-signup");
  assert.equal((page.match(/<SegmentPress /g) ?? []).length, 1);
  assert.equal((page.match(/<SegmentFeatureCarousel /g) ?? []).length, 1);
  assert.ok(hero < middle && middle < benefits && benefits < how && how < features && features < demos && demos < log && log < camera && camera < gallery && gallery < bottom && bottom < reviews && reviews < press && press < cost && cost < prices && prices < faq && faq < end);
  const surface = page.indexOf("<FreedivingSurfacePhoto ");
  assert.ok(surface > log && surface < camera);
  assert.ok(page.indexOf("<AcquisitionTools ") < features);
  assert.equal(page.slice(gallery, bottom).includes("SegmentBetaReviews"), false);
  assert.ok(end < page.indexOf("wd-segment-switch"));
  assert.equal((page.match(/<EmailForm /g) ?? []).length, 1);
  assert.match(page, /position === 'middle' && <PricePaths locale=\{locale\} referralOn=\{referralOn\} \/>/);
  assert.ok(page.indexOf("<HowPhotoRow />") < page.indexOf("<SegmentHowCompat "));
  assert.ok(page.indexOf("<SegmentHowInsert ") < page.indexOf('id="how-title"'));
  const media = read("src/components/segments/SegmentMedia.tsx");
  assert.match(media, /segment === 'scuba'/);
  assert.match(media, /loading="lazy"/);
  assert.equal(media.includes("<video"), false);
  assert.equal(media.includes("<button"), false);
  assert.equal(media.includes("autoPlay"), false);
  assert.equal(media.includes("element.play("), false);
  assert.equal(/\.mp4/.test(media), false);
  assert.match(page, /preload="none"/);
  assert.match(page, /element\.play\(\)/);
  assert.match(page, /onError/);
  assert.match(page, /connected-app\.mp4/);
  assert.match(read("src/components/segments/segments.css"), /prefers-reduced-motion/);
  assert.equal(media.includes("watchdive-functions"), false);
  assert.equal(/samsung|nvidia|aws/i.test(media + page), false);
});

test("new media stays small and names its source", () => {
  const dir = "src/assets/live/media-refresh-20261103/";
  const provenance = JSON.parse(read(`${dir}PROVENANCE.json`));
  assert.equal(provenance.outputs.length >= 10, true);
  const caps: Record<string, number> = { photo: 180_000, poster: 40_000, video: 400_000 };
  const bright = "scuba-pool-overhead-bright-2880.png";
  for (const item of provenance.outputs) {
    const file = statSync(new URL(dir + item.file, root));
    assert.equal(file.size, item.bytes, item.file);
    if (item.file === bright) {
      assert.equal(item.bytes, 1_543_532);
      assert.equal(item.width, 2880);
      assert.equal(item.height, 1608);
      assert.equal(createHash("sha256").update(readFileSync(new URL(dir + item.file, root))).digest("hex"), item.sha256);
    } else {
      assert.ok(file.size < caps[item.kind], `${item.file} is ${file.size}`);
    }
    assert.equal(typeof item.source_sha256, "string");
    assert.equal(item.source_sha256.length, 64);
  }
  const page = read("src/components/segments/SegmentMedia.tsx");
  for (const name of ["seal-poster-960.webp", "controls-poster-960.webp", "logbook-poster-960.webp", "buoy-1400.webp", "buoy-2200.webp"]) {
    assert.equal(page.includes(name), true, name);
  }
  const brightDelivery = [
    "scuba-pool-overhead-bright-800.webp",
    "scuba-pool-overhead-bright-1400.webp",
    "scuba-pool-overhead-bright-1800.webp",
    "scuba-pool-overhead-bright-2400.webp",
  ];
  for (const name of brightDelivery) assert.equal(page.includes(name), true, name);
  // The 2880 PNG stays the byte-for-byte master. It is not a gallery request.
  assert.equal(page.includes(bright), false);
  assert.match(page, /sizes: '100vw'/);
  assert.match(page, /800w, .*1400w, .*1800w, .*2400w/);
  const phoneCandidate = brightDelivery.map((name) => Number(name.match(/-(\d+)\.webp$/)?.[1])).sort((a, b) => a - b).find((width) => width >= 390 * 3);
  assert.equal(phoneCandidate, 1400);
  const phoneFile = provenance.outputs.find((item: { file: string }) => item.file === "scuba-pool-overhead-bright-1400.webp");
  assert.ok(phoneFile);
  assert.ok(phoneFile.bytes < 150_000, `390px at 3x would fetch ${phoneFile.bytes} bytes`);
  assert.equal(phoneFile.width, 1400);
  assert.equal(phoneFile.height, 782);
  assert.equal(phoneFile.source_sha256, provenance.outputs.find((item: { file: string }) => item.file === bright).sha256);
  for (const name of ["seal.mp4", "controls.mp4", "logbook.mp4"]) {
    assert.equal(page.includes(name), false, name);
  }
  assert.equal(page.includes("overhead-1800.webp"), false);
  assert.equal(page.includes("overhead-960.webp"), false);
  assert.match(page, /loading="lazy" decoding="async"/);
  const how = read("src/components/segments/SegmentHowInsert.tsx");
  assert.match(how, /<img src=\{poster\} alt=\{alt\} width=\{960\} height=\{540\} loading="lazy" decoding="async" \/>/);
});

const LOCALIZED_BODIES = {
  ko: BETA_REVIEWS_KO,
  "zh-CN": BETA_REVIEWS_ZH_CN,
  "zh-TW": BETA_REVIEWS_ZH_TW,
  ja: BETA_REVIEWS_JA,
  es: BETA_REVIEWS_ES,
  fr: BETA_REVIEWS_FR,
  de: BETA_REVIEWS_DE,
  "pt-BR": BETA_REVIEWS_PT_BR,
  nl: BETA_REVIEWS_NL,
} as const;

test("segment routes load the approved review language and keep the allowlist", async () => {
  assert.deepEqual(PUBLISHABLE_REVIEWS.map(({ id }) => id), [...PUBLICATION_APPROVED_REVIEW_IDS]);
  assert.equal(await loadSegmentReviewBodies("en"), undefined);
  for (const [locale, bodies] of Object.entries(LOCALIZED_BODIES)) {
    assert.strictEqual(await loadSegmentReviewBodies(locale as keyof typeof LOCALIZED_BODIES), bodies, locale);
  }
  const reviews = read("src/components/segments/SegmentBetaReviews.tsx");
  assert.match(reviews, /const VISIBLE_REVIEW_COUNT = 4;/);
  assert.match(reviews, /PUBLISHABLE_REVIEWS\.slice\(0, VISIBLE_REVIEW_COUNT\)/);
  assert.match(reviews, /PUBLISHABLE_REVIEWS\.slice\(VISIBLE_REVIEW_COUNT\)/);
  assert.match(reviews, /betaReviewBody\(review, bodies\)/);
  assert.equal(reviews.includes("INCLUDE_UNVERIFIED_CLAIMS"), false);
  assert.equal(reviews.includes("BETA_TESTER_COUNT"), false);
  assert.equal(/\bBETA_REVIEWS\b/.test(reviews), false);
  assert.equal(/marquee|autoPlay|<video|animate-/.test(reviews), false);
  assert.deepEqual(PUBLISHABLE_REVIEWS.slice(0, 4).map(({ id }) => id), [7, 35, 45, 63]);
  assert.deepEqual(PUBLISHABLE_REVIEWS.slice(4).map(({ id }) => id), [72, 88, 100, 120]);
  const route = read("src/lib/segments/route.ts");
  assert.match(route, /loadSegmentReviewBodies\(locale\)/);
  assert.match(route, /reviewBodies/);
  for (const file of ["src/routes/scuba.tsx", "src/routes/freediving.tsx", "src/routes/$locale.scuba.tsx", "src/routes/$locale.freediving.tsx"]) {
    const source = read(file);
    assert.match(source, /LocalizedBetaReviewBodiesProvider reviewBodies=\{reviewBodies\}/);
    assert.match(source, /Route\.useLoaderData\(\)/);
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
