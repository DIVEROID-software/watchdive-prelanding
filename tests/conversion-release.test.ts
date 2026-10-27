import assert from "node:assert/strict";
import { test } from "node:test";
import { createMetaPurchases } from "../src/lib/analytics/metaPurchases.server.ts";
import {
  createGoogleConversions,
  type Context,
  type ConversionStore,
} from "../src/lib/analytics/googleConversions.server.ts";
import {
  createReservationMeasurement,
  gaRefundEvent,
  selectPurchaseRefunds,
  type PurchaseRefund,
} from "../src/lib/reservation/measurement.server.ts";
import { succeededRefundRecords } from "../src/lib/reservation/state.ts";
import { trackRetargetingBrowser } from "../src/lib/retargeting/browser.ts";
import { planPurchase } from "../src/lib/retargeting/events.ts";
import { retargetingEventIsFresh } from "../src/lib/retargeting/freshness.ts";
import {
  parseBrowserRetargetingEvent,
  readRetargetingReceipt,
  retargetingReceiptSetCookie,
} from "../src/lib/retargeting/receipt.ts";
import { retargetingEventId } from "../src/lib/retargeting/eventId.ts";
import {
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_WITHDRAWN,
  type LeadRecord,
} from "../src/lib/verification/contracts.ts";
import type { ReservationSnapshot } from "../src/lib/reservation/state.ts";

const NOW = Date.parse("2026-10-26T10:00:00Z");
const PAID_AT = NOW / 1000 - 60;
const EMAIL = "Buyer@Example.test";
const SECRET = "fixture-verification-secret-with-more-than-32-chars";
const ENV = {
  WATCHDIVE_META_PURCHASE_ENABLED: "true",
  META_CAPI_ENABLED: "true",
  VITE_META_TRACKING_ENABLED: "true",
  META_PIXEL_ID: "1028181916616055",
  VITE_META_PIXEL_ID: "1028181916616055",
  META_CAPI_ACCESS_TOKEN: "fixture-only",
  WATCHDIVE_VERIFICATION_SECRET: SECRET,
  WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://store.example.test",
  WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "fixture-only",
  WATCHDIVE_GA4_CONVERSIONS_ENABLED: "true",
  VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
  VITE_GA_MEASUREMENT_ID: "G-TEST1234",
  GA4_API_SECRET: "fixture",
};

class Store implements ConversionStore {
  contexts = new Map<string, Context>();
  states = new Map<string, "accepted" | "uncertain">();
  failContext = false;
  async context(key: string) {
    if (this.failContext) throw new Error("store down");
    return this.contexts.get(key) ?? null;
  }
  async capture(key: string, context: Context) {
    this.contexts.set(key, context);
  }
  async forget(key: string) {
    this.contexts.delete(key);
  }
  async claim(key: string) {
    if (this.states.has(key)) return false;
    this.states.set(key, "uncertain");
    return true;
  }
  async status(key: string) {
    return this.states.get(key) ?? null;
  }
  async finish(key: string, status: "accepted" | "uncertain") {
    this.states.set(key, status);
  }
  async release(key: string) {
    this.states.delete(key);
  }
}

function paid(sessionId = "cs_test_paid"): ReservationSnapshot {
  return {
    status: "paid",
    paid: true,
    sessionId,
    amountTotal: 300,
    currency: "usd",
    amountRefunded: 0,
    amountRefundPending: 0,
    duplicatePaid: false,
    source: "stripe",
    leadId: null,
    url: null,
  };
}

function row(): LeadRecord {
  return {
    email: EMAIL,
    emailVerified: true,
    status: "verified",
    duplicate: false,
    flags: [],
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
  } as unknown as LeadRecord;
}

function sinks() {
  return {
    env: ENV,
    gaStore: new Store(),
    metaStore: new Store(),
    gaPayloads: [] as { client_id?: string; events: { name: string; params: Record<string, unknown> }[] }[],
    metaBodies: [] as { data: { event_name: string; event_id: string }[] }[],
    http: { gaStatus: 204, metaReceived: 1 },
  };
}

