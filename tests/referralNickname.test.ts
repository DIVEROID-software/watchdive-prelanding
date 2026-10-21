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
