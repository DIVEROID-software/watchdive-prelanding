import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { autoLocaleRedirect } from "../src/lib/i18n/auto-locale.ts";
import { ERROR_MESSAGES } from "../src/lib/i18n/error-messages.ts";
import {
  FROZEN_LANDING_LOCALES,
  FROZEN_LANDING_MESSAGES,
} from "../src/lib/i18n/frozen-landing-messages.ts";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { isI18nReviewEnabled } from "../src/lib/i18n/review-gate.ts";
import { verificationEmailUiCopy } from "../src/lib/verification/resend.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageShape(value: unknown): unknown {
  if (Array.isArray(value)) return "array";
  if (!isRecord(value)) return typeof value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, messageShape(value[key])]),
  );
}

function assertNoBlankCopy(value: unknown, path: string): void {
  if (typeof value === "string") {
    assert.ok(value.trim().length > 0, `${path} is blank`);
    return;
  }

  if (Array.isArray(value)) {
    assert.ok(value.length > 0, `${path} is an empty array`);
    value.forEach((item, index) => assertNoBlankCopy(item, `${path}[${index}]`));
    return;
  }

  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertNoBlankCopy(child, `${path}.${key}`);
    }
  }
}

function flattenedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenedText).join("\n");
  if (isRecord(value)) return Object.values(value).map(flattenedText).join("\n");
  return "";
}

function stringLeaves(value: unknown, path = ""): Map<string, string> {
  const leaves = new Map<string, string>();
  if (!isRecord(value)) return leaves;

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (typeof child === "string") {
      leaves.set(childPath, child);
      continue;
    }
    for (const [leafPath, leaf] of stringLeaves(child, childPath)) {
      leaves.set(leafPath, leaf);
    }
  }
  return leaves;
}

