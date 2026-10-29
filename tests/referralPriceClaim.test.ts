// The "$149 for the first 100" claim while Buddy Invite is on, and proof that
// other surfaces stay frozen (claims review BLOCKER 1, owner D1(a)).
// Owner 2026-10-23 overrides only the hero race line in both switches.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { conversionCopy } from "../src/lib/conversionCopy.ts";
import { earlyBirdRace } from "../src/lib/earlyBirdRace.ts";
import { EN_FROZEN_LANDING_MESSAGES } from "../src/lib/i18n/frozen-landing-en.ts";
import { FROZEN_LANDING_MESSAGES } from "../src/lib/i18n/frozen-landing-messages.ts";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import {
  applyPriceClaim,
  priceClaimFromLoaderData,
  withClaimTerms,
  type PriceClaim,
} from "../src/lib/i18n/price-claim.ts";
import {
  REFERRAL_PRICE_CLAIM_COPY,
  referralPriceClaim,
} from "../src/lib/i18n/referral-price-claim-copy.ts";
import { landingStructuredData } from "../src/lib/i18n/structuredData.ts";
import {
  LAUNCH_COPY,
  LAUNCH_REFERRAL_PREHEADER_WAVES,
  LAUNCH_REFERRAL_PRICE,
  launchWaveCopy,
} from "../src/lib/launchMail/copy.ts";
import type { LaunchSchema, LaunchStore } from "../src/lib/launchMail/notionLaunchStore.ts";
import { formatLaunchTime, renderLaunchMail } from "../src/lib/launchMail/render.ts";
import { runLaunchMail } from "../src/lib/launchMail/run.ts";
import type { LaunchRow } from "../src/lib/launchMail/audience.ts";
import { phoneOptInCopy } from "../src/lib/phoneOptInCopy.ts";
import { referralCopy } from "../src/lib/referral/copy.ts";
import { EARLY_BIRD_SEATS } from "../src/lib/referral/program.ts";
import { TEST_ENV } from "./helpers/fakes.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const WAVES = ["t-1d", "t-1h", "t-0"] as const;
const KS = "https://www.kickstarter.com/projects/diveroid/watch-dive";
const LAUNCH_AT = "2026-12-01T14:00:00Z";
const mailInput = (locale: Locale, wave: (typeof WAVES)[number]) => ({
  wave,
  locale,
  kickstarterUrl: KS,
  launchAt: new Date(LAUNCH_AT),
  unsubscribeUrl: "https://watchdive.diveroid.com/unsubscribe/x",
  postalAddress: "DIVEROID LTD",
});

// --- switched off: the same objects and the same bytes ----------------------

test("off: every claim surface is the catalog's own object, untouched", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    assert.equal(applyPriceClaim(messages, undefined), messages, locale);
    assert.equal(withClaimTerms(conversionCopy[locale], undefined), conversionCopy[locale]);
    assert.equal(withClaimTerms(phoneOptInCopy[locale], undefined), phoneOptInCopy[locale]);
    assert.equal(
      earlyBirdRace(locale, messages.hero.nowPrice, undefined),
      earlyBirdRace(locale, messages.hero.nowPrice),
    );
    for (const wave of WAVES) {
      assert.equal(launchWaveCopy(locale, wave), LAUNCH_COPY[locale].waves[wave]);
      assert.equal(launchWaveCopy(locale, wave, false), LAUNCH_COPY[locale].waves[wave]);
    }
  }
  assert.equal(applyPriceClaim(EN_FROZEN_LANDING_MESSAGES, undefined), EN_FROZEN_LANDING_MESSAGES);
});

