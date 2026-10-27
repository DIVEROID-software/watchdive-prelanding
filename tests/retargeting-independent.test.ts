// Independent failure cases for retargeting measurement. The owner's suite is
// not the oracle. No live Meta, Google, Stripe, or Notion call is made.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseReservationStatus } from "../src/components/reservation/contract.ts";
import { recordAuthoritativeReservation, resetReservationMeasurementForTests } from "../src/components/reservation/measurement.ts";
import { trackGoogleDurableSignup, trackGoogleLead, trackGoogleReservationPurchase, readGoogleTagConfig } from "../src/lib/googleTag.ts";
import { aggregateInspections, type ReservationSnapshot } from "../src/lib/reservation/state.ts";
import type { StripeCheckoutSession } from "../src/lib/reservation/stripeApi.ts";
import { planMeasuredPurchase, measureSocialSignup } from "../src/lib/retargeting/apply.ts";
import { trackRetargetingBrowser } from "../src/lib/retargeting/browser.ts";
import { retargetingConsentFromRow } from "../src/lib/retargeting/consent.ts";
import { RETARGETING_FRESHNESS_SECONDS } from "../src/lib/retargeting/freshness.ts";
import { planCompleteRegistration, planDurableLead, planPurchase, safeLandingPath, type BrowserRetargetingEvent, type PurchasePlanInput, type RegistrationPlanInput } from "../src/lib/retargeting/events.ts";
import { parseBrowserRetargetingEvent } from "../src/lib/retargeting/receipt.ts";
import { MEASUREMENT_CONSENT_GRANTED, MEASUREMENT_CONSENT_WITHHELD, type LeadRecord } from "../src/lib/verification/contracts.ts";

const secret = "independent-qa-secret-value-32";
const now = Math.floor(Date.parse("2026-10-26T12:00:00.000Z") / 1000);
const granted = { state: "granted" as const, gpc: false, unsubscribed: false };
const pageId = "page-independent-qa";

function lead(overrides: Partial<Parameters<typeof planDurableLead>[0]> = {}) {
  return planDurableLead({
    rowCreated: true,
    resend: false,
    duplicate: false,
    abusive: false,
    suspect: false,
    unsubscribed: false,
    pageId,
    secret,
    consent: granted,
    source: "hero",
    signupLocale: "en",
    occurredAtSeconds: now,
    nowSeconds: now,
    ...overrides,
  });
}

function registration(overrides: Partial<RegistrationPlanInput> = {}) {
  return planCompleteRegistration({
    verified: true,
    source: "email_link",
    pageId,
    secret,
    consent: granted,
    duplicate: false,
    abusive: false,
    suspect: false,
    unsubscribed: false,
    signupLocale: "en",
    occurredAtSeconds: now,
    nowSeconds: now,
    ...overrides,
  });
}

function purchase(overrides: Partial<PurchasePlanInput> = {}) {
  return planPurchase({
    evidence: "stripe_inspection",
    status: "paid",
    paid: true,
    amountCents: 300,
    currency: "usd",
    refundedCents: 0,
    refundPendingCents: 0,
    disputed: false,
    sessionId: "cs_live_independentqa",
    secret,
    consent: granted,
    verifiedLead: true,
    suspect: false,
    abusive: false,
    duplicatePerson: false,
    unsubscribed: false,
    signupLocale: "en",
    paidAtSeconds: now,
    nowSeconds: now,
    ...overrides,
  });
}

function assertEmitted(plan: { emit: boolean; eventId: string | null; browser: BrowserRetargetingEvent | null }, name: string) {
  assert.equal(plan.emit, true);
  assert.ok(plan.eventId);
  assert.equal(plan.browser?.eventId, plan.eventId);
  assert.equal(plan.browser?.eventName, name);
  assert.match(plan.eventId ?? "", /^[a-f0-9]{64}$/);
  assert.equal(plan.eventId?.includes("@"), false);
  assert.equal(plan.eventId?.includes("cs_live"), false);
  assert.equal(plan.eventId?.includes("example.com"), false);
}

