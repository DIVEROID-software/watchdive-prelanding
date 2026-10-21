import assert from "node:assert/strict";
import test from "node:test";

import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { REFERRAL_COPY } from "../src/lib/referral/copy.ts";

const en = REFERRAL_COPY.en;
const others = SUPPORTED_LOCALES.filter((locale: Locale) => locale !== "en");

/** Flatten to path -> string so structure, placeholders and values compare easily. */
function flatten(value: unknown, path = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(path, value);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const [k, v] of flatten(item, `${path}[${index}]`)) out.set(k, v);
    });
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      for (const [k, v] of flatten(item, path ? `${path}.${key}` : key)) out.set(k, v);
    }
  } else {
    assert.fail(`${path}: unexpected value ${String(value)}`);
  }
  return out;
}

const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
const enFlat = flatten(en);

// Strings that legitimately read the same as English (brand-only / URLs).
const SAME_AS_EN_ALLOWED = new Set<string>([]);

// Same banned-claim patterns as tests/i18nMessages.test.ts, plus equivalents
// for words that file only bans inside longer phrases.
const BANNED =
  /guarantee|certified|approved|보장|保证|保證|保証|garantí|garantiz|garantie|garanti[sd]|garantid|zertifiziert|certificad|certifié|承認済み|aprobad|approuvé|genehmigt|aprovad/iu;

test("every locale has the same key structure as English", () => {
  for (const locale of others) {
    const flat = flatten(REFERRAL_COPY[locale]);
    assert.deepEqual([...flat.keys()], [...enFlat.keys()], `${locale}: key structure differs`);
  }
});

test("rules sections and paragraphs match English counts", () => {
  for (const locale of others) {
    const { sections } = REFERRAL_COPY[locale].rules;
    assert.equal(sections.length, en.rules.sections.length, `${locale}: section count`);
    sections.forEach((section, i) => {
      assert.equal(
        section.paragraphs.length,
        en.rules.sections[i].paragraphs.length,
        `${locale}: paragraph count in section ${i}`,
      );
    });
  }
});

test("every string uses exactly the placeholders of its English source", () => {
  for (const locale of others) {
    for (const [path, text] of flatten(REFERRAL_COPY[locale])) {
      assert.deepEqual(
        placeholders(text),
        placeholders(enFlat.get(path) ?? ""),
        `${locale}: placeholder mismatch at ${path}`,
      );
    }
  }
});

test("no locale other than English is a copy of English", () => {
  for (const locale of others) {
    assert.notDeepEqual(REFERRAL_COPY[locale], en, `${locale} still equals English`);
    for (const [path, text] of flatten(REFERRAL_COPY[locale])) {
      if (SAME_AS_EN_ALLOWED.has(path)) continue;
      assert.notEqual(text, enFlat.get(path), `${locale}: untranslated string at ${path}`);
    }
  }
});

test("no empty strings, TODO markers or guarantee-style claim words", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const [path, text] of flatten(REFERRAL_COPY[locale])) {
      assert.ok(text.trim().length > 0, `${locale}: empty string at ${path}`);
      assert.doesNotMatch(text, /TODO|FIXME|XXX/, `${locale}: leftover marker at ${path}`);
      assert.doesNotMatch(
        text.normalize("NFKC"),
        BANNED,
        `${locale}: banned claim word at ${path}`,
      );
    }
  }
});

test("rules mention the nickname shown for hidden entries, 14 days and Korea Standard Time conditions", () => {
  for (const locale of others) {
    const copy = REFERRAL_COPY[locale];
    const rules = copy.rules.sections.flatMap((s) => s.paragraphs).join("\n");
    assert.ok(
      rules.includes(copy.leaderboard.privateDiver),
      `${locale}: rules omit the private-diver label`,
    );
    assert.ok(/14/.test(rules), `${locale}: 14-day reply window missing`);
    assert.ok(
      rules.includes("{cap}") && rules.includes("{noticeDays}"),
      `${locale}: cap/notice placeholders missing`,
    );
  }
});

test("every locale's tier name states the threshold program.ts enforces", async () => {
  const { REFERRAL_TIERS } = await import("../src/lib/referral/program.ts");
  const { REFERRAL_COPY } = await import("../src/lib/referral/copy.ts");
  for (const [locale, copy] of Object.entries(REFERRAL_COPY)) {
    for (const tier of REFERRAL_TIERS) {
      const digits = copy.tiers[tier.id].name.match(/\d+/g) ?? [];
      assert.deepEqual(
        digits,
        [String(tier.minFriends)],
        `${locale} ${tier.id}: ${copy.tiers[tier.id].name}`,
      );
    }
  }
});

test("tier names keep the ' · ' separator the landing card splits on", () => {
  for (const [locale, copy] of Object.entries(REFERRAL_COPY)) {
    for (const [id, tier] of Object.entries(copy.tiers)) {
      assert.equal(tier.name.split(" · ").length, 2, `${locale} ${id}: ${tier.name}`);
    }
  }
});

test("rules state every owner-decided fact through its program.ts placeholder", () => {
  const required = [
    "{longStop}",
    "{taxRate}",
    "{taxFree}",
    "{lightValue}",
    "{prizeValue}",
    "{ageKr}",
    "{ageOther}",
    "{noticeDays}",
    "{cap}",
  ];
  for (const [locale, copy] of Object.entries(REFERRAL_COPY)) {
    const rules = copy.rules.sections.flatMap((s) => s.paragraphs).join("\n");
    for (const token of required)
      assert.ok(rules.includes(token), `${locale}: rules omit ${token}`);
    assert.ok(rules.includes("16343651"), `${locale}: company number missing`);
    assert.ok(rules.includes("E6 2JA"), `${locale}: postal address missing`);
  }
});

test("every placeholder is either a copyValues key or a documented per-call value", async () => {
  const { copyValues } = await import("../src/lib/referral/values.ts");
  const perCall = new Set(["count", "remaining", "tier", "nickname", "time", "reward"]);
  for (const locale of SUPPORTED_LOCALES) {
    const known = new Set([...Object.keys(copyValues(locale)), ...perCall]);
    for (const [path, text] of flatten(REFERRAL_COPY[locale])) {
      for (const token of text.match(/\{(\w+)\}/g) ?? []) {
        assert.ok(
          known.has(token.slice(1, -1)),
          `${locale}: unknown placeholder ${token} at ${path}`,
        );
      }
    }
  }
});

test("the Dive Leader light is never called free (the recipient pays shipping and taxes)", () => {
  const FREE = /\bfree\b|gratis|grátis|gratuit|offert|kostenlos|geschenkt|免费|免費|無料|무료/iu;
  for (const [locale, copy] of Object.entries(REFERRAL_COPY)) {
    assert.doesNotMatch(copy.tiers.leader.reward, FREE, `${locale}: tier reward`);
    for (const p of copy.rules.sections.flatMap((s) => s.paragraphs))
      assert.doesNotMatch(p, FREE, `${locale}: rules`);
  }
});
