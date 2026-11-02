import assert from "node:assert/strict";
import test from "node:test";

import { signupCountryForNativeCreate } from "../src/lib/instantForm/nativeCountry.ts";
import { signupCountryProperties, toLeadRecord } from "../src/lib/verification/notionLead.ts";
import {
  FIELD_SIGNUP_COUNTRY,
  FIELD_SIGNUP_COUNTRY_OBSERVED,
  FIELD_SIGNUP_COUNTRY_SOURCE,
  SIGNUP_COUNTRY_SOURCE_NATIVE_FORM,
  SIGNUP_COUNTRY_SOURCE_VERCEL,
  type SignupCountryObservation,
} from "../src/lib/verification/contracts.ts";

const AT = new Date("2026-11-02T05:30:00.000Z");

function text(properties: Record<string, unknown>, field: string): string {
  const cell = properties[field] as { rich_text: { text: { content: string } }[] };
  return cell.rich_text[0].text.content;
}

test("each form market is stored, and the shared Traditional Chinese locale is not a country", () => {
  const hongKong = signupCountryForNativeCreate(undefined, "HK", AT);
  const taiwan = signupCountryForNativeCreate(undefined, "TW", AT);
  assert.equal(hongKong?.country, "HK");
  assert.equal(taiwan?.country, "TW");
  assert.equal(hongKong?.countrySource, SIGNUP_COUNTRY_SOURCE_NATIVE_FORM);
  assert.equal(taiwan?.countrySource, SIGNUP_COUNTRY_SOURCE_NATIVE_FORM);
  assert.equal(hongKong?.countryObservedAt, AT.toISOString());
  assert.equal(signupCountryForNativeCreate(undefined, "zh-TW", AT), undefined);
  assert.equal(signupCountryForNativeCreate(undefined, "ko", AT), undefined);
  assert.equal(signupCountryForNativeCreate(undefined, "gmail.com", AT), undefined);
});

test("a trusted Vercel observation is not replaced by the form market", () => {
  const probe: SignupCountryObservation = {
    country: "US",
    countrySource: SIGNUP_COUNTRY_SOURCE_VERCEL,
    countryObservedAt: AT.toISOString(),
  };
  const kept = signupCountryForNativeCreate(probe, "KR", AT);
  assert.equal(kept?.country, "US");
  assert.equal(kept?.countrySource, SIGNUP_COUNTRY_SOURCE_VERCEL);
});

test("the native observation writes the three country cells together", () => {
  const observation = signupCountryForNativeCreate(undefined, "JP", AT);
  const properties = signupCountryProperties(observation);
  assert.equal(text(properties, FIELD_SIGNUP_COUNTRY), "JP");
  assert.equal(text(properties, FIELD_SIGNUP_COUNTRY_SOURCE), SIGNUP_COUNTRY_SOURCE_NATIVE_FORM);
});

test("the current CRM reader keeps the form country and drops its source", () => {
  // readSignupCountryFields allows only the Vercel sensor and "unknown".
  // The email worker owns that reader. This locks the gap until that allowlist grows.
  const record = toLeadRecord({
    id: "page-native",
    properties: {
      Email: { title: [{ plain_text: "diver@example.com" }] },
      Source: { select: { name: "instant-form" } },
      [FIELD_SIGNUP_COUNTRY]: { rich_text: [{ plain_text: "TW" }] },
      [FIELD_SIGNUP_COUNTRY_SOURCE]: { rich_text: [{ plain_text: SIGNUP_COUNTRY_SOURCE_NATIVE_FORM }] },
      [FIELD_SIGNUP_COUNTRY_OBSERVED]: { date: { start: AT.toISOString() } },
    },
  });
  assert.equal(record?.signupCountry, "TW");
  assert.equal(record?.signupCountrySource, undefined);
  assert.equal(record?.signupCountryObservedAt, AT.toISOString());
});
