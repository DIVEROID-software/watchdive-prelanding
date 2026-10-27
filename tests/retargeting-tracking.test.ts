import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, test } from "node:test";

import { deliverRetargetingStandardEvent } from "../src/lib/api/metaCapi.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import {
  deliverRetargetingLead,
  deliverRetargetingPurchase,
  deliverRetargetingRegistration,
  planCompleteRegistration,
  planDurableLead,
  planPurchase,
} from "../src/lib/retargeting/server.ts";
import { EVENT_CONTRACT_MATRIX } from "../src/lib/retargeting/contract.ts";
import { buildRetargetingReadiness } from "../src/lib/retargeting/readiness.ts";
import { trackRetargetingBrowser as trackFromBrowserEntry } from "../src/lib/retargeting/browser.ts";
import { retargetingConsentFromRow, type RetargetingConsent } from "../src/lib/retargeting/consent.ts";
import {
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_LEAD_PENDING,
  MEASUREMENT_CONSENT_WITHDRAWN,
  MEASUREMENT_CONSENT_WITHHELD,
} from "../src/lib/verification/contracts.ts";
import { RETARGETING_CONTENT } from "../src/lib/retargeting/constants.ts";
import { retargetingExportSql } from "../src/lib/retargeting/exportSql.ts";

const SECRET = "test-secret-16ch";
const PAGE = "page-canonical-1";
const SESSION = "cs_test_canonical_session";
const EMAIL = "ada@example.com";

const granted: RetargetingConsent = { state: "granted", gpc: false, unsubscribed: false };

const META_ENV_KEYS = [
  "META_CAPI_ENABLED",
  "VITE_META_TRACKING_ENABLED",
  "META_PIXEL_ID",
  "VITE_META_PIXEL_ID",
  "META_CAPI_ACCESS_TOKEN",
  "META_CAPI_TEST_EVENT_CODE",
] as const;

