import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { fill } from "../src/lib/referral/copy.ts";
import { buddyMailCopy } from "../src/lib/referral/mail-copy.ts";
import { REFERRAL_TIERS } from "../src/lib/referral/program.ts";
import { copyValues } from "../src/lib/referral/values.ts";
import { buddyGuideBody, referralNoticeBody } from "../src/lib/verification/resend.ts";

const footer = { korean: false, unsubscribeUrl: "https://watchdive.example/unsubscribe/test" };
const links = {
  shareUrl: "https://watchdive.example/r/abc12345",
  statusUrl: "https://watchdive.example/buddy#private-status-token",
  rulesUrl: "https://watchdive.example/buddy-rules",
};

test("every guide confirms signup, introduces the event, then provides sharing in HTML and text", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const mail = buddyMailCopy(locale).mail;
    const rendered = buddyGuideBody(links, locale, footer, "REEF42");
    for (const body of [rendered.html.slice(rendered.html.indexOf('<h1')), rendered.text]) {
      const positions = [mail.welcomeHeading, mail.welcomeOutro, buddyMailCopy(locale).event.label, mail.shareHeading, links.shareUrl, "REEF42", links.statusUrl].map((s) => body.indexOf(s));
      assert.ok(positions.every((p) => p >= 0), locale);
      assert.deepEqual(positions, [...positions].sort((a,b)=>a-b), locale);
      for (const condition of mail.conditions) assert.ok(body.includes(fill(condition, { ...copyValues(locale), count: REFERRAL_TIERS.find((tier) => tier.id === "leader")!.minFriends })), locale);
    }
  }
});

test("public invite URL and validated code remain separate from the private status link", () => {
  const notice = {locale:"en" as const, credited:3, crossed:["buddy" as const],nextTier:"team" as const,remainingToNext:2,statusUrl:links.statusUrl,shareUrl:links.shareUrl};
  const rendered = referralNoticeBody({...notice,shareCode:"REEF42"}, footer);
  for (const body of [rendered.html, rendered.text]) {
    assert.ok(body.includes(links.shareUrl));
    assert.ok(body.includes("REEF42"));
    assert.ok(body.includes(links.statusUrl));
  }
  assert.equal(referralNoticeBody({...notice,shareCode:'BAD<script>'},footer).html.includes('BAD'),false);
  assert.deepEqual(buddyGuideBody(links,"en",footer,'invalid code'),buddyGuideBody(links,"en",footer));
});


test("guide and notice keep exactly five short conditions then a linked rules summary in every locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = buddyMailCopy(locale);
    const values = { ...copyValues(locale), count: REFERRAL_TIERS.find((tier) => tier.id === "leader")!.minFriends };
    assert.equal(copy.mail.conditions.length, 5, locale);
    for (const condition of copy.mail.conditions) {
      assert.doesNotMatch(condition, /\d/, `${locale}: numbers must come from program values`);
    }
    const conditions = copy.mail.conditions.map((line) => fill(line, values));
    const rulesUrl = `https://watchdive.example${locale === "en" ? "" : `/${locale}`}/buddy-rules`;
    const mails = [
      buddyGuideBody({ ...links, rulesUrl }, locale, footer),
      referralNoticeBody({ locale, credited: 3, crossed: ["buddy"], nextTier: "team", remainingToNext: 2,
        statusUrl: `https://watchdive.example${locale === "en" ? "" : `/${locale}`}/buddy#private-status-token` }, footer),
    ];
    for (const body of mails) {
      const block = body.text.split(copy.event.conditionsTitle + "\n")[1];
      assert.ok(block, locale);
      assert.deepEqual(block.split("\n").slice(0, 7), [...conditions, copy.mail.welcomeRules, rulesUrl], locale);
      const htmlBlock = body.html.split(`>${copy.event.conditionsTitle}</h3>`)[1].split("</td>")[0];
      assert.equal((htmlBlock.match(/<p /g) ?? []).length, 5, locale);
      assert.equal((htmlBlock.match(/<a /g) ?? []).length, 1, locale);
      assert.ok(htmlBlock.includes(`href="${rulesUrl}"`), locale);
      assert.ok(htmlBlock.includes(`>${copy.mail.welcomeRules}</a>`), locale);
      assert.doesNotMatch(body.text + body.html, /\{\w+\}/, locale);
    }
  }
});

test("invitation badges and colour roles match the shared model in guide and notice", async () => {
  const { buddyMailEvent } = await import("../src/lib/referral/mail-copy.ts");
  for (const locale of SUPPORTED_LOCALES) {
    const event = buddyMailEvent(locale);
    const guide = buddyGuideBody(links, locale, footer, "REEF42");
    const notice = referralNoticeBody({ locale, credited: 3, crossed: ["buddy"], nextTier: "team", remainingToNext: 2, statusUrl: links.statusUrl, shareUrl: links.shareUrl, shareCode: "REEF42" }, footer);
    for (const rendered of [guide, notice]) {
      const badges = [...rendered.html.matchAll(/<td class="mail-badge[\s\S]*?<\/td>/g)].map((m) => m[0]);
      assert.ok(badges.length > 0, locale);
      for (const badge of badges) {
        assert.ok(badge.includes('bgcolor="#36A9E1"'), locale);
        assert.doesNotMatch(badge, /#ffe55c/, locale);
      }
      // Exactly two yellow cells: the event flag and the public share code.
      assert.equal((rendered.html.match(/bgcolor="#ffe55c"/g) ?? []).length, 2, locale);
      assert.ok(rendered.html.includes('class="mail-accent mail-frame" align="center" bgcolor="#36A9E1"'), locale);
      assert.ok(rendered.html.includes('.mail-accent [style*="color:"]{color:#1a1238!important;-webkit-text-fill-color:#1a1238!important;}'), locale);
      assert.ok(rendered.text.includes(event.subline), locale);
      assert.ok(rendered.text.includes(`${event.steps[1].badge}${event.steps[1].badgeUnit} ${event.steps[1].badgeCaption} →`), locale);
    }
    for (const step of event.steps) {
      assert.ok(guide.html.includes(step.badgeCaption), locale);
      assert.ok(guide.text.includes(`${step.badge}${step.badgeUnit} ${step.badgeCaption} →`), locale);
    }
  }
});