test("off: rendered copy stays frozen with owner-approved hero, brand and footer updates", () => {
  // Computed on a checkout of fd2e434, before this change, with the same
  // inputs. The hero race hash reflects owner approval 2026-10-23.
  // The landing catalog hash also includes the owner-approved Korean brand
  // spelling in Korean metadata and H1 (2026-10-26), and removal of the backup
  // computer clause from all nine website footers (2026-10-28).
  // 2026-10-30: each digest includes nl. The same values without nl still match
  // frozen 8592d820…, conversion ef82f627…, race b0f177d6…, phone 5da27009…,
  // and mails e17e8f1e….
  const race = SUPPORTED_LOCALES.map((l) =>
    earlyBirdRace(l, FROZEN_LANDING_MESSAGES[l].hero.nowPrice),
  );
  // The launch time is formatted with Intl, whose output varies by Node/ICU
  // version (CI runs a newer Node than the machine that took the baseline).
  // Mask the formatter's own output so the hash pins only this change's copy;
  // formatLaunchTime itself is unchanged since fd2e434.
  const maskTime = (mail: unknown, locale: Locale) => {
    let text = JSON.stringify(mail);
    const time = formatLaunchTime(new Date(LAUNCH_AT), locale);
    for (const value of [time.local, time.utc]) {
      text = text.split(JSON.stringify(value).slice(1, -1)).join("<T>").split(value).join("<T>");
    }
    return text;
  };
  const mails = SUPPORTED_LOCALES.flatMap((l) =>
    WAVES.map((w) => maskTime(renderLaunchMail(mailInput(l, w)), l)),
  );
  assert.equal(
    sha256(FROZEN_LANDING_MESSAGES),
    "61444390e9801994368cdf9edd9dc6838cffce092471b763958a0a60d88405ed",
  );
  assert.equal(
    sha256(conversionCopy),
    "4a79df02526ef630f614f60d58af25f83f7a00353a0b87f93b05c0525f918c31",
  );
  assert.equal(sha256(race), "3b8b99ab021af6f591a6a77cecb5e45574ce7ec66fd69e48b355fa8b99f138ea");
  assert.equal(
    sha256(phoneOptInCopy),
    "b7bdca85fb03d8ebc7ba7a8e039e5b02323e123371967e45f2d37d4430da72ad",
  );
  // 2026-10-26 brutalism replaced the launch-mail HTML shell. The digest is the
  // rendered mail (subject, text and HTML) with launch times masked.
  assert.equal(sha256(mails), "244063c45bcf761bafeaf493567bea6a640677651e897a62674ebb8fd55692ea");
  // `referralProgram: false` is the same mail as no flag at all.
  for (const locale of SUPPORTED_LOCALES) {
    for (const wave of WAVES) {
      assert.deepEqual(
        renderLaunchMail({ ...mailInput(locale, wave), referralProgram: false }),
        renderLaunchMail(mailInput(locale, wave)),
      );
    }
  }
});

