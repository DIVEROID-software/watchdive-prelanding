/** Local segment cleanup checks. No signup, mail, payment, or network. */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { segmentCopy } from "../src/lib/segments/copy.ts";
import { RETARGETING_COPY } from "../src/components/retargeting/copy.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const INTRO = {
  en: "Turn the Apple Watch or Galaxy Watch you already have into a dive computer. It doesn't have to be an Ultra.",
  ko: "가지고 있는 Apple Watch / Galaxy Watch를 다이브 컴퓨터로 바꿔보세요. 울트라가 아니어도 됩니다.",
  "zh-CN": "把你已有的 Apple Watch 或 Galaxy Watch 变成潜水电脑。不必是 Ultra。",
  "zh-TW": "把你已有的 Apple Watch 或 Galaxy Watch 變成潛水電腦。不必是 Ultra。",
  ja: "お持ちの Apple Watch または Galaxy Watch をダイブコンピュータに。Ultra である必要はありません。",
  es: "Convierte el Apple Watch o Galaxy Watch que ya tienes en un ordenador de buceo. No hace falta que sea un Ultra.",
  fr: "Transformez l’Apple Watch ou la Galaxy Watch que vous avez déjà en ordinateur de plongée. Ce n’est pas forcément une Ultra.",
  de: "Machen Sie die Apple Watch oder Galaxy Watch, die Sie schon haben, zum Tauchcomputer. Es muss kein Ultra sein.",
  "pt-BR": "Transforme o Apple Watch ou Galaxy Watch que você já tem em um computador de mergulho. Não precisa ser um Ultra.",
  nl: "Maak van de Apple Watch of Galaxy Watch die je al hebt een duikcomputer. Het hoeft geen Ultra te zijn.",
} as const;

test("both segments share the new intro and a logo token in the how title", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const segment of ["freediving", "scuba"] as const) {
      const copy = segmentCopy(locale, segment);
      assert.equal(copy.intro, INTRO[locale], `${locale} ${segment}`);
      assert.match(copy.howTitle, /\{logo\}/);
      assert.equal(copy.howTitle.includes("WatchDive"), false, copy.howTitle);
    }
  }
  assert.equal(segmentCopy("ko", "scuba").title.includes("매일 쓰는 스마트워치"), true);
});

test("the segment page matches the cleanup structure", () => {
  const page = read("src/components/segments/SegmentLanding.tsx");
  const hero = page.slice(page.indexOf('id="segment-hero"'), page.indexOf('id="segment-benefits"'));
  assert.equal(hero.includes("wd-segment-next-price"), false);
  assert.equal(hero.includes("wd-segment-explore"), false);
  assert.equal(hero.includes("WATCHDIVE /"), false);
  assert.ok(hero.indexOf("wd-segment-intro") < hero.indexOf("wd-segment-hero-offer"));
  assert.ok(hero.indexOf("wd-segment-hero-offer") < hero.indexOf("wd-segment-hero-jump"));
  assert.ok(hero.indexOf("SegmentHeroMedia") < hero.indexOf("wd-segment-hero-usp"));
  assert.equal(page.includes("wordmark"), false);
  assert.match(page, /<LanguageSwitcher variant="code" \/>/);
  assert.ok(page.indexOf("wd-segment-modes") < page.indexOf('LanguageSwitcher variant="code"'));
  assert.match(page, /<AcquisitionTools compatibility=\{false\} \/>/);
  assert.match(page, /<SegmentHowInsert alt=\{m\.how\.step1Alt\} \/>/);
  assert.match(page, /<SegmentHowCompat /);
  assert.match(page, /<WatchDiveLogo tone=\{isFree \? 'on-light' : 'on-dark'\} \/>/);
  assert.equal((page.match(/wd-segment-next-price/g) ?? []).length, 1);
  const how = page.slice(page.indexOf('id="segment-how"'), page.indexOf("<SegmentCostComparison"));
  assert.ok(how.indexOf("SegmentHowInsert") < how.indexOf('id="how-title"'));
  assert.ok(how.indexOf('id="how-title"') < how.indexOf("SegmentHowCompat"));
});

test("WatchDive is the first comparison card and the insert clip is the short silent cut", () => {
  const comparison = read("src/components/segments/SegmentCostComparison.tsx");
  const panels = comparison.slice(comparison.indexOf('id="subscription-panels"'));
  assert.ok(panels.indexOf("wd-subscription-watch") < panels.indexOf("Apple Watch Ultra"));
  const clip = statSync(new URL("src/assets/live/segment-heroes/housing-insert.mp4", root));
  const poster = statSync(new URL("src/assets/live/segment-heroes/housing-insert-poster.jpg", root));
  assert.ok(clip.size < 1_000_000, `clip is ${clip.size} bytes`);
  assert.ok(poster.size < 80_000);
  const insert = read("src/components/segments/SegmentHowInsert.tsx");
  assert.match(insert, /prefers-reduced-motion/);
  assert.match(insert, /playsInline/);
  assert.match(insert, /muted/);
  assert.match(insert, /useState\(true\)/);
});

test("the how form reuses the checker and the Korean email CTA", () => {
  assert.equal(RETARGETING_COPY.ko.request, "이메일로 결과 받기");
  assert.match(RETARGETING_COPY.es.request, /correo/);
  assert.match(RETARGETING_COPY.fr.request, /e-mail/);
  assert.match(RETARGETING_COPY["pt-BR"].request, /e-mail/);
  const checker = read("src/components/retargeting/CompatibilityChecker.tsx");
  assert.match(checker, /alwaysShowEmail/);
  assert.match(checker, /role="alert"/);
  const form = read("src/components/segments/SegmentHowCompat.tsx");
  assert.match(form, /domId="segment-how-compatibility"/);
  assert.match(form, /aria-expanded=\{open\}/);
  assert.match(form, /aria-controls="segment-how-compat-panel"/);
  assert.match(form, /getAcquisitionReadiness/);
  const email = read("src/routes/index.tsx");
  assert.match(email, /if \(beforeSubmit && !beforeSubmit\(\)\) return;/);
  assert.match(email, /<EmailForm id="hero" domId="compatibility-checker" compact compatibility=\{request\}/);
  assert.match(email, /compatibility && ready\.compatibility && <CompatibilityChecker/);
});