const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(META_ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of META_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureMeta() {
  process.env.META_CAPI_ENABLED = "true";
  process.env.VITE_META_TRACKING_ENABLED = "true";
  process.env.META_PIXEL_ID = "1028181916616055";
  process.env.VITE_META_PIXEL_ID = "1028181916616055";
  process.env.META_CAPI_ACCESS_TOKEN = "test-token-not-for-logs";
  delete process.env.META_CAPI_TEST_EVENT_CODE;
}

function lead(over: Partial<Parameters<typeof planDurableLead>[0]> = {}) {
  return planDurableLead({
    rowCreated: true,
    resend: false,
    duplicate: false,
    abusive: false,
    suspect: false,
    unsubscribed: false,
    pageId: PAGE,
    secret: SECRET,
    consent: granted,
    source: "hero",
    signupLocale: "ko",
    ...over,
  });
}

test("durable Lead fires once per canonical row and refuses resend, repeat, and abuse", () => {
  const created = lead();
  const again = lead();
  assert.equal(created.emit, true);
  assert.equal(created.reason, "durable_signup");
  assert.equal(created.eventId, again.eventId);
  assert.equal(created.browser?.eventName, "Lead");
  assert.equal(created.browser?.contentName, RETARGETING_CONTENT.Lead);
  assert.equal(created.browser?.value, 1);
  assert.equal(created.browser?.currency, "USD");
  assert.equal(created.browser?.signupLocale, "ko");
  assert.equal(JSON.stringify(created.browser).includes(EMAIL), false);
  assert.equal(JSON.stringify(created).includes(SECRET), false);

  assert.equal(lead({ rowCreated: false, resend: true }).reason, "resend");
  assert.equal(lead({ rowCreated: false, resend: false }).reason, "not_durable");
  assert.equal(lead({ resend: true }).reason, "conflict");
  assert.equal(lead({ abusive: true }).reason, "abuse");
  assert.equal(lead({ suspect: true }).reason, "suspect");
  assert.equal(lead({ duplicate: true }).reason, "duplicate");
  assert.equal(lead({ unsubscribed: true }).reason, "unsubscribed");
  assert.equal(lead({ consent: { state: "withdrawn", gpc: false, unsubscribed: false } }).reason, "consent");
  assert.equal(lead({ consent: { state: "granted", gpc: true, unsubscribed: false } }).reason, "consent");
  assert.equal(lead({ consent: { state: "denied", gpc: false, unsubscribed: false } }).reason, "consent");
  assert.equal(lead({ consent: { state: "unknown", gpc: false, unsubscribed: false } }).reason, "consent");
  assert.equal(lead({ pageId: EMAIL }).reason, "event_id");
  assert.equal(lead({ secret: "short" }).reason, "event_id");
  assert.equal(lead({ source: EMAIL }).browser?.source, null);
});

test("CompleteRegistration accepts email and authoritative social, and rejects false verification", () => {
  const email = planCompleteRegistration({
    verified: true,
    source: "email_link",
    pageId: PAGE,
    secret: SECRET,
    consent: granted,
    duplicate: false,
    abusive: false,
    suspect: false,
    unsubscribed: false,
    signupLocale: "pt-BR",
  });
  const social = planCompleteRegistration({
    verified: true,
    source: "social_authoritative",
    pageId: PAGE,
    secret: SECRET,
    consent: granted,
    duplicate: false,
    abusive: false,
    suspect: false,
    unsubscribed: false,
  });
  const retry = planCompleteRegistration({
    verified: true,
    source: "deduped_retry",
    pageId: PAGE,
    secret: SECRET,
    consent: granted,
    duplicate: false,
    abusive: false,
    suspect: false,
    unsubscribed: false,
  });
  const origin = Math.floor(Date.now() / 1000) - 60;
  const freshRetry = planCompleteRegistration({
    verified: true,
    source: "deduped_retry",
    pageId: PAGE,
    secret: SECRET,
    consent: granted,
    duplicate: false,
    abusive: false,
    suspect: false,
    unsubscribed: false,
    occurredAtSeconds: origin,
    nowSeconds: origin + 30,
  });
  assert.equal(email.emit && social.emit && freshRetry.emit, true);
  assert.equal(retry.emit, false);
  assert.equal(retry.reason, "occurred_at");
  assert.equal(freshRetry.eventTime, origin);
  assert.equal(email.eventId, social.eventId);
  assert.equal(social.eventId, freshRetry.eventId);
  const lateRetry = planCompleteRegistration({
    verified: true,
    source: "deduped_retry",
    pageId: PAGE,
    secret: SECRET,
    consent: granted,
    duplicate: false,
    abusive: false,
    suspect: false,
    unsubscribed: false,
    occurredAtSeconds: origin - 48 * 3600 - 10,
    nowSeconds: origin,
  });
  assert.equal(lateRetry.reason, "stale");
  assert.equal(lateRetry.browser, null);
  assert.notEqual(email.eventId, lead().eventId);
  assert.equal(email.browser?.signupLocale, "pt-BR");
  assert.equal(email.browser?.eventName, "CompleteRegistration");

  for (const source of ["url", "success_screen", "notion_flag", "poll_unverified", "social_unverified"] as const) {
    const plan = planCompleteRegistration({
      verified: true,
      source,
      pageId: PAGE,
      secret: SECRET,
      consent: granted,
      duplicate: false,
      abusive: false,
      suspect: false,
      unsubscribed: false,
    });
    assert.equal(plan.emit, false, source);
    assert.equal(plan.reason, "not_true_verified");
  }
  assert.equal(
    planCompleteRegistration({
      verified: false,
      source: "email_link",
      pageId: PAGE,
      secret: SECRET,
      consent: granted,
      duplicate: false,
      abusive: false,
      suspect: false,
      unsubscribed: false,
    }).emit,
    false,
  );
});

test("Purchase requires a Stripe-inspected clean USD 3 and a stable session id", () => {
  const input = {
    evidence: "stripe_inspection" as const,
    status: "paid",
    paid: true,
    amountCents: 300,
    currency: "usd",
    refundedCents: 0,
    refundPendingCents: 0,
    disputed: false,
    sessionId: SESSION,
    secret: SECRET,
    consent: granted,
    verifiedLead: true,
    suspect: false,
    abusive: false,
    duplicatePerson: false,
    unsubscribed: false,
    duplicatePaid: true,
    signupLocale: "ja",
    paidAtSeconds: Math.floor(Date.now() / 1000) - 120,
    nowSeconds: Math.floor(Date.now() / 1000),
  };
  const first = planPurchase(input);
  const second = planPurchase({ ...input, nowSeconds: input.nowSeconds + 3600 });
  assert.equal(first.emit, true);
  assert.equal(first.reason, "stripe_usd3");
  assert.equal(first.eventId, second.eventId);
  assert.equal(first.eventTime, input.paidAtSeconds);
  assert.equal(second.eventTime, input.paidAtSeconds);
  assert.equal(first.browser?.eventTime, input.paidAtSeconds);
  assert.equal(first.browser?.value, 3);
  assert.equal(first.browser?.currency, "USD");
  assert.equal(JSON.stringify(first).includes(SESSION), false);
  assert.notEqual(first.eventId, planPurchase({ ...input, sessionId: "cs_test_other" }).eventId);

  assert.equal(planPurchase({ ...input, evidence: "notion_paid_flag" }).reason, "notion_paid_flag");
  assert.equal(planPurchase({ ...input, evidence: "success_url" }).reason, "success_url");
  assert.equal(planPurchase({ ...input, evidence: "none" }).reason, "none");
  assert.equal(planPurchase({ ...input, verifiedLead: false }).reason, "unverified_lead");
  assert.equal(planPurchase({ ...input, status: "refunded", paid: false, refundedCents: 300 }).reason, "refunded");
  assert.equal(planPurchase({ ...input, status: "partially_refunded", paid: false, refundedCents: 100 }).reason, "refunded");
  assert.equal(planPurchase({ ...input, status: "refund_pending", paid: false, refundPendingCents: 300 }).reason, "refund_pending");
  assert.equal(planPurchase({ ...input, status: "disputed", paid: false, disputed: true }).reason, "disputed");
  assert.equal(planPurchase({ ...input, amountCents: 14900 }).reason, "amount");
  assert.equal(planPurchase({ ...input, currency: "eur" }).reason, "amount");
  assert.equal(planPurchase({ ...input, status: "unpaid", paid: false }).reason, "unpaid");
  assert.equal(planPurchase({ ...input, consent: { state: "withheld", gpc: false, unsubscribed: false } }).reason, "consent");
  assert.equal(planPurchase({ ...input, paidAtSeconds: null }).reason, "paid_at");
  assert.equal(
    planPurchase({ ...input, paidAtSeconds: input.nowSeconds - 48 * 3600 - 5 }).reason,
    "stale",
  );
  assert.equal(planPurchase({ ...input, paidAtSeconds: input.nowSeconds + 301 }).reason, "future");
  assert.equal(
    planPurchase({ ...input, paidAtSeconds: input.nowSeconds + 301 }).browser,
    null,
  );
});

test("every signup locale is accepted and an unknown locale does not verify anyone", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const plan = lead({ signupLocale: locale });
    assert.equal(plan.browser?.signupLocale, locale);
    assert.equal(plan.emit, true);
  }
  assert.equal(lead({ signupLocale: "zh" }).browser?.signupLocale, null);
  assert.equal(lead({ signupLocale: "en-US" }).emit, true);
});

