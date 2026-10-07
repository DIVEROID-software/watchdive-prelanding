import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FROZEN_LANDING_MESSAGES } from "../src/lib/i18n/frozen-landing-messages.ts";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenedText).join("\n");
  if (isRecord(value)) return Object.values(value).map(flattenedText).join("\n");
  return "";
}

function stringLeaves(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => stringLeaves(child, `${path}[${index}]`));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    stringLeaves(child, path ? `${path}.${key}` : key),
  );
}

const PRIMARY_TERMS = {
  en: { housing: /housing/iu, sensor: /sensor/iu },
  ko: { housing: /하우징/u, sensor: /센서/u },
  "zh-CN": { housing: /外壳/u, sensor: /传感器/u },
  "zh-TW": { housing: /外殼/u, sensor: /感測器/u },
  ja: { housing: /ハウジング/u, sensor: /センサー/u },
  es: { housing: /carcasa/iu, sensor: /sensor/iu },
  fr: { housing: /caisson/iu, sensor: /capteur/iu },
  de: { housing: /Gehäuse/iu, sensor: /Sensor/iu },
  "pt-BR": { housing: /caixa/iu, sensor: /sensor/iu },
} as const satisfies Record<Locale, { housing: RegExp; sensor: RegExp }>;

const CARD_STATE = {
  en: {
    available: "This launch",
    comingSoon: /Later/u,
    unavailable: /not in this launch/iu,
  },
  ko: {
    available: "이번 출시",
    comingSoon: /추후 지원/u,
    unavailable: /이번 출시에는 없습니다/u,
  },
  "zh-CN": {
    available: "本次发售",
    comingSoon: /后续支持/u,
    unavailable: /本次不提供/u,
  },
  "zh-TW": {
    available: "本次發售",
    comingSoon: /後續支援/u,
    unavailable: /本次不提供/u,
  },
  ja: {
    available: "今回の発売",
    comingSoon: /後日対応/u,
    unavailable: /今回は対象外/u,
  },
  es: {
    available: "En este lanzamiento",
    comingSoon: /Más adelante/iu,
    unavailable: /no entra en este lanzamiento/iu,
  },
  fr: {
    available: "Dans ce lancement",
    comingSoon: /Plus tard/u,
    unavailable: /pas dans ce lancement/iu,
  },
  de: {
    available: "In diesem Launch",
    comingSoon: /Später/u,
    unavailable: /nicht in diesem Launch/iu,
  },
  "pt-BR": {
    available: "Neste lançamento",
    comingSoon: /Mais adiante/u,
    unavailable: /não entra neste lançamento/iu,
  },
} as const satisfies Record<Locale, { available: string; comingSoon: RegExp; unavailable: RegExp }>;

const WATER_RESISTANCE_TEST = {
  en: /water-resistance test/iu,
  ko: /방수 테스트/u,
  "zh-CN": /防水测试/u,
  "zh-TW": /防水測試/u,
  ja: /防水テスト/u,
  es: /prueba de resistencia al agua/iu,
  fr: /test d[’']étanchéité/iu,
  de: /Dichtigkeitstest/iu,
  "pt-BR": /teste de resistência à água/iu,
} as const satisfies Record<Locale, RegExp>;

const DEPTH_VALUE = /197\s*ft|60\s*(?:m\b|米|公尺)/iu;

test("headlines carry the product name and the explanation names the housing and DIVEROID sensor", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    const headlines = {
      "meta.title": messages.meta.title,
      "meta.ogTitle": messages.meta.ogTitle,
      "meta.twitterTitle": messages.meta.twitterTitle,
      "hero.h1": messages.hero.h1,
    };
    const explanations = {
      "meta.description": messages.meta.description,
      "meta.ogDescription": messages.meta.ogDescription,
      "meta.twitterDescription": messages.meta.twitterDescription,
      "hero.sub": messages.hero.sub,
    };

    for (const [path, copy] of Object.entries(headlines)) {
      assert.match(copy, /Watch Dive/u, `${locale}.${path}: product name missing`);
    }
    for (const [path, copy] of Object.entries(explanations)) {
      assert.match(copy, PRIMARY_TERMS[locale].housing, `${locale}.${path}: housing missing`);
      assert.match(copy, /DIVEROID/u, `${locale}.${path}: DIVEROID missing`);
      assert.match(copy, PRIMARY_TERMS[locale].sensor, `${locale}.${path}: sensor missing`);
    }
  }
});

test("Housing + App is available before the unavailable App Only model path in every locale", () => {
  const expectedAppOnlyModels = [
    "Apple Watch Ultra",
    "Apple Watch Ultra 2, Apple Watch Ultra 3",
    "Galaxy Watch Ultra2",
  ] as const;

  for (const locale of SUPPORTED_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    const { compat } = messages;
    const state = CARD_STATE[locale];

    assert.equal(compat.housingBadge, state.available, `${locale}: available badge drift`);
    assert.match(compat.appOnlyTitle, state.comingSoon, `${locale}: coming-soon title missing`);
    assert.match(compat.appOnlyBody, state.unavailable, `${locale}: unavailable body missing`);
    assert.deepEqual(
      [compat.appOnlyModel1, compat.appOnlyModel2, compat.appOnlyModel3],
      expectedAppOnlyModels,
      `${locale}: App Only model list drift`,
    );
  }
});

