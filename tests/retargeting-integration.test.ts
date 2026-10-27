// Callsite proof for the retargeting integration. Mocked sinks only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { markDeviceSignupStatus, readDeviceSignupStatus } from "../src/components/retargeting/device-status.ts";
import {
  recordAuthoritativeReservation,
  resetReservationMeasurementForTests,
} from "../src/components/reservation/measurement.ts";
import { parseReservationStatus } from "../src/components/reservation/contract.ts";
import { planPurchase } from "../src/lib/retargeting/events.ts";
import { retargetingConsentFromRow } from "../src/lib/retargeting/consent.ts";
import {
  parseBrowserRetargetingEvent,
  readRetargetingReceipt,
  retargetingReceiptSetCookie,
} from "../src/lib/retargeting/receipt.ts";
import { retargetingEventId } from "../src/lib/retargeting/eventId.ts";
import { MEASUREMENT_CONSENT_GRANTED } from "../src/lib/verification/contracts.ts";
import { fireRetargetingReceipt, resetSocialReceiptForTests } from "../src/lib/retargeting/socialClient.ts";

const SECRET = "test-verification-secret-at-least-32b";
const FRESH_EVENT_TIME = Math.floor(Date.now() / 1000);

function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("a receipt rejects an address and keeps only contract events", () => {
  const event = {
    eventName: "Purchase" as const,
    eventId: "a".repeat(64),
    eventTime: FRESH_EVENT_TIME,
    contentName: "watchdive_reservation_fee",
    value: 3,
    currency: "USD",
    signupLocale: "en" as const,
    source: null,
  };
  assert.ok(parseBrowserRetargetingEvent(event));
  assert.equal(parseBrowserRetargetingEvent({ ...event, eventId: "not-an-id" }), null);
  assert.equal(parseBrowserRetargetingEvent({ ...event, email: "a@b.co" }), null);
  const { eventTime: _dropped, ...withoutTime } = event;
  assert.equal(parseBrowserRetargetingEvent(withoutTime), null);
  const cookie = retargetingReceiptSetCookie([event]);
  assert.ok(cookie);
  assert.match(cookie, /Max-Age=600/);
  assert.equal(cookie.includes("@"), false);
  assert.equal(cookie.includes("cs_"), false);
  assert.deepEqual(readRetargetingReceipt(cookie.split(";")[0]), [event]);
  const tainted = Buffer.from(JSON.stringify({
    v: 1,
    events: [{ ...event, email: "a@b.co" }],
  }), "utf8").toString("base64url");
  assert.equal(readRetargetingReceipt(`wd_rt=${tainted}`), null);
});

test("the reservation recorder marks paid once and retries only after a real denial", () => {
  resetReservationMeasurementForTests();
  const store = memoryStore();
  const calls: string[] = [];
  const purchase = {
    eventName: "Purchase" as const,
    eventId: "b".repeat(64),
    eventTime: FRESH_EVENT_TIME,
    contentName: "watchdive_reservation_fee",
    value: 3,
    currency: "USD",
    signupLocale: null,
    source: null,
  };
  recordAuthoritativeReservation(
    { authoritativePaid: false, purchase },
    { store, sinks: { consentGranted: true, pixel: () => { calls.push("no"); return true; } } },
  );
  assert.equal(readDeviceSignupStatus(store).paid, false);
  assert.equal(calls.length, 0);

  recordAuthoritativeReservation(
    { authoritativePaid: true, purchase },
    { store, sinks: { consentGranted: false, pixel: () => { calls.push("denied"); return true; } } },
  );
  assert.equal(readDeviceSignupStatus(store).paid, true);
  assert.equal(calls.length, 0);

  recordAuthoritativeReservation(
    { authoritativePaid: true, purchase },
    { store, sinks: { consentGranted: true, pixel: () => { calls.push("once"); return true; }, purchase: () => ({ ads: false, ga4: false }) } },
  );
  recordAuthoritativeReservation(
    { authoritativePaid: true, purchase },
    { store, sinks: { consentGranted: true, pixel: () => { calls.push("again"); return true; } } },
  );
  assert.deepEqual(calls, ["once"]);
  markDeviceSignupStatus("verified", store);
  assert.equal(readDeviceSignupStatus(store).paid, true);
});

test("a refunded snapshot does not plan a purchase", () => {
  const consent = retargetingConsentFromRow({ measurementConsent: MEASUREMENT_CONSENT_GRANTED });
  const plan = planPurchase({
    evidence: "stripe_inspection",
    status: "refunded",
    paid: false,
    amountCents: 300,
    currency: "usd",
    refundedCents: 300,
    refundPendingCents: 0,
    disputed: false,
    sessionId: "cs_test_refunded",
    secret: SECRET,
    consent,
    verifiedLead: true,
    suspect: false,
    abusive: false,
    duplicatePerson: false,
    unsubscribed: false,
    paidAtSeconds: FRESH_EVENT_TIME,
    nowSeconds: FRESH_EVENT_TIME,
  });
  assert.equal(plan.emit, false);
  assert.equal(plan.reason, "refunded");
  const clean = retargetingEventId("purchase", "cs_test_paid", SECRET);
  assert.equal(clean?.length, 64);
});