function placeholderTokens(value: string): string[] {
  return [...value.matchAll(/\{([a-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]).sort();
}

test("the synchronous error catalog stays aligned with the frozen translations", () => {
  assert.deepEqual(Object.keys(ERROR_MESSAGES), [...SUPPORTED_LOCALES]);
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(ERROR_MESSAGES[locale], FROZEN_LANDING_MESSAGES[locale].errors);
  }
});

test("the design-frozen catalog is complete and preserves runtime interpolation contracts", () => {
  assert.deepEqual([...FROZEN_LANDING_LOCALES], [...SUPPORTED_LOCALES]);
  assert.deepEqual(Object.keys(FROZEN_LANDING_MESSAGES), [...SUPPORTED_LOCALES]);

  const englishShape = messageShape(FROZEN_LANDING_MESSAGES.en);
  const englishLeaves = stringLeaves(FROZEN_LANDING_MESSAGES.en);
  for (const locale of FROZEN_LANDING_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    assert.deepEqual(messageShape(messages), englishShape, `${locale}: frozen message key drift`);
    assertNoBlankCopy(messages, `frozen.${locale}`);

    const leaves = stringLeaves(messages);
    for (const [path, english] of englishLeaves) {
      const translated = leaves.get(path);
      assert.equal(typeof translated, "string", `${locale}.${path}: missing translated string`);
      assert.deepEqual(
        placeholderTokens(translated!),
        placeholderTokens(english),
        `${locale}.${path}: interpolation token drift`,
      );

      if (!path.endsWith("Highlight")) continue;
      const parentPath = path.slice(0, -"Highlight".length);
      const parent = leaves.get(parentPath);
      assert.ok(parent, `${locale}.${path}: missing highlighted parent ${parentPath}`);
      assert.ok(parent.includes(translated!), `${locale}.${path}: highlight is not in parent copy`);
    }
  }
});

test("every public launch-date surface says December, never a specific day", () => {
  // The Kickstarter day is not confirmed (2026-09-26). Every surface names the
  // month only; the countdown was removed.
  const expectedByLocale = {
    en: { launch: "Launching on Kickstarter in December", month: "December" },
    ko: { launch: "12월 킥스타터 런칭", month: "12월" },
    "zh-CN": { launch: "12 月在 Kickstarter 上线", month: "12 月" },
    "zh-TW": { launch: "12 月在 Kickstarter 上線", month: "12 月" },
    ja: { launch: "12月に Kickstarter でローンチ", month: "12月" },
    es: { launch: "Lanzamiento en Kickstarter en diciembre", month: "diciembre" },
    fr: { launch: "Lancement sur Kickstarter en décembre", month: "décembre" },
    de: { launch: "Start auf Kickstarter im Dezember", month: "Dezember" },
    "pt-BR": { launch: "Lançamento no Kickstarter em dezembro", month: "dezembro" },
  } as const satisfies Record<Locale, { launch: string; month: string }>;

  for (const locale of SUPPORTED_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    const expected = expectedByLocale[locale];
    assert.equal(messages.countdown.opens, expected.launch, `${locale}.countdown.opens`);
    const monthSurfaces = {
      serverClosed: messages.server.closed,
      faq: messages.faq.a5,
      verified: messages.verify.verifiedBody,
      priceLine: messages.hero.priceLine,
    };
    for (const [surface, copy] of Object.entries(monthSurfaces)) {
      assert.ok(copy.includes(expected.month), `${locale}.${surface}: launch month missing`);
    }
  }

  const allCopy = flattenedText(FROZEN_LANDING_MESSAGES);
  for (const staleDate of [
    "November 18",
    "11월 18일",
    "11 月 18 日",
    "11月18日",
    "18 de noviembre",
    "18 novembre",
    "18. November",
    "18 de novembro",
    "10 August",
    "8월 10일",
    "8 月 10 日",
    "8月10日",
    "10 de agosto",
    "10 août",
    "10. August",
  ]) {
    assert.ok(!allCopy.includes(staleDate), `stale launch date remains: ${staleDate}`);
  }
});

test("transactional email copy contains no unapproved hard claims", () => {
  const resendSource = readFileSync(
    new URL("../src/lib/verification/resend.ts", import.meta.url),
    "utf8",
  );
  const emailCopyStart = resendSource.indexOf("const EMAIL_COPY =");
  const emailCopyEnd = resendSource.indexOf(
    "as const satisfies Record<Locale, EmailCopy>;",
    emailCopyStart,
  );
  assert.ok(emailCopyStart >= 0 && emailCopyEnd > emailCopyStart, "EMAIL_COPY source not found");
  const emailCopySource = resendSource.slice(emailCopyStart, emailCopyEnd);

  const universalHardClaims: readonly [string, RegExp][] = [
    [
      "unapproved concrete price",
      /(?:(?:US|R)\s*)?[$€¥₩]\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*(?:USD\b|달러|美元|美金|ドル|euros?\b|dollars?\b|dólares?\b|reais?\b)/iu,
    ],
    [
      "unverified depth rating",
      /\b(?:40|60)(?!\d)\s*(?:m\b|meters?\b|metres?\b|미터|メートル|米)/iu,
    ],
    [
      "unapproved 50 percent claim",
      /\b50\s*(?:%|percent\b|퍼센트\b|百分比|パーセント\b|por\s+ciento\b|pour\s+cent\b|prozent\b|por\s+cento\b)|百分之五十/iu,
    ],
  ];

  for (const [label, pattern] of universalHardClaims) {
    assert.doesNotMatch(emailCopySource.normalize("NFKC"), pattern, `email: ${label}`);
  }

  const positiveClaimPatterns: readonly [string, RegExp][] = [
    [
      "guaranteed product claim",
      /\bguaranteed\b|보장된|(?<!不)(?:保证|保證)(?:兼容|相容|支持|可用)|保証済み|\bgarantizad[oa]s?\b|\bgaranti(?:e|es|s)\b|\bgarantiert(?:e[snr]?|er)?\b(?!\s+(?:weder|nicht))|\bgarantid[oa]s?\b/iu,
    ],
    [
      "product certification claim",
      /\bcertified\b|(?:제품|기기|Watch Dive).{0,20}인증(?:된|받은|완료)|(?:产品|產品|设备|裝置|Watch Dive).{0,20}(?:已认证|已認證|认证通过|認證通過)|(?:製品|機器|Watch Dive).{0,20}(?:認証済み|認定済み)|(?:producto|dispositivo|produit|appareil|Produkt|Gerät|produto|dispositivo|Watch Dive).{0,24}(?:certificad[oa]|certifié|zertifiziert|certificado)/iu,
    ],
    [
      "all-model compatibility claim",
      /\ball\s+(?:smartwatch\s+)?models\b|모든\s+(?:스마트워치\s+)?모델|(?:所有|全部)(?:智能手表|智慧手錶)?(?:型号|型號|機型)|すべての(?:スマートウォッチ)?(?:モデル|機種)|todos?\s+(?:los\s+)?modelos|tous\s+les\s+modèles|alle\s+(?:Smartwatch-)?Modelle|todos\s+os\s+modelos/iu,
    ],
  ];

  for (const [label, pattern] of positiveClaimPatterns) {
    assert.doesNotMatch(emailCopySource.normalize("NFKC"), pattern, `email: ${label}`);
  }
});

test("every inbox instruction names the exact localized verification email", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const { subject, button } = verificationEmailUiCopy(locale);
    const inbox = FROZEN_LANDING_MESSAGES[locale].inbox;
    assert.ok(inbox.note.includes(subject), `${locale}: inbox omits the actual email subject`);
    assert.ok(inbox.noteSubject.includes(subject), `${locale}: subject highlight drift`);
    assert.ok(inbox.note.includes(button), `${locale}: inbox omits the actual email button`);
    assert.equal(inbox.noteButton, button, `${locale}: button highlight drift`);
  }
});

