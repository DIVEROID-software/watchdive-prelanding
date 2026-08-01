import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { BETA_REVIEWS_DE } from "../src/data/beta-reviews.de.ts";
import { BETA_REVIEWS_ES } from "../src/data/beta-reviews.es.ts";
import { BETA_REVIEWS_FR } from "../src/data/beta-reviews.fr.ts";
import { BETA_REVIEWS_JA } from "../src/data/beta-reviews.ja.ts";
import { BETA_REVIEWS_KO } from "../src/data/beta-reviews.ko.ts";
import { BETA_REVIEWS_PT_BR } from "../src/data/beta-reviews.pt-BR.ts";
import { BETA_REVIEWS_ZH_CN } from "../src/data/beta-reviews.zh-CN.ts";
import { BETA_REVIEWS_ZH_TW } from "../src/data/beta-reviews.zh-TW.ts";
import {
  betaReviewBody,
  loadLocalizedBetaReviewBodies,
  type LocalizedBetaReviewBodies,
} from "../src/data/beta-reviews.loader.ts";
import {
  BETA_REVIEWS,
  PUBLICATION_APPROVED_REVIEW_IDS,
  PUBLISHABLE_REVIEWS,
} from "../src/data/beta-reviews.ts";
import { FROZEN_LANDING_MESSAGES } from "../src/lib/i18n/frozen-landing-messages.ts";
import type { Locale } from "../src/lib/i18n/locale.ts";

const localizedBodies = {
  ko: BETA_REVIEWS_KO,
  "zh-CN": BETA_REVIEWS_ZH_CN,
  "zh-TW": BETA_REVIEWS_ZH_TW,
  ja: BETA_REVIEWS_JA,
  es: BETA_REVIEWS_ES,
  fr: BETA_REVIEWS_FR,
  de: BETA_REVIEWS_DE,
  "pt-BR": BETA_REVIEWS_PT_BR,
} as const satisfies Record<Exclude<Locale, "en">, LocalizedBetaReviewBodies>;

const expectedIds = PUBLISHABLE_REVIEWS.map(({ id }) => id).sort((left, right) => left - right);

test("the approved testimonial set and claims gate remain unchanged", () => {
  assert.equal(BETA_REVIEWS.length, 122);
  assert.equal(PUBLISHABLE_REVIEWS.length, 8);
  assert.equal(BETA_REVIEWS.length - PUBLISHABLE_REVIEWS.length, 114);
  assert.deepEqual(
    PUBLISHABLE_REVIEWS.map(({ id }) => id),
    [...PUBLICATION_APPROVED_REVIEW_IDS],
  );
  assert.equal(new Set(BETA_REVIEWS.map(({ id }) => id)).size, BETA_REVIEWS.length);
});

test("every localized review module joins exactly once to every immutable review id", () => {
  for (const [locale, bodies] of Object.entries(localizedBodies)) {
    const actualIds = Object.keys(bodies)
      .map(Number)
      .sort((left, right) => left - right);
    assert.deepEqual(actualIds, expectedIds, `${locale}: review id coverage drift`);

    for (const review of PUBLISHABLE_REVIEWS) {
      const body = bodies[review.id];
      assert.ok(typeof body === "string", `${locale}: review ${review.id} is missing`);
      assert.ok(body.trim().length > 0, `${locale}: review ${review.id} is blank`);
      assert.notEqual(body, review.en, `${locale}: review ${review.id} fell back to English`);
    }
  }
});

test("review 100 stays explicitly framed as the reviewer's opinion", () => {
  const opinionMarkers: Record<Exclude<Locale, "en">, RegExp> = {
    ko: /제 생각에는/,
    "zh-CN": /我觉得/,
    "zh-TW": /我認為/,
    ja: /と思います/,
    es: /creo que/i,
    fr: /je pense/i,
    de: /ich denke/i,
    "pt-BR": /acho que/i,
  };
  for (const [locale, pattern] of Object.entries(opinionMarkers)) {
    assert.match(
      localizedBodies[locale as Exclude<Locale, "en">][100] ?? "",
      pattern,
      `${locale}: an opinion was strengthened into a factual market claim`,
    );
  }
});

