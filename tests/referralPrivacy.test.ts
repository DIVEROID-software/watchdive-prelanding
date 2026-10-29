import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after, before } from "node:test";

import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { referralCopy } from "../src/lib/referral/copy.ts";
import { TOP_PRIZE_WINNERS } from "../src/lib/referral/program.ts";
import {
  BUDDY_INVITE_PRIVACY_TEMPLATES,
  buddyInvitePrivacy,
  type BuddyInvitePrivacyCopy,
} from "../src/lib/referralPrivacy.ts";
import { loadPrivacyHarness, type PrivacyHarness } from "./helpers/privacyRender.ts";

// SHA-256 of the privacy page as rendered at 8e2a0ef, before the Buddy Invite
// section existed (same harness, no loader data). With the program switch off
// the page must stay byte-identical to this. If the policy copy itself is
// changed on purpose, re-take these from the new off render in the same change.
const OFF_RENDER_SHA256: Record<Locale, string> = {
  en: "ff2b9a7a8a99fe8a5c446dbaf6ac5b2c847cf9f8a4a0a6cbef6a69762361cfd5",
  ko: "2afa2ed5b22c3a9a487f2654a24618a65a7bfcd8f8e292c61de0a4f374e4e854",
  "zh-CN": "bb68786757717f8b9d0bace351429a68ae3fe1ed318b0dd404b7e0964d19a113",
  "zh-TW": "4dd5a81ca27a18c09c90b1e452a0ed68b243d0181e0d1baa86a9c5611c6c9b8c",
  ja: "7d0ce9e3ed2a8df36105c92babf1458a032ac5aa967407b4d250d25fcf3c8f99",
  es: "767cb97add599e320ca91a138bbe2e2ca13d56d0bd2f187294f47e33846f0f00",
  fr: "5ea3653f24eaa79ecaf3f58cb79076f688b59e03dec36ea01035870ab7d097bd",
  de: "9c41abe2290f7ad361ed91ff9910ee0f823dcef94cabca447abe31bb88b11a29",
  "pt-BR": "9e0fc38da5013640b63a9062466a540c4e06b3010f755314ff06a308831bbad7",
  nl: "e62aeae19a6a906f09cff049e1acaf45918e0f95a3a422052dd6fc2f78a240c2",
};

// Same banned-claim pattern as tests/referralCopy.test.ts.
const BANNED =
  /guarantee|certified|approved|보장|保证|保證|保証|garantí|garantiz|garantie|garanti[sd]|garantid|zertifiziert|certificad|certifié|承認済み|aprobad|approuvé|genehmigt|aprovad/iu;

// Processors the policy's section 5 names. The program must not introduce others.
const NAMED_ELSEWHERE =
  /Stripe|Google|Meta|Clarity|Kakao|Twilio|Mailchimp|Sendgrid|Postmark|Airtable|Supabase|Firebase/iu;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const sectionOf = (html: string) =>
  html.match(/<section id="buddy-invite"[\s\S]*?<\/section>/)?.[0] ?? "";
const decode = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

function allStrings(copy: BuddyInvitePrivacyCopy): string[] {
  return Object.values(copy).flatMap((value) =>
    typeof value === "string" ? [value] : (value as readonly unknown[]).flat(2).map(String),
  );
}

let harness: PrivacyHarness;
before(async () => {
  harness = await loadPrivacyHarness();
});
after(() => harness?.dispose());

test("switch off: the loader returns nothing and every locale renders byte-identical to before", async () => {
  for (const state of [false, "throw"] as const) {
    harness.setProgram(state);
    const data = await harness.module.loadPrivacyPageData!();
    assert.equal(data, undefined, `loader with program ${state}`);
    for (const locale of SUPPORTED_LOCALES) {
      const html = harness.render(locale, data);
      assert.equal(sha256(html), OFF_RENDER_SHA256[locale], `${locale} off render changed`);
      assert.equal(html.includes("buddy-invite"), false);
    }
  }
});