test("the compatibility FAQ orders the available housing route before the App Only prelaunch route", () => {
  const appOnlyModels = [
    "Apple Watch Ultra",
    "Apple Watch Ultra 2",
    "Apple Watch Ultra 3",
    "Galaxy Watch Ultra2",
  ] as const;

  for (const locale of SUPPORTED_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    const state = CARD_STATE[locale];
    const faq = messages.faq.a6;
    const housingIndex = faq.indexOf("Galaxy Watch4");
    const comingSoonIndex = faq.search(state.comingSoon);

    assert.ok(housingIndex >= 0, `${locale}: housing models missing from FAQ`);
    assert.ok(
      comingSoonIndex > housingIndex,
      `${locale}: App Only precedes available housing path`,
    );
    assert.match(faq, state.unavailable, `${locale}: FAQ omits unavailable status`);
    for (const model of appOnlyModels) {
      assert.ok(
        faq.indexOf(model, comingSoonIndex) >= comingSoonIndex,
        `${locale}: ${model} is not confined to the App Only prelaunch clause`,
      );
    }
  }
});

test("Apple model copy does not describe approval, review or entitlement status", () => {
  const forbiddenStatus =
    /entitlement|approv(?:al|ed|ing)?|review|승인|심사|심의|审核|审查|批准|審核|審查|核准|承認|審査|レビュー|aprobaci[oó]n|revisi[oó]n|approbation|examen|Genehmigung|Freigabe|Prüfung|aprovação|análise|revisão/iu;

  for (const locale of SUPPORTED_LOCALES) {
    for (const [path, copy] of stringLeaves(FROZEN_LANDING_MESSAGES[locale])) {
      if (!copy.includes("Apple")) continue;
      assert.doesNotMatch(copy, forbiddenStatus, `${locale}.${path}: forbidden Apple status copy`);
    }
  }
});

test("197 ft and 60 m values stay confined to housing water-resistance test contexts", () => {
  const expectedDepthPaths = [
    "faq.a2",
    "hero.stat1Label",
    "safety.point1Body",
    "safety.point1Title",
    // 2026-10-08: the hero proof strip repeats the housing test, in its own words.
    "usp.wristBody",
  ];

  for (const locale of SUPPORTED_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    const depthPaths = stringLeaves(messages)
      .filter(([, copy]) => DEPTH_VALUE.test(copy))
      .map(([path]) => path)
      .sort();
    assert.deepEqual(
      depthPaths,
      expectedDepthPaths,
      `${locale}: depth value escaped proof surfaces`,
    );

    for (const [path, copy] of [
      ["hero.stat1", `${messages.hero.stat1Label} ${messages.hero.stat1Desc}`],
      ["safety.point1", `${messages.safety.point1Title} ${messages.safety.point1Body}`],
      ["faq.a2", messages.faq.a2],
      ["usp.wristBody", messages.usp.wristBody],
    ] as const) {
      assert.match(copy, PRIMARY_TERMS[locale].housing, `${locale}.${path}: housing missing`);
      assert.match(copy, WATER_RESISTANCE_TEST[locale], `${locale}.${path}: test context missing`);
    }

    assert.doesNotMatch(
      flattenedText(messages.compat),
      DEPTH_VALUE,
      `${locale}: depth value appears around App Only`,
    );
  }
});

test("the visually secondary App Only card has no CTA or form connection", () => {
  const source = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const compatibilityStart = source.indexOf("function Compatibility()");
  const compatibilityEnd = source.indexOf("function ActionCameras()", compatibilityStart);
  assert.ok(compatibilityStart >= 0 && compatibilityEnd > compatibilityStart);

  const compatibility = source.slice(compatibilityStart, compatibilityEnd);
  const titleMarker = compatibility.indexOf("{m.compat.appOnlyTitle}");
  const cardStart = compatibility.lastIndexOf('<div className="flex items-start', titleMarker);
  const cardEnd = compatibility.indexOf("{m.compat.footnote}", titleMarker);
  assert.ok(cardStart >= 0 && cardEnd > cardStart, "App Only card source not found");

  const appOnlyCard = compatibility.slice(cardStart, cardEnd);
  assert.match(appOnlyCard, /border-dashed border-border\/50 bg-muted\/20/u);
  assert.match(appOnlyCard, /grayscale opacity-50/u);
  assert.doesNotMatch(
    appOnlyCard,
    /<a\b|<button\b|<Link\b|<EmailForm\b|\b(?:href|to)=|#offer-form/u,
  );
});