test("off: loader data gains no key, and unrelated loader data reads as no claim", () => {
  assert.equal(priceClaimFromLoaderData(undefined), undefined);
  assert.equal(priceClaimFromLoaderData({ waitlistCount: 3, liteMedia: false }), undefined);
  assert.equal(priceClaimFromLoaderData({ priceClaim: null }), undefined);
  assert.equal(priceClaimFromLoaderData({ priceClaim: "x" }), undefined);
  const claim = referralPriceClaim("en");
  assert.equal(priceClaimFromLoaderData({ waitlistCount: 3, priceClaim: claim }), claim);

  // The loader spreads `{}` while off, so the serialized loader data (and the
  // dehydrated state in the HTML) keeps exactly its old keys.
  const loader = read("src/lib/i18n/price-claim-loader.ts");
  assert.match(loader, /if \(enabled !== true\) return \{\};/);
  assert.doesNotMatch(loader, /priceClaim: (?:null|undefined)/);
  for (const route of ["src/routes/index.tsx", "src/routes/$locale.index.tsx"]) {
    const source = read(route);
    assert.match(source, /loadReferralPriceClaim\(/, route);
    assert.match(source, /\.\.\.claim \}/, route);
    // Off, the head is the exact call it always was.
    assert.match(
      source,
      /const claim = priceClaimFromLoaderData\(loaderData\);\n\s+if \(!claim\) return landingHead\(/,
      route,
    );
  }
});

// --- switched on: the limit is stated with its exceptions -------------------

const FIRST_HUNDRED: Record<Locale, RegExp> = {
  en: /first 100/i,
  ko: /(?:선착순 (?:후원자 )?100명|먼저 후원한 100명)/,
  "zh-CN": /前 100 [名位]|最先支持的100人/,
  "zh-TW": /前 100 [名位]|最先贊助的100人/,
  ja: /(?:先着100名|最初に支援した100名)/,
  es: /(?:100 primeros|primeros 100)/i,
  fr: /100 premiers/i,
  de: /ersten 100/i,
  "pt-BR": /(?:100 primeiros|primeiros 100)/i,
  nl: /(?:eerste 100|100 eerste)/i,
};
const RESERVATION: Record<Locale, RegExp> = {
  en: /price.reservation/i,
  ko: /가격 예약/,
  "zh-CN": /价格预约/,
  "zh-TW": /價格預約/,
  ja: /価格予約/,
  es: /reservas? de precio/,
  fr: /réservations? de prix/,
  de: /Preisreservierung/,
  "pt-BR": /reservas? de preço/,
  nl: /prijsreservering/,
};
const EARLY_BIRD: Record<Locale, RegExp> = {
  en: /early.bird/i,
  ko: /얼리버드/,
  "zh-CN": /早鸟/,
  "zh-TW": /早鳥/,
  ja: /早割/,
  es: /early bird/i,
  fr: /early bird/i,
  de: /Early.Bird/i,
  "pt-BR": /early bird/i,
  nl: /early.bird/i,
};
// Words that would make the price sound exclusive to 100 people, or urgent.
const EXCLUSIVE =
  /\bonly\b|\bsolo\b|\bnur\b|\bseulement\b|\bsó\b|réservé aux \d+ premiers\b(?!.*ainsi)|뿐|만 적용|에게만|限定|名だけ|仅限|僅限|left|restan|restent|übrig|restam|남은|剩|残り|hours?|tonight|today/iu;
const LOCAL_CURRENCY: Record<Locale, RegExp> = {
  en: /\$(?:149|299)/,
  ko: /\$(?:149|299)/,
  "zh-CN": /(?:1,000|2,000) 元/,
  "zh-TW": /NT\$(?:5,000|10,000)/,
  ja: /(?:2万円台|4万円台)/,
  es: /€/,
  fr: /€/,
  de: /€/,
  "pt-BR": /R\$/,
  nl: /\$(?:149|299)/,
};
const ESTIMATE_NOTICE: Record<Exclude<Locale, "en">, RegExp> = {
  ko: /기준/,
  "zh-CN": /仅供参考|为准/,
  "zh-TW": /僅供參考|為準/,
  ja: /目安|ご確認/,
  es: /orientativos|prevalecerá/iu,
  fr: /indicatifs|fera foi/iu,
  de: /Richtwerte|Maßgeblich/iu,
  "pt-BR": /estimativas|vale o valor/iu,
  nl: /leidend/,
};

function diveTeam(locale: Locale): string {
  // The tier's own name, as the rules and the referral card print it.
  return referralCopy(locale).tiers.team.name.split(" · ")[0];
}

function disclosed(locale: Locale): Record<string, string> {
  const claim = referralPriceClaim(locale);
  return {
    "meta.description": claim.landing.meta.description,
    "meta.ogDescription": claim.landing.meta.ogDescription,
    "meta.twitterDescription": claim.landing.meta.twitterDescription,
    "offer.lead": claim.landing.offer.lead,
    conversionTerms: claim.conversionTerms,
    phoneTerms: claim.phoneTerms,
  };
}

test("on: every unchanged claim surface stating the 100 still names both exceptions", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const team = diveTeam(locale);
    for (const [path, copy] of Object.entries(disclosed(locale))) {
      assert.match(copy, FIRST_HUNDRED[locale], `${locale}.${path}: limit missing`);
      assert.match(copy, RESERVATION[locale], `${locale}.${path}: price reservation missing`);
      assert.ok(copy.includes(team), `${locale}.${path}: "${team}" missing`);
      assert.doesNotMatch(copy, EXCLUSIVE, `${locale}.${path}: exclusive or urgent wording`);
      assert.doesNotMatch(copy, /\{seats\}|\{price\}/, `${locale}.${path}: unfilled placeholder`);
    }
  }
});