test("rated copy is never strengthened into a product certification", () => {
  for (const locale of ["es", "fr", "de", "pt-BR"] as const) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    const ratedCopy = [messages.hero.stat1Desc, messages.safety.point1Title, messages.faq.a2].join(
      " ",
    );
    assert.doesNotMatch(
      ratedCopy,
      /certificad[oa]|certifié|zertifiziert|certificado/iu,
      `${locale}: translated rating became a certification`,
    );
  }
});

test("native-reviewed landing copy does not regress to known literal translations", () => {
  const literalArtifacts: Partial<Record<Locale, RegExp>> = {
    ko: /프리미엄 빌드|하우징이 직접 가져옵니다|진지한 안전/,
    "zh-CN": /已经完成了一半|解锁潜水电脑的核心体验|认真的安全/,
    "zh-TW": /已經完成了一半|解鎖潛水電腦的核心體驗|認真的安全/,
    ja: /核心体験|そのウォッチを、ダイコンに|ほんの一部の価格/,
    es: /hace la mitad del camino|desbloquear la experiencia esencial|Seguridad seria/,
    fr: /fait déjà la moitié du chemin|débloquer l'essentiel|verrouill(?:er|ent)/,
    de: /schon die halbe Strecke|Kern-Erlebnis|60-m-Tauchcomputer|Aufstiegs-Alarm/,
    "pt-BR": /faz metade do caminho|destravar a experiência essencial|Segurança séria/,
  };

  for (const locale of SUPPORTED_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    const conversionCopy = flattenedText([
      messages.cta,
      messages.hero,
      messages.value,
      messages.functions,
      messages.how,
      messages.app,
      messages.reviews,
      messages.compat,
      messages.cameras,
      messages.safety,
      messages.offer,
      messages.creds,
      messages.faq,
      messages.verify,
      messages.errors,
    ]);
    const artifact = literalArtifacts[locale];
    if (artifact) {
      assert.doesNotMatch(conversionCopy, artifact, `${locale}: literal translation regressed`);
    }
  }
});

test("the reorganized story explains the same bounded product mechanism in every locale", () => {
  const pressure = /pressure|수압|压力|壓力|水圧|presión|pression|Druck|pressão/iu;
  const waterTemperature =
    /water-temperature|water temperature|수온|水温|水溫|temperatura del agua|température de l’eau|Wassertemperatur|temperatura da água/iu;
  const bluetooth = /Bluetooth|蓝牙|藍牙/iu;
  const unsupportedEquivalence =
    /Bühlmann|Gradient Factors?|same (?:calculation|as)|전용 다이브 컴퓨터.{0,20}(?:같|동일)|专用潜水电脑|專用潛水電腦|専用ダイブコンピューター|ordenador de buceo dedicado|ordinateur de plongée dédié|dedizierter Tauchcomputer|computador de mergulho dedicado/iu;

  for (const locale of SUPPORTED_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    assert.match(messages.hero.sub, /Apple Watch/);
    assert.match(messages.hero.sub, /Galaxy Watch/);

    for (const [path, copy] of [
      ["value.card3Copy", messages.value.card3Copy],
      ["how.step2Body", messages.how.step2Body],
      ["safety.point3Body", messages.safety.point3Body],
    ] as const) {
      assert.match(copy, pressure, `${locale}.${path}: pressure sensor missing`);
      assert.match(copy, waterTemperature, `${locale}.${path}: water-temperature sensor missing`);
      assert.match(copy, bluetooth, `${locale}.${path}: Bluetooth transfer missing`);
    }

    const functionCopy = flattenedText(messages.functions);
    assert.doesNotMatch(
      functionCopy,
      unsupportedEquivalence,
      `${locale}: function copy implies unsupported technical equivalence`,
    );
    assert.doesNotMatch(
      functionCopy,
      /\$149|60\s*m|197\s*ft/iu,
      `${locale}: function story repeats price or depth instead of explaining use`,
    );
  }
});

