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
  const allAppleCopy: Record<Locale, RegExp> = {
    en: /all Apple Watch models/,
    ko: /모든 Apple Watch 모델/,
    "zh-CN": /所有 Apple Watch 型号/,
    "zh-TW": /所有 Apple Watch 型號/,
    ja: /すべてのApple Watchモデル/,
    es: /todos los modelos de Apple Watch/,
    fr: /tous les modèles d'Apple Watch/,
    de: /alle Apple Watch-Modelle/,
    "pt-BR": /todos os modelos de Apple Watch/,
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
    /water-temperature|water temperature|수온|水温|水溫|temperatura del agua|température de l'eau|Wassertemperatur|temperatura da água/iu;
  const serviceCenter =
    /service center|서비스 센터|服务中心|服務中心|サービスセンター|centro de servicio|centre de service|Servicecenter|centro de serviço/iu;
  const paid =
    /for a fee|유상|付费|付費|有償|coste adicional|moyennant des frais|gegen Gebühr|mediante taxa/iu;

  for (const locale of SUPPORTED_LOCALES) {
    const faq = FROZEN_LANDING_MESSAGES[locale].faq;
    assert.match(faq.a6, allAppleCopy[locale], `${locale}: all-Apple-Watch support missing`);
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
  assert.match(frozenCatalog, /UNVERIFIED-CLAIM FLAGS/);
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