test("on: the 100 comes from program.ts and no other figure is introduced", () => {
  assert.equal(EARLY_BIRD_SEATS, 100);
  for (const locale of SUPPORTED_LOCALES) {
    const raw = REFERRAL_PRICE_CLAIM_COPY[locale];
    const strings = [
      ...Object.values(raw.landing).flatMap((section) => Object.values(section)),
      raw.conversionTerms,
      raw.earlyBirdRace,
      raw.phoneTerms,
    ];
    for (const value of strings) {
      assert.doesNotMatch(
        value,
        /\b100\b|100名|100人|100명/,
        `${locale}: hard-coded 100: ${value}`,
      );
    }
    const messages = FROZEN_LANDING_MESSAGES[locale];
    const allowed = new Set(
      [messages.hero.nowPrice, messages.hero.wasPrice, "100", "50", "5", "12", "2", "4"].flatMap(
        (v) => v.match(/\d[\d,.]*/g) ?? [],
      ),
    );
    for (const value of Object.values(disclosed(locale))) {
      for (const number of value.match(/\d[\d,.]*\d|\d/g) ?? []) {
        assert.ok(allowed.has(number), `${locale}: unexpected figure ${number} in ${value}`);
      }
    }
  }
});

test("on: short labels drop the number, keep 'early bird' beside the price, and fit", () => {
  const purchaseGuarantee =
    /lock in|secure|guarantee|확보|보장|锁定|保证|鎖定|保證|確保|asegurar|garantizar|verrouiller|garantir|sichern/iu;
  for (const locale of SUPPORTED_LOCALES) {
    const { landing } = referralPriceClaim(locale);
    const labels = {
      "cta.label": landing.cta.label,
      "usp.priceTitle": landing.usp.priceTitle,
      "hero.offNote": landing.hero.offNote,
      "value.h2": landing.value.h2,
      "offer.kicker": landing.offer.kicker,
    };
    for (const [path, copy] of Object.entries(labels)) {
      assert.match(copy, EARLY_BIRD[locale], `${locale}.${path}: "early bird" missing`);
      assert.doesNotMatch(copy, /100/, `${locale}.${path}: a bare "first 100" returned`);
      assert.doesNotMatch(copy, EXCLUSIVE, `${locale}.${path}: exclusive or urgent wording`);
    }
    assert.ok([...landing.cta.label].length <= 44, `${locale}.cta.label too long`);
    assert.doesNotMatch(landing.cta.label, purchaseGuarantee, `${locale}.cta.label`);
    assert.ok(
      landing.usp.priceTitle.includes("{price}"),
      `${locale}: strip price is not the hero's`,
    );
  }
  assert.equal(referralPriceClaim("en").landing.cta.label, "Notify me · $149 early bird");
  assert.equal(referralPriceClaim("ko").landing.cta.label, "출시 알림 받기 · 얼리버드 $149");
});