test("localized CTA copy asks for an invitation instead of claiming a purchase or price lock", () => {
  const purchaseGuarantee =
    /lock in|secure|guarantee|확보|보장|锁定|保证|鎖定|保證|確保|asegurar|garantizar|verrouiller|garantir|sichern/iu;

  for (const locale of SUPPORTED_LOCALES) {
    assert.doesNotMatch(
      FROZEN_LANDING_MESSAGES[locale].cta.label,
      purchaseGuarantee,
      `${locale}: CTA implies a purchase or guaranteed price`,
    );
  }
});

test("each locale uses its own contextual currency across every price-bearing surface", () => {
  const localCurrency: Record<Locale, RegExp> = {
    en: /\$(?:149|299|1,000)/,
    ko: /(?:20만 원대|40만 원대|100만 원 이상)/,
    "zh-CN": /(?:1,000|2,000|7,000) 元/,
    "zh-TW": /NT\$(?:5,000|10,000|30,000)/,
    ja: /(?:2万円台|4万円台|15万円以上)/,
    es: /€|euros?/iu,
    fr: /€|euros?/iu,
    de: /€|Euro/iu,
    "pt-BR": /R\$|reais/iu,
  };
  const localEstimateNotice: Record<Exclude<Locale, "en">, RegExp> = {
    ko: /예상 범위|기준/,
    "zh-CN": /仅供参考|为准/,
    "zh-TW": /僅供參考|為準/,
    ja: /目安|ご確認/,
    es: /orientativos|prevalecerá/iu,
    fr: /indicatifs|fera foi/iu,
    de: /Richtwerte|Maßgeblich/iu,
    "pt-BR": /estimativas|vale o valor/iu,
  };

  for (const locale of SUPPORTED_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    const priceBearingSurfaces = {
      "meta.description": messages.meta.description,
      "meta.ogDescription": messages.meta.ogDescription,
      "meta.twitterDescription": messages.meta.twitterDescription,
      "cta.label": messages.cta.label,
      "referral.shareText": messages.referral.shareText,
      "hero.priceLine": messages.hero.priceLine,
      "hero.stat3Label": messages.hero.stat3Label,
      "hero.wasPrice": messages.hero.wasPrice,
      "hero.nowPrice": messages.hero.nowPrice,
      "hero.cardPrice": messages.hero.cardPrice,
      "value.h2": messages.value.h2,
      "offer.headline": messages.offer.headline,
      "offer.headlineStrike": messages.offer.headlineStrike,
      "offer.headlineNew": messages.offer.headlineNew,
      "offer.lead": messages.offer.lead,
    };

    assert.equal(
      Object.keys(priceBearingSurfaces).length,
      15,
      `${locale}: price-surface contract changed`,
    );
    for (const [path, copy] of Object.entries(priceBearingSurfaces)) {
      assert.match(copy, localCurrency[locale], `${locale}.${path}: local currency is missing`);
      if (locale !== "en") {
        assert.doesNotMatch(
          copy,
          /\$(?:149|299|1,000)/,
          `${locale}.${path}: source USD price leaked into localized copy`,
        );
      }
    }

    assert.ok(
      messages.hero.priceLine.includes(messages.hero.nowPrice),
      `${locale}: hero price highlight is not in its parent copy`,
    );
    const strikeIndex = messages.offer.headline.indexOf(messages.offer.headlineStrike);
    const newIndex = messages.offer.headline.indexOf(messages.offer.headlineNew);
    assert.ok(strikeIndex >= 0 && newIndex > strikeIndex, `${locale}: offer price order drift`);

    if (locale !== "en") {
      assert.match(
        messages.offer.lead,
        localEstimateNotice[locale],
        `${locale}: localized estimate notice is missing`,
      );
      assert.match(messages.offer.lead, /Kickstarter/, `${locale}: checkout authority is missing`);
    }
  }
});