function measurementOf(
  lead: LeadRecord,
  options: ReturnType<typeof sinks> = sinks(),
) {
  const google = createGoogleConversions({
    env: options.env,
    store: options.gaStore,
    now: () => NOW,
    fetchImpl: async (_url, init) => {
      options.gaPayloads.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: options.http.gaStatus });
    },
  });
  const meta = createMetaPurchases({
    env: options.env,
    store: options.metaStore,
    now: () => NOW,
    fetchImpl: async (_url, init) => {
      options.metaBodies.push(JSON.parse(String(init?.body)));
      return Response.json({ events_received: options.http.metaReceived });
    },
  });
  return {
    ...options,
    google,
    meta,
    measurement: createReservationMeasurement(google, meta, async () => lead),
  };
}

function refund(partial: Partial<PurchaseRefund> = {}): PurchaseRefund {
  return {
    sessionId: "cs_test_paid",
    refundId: "re_full",
    amountCents: 300,
    currency: "usd",
    ...partial,
  };
}

function browserPurchase(metaDelivery?: "server") {
  const now = Math.floor(Date.now() / 1000) - 30;
  const plan = planPurchase({
    evidence: "stripe_inspection",
    status: "paid",
    paid: true,
    amountCents: 300,
    currency: "usd",
    refundedCents: 0,
    refundPendingCents: 0,
    disputed: false,
    sessionId: "cs_test_browser",
    secret: SECRET,
    consent: { state: "granted", gpc: false, unsubscribed: false },
    verifiedLead: true,
    suspect: false,
    abusive: false,
    duplicatePerson: false,
    unsubscribed: false,
    paidAtSeconds: now,
    nowSeconds: now,
  });
  assert.equal(plan.emit, true);
  assert.ok(plan.browser);
  const event = metaDelivery ? { ...plan.browser, metaDelivery } : plan.browser;
  return { event, eventId: plan.eventId };
}

test("succeeded refund records keep only positive succeeded re_ ids", () => {
  assert.deepEqual(
    succeededRefundRecords([
      { id: "re_ok", amount: 100, currency: "usd", status: "succeeded" },
      { id: "re_pending", amount: 200, currency: "usd", status: "pending" },
      { id: "re_action", amount: 50, currency: "usd", status: "requires_action" },
      { id: "re_failed", amount: 300, currency: "usd", status: "failed" },
      { id: "re_zero", amount: 0, currency: "usd", status: "succeeded" },
      { id: "ch_not_refund", amount: 300, currency: "usd", status: "succeeded" },
    ]),
    [{ id: "re_ok", amount: 100, currency: "usd" }],
  );
});

test("refund selection uses refund ids and refuses a cumulative or over-fee total", () => {
  const full = gaRefundEvent(refund());
  assert.equal(full?.name, "refund");
  assert.equal(full?.key, "re_full");
  assert.equal(full?.params.transaction_id, "cs_test_paid");
  assert.equal(full?.params.value, 3);
  assert.equal(JSON.stringify(full?.params).includes("re_full"), false);
  assert.equal(gaRefundEvent(refund({ amountCents: 100 }))?.params.value, 1);
  assert.equal(gaRefundEvent(refund({ currency: "eur" })), null);
  assert.equal(gaRefundEvent(refund({ amountCents: 301 })), null);
  assert.equal(gaRefundEvent(refund({ refundId: "ch_not" })), null);
  assert.deepEqual(
    selectPurchaseRefunds([
      refund({ refundId: "re_b", amountCents: 200 }),
      refund({ refundId: "re_a", amountCents: 100 }),
      refund({ refundId: "re_a", amountCents: 100 }),
    ]).map((item) => item.refundId),
    ["re_a", "re_b"],
  );
  assert.deepEqual(selectPurchaseRefunds([]), []);
  assert.deepEqual(
    selectPurchaseRefunds([
      refund({ refundId: "re_over_a", amountCents: 200 }),
      refund({ refundId: "re_over_b", amountCents: 200 }),
    ]),
    [],
  );
  assert.deepEqual(
    selectPurchaseRefunds([
      refund({ refundId: "re_conflict", amountCents: 100 }),
      refund({ refundId: "re_conflict", amountCents: 200 }),
    ]),
    [],
  );
});

