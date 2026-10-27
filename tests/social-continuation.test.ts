import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { onsiteReservation } from "../src/lib/reservation/onsite.ts";
import {
  SOCIAL_CONTINUATION_COOKIE,
  SOCIAL_CONTINUATION_EXCHANGE_LIMIT,
  SOCIAL_CONTINUATION_TTL_SECONDS,
  clearSocialContinuationCookie,
  exchangeSocialContinuation,
  issueSocialContinuationCookie,
  readSocialContinuation,
  resetSocialContinuationForTests,
} from "../src/lib/socialAuth/continuation.ts";
import { SOCIAL_ACK_COOKIE } from "../src/lib/socialAuthAcknowledgement.ts";
import { savePhoneOptInService } from "../src/lib/verification/phoneOptIn.ts";
import { parseVerificationToken } from "../src/lib/verification/token.ts";
import { FakeLeadStore, TEST_ENV, TEST_SECRET } from "./helpers/fakes.ts";

const SECRET = "social-auth-secret-must-be-32-bytes";
const NOW = new Date("2026-10-26T03:00:00.000Z");
const LEAD = "aaaaaaaa-bbbb-4ccc-8ddd-0000000000ab";
const RESERVE = {
  ...TEST_ENV,
  WATCHDIVE_RESERVATION_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_offline_only_fake_key",
  STRIPE_WEBHOOK_SECRET: "whsec_offline_fake",
  WATCHDIVE_RESERVATION_TOKEN_SECRET: "onsite-reservation-secret-test-32-bytes",
};

function cookieValue(header: string): string {
  return header.split(";")[0].slice(`${SOCIAL_CONTINUATION_COOKIE}=`.length);
}

function seed(overrides: Record<string, unknown> = {}) {
  const store = new FakeLeadStore();
  const row = store.seed({
    email: "diver@gmail.com",
    canonical: "diver@gmail.com",
    leadId: LEAD,
    status: "verified",
    emailVerified: true,
    verifiedAt: NOW.toISOString(),
    source: "offer",
    signupLocale: "ko",
    signupCountry: "SG",
    googleSubject: "google-sub",
    signupMethod: "google",
    ...overrides,
  });
  return { store, row };
}

function headerFor(grant = { leadId: LEAD, provider: "google" as const, sub: "google-sub" }, now = NOW) {
  const header = issueSocialContinuationCookie(grant, SECRET, now.getTime());
  assert.ok(header);
  return header;
}

test("continuation cookie is short-lived, HttpOnly, and carries no address", () => {
  const header = headerFor();
  assert.match(header, new RegExp(`^${SOCIAL_CONTINUATION_COOKIE}=`));
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
  assert.match(header, new RegExp(`Max-Age=${SOCIAL_CONTINUATION_TTL_SECONDS}`));
  assert.doesNotMatch(header, /Domain=/i);
  assert.equal(header.includes("@"), false);
  assert.equal(header.includes("diver@gmail.com"), false);
  assert.match(clearSocialContinuationCookie(), /Max-Age=0/);
  const read = readSocialContinuation(cookieValue(header), SECRET, NOW.getTime());
  assert.equal(read.ok, true);
});

test("missing, tampered, expired, and acknowledgement cookies grant nothing", () => {
  assert.equal(readSocialContinuation(undefined, SECRET, NOW.getTime()).ok, false);
  assert.equal(readSocialContinuation(undefined, SECRET, NOW.getTime()).reason, "missing");
  assert.equal(readSocialContinuation("1", SECRET, NOW.getTime()).reason, "tampered");
  const header = headerFor();
  const token = cookieValue(header);
  const flipped = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(readSocialContinuation(flipped, SECRET, NOW.getTime()).reason, "tampered");
  assert.equal(
    readSocialContinuation(token, SECRET, NOW.getTime() + (SOCIAL_CONTINUATION_TTL_SECONDS + 1) * 1000).reason,
    "expired",
  );
  assert.equal(readSocialContinuation(token, "other-social-secret-must-be-32-bytes", NOW.getTime()).reason, "tampered");
});

