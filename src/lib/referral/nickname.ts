// Leaderboard nickname check. The public board is the one place a referrer's
// own words reach strangers, so the rule is narrow: letters, numbers and a few
// separators, nothing that reaches a person (email, phone, link), nothing that
// could pass for us.
//
// Decisions:
//   - Emoji and symbols are rejected (`invalid_chars`). They are not letters,
//     numbers or marks, render differently per platform, and widen the space
//     for lookalike impersonation. Hangul, kana, CJK, accented Latin and any
//     other script's letters and combining marks are accepted.
//   - Length is counted in Unicode code points after NFC, trim and whitespace
//     collapse, so a Korean nickname of 16 syllables fits as well as 16 Latin
//     letters.
//   - Contact and reserved checks run on an NFKC, lowercased, separator-free
//     copy so full-width digits, `w.a.t.c.h.d.i.v.e` or `Watch Dive` cannot
//     slip past them. The stored value is the NFC form the person typed.
//   - Offensive words are not listed here; ops hide those by hand
//     (`Referral nickname hidden`), as the rules page says.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { NicknameCheck } from "./contract.ts";
import { NICKNAME_MAX, NICKNAME_MIN } from "./program.ts";

const ALLOWED = /^[\p{L}\p{M}\p{N} ._-]+$/u;

/** Six digits in a row, once separators are ignored, reads as a phone number. */
const PHONE_DIGITS = 6;

// A domain-looking `name.tld`. Matching any `x.abc` would reject ordinary
// nicknames such as `mr.kim`, so only TLDs people actually type are listed.
const LINK_TLDS = [
  "com",
  "net",
  "org",
  "io",
  "co",
  "kr",
  "me",
  "app",
  "dev",
  "ai",
  "xyz",
  "info",
  "biz",
  "ly",
  "gg",
  "tv",
  "us",
  "uk",
  "jp",
  "cn",
  "tw",
  "hk",
  "de",
  "fr",
  "es",
  "br",
  "ru",
  "link",
  "site",
  "online",
  "shop",
  "store",
  "club",
  "live",
  "page",
  "to",
  "be",
];
const DOMAIN_LIKE = new RegExp(
  `[\\p{L}\\p{N}-]\\.(?:${LINK_TLDS.join("|")})(?![\\p{L}\\p{N}])`,
  "u",
);

/** Matched as substrings of the folded nickname. */
const RESERVED = [
  "diveroid",
  "watchdive",
  "admin",
  "official",
  "kickstarter",
  "staff",
  "moderator",
  "support",
  "운영자",
  "관리자",
  "공식",
  "다이브로이드",
  "워치다이브",
  "킥스타터",
  "스태프",
  "운영팀",
  "官方",
  "管理员",
  "管理員",
  "公式",
  "運営",
];

function normalize(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function folded(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function checkNickname(raw: string): NicknameCheck {
  const value = normalize(typeof raw === "string" ? raw : "");
  const fold = folded(value);
  const compact = fold.replace(/[\s._\-()+/]/gu, "");

  if (fold.includes("@") || new RegExp(`\\p{Nd}{${PHONE_DIGITS},}`, "u").test(compact)) {
    return { ok: false, reason: "contact_info" };
  }
  if (compact.includes("http") || /www\./u.test(fold) || DOMAIN_LIKE.test(fold)) {
    return { ok: false, reason: "link" };
  }
  if (value.length > 0 && !ALLOWED.test(value)) return { ok: false, reason: "invalid_chars" };

  const length = [...value].length;
  if (length < NICKNAME_MIN) return { ok: false, reason: "too_short" };
  if (length > NICKNAME_MAX) return { ok: false, reason: "too_long" };
  // A nickname of only separators is not a name.
  if (!/[\p{L}\p{N}]/u.test(value)) return { ok: false, reason: "invalid_chars" };

  if (RESERVED.some((word) => compact.includes(word))) return { ok: false, reason: "reserved" };
  return { ok: true, value };
}
