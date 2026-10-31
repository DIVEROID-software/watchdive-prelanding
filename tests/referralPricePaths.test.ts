import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { reservationCopy } from "../src/components/reservation/copy.ts";
import { ONSITE_OFFER_COPY } from "../src/components/reservation/onsite-copy.ts";
import { TOTAL_BEFORE_SHIPPING_TAX_USD } from "../src/components/reservation/pricing.ts";
import { conversionCopy } from "../src/lib/conversionCopy.ts";
import { localizePath, SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { fill, referralCopy } from "../src/lib/referral/copy.ts";
import { REFERRAL_TIERS } from "../src/lib/referral/program.ts";
import { copyValues } from "../src/lib/referral/values.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cacheDir = join(root, "node_modules/.cache");
mkdirSync(cacheDir, { recursive: true });
const outDir = mkdtempSync(join(cacheDir, "price-paths-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function load<T>(file: string): Promise<T> {
  const outfile = join(outDir, `${file.replace(/\W/g, "_")}.mjs`);
  await build({
    entryPoints: [join(root, file)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-dom"],
    loader: { ".css": "empty" },
    alias: { "@": join(root, "src") },
    logLevel: "silent",
  });
  return (await import(pathToFileURL(outfile).href)) as T;
}

const goal = REFERRAL_TIERS.find((tier) => tier.id === "team")!.minFriends;

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

type PathsModule = {
  PricePaths: (props: { locale: Locale; referralOn: boolean }) => ReactElement;
};
type GoalModule = {
  PriceGoal: (props: {
    locale: Locale;
    credited: number | null;
    held?: number | null;
    placement: "verify_card" | "signup_success";
    countState?: "loading" | "ready" | "error" | "unknown";
  }) => ReactElement;
  teamGoalFriends: () => number;
  teamLimitParagraph: (copy: ReturnType<typeof referralCopy>) => string;
  keptTierParagraph: (copy: ReturnType<typeof referralCopy>) => string;
};

const SECTION_TITLES: Record<Locale, string> = {
  en: "The $149 launch price",
  ko: "$149 출시 가격",
  ja: "149ドルの発売価格",
  "zh-CN": "$149 发布价",
  "zh-TW": "$149 上市價",
  es: "El precio de lanzamiento de $149",
  fr: "Le prix de lancement de 149 $",
  de: "Der Einführungspreis von 149 $",
  "pt-BR": "O preço de lançamento de US$ 149",
  nl: "De lanceringsprijs van $149",
};

test("signup price paths state the published gates and omit the buddy reward while the program is off", async () => {
  const { PricePaths } = await load<PathsModule>("src/components/segments/PricePaths.tsx");
  const { teamLimitParagraph } = await load<GoalModule>("src/components/referral/PriceGoal.tsx");
  const english = renderToStaticMarkup(createElement(PricePaths, { locale: "en", referralOn: true }));
  for (const locale of SUPPORTED_LOCALES) {
    const limit = escapeText(fill(teamLimitParagraph(referralCopy(locale)), copyValues(locale)));
    const offer = ONSITE_OFFER_COPY[locale];
    for (const referralOn of [false, true]) {
      const html = renderToStaticMarkup(createElement(PricePaths, { locale, referralOn }));
      const reservationHtml = html.slice(html.indexOf('data-price-path="reservation"'));
      const reservationVisible = reservationHtml.slice(0, reservationHtml.indexOf("<details"));
      const publicAt = html.indexOf('data-price-path="public"');
      const buddyAt = html.indexOf('data-price-path="buddy"');
      const paidAt = html.indexOf('data-price-path="reservation"');
      assert.match(html, new RegExp(`data-referral-program="${referralOn ? "on" : "off"}"`), locale);
      assert.ok(html.includes(`<h3>${escapeText(SECTION_TITLES[locale])}</h3>`), `${locale} price explanation heading`);
      assert.ok(html.includes(escapeText(conversionCopy[locale].terms)), `${locale} free email is not a price guarantee`);
      assert.ok(html.includes("200"), `${locale} shows the next public price`);
      assert.ok(reservationVisible.includes(escapeText(offer.body)), `${locale} says what the $3 buys`);
      assert.ok(reservationVisible.includes(TOTAL_BEFORE_SHIPPING_TAX_USD), `${locale} states the $3 plus $149 total`);
      assert.ok(reservationVisible.includes(escapeText(offer.separate)), `${locale} keeps the fee separate from $149`);
      assert.ok(reservationVisible.includes(escapeText(offer.noCharge)), `${locale} keeps no automatic charge visible`);
      assert.equal(reservationVisible.includes(escapeText(offer.refund)), false, `${locale} refund stays in the disclosure`);
      assert.ok(html.includes(`<summary>${escapeText(reservationCopy(locale).termsHeading)}</summary>`), locale);
      for (const summary of html.match(/<summary>.*?<\/summary>/g) ?? []) {
        assert.doesNotMatch(summary, /예약금|予約金/, locale);
      }
      assert.equal((html.match(/<li data-price-path="buddy"/g) ?? []).length, referralOn ? 1 : 0, locale);
      assert.ok(publicAt >= 0 && publicAt < paidAt, `${locale} public before the optional fee`);
      assert.doesNotMatch(html, /href="[^"]*(checkout|stripe|\/reservation)/i, locale);
      assert.doesNotMatch(html, /\{\w+\}/, `${locale} unfilled placeholder`);
      assert.ok(html.includes(`href="${localizePath("/terms", locale)}"`), locale);
      if (referralOn) {
        const buddyHtml = html.slice(buddyAt, paidAt);
        const buddyVisible = buddyHtml.slice(0, buddyHtml.indexOf("<details"));
        const shortReward = escapeText(fill(referralCopy(locale).tiers.team.reward, copyValues(locale)));
        assert.ok(publicAt < buddyAt && buddyAt < paidAt, `${locale} public, then buddy, then the fee`);
        assert.ok(buddyVisible.includes(shortReward), `${locale} buddy benefit stays visible`);
        assert.equal(buddyVisible.includes(limit), false, `${locale} full limits stay in the adjacent disclosure`);
        assert.ok(buddyHtml.includes(limit), `${locale} buddy disclosure uses the rules limit`);
        assert.ok(html.includes(`href="${localizePath("/buddy-rules", locale)}"`), locale);
        assert.equal(html.includes(escapeText(referralCopy(locale).mail.conditions[0])), false, locale);
      } else {
        assert.equal(buddyAt, -1, locale);
        assert.equal(html.includes(localizePath("/buddy-rules", locale)), false, locale);
        assert.equal(html.includes(limit), false, locale);
      }
    }
    if (locale === "ja" || locale === "zh-TW" || locale === "ko") {
      const html = renderToStaticMarkup(createElement(PricePaths, { locale, referralOn: true }));
      const heading = html.match(/<h3>(.*?)<\/h3>/)?.[1];
      const englishHeading = english.match(/<h3>(.*?)<\/h3>/)?.[1];
      assert.ok(heading && heading !== englishHeading, `${locale} heading fell back to English`);
    }
  }
  const traditional = renderToStaticMarkup(createElement(PricePaths, { locale: "zh-TW", referralOn: true }));
  assert.match(traditional, /可選的 \$3 預約/);
  assert.doesNotMatch(traditional, /選填|免费上线通知|可选 \$3/);
  const japanese = renderToStaticMarkup(createElement(PricePaths, { locale: "ja", referralOn: true }));
  assert.match(english, /The \$149 launch price/);
  assert.match(japanese, /<h3>149ドルの発売価格<\/h3>/);
  assert.match(japanese, /<h4>無料の公開通知<\/h4>/);
  assert.doesNotMatch(japanese, /無料の公開通知を受け取る|\$149が使える/);
});

test("the five-friend price goal keeps an unknown count unknown and does not replace it with a held tier", async () => {
  const { PriceGoal, teamGoalFriends, keptTierParagraph, teamLimitParagraph } = await load<GoalModule>("src/components/referral/PriceGoal.tsx");
  assert.equal(teamGoalFriends(), goal);
  for (const locale of SUPPORTED_LOCALES) {
    const copy = referralCopy(locale);
    const kept = escapeText(fill(keptTierParagraph(copy), copyValues(locale)));
    const limit = escapeText(fill(teamLimitParagraph(copy), copyValues(locale)));
    const unknown = renderToStaticMarkup(createElement(PriceGoal, {
      locale, credited: null, held: goal, placement: "verify_card",
    }));
    assert.match(unknown, /data-confirmed-emails="unknown"/, locale);
    assert.match(unknown, /data-held-team="held"/, locale);
    const goalVisible = unknown.slice(0, unknown.indexOf("<details"));
    const shortReward = escapeText(fill(copy.tiers.team.reward, copyValues(locale)));
    assert.ok(goalVisible.includes(shortReward), `${locale} short reward stays next to the count`);
    assert.equal(goalVisible.includes(limit), false, `${locale} full limits stay in the adjacent disclosure`);
    assert.ok(unknown.includes(kept), `${locale} held note uses the kept-tier sentence`);
    assert.equal(unknown.includes(escapeText(copy.mail.conditions[0])), false, locale);
    assert.ok(unknown.includes(limit), locale);
    assert.ok(goalVisible.includes(escapeText(copy.countingNote)), locale);
    const label = unknown.split('data-confirmed-label="">')[1]?.split("</p>")[0] ?? "";
    assert.equal(label.includes("0"), false, `${locale} unknown label: ${label}`);
    assert.doesNotMatch(unknown, /data-confirmed-emails="0"/, locale);

    const partial = renderToStaticMarkup(createElement(PriceGoal, {
      locale, credited: 2, held: goal, placement: "verify_card",
    }));
    assert.match(partial, /data-confirmed-emails="2"/, locale);
    assert.match(partial, /data-held-team="held"/, locale);
    assert.ok(partial.includes(String(goal)) === false || partial.includes(`data-confirmed-emails="2"`), locale);
    const partialLabel = partial.split('data-confirmed-label="">')[1]?.split("</p>")[0] ?? "";
    assert.match(partialLabel, /2/, locale);
    assert.equal(partialLabel.includes(String(goal)) && partialLabel.trim() === String(goal), false);

    const credited = renderToStaticMarkup(createElement(PriceGoal, {
      locale, credited: 3, placement: "signup_success",
    }));
    assert.match(credited, /data-confirmed-emails="3"/, locale);
    assert.equal(credited.includes("data-held-team"), false, locale);
    assert.ok(credited.includes(String(goal)), `${locale} names the Dive Team threshold`);
    assert.doesNotMatch(credited, /\{\w+\}/, locale);

    for (const countState of ["loading", "error"] as const) {
      const pending = renderToStaticMarkup(createElement(PriceGoal, {
        locale, credited: 0, held: goal, placement: "verify_card", countState,
      }));
      assert.match(pending, new RegExp(`data-confirmed-emails="${countState}"`), locale);
      assert.doesNotMatch(pending, /data-confirmed-emails="0"/, locale);
      const pendingLabel = pending.split('data-confirmed-label="">')[1]?.split("</p>")[0] ?? "";
      assert.equal(pendingLabel.includes("0"), false, `${locale} ${countState}: ${pendingLabel}`);
      assert.equal(pending.includes("data-held-note"), false, `${locale} ${countState} must not use the held tier as a count`);
    }
  }
});

test("the inline share uses the canonical /r path and the verify phone card stays after the price choices", async () => {
  const index = readFileSync(join(root, "src/routes/index.tsx"), "utf8");
  const success = index.slice(index.indexOf("function ReferralSuccess("), index.indexOf("type WebmailLabel"));
  assert.match(success, /referralPath\(locale, refCode\)/);
  assert.equal(success.includes("/?ref="), false);
  assert.match(success, /<PriceGoal/);
  assert.match(success, /data-analytics-hook=\{programOn \? "referral_share" : undefined\}/);
  assert.match(success, /if \(programOn\) void recordReferralCopy\("signup_success", locale\)/);
  assert.equal(success.includes("track("), false);
  const verifiedReturn = index.slice(index.indexOf("if (verified)"));
  assert.match(
    verifiedReturn,
    /if \(presentation\) return <><ReferralSuccess refCode=\{refCode\} \/><SignupReservationOffer locale=\{locale\} verified credential=\{\{ kind: "attempt", value: handle \}\} \/>\{phoneCard\("verified"\)\}<\/>;/,
  );
  assert.match(index, /if \(presentation\) return <>\{message\}\{offer\}\{phone\}<\/>;/);
  assert.match(index, /phoneOptIn=\{compact \|\| presentation \? undefined : phoneCard\("pending"\)\}/);
  assert.match(index, /\{!compact && presentation && phoneCard\("pending"\)\}/);
  const compactVerified = verifiedReturn.slice(verifiedReturn.indexOf("if (compact)"), verifiedReturn.indexOf("if (presentation)"));
  assert.equal(compactVerified.includes("SignupReservationOffer"), false);

  const card = readFileSync(join(root, "src/components/referral/VerifiedBuddyCard.tsx"), "utf8");
  assert.match(card, /<TierList locale=\{locale\} credited=\{confirmed\} \/>/);
  assert.equal(card.includes("credited={held}"), false);
  assert.match(card, /recordReferralCopy\("verify_card", locale\)/);
  assert.match(card, /data-analytics-hook="referral_share"/);

  const landing = readFileSync(join(root, "src/components/segments/SegmentLanding.tsx"), "utf8");
  assert.equal((landing.match(/<PricePaths\b/g) ?? []).length, 1);
  assert.match(landing, /position === 'middle' && <PricePaths locale=\{locale\} referralOn=\{referralOn\} \/>/);
  assert.match(landing, /<b>50%<\/b>/);
  const css = readFileSync(join(root, "src/components/segments/segments.css"), "utf8");
  assert.equal(css.includes("wd-segment-discount-pulse"), false);
  assert.match(css, /\.wd-segment-discount\{[^}]*pointer-events:none\}/);
  assert.match(css, /\.wd-segment-signup>\.wd-price-paths\{[^}]*grid-column:1 \/ -1;grid-row:2/);
  assert.match(css, /@media\(min-width:960px\)\{\s*\.wd-price-paths ol\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
  assert.match(css, /\[data-referral-program="off"\] ol\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /@media\(max-width:959px\)\{[^}]*\.wd-price-paths\{grid-column:auto;grid-row:auto\}/);

  const { VERIFY_CHOICE_COPY } = await load<{
    VERIFY_CHOICE_COPY: Record<Locale, Record<"buddy" | "reservation" | "phone", { mark: string; title: string }>>;
  }>("src/components/reservation/verify-steps.tsx");
  const { reservationChoiceTitle } = await load<{ reservationChoiceTitle: (locale: Locale) => string }>(
    "src/components/segments/PricePaths.tsx",
  );
  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(VERIFY_CHOICE_COPY[locale].reservation.title, reservationChoiceTitle(locale), locale);
    assert.doesNotMatch(VERIFY_CHOICE_COPY[locale].reservation.title, /lowest|Tiefst|최저|最低|最安|más bajo|plus bas|menor preço|laagste/i, locale);
  }
  assert.equal(VERIFY_CHOICE_COPY["zh-TW"].buddy.mark, "可選");
  assert.equal(VERIFY_CHOICE_COPY["zh-TW"].reservation.mark, "可選");
  assert.equal(VERIFY_CHOICE_COPY["zh-TW"].phone.mark, "可選");
  assert.equal(VERIFY_CHOICE_COPY.en.phone.title, "Get a text alert");

  const verify = readFileSync(join(root, "src/routes/verify.tsx"), "utf8");
  const verified = verify.slice(verify.indexOf('state === "verified"'), verify.indexOf('state === "expired"'));
  const buddy = verified.indexOf('choice="buddy"');
  const reservation = verified.indexOf('choice="reservation"');
  const phone = verified.indexOf('choice="phone"');
  assert.ok(buddy > 0 && buddy < reservation && reservation < phone);
  assert.match(verified, /<PhoneOptInCard/);
  assert.match(verified, /<SignupReservationOffer/);
  assert.equal(verified.includes("trackMeta"), false);
});
