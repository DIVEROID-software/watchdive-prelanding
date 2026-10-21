import assert from "node:assert/strict";
import { test } from "node:test";

import { checkNickname } from "../src/lib/referral/nickname.ts";

function reason(raw: string): string {
  const result = checkNickname(raw);
  return result.ok ? `ok:${result.value}` : result.reason;
}

test("accepts letters and numbers in any script, normalized", () => {
  assert.equal(reason("바다거북"), "ok:바다거북");
  assert.equal(reason("  Reef   Diver_07 "), "ok:Reef Diver_07");
  assert.equal(reason("ダイバー"), "ok:ダイバー");
  assert.equal(reason("潜水员"), "ok:潜水员");
  assert.equal(reason("José.M-Dive"), "ok:José.M-Dive");
  assert.equal(reason("mr.kim"), "ok:mr.kim");
  // NFD input is stored as NFC.
  assert.equal(reason("José"), "ok:José");
  // Hangul jamo given as NFD compose to syllables.
  assert.equal(reason("가나"), "ok:가나");
});

test("length is in code points after normalization", () => {
  assert.equal(reason("a"), "too_short");
  assert.equal(reason("   "), "too_short");
  assert.equal(reason("가나"), "ok:가나");
  assert.equal(reason("가".repeat(16)), `ok:${"가".repeat(16)}`);
  assert.equal(reason("가".repeat(17)), "too_long");
  assert.equal(reason("a".repeat(17)), "too_long");
});

test("emoji and symbols are rejected", () => {
  assert.equal(reason("Diver 🐢"), "invalid_chars");
  assert.equal(reason("🐢🐢🐢"), "invalid_chars");
  assert.equal(reason("<b>hi</b>"), "invalid_chars");
  assert.equal(reason("..--"), "invalid_chars");
});

test("contact details are rejected", () => {
  assert.equal(reason("me@gmail"), "contact_info");
  assert.equal(reason("010-1234-5678"), "contact_info");
  assert.equal(reason("call 010 1234"), "contact_info");
  assert.equal(reason("０１０１２３４"), "contact_info");
  assert.equal(reason("Diver 2026"), "ok:Diver 2026");
  assert.equal(reason("Diver12345"), "ok:Diver12345");
});

test("links are rejected", () => {
  assert.equal(reason("http stuff"), "link");
  assert.equal(reason("https://x.io"), "link");
  assert.equal(reason("www.reef"), "link");
  assert.equal(reason("reef.com"), "link");
  assert.equal(reason("dive.kr"), "link");
  assert.equal(reason("dive.KR"), "link");
});

test("reserved words are rejected, however they are spaced or cased", () => {
  for (const name of [
    "DIVEROID fan",
    "Watch Dive",
    "w.a.t.c.h-dive",
    "Admin",
    "Official Team",
    "Kickstarter",
    "staff01",
    "운영자",
    "관리자님",
    "ＷａｔｃｈＤｉｖｅ",
  ]) {
    assert.equal(reason(name), "reserved", name);
  }
});

test("non-string input is treated as empty", () => {
  assert.equal(reason(undefined as unknown as string), "too_short");
});

test("the stored value is NFKC: full-width and half-width forms become plain letters", () => {
  assert.equal(reason("Ｒｅｅｆ　Ｄｉｖｅｒ"), "ok:Reef Diver");
  assert.equal(reason("ﾀﾞｲﾊﾞｰ"), "ok:ダイバー");
  assert.equal(reason("ﬁsh diver"), "ok:fish diver");
});

test("invisible, format and bidi control characters are rejected", () => {
  for (const [name, raw] of [
    ["zero-width space", "Reef\u200BDiver"],
    ["zero-width joiner", "Reef\u200DDiver"],
    ["zero-width non-joiner", "바다\u200C거북"],
    ["right-to-left override", "Reef\u202EreviD"],
    ["left-to-right isolate", "\u2066Reef\u2069"],
    ["right-to-left mark", "Reef\u200F"],
    ["soft hyphen", "Re\u00ADef"],
    ["word joiner", "Re\u2060ef"],
    ["Hangul filler", "\u3164\u3164"],
    ["Hangul filler inside", "바다\u3164거북"],
    ["halfwidth Hangul filler", "Reef\uFFA0"],
    ["variation selector", "Reef\uFE0F"],
    ["tag character", "Reef\u{E0041}"],
    ["control", "Reef\u0007"],
    ["private use", "Reef\uE000"],
  ] as const) {
    assert.equal(reason(raw), "invalid_chars", name);
  }
});

test("zalgo is rejected; ordinary combining marks are fine", () => {
  assert.equal(reason("Ree\u0301\u0302\u0303\u0304f"), "invalid_chars");
  assert.equal(reason("Ng\u01B0\u1EDDi".normalize("NFD")), "ok:Ng\u01B0\u1EDDi");
  assert.equal(reason("नमस\u094Dत\u0947"), "ok:नमस\u094Dत\u0947");
});

test("Latin mixed with Cyrillic or Greek is rejected; other scripts stay valid", () => {
  assert.equal(reason("Reef Diver"), "ok:Reef Diver");
  // Cyrillic а / о / е inside Latin words.
  assert.equal(reason("Rееf Diver"), "invalid_chars");
  assert.equal(reason("Sea Gоd"), "invalid_chars");
  // Mixed lookalikes of a reserved word are refused before the reserved check.
  assert.equal(reason("аdmіn"), "invalid_chars");
  assert.equal(reason("ωatchdive"), "invalid_chars");
  // Greek ο / α.
  assert.equal(reason("Ocean Lοver"), "invalid_chars");
  assert.equal(reason("Αlpha Dive"), "invalid_chars");
  // Different scripts that cannot pass for Latin are fine together.
  assert.equal(reason("Kim바다"), "ok:Kim바다");
  assert.equal(reason("Diver ダイバー"), "ok:Diver ダイバー");
  assert.equal(reason("潜水 Fan"), "ok:潜水 Fan");
  assert.equal(reason("Zoë Müller"), "ok:Zoë Müller");
  assert.equal(reason("Łukasz Ørsted"), "ok:Łukasz Ørsted");
  // Pure Cyrillic and pure Greek names are fine.
  assert.equal(reason("Дайвер"), "ok:Дайвер");
  assert.equal(reason("Δύτης"), "ok:Δύτης");
});

test("reserved words are matched after confusable folding", () => {
  for (const name of [
    "ԁіѵегоіԁ", // all Cyrillic: ԁ і ѵ е г о і ԁ
    "Adm1n",
    "0fficial",
    "w4tchd1ve",
    "WATCHD1VE",
    "Watch-D!ve".replace("!", "1"),
    "adrnin",
    "vvatchdive",
    "5taff",
    "supp0rt",
    "Κickstarter".replace("Κ", "K"),
  ]) {
    assert.equal(reason(name), "reserved", name);
  }
  // Ordinary names that only resemble nothing reserved stay valid.
  for (const name of [
    "Diver12345",
    "Reef 0707",
    "Ocean Lover 7",
    "Fern Admirer",
    "Kim1004",
    "바다사랑3",
  ]) {
    assert.equal(reason(name).startsWith("ok:"), true, name);
  }
});