test("on: prices stay in each page's own currency, with its estimate notice", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const claim = referralPriceClaim(locale);
    const messages = FROZEN_LANDING_MESSAGES[locale];
    const amount = messages.hero.nowPrice.match(/\d[\d,.]*/)?.[0] ?? "";
    const priced = {
      "meta.description": claim.landing.meta.description,
      "meta.ogDescription": claim.landing.meta.ogDescription,
      "meta.twitterDescription": claim.landing.meta.twitterDescription,
      "cta.label": claim.landing.cta.label,
      "value.h2": claim.landing.value.h2,
      "offer.lead": claim.landing.offer.lead,
    };
    for (const [path, copy] of Object.entries(priced)) {
      assert.ok(amount && copy.includes(amount), `${locale}.${path}: price moved`);
      assert.match(copy, LOCAL_CURRENCY[locale], `${locale}.${path}: local currency missing`);
      if (locale !== "en" && locale !== "ko" && locale !== "nl") {
        assert.doesNotMatch(copy, /\$(?:149|299)/, `${locale}.${path}: USD leaked`);
      }
    }
    // The public price stays next to the early-bird price in the offer lead.
    const was = messages.hero.wasPrice.match(/\d[\d,.]*/)?.[0] ?? "";
    assert.ok(claim.landing.offer.lead.includes(was), `${locale}: public price missing`);
    assert.ok(
      claim.landing.offer.lead.includes(messages.offer.leadHighlight),
      `${locale}: highlight`,
    );
    assert.match(claim.landing.offer.lead, /Kickstarter/);
    if (locale !== "en") assert.match(claim.landing.offer.lead, ESTIMATE_NOTICE[locale]);
    assert.ok(claim.landing.meta.ogDescription === claim.landing.meta.description, locale);
  }
});

test("on: the share text a friend receives states no price and no limit", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const share = referralPriceClaim(locale).landing.referral.shareText;
    assert.doesNotMatch(share, /\d{3}|€|\$|R\$|円|元|100/, `${locale}: ${share}`);
    assert.match(share, /Kickstarter/);
    assert.match(share, /Apple Watch/);
    assert.match(share, /Galaxy Watch/);
  }
});

test("both switches: owner-approved hero line keeps localized price and adds USD 200", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const template = referralPriceClaim(locale).earlyBirdRace;
    assert.ok(template.includes("{price}"), locale);
    const price = FROZEN_LANDING_MESSAGES[locale].hero.nowPrice;
    const line = earlyBirdRace(locale, price, template);
    assert.ok(line.toLowerCase().includes(price.toLowerCase()), `${locale}: ${line}`);
    assert.equal(line.charAt(0), line.charAt(0).toLocaleUpperCase(locale), `${locale}: ${line}`);
    if (locale !== "en" && locale !== "ko" && locale !== "nl") assert.doesNotMatch(line, /(?<![A-Z])\$\s?\d/);
    assert.equal(line, earlyBirdRace(locale, price), `${locale}: ON/OFF must match`);
    assert.match(line, /200/, locale);
    assert.doesNotMatch(line, RESERVATION[locale], locale);
    assert.ok(!line.includes(diveTeam(locale)), locale);
  }
  assert.equal(
    earlyBirdRace("es", "unos 140 €", referralPriceClaim("es").earlyBirdRace),
    "Unos 140 € de lanzamiento: los 100 primeros patrocinadores en Kickstarter. Después, el precio sube a 200 USD.",
  );
});

test("on: the landing catalog, head and structured data carry the disclosed claim", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const claim = referralPriceClaim(locale);
    const base = FROZEN_LANDING_MESSAGES[locale];
    const messages = applyPriceClaim(base, claim);
    assert.notEqual(messages, base);
    assert.equal(messages.cta.label, claim.landing.cta.label);
    assert.equal(messages.referral.shareText, claim.landing.referral.shareText);
    assert.equal(messages.offer.lead, claim.landing.offer.lead);
    // Untouched neighbours stay the catalog's strings.
    assert.equal(messages.offer.headline, base.offer.headline);
    assert.equal(messages.hero.nowPrice, base.hero.nowPrice);
    assert.equal(messages.referral.shareButton, base.referral.shareButton);
    assert.equal(messages.usp.priceBody, base.usp.priceBody);
    assert.equal(messages.faq, base.faq);
    assert.equal(messages.terms, base.terms);
    // The base catalog itself was not mutated.
    assert.notEqual(base.cta.label, claim.landing.cta.label);

    // landingHead (seo.ts) reads exactly these three meta strings.
    assert.equal(messages.meta.description, claim.landing.meta.description);
    assert.equal(messages.meta.ogDescription, claim.landing.meta.ogDescription);
    assert.equal(messages.meta.twitterDescription, claim.landing.meta.twitterDescription);
    assert.equal(messages.meta.title, base.meta.title);
    const graph = landingStructuredData(locale, messages, "https://x/", "https://x/i.webp")[
      "@graph"
    ];
    const page = graph.find((node) => node["@type"] === "WebPage") as { description: string };
    assert.equal(page.description, claim.landing.meta.description);
  }
});

