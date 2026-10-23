import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { createResendMailer, verificationEmailUiCopy } from "../src/lib/verification/resend.ts";
import { createVerificationToken, verificationUrl } from "../src/lib/verification/token.ts";

// Captured from main 47da092, substituting only the signed URL. A redesign
// must preserve every byte of the transactional plain-text part in all locales.
const TEXT_HASH: Record<Locale, string> = {
  en: "b1ebc428add415d268f1c94ec0788c8eec9abe4e05cbba5d3cf2843f6ff162d6",
  ko: "bded06335aa7e6e94d3628f62d280303bde98fbd607b6c476f587a7fab4e25d3",
  "zh-CN": "c87f12520dcd74a02870f3fa3371a8168a098af0addaaf4a48e443c8cd7a18f1",
  "zh-TW": "3be1efc532f07165669832b8f09c1ac0f676ca9b11408ce41cbd9b16cb4af4c1",
  ja: "d60ef10e86476a17c59168a3abb2692f19dfe0d33c771c630276351f04e3908e",
  es: "7a9409c794a2b10bb36a78cce234587f200650f7bf2dbbed8159a90644b42f95",
  fr: "e236826c13ed1d7124068781e8377a72f20db0f1f5a19b098b75699a3d3f3cf2",
  de: "a292b9618ce8b40dfb938a68177457bfd8c0d6b47ef85d71190e61219562b430",
  "pt-BR": "8d70454f04b70417800cae7bb6101edb2ab7ba850f7a67c83ca6c811dbd9f065",
};
const NORMALIZED_URL = "https://watchdive.example/verify#QA_ONLY_NOT_A_LIVE_TOKEN";
const SECRET = "qa-only-verification-mail-secret-never-use-in-production";
const LEAD = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const ORIGIN = "https://watchdive.example";

function escaped(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

test("all nine verification mails preserve transactional copy and intact signed links in the Buddy design", async () => {
  for (const locale of SUPPORTED_LOCALES) {
    let payload: { subject: string; text: string; html: string } | undefined;
    let idempotencyKey: string | null = null;
    const token = createVerificationToken(LEAD, Date.parse("2030-01-01T00:00:00Z"), false, SECRET, locale);
    const url = verificationUrl(ORIGIN, token);
    const mailer = createResendMailer(
      { RESEND_API_KEY: "re_qa_only", WATCHDIVE_EMAIL_FROM: "hello@watchdive.example" },
      (async (_url, init) => {
        payload = JSON.parse(String(init?.body));
        idempotencyKey = new Headers(init?.headers).get("Idempotency-Key");
        return new Response('{"id":"qa_only"}', { status: 200 });
      }) as typeof fetch,
      async () => {},
    );
    await mailer.send({ to: "qa@example.com", token, leadId: LEAD, publicOrigin: ORIGIN, locale });
    assert.ok(payload, locale);
    const { html, text, subject } = payload;
    assert.equal(subject, verificationEmailUiCopy(locale).subject, locale);
    assert.equal(createHash("sha256").update(text.replace(url, NORMALIZED_URL)).digest("hex"), TEXT_HASH[locale], locale);
    assert.equal(idempotencyKey, `watchdive-verification-${LEAD}`, locale);
    for (const line of text.split("\n").filter(Boolean)) assert.ok(html.includes(escaped(line)), `${locale}: missing original sentence`);
    const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    assert.equal(anchors.length, 2, locale);
    assert.equal(anchors.filter(([, , label]) => label === escaped(verificationEmailUiCopy(locale).button)).length, 1, locale);
    for (const [, attrs] of anchors) assert.ok(attrs.includes(`href="${escaped(url)}"`), locale);
    assert.ok(html.includes(`<html lang="${locale}"`), locale);
    assert.match(html, /bgcolor="#36A9E1"/);
    assert.equal((html.match(/bgcolor="#ffe55c"/g) ?? []).length, 1, locale);
    assert.match(html, /border:3px solid #111111/);
    assert.match(html, /mso-padding-alt:18px 12px/);
    assert.match(html, /\[if mso\]/);
    assert.match(html, /prefers-color-scheme:dark/);
    assert.match(html, /-webkit-text-fill-color:#1a1238!important/);
    assert.match(html, /word-break:break-all;overflow-wrap:anywhere/);
    assert.match(html, /<img[^>]+width="150"[^>]+height="22"[^>]+alt="DIVEROID"/);
    assert.ok(html.includes(`${ORIGIN}/brand/reservation/diveroid-wordmark-color-transparent.png`), locale);
    assert.doesNotMatch(html, /border-radius|box-shadow|display:(?:flex|grid)|@font-face|<script|<form|hub\.diveroid\.ai/);
    assert.doesNotMatch(`${subject}\n${text}\n${html}`, /\(광고\)|Buddy Invite|unsubscribe|buddy-rules|\$149|50%/i);
    assert.ok([...html.matchAll(/<table\b([^>]*)>/g)].every(([, attrs]) => attrs.includes('role="presentation"')), locale);
  }
});
