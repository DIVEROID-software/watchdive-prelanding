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

test("the guide keeps the public invite separate from the status link; the notice drops both invite fields", () => {
  const guide = buddyGuideBody(links, "en", footer, "REEF42");
  for (const body of [guide.html, guide.text]) {
    assert.ok(body.includes(links.shareUrl));
    assert.ok(body.includes("REEF42"));
    assert.ok(body.includes(links.statusUrl));
  }
  const notice = {locale:"en" as const, credited:3, crossed:["buddy" as const],nextTier:"team" as const,remainingToNext:2,statusUrl:links.statusUrl,shareUrl:links.shareUrl};
  const rendered = referralNoticeBody({...notice,shareCode:"REEF42"}, footer);
  for (const body of [rendered.html, rendered.text]) {
    assert.equal(body.includes(links.shareUrl), false);
    assert.equal(body.includes("REEF42"), false);
    assert.ok(body.includes(links.statusUrl));
    assert.ok(body.includes("Reached: Buddy · 3 friends"));
  }
  assert.equal(referralNoticeBody({...notice,shareCode:'BAD<script>'},footer).html.includes('BAD'),false);
  assert.deepEqual(buddyGuideBody(links,"en",footer,'invalid code'),buddyGuideBody(links,"en",footer));
});


test("the guide keeps exactly five short conditions; the status notice does not sell the ladder", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = buddyMailCopy(locale);
    const values = { ...copyValues(locale), count: REFERRAL_TIERS.find((tier) => tier.id === "leader")!.minFriends };
    assert.equal(copy.mail.conditions.length, 5, locale);
    for (const condition of copy.mail.conditions) {
      assert.doesNotMatch(condition, /\d/, `${locale}: numbers must come from program values`);
    }
    const conditions = copy.mail.conditions.map((line) => fill(line, values));
    const rulesUrl = `https://watchdive.example${locale === "en" ? "" : `/${locale}`}/buddy-rules`;
    const guide = buddyGuideBody({ ...links, rulesUrl }, locale, footer);
    const block = guide.text.split(copy.event.conditionsTitle + "\n")[1];
    assert.ok(block, locale);
    assert.deepEqual(block.split("\n").slice(0, 7), [...conditions, copy.mail.welcomeRules, rulesUrl], locale);
    const htmlBlock = guide.html.split(`>${copy.event.conditionsTitle}</h3>`)[1].split("</td>")[0];
    assert.equal((htmlBlock.match(/<p /g) ?? []).length, 5, locale);
    assert.equal((htmlBlock.match(/<a /g) ?? []).length, 1, locale);
    assert.ok(htmlBlock.includes(`href="${rulesUrl}"`), locale);
    assert.ok(htmlBlock.includes(`>${copy.mail.welcomeRules}</a>`), locale);
    const notice = referralNoticeBody({ locale, credited: 3, crossed: ["buddy"], nextTier: "team", remainingToNext: 2,
      statusUrl: `https://watchdive.example${locale === "en" ? "" : `/${locale}`}/buddy#private-status-token`,
      shareUrl: links.shareUrl, shareCode: "REEF42" }, footer);
    assert.equal(notice.text.includes(copy.event.conditionsTitle), false, locale);
    assert.equal(notice.text.includes(copy.event.headline), false, locale);
    assert.equal(notice.html.includes(links.shareUrl), false, locale);
    assert.equal(notice.subject.includes("(광고)"), false, locale);
    assert.doesNotMatch(guide.text + guide.html + notice.text + notice.html, /\{\w+\}/, locale);
  }
});

test("invitation badges stay on the guide; the status notice keeps the status button only", async () => {
  const { buddyMailEvent } = await import("../src/lib/referral/mail-copy.ts");
  for (const locale of SUPPORTED_LOCALES) {
    const event = buddyMailEvent(locale);
    const guide = buddyGuideBody(links, locale, footer, "REEF42");
    const notice = referralNoticeBody({ locale, credited: 3, crossed: ["buddy"], nextTier: "team", remainingToNext: 2, statusUrl: links.statusUrl, shareUrl: links.shareUrl, shareCode: "REEF42" }, footer);
    const badges = [...guide.html.matchAll(/<td class="mail-badge[\s\S]*?<\/td>/g)].map((m) => m[0]);
    assert.ok(badges.length > 0, locale);
    for (const badge of badges) {
      assert.ok(badge.includes('bgcolor="#36A9E1"'), locale);
      assert.doesNotMatch(badge, /#ffe55c/, locale);
    }
    // Exactly two yellow cells on the guide: the event flag and the public share code.
    assert.equal((guide.html.match(/bgcolor="#ffe55c"/g) ?? []).length, 2, locale);
    assert.equal((notice.html.match(/bgcolor="#ffe55c"/g) ?? []).length, 0, locale);
    assert.equal((notice.html.match(/<td class="mail-badge/g) ?? []).length, 0, locale);
    assert.equal(notice.text.includes(event.subline), false, locale);
    for (const rendered of [guide, notice]) {
      assert.ok(rendered.html.includes('class="mail-accent mail-frame" align="center" bgcolor="#36A9E1"'), locale);
      assert.ok(rendered.html.includes('.mail-accent [style*="color:"]{color:#1a1238!important;-webkit-text-fill-color:#1a1238!important;}'), locale);
    }
    assert.ok(guide.text.includes(event.subline), locale);
    assert.ok(guide.text.includes(`${event.steps[1].badge}${event.steps[1].badgeUnit} ${event.steps[1].badgeCaption} →`), locale);
    for (const step of event.steps) {
      assert.ok(guide.html.includes(step.badgeCaption), locale);
      assert.ok(guide.text.includes(`${step.badge}${step.badgeUnit} ${step.badgeCaption} →`), locale);
    }
  }
});
