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

test("rules name the privacy policy with exactly the words the rules page links", () => {
  for (const [locale, copy] of Object.entries(REFERRAL_COPY)) {
    const hits = copy.rules.sections
      .flatMap((s) => s.paragraphs)
      .filter((p) => p.includes(copy.rules.privacyLink));
    assert.equal(hits.length, 1, `${locale}: "${copy.rules.privacyLink}" must name one paragraph`);
    assert.equal(hits[0].split(copy.rules.privacyLink).length, 2, `${locale}: named once`);
  }
});

test("share wording names people you know, and the rules define the general list", () => {
  assert.match(REFERRAL_COPY.en.card.body, /^Share your link with divers you know\./);
  assert.match(REFERRAL_COPY.ko.card.body, /^아는 다이버에게 내 링크를 공유해 주세요\./);
  assert.match(REFERRAL_COPY.en.mail.welcomeIntro, /Share your personal invite link with divers you know/);
  assert.match(REFERRAL_COPY.ko.mail.welcomeIntro, /아는 다이버에게 공유해 주세요/);
  assert.match(REFERRAL_COPY.en.card.invitedNote, /they get credit for one friend/);
  assert.match(REFERRAL_COPY.ko.card.invitedNote, /집계에 1명이 더해지며/);
  assert.match(
    REFERRAL_COPY.en.rules.sections[5].paragraphs[0],
    /bulk or unsolicited messages/,
  );
  assert.match(REFERRAL_COPY.ko.rules.sections[5].paragraphs[0], /대량·무단 메시지/);
  assert.match(
    REFERRAL_COPY.en.rules.sections[6].paragraphs[0],
    /The general list is everyone on the waitlist who has not reached a Buddy Invite tier/,
  );
  assert.match(
    REFERRAL_COPY.ko.rules.sections[6].paragraphs[0],
    /일반 명단은 버디 초대 단계가 없는 대기 명단 전체/,
  );
  const generalList: Record<string, string> = {
    en: "The general list is everyone",
    ko: "일반 명단은",
    "zh-CN": "普通名单是",
    "zh-TW": "一般名單是",
    ja: "一般リストとは",
    es: "La lista general es",
    fr: "La liste générale",
    de: "Die allgemeine Liste sind",
    "pt-BR": "A lista geral é",
  };
  for (const [locale, copy] of Object.entries(REFERRAL_COPY)) {
    assert.doesNotMatch(copy.card.body, /\bSend your link\b|내 링크를 보내/, locale);
    const reward = copy.rules.sections[6].paragraphs[0];
    assert.ok(reward.includes("{hoursFirst}"), `${locale}: early-notice line`);
    assert.ok(reward.includes(generalList[locale]), `${locale}: general-list definition`);
  }
});

test("rules state the dates through their program.ts placeholders, never as typed literals", () => {
  for (const [locale, copy] of Object.entries(REFERRAL_COPY)) {
    const rules = copy.rules.sections.flatMap((s) => s.paragraphs).join("\n");
    assert.ok(rules.includes("{deliveryBy}"), `${locale}: delivery month must be {deliveryBy}`);
    assert.doesNotMatch(
      rules,
      /2027-0|23:59|March 2027|2027\s*년\s*3\s*월|2027\s*年\s*[13]\s*月|marzo|mars 2027|März|março/u,
      `${locale}: a long-stop or delivery date is typed in copy`,
    );
  }
});

test("rules state the rules ledger.ts, identity.ts and nickname.ts enforce", () => {
  for (const [locale, copy] of Object.entries(REFERRAL_COPY)) {
    const sections = copy.rules.sections;
    const counts = sections[4].paragraphs.join("\n");
    // One person counts once, under the documented provider aliases (identity.ts).
    for (const alias of ["Gmail", "+", "icloud.com", "me.com", "mac.com"])
      assert.ok(counts.includes(alias), `${locale}: "What counts" omits ${alias}`);
    // The nickname rule (nickname.ts) is stated on the rules page with its bounds.
    const board = sections[10].paragraphs.join("\n");
    assert.ok(board.includes("{min}") && board.includes("{max}"), `${locale}: nickname bounds`);
    assert.ok(/admin/.test(board), `${locale}: reserved-name example`);
  }
  const en = REFERRAL_COPY.en.rules.sections.flatMap((s) => s.paragraphs).join("\n");
  assert.match(en, /known disposable email services/);
  assert.match(en, /first joined the waitlist/);
  assert.match(en, /later unsubscribes from WatchDive emails still counts/);
  assert.match(en, /updated every few minutes/);
  assert.match(en, /without mixing Latin with Cyrillic or Greek letters/);
});

test("the reserved-name examples in the rules are ones nickname.ts actually rejects", async () => {
  const { checkNickname } = await import("../src/lib/referral/nickname.ts");
  for (const [locale, copy] of Object.entries(REFERRAL_COPY)) {
    const board = copy.rules.sections[10].paragraphs[0];
    // Examples are quoted or listed after "admin" in each locale.
    const examples =
      board.match(
        /(?<=[“«„(（：:、\s])(?:admin|official|staff|공식|官方|公式)(?=[”»“)）、\s,])/gu,
      ) ?? [];
    assert.ok(examples.length >= 2, `${locale}: examples ${examples.join(",")}`);
    for (const word of examples) {
      const check = checkNickname(`${word}`.padEnd(2, "x"));
      assert.equal(check.ok ? "ok" : check.reason, "reserved", `${locale}: ${word}`);
    }
  }
});