test("Korean brand remains in search metadata with either referral setting", () => {
  const base = FROZEN_LANDING_MESSAGES.ko;
  for (const claim of [undefined, referralPriceClaim("ko")]) {
    const messages = applyPriceClaim(base, claim);
    for (const key of ["title", "description", "ogTitle", "ogDescription", "twitterTitle", "twitterDescription"] as const) {
      assert.ok(messages.meta[key].includes("워치다이브 (WatchDive)"), key);
    }
    assert.ok(messages.hero.h1.includes("워치다이브 (WatchDive)"));
  }
});

test("on: the experiment terms and the SMS card terms are replaced, nothing else", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const claim = referralPriceClaim(locale);
    const conversion = withClaimTerms(conversionCopy[locale], claim.conversionTerms);
    assert.equal(conversion.terms, claim.conversionTerms);
    assert.deepEqual({ ...conversion, terms: "" }, { ...conversionCopy[locale], terms: "" });
    const phone = withClaimTerms(phoneOptInCopy[locale], claim.phoneTerms);
    assert.equal(phone.terms, claim.phoneTerms);
    assert.deepEqual({ ...phone, terms: "" }, { ...phoneOptInCopy[locale], terms: "" });
  }
});

test("every rendered first-100 catalog key has a switched-on replacement", () => {
  // If a new surface starts rendering one of these keys, it needs a line in
  // referral-price-claim-copy.ts first; the four unrendered keys are listed so
  // that rendering them later fails here instead of reaching visitors.
  const unrendered = ["priceLine", "stat3Desc", "trust2", "cardFrom"];
  const sources = [
    "src/routes/index.tsx",
    "src/routes/verify.tsx",
    "src/components/early-bird-race.tsx",
    "src/components/launch-notice.tsx",
    "src/components/waitlist-progress.tsx",
    "src/components/hero-photo.tsx",
    "src/components/product-gallery.tsx",
    "src/lib/i18n/seo.ts",
    "src/lib/i18n/structuredData.ts",
  ].map(read);
  for (const key of unrendered) {
    for (const source of sources) {
      assert.doesNotMatch(source, new RegExp(`\\.${key}\\b`), `hero.${key} is now rendered`);
    }
  }
  const covered = new Set(
    Object.entries(referralPriceClaim("en").landing).flatMap(([section, keys]) =>
      Object.keys(keys).map((key) => `${section}.${key}`),
    ),
  );
  const firstHundred = /first 100|100 backers/i;
  for (const [section, keys] of Object.entries(EN_FROZEN_LANDING_MESSAGES)) {
    for (const [key, value] of Object.entries(keys as Record<string, unknown>)) {
      if (typeof value !== "string" || !firstHundred.test(value)) continue;
      if (unrendered.includes(key) || section === "terms" || section === "privacy") continue;
      assert.ok(covered.has(`${section}.${key}`), `${section}.${key} states "first 100"`);
    }
  }
});

// --- launch mail -------------------------------------------------------------