test("browser payload fires only with consent and never puts an address in the tag", () => {
  const plan = lead();
  const seen: Array<Record<string, unknown>> = [];
  const fired = trackFromBrowserEntry(plan.browser, {
    consentGranted: true,
    pixel: (event) => {
      seen.push({ ...event });
      return true;
    },
    signupConversion: () => false,
  });
  assert.equal(fired.pixel, true);
  assert.equal(fired.reason, "fired");
  assert.equal(JSON.stringify(seen).includes("@"), false);
  assert.equal(trackFromBrowserEntry(plan.browser, { consentGranted: false }).reason, "consent");
  const signupIds: string[] = [];
  const leadTracked = trackFromBrowserEntry(plan.browser, {
    consentGranted: true,
    pixel: () => true,
    signupConversion: (eventId) => {
      signupIds.push(eventId);
      return true;
    },
  });
  assert.equal(leadTracked.googleAds, false);
  assert.deepEqual(signupIds, []);
  const registration = planCompleteRegistration({
    verified: true,
    source: "email_link",
    pageId: PAGE,
    secret: SECRET,
    consent: granted,
    duplicate: false,
    abusive: false,
    suspect: false,
    unsubscribed: false,
  });
  const registered = trackFromBrowserEntry(registration.browser, {
    consentGranted: true,
    pixel: () => true,
    signupConversion: (eventId) => {
      signupIds.push(eventId);
      return true;
    },
  });
  assert.equal(registered.googleAds, true);
  assert.deepEqual(signupIds, [registration.eventId]);
  const staleBrowser = trackFromBrowserEntry(
    { ...registration.browser!, eventTime: Math.floor(Date.now() / 1000) - 48 * 3600 - 15 },
    {
      consentGranted: true,
      pixel: () => true,
      signupConversion: () => true,
    },
  );
  assert.equal(staleBrowser.reason, "stale");
  assert.equal(staleBrowser.googleAds, false);
  assert.equal(staleBrowser.pixel, false);
  assert.equal(trackFromBrowserEntry(null, { consentGranted: true }).reason, "no_payload");
  assert.equal(
    trackFromBrowserEntry(
      { ...plan.browser!, contentName: "watchdive_durable_signup", eventId: EMAIL.padEnd(64, "a") },
      { consentGranted: true, pixel: () => true },
    ).reason,
    "unsafe",
  );
});