function snapshot(overrides: Partial<ReservationSnapshot>): ReservationSnapshot {
  return {
    status: "paid",
    paid: true,
    sessionId: "cs_live_independentqa",
    url: null,
    amountTotal: 300,
    currency: "usd",
    amountRefunded: 0,
    amountRefundPending: 0,
    duplicatePaid: false,
    leadId: null,
    source: "stripe",
    paidAtSeconds: now,
    ...overrides,
  };
}

const signup = {
  pageId,
  emailVerified: true,
  status: "verified",
  suspect: false,
  duplicate: false,
  abusive: false,
  unsubscribed: false,
  measurementConsent: MEASUREMENT_CONSENT_GRANTED,
  signupLocale: "en",
  source: "hero",
  landingPath: "/en",
  fbc: null,
};

function session(id: string, created: number): StripeCheckoutSession {
  return { id, created, amountTotal: 300, currency: "usd" } as StripeCheckoutSession;
}

test("standard Lead is only the new durable consented row", () => {
  const created = lead();
  assertEmitted(created, "Lead");
  assert.equal(created.browser?.value, 1);
  assert.equal(created.reason, "durable_signup");
  assert.equal(lead({ rowCreated: false }).reason, "not_durable");
  assert.equal(lead({ rowCreated: false, resend: true }).reason, "resend");
  assert.equal(lead({ rowCreated: true, resend: true }).reason, "conflict");
  assert.equal(lead({ duplicate: true }).reason, "duplicate");
  assert.equal(lead({ abusive: true }).reason, "abuse");
  assert.equal(lead({ suspect: true }).reason, "suspect");
  assert.equal(lead({ unsubscribed: true }).reason, "unsubscribed");
  assert.equal(lead({ consent: retargetingConsentFromRow({ measurementConsent: null, gpc: false }) }).reason, "consent");
  assert.equal(lead({ consent: retargetingConsentFromRow({ measurementConsent: MEASUREMENT_CONSENT_GRANTED, gpc: true }) }).reason, "consent");
  assert.equal(lead({ consent: retargetingConsentFromRow({ measurementConsent: MEASUREMENT_CONSENT_WITHHELD }) }).reason, "consent");
  assert.equal(lead({ occurredAtSeconds: now - RETARGETING_FRESHNESS_SECONDS - 1 }).reason, "stale");
  assert.equal(lead({ pageId: "person@example.com" }).reason, "event_id");
  assert.equal(lead({ secret: "short" }).reason, "event_id");
  assert.equal(safeLandingPath("/en?email=person@example.com"), null);
  assert.equal(safeLandingPath("/en"), "/en");
});

test("first verification emits CompleteRegistration and a repeat does not mint a new id", () => {
  const first = registration();
  const social = registration({ source: "social_authoritative" });
  assertEmitted(first, "CompleteRegistration");
  assertEmitted(social, "CompleteRegistration");
  assert.equal(first.eventId, social.eventId);
  assert.notEqual(first.eventId, lead().eventId);
  const retry = registration({ source: "deduped_retry", occurredAtSeconds: now });
  assert.equal(retry.emit, true);
  assert.equal(retry.eventId, first.eventId);
  assert.equal(retry.eventTime, now);
  assert.equal(
    planCompleteRegistration({
      verified: true,
      source: "deduped_retry",
      pageId,
      secret,
      consent: granted,
      duplicate: false,
      abusive: false,
      suspect: false,
      unsubscribed: false,
      nowSeconds: now,
    }).reason,
    "occurred_at",
  );
  assert.equal(registration({ source: "deduped_retry", occurredAtSeconds: now - RETARGETING_FRESHNESS_SECONDS - 5, nowSeconds: now }).reason, "stale");
  for (const source of ["url", "success_screen", "notion_flag", "poll_unverified", "social_unverified"] as const) {
    assert.equal(registration({ source }).reason, "not_true_verified", source);
  }
  assert.equal(registration({ verified: false }).reason, "not_true_verified");
});