test("depth proof uses audience-familiar units without inventing a rating or threshold", () => {
  const depthDisplay: Record<Locale, string> = {
    en: "197 ft (60 m)",
    ko: "60m",
    "zh-CN": "60 米",
    "zh-TW": "60 公尺",
    ja: "60m",
    es: "60 m",
    fr: "60 m",
    de: "60 m",
    "pt-BR": "60 m",
  };

  for (const locale of SUPPORTED_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    assert.ok(
      messages.hero.stat1Label.includes(depthDisplay[locale]),
      `${locale}: depth unit drift`,
    );
    assert.ok(
      messages.safety.point1Title.includes(depthDisplay[locale]),
      `${locale}: proof title omits the localized depth`,
    );
    assert.ok(
      messages.faq.a2.includes(depthDisplay[locale]),
      `${locale}: depth FAQ omits the localized test depth`,
    );
    assert.doesNotMatch(
      messages.faq.a2,
      /40\s*m/i,
      `${locale}: unverified operating depth returned`,
    );
    assert.doesNotMatch(
      messages.functions.item3Body,
      /(?:10\s*m|33\s*ft)\/min/i,
      `${locale}: undocumented ascent threshold returned`,
    );
  }

  assert.doesNotMatch(FROZEN_LANDING_MESSAGES.fr.faq.a2, /réussi/iu);
});

test("compatibility cards mirror the owner-approved Apple and Galaxy model matrix", () => {
  const housingModels = [
    "Galaxy Watch4, Galaxy Watch4 Classic, Galaxy Watch5, Galaxy Watch5 Pro",
    "Galaxy Watch6, Galaxy Watch6 Classic, Galaxy Watch FE, Galaxy Watch7, Galaxy Watch Ultra",
    "Galaxy Watch8, Galaxy Watch8 Classic, Galaxy Watch9",
  ] as const;
  const appOnlyModels = [
    "Apple Watch Ultra",
    "Apple Watch Ultra 2, Apple Watch Ultra 3",
    "Galaxy Watch Ultra2",
  ] as const;

  for (const locale of SUPPORTED_LOCALES) {
    const compat = FROZEN_LANDING_MESSAGES[locale].compat;
    assert.deepEqual(
      [compat.housingModel2, compat.housingModel3, compat.housingModel4],
      housingModels,
      `${locale}: housing compatibility card drift`,
    );
    assert.deepEqual(
      [compat.appOnlyModel1, compat.appOnlyModel2, compat.appOnlyModel3],
      appOnlyModels,
      `${locale}: app-only compatibility card drift`,
    );
    assert.doesNotMatch(
      flattenedText(compat),
      /Google Pixel Watch|Wear OS|Apple Watch Ultra 1\b/,
      `${locale}: unapproved compatibility model returned`,
    );
  }
});

