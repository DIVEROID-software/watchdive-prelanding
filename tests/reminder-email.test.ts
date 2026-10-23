import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import {
  buildReminderEmail,
  REMINDER_EMAIL_COPY,
  REMINDER_PHOTO_URL,
  REMINDER_WORDMARK_URL,
} from "../src/lib/verification/reminderEmail.ts";
import { createResendMailer } from "../src/lib/verification/resend.ts";
import { createVerificationToken, verificationUrl } from "../src/lib/verification/token.ts";

const SECRET = "test-verification-secret-at-least-32b";
const ORIGIN = "https://watchdive.example";
const LEAD = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const EXPIRES = Date.parse("2026-10-20T00:00:00.000Z");

const BANNED = [
  /\$\s*3\b/,
  /\$\d/,
  /\bprice\b/i,
  /\bdiscount\b/i,
  /\blast chance\b/i,
  /\blimited\b/i,
  /\bscarcity\b/i,
  /\bhurry\b/i,
  /\bonly today\b/i,
  /\bguaranteed safe\b/i,
  /\bsafe diving\b/i,
  /안전/,
  /서두르/,
  /마지막 기회/,
  /할인/,
  /가격/,
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tokenFor(locale: Locale): string {
  return createVerificationToken(LEAD, EXPIRES, false, SECRET, locale);
}

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing slice ${start}`);
  return source.slice(from, to);
}

test("every signup locale has reminder copy, plaintext, and one verify button", () => {
  assert.deepEqual(
    [...SUPPORTED_LOCALES],
    ["en", "ko", "zh-CN", "zh-TW", "ja", "es", "fr", "de", "pt-BR"],
  );
  for (const locale of SUPPORTED_LOCALES) {
    const url = verificationUrl(ORIGIN, tokenFor(locale));
    const copy = REMINDER_EMAIL_COPY[locale];
    const mail = buildReminderEmail(url, locale);
    assert.equal(mail.subject, copy.subject);
    assert.ok(mail.subject.length > 0);
    assert.match(mail.html, new RegExp(`<html lang="${locale}"`));
    assert.ok(mail.html.includes(`<title>${escapeHtml(copy.subject)}</title>`));
    assert.ok(mail.html.includes(escapeHtml(copy.headline).replaceAll("\n", "<br>")));
    assert.ok(mail.html.includes(escapeHtml(copy.received)));
    assert.ok(mail.html.includes(escapeHtml(copy.instruction)));
    assert.ok(mail.html.includes(escapeHtml(copy.button)));
    assert.ok(mail.html.includes(escapeHtml(copy.fallback)));
    assert.ok(mail.html.includes(escapeHtml(copy.once)));
    assert.ok(mail.html.includes(escapeHtml(copy.ignore)));
    assert.ok(mail.html.includes(escapeHtml(copy.preheader)));
    assert.match(mail.html, /display:none/);
    assert.match(mail.html, /mso-hide:all/);
    for (const line of [
      copy.headline,
      copy.received,
      copy.instruction,
      copy.button,
      copy.fallback,
      copy.once,
      copy.ignore,
    ]) {
      assert.ok(mail.text.includes(line), `${locale} plaintext missing a line`);
    }
    assert.equal(mail.text.split(url).length - 1, 2);
    const hrefs = [...mail.html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    assert.deepEqual(hrefs, [escapeHtml(url), escapeHtml(url)]);
    assert.equal(mail.html.split("background-color:#3D2683").length - 1, 1);
    assert.equal(mail.html.split("<a ").length - 1, 2);
    assert.match(mail.html, /padding:14px 28px/);
    assert.match(mail.html, /line-height:22px/);
    assert.match(mail.html, /font-weight:600/);
    const images = [...mail.html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
    assert.equal(images.length, 2);
    for (const image of images) {
      assert.match(image, /\balt="[^"]+"/);
      assert.match(image, /\bwidth="\d+"/);
    }
    assert.ok(mail.html.includes(`src="${REMINDER_WORDMARK_URL}"`));
    assert.ok(mail.html.includes(`src="${REMINDER_PHOTO_URL}"`));
    assert.ok(mail.html.includes('alt="DIVEROID"'));
    assert.ok(mail.html.includes(`alt="${escapeHtml(copy.imageAlt)}"`));
    const prose = `${mail.subject}\n${copy.preheader}\n${copy.headline}\n${copy.received}\n${copy.instruction}\n${copy.button}\n${copy.once}\n${copy.ignore}`;
    for (const pattern of BANNED) {
      assert.equal(pattern.test(prose), false, `${locale} matched ${pattern}`);
    }
    assert.equal(mail.html.includes("$3"), false);
    assert.equal(mail.text.includes(url), true);
    assert.equal(mail.html.includes("watchdive-verification"), false);
  }
});

test("a long dummy URL stays intact and is not wrapped in a second filled panel", () => {
  const fragment = `PLACEHOLDER_NOT_LIVE_${"a".repeat(360)}`;
  assert.ok(fragment.length >= 300 && fragment.length <= 500);
  const url = `https://watchdive.example/ko/verify#${fragment}`;
  const mail = buildReminderEmail(url, "ko");
  const escaped = escapeHtml(url);
  assert.equal(mail.html.split(`href="${escaped}"`).length - 1, 2);
  assert.equal(mail.text.split(url).length - 1, 2);
  assert.equal(mail.html.includes("background-color:#EEF9FF;border-radius:10px"), false);
  assert.ok(mail.html.includes("font-size:12px"));
  assert.ok(mail.html.includes(escapeHtml(REMINDER_EMAIL_COPY.ko.fallback)));
});

