import assert from "node:assert/strict";
import test from "node:test";

import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import {
  LAUNCH_SMS_COPY_VERSION,
  LAUNCH_SMS_KO_MARKETING_PREFIX,
  LAUNCH_SMS_LAUNCH_URL_TOKEN,
  LAUNCH_SMS_OPT_OUT_TOKEN,
  LAUNCH_SMS_PROVIDER_INSTALLED,
  LAUNCH_SMS_RESERVATION_URL_TOKEN,
  LAUNCH_SMS_SEGMENT_POLICY,
  launchSmsOptOutLabel,
  renderLaunchSms,
} from "../src/lib/launchSms/copy.ts";
import { buddyGuideBody, KR_AD_SUBJECT_PREFIX, referralNoticeBody } from "../src/lib/verification/resend.ts";

const BANNED =
  /coupon|쿠폰|优惠券|優惠券|クーポン|cup[oó]n|Gutschein|cupom|bit\.ly|tinyurl|kickstarter\.com|kck\.st|t\.co|2026|2027|November|December|11월|12월|오늘만|마감 임박|仅剩|残りわずか|last chance|ends tonight/i;

test("launch SMS covers nine locales, two variants, and no live link", () => {
  assert.equal(LAUNCH_SMS_PROVIDER_INSTALLED, false);
  assert.equal(LAUNCH_SMS_SEGMENT_POLICY, "shared");
  assert.equal(SUPPORTED_LOCALES.length, 10);
  assert.notEqual(LAUNCH_SMS_LAUNCH_URL_TOKEN, LAUNCH_SMS_RESERVATION_URL_TOKEN);
  assert.equal(LAUNCH_SMS_KO_MARKETING_PREFIX, KR_AD_SUBJECT_PREFIX);
  for (const locale of SUPPORTED_LOCALES) {
    for (const segment of ["general", "scuba", "freediving", null]) {
      const launch = renderLaunchSms({ savedSignupLocale: locale, variant: "launch", segment });
      const paid = renderLaunchSms({ savedSignupLocale: locale, variant: "paid-reserver", segment });
      assert.equal(launch.locale, locale);
      assert.equal(paid.locale, locale);
      assert.equal(launch.body, renderLaunchSms({ savedSignupLocale: locale, variant: "launch", segment: "scuba" }).body);
      assert.equal(launch.version, LAUNCH_SMS_COPY_VERSION);
      assert.equal(launch.providerInstalled, false);
      assert.ok(launch.body.includes("WatchDive"));
      assert.ok(launch.body.includes("DIVEROID"));
      assert.ok(launch.body.includes(LAUNCH_SMS_LAUNCH_URL_TOKEN));
      assert.equal(launch.body.includes(LAUNCH_SMS_RESERVATION_URL_TOKEN), false);
      assert.equal(paid.body.includes(LAUNCH_SMS_LAUNCH_URL_TOKEN), false);
      assert.ok(paid.body.includes(LAUNCH_SMS_RESERVATION_URL_TOKEN));
      assert.ok(launch.body.includes("100"));
      assert.ok(launch.body.includes("149"));
      assert.ok(launch.body.includes("200"));
      assert.equal(/\$3|3 USD|US\$ 3/.test(launch.body), false, locale);
      assert.equal(/\$3|3 USD|US\$ 3/.test(paid.body), false, locale);
      assert.ok(paid.body.includes("149"));
      assert.equal(paid.body.includes("200"), false, locale);
      assert.ok(launch.body.endsWith(LAUNCH_SMS_OPT_OUT_TOKEN));
      assert.ok(paid.body.endsWith(LAUNCH_SMS_OPT_OUT_TOKEN));
      assert.equal(launch.optOutLabel, launchSmsOptOutLabel(locale));
      assert.doesNotMatch(launch.body + paid.body, BANNED);
      assert.ok(launch.characters > 40 && launch.characters < 500, `${locale} ${launch.characters}`);
    }
  }
});

test("saved signup locale falls back to English, and KR signup country keeps the Korean marketing prefix", () => {
  for (const saved of [undefined, null, "", "en-US", "KR", "zh", "jp"]) {
    const draft = renderLaunchSms({ savedSignupLocale: saved, variant: "launch" });
    assert.equal(draft.locale, "en");
    assert.equal(draft.usedEnglishFallback, true);
    assert.equal(draft.koreanMarketingPrefix, false);
    assert.equal(draft.body.startsWith("(광고)"), false);
    assert.ok(draft.body.includes("Opt out:"));
  }
  const ko = renderLaunchSms({ savedSignupLocale: "ko", variant: "launch" });
  assert.equal(ko.koreanMarketingPrefix, true);
  assert.ok(ko.body.startsWith("(광고) "));
  assert.ok(ko.body.includes("무료수신거부"));
  assert.equal(ko.body.includes("Opt out:"), false);
  const krEnglish = renderLaunchSms({ savedSignupLocale: "en", signupCountry: " kr ", variant: "paid-reserver" });
  assert.equal(krEnglish.locale, "en");
  assert.equal(krEnglish.usedEnglishFallback, false);
  assert.ok(krEnglish.body.startsWith("(광고) "));
  assert.ok(krEnglish.body.includes("무료수신거부"));
  assert.ok(krEnglish.body.includes(LAUNCH_SMS_RESERVATION_URL_TOKEN));
  assert.equal(krEnglish.body.includes("Opt out:"), false);
});

test("the buddy status subject stays unprefixed while the guide and launch SMS keep (광고)", () => {
  const footer = {
    korean: true as const,
    senderPhone: "+82 2-0000-0000",
    unsubscribeUrl: "https://watchdive.example/unsubscribe/u1.example",
  };
  const notice = referralNoticeBody(
    {
      locale: "ko",
      credited: 1,
      crossed: ["first"],
      nextTier: "buddy",
      remainingToNext: 2,
      statusUrl: "https://watchdive.example/ko/buddy#status",
      shareUrl: "https://watchdive.example/r/abcd1234",
      shareCode: "REEF42",
    },
    footer,
  );
  assert.equal(notice.subject, "내 링크로 버디가 참여했어요 (지금까지 1명)");
  assert.equal(notice.subject.includes("(광고)"), false);
  assert.equal(notice.text.includes("https://watchdive.example/r/"), false);
  assert.equal(notice.text.includes("REEF42"), false);
  assert.ok(notice.text.includes("달성: 첫 초대 · 1명"));
  assert.ok(notice.text.includes("보내는 곳:"));
  const guide = buddyGuideBody(
    {
      shareUrl: "https://watchdive.example/r/abcd1234",
      statusUrl: "https://watchdive.example/ko/buddy#status",
      rulesUrl: "https://watchdive.example/ko/buddy-rules",
    },
    "ko",
    footer,
    "REEF42",
  );
  assert.ok(guide.subject.startsWith("(광고) "));
  assert.ok(guide.text.includes("https://watchdive.example/r/abcd1234"));
  const sms = renderLaunchSms({ savedSignupLocale: "ko", variant: "launch" });
  assert.ok(sms.body.startsWith("(광고) "));
  assert.notEqual(sms.body.split("\n")[0], notice.subject);
});

