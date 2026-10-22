import assert from "node:assert/strict";
import test from "node:test";
import { referralEvent } from "../src/lib/referral/event.ts";
import { REFERRAL_TIERS, TOP_PRIZE_WINNERS } from "../src/lib/referral/program.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { copyValues } from "../src/lib/referral/values.ts";
import { fill, referralCopy } from "../src/lib/referral/copy.ts";
import { buddyGuideBody, referralNoticeBody } from "../src/lib/verification/resend.ts";

test("event model preserves reviewed conditions and program-derived thresholds in every locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const model = referralEvent(locale, 3);
    assert.deepEqual(
      model.steps.map((s) => s.badge),
      [...REFERRAL_TIERS.map((t) => String(t.minFriends)), `TOP ${TOP_PRIZE_WINNERS}`],
    );
    assert.equal(model.steps.filter((s) => s.next)[0].id, "team");
    const copy = referralCopy(locale);
    for (const condition of Object.values(copy.event.conditions))
      assert.ok(model.conditions.includes(fill(condition, copyValues(locale))));
    assert.ok(model.conditions.includes(copy.countingNote));
    assert.equal(model.steps.find((s) => s.id === "top")!.reached, false);
    assert.doesNotMatch(JSON.stringify(model), /\{\w+\}/);
  }
});

test("compact notices show crossed and next steps without treating top rank as earned", () => {
  const footer = { korean: false, unsubscribeUrl: "https://watchdive.example/unsubscribe/fake" };
  for (const credited of [3, 10]) {
    const body = referralNoticeBody(
      {
        locale: "en",
        credited,
        crossed: credited === 3 ? ["buddy"] : ["team", "leader"],
        nextTier: credited === 3 ? "team" : null,
        remainingToNext: credited === 3 ? 2 : null,
        statusUrl: "https://watchdive.example/buddy#fake",
      },
      footer,
    );
    assert.equal((body.html.match(/<strong /g) ?? []).length, credited === 3 ? 2 : 3);
    assert.ok(body.html.includes("✓ Reached"));
    assert.ok(body.html.includes("→ Up next"));
    assert.ok(body.text.includes("Good to know"));
    assert.ok(body.text.includes("https://watchdive.example/buddy-rules"));
    assert.doesNotMatch(body.html, /display:\s*(flex|grid)/);
  }
  const guide = buddyGuideBody(
    {
      shareUrl: "https://watchdive.example/r/fake",
      statusUrl: "https://watchdive.example/buddy#fake",
      rulesUrl: "https://watchdive.example/buddy-rules",
    },
    "en",
    footer,
  );
  assert.equal((guide.html.match(/<strong /g) ?? []).length, REFERRAL_TIERS.length + 1);
  assert.ok(guide.text.includes("Bonus event!"));
});

function luminance(hex: string) {
  const c = hex
    .match(/\w\w/g)!
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
test("branded event and footer text keep 4.5:1 in light, dark and full inversion", () => {
  const invert = (hex: string) => (0xffffff ^ parseInt(hex, 16)).toString(16).padStart(6, "0");
  const contrast = (ink: string, bg: string) => {
    const [low, high] = [luminance(ink), luminance(bg)].sort((a,b) => a-b);
    return (high + 0.05) / (low + 0.05);
  };
  for (const [ink, bg] of [
    ["1a1238", "ffffff"], ["3d2683", "ffffff"],
    ["1a1238", "f5f3ee"], ["3d2683", "f5f3ee"],
    ["1a1238", "ebe7f5"], ["3d2683", "ebe7f5"],
    ["1a1238", "ffe55c"],
    ["ffffff", "3d2683"], ["eef9ff", "1a1238"], ["eef9ff", "07131c"],
  ]) {
    assert.ok(contrast(ink, bg) >= 4.5, `${ink}/${bg}`);
    assert.ok(contrast(invert(ink), invert(bg)) >= 4.5, `inverted ${ink}/${bg}`);
  }
});


test("badges express invitations with localized units, singulars and ranking captions", () => {
  const expected = {
    en: ["", "buddy invited", "buddies invited", "Invite ranking"],
    ko: ["명", "초대하면", "초대하면", "초대 랭킹"],
    "zh-CN": ["位", "邀请好友", "邀请好友", "邀请排名"],
    "zh-TW": ["位", "邀請好友", "邀請好友", "邀請排名"],
    ja: ["人", "招待すると", "招待すると", "招待ランキング"],
    es: ["", "amigo invitado", "amigos invitados", "Ranking de invitaciones"],
    fr: ["", "ami invité", "amis invités", "Classement des invitations"],
    de: ["", "Buddy eingeladen", "Buddys eingeladen", "Einladungsrang"],
    "pt-BR": ["", "amigo convidado", "amigos convidados", "Ranking de convites"],
  };
  for (const locale of SUPPORTED_LOCALES) {
    const model = referralEvent(locale);
    const [unit, one, other, top] = expected[locale];
    assert.equal(model.steps[0].badgeUnit, unit, locale);
    assert.equal(model.steps[0].badgeCaption, one, locale);
    for (const step of model.steps.slice(1, -1)) assert.equal(step.badgeCaption, other, locale);
    assert.equal(model.steps.at(-1)!.badgeCaption, top, locale);
    assert.equal(model.steps.at(-1)!.badgeUnit, "", locale);
    assert.ok(model.conditions.includes(referralCopy(locale).countingNote), locale);
  }
});