test("on: the launch mail price line names both exceptions in every language", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const { price, preheader } = LAUNCH_REFERRAL_PRICE[locale];
    for (const [path, copy] of [
      ["price", price],
      ["preheader", preheader],
    ] as const) {
      assert.match(copy, /149/, `${locale}.${path}`);
      assert.match(copy, /100/, `${locale}.${path}`);
      assert.match(copy, RESERVATION[locale], `${locale}.${path}`);
      assert.ok(copy.includes(diveTeam(locale)), `${locale}.${path}: Dive Team`);
      assert.doesNotMatch(copy, EXCLUSIVE, `${locale}.${path}: exclusive wording`);
      for (const number of copy.match(/\d+/g) ?? []) {
        assert.ok(["149", "200", "100"].includes(number), `${locale}.${path}: ${number}`);
      }
    }
    assert.match(price, /200/, `${locale}: next price after the first 100`);
    for (const wave of WAVES) {
      const on = launchWaveCopy(locale, wave, true);
      const off = LAUNCH_COPY[locale].waves[wave];
      assert.equal(on.price, price);
      assert.equal(
        on.preheader,
        LAUNCH_REFERRAL_PREHEADER_WAVES.includes(wave) ? preheader : off.preheader,
      );
      assert.equal(on.subject, off.subject);
      assert.equal(on.body, off.body);
      assert.equal(on.button, off.button);
      // The t-1d preheader is the old, price-free line ("an hour before").
      if (on.preheader !== off.preheader) assert.doesNotMatch(on.preheader, EXCLUSIVE);
      const mail = renderLaunchMail({ ...mailInput(locale, wave), referralProgram: true });
      assert.ok(mail.text.includes(price), `${locale} ${wave}: text part`);
      assert.deepEqual(
        mail,
        renderLaunchMail({ ...mailInput(locale, wave), referralProgram: true }),
      );
    }
  }
});

const SCHEMA: LaunchSchema = {
  launchMail: "ok",
  missingRequired: [],
  duplicateType: "checkbox",
  hasBrowserLanguage: false,
};

function fakeStore(rows: LaunchRow[]): LaunchStore {
  return {
    readSchema: async () => ({ ...SCHEMA }),
    listAudienceRows: async () => rows.map((r) => ({ ...r })),
    recordLaunchMail: async () => assert.fail("a dry run never writes"),
    reread: async (pageId) => rows.find((r) => r.pageId === pageId),
    findByLeadId: async (leadId) => rows.find((r) => r.leadId === leadId),
  } as LaunchStore;
}

async function drySamples(env: Record<string, string>) {
  const samples = new Map<Locale, string>();
  await runLaunchMail(
    { wave: "t-1h", kickstarterUrl: KS, launchAt: LAUNCH_AT, mode: "dry-run", postalAddress: "X" },
    {
      store: fakeStore([]),
      send: async () => assert.fail("dry run must not send"),
      env,
      now: () => new Date(Date.parse(LAUNCH_AT) - 60 * 60 * 1000),
      writeSample: async (locale, mail) => {
        samples.set(locale, mail.text);
      },
    },
  );
  return samples;
}

test("the launch run reads the same server switch as the site", async () => {
  const off = await drySamples({ ...TEST_ENV });
  const on = await drySamples({ ...TEST_ENV, WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" });
  const other = await drySamples({ ...TEST_ENV, WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "true" });
  assert.equal(off.size, SUPPORTED_LOCALES.length);
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(off.get(locale)?.includes(LAUNCH_COPY[locale].waves["t-1h"].price), locale);
    assert.ok(on.get(locale)?.includes(LAUNCH_REFERRAL_PRICE[locale].price), locale);
    // Only the exact "1" switches it on, as everywhere else.
    assert.equal(other.get(locale), off.get(locale), locale);
  }
});

// --- structural guard ---------------------------------------------------------

test("the switch never touches the frozen JSX or the referral owners' files", () => {
  const index = read("src/routes/index.tsx");
  // Copy hooks only; no element gained a condition on the switch.
  assert.doesNotMatch(index, /priceClaim\s*\?/);
  assert.doesNotMatch(index, /conversionCopy\[/);
  const sample: PriceClaim = referralPriceClaim("en");
  assert.ok(sample.landing.offer.lead.length > 0);
});