test("CAPI sends one consented event and refuses opt-out, resend, and identifier leakage", async () => {
  configureMeta();
  const bodies: string[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init && typeof init === "object" && "body" in init ? init.body : ""));
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: "trace" }), { status: 200 });
  };

  const plan = lead({ signupLocale: "fr" });
  const sent = await deliverRetargetingLead({
    plan,
    consent: granted,
    email: EMAIL,
    landingPath: "/fr/scuba?token=secret-token&email=ada@example.com",
    fbp: "fb.1.1.1",
    fbc: EMAIL,
  });
  assert.equal(sent.delivery, "sent");
  assert.equal(bodies.length, 1);
  const body = bodies[0] ?? "";
  const parsed = JSON.parse(body) as { data: Array<Record<string, unknown>> };
  const event = parsed.data[0] ?? {};
  assert.equal(event.event_name, "Lead");
  assert.equal(event.event_id, plan.eventId);
  assert.equal(event.event_time, plan.eventTime);
  assert.equal(event.event_source_url, "https://watchdive.diveroid.com/");
  assert.equal(body.includes(EMAIL), false);
  assert.equal(body.includes(SECRET), false);
  assert.equal(body.includes("secret-token"), false);
  assert.equal(body.includes("test-token-not-for-logs"), false);
  const expectedHash = createHash("sha256").update(EMAIL).digest("hex");
  assert.equal(JSON.stringify((event.user_data as { em: string[] }).em), JSON.stringify([expectedHash]));
  assert.equal(JSON.stringify(event.user_data).includes("ph"), false);
  assert.equal((event.custom_data as { signup_locale?: string }).signup_locale, "fr");
  assert.equal((event.custom_data as { value: number }).value, 1);

  const registration = planCompleteRegistration({
    verified: true,
    source: "social_authoritative",
    pageId: PAGE,
    secret: SECRET,
    consent: granted,
    duplicate: false,
    abusive: false,
    suspect: false,
    unsubscribed: false,
  });
  const registered = await deliverRetargetingRegistration({
    plan: registration,
    consent: granted,
    email: EMAIL,
    landingPath: "/ja",
  });
  assert.equal(registered.delivery, "sent");
  const second = JSON.parse(bodies[1] ?? "{}") as {
    data: Array<{ event_name: string; event_id: string; event_source_url: string; event_time: number }>;
  };
  assert.equal(second.data[0]?.event_name, "CompleteRegistration");
  assert.equal(second.data[0]?.event_id, registration.eventId);
  assert.equal(second.data[0]?.event_time, registration.eventTime);
  assert.equal(second.data[0]?.event_source_url, "https://watchdive.diveroid.com/ja");

  const purchase = planPurchase({
    evidence: "stripe_inspection",
    status: "paid",
    paid: true,
    amountCents: 300,
    currency: "USD",
    refundedCents: 0,
    refundPendingCents: 0,
    disputed: false,
    sessionId: SESSION,
    secret: SECRET,
    consent: granted,
    verifiedLead: true,
    suspect: false,
    abusive: false,
    duplicatePerson: false,
    unsubscribed: false,
    paidAtSeconds: Math.floor(Date.now() / 1000) - 30,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  const bought = await deliverRetargetingPurchase({
    plan: purchase,
    consent: granted,
    email: EMAIL,
    nowSeconds: purchase.eventTime ?? undefined,
  });
  assert.equal(bought.delivery, "sent");
  const third = JSON.parse(bodies[2] ?? "{}") as {
    data: Array<{
      event_name: string;
      event_id: string;
      event_time: number;
      custom_data: { value: number; currency: string };
    }>;
  };
  assert.equal(third.data[0]?.event_name, "Purchase");
  assert.equal(third.data[0]?.event_id, purchase.eventId);
  assert.equal(third.data[0]?.event_time, purchase.eventTime);
  assert.equal(third.data[0]?.custom_data.value, 3);
  assert.equal(third.data[0]?.custom_data.currency, "USD");
  assert.equal(bodies[2]?.includes(SESSION), false);

  bodies.length = 0;
  const optedOut = await deliverRetargetingLead({
    plan,
    consent: { state: "withdrawn", gpc: false, unsubscribed: false },
    email: EMAIL,
  });
  assert.equal(optedOut.delivery, "refused");
  assert.equal(optedOut.reason, "consent");
  const resend = await deliverRetargetingLead({
    plan: lead({ rowCreated: false, resend: true }),
    consent: granted,
    email: EMAIL,
  });
  assert.equal(resend.delivery, "refused");
  assert.equal(resend.reason, "resend");
  const mismatched = await deliverRetargetingLead({ plan: purchase, consent: granted, email: EMAIL });
  assert.equal(mismatched.delivery, "refused");
  assert.equal(mismatched.reason, "event_name");
  assert.equal(bodies.length, 0);

  const direct = await deliverRetargetingStandardEvent({
    eventName: "Purchase",
    eventId: purchase.eventId!,
    email: EMAIL,
    consentGranted: false,
    contentName: RETARGETING_CONTENT.Purchase,
    value: 3,
    currency: "USD",
  });
  assert.equal(direct, "disabled");
  assert.equal(bodies.length, 0);
  const missingTime = await deliverRetargetingStandardEvent({
    eventName: "Purchase",
    eventId: purchase.eventId!,
    email: EMAIL,
    consentGranted: true,
    contentName: RETARGETING_CONTENT.Purchase,
    value: 3,
    currency: "USD",
  });
  assert.equal(missingTime, "disabled");
  assert.equal(bodies.length, 0);
  const stalePlan = planPurchase({
    ...purchaseInputFrom(purchase),
    paidAtSeconds: Math.floor(Date.now() / 1000) - 48 * 3600 - 20,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  assert.equal(stalePlan.reason, "stale");
  const staleDelivery = await deliverRetargetingPurchase({
    plan: stalePlan,
    consent: granted,
    email: EMAIL,
  });
  assert.equal(staleDelivery.delivery, "refused");
  assert.equal(bodies.length, 0);
});

function purchaseInputFrom(plan: { eventTime: number | null }) {
  return {
    evidence: "stripe_inspection" as const,
    status: "paid",
    paid: true,
    amountCents: 300,
    currency: "USD",
    refundedCents: 0,
    refundPendingCents: 0,
    disputed: false,
    sessionId: SESSION,
    secret: SECRET,
    consent: granted,
    verifiedLead: true,
    suspect: false,
    abusive: false,
    duplicatePerson: false,
    unsubscribed: false,
    paidAtSeconds: plan.eventTime,
    nowSeconds: plan.eventTime ?? 0,
  };
}

test("readiness stays disabled and does not echo ids, labels, or tokens", () => {
  process.env.META_CAPI_ACCESS_TOKEN = "super-secret-token";
  process.env.VITE_GOOGLE_ADS_ID = "AW-999000111";
  process.env.VITE_GOOGLE_ADS_SIGNUP_LABEL = "SignupLab1";
  const readiness = buildRetargetingReadiness({
    VITE_GOOGLE_ADS_ID: "AW-999000111",
    VITE_GOOGLE_ADS_CONVERSION_LABEL: "EmailLab1",
    VITE_GOOGLE_ADS_SIGNUP_LABEL: "SignupLab1",
    META_CAPI_ACCESS_TOKEN: "super-secret-token",
  });
  const encoded = JSON.stringify(readiness);
  assert.equal(readiness.readyForLive, false);
  assert.equal(readiness.deployed, false);
  assert.equal(readiness.integrationApplied, true);
  assert.equal(readiness.advertiserVerification, "requires_platform_readback");
  assert.equal(readiness.liveConversionClaimed, false);
  assert.equal(readiness.liveDeliveryClaimed, false);
  assert.equal(readiness.purchase.acceptsNotionPaidFlag, false);
  assert.equal(readiness.purchase.acceptsSuccessUrl, false);
  assert.equal(encoded.includes("AW-999000111"), false);
  assert.equal(encoded.includes("SignupLab1"), false);
  assert.equal(encoded.includes("EmailLab1"), false);
  assert.equal(encoded.includes("super-secret-token"), false);
  assert.equal(encoded.includes("AW-18370584790"), false);
  assert.equal(encoded.includes("l5I7CI"), false);
  assert.equal(encoded.includes("7Y_1CJ"), false);
  assert.equal(encoded.includes("not wired"), false);
  assert.equal(encoded.includes("test-token"), false);
  assert.equal(readiness.googleAds.globalIdConfigured, true);
  assert.equal(readiness.googleAds.signupLabelConfigured, true);
  assert.equal(readiness.googleAds.purchaseLabelConfigured, false);
  assert.equal(readiness.googleAds.confirmedEmailLabelConfigured, true);
  delete process.env.META_CAPI_ACCESS_TOKEN;
  delete process.env.VITE_GOOGLE_ADS_ID;
  delete process.env.VITE_GOOGLE_ADS_SIGNUP_LABEL;
});

test("the new score observer and historical pixel Lead stay untouched by this module", () => {
  const schema = readFileSync(new URL("../src/lib/stageScore/schema.sql", import.meta.url), "utf8");
  assert.match(schema, /target_score IN \(1, 3, 5, 10, 30\)/);
  const directory = new URL("../src/lib/retargeting/", import.meta.url);
  for (const name of readdirSync(directory)) {
    const source = readFileSync(new URL(name, directory), "utf8");
    assert.equal(source.includes("stageScore"), false, name);
  }
  const pixel = readFileSync(new URL("../src/lib/metaPixel.ts", import.meta.url), "utf8");
  const historical = pixel.slice(pixel.indexOf("export function trackMetaLead"), pixel.indexOf("export function trackMetaEmailVerified"));
  assert.match(historical, /watchdive_email_signup/);
  assert.match(historical, /META_LEAD_VALUE/);
  const google = readFileSync(new URL("../src/lib/googleTag.ts", import.meta.url), "utf8");
  assert.match(google, /event", "form_start"/);
  assert.match(google, /event", "signup_pending"/);
  assert.equal(google.includes('event", "sign_up"'), false);
  const sql = retargetingExportSql();
  assert.equal(/\bemail\b/i.test(sql), false);
  assert.match(sql, /DO NOT UPLOAD/);
  for (const locale of SUPPORTED_LOCALES) assert.match(sql, new RegExp(locale.replace("-", "\\-")));
});

test("the stored measurement cell is the only consent source for a new event", () => {
  assert.equal(
    retargetingConsentFromRow({ measurementConsent: MEASUREMENT_CONSENT_GRANTED }).state,
    "granted",
  );
  assert.equal(
    retargetingConsentFromRow({ measurementConsent: MEASUREMENT_CONSENT_LEAD_PENDING }).state,
    "pending",
  );
  assert.equal(
    retargetingConsentFromRow({ measurementConsent: MEASUREMENT_CONSENT_WITHHELD }).state,
    "withheld",
  );
  assert.equal(
    retargetingConsentFromRow({ measurementConsent: MEASUREMENT_CONSENT_WITHDRAWN }).state,
    "withdrawn",
  );
  assert.equal(retargetingConsentFromRow({ measurementConsent: "" }).state, "unknown");
  assert.equal(retargetingConsentFromRow({ measurementConsent: null }).state, "unknown");
  const gpc = retargetingConsentFromRow({
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
    gpc: true,
    unsubscribed: true,
  });
  assert.equal(gpc.gpc, true);
  assert.equal(gpc.unsubscribed, true);
});

test("the event contract keeps historical Lead inactive and names the fresh late grant", () => {
  const historical = EVENT_CONTRACT_MATRIX.find(
    (row) => row.event === "Lead" && row.phase === "historical",
  );
  assert.ok(historical);
  assert.equal(historical.wired, false);
  assert.match(historical.definition, /trackMetaLead and deliverMetaLead remain/);
  assert.match(historical.definition, /dispatchSubmitLead is installed as a stub/);
  assert.match(historical.firesFrom, /No active callsite/);
  assert.match(historical.doesNotFireFrom, /planDurableLead/);
  const registration = EVENT_CONTRACT_MATRIX.find((row) => row.event === "CompleteRegistration");
  assert.match(registration?.definition ?? "", /authenticated late Allow/);
  assert.match(registration?.dedup ?? "", /deduped_retry/);
  assert.match(registration?.firesFrom ?? "", /confirmation-token grant/);
  assert.match(registration?.doesNotFireFrom ?? "", /mere form submit/);
  const signup = EVENT_CONTRACT_MATRIX.find((row) => row.event === "conversion verified signup");
  assert.match(signup?.definition ?? "", /signup_pending/);
  assert.match(signup?.definition ?? "", /server sign_up/);
  assert.match(signup?.dedup ?? "", /late Allow reuses the original event id/);
  assert.match(signup?.doesNotFireFrom ?? "", /Allow with no fresh stored verification time/);
  const purchase = EVENT_CONTRACT_MATRIX.find((row) => row.event === "Purchase");
  assert.match(purchase?.dedup ?? "", /Browser and CAPI share that id/);
  assert.match(purchase?.firesFrom ?? "", /durable createMetaPurchases when enabled/);
  assert.match(purchase?.firesFrom ?? "", /legacy deliverPaidSnapshot/);
  assert.equal(
    EVENT_CONTRACT_MATRIX.find((row) => row.event === "audience B/C/D")?.wired,
    false,
  );
});