test("social helper emits Lead only for the created row and registration only when verified now", async () => {
  const row = {
    pageId,
    email: "social@example.com",
    emailVerified: true,
    status: "verified",
    suspect: false,
    duplicate: false,
    flags: [],
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
    signupLocale: "en",
    source: "google",
    landingPath: "/en",
    metaFbc: null,
  } as unknown as LeadRecord;
  const input = { row, secret, gpc: false, nowSeconds: now };
  const createdOnly = await measureSocialSignup({ ...input, rowCreated: true, verifiedNow: false });
  assert.deepEqual(createdOnly.map((event) => event.eventName), ["Lead"]);
  const verifiedOnly = await measureSocialSignup({ ...input, rowCreated: false, verifiedNow: true });
  assert.deepEqual(verifiedOnly.map((event) => event.eventName), ["CompleteRegistration"]);
  const both = await measureSocialSignup({ ...input, rowCreated: true, verifiedNow: true });
  assert.deepEqual(both.map((event) => event.eventName), ["Lead", "CompleteRegistration"]);
  assert.notEqual(both[0]?.eventId, both[1]?.eventId);
  const blocked = await measureSocialSignup({ ...input, rowCreated: true, verifiedNow: true, gpc: true });
  assert.deepEqual(blocked, []);
  const unverified = await measureSocialSignup({
    ...input,
    row: { ...row, emailVerified: false, status: "pending" } as LeadRecord,
    rowCreated: false,
    verifiedNow: false,
  });
  assert.deepEqual(unverified, []);
});

test("purchase requires a fresh inspected 300-cent payment and ignores duplicatePaid by itself", () => {
  const clean = purchase();
  assertEmitted(clean, "Purchase");
  assert.equal(clean.browser?.value, 3);
  assert.equal(clean.browser?.currency, "USD");
  assert.equal(clean.eventTime, now);
  const replay = purchase({ nowSeconds: now + 3600 });
  assert.equal(replay.eventId, clean.eventId);
  assert.equal(replay.eventTime, now);
  assert.equal(purchase({ paidAtSeconds: now - RETARGETING_FRESHNESS_SECONDS - 1 }).reason, "stale");
  assert.equal(purchase({ evidence: "notion_paid_flag" }).reason, "notion_paid_flag");
  assert.equal(purchase({ evidence: "success_url" }).reason, "success_url");
  assert.equal(purchase({ evidence: "none" }).reason, "none");
  assert.equal(purchase({ status: "unpaid", paid: false }).reason, "unpaid");
  assert.equal(purchase({ status: "processing", paid: false }).reason, "unpaid");
  assert.equal(purchase({ paid: false }).reason, "unpaid");
  assert.equal(purchase({ refundedCents: 300, status: "refunded", paid: false }).reason, "refunded");
  assert.equal(purchase({ refundedCents: 1 }).reason, "refunded");
  assert.equal(purchase({ status: "partially_refunded", refundedCents: 50, paid: false }).reason, "refunded");
  assert.equal(purchase({ refundPendingCents: 300, status: "refund_pending" }).reason, "refund_pending");
  assert.equal(purchase({ disputed: true, status: "disputed", paid: false }).reason, "disputed");
  assert.equal(purchase({ amountCents: 14900 }).reason, "amount");
  assert.equal(purchase({ currency: "krw" }).reason, "amount");
  assert.equal(purchase({ sessionId: null }).reason, "session");
  assert.equal(purchase({ sessionId: "person@example.com" }).reason, "event_id");
  assert.equal(purchase({ paidAtSeconds: null }).reason, "paid_at");
  assert.equal(purchase({ verifiedLead: false }).reason, "unverified_lead");
  const duplicated = purchase({ duplicatePaid: true });
  const otherSession = purchase({ duplicatePaid: true, sessionId: "cs_live_secondfee" });
  assert.equal(duplicated.eventId, clean.eventId);
  assert.notEqual(otherSession.eventId, clean.eventId);
});