test("exchange ignores another email and keeps locale, source, and country", async () => {
  resetSocialContinuationForTests();
  for (const locale of SUPPORTED_LOCALES) {
    const { store, row } = seed({ signupLocale: locale, source: locale === "en" ? "hero" : "offer" });
    const header = headerFor();
    const other = `other-${locale}@example.com`;
    const result = await exchangeSocialContinuation({
      cookieHeader: `${cookieValue(header) ? `${SOCIAL_CONTINUATION_COOKIE}=${cookieValue(header)}` : ""}; ${SOCIAL_ACK_COOKIE}=1`,
      socialSecret: SECRET,
      verificationSecret: TEST_SECRET,
      now: NOW,
      store,
    });
    assert.equal(result.status, "ready", locale);
    if (result.status !== "ready") return;
    assert.equal(JSON.stringify(result).includes(other), false);
    assert.equal(JSON.stringify(result).includes(row.email), false);
    const parsed = parseVerificationToken(result.credential.value, TEST_SECRET, NOW.getTime());
    assert.equal(parsed?.leadId, row.leadId);
    assert.equal(parsed?.locale, locale);
    assert.equal(row.source, locale === "en" ? "hero" : "offer");
    assert.equal(row.signupCountry, "SG");
    assert.equal(row.signupLocale, locale);
    resetSocialContinuationForTests();
  }
});

test("late exchanges cannot extend the original grant expiry across process resets", async () => {
  const { store } = seed();
  const header = headerFor();
  const expiresAtMs = NOW.getTime() + SOCIAL_CONTINUATION_TTL_SECONDS * 1000;
  for (const elapsedMs of [0, 590_000, 599_000]) {
    resetSocialContinuationForTests(); // Simulates another server instance.
    const result = await exchangeSocialContinuation({
      cookieHeader: header, socialSecret: SECRET, verificationSecret: TEST_SECRET,
      now: new Date(NOW.getTime() + elapsedMs), store,
    });
    assert.equal(result.status, "ready");
    if (result.status !== "ready") return;
    const parsed = parseVerificationToken(result.credential.value, TEST_SECRET, NOW.getTime() + elapsedMs);
    assert.equal(parsed?.expiresAtMs, expiresAtMs);
    assert.equal(parseVerificationToken(result.credential.value, TEST_SECRET, expiresAtMs + 1), undefined);
  }
});

test("ack cookie alone, duplicate, unsubscribed, flagged, and a different subject are refused", async () => {
  resetSocialContinuationForTests();
  const { store } = seed();
  const header = headerFor();
  const ack = await exchangeSocialContinuation({
    cookieHeader: `${SOCIAL_ACK_COOKIE}=1`,
    socialSecret: SECRET,
    verificationSecret: TEST_SECRET,
    now: NOW,
    store,
  });
  assert.equal(ack.status, "unavailable");
  assert.equal(ack.reason, "missing");

  const cases: Array<[string, Record<string, unknown>]> = [
    ["duplicate", { duplicate: true }],
    ["unsubscribed", { status: "unsubscribed" }],
    ["flagged", { flags: ["headless"] }],
    ["other-subject", { googleSubject: "someone-else" }],
    ["pending", { status: "pending", emailVerified: false }],
  ];
  for (const [name, overrides] of cases) {
    resetSocialContinuationForTests();
    const fixture = seed(overrides);
    const result = await exchangeSocialContinuation({
      cookieHeader: header,
      socialSecret: SECRET,
      verificationSecret: TEST_SECRET,
      now: NOW,
      store: fixture.store,
    });
    assert.equal(result.status, "unavailable", name);
    assert.equal(result.reason, "unavailable", name);
    assert.equal(JSON.stringify(result).includes("diver@gmail.com"), false);
  }
});

test("a store failure can be retried and a later exchange stays on the same lead", async () => {
  resetSocialContinuationForTests();
  const { store, row } = seed();
  const header = headerFor();
  let failed = false;
  const original = store.findByLeadId.bind(store);
  store.findByLeadId = async (leadId) => {
    if (!failed) {
      failed = true;
      throw new Error("notion down");
    }
    return original(leadId);
  };
  const first = await exchangeSocialContinuation({
    cookieHeader: header,
    socialSecret: SECRET,
    verificationSecret: TEST_SECRET,
    now: NOW,
    store,
  });
  assert.equal(first.reason, "retry");
  const second = await exchangeSocialContinuation({
    cookieHeader: header,
    socialSecret: SECRET,
    verificationSecret: TEST_SECRET,
    now: NOW,
    store,
  });
  assert.equal(second.status, "ready");
  if (second.status !== "ready") return;
  const parsed = parseVerificationToken(second.credential.value, TEST_SECRET, NOW.getTime());
  assert.equal(parsed?.leadId, row.leadId);
});

test("replaying the continuation past the exchange limit is refused", async () => {
  resetSocialContinuationForTests();
  const { store } = seed();
  const header = headerFor();
  for (let attempt = 0; attempt < SOCIAL_CONTINUATION_EXCHANGE_LIMIT; attempt += 1) {
    const result = await exchangeSocialContinuation({
      cookieHeader: header,
      socialSecret: SECRET,
      verificationSecret: TEST_SECRET,
      now: NOW,
      store,
    });
    assert.equal(result.status, "ready", String(attempt));
  }
  const replay = await exchangeSocialContinuation({
    cookieHeader: header,
    socialSecret: SECRET,
    verificationSecret: TEST_SECRET,
    now: NOW,
    store,
  });
  assert.equal(replay.reason, "replay");
});