test("durable Purchase suppresses the browser pixel and keeps the Google sink", () => {
  const legacy = browserPurchase();
  const owned = browserPurchase("server");
  assert.equal(legacy.eventId, owned.eventId);
  assert.equal(retargetingEventId("purchase", "cs_test_browser", SECRET), legacy.eventId);
  let pixels = 0;
  let google = 0;
  const pixel = () => {
    pixels += 1;
    return true;
  };
  const purchase = () => {
    google += 1;
    return { ads: true, ga4: false };
  };
  const fresh = trackRetargetingBrowser(legacy.event, { consentGranted: true, pixel, purchase });
  assert.equal(fresh.pixel, true);
  assert.equal(fresh.googleAds, true);
  assert.equal(pixels, 1);
  const serverOwned = trackRetargetingBrowser(owned.event, {
    consentGranted: true,
    pixel,
    purchase,
  });
  assert.equal(serverOwned.pixel, false);
  assert.equal(serverOwned.googleAds, true);
  assert.equal(serverOwned.ga4Purchase, false);
  assert.equal(pixels, 1);
  assert.equal(google, 2);
  const parsed = parseBrowserRetargetingEvent(owned.event);
  assert.equal(parsed?.metaDelivery, "server");
  assert.equal(parsed?.eventId, owned.eventId);
  const cookie = retargetingReceiptSetCookie([parsed!]);
  assert.ok(cookie);
  assert.equal(readRetargetingReceipt(cookie)?.[0]?.metaDelivery, "server");
  assert.equal(parseBrowserRetargetingEvent({ ...legacy.event, metaDelivery: "browser" }), null);
  assert.equal(
    parseBrowserRetargetingEvent({ ...legacy.event, metaDelivery: "server", eventName: "CompleteRegistration" }),
    null,
  );
  const refused = trackRetargetingBrowser(owned.event, { consentGranted: false, pixel, purchase });
  assert.equal(refused.reason, "consent");
  assert.equal(pixels, 1);
  const stale = trackRetargetingBrowser(
    { ...owned.event, eventTime: Math.floor(Date.now() / 1000) - 49 * 3600 },
    { consentGranted: true, pixel, purchase },
  );
  assert.equal(stale.reason, "stale");
  assert.equal(pixels, 1);
  const blocked = planPurchase({
    evidence: "stripe_inspection",
    status: "paid",
    paid: true,
    amountCents: 300,
    currency: "usd",
    refundedCents: 0,
    refundPendingCents: 0,
    disputed: false,
    sessionId: "cs_test_browser",
    secret: SECRET,
    consent: { state: "granted", gpc: true, unsubscribed: false },
    verifiedLead: true,
    suspect: false,
    abusive: false,
    duplicatePerson: false,
    unsubscribed: false,
    paidAtSeconds: Math.floor(Date.now() / 1000) - 30,
    nowSeconds: Math.floor(Date.now() / 1000) - 30,
  });
  assert.equal(blocked.reason, "consent");
  assert.equal(blocked.browser, null);
});

test("server Meta Purchase still accepts a 3-day-old charge inside 7 days", async () => {
  const store = new Store();
  const bodies: { data: { event_time: number }[] }[] = [];
  const meta = createMetaPurchases({
    env: ENV,
    store,
    now: () => NOW,
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ events_received: 1 });
    },
  });
  const late = NOW / 1000 - 3 * 86400;
  assert.equal(retargetingEventIsFresh(late, NOW / 1000), false);
  await meta.capture(EMAIL, true);
  assert.equal(await meta.send(EMAIL, "cs_test_late", late, async () => true), "accepted");
  assert.equal(bodies[0]?.data[0]?.event_time, late);
  assert.equal(await meta.send(EMAIL, "cs_test_late", late, async () => true), "duplicate");
  assert.equal(bodies.length, 1);
});

