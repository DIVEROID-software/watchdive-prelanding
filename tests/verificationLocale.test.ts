import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  referralPath,
  SUPPORTED_LOCALES,
  verifyPath,
  type Locale,
} from "../src/lib/i18n/locale.ts";
import { createResendMailer } from "../src/lib/verification/resend.ts";
import {
  createVerificationToken,
  parseVerificationToken,
  verificationUrl,
} from "../src/lib/verification/token.ts";
import {
  isVerificationTokenShape,
  verificationTokenLocale,
} from "../src/lib/verification/tokenShape.ts";
import { TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";

const EXPIRES_AT = Date.parse("2026-08-02T00:00:00.000Z");
const NOW = Date.parse("2026-08-01T00:00:00.000Z");
const ENV = {
  RESEND_API_KEY: "re_test_key",
  WATCHDIVE_EMAIL_FROM: "Watch Dive <hello@watchdive.example>",
  WATCHDIVE_EMAIL_REPLY_TO: "help@watchdive.example",
};

function leadId(index: number): string {
  return `aaaaaaaa-bbbb-4ccc-8ddd-${index.toString(16).padStart(12, "0")}`;
}

function acceptedFetch(calls: RequestInit[]): typeof fetch {
  return (async (_url: string | URL, init: RequestInit = {}) => {
    calls.push(init);
    return new Response(JSON.stringify({ id: `msg_${calls.length}` }), { status: 200 });
  }) as unknown as typeof fetch;
}

test("every supported locale round-trips through the signed v2 token and URL", () => {
  for (const [index, locale] of SUPPORTED_LOCALES.entries()) {
    const token = createVerificationToken(
      leadId(index + 1),
      EXPIRES_AT,
      false,
      TEST_SECRET,
      locale,
    );
    const parsed = parseVerificationToken(token, TEST_SECRET, NOW);
    const url = new URL(verificationUrl(TEST_ORIGIN, token));

    assert.equal(isVerificationTokenShape(token), true, locale);
    assert.equal(verificationTokenLocale(token), locale);
    assert.equal(parsed?.locale, locale);
    assert.equal(parsed?.measurementConsent, false);
    assert.equal(url.pathname, verifyPath(locale));
    assert.equal(url.search, "");
    assert.equal(url.hash, `#${token}`);
  }
});

test("legacy v1 links remain valid and deterministically use English", () => {
  const id = leadId(99);
  const expiresAtSeconds = Math.floor(EXPIRES_AT / 1000);
  const payload = `${id}.${expiresAtSeconds}.1`;
  const mac = createHmac("sha256", TEST_SECRET).update(`verify:v1:${payload}`).digest("base64url");
  const token = `${payload}.${mac}`;

  assert.equal(isVerificationTokenShape(token), true);
  assert.equal(verificationTokenLocale(token), "en");
  assert.deepEqual(parseVerificationToken(token, TEST_SECRET, NOW), {
    leadId: id,
    expiresAtMs: EXPIRES_AT,
    measurementConsent: true,
    locale: "en",
  });
  assert.equal(new URL(verificationUrl(TEST_ORIGIN, token)).pathname, "/verify");
});

test("the locale segment is authenticated and unsupported locale shapes fail closed", () => {
  const token = createVerificationToken(leadId(1), EXPIRES_AT, true, TEST_SECRET, "ko");
  const changed = token.split(".");
  changed[4] = "ja";

  assert.equal(parseVerificationToken(changed.join("."), TEST_SECRET, NOW), undefined);
  assert.equal(isVerificationTokenShape(token.replace(".ko.", ".ru.")), false);
  assert.equal(verificationTokenLocale(token.replace(".ko.", ".ru.")), undefined);
});

test("request validation uses the shared locale allowlist and defaults legacy clients", () => {
  const source = readFileSync(
    new URL("../src/lib/api/waitlist.functions.ts", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes('z.enum(SUPPORTED_LOCALES).default("en")'));
  assert.ok(source.includes("locale: data.locale"));
});

test("verification email copy and links are localized for every supported locale", async () => {
  const calls: RequestInit[] = [];
  const mailer = createResendMailer(ENV, acceptedFetch(calls), async () => {});

  for (const [index, locale] of SUPPORTED_LOCALES.entries()) {
    const id = leadId(index + 1);
    const token = createVerificationToken(id, EXPIRES_AT, true, TEST_SECRET, locale);
    await mailer.send({
      to: "diver@example.com",
      token,
      leadId: id,
      publicOrigin: TEST_ORIGIN,
      locale,
    });

    const payload = JSON.parse(String(calls.at(-1)?.body));
    const expectedUrl = `${TEST_ORIGIN}${verifyPath(locale)}#${token}`;
    assert.equal(typeof payload.subject, "string", locale);
    assert.ok(payload.subject.length > 8, locale);
    assert.ok(payload.html.includes(`lang="${locale}"`), locale);
    assert.ok(payload.html.includes(expectedUrl), locale);
    assert.ok(payload.text.includes(expectedUrl), locale);
    for (const claim of ["$149", "50%", "60 m", "$5"]) {
      assert.ok(
        !`${payload.subject}${payload.text}${payload.html}`.includes(claim),
        `${locale}: ${claim}`,
      );
    }
  }
});

test("a token/copy locale mismatch is rejected before any provider call", async () => {
  const calls: RequestInit[] = [];
  const id = leadId(1);
  const token = createVerificationToken(id, EXPIRES_AT, true, TEST_SECRET, "ko");
  const mailer = createResendMailer(ENV, acceptedFetch(calls), async () => {});

  await assert.rejects(() =>
    mailer.send({
      to: "diver@example.com",
      token,
      leadId: id,
      publicOrigin: TEST_ORIGIN,
      locale: "en",
    }),
  );
  assert.equal(calls.length, 0);
});

test("welcome email copy and referral links preserve the signed locale", async () => {
  const calls: RequestInit[] = [];
  const mailer = createResendMailer(ENV, acceptedFetch(calls), async () => {});

  for (const [index, locale] of SUPPORTED_LOCALES.entries()) {
    const id = leadId(index + 20);
    await mailer.sendWelcome({
      to: "diver@example.com",
      refCode: "abc12345",
      leadId: id,
      publicOrigin: TEST_ORIGIN,
      scheduledAt: "2026-08-02T00:00:00.000Z",
      locale,
    });

    const payload = JSON.parse(String(calls.at(-1)?.body));
    const expectedUrl = `${TEST_ORIGIN}${referralPath(locale, "abc12345")}`;
    assert.ok(payload.html.includes(`lang="${locale}"`), locale);
    assert.ok(payload.html.includes(expectedUrl), locale);
    assert.ok(payload.text.includes(expectedUrl), locale);
    assert.equal(payload.scheduled_at, "2026-08-02T00:00:00.000Z");
  }
});

test("locale type remains the exact nine-language contract", () => {
  const expected: readonly Locale[] = [
    "en",
    "ko",
    "zh-CN",
    "zh-TW",
    "ja",
    "es",
    "fr",
    "de",
    "pt-BR",
  ];
  assert.deepEqual(SUPPORTED_LOCALES, expected);
});