test("switch on: every locale shows the section after Contact, filled and linked", async () => {
  harness.setProgram(true);
  const data = await harness.module.loadPrivacyPageData!();
  assert.deepEqual(data, { buddyInvite: true });
  for (const locale of SUPPORTED_LOCALES) {
    const html = harness.render(locale, data);
    const section = sectionOf(html);
    assert.ok(section, `${locale}: section missing`);
    const copy = buddyInvitePrivacy(locale);
    const text = decode(section);
    assert.ok(text.includes(copy.title), locale);
    assert.ok(copy.title.startsWith("11. "), locale);
    assert.ok(copy.title.includes(referralCopy(locale).programName), locale);
    for (const value of allStrings(copy)) {
      // Rights text is split around the mailto link; check its pieces instead.
      if (value.includes("help@diveroid.com")) continue;
      assert.ok(text.includes(value), `${locale}: missing ${value.slice(0, 40)}`);
    }
    assert.ok(section.includes('href="mailto:help@diveroid.com"'), locale);
    assert.ok(text.includes(referralCopy(locale).leaderboard.privateDiver), locale);
    assert.ok(text.includes(String(TOP_PRIZE_WINNERS)), locale);
    assert.doesNotMatch(text, /\{\w+\}/, `${locale}: unfilled placeholder`);
    // After section 10 (Contact) and before the closing rule.
    assert.ok(html.indexOf(section) > html.indexOf("help@diveroid.com"), locale);
    assert.ok(html.indexOf(section) < html.indexOf("<hr"), locale);
    // The rest of the page is unchanged: removing the section gives the off render.
    assert.equal(
      sha256(html.replace(section, "")),
      OFF_RENDER_SHA256[locale],
      `${locale}: rest of page changed`,
    );
  }
});

test("loader data of another route never turns the section on", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const html = harness.render(locale, { buddyInvite: false });
    assert.equal(sha256(html), OFF_RENDER_SHA256[locale], locale);
  }
});

test("all locales have the same shape, no banned claim words and only the policy's processors", () => {
  const en = BUDDY_INVITE_PRIVACY_TEMPLATES.en;
  for (const locale of SUPPORTED_LOCALES) {
    const template = BUDDY_INVITE_PRIVACY_TEMPLATES[locale];
    assert.ok(template, locale);
    assert.equal(template.stored.length, en.stored.length, `${locale} stored items`);
    assert.equal(template.purposes.length, en.purposes.length, `${locale} purposes`);
    const copy = buddyInvitePrivacy(locale);
    const strings = allStrings(copy);
    const joined = strings.join("\n");
    for (const value of strings) assert.ok(value.trim().length > 0, `${locale}: empty string`);
    assert.doesNotMatch(joined, BANNED, `${locale}: banned claim word`);
    assert.doesNotMatch(joined, NAMED_ELSEWHERE, `${locale}: processor not used by the program`);
    for (const required of [
      "Notion",
      "Resend",
      "Vercel",
      "DIVEROID LTD",
      "help@diveroid.com",
      "PIPA|개인정보 보호법|个人信息保护法|個人資訊保護法|個人情報保護法",
    ]) {
      assert.match(joined, new RegExp(required), `${locale}: ${required}`);
    }
    assert.match(joined, /GDPR|RGPD|DSGVO/, `${locale}: GDPR`);
    // Placeholders: only the three this module fills.
    const used = new Set(
      [
        ...allStrings(template)
          .join("\n")
          .matchAll(/\{(\w+)\}/g),
      ].map((m) => m[1]),
    );
    for (const name of used)
      assert.ok(["program", "privateDiver", "winners"].includes(name), `${locale}: {${name}}`);
    // The lead and its text are rendered back to back, so each body starts with the separator.
    for (const [, body] of [
      ...copy.stored,
      copy.friends,
      copy.visibility,
      copy.prizes,
      copy.legalBasis,
      copy.sharing,
      copy.retention,
      copy.rights,
    ]) {
      assert.ok(body.startsWith(" — "), `${locale}: ${body.slice(0, 20)}`);
    }
  }
});

test("the English section states what the program processes and nothing about friends' identities", () => {
  const text = allStrings(buddyInvitePrivacy("en")).join("\n");
  for (const fact of [
    /invite code/,
    /friend's invite code, not their name or email address/,
    /local storage/,
    /Nickname/,
    /leaderboard/,
    /friend joins/,
    /how many confirmed friends are counted/,
    /manual reward review/,
    /never who they are/,
    /name, shipping address and phone number/,
    /Korean withholding tax/,
    /as long as the law requires/,
    /delete or anonymise/,
    /GDPR and UK GDPR/,
    /Personal Information Protection Act/,
    /legitimate interest/,
    /\(consent\)/,
    /\(contract\)/,
    /legal obligation/,
    /Section 7/,
  ]) {
    assert.match(text, fact);
  }
});