test("aggregate inspection keeps one session and refuses refund or dispute", () => {
  const two = aggregateInspections([
    { kind: "paid", session: session("cs_live_older", 10), chargeCreated: now, amountRefunded: 0, amountRefundPending: 0, refundState: "none", dispute: "none" },
    { kind: "paid", session: session("cs_live_newer", 20), chargeCreated: now, amountRefunded: 0, amountRefundPending: 0, refundState: "none", dispute: "none" },
  ]);
  assert.equal(two.status, "paid");
  assert.equal(two.duplicatePaid, true);
  assert.equal(two.sessionId, "cs_live_older");
  const planned = planMeasuredPurchase({ snapshot: two, signup, secret, gpc: false, nowSeconds: now });
  assert.equal(planned.plan.emit, true);
  assert.equal(planned.plan.eventId, purchase({ sessionId: "cs_live_older" }).eventId);
  const refunded = aggregateInspections([
    { kind: "paid", session: session("cs_live_back", 10), chargeCreated: now, amountRefunded: 300, amountRefundPending: 0, refundState: "full", dispute: "none" },
  ]);
  assert.equal(refunded.status, "refunded");
  assert.equal(planMeasuredPurchase({ snapshot: refunded, signup, secret, gpc: false, nowSeconds: now }).plan.emit, false);
  const disputed = aggregateInspections([
    { kind: "paid", session: session("cs_live_clean", 10), chargeCreated: now, amountRefunded: 0, amountRefundPending: 0, refundState: "none", dispute: "none" },
    { kind: "paid", session: session("cs_live_case", 11), chargeCreated: now, amountRefunded: 0, amountRefundPending: 0, refundState: "none", dispute: "open" },
  ]);
  assert.equal(disputed.status, "disputed");
  assert.equal(planMeasuredPurchase({ snapshot: disputed, signup, secret, gpc: false, nowSeconds: now }).plan.reason, "disputed");
  const old = planMeasuredPurchase({
    snapshot: snapshot({ paidAtSeconds: now - RETARGETING_FRESHNESS_SECONDS - 10 }),
    signup,
    secret,
    gpc: false,
    nowSeconds: now,
  });
  assert.equal(old.plan.reason, "stale");
  const gpc = planMeasuredPurchase({ snapshot: snapshot({}), signup, secret, gpc: true, nowSeconds: now });
  assert.equal(gpc.plan.reason, "consent");
});