test("the href is the escaped verification URL and the token is unchanged", () => {
  const token = tokenFor("ko");
  const url = verificationUrl(ORIGIN, token);
  const hostile = `${url}&"<script>alert(1)</script>`;
  const mail = buildReminderEmail(hostile, "ko");
  const escaped = escapeHtml(hostile);
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(!mail.html.includes(`href="${hostile}"`));
  assert.equal(mail.html.split(`href="${escaped}"`).length - 1, 2);
  assert.ok(mail.html.includes(escapeHtml(token)));
  assert.ok(mail.text.includes(hostile));
  assert.ok(mail.text.includes(token));
  assert.equal(mail.text.includes("&amp;"), false);
  assert.equal(mail.text.includes("&lt;"), false);
});

test("reminder=true selects the reminder template and keeps the idempotency key and tag path", async () => {
  const seen: {
    key: string;
    body: { subject: string; html: string; text: string; to: string[] };
  }[] = [];
  const impl = (async (_url: string | URL, init: RequestInit = {}) => {
    const headers = init.headers as Record<string, string>;
    seen.push({
      key: headers["Idempotency-Key"],
      body: JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
  }) as unknown as typeof fetch;
  const resend = createResendMailer(
    { RESEND_API_KEY: "re_test_key", WATCHDIVE_EMAIL_FROM: "hello@watchdive.example" },
    impl,
    async () => {},
  );
  const token = tokenFor("en");
  const mail = {
    to: "diver@example.com",
    token,
    leadId: LEAD,
    publicOrigin: ORIGIN,
    locale: "en" as const,
  };
  await resend.send(mail);
  await resend.send({ ...mail, reminder: false });
  await resend.send({ ...mail, reminder: true });

  assert.deepEqual(
    seen.map((entry) => entry.key),
    [
      `watchdive-verification-${LEAD}`,
      `watchdive-verification-${LEAD}`,
      `watchdive-verification-reminder-${LEAD}`,
    ],
  );
  const expected = buildReminderEmail(verificationUrl(ORIGIN, token), "en");
  assert.equal(seen[0].body.subject, "Confirm your WatchDive waitlist email");
  assert.equal(seen[1].body.subject, "Confirm your WatchDive waitlist email");
  assert.match(seen[0].body.html, /bgcolor="#36A9E1"/);
  assert.match(seen[1].body.html, /bgcolor="#36A9E1"/);
  assert.equal(seen[0].body.html.includes("watchdive-underwater"), false);
  assert.equal(seen[1].body.html.includes("watchdive-underwater"), false);
  assert.equal(seen[0].body.html, seen[1].body.html);
  assert.equal(seen[0].body.text, seen[1].body.text);
  assert.equal(seen[2].body.subject, expected.subject);
  assert.equal(seen[2].body.html, expected.html);
  assert.equal(seen[2].body.text, expected.text);
  assert.equal(seen[2].body.html.includes("background:#0ea5e9"), false);
  assert.deepEqual(seen[2].body.to, ["diver@example.com"]);
  assert.equal(JSON.stringify(seen).includes("re_test_key"), false);
});

// 2026-10-19: Korean welcome subject and heading now say launch notification signup complete.
test("reviewed copy, welcome markup and reminder routing in resend.ts stay fixed", () => {
  const copyPath = fileURLToPath(new URL("../src/lib/verification/resend.ts", import.meta.url));
  const copy = readFileSync(copyPath, "utf8");
  // Frozen from reviewed baseline faa9dd2; no sibling checkout required in CI.
  assert.equal(
    createHash("sha256")
      .update(
        sliceBetween(
          copy,
          "const EMAIL_COPY = {",
          "} as const satisfies Record<Locale, EmailCopy>;",
        ),
      )
      .digest("hex"),
    "a68c60a7c570a10b367e9faa4d991228e738b84b3665e1789ee7a5fe19150c53",
  );
  // The owner-authorized first-confirmation redesign is covered by
  // verificationMailPresentation.test.ts; its copy remains frozen above.
  assert.equal(
    createHash("sha256")
      .update(sliceBetween(copy, "function welcomeBody(", "/**\n * One accepted send"))
      .digest("hex"),
    "a47de982877491f18257b81e6f2c01743907483f72a0657565921ed2f4fcfb15",
  );
  assert.match(
    copy,
    /reminder \? buildReminderEmail\(url, signedLocale\) : body\(url, signedLocale\)/,
  );
  assert.match(
    copy,
    /reminder\s*\?\s*`watchdive-verification-reminder-\$\{leadId\}`\s*:\s*`watchdive-verification-\$\{leadId\}`/,
  );
  assert.match(copy, /reminder \? "verification_reminder" : "verification"/);
  assert.equal(copy.includes("console.log"), false);
  const reminderSource = readFileSync(
    fileURLToPath(new URL("../src/lib/verification/reminderEmail.ts", import.meta.url)),
    "utf8",
  );
  assert.equal(reminderSource.includes("console."), false);
  assert.equal(/to:\s*\[/.test(reminderSource), false);
});

test("a locale that does not match the signed token is still rejected", async () => {
  const resend = createResendMailer(
    { RESEND_API_KEY: "re_test_key", WATCHDIVE_EMAIL_FROM: "hello@watchdive.example" },
    (async () =>
      new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })) as unknown as typeof fetch,
    async () => {},
  );
  await assert.rejects(
    () =>
      resend.send({
        to: "diver@example.com",
        token: tokenFor("ko"),
        leadId: LEAD,
        publicOrigin: ORIGIN,
        locale: "en",
        reminder: true,
      }),
    /Verification token locale mismatch/,
  );
});