test("GA4 refund corrects an accepted purchase once per Stripe refund id", async () => {
  const lead = row();
  const h = measurementOf(lead);
  await h.measurement.capture(EMAIL, "123.456", true);
  assert.equal(await h.measurement.completed(EMAIL, paid(), PAID_AT), "accepted");
  assert.equal(h.gaPayloads[0]?.events[0]?.name, "purchase");
  assert.equal(h.metaBodies.length, 1);
  const refunded = { ...paid(), status: "refunded" as const, paid: false, amountRefunded: 300 };
  assert.equal(await h.measurement.completed(EMAIL, refunded, PAID_AT), "skipped");
  assert.equal(h.gaPayloads.length, 1);
  assert.equal(
    await h.measurement.completed(EMAIL, refunded, PAID_AT, [refund()]),
    "accepted",
  );
  assert.equal(h.gaPayloads.length, 2);
  assert.equal(h.gaPayloads[1]?.events[0]?.name, "refund");
  assert.equal(h.gaPayloads[1]?.events[0]?.params.transaction_id, "cs_test_paid");
  assert.equal(h.gaPayloads[1]?.events[0]?.params.value, 3);
  assert.equal(h.metaBodies.length, 1);
  assert.equal(
    await h.measurement.completed(EMAIL, refunded, PAID_AT, [refund()]),
    "duplicate",
  );
  assert.equal(h.gaPayloads.length, 2);

  const partial = measurementOf(row());
  await partial.measurement.capture(EMAIL, "123.456", true);
  await partial.measurement.completed(EMAIL, paid(), PAID_AT);
  const snapshot = {
    ...paid(),
    status: "partially_refunded" as const,
    paid: false,
    amountRefunded: 300,
  };
  assert.equal(
    await partial.measurement.completed(EMAIL, snapshot, PAID_AT, [
      refund({ refundId: "re_b", amountCents: 200 }),
      refund({ refundId: "re_a", amountCents: 100 }),
    ]),
    "accepted",
  );
  assert.deepEqual(
    partial.gaPayloads.slice(1).map((payload) => payload.events[0]?.params.value),
    [1, 2],
  );
  assert.equal(partial.metaBodies.length, 1);
  assert.equal(
    await partial.measurement.completed(EMAIL, snapshot, PAID_AT, [
      refund({ refundId: "re_a", amountCents: 100 }),
    ]),
    "duplicate",
  );
  assert.equal(partial.gaPayloads.length, 3);
});

test("duplicatePaid holds new purchases while an already accepted session can still be refunded", async () => {
  const h = measurementOf(row());
  await h.measurement.capture(EMAIL, "123.456", true);
  assert.equal(await h.measurement.completed(EMAIL, paid("cs_test_first"), PAID_AT), "accepted");
  const duplicated = { ...paid("cs_test_second"), duplicatePaid: true };
  assert.equal(await h.measurement.completed(EMAIL, duplicated, PAID_AT), "skipped");
  assert.equal(h.gaPayloads.length, 1);
  assert.equal(h.metaBodies.length, 1);
  assert.equal(
    await h.measurement.completed(EMAIL, { ...duplicated, status: "refunded", paid: false }, PAID_AT, [
      refund({ sessionId: "cs_test_second", refundId: "re_second" }),
      refund({ sessionId: "cs_test_first", refundId: "re_first" }),
    ]),
    "accepted",
  );
  assert.equal(h.gaPayloads.length, 2);
  assert.equal(h.gaPayloads[1]?.events[0]?.params.transaction_id, "cs_test_first");
  assert.equal(h.metaBodies.length, 1);
});

