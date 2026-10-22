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
  assert.ok(guide.text.includes("EVENT"));
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
    ["201748", "ffffff"], ["3d2683", "ffffff"],
    ["201748", "eef9ff"], ["3d2683", "eef9ff"],
    ["ffffff", "3d2683"], ["eef9ff", "201748"], ["eef9ff", "07131c"],
  ]) {
    assert.ok(contrast(ink, bg) >= 4.5, `${ink}/${bg}`);
    assert.ok(contrast(invert(ink), invert(bg)) >= 4.5, `inverted ${ink}/${bg}`);
  }
});
