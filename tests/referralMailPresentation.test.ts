import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { referralCopy, fill } from "../src/lib/referral/copy.ts";
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
    const mail = referralCopy(locale).mail;
    const rendered = buddyGuideBody(links, locale, footer, "REEF42");
    for (const body of [rendered.html.slice(rendered.html.indexOf('<h1')), rendered.text]) {
      const positions = [mail.welcomeHeading, mail.welcomeOutro, mail.eventHeading, mail.shareHeading, links.shareUrl, "REEF42", links.statusUrl].map((s) => body.indexOf(s));
      assert.ok(positions.every((p) => p >= 0), locale);
      assert.deepEqual(positions, [...positions].sort((a,b)=>a-b), locale);
      for (const condition of mail.conditions) assert.ok(body.includes(fill(condition, copyValues(locale))), locale);
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