test("browser purchase fires once per id and a refunded or stale payload does not", () => {
  resetReservationMeasurementForTests();
  const wall = Math.floor(Date.now() / 1000) - 30;
  const event = purchase({ paidAtSeconds: wall, nowSeconds: wall }).browser;
  assert.ok(event);
  let purchases = 0;
  let signups = 0;
  const sinks = {
    consentGranted: true,
    pixel: () => true,
    signupConversion: () => {
      signups += 1;
      return true;
    },
    purchase: () => {
      purchases += 1;
      return { ads: true, ga4: true };
    },
  };
  recordAuthoritativeReservation({ authoritativePaid: true, purchase: event }, { sinks });
  recordAuthoritativeReservation({ authoritativePaid: true, purchase: event }, { sinks });
  assert.equal(purchases, 1);
  assert.equal(signups, 0);
  const body = {
    status: "refunded",
    paid: false,
    source: "stripe",
    amountTotal: 300,
    currency: "usd",
    amountRefunded: 300,
    amountRefundPending: 0,
    measurement: { purchase: event },
  };
  const parsed = parseReservationStatus(body);
  assert.equal(parsed?.authoritativePaid, false);
  recordAuthoritativeReservation(
    { authoritativePaid: parsed?.authoritativePaid === true, purchase: parsed?.purchase },
    { sinks },
  );
  assert.equal(purchases, 1);
  assert.equal(parseReservationStatus({ status: "processing", paid: true, source: "stripe", amountTotal: 300, currency: "usd", amountRefunded: 0, amountRefundPending: 0 }), null);
  const stale = trackRetargetingBrowser(
    { ...event, eventTime: wall - RETARGETING_FRESHNESS_SECONDS - 5 },
    sinks,
  );
  assert.equal(stale.reason, "stale");
  assert.equal(purchases, 1);
  const leadEvent = lead({ occurredAtSeconds: wall, nowSeconds: wall }).browser;
  assert.ok(leadEvent);
  trackRetargetingBrowser(leadEvent, sinks);
  assert.equal(signups, 0);
  const registrationEvent = registration({ occurredAtSeconds: wall, nowSeconds: wall }).browser;
  assert.ok(registrationEvent);
  const registrationResult = trackRetargetingBrowser(registrationEvent, sinks);
  assert.equal(registrationResult.googleAds, true);
  assert.equal(signups, 1);
  assert.equal(purchases, 1);
  assert.equal(parseBrowserRetargetingEvent({ ...event, email: "person@example.com" }), null);
  assert.equal(trackRetargetingBrowser(registrationEvent, { ...sinks, consentGranted: false }).reason, "consent");
});

test("verified-signup and purchase labels stay off the raw Google lead call", () => {
  // Synthetic settings: a unit test must not depend on an operator's local
  // account export or imply that historical Ads labels are production settings.
  const ads = {
    tag: "AW-12345678901",
    signup: { label: "SignupTestLabel" },
    purchase: { label: "PurchaseTestLabel" },
  };
  const calls: unknown[][] = [];
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  const previousNavigator = globalThis.navigator;
  globalThis.localStorage = {
    getItem: (key: string) => (key === "watchdive.measurement-consent.v3" ? "granted" : null),
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { globalPrivacyControl: false },
  });
  globalThis.window = {
    localStorage: globalThis.localStorage,
    dataLayer: [],
    gtag: (...args: unknown[]) => {
      calls.push(args);
    },
    location: { pathname: "/en" },
  } as unknown as Window & typeof globalThis;
  try {
    const tag = readGoogleTagConfig({
      VITE_GOOGLE_ADS_ID: ads.tag,
      VITE_GOOGLE_ADS_CONVERSION_LABEL: "HistoricalEmailLabel",
      VITE_GOOGLE_ADS_SIGNUP_LABEL: ads.signup.label,
      VITE_GOOGLE_ADS_PURCHASE_LABEL: ads.purchase.label,
      VITE_GA_MEASUREMENT_ID: "G-INDEPENDENT01",
    });
    const eventId = purchase().eventId ?? "";
    trackGoogleLead(eventId, "hero", tag);
    assert.equal(trackGoogleDurableSignup(eventId, tag), true);
    const bought = trackGoogleReservationPurchase(eventId, tag);
    assert.deepEqual(bought, { ads: true, ga4: true });
    const sendTo = calls
      .filter((call) => call[1] === "conversion")
      .map((call) => (call[2] as { send_to?: string }).send_to);
    assert.deepEqual(sendTo, [
      `${ads.tag}/HistoricalEmailLabel`,
      `${ads.tag}/${ads.signup.label}`,
      `${ads.tag}/${ads.purchase.label}`,
    ]);
    assert.equal(sendTo.some((item) => item?.includes("person@")), false);
    const blank = readGoogleTagConfig({});
    assert.equal(blank.signupLabel, undefined);
    assert.equal(blank.purchaseLabel, undefined);
    assert.equal(trackGoogleDurableSignup(eventId, blank), false);
  } finally {
    globalThis.window = previousWindow;
    globalThis.localStorage = previousStorage;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator });
  }
});