test("owner-confirmed proof cards state bounded completion in every locale", () => {
  const completedLanguage: Record<Locale, RegExp> = {
    en: /completed/,
    ko: /완료/,
    "zh-CN": /已完成/,
    "zh-TW": /已完成/,
    ja: /完了/,
    es: /completad[ao]s?/,
    fr: /terminé(?:e|s|es)?/,
    de: /abgeschlossen/,
    "pt-BR": /concluíd[ao]s?/,
  };
  const oldProgressLanguage: Record<Locale, RegExp> = {
    en: /under verification|under review/,
    ko: /검증 중|검토 중/,
    "zh-CN": /验证中|审核中/,
    "zh-TW": /驗證中|審核中/,
    ja: /検証中|確認中/,
    es: /en verificación|en revisión/,
    fr: /en cours de vérification|en cours d['’]examen/,
    de: /wird geprüft|in Prüfung/,
    "pt-BR": /em verificação|em análise/,
  };
  const unapprovedClaimLanguage =
    /\b(?:certified|certification|passed)\b|인증|공인|통과|认证|認證|認証|certificación|certifié|certification|zertifiziert|Zertifizierung|certifica(?:ção|do)/iu;

  for (const locale of SUPPORTED_LOCALES) {
    const { point1Title, point1Body, point2Title, point2Body } =
      FROZEN_LANDING_MESSAGES[locale].safety;
    const ratingClaim = `${point1Title} ${point1Body}`;
    const openWaterClaim = `${point2Title} ${point2Body}`;

    assert.match(
      ratingClaim,
      completedLanguage[locale],
      `${locale}: 60 m test is not stated as completed`,
    );
    assert.match(
      openWaterClaim,
      completedLanguage[locale],
      `${locale}: ocean beta test is not stated as completed`,
    );
    assert.doesNotMatch(
      `${ratingClaim} ${openWaterClaim}`,
      oldProgressLanguage[locale],
      `${locale}: stale in-progress language returned`,
    );
    assert.doesNotMatch(
      `${ratingClaim} ${openWaterClaim}`,
      unapprovedClaimLanguage,
      `${locale}: proof copy overstates certification or a pass result`,
    );
  }

  assert.deepEqual(FROZEN_LANDING_MESSAGES.ko.safety, {
    ...FROZEN_LANDING_MESSAGES.ko.safety,
    point1Title: "Watch Dive 하우징 · 60m 방수 테스트 완료",
    point1Body: "Watch Dive 하우징은 60m 방수 테스트를 완료했습니다.",
    point2Title: "해양 다이빙 베타 테스트 완료",
    point2Body: "실제 바다에서 제품 베타 테스트를 완료했습니다.",
  });
  assert.deepEqual(FROZEN_LANDING_MESSAGES.en.safety, {
    ...FROZEN_LANDING_MESSAGES.en.safety,
    point1Title: "Watch Dive housing · 197 ft (60 m) water-resistance test completed",
    point1Body: "The Watch Dive housing completed a water-resistance test at 197 ft (60 m).",
    point2Title: "Ocean beta dives completed",
    point2Body: "Product beta testing was completed on real ocean dives.",
  });
});

test("the approved product FAQs are complete in every locale", () => {
  const galaxyModels = [
    "Galaxy Watch4",
    "Galaxy Watch4 Classic",
    "Galaxy Watch5",
    "Galaxy Watch5 Pro",
    "Galaxy Watch6",
    "Galaxy Watch6 Classic",
    "Galaxy Watch FE",
    "Galaxy Watch7",
    "Galaxy Watch Ultra",
    "Galaxy Watch8",
    "Galaxy Watch8 Classic",
    "Galaxy Watch9",
    "Galaxy Watch Ultra2",
  ] as const;
  const allOtherAppleCopy: Record<Locale, RegExp> = {
    en: /all other Apple Watch models/,
    ko: /그 외 모든 Apple Watch 모델/,
    "zh-CN": /所有 Apple Watch 型号/,
    "zh-TW": /所有 Apple Watch 型號/,
    ja: /すべてのApple Watchモデル/,
    es: /todos los demás modelos de Apple Watch/,
    fr: /tous les autres modèles d['’]Apple Watch/,
    de: /alle anderen Apple Watch-Modelle/,
    "pt-BR": /todos os outros modelos de Apple Watch/,
  };
  const twoYearTerm: Record<Locale, RegExp> = {
    en: /two years/,
    ko: /2년/,
    "zh-CN": /两年/,
    "zh-TW": /兩年/,
    ja: /2年/,
    es: /dos años/,
    fr: /deux ans/,
    de: /zwei Jahre/,
    "pt-BR": /dois anos/,
  };
  const pressure = /pressure|수압|水压|水壓|水圧|presión|pression|Druck|pressão/iu;
  const waterTemperature =
    /water-temperature|water temperature|수온|水温|水溫|temperatura del agua|température de l['’]eau|Wassertemperatur|temperatura da água/iu;
  const serviceCenter =
    /service center|서비스 센터|服务中心|服務中心|サービスセンター|centro de servicio|centre de service|Servicecenter|centro de serviço/iu;
  const paid =
    /for a fee|유상|付费|付費|有償|coste adicional|moyennant des frais|gegen Gebühr|mediante taxa/iu;

  for (const locale of SUPPORTED_LOCALES) {
    const faq = FROZEN_LANDING_MESSAGES[locale].faq;
    assert.match(
      faq.a6,
      allOtherAppleCopy[locale],
      `${locale}: housing-path Apple Watch coverage missing`,
    );
    for (const model of galaxyModels) {
      assert.ok(faq.a6.includes(model), `${locale}: ${model} missing from compatibility FAQ`);
    }
    for (const appOnlyModel of [
      "Apple Watch Ultra",
      "Apple Watch Ultra 2",
      "Apple Watch Ultra 3",
      "Galaxy Watch Ultra2",
    ]) {
      assert.ok(
        faq.a6.includes(appOnlyModel),
        `${locale}: ${appOnlyModel} app-only exception missing`,
      );
    }
    assert.match(faq.a6, pressure, `${locale}: app-only sensor reason omits pressure/depth`);
    assert.match(
      faq.a6,
      waterTemperature,
      `${locale}: app-only sensor reason omits water temperature`,
    );
    assert.match(faq.a7, pressure, `${locale}: housing FAQ omits pressure sensing`);
    assert.match(
      faq.a7,
      waterTemperature,
      `${locale}: housing FAQ omits water temperature sensing`,
    );
    assert.match(faq.a7, /Bluetooth/, `${locale}: housing FAQ omits Bluetooth`);
    assert.match(faq.a8, twoYearTerm[locale], `${locale}: battery FAQ omits two-year term`);
    assert.match(faq.a8, /1(?:[ ,.])?000/, `${locale}: battery FAQ omits 1,000 dives`);
    assert.match(faq.a8, serviceCenter, `${locale}: battery FAQ omits authorized service`);
    assert.match(faq.a8, paid, `${locale}: battery FAQ omits paid replacement`);
  }
});

test("the translated frozen catalog is fail-closed behind the exact internal-review flag", () => {
  assert.equal(isI18nReviewEnabled("true"), true);
  for (const disabled of [
    undefined,
    null,
    false,
    true,
    1,
    "",
    "false",
    "TRUE",
    " true ",
    "1",
    "yes",
  ]) {
    assert.equal(
      isI18nReviewEnabled(disabled),
      false,
      `${JSON.stringify(disabled)} unexpectedly enabled translated claims`,
    );
  }

  const request = new Request("https://watchdive.diveroid.com/?utm_source=gate-test", {
    headers: {
      accept: "text/html",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
      "sec-fetch-dest": "document",
      "user-agent": "Mozilla/5.0",
      "x-vercel-ip-country": "KR",
    },
  });
  assert.equal(autoLocaleRedirect(request), undefined);
  assert.equal(autoLocaleRedirect(request, false), undefined);
  assert.deepEqual(autoLocaleRedirect(request, true), {
    locale: "ko",
    location: "/ko?utm_source=gate-test",
  });

  const frozenCatalog = readFileSync(
    new URL("../src/lib/i18n/frozen-landing-messages.ts", import.meta.url),
    "utf8",
  );
  assert.match(frozenCatalog, /CLAIM-EVIDENCE FLAGS/);
  assert.match(frozenCatalog, /\$149/);
  assert.match(frozenCatalog, /60 m/);

  const localeLayout = readFileSync(new URL("../src/routes/$locale.tsx", import.meta.url), "utf8");
  assert.match(localeLayout, /isI18nReviewEnabled/);
  assert.match(localeLayout, /VITE_WATCHDIVE_I18N_REVIEW/);
  assert.match(
    localeLayout,
    /if\s*\(\s*!isI18nReviewEnabled\([\s\S]*?VITE_WATCHDIVE_I18N_REVIEW[\s\S]*?\)\s*\)\s*(?:\{\s*)?throw notFound\(\)/,
  );

  const landing = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  assert.match(landing, /const productFaqs = \[/);
  assert.match(landing, /\.\.\.productFaqs/);
  assert.doesNotMatch(landing, /VITE_WATCHDIVE_PRODUCT_CLAIMS_REVIEW/);

  const seoSource = readFileSync(new URL("../src/lib/i18n/seo.ts", import.meta.url), "utf8");
  assert.match(seoSource, /hero-background\.webp/);
  assert.doesNotMatch(seoSource, /og-image\.png/);
  assert.match(seoSource, /socialImage/);
  assert.equal(
    existsSync(new URL("../public/og-image.png", import.meta.url)),
    false,
    "legacy public social card with unapproved claims returned",
  );
});

const LEGAL_ESSENTIALS = {
  en: {
    store: /not a store/i,
    changeable: /may change/i,
    noReservation: /does not reserve/i,
    training: /training/i,
    backup: /backup/i,
    email: /email address/i,
    required: /required/i,
    phone: /phone number/i,
    optional: /optional/i,
  },
  ko: {
    store: /쇼핑몰이 아니|스토어가 아닙니다/,
    changeable: /달라질 수|변경될 수/,
    noReservation: /예약하거나.*보장하지/s,
    training: /교육/,
    backup: /백업/,
    email: /이메일 주소/,
    required: /필수/,
    phone: /전화번호/,
    optional: /선택/,
  },
  "zh-CN": {
    store: /不是商店/,
    changeable: /可能.{0,40}发生(?:变化|变更)/,
    noReservation: /不(?:会)?预留/,
    training: /培训|训练/,
    backup: /备用/,
    email: /电子邮箱|邮箱地址/,
    required: /必填/,
    phone: /手机号码?/,
    optional: /选填|可选/,
  },
  "zh-TW": {
    store: /不是商店/,
    changeable: /可能.{0,40}(?:改變|變更)/,
    noReservation: /不(?:會)?(?:保留|預留)/,
    training: /訓練/,
    backup: /備援|備用/,
    email: /電子郵件|電子信箱/,
    required: /必填/,
    phone: /(?:手機|電話)號碼/,
    optional: /選填|可選/,
  },
  ja: {
    store: /(?:オンライン)?ストアではありません/,
    changeable: /変更される(?:場合|可能性)/,
    noReservation: /(?:製品が確保されたり.*保証されたり|予約でも.*保証でもありません)/s,
    training: /トレーニング/,
    backup: /バックアップ/,
    email: /メールアドレス/,
    required: /必須/,
    phone: /電話番号/,
    optional: /任意/,
  },
  es: {
    store: /no es una tienda/i,
    changeable: /pueden cambiar/i,
    noReservation: /no reserva/i,
    training: /formación/i,
    backup: /respaldo/i,
    email: /correo electrónico|dirección de email|\bemail\b/i,
    required: /obligatori[oa]/i,
    phone: /teléfono/i,
    optional: /opcional/i,
  },
  fr: {
    store: /n[’']est pas une boutique/i,
    changeable: /peuvent changer/i,
    noReservation: /ne réserve/i,
    training: /formation/i,
    backup: /secours/i,
    email: /e-mail/i,
    required: /obligatoire/i,
    phone: /téléphone/i,
    optional: /facultatif/i,
  },
  de: {
    store: /kein (?:Online-)?Shop/i,
    changeable: /können sich.{0,80}ändern/i,
    noReservation: /reserviert kein|keine Reservierung/i,
    training: /Ausbildung/i,
    backup: /Reserve|Backup/i,
    email: /E-Mail-Adresse/i,
    required: /erforderlich/i,
    phone: /Telefonnummer/i,
    optional: /optional|freiwillig/i,
  },
  "pt-BR": {
    store: /não é uma loja/i,
    changeable: /podem mudar/i,
    noReservation: /não reserva/i,
    training: /treinamento/i,
    backup: /reserva|backup/i,
    email: /e-mail/i,
    required: /obrigatório/i,
    phone: /telefone/i,
    optional: /opcional/i,
  },
} as const satisfies Record<Locale, Record<string, RegExp>>;

test("every legal translation retains the operating and consent essentials", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const terms = flattenedText(FROZEN_LANDING_MESSAGES[locale].terms);
    const privacy = flattenedText(FROZEN_LANDING_MESSAGES[locale].privacy);
    const expected = LEGAL_ESSENTIALS[locale];

    for (const key of ["store", "changeable", "noReservation", "training", "backup"] as const) {
      assert.match(terms, expected[key], `${locale}: legal terms lost ${key}`);
    }
    for (const key of ["email", "required", "phone", "optional"] as const) {
      assert.match(privacy, expected[key], `${locale}: privacy copy lost ${key}`);
    }
  }
});

test("localized landing, verification, legal and referral routes exist", () => {
  const expectedRoutes = [
    "$locale.tsx",
    "$locale.index.tsx",
    "$locale.verify.tsx",
    "$locale.privacy.tsx",
    "$locale.terms.tsx",
    "$locale.r.$code.tsx",
  ];

  for (const route of expectedRoutes) {
    assert.equal(
      existsSync(new URL(`../src/routes/${route}`, import.meta.url)),
      true,
      `missing localized route: ${route}`,
    );
  }
});

test("the document language follows the localized path instead of staying hard-coded to English", () => {
  const rootSource = readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");

  assert.match(rootSource, /localeFromPathname\(pathname\)/);
  assert.match(rootSource, /<html\s+lang=\{locale\}>/);
  assert.doesNotMatch(rootSource, /<html\s+lang=["']en["']/);
});
