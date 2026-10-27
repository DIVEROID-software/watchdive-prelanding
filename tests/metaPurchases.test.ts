import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMetaPurchases } from "../src/lib/analytics/metaPurchases.server.ts";
import { retargetingEventId } from "../src/lib/retargeting/eventId.ts";
import {
  createGoogleConversions,
  type Context,
  type ConversionStore,
} from "../src/lib/analytics/googleConversions.server.ts";
import {
  createReservationMeasurement,
  purchaseEvent,
} from "../src/lib/reservation/measurement.server.ts";
import {
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_WITHDRAWN,
  type LeadRecord,
} from "../src/lib/verification/contracts.ts";
import type { ReservationSnapshot } from "../src/lib/reservation/state.ts";

const NOW = Date.parse("2026-10-26T10:00:00Z");
const PAID_AT = NOW / 1000 - 60;
const EMAIL = "Buyer@Example.test";
const ENV = {
  WATCHDIVE_META_PURCHASE_ENABLED: "true",
  META_CAPI_ENABLED: "true",
  VITE_META_TRACKING_ENABLED: "true",
  META_PIXEL_ID: "1028181916616055",
  VITE_META_PIXEL_ID: "1028181916616055",
  META_CAPI_ACCESS_TOKEN: "fixture-only",
  WATCHDIVE_VERIFICATION_SECRET: "fixture-verification-secret-with-more-than-32-chars",
  WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://store.example.test",
  WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "fixture-only",
};
class Store implements ConversionStore {
  contexts = new Map<string, Context>();
  states = new Map<string, "accepted" | "uncertain">();
  async context(key: string) {
    return this.contexts.get(key) ?? null;
  }
  async capture(key: string, context: Context) {
    if (!this.contexts.has(key)) this.contexts.set(key, context);
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
function harness(
  options: { env?: Record<string, string>; response?: () => Promise<Response> } = {},
) {
  const store = new Store();
  const bodies: {
    data: {
      event_name: string;
      event_id: string;
      event_time: number;
      event_source_url: string;
      custom_data: { value: number; currency: string; order_id: string };
      user_data: unknown;
    }[];
  }[] = [];
  const meta = createMetaPurchases({
    env: options.env ?? ENV,
    store,
    now: () => NOW,
    fetchImpl: async (url, init) => {
      assert.match(String(url), /^https:\/\/graph.facebook.com\/v21.0\/1028181916616055\/events$/);
      bodies.push(JSON.parse(String(init?.body)));
      return options.response ? options.response() : Response.json({ events_received: 1 });
    },
  });
  return { meta, store, bodies };
}
const paid: ReservationSnapshot = {
  status: "paid",
  paid: true,
  sessionId: "cs_test_paid",
  amountTotal: 300,
  currency: "usd",
  amountRefunded: 0,
  amountRefundPending: 0,
  duplicatePaid: false,
  source: "stripe",
  leadId: null,
  url: null,
};
test("Meta Purchase reuses CAPI without GA credentials or cookie, with hashed identity and exact USD 3", async () => {
  const h = harness();
  assert.equal(h.meta.enabled, true);
  await h.meta.capture(EMAIL, true);
  assert.equal(await h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true), "accepted");
  const event = h.bodies[0].data[0];
  assert.equal(event.event_name, "Purchase");
  assert.equal(
    event.event_id,
    retargetingEventId("purchase", paid.sessionId!, ENV.WATCHDIVE_VERIFICATION_SECRET),
  );
  assert.equal(event.event_id.includes(paid.sessionId!), false);
  assert.equal(event.event_time, PAID_AT);
  assert.equal(event.event_source_url, "https://watchdive.diveroid.com/reservation");
  assert.equal(event.custom_data.value, 3);
  assert.equal(event.custom_data.currency, "USD");
  assert.equal(event.custom_data.order_id, paid.sessionId);
  assert.deepEqual(event.user_data, {
    em: [createHash("sha256").update(EMAIL.toLowerCase()).digest("hex")],
  });
  assert.ok(!JSON.stringify([...h.store.contexts]).includes(EMAIL));
  assert.ok(!JSON.stringify(h.bodies).includes(EMAIL));
  assert.deepEqual([...h.store.contexts.values()], [{ capturedAt: NOW }]);
});
test("explicit flag, existing CAPI authorization and durable storage are all required", async () => {
  for (const env of [
    { ...ENV, WATCHDIVE_META_PURCHASE_ENABLED: "false" },
    { ...ENV, META_CAPI_ACCESS_TOKEN: "" },
    { ...ENV, VITE_META_PIXEL_ID: "9999999999999" },
    { ...ENV, WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "" },
  ]) {
    const h = harness({ env });
    assert.equal(h.meta.enabled, false);
    await h.meta.capture(EMAIL, true);
    assert.equal(await h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true), "disabled");
    assert.equal(h.bodies.length, 0);
    assert.equal(h.store.contexts.size, 0);
  }
});
test("duplicate and concurrent webhook delivery cannot resend accepted Purchase", async () => {
  const h = harness();
  await h.meta.capture(EMAIL, true);
  await Promise.all(
    Array.from({ length: 4 }, () => h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true)),
  );
  assert.equal(h.bodies.length, 1);
  assert.equal(await h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true), "duplicate");
});
test("explicit zero-received receipt retries, but uncertain responses stay quarantined and visible", async () => {
  let responses = 0;
  const h = harness({
    response: async () => Response.json({ events_received: ++responses === 1 ? 0 : 1 }),
  });
  await h.meta.capture(EMAIL, true);
  assert.equal(await h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true), "retry");
  assert.equal(await h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true), "accepted");
  assert.equal(h.bodies.length, 2);
  const unknown = harness({
    response: async () => {
      throw new Error("connection lost");
    },
  });
  await unknown.meta.capture(EMAIL, true);
  assert.equal(
    await unknown.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true),
    "uncertain",
  );
  assert.equal(
    await unknown.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true),
    "uncertain",
  );
  assert.equal(unknown.bodies.length, 1);
});
test("withdrawal, refusal during claim and missing or stale Stripe timestamp send nothing", async () => {
  const h = harness();
  await h.meta.capture(EMAIL, true);
  let reads = 0;
  assert.equal(
    await h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => ++reads === 1),
    "skipped",
  );
  assert.equal(h.store.contexts.size, 0);
  assert.equal(h.store.states.size, 0);
  await h.meta.capture(EMAIL, true);
  await h.meta.forget(EMAIL);
  assert.equal(await h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true), "skipped");
  await h.meta.capture(EMAIL, true);
  for (const at of [null, PAID_AT - 8 * 86400, NOW / 1000 + 1])
    assert.equal(await h.meta.send(EMAIL, paid.sessionId!, at, async () => true), "skipped");
  assert.equal(h.bodies.length, 0);
});
test("coordinator keeps accepted sinks deduplicated on retry; paid then refunded is never another Purchase", async () => {
  const meta = harness();
  const gaStore = new Store();
  let gaCalls = 0;
  const ga = createGoogleConversions({
    env: {
      ...ENV,
      WATCHDIVE_GA4_CONVERSIONS_ENABLED: "true",
      VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
      VITE_GA_MEASUREMENT_ID: "G-TEST1234",
      GA4_API_SECRET: "fixture",
    },
    store: gaStore,
    now: () => NOW,
    fetchImpl: async () => {
      gaCalls++;
      return new Response(null, { status: 204 });
    },
  });
  const row = {
    email: EMAIL,
    emailVerified: true,
    status: "verified",
    duplicate: false,
    flags: [],
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
  } as unknown as LeadRecord;
  const measurement = createReservationMeasurement(ga, meta.meta, async () => row);
  await measurement.capture(EMAIL, "123.456", true);
  assert.equal(await measurement.completed(EMAIL, paid, PAID_AT), "accepted");
  assert.equal(await measurement.completed(EMAIL, paid, PAID_AT), "duplicate");
  assert.equal(
    await measurement.completed(
      EMAIL,
      { ...paid, status: "refunded", paid: false, amountRefunded: 300 },
      PAID_AT,
    ),
    "skipped",
  );
  assert.equal(
    await measurement.completed(
      EMAIL,
      { ...paid, status: "partially_refunded", paid: false, amountRefunded: 100 },
      PAID_AT,
    ),
    "skipped",
  );
  assert.equal(gaCalls, 1);
  assert.equal(meta.bodies.length, 1);
  // Fresh paid session after a server-side refusal cannot produce any sink event.
  row.measurementConsent = MEASUREMENT_CONSENT_WITHDRAWN;
  assert.equal(
    await measurement.completed(EMAIL, { ...paid, sessionId: "cs_test_second" }, PAID_AT),
    "skipped",
  );
  assert.equal(gaStore.contexts.size, 0);
  assert.equal(meta.store.contexts.size, 0);
  assert.equal(gaCalls, 1);
  assert.equal(meta.bodies.length, 1);
});
test("Meta purchase remains usable with GA disabled; consent is still required", async () => {
  const h = harness();
  const ga = createGoogleConversions({ env: {} });
  const row = {
    email: EMAIL,
    emailVerified: true,
    status: "verified",
    flags: [],
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
  } as unknown as LeadRecord;
  const measurement = createReservationMeasurement(ga, h.meta, async () => row);
  await measurement.capture(EMAIL, undefined, false);
  assert.equal(await measurement.completed(EMAIL, paid, PAID_AT), "skipped");
  await measurement.capture(EMAIL, undefined, true);
  assert.equal(await measurement.completed(EMAIL, paid, PAID_AT), "accepted");
  assert.equal(h.bodies.length, 1);
});
test("duplicatePaid holds both purchase sinks for reconciliation", async () => {
  const h = harness();
  const ga = createGoogleConversions({ env: {} });
  const row = {
    email: EMAIL,
    emailVerified: true,
    status: "verified",
    duplicate: false,
    flags: [],
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
  } as unknown as LeadRecord;
  const measurement = createReservationMeasurement(ga, h.meta, async () => row);
  await measurement.capture(EMAIL, undefined, true);
  const duplicated = { ...paid, duplicatePaid: true };
  assert.equal(purchaseEvent(duplicated), null);
  assert.equal(await measurement.completed(EMAIL, duplicated, PAID_AT), "skipped");
  assert.equal(await measurement.completed(EMAIL, duplicated, PAID_AT), "skipped");
  assert.equal(h.bodies.length, 0);
});
test("checkout replaces a stale GA cookie, and a refusal clears both sinks", async () => {
  const meta = harness();
  const gaStore = new Store();
  let gaPosts = 0;
  const ga = createGoogleConversions({
    env: {
      ...ENV,
      WATCHDIVE_GA4_CONVERSIONS_ENABLED: "true",
      VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
      VITE_GA_MEASUREMENT_ID: "G-TEST1234",
      GA4_API_SECRET: "fixture",
    },
    store: gaStore,
    now: () => NOW,
    fetchImpl: async () => {
      gaPosts += 1;
      return new Response(null, { status: 204 });
    },
  });
  const row = {
    email: EMAIL,
    emailVerified: true,
    status: "verified",
    duplicate: false,
    flags: [],
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
  } as unknown as LeadRecord;
  const measurement = createReservationMeasurement(ga, meta.meta, async () => row);
  await measurement.capture(EMAIL, "111.111", true);
  await measurement.capture(EMAIL, "222.222", true);
  assert.deepEqual(
    [...gaStore.contexts.values()].map((context) => context.clientId),
    ["222.222"],
  );
  await measurement.capture(EMAIL, undefined, true);
  assert.equal(gaStore.contexts.size, 0);
  assert.equal(meta.store.contexts.size, 1);
  assert.equal(await measurement.completed(EMAIL, paid, PAID_AT), "accepted");
  assert.equal(gaPosts, 0);
  assert.equal(meta.bodies.length, 1);
  await measurement.capture(EMAIL, "333.333", false);
  assert.equal(gaStore.contexts.size, 0);
  assert.equal(meta.store.contexts.size, 0);
  assert.equal(
    await measurement.completed(EMAIL, { ...paid, sessionId: "cs_test_second" }, PAID_AT),
    "skipped",
  );
  assert.equal(meta.bodies.length, 1);
  assert.equal(gaPosts, 0);
});
test("partial sink success retries only the destination that has not accepted", async () => {
  let metaResponses = 0;
  const meta = harness({
    response: async () => Response.json({ events_received: ++metaResponses === 1 ? 0 : 1 }),
  });
  const gaStore = new Store();
  let gaPosts = 0;
  const ga = createGoogleConversions({
    env: {
      ...ENV,
      WATCHDIVE_GA4_CONVERSIONS_ENABLED: "true",
      VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
      VITE_GA_MEASUREMENT_ID: "G-TEST1234",
      GA4_API_SECRET: "fixture",
    },
    store: gaStore,
    now: () => NOW,
    fetchImpl: async () => {
      gaPosts += 1;
      return new Response(null, { status: 204 });
    },
  });
  const row = {
    email: EMAIL,
    emailVerified: true,
    status: "verified",
    duplicate: false,
    flags: [],
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
  } as unknown as LeadRecord;
  const measurement = createReservationMeasurement(ga, meta.meta, async () => row);
  await measurement.capture(EMAIL, "123.456", true);
  assert.equal(await measurement.completed(EMAIL, paid, PAID_AT), "retry");
  assert.equal(gaPosts, 1);
  assert.equal(meta.bodies.length, 1);
  assert.equal(await measurement.completed(EMAIL, paid, PAID_AT), "accepted");
  assert.equal(gaPosts, 1);
  assert.equal(meta.bodies.length, 2);
});
test("an uncertain Meta response stays quarantined while an accepted Google event is not resent", async () => {
  const meta = harness({
    response: async () => {
      throw new Error("connection lost");
    },
  });
  const gaStore = new Store();
  let gaPosts = 0;
  const ga = createGoogleConversions({
    env: {
      ...ENV,
      WATCHDIVE_GA4_CONVERSIONS_ENABLED: "true",
      VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
      VITE_GA_MEASUREMENT_ID: "G-TEST1234",
      GA4_API_SECRET: "fixture",
    },
    store: gaStore,
    now: () => NOW,
    fetchImpl: async () => {
      gaPosts += 1;
      return new Response(null, { status: 204 });
    },
  });
  const row = {
    email: EMAIL,
    emailVerified: true,
    status: "verified",
    duplicate: false,
    flags: [],
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
  } as unknown as LeadRecord;
  const measurement = createReservationMeasurement(ga, meta.meta, async () => row);
  await measurement.capture(EMAIL, "123.456", true);
  assert.equal(await measurement.completed(EMAIL, paid, PAID_AT), "uncertain");
  assert.equal(await measurement.completed(EMAIL, paid, PAID_AT), "uncertain");
  assert.equal(gaPosts, 1);
  assert.equal(meta.bodies.length, 1);
});
test("a store failure before the claim is retried and does not post", async () => {
  const h = harness();
  await h.meta.capture(EMAIL, true);
  let down = true;
  const read = h.store.context.bind(h.store);
  h.store.context = async (key) => {
    if (down) throw new Error("store down");
    return read(key);
  };
  assert.equal(await h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true), "retry");
  assert.equal(h.bodies.length, 0);
  assert.equal(h.store.states.size, 0);
  down = false;
  assert.equal(await h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true), "accepted");
  assert.equal(h.bodies.length, 1);
});
test("a lost claim response stays quarantined instead of posting blind", async () => {
  const h = harness();
  await h.meta.capture(EMAIL, true);
  h.store.claim = async () => {
    throw new Error("ack lost");
  };
  assert.equal(await h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true), "uncertain");
  assert.equal(await h.meta.send(EMAIL, paid.sessionId!, PAID_AT, async () => true), "uncertain");
  assert.equal(h.bodies.length, 0);
});
test("a refusal that cannot clear stored consent fails closed", async () => {
  const h = harness();
  await h.meta.capture(EMAIL, true);
  h.store.forget = async () => {
    throw new Error("store down");
  };
  const ga = createGoogleConversions({ env: {} });
  const row = {
    email: EMAIL,
    emailVerified: true,
    status: "verified",
    duplicate: false,
    flags: [],
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
  } as unknown as LeadRecord;
  const measurement = createReservationMeasurement(ga, h.meta, async () => row);
  await assert.rejects(() => measurement.capture(EMAIL, "123.456", false));
  assert.equal(h.store.contexts.size, 1);
});