test("the route loader returns only the requested review language", async () => {
  assert.equal(await loadLocalizedBetaReviewBodies("en"), undefined);
  for (const [locale, expected] of Object.entries(localizedBodies)) {
    assert.strictEqual(
      await loadLocalizedBetaReviewBodies(locale as Exclude<Locale, "en">),
      expected,
      `${locale}: loader returned the wrong module`,
    );
  }
});

test("a missing or blank localized body safely falls back to the English rendering", () => {
  const review = PUBLISHABLE_REVIEWS[0];
  assert.ok(review);
  assert.equal(betaReviewBody(review), review.en);
  assert.equal(betaReviewBody(review, {}), review.en);
  assert.equal(betaReviewBody(review, { [review.id]: "   " }), review.en);
  assert.equal(betaReviewBody(review, { [review.id]: "  번역문  " }), "번역문");
});

test("every language displays an explicit translation notice", () => {
  const noticePatterns: Record<Locale, RegExp> = {
    en: /translation notice/i,
    ko: /번역 안내/,
    "zh-CN": /翻译说明/,
    "zh-TW": /翻譯說明/,
    ja: /翻訳について/,
    es: /aviso de traducción/i,
    fr: /note de traduction/i,
    de: /übersetzungshinweis/i,
    "pt-BR": /aviso de tradução/i,
  };
  const nuancePatterns: Record<Locale, RegExp> = {
    en: /tone or nuance/i,
    ko: /어조나 뉘앙스/,
    "zh-CN": /语气和细微含义/,
    "zh-TW": /語氣與細微含義/,
    ja: /語調や細かなニュアンス/,
    es: /tono o ciertos matices/i,
    fr: /ton ou certaines nuances/i,
    de: /Ton und Nuancen/,
    "pt-BR": /tom ou algumas nuances/i,
  };
  const heroMarkers: Record<Locale, RegExp> = {
    en: /translated/i,
    ko: /번역/,
    "zh-CN": /译文/,
    "zh-TW": /譯文/,
    ja: /翻訳/,
    es: /traducidas/i,
    fr: /traduits/i,
    de: /übersetzt/i,
    "pt-BR": /traduzidas/i,
  };

  for (const [locale, pattern] of Object.entries(noticePatterns)) {
    const messages = FROZEN_LANDING_MESSAGES[locale as Locale];
    const sub = messages.reviews.sub;
    assert.match(sub, pattern, `${locale}: visible translation notice is missing`);
    assert.match(sub, nuancePatterns[locale as Locale], `${locale}: nuance caveat is missing`);
    assert.match(
      messages.heroProof.readAll,
      heroMarkers[locale as Locale],
      `${locale}: above-the-fold reviews are not marked as translated`,
    );
  }
  assert.doesNotMatch(FROZEN_LANDING_MESSAGES.en.reviews.h2, /in the water/i);
  assert.doesNotMatch(FROZEN_LANDING_MESSAGES.ko.reviews.h2, /물속/);
});

test("localized review data is landing-only without changing the testimonial DOM", () => {
  const parentRoute = readFileSync(new URL("../src/routes/$locale.tsx", import.meta.url), "utf8");
  const landingRoute = readFileSync(
    new URL("../src/routes/$locale.index.tsx", import.meta.url),
    "utf8",
  );
  const ticker = readFileSync(
    new URL("../src/components/review-ticker.tsx", import.meta.url),
    "utf8",
  );
  const landing = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const loader = readFileSync(
    new URL("../src/data/beta-reviews.loader.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(parentRoute, /loadLocalizedBetaReviewBodies/);
  assert.match(landingRoute, /loadLocalizedBetaReviewBodies\(locale\)/);
  assert.match(landingRoute, /LocalizedBetaReviewBodiesProvider reviewBodies=\{reviewBodies\}/);
  assert.match(ticker, /betaReviewBody\(review, reviewBodies\)/);
  assert.match(landing, /betaReviewBody\(review, reviewBodies\)/);
  assert.doesNotMatch(loader, /^import \{ BETA_REVIEWS_/m);
  for (const locale of Object.keys(localizedBodies)) {
    assert.match(loader, new RegExp(`import\\(\\"\\./beta-reviews\\.${locale}\\.ts\\"\\)`));
  }
});
