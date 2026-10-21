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
//   - The stored value is NFKC-normalized (full-width and half-width forms,
//     ligatures and other compatibility variants become their plain letters),
//     trimmed, with whitespace runs collapsed to one space. Length is counted
//     in Unicode code points of that value, so a Korean nickname of 16
//     syllables fits as well as 16 Latin letters.
//   - Invisible and direction-changing characters are rejected outright
//     (`invalid_chars`): format controls such as ZWJ/ZWNJ, bidi overrides and
//     isolates (U+202A–202E, U+2066–2069), the soft hyphen, other controls, and
//     default-ignorable code points such as Hangul fillers (U+3164) and
//     variation selectors. They let two nicknames that look the same differ,
//     or make a name render reversed. Long runs of combining marks (zalgo)
//     are rejected too; ordinary accents and scripts that stack two or three
//     marks are fine.
//   - A nickname that mixes Latin letters with Cyrillic or Greek letters is
//     rejected: that is how lookalikes such as `аdmin` (Cyrillic а) are made
//     (UTS #39 mixed-script detection, https://www.unicode.org/reports/tr39/).
//     Latin with Hangul, kana or Han is fine (`Kim바다`), as is pure Cyrillic
//     or Greek.
//   - Contact and reserved checks run on a lowercased, separator-free copy,
//     so `w.a.t.c.h.d.i.v.e` or `Watch Dive` cannot slip past them. Reserved
//     words are also matched on a confusable skeleton: Cyrillic/Greek
//     lookalike letters, look-alike digits (0→o, 1→i or l, 3→e, 4→a, 5→s,
//     7→t) and `rn`→m, `vv`→w are folded to Latin first, so `Adm1n`,
//     `0fficial` or an all-Cyrillic `аdmіn` are reserved too.
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

/** Invisible, direction-changing, control, private-use and lone-surrogate code points. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Default_Ignorable_Code_Point}]/u;
/** More combining marks in a row than any ordinary script needs. */
const MARK_RUN = /\p{M}{3,}/u;
const LATIN = /\p{Script=Latin}/u;
const CYRILLIC_OR_GREEK = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

/**
 * Lowercase lookalikes folded to the Latin letter they imitate (after
 * lowercasing, so uppercase-only lookalikes such as Н/Т/М arrive as н/т/м).
 * A subset of the Unicode confusables data (UTS #39), limited to what can
 * spell the reserved words below.
 */
const CONFUSABLE: Record<string, string> = {
  // Cyrillic
  а: "a",
  г: "r",
  ѵ: "v",
  в: "b",
  е: "e",
  ё: "e",
  һ: "h",
  н: "h",
  і: "i",
  ї: "i",
  ј: "j",
  к: "k",
  ӏ: "l",
  м: "m",
  о: "o",
  р: "p",
  ԛ: "q",
  с: "c",
  ѕ: "s",
  т: "t",
  у: "y",
  ԝ: "w",
  х: "x",
  ԁ: "d",
  // Greek
  α: "a",
  β: "b",
  ε: "e",
  η: "n",
  ι: "i",
  κ: "k",
  μ: "u",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  ω: "w",
  γ: "y",
  // Latin lookalikes and digits
  ı: "i",
  ɑ: "a",
  ɡ: "g",
  "0": "o",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
};

/** Skeletons of a separator-free, lowercased nickname: `1` read as i and as l. */
function skeletons(compact: string): string[] {
  const base = [...compact].map((ch) => CONFUSABLE[ch] ?? ch).join("");
  return ["i", "l"].map((one) => base.replace(/1/g, one).replace(/rn/g, "m").replace(/vv/g, "w"));
}

function normalize(raw: string): string {
  return raw.replace(/\s+/gu, " ").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function checkNickname(raw: string): NicknameCheck {
  const input = typeof raw === "string" ? raw : "";
  const value = normalize(input);
  // Checked before and after normalization: NFKC can both remove and produce them.
  if (INVISIBLE.test(input.replace(/\s/gu, " ")) || INVISIBLE.test(value)) {
    return { ok: false, reason: "invalid_chars" };
  }
  const fold = value.toLowerCase();
  const compact = fold.replace(/[\s._\-()+/]/gu, "");

  if (fold.includes("@") || new RegExp(`\\p{Nd}{${PHONE_DIGITS},}`, "u").test(compact)) {
    return { ok: false, reason: "contact_info" };
  }
  if (compact.includes("http") || /www\./u.test(fold) || DOMAIN_LIKE.test(fold)) {
    return { ok: false, reason: "link" };
  }
  if (value.length > 0 && (!ALLOWED.test(value) || MARK_RUN.test(value))) {
    return { ok: false, reason: "invalid_chars" };
  }

  const length = [...value].length;
  if (length < NICKNAME_MIN) return { ok: false, reason: "too_short" };
  if (length > NICKNAME_MAX) return { ok: false, reason: "too_long" };
  // A nickname of only separators is not a name.
  if (!/[\p{L}\p{N}]/u.test(value)) return { ok: false, reason: "invalid_chars" };

  if (LATIN.test(value) && CYRILLIC_OR_GREEK.test(value)) {
    return { ok: false, reason: "invalid_chars" };
  }

  const forms = [compact, ...skeletons(compact)];
  if (RESERVED.some((word) => forms.some((form) => form.includes(word)))) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, value };
}