test("revocation, missing client id, GPC, and an uncertain purchase do not send a refund", async () => {
  const revoked = measurementOf(row());
  await revoked.measurement.capture(EMAIL, "123.456", true);
  await revoked.measurement.completed(EMAIL, paid(), PAID_AT);
  const withdrawn = row();
  withdrawn.measurementConsent = MEASUREMENT_CONSENT_WITHDRAWN;
  const after = measurementOf(withdrawn, revoked);
  assert.equal(
    await after.measurement.completed(EMAIL, { ...paid(), status: "refunded", paid: false }, PAID_AT, [
      refund(),
    ]),
    "skipped",
  );
  assert.equal(revoked.gaPayloads.length, 1);
  assert.equal(revoked.gaStore.contexts.size, 0);

  const missing = measurementOf(row());
  await missing.measurement.capture(EMAIL, "not-a-client", true);
  assert.equal(missing.gaStore.contexts.size, 0);
  assert.equal(await missing.measurement.completed(EMAIL, paid(), PAID_AT), "accepted");
  assert.equal(missing.gaPayloads.length, 0);
  assert.equal(missing.metaBodies.length, 1);
  assert.equal(
    await missing.measurement.completed(
      EMAIL,
      { ...paid(), status: "refunded", paid: false },
      PAID_AT,
      [refund()],
    ),
    "skipped",
  );
  assert.equal(missing.gaPayloads.length, 0);

  const gpc = measurementOf(row());
  await gpc.measurement.capture(EMAIL, "123.456", false);
  assert.equal(gpc.gaStore.contexts.size, 0);
  assert.equal(gpc.metaStore.contexts.size, 0);
  assert.equal(await gpc.measurement.completed(EMAIL, paid(), PAID_AT), "skipped");

  const uncertain = measurementOf(row());
  uncertain.http.gaStatus = 500;
  await uncertain.measurement.capture(EMAIL, "123.456", true);
  assert.equal(await uncertain.measurement.completed(EMAIL, paid(), PAID_AT), "uncertain");
  uncertain.http.gaStatus = 204;
  assert.equal(
    await uncertain.measurement.completed(
      EMAIL,
      { ...paid(), status: "refunded", paid: false },
      PAID_AT,
      [refund()],
    ),
    "uncertain",
  );
  assert.equal(uncertain.gaPayloads.length, 1);
  assert.equal(uncertain.gaPayloads[0]?.events[0]?.name, "purchase");
});

test("a store failure before the refund claim retries and a lost response stays quarantined", async () => {
  const h = measurementOf(row());
  await h.measurement.capture(EMAIL, "123.456", true);
  await h.measurement.completed(EMAIL, paid(), PAID_AT);
  h.gaStore.failContext = true;
  assert.equal(
    await h.measurement.completed(EMAIL, { ...paid(), status: "refunded", paid: false }, PAID_AT, [
      refund(),
    ]),
    "retry",
  );
  assert.equal(h.gaPayloads.length, 1);
  h.gaStore.failContext = false;
  assert.equal(
    await h.measurement.completed(EMAIL, { ...paid(), status: "refunded", paid: false }, PAID_AT, [
      refund(),
    ]),
    "accepted",
  );
  assert.equal(h.gaPayloads.length, 2);

  const lost = measurementOf(row());
  await lost.measurement.capture(EMAIL, "123.456", true);
  await lost.measurement.completed(EMAIL, paid(), PAID_AT);
  const originalClaim = lost.gaStore.claim.bind(lost.gaStore);
  lost.gaStore.claim = async (key) => {
    lost.gaStore.states.set(key, "uncertain");
    throw new Error("ack lost");
  };
  assert.equal(
    await lost.measurement.completed(EMAIL, { ...paid(), status: "refunded", paid: false }, PAID_AT, [
      refund({ refundId: "re_lost" }),
    ]),
    "uncertain",
  );
  assert.equal(lost.gaPayloads.length, 1);
  lost.gaStore.claim = originalClaim;
  assert.equal(
    await lost.measurement.completed(EMAIL, { ...paid(), status: "refunded", paid: false }, PAID_AT, [
      refund({ refundId: "re_lost" }),
    ]),
    "uncertain",
  );
  assert.equal(lost.gaPayloads.length, 1);
});
