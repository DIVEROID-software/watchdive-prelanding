/** Media expansion checks. No browser, signup, mail, or network. */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { MEDIA_COPY, PRESS_LINKS, mediaCopy } from "../src/lib/segments/media-copy.ts";

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
  assert.match(media, /segment === 'scuba'/);
  assert.match(media, /preload="none"/);
  assert.match(media, /loading="lazy"/);
  assert.match(media, /prefers-reduced-motion/);
  assert.equal(media.includes("autoPlay"), true);
  assert.equal(media.includes("autoPlay={!reduced}"), false);
  assert.match(media, /element\.play\(\)/);
  assert.match(media, /onError/);
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