test("the issued confirmation credential saves a phone only with consent and opens reservation", async () => {
  resetSocialContinuationForTests();
  const { store, row } = seed({ signupLocale: "en" });
  const header = headerFor();
  const exchanged = await exchangeSocialContinuation({
    cookieHeader: header,
    socialSecret: SECRET,
    verificationSecret: TEST_SECRET,
    now: NOW,
    store,
  });
  assert.equal(exchanged.status, "ready");
  if (exchanged.status !== "ready") return;
  const denied = await savePhoneOptInService(
    { credential: exchanged.credential, phone: "+447700900123", country: "GB", consent: false, locale: "en" },
    { store, env: TEST_ENV, now: () => NOW, sleep: async () => {} },
  );
  assert.equal(denied.status, "invalid");
  assert.equal(row.phone, "");
  const saved = await savePhoneOptInService(
    { credential: exchanged.credential, phone: "+447700900123", country: "GB", consent: true, locale: "en" },
    { store, env: TEST_ENV, now: () => NOW, sleep: async () => {} },
  );
  assert.equal(saved.status, "saved");
  assert.equal((await store.reread(row.pageId))?.phone, "+447700900123");
  assert.match((await store.reread(row.pageId))?.smsConsent ?? "", /WD-SMS-CONSENT-V2/);
  const reserved = await onsiteReservation(
    { credential: exchanged.credential, locale: "de" as Locale },
    { store, env: RESERVE, now: () => NOW.getTime() },
  );
  assert.equal(reserved.status, "ready");
  if (reserved.status !== "ready") return;
  assert.ok(reserved.href.startsWith("/reservation?lang=en#invite="));
  const later = await savePhoneOptInService(
    { credential: exchanged.credential, phone: "+447700900123", country: "GB", consent: true, locale: "en" },
    { store, env: TEST_ENV, now: () => new Date(NOW.getTime() + (SOCIAL_CONTINUATION_TTL_SECONDS + 5) * 1000), sleep: async () => {} },
  );
  assert.equal(later.status, "expired");
});

test("social completion still records stage score and the page shares one continuation across both forms", () => {
  const complete = readFileSync(new URL("../src/lib/socialAuth/complete.ts", import.meta.url), "utf8");
  assert.ok(complete.includes("noteStageSignup"));
  assert.ok(complete.includes("WATCHDIVE_STAGE_SCORE_INTEGRATION"));
  const continuation = readFileSync(new URL("../src/lib/socialAuth/continuation.ts", import.meta.url), "utf8");
  assert.equal(continuation.includes(SOCIAL_ACK_COOKIE), false);
  assert.equal(continuation.includes("issueReservationInvite"), false);
  const entry = readFileSync(new URL("../src/components/social-auth-entry.tsx", import.meta.url), "utf8");
  const fetchAt = entry.indexOf('fetch("/api/auth/continuation"');
  const acknowledgedAt = entry.indexOf("if (acknowledged)");
  assert.ok(fetchAt > acknowledgedAt);
  assert.equal(entry.slice(fetchAt, fetchAt + 500).includes("hasSocialAcknowledgement"), false);
  const page = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const form = page.slice(page.indexOf("export function EmailForm("), page.indexOf("function HeroProof("));
  const social = form.slice(form.indexOf("if (socialCompleted || socialContinuation.credential)"), form.indexOf("if (closed)"));
  assert.ok(social.includes("<PhoneOptInCard"));
  assert.ok(social.includes("<SignupReservationOffer"));
  assert.ok(social.includes("verified"));
  assert.ok(social.includes("socialContinuation.credential"));
  assert.equal(social.includes("hasSocialAcknowledgement"), false);
  assert.equal(social.includes(SOCIAL_ACK_COOKIE), false);
  assert.ok(form.includes("useSocialContinuation()"));
  const segment = readFileSync(new URL("../src/components/segments/SegmentLanding.tsx", import.meta.url), "utf8");
  assert.equal(segment.split("<SocialSignupResultProvider ").length, 2);
  assert.equal(segment.split("</SocialSignupResultProvider>").length, 2);
  assert.ok(segment.includes("id={position === 'middle' ? 'hero' : 'offer'}"));
  const submit = form.slice(form.indexOf("const submit = async"), form.indexOf("async function allowMeasurementAfterSubmit"));
  assert.equal(/\bphone\s*:/.test(submit), false);
});
