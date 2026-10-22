import assert from "node:assert/strict";
import { test } from "node:test";

import { conversionCopy } from "../src/lib/conversionCopy.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { REFERRAL_COPY, fill } from "../src/lib/referral/copy.ts";
import {
  CLOSE_NOTICE_DAYS,
  DAILY_CREDIT_CAP,
  EARLY_BIRD_SEATS,
  EARLY_NOTICE_HOURS,
  LEADER_LIGHT_STOCK,
  LONG_STOP_CLOSE,
  NICKNAME_MAX,
  NICKNAME_MIN,
  SHARE_CODE_MAX,
  SHARE_CODE_MIN,
  PRIZE_DELIVERY_BY,
  TOP_PRIZE_WINNERS,
} from "../src/lib/referral/program.ts";
import {
  copyValues,
  formatKstDateTime,
  formatKstMonth,
  formatOfferPrice,
  tierValues,
} from "../src/lib/referral/values.ts";

const PER_CALL = new Set(["count", "remaining", "tier", "nickname", "time", "reward"]);

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

test("the price matches the landing's $149 offer line in every locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const price = copyValues(locale).price;
    assert.ok(conversionCopy[locale].benefit.includes(price), `${locale}: ${price}`);
  }
  assert.equal(formatOfferPrice("ko"), "$149");
  assert.equal(formatOfferPrice("fr"), "149 $");
  assert.equal(formatOfferPrice("pt-BR"), "US$ 149");
});

test("values come from program.ts", () => {
  assert.deepEqual(copyValues("en"), {
    hours: EARLY_NOTICE_HOURS.first,
    hoursFirst: EARLY_NOTICE_HOURS.first,
    hoursBuddy: EARLY_NOTICE_HOURS.buddy,
    price: "$149",
    seats: EARLY_BIRD_SEATS,
    stock: LEADER_LIGHT_STOCK,
    winners: TOP_PRIZE_WINNERS,
    cap: DAILY_CREDIT_CAP,
    noticeDays: CLOSE_NOTICE_DAYS,
    min: NICKNAME_MIN,
    max: NICKNAME_MAX,
    codeMin: SHARE_CODE_MIN,
    codeMax: SHARE_CODE_MAX,
    lightValue: "$70",
    prizeValue: "$299",
    ageKr: 19,
    ageOther: 18,
    longStop: "31 January 2027, 23:59 Korea Standard Time",
    deliveryBy: "March 2027",
    taxFree: "KRW 50,000",
    taxRate: 22,
  });
  assert.equal(tierValues("en", "buddy").hours, EARLY_NOTICE_HOURS.buddy);
});

test("every non-per-call placeholder in copy is filled by copyValues", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const values = copyValues(locale);
    for (const template of strings(REFERRAL_COPY[locale])) {
      const left = fill(template, values).match(/\{(\w+)\}/g) ?? [];
      for (const token of left) {
        assert.ok(PER_CALL.has(token.slice(1, -1)), `${locale}: ${token} in "${template}"`);
      }
    }
  }
});

test("the long-stop close and delivery month are program.ts constants, written per locale in Korea Standard Time", () => {
  assert.equal(LONG_STOP_CLOSE, "2027-01-31T23:59:00+09:00");
  assert.equal(PRIZE_DELIVERY_BY, "2027-03");
  const expected: Record<string, [string, string]> = {
    en: ["31 January 2027, 23:59 Korea Standard Time", "March 2027"],
    ko: ["2027년 1월 31일 오후 11시 59분(한국 시간)", "2027년 3월"],
    "zh-CN": ["2027 年 1 月 31 日 23:59（韩国标准时间）", "2027 年 3 月"],
    "zh-TW": ["2027 年 1 月 31 日 23:59（韓國標準時間）", "2027 年 3 月"],
    ja: ["2027年1月31日 23:59（韓国標準時）", "2027年3月"],
    es: ["31 de enero de 2027, a las 23:59 (hora estándar de Corea)", "marzo de 2027"],
    fr: ["31 janvier 2027 à 23 h 59 (heure normale de Corée)", "mars 2027"],
    de: ["31. Januar 2027, 23:59 Uhr (koreanische Standardzeit)", "März 2027"],
    "pt-BR": ["31 de janeiro de 2027, às 23h59 (horário padrão da Coreia)", "março de 2027"],
  };
  for (const locale of SUPPORTED_LOCALES) {
    const values = copyValues(locale);
    // Tied to the constants, not to the literals above: the same functions
    // applied to program.ts give the values copy interpolates.
    assert.equal(values.longStop, formatKstDateTime(locale, LONG_STOP_CLOSE), locale);
    assert.equal(values.deliveryBy, formatKstMonth(locale, PRIZE_DELIVERY_BY), locale);
    assert.deepEqual([values.longStop, values.deliveryBy], expected[locale], locale);
  }
});

test("KST formatting follows the instant, not the server's time zone", () => {
  // 15:00 UTC is midnight in Seoul: the next calendar day there.
  assert.equal(
    formatKstDateTime("en", "2027-01-30T15:00:00Z"),
    "31 January 2027, 00:00 Korea Standard Time",
  );
  assert.equal(
    formatKstDateTime("ko", "2027-01-30T15:05:00Z"),
    "2027년 1월 31일 오전 12시 5분(한국 시간)",
  );
  assert.equal(
    formatKstDateTime("ko", "2027-01-31T03:00:00Z"),
    "2027년 1월 31일 오후 12시(한국 시간)",
  );
  assert.equal(
    formatKstDateTime("es", "2027-01-30T16:30:00Z"),
    "31 de enero de 2027, a la 1:30 (hora estándar de Corea)",
  );
  assert.equal(
    formatKstDateTime("pt-BR", "2027-01-30T16:30:00Z"),
    "31 de janeiro de 2027, à 1h30 (horário padrão da Coreia)",
  );
  assert.equal(
    formatKstDateTime("de", "2026-12-15T00:00:00Z"),
    "15. Dezember 2026, 9:00 Uhr (koreanische Standardzeit)",
  );
  assert.equal(formatKstMonth("fr", "2027-12"), "décembre 2027");
  assert.throws(() => formatKstDateTime("en", "not a date"));
  assert.throws(() => formatKstMonth("en", "2027-3"));
});