test("the status parser drops a bad measurement object and still reads the fee", () => {
  const paid = parseReservationStatus({
    status: "paid",
    paid: true,
    source: "stripe",
    amountTotal: 300,
    currency: "usd",
    amountRefunded: 0,
    amountRefundPending: 0,
    measurement: { purchase: { eventName: "Purchase", eventId: "nope", email: "a@b.co" } },
  });
  assert.equal(paid?.authoritativePaid, true);
  assert.equal(paid?.purchase, null);
});

test("a social receipt fires each event once and waits when consent is denied", () => {
  resetSocialReceiptForTests();
  const lead = {
    eventName: "Lead" as const,
    eventId: "c".repeat(64),
    eventTime: FRESH_EVENT_TIME,
    contentName: "watchdive_durable_signup",
    value: 1,
    currency: "USD",
    signupLocale: "en" as const,
    source: "google" as const,
  };
  const cookie = retargetingReceiptSetCookie([lead]);
  assert.ok(cookie);
  const header = cookie.split(";")[0];
  const denied = fireRetargetingReceipt(header, { consentGranted: false, pixel: () => true });
  assert.equal(denied.waiting, true);
  assert.equal(denied.fired.length, 0);
  const calls: string[] = [];
  const granted = fireRetargetingReceipt(header, {
    consentGranted: true,
    pixel: (event) => {
      calls.push(event.eventId);
      return true;
    },
    signupConversion: () => {
      throw new Error("Lead must not send the verified-signup label");
    },
  });
  assert.equal(granted.waiting, false);
  assert.deepEqual(calls, [lead.eventId]);
  const again = fireRetargetingReceipt(header, {
    consentGranted: true,
    pixel: () => {
      calls.push("twice");
      return true;
    },
  });
  assert.equal(again.fired.length, 0);
  assert.deepEqual(calls, [lead.eventId]);
});

test("the live callsites start the durable path and stop the historical submit Lead", () => {
  const root = new URL("../src/", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");
  const index = read("routes/index.tsx");
  const service = read("lib/verification/service.ts");
  const page = read("components/reservation/ReservationPage.tsx");
  const verify = read("routes/verify.tsx");
  const complete = read("lib/socialAuth/complete.ts");
  const http = read("lib/socialAuth/http.ts");
  const webhook = read("lib/reservation/webhook.ts");
  const handlers = read("lib/reservation/handlers.ts");
  const deps = read("lib/verification/deps.server.ts");
  const tools = index.slice(index.indexOf("export function AcquisitionTools"), index.indexOf("function HeroProof"));
  assert.equal(tools.includes("useFrozenLandingMessages"), false);
  assert.match(tools, /cta: copy\.exitCta/);
  assert.equal(tools.includes("m.cta.label"), false);
  assert.equal(index.includes("trackMetaLead"), false);
  assert.equal(index.includes("trackGoogleSubmit"), true);
  assert.equal(index.includes("form_start"), true);
  assert.equal(index.includes("consumeSocialRetargetingReceipt()"), true);
  assert.equal(service.includes("emitDurableSignupLead"), true);
  assert.equal(service.includes("emitEmailRegistration"), true);
  const already = service.slice(
    service.indexOf("if (record.emailVerified || record.status === \"verified\")"),
    service.indexOf("const expiresAt = record.expiresAt"),
  );
  assert.equal(already.includes("emitEmailRegistration"), false);
  assert.equal(already.includes("planCompleteRegistration"), false);
  assert.equal(service.includes("dispatchSubmitLead("), false);
  assert.equal(page.includes("recordAuthoritativeReservation(result.status)"), true);
  assert.equal(verify.includes("trackRetargetingBrowser"), true);
  assert.equal(complete.includes("measureSocialSignup"), true);
  assert.equal(http.includes("retargetingReceiptSetCookie"), true);
  assert.equal(webhook.includes("onPaidSnapshot"), true);
  assert.equal(handlers.includes("deliverPaidSnapshot"), true);
  assert.equal(handlers.includes("purchaseProof"), true);
  assert.match(deps, /dispatchSubmitLead: async \(\) => false/);
  assert.equal(deps.includes("deliverRetargetingLead"), true);
  assert.equal(/import[\s\S]{0,200}deliverMetaLead/.test(deps), false);
});
