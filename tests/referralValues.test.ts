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
  NICKNAME_MAX,
  NICKNAME_MIN,
  TOP_PRIZE_WINNERS,
} from "../src/lib/referral/program.ts";
import { copyValues, formatOfferPrice, tierValues } from "../src/lib/referral/values.ts";

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
