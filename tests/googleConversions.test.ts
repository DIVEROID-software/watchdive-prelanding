import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGoogleConversions,
  measurementProtocolParams,
  redisConversionStore,
  type ConversionStore,
  type Context,
} from "../src/lib/analytics/googleConversions.server.ts";
import { purchaseEvent } from "../src/lib/reservation/measurement.server.ts";
import {
  confirmVerificationService,
  requestVerificationService,
  grantAttemptMeasurementService,
  withdrawAttemptMeasurementService,
  completeSocialVerification,
  type ServiceDependencies,
} from "../src/lib/verification/service.ts";
import { FakeLeadStore, FakeMailer, leadIdFactory, TEST_ENV } from "./helpers/fakes.ts";
import type { ReservationSnapshot } from "../src/lib/reservation/state.ts";

const ENV = {
  ...TEST_ENV,
  WATCHDIVE_GA4_CONVERSIONS_ENABLED: "true",
  VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
  VITE_GA_MEASUREMENT_ID: "G-TEST1234",
  GA4_API_SECRET: "fixture-only",
  WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://store.example.test",
  WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "fixture-only",
  WATCHDIVE_CONVERSION_LEDGER_EPOCH: "watchdive-ledger-20261030",
};
const NOW = Date.parse("2026-10-26T10:00:00Z");
const EMAIL = "diver@example.test";
class MemoryStore implements ConversionStore {
  contexts = new Map<string, Context>();
  claims = new Map<string, string>();
  epochValue: string | null = "watchdive-ledger-20261030";
  async epoch() {
    return this.epochValue;
  }
  async context(key: string) {
    return this.contexts.get(key) ?? null;
  }
  async capture(key: string, value: Context) {
    this.contexts.set(key, value);
  }
  async forget(key: string) {
    this.contexts.delete(key);
  }
  async claim(key: string) {
    if (this.claims.has(key)) return false;
    this.claims.set(key, "uncertain");
    return true;
  }
  async status(key: string) {
    return (this.claims.get(key) as "accepted" | "uncertain" | undefined) ?? null;
  }
  async finish(key: string, value: string) {
    this.claims.set(key, value);
  }
  async release(key: string) {
    this.claims.delete(key);
  }
}
const event = { name: "sign_up" as const, key: "record-one", params: { method: "email" } };
function harness(options: { env?: Record<string, string>; fetchImpl?: typeof fetch } = {}) {
  const store = new MemoryStore();
  const payloads: Record<string, unknown>[] = [];
  const google = createGoogleConversions({
    env: options.env ?? ENV,
    store,
    now: () => NOW,
    fetchImpl:
      options.fetchImpl ??
      (async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      }),
  });
  return { store, google, payloads };
}
test("disabled or incomplete config is inert, never contacts an endpoint", async () => {
  for (const env of [
    {},
    { ...ENV, GA4_API_SECRET: "" },
    { ...ENV, WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "" },
    { ...ENV, WATCHDIVE_CONVERSION_LEDGER_EPOCH: "" },
    { ...ENV, WATCHDIVE_CONVERSION_LEDGER_EPOCH: "short" },
  ]) {
    const h = harness({ env });
    await h.google.capture(EMAIL, "123.456", true);
    assert.equal(await h.google.send(EMAIL, event, async () => true), "disabled");
    assert.equal(h.store.contexts.size, 0);
    assert.equal(h.payloads.length, 0);
  }
});
test("concurrent confirmations and a restarted dispatcher share one durable claim", async () => {
  const h = harness();
  await h.google.capture(EMAIL, "123.456", true);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => h.google.send(EMAIL, event, async () => true)),
  );
  assert.equal(results.filter((x) => x === "accepted").length, 1);
  assert.equal(h.payloads.length, 1);
  const restarted = createGoogleConversions({
    env: ENV,
    store: h.store,
    now: () => NOW,
    fetchImpl: async () => {
      throw new Error("duplicate send");
    },
  });
  assert.equal(await restarted.send(EMAIL, event, async () => true), "duplicate");
  assert.equal(h.payloads[0].client_id, "123.456");
  assert.ok(!JSON.stringify(h.payloads).includes(EMAIL));
  assert.ok(!JSON.stringify([...h.store.contexts.keys()]).includes(EMAIL));
});
test("denial, missing client ID, withdrawal and a refusal racing claim all prevent delivery", async () => {
  const h = harness();
  await h.google.capture(EMAIL, "123.456", false);
  assert.equal(await h.google.send(EMAIL, event, async () => true), "skipped");
  await h.google.capture(EMAIL, "email@example.test", true);
  assert.equal(h.store.contexts.size, 0);
  await h.google.capture(EMAIL, "123.456", true);
  let reads = 0;
  assert.equal(await h.google.send(EMAIL, event, async () => ++reads === 1), "skipped");
  assert.equal(h.store.contexts.size, 0);
  assert.equal(h.store.claims.size, 0);
  await h.google.capture(EMAIL, "123.456", true);
  await h.google.forget(EMAIL);
  assert.equal(await h.google.send(EMAIL, event, async () => true), "skipped");
  assert.equal(h.payloads.length, 0);
});
test("ambiguous dispatch is quarantined rather than resent on a webhook retry", async () => {
  let calls = 0;
  const h = harness({
    fetchImpl: async () => {
      calls++;
      throw new Error("connection lost after upload");
    },
  });
  await h.google.capture(EMAIL, "123.456", true);
  assert.equal(await h.google.send(EMAIL, event, async () => true), "uncertain");
  assert.equal(await h.google.send(EMAIL, event, async () => true), "uncertain");
  assert.equal(calls, 1);
});
test("a failure before dispatch can retry, while a store failure never sends", async () => {
  const h = harness();
  await h.google.capture(EMAIL, "123.456", true);
  let reads = 0;
  assert.equal(
    await h.google.send(EMAIL, event, async () => {
      if (++reads === 2) throw new Error("CRM unavailable");
      return true;
    }),
    "retry",
  );
  assert.equal(h.payloads.length, 0);
  assert.equal(h.store.claims.size, 0);
  assert.equal(await h.google.send(EMAIL, event, async () => true), "accepted");
});
test("a missing claim acknowledgement never deletes another worker's claim", async () => {
  const h = harness();
  await h.google.capture(EMAIL, "123.456", true);
  h.store.claim = async (key) => {
    h.store.claims.set(key, "uncertain");
    throw new Error("store timeout");
  };
  assert.equal(await h.google.send(EMAIL, event, async () => true), "uncertain");
  assert.equal(h.store.claims.size, 1);
  assert.equal(h.payloads.length, 0);
});
test("Redis claims under one epoch script and expires context only", async () => {
  const commands: unknown[][] = [];
  const store = redisConversionStore(
    "https://store.example.test",
    "fixture",
    async (_url, init) => {
      commands.push(JSON.parse(String(init?.body)));
      const body = JSON.parse(String(init?.body)) as unknown[];
      const script = String(body[1] ?? "");
      if (script.includes("wdconv-op:claim")) return Response.json({ result: "claimed" });
      if (script.includes("wdconv-op:capture")) return Response.json({ result: "ok" });
      return Response.json({ result: "OK" });
    },
    "watchdive-ledger-20261030",
  );
  await store.claim("event");
  await store.capture("subject", { clientId: "123.456", capturedAt: NOW });
  await store.forget("subject");
  const claim = commands[0] as unknown[];
  assert.equal(claim[0], "EVAL");
  assert.equal(claim[2], 2);
  assert.equal(claim[3], "wdconv:ledger:epoch");
  assert.equal(claim[4], "wdconv:event:event");
  assert.match(String(claim[1]), /SET", KEYS\[2\], ARGV\[2\], "NX"/);
  assert.doesNotMatch(String(claim[1]), /EX/);
  assert.doesNotMatch(String(claim[1]), /SET", KEYS\[1\]/);
  const capture = commands[1] as unknown[];
  assert.equal(capture[0], "EVAL");
  assert.match(String(capture[1]), /"EX", ARGV\[3\]/);
  assert.equal(capture.at(-1), "604800");
  assert.deepEqual(commands[2], ["DEL", "wdconv:context:subject"]);
  assert.equal(commands.some((args) => args[0] === "SET" && args[1] === "wdconv:ledger:epoch"), false);
});
function verification() {
  const h = harness();
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const dependencies: ServiceDependencies = {
    store,
    mailer,
    env: TEST_ENV,
    now: () => new Date(NOW),
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async () => {},
    captureGoogleContext: h.google.capture,
    forgetGoogleContext: h.google.forget,
    dispatchGoogleVerified: async (row, allowed) => {
      await h.google.send(row.email, { ...event, key: row.pageId }, allowed);
    },
  };
  const submit = {
    email: EMAIL,
    canonical: EMAIL,
    source: "hero",
    flags: [],
    suspect: false,
    measurementConsent: true,
    googleClientId: "123.456",
    networkSendBlocked: false,
  };
  return { ...h, leadStore: store, mailer, dependencies, submit };
}
test("pending and invalid confirmation do not emit; completed email does without any original tab or Meta", async () => {
  const h = verification();
  const pending = await requestVerificationService(h.submit, h.dependencies);
  assert.equal(pending.status, "pending");
  assert.equal(h.payloads.length, 0);
  await confirmVerificationService("invalid", h.dependencies);
  assert.equal(h.payloads.length, 0);
  await confirmVerificationService(h.mailer.sent[0].token, h.dependencies);
  await confirmVerificationService(h.mailer.sent[0].token, h.dependencies);
  assert.equal(h.payloads.length, 1);
  assert.deepEqual(h.payloads[0].events, [
    { name: "sign_up", params: { method: "email" } },
  ]);
});
test("mail failure and expired verification produce no completion", async () => {
  const h = verification();
  h.mailer.fail = true;
  await requestVerificationService(h.submit, h.dependencies);
  assert.equal(h.payloads.length, 0);
  const h2 = verification();
  await requestVerificationService(h2.submit, h2.dependencies);
  await confirmVerificationService(h2.mailer.sent[0].token, {
    ...h2.dependencies,
    now: () => new Date(NOW + 86400001),
  });
  assert.equal(h2.payloads.length, 0);
});
test("GPC at confirmation and persisted withdrawal prevent server conversion", async () => {
  for (const withdraw of [true, false]) {
    const h = verification();
    const pending = await requestVerificationService(h.submit, h.dependencies);
    if (withdraw) await withdrawAttemptMeasurementService(pending.handle, h.dependencies);
    await confirmVerificationService(h.mailer.sent[0].token, { ...h.dependencies, gpc: !withdraw });
    assert.equal(h.payloads.length, 0);
    assert.equal(h.store.contexts.size, 0);
  }
});
test("late consent captures context while pending; later confirmation sends once", async () => {
  const h = verification();
  const pending = await requestVerificationService(
    { ...h.submit, measurementConsent: false },
    h.dependencies,
  );
  await grantAttemptMeasurementService(
    pending.handle,
    { googleClientId: "123.456" },
    { ...h.dependencies, grantGate: () => true },
  );
  assert.equal(h.payloads.length, 0);
  await confirmVerificationService(h.mailer.sent[0].token, h.dependencies);
  assert.equal(h.payloads.length, 1);
});
test("social completion uses the same authoritative GA path", async () => {
  const h = verification();
  await requestVerificationService(h.submit, h.dependencies);
  const row = [...h.leadStore.rows.values()][0];
  await completeSocialVerification(row, h.dependencies, {}, new Date(NOW));
  await completeSocialVerification(row, h.dependencies, {}, new Date(NOW));
  assert.equal(h.payloads.length, 1);
});
const paid: ReservationSnapshot = {
  status: "paid",
  paid: true,
  sessionId: "cs_test_verified",
  amountTotal: 300,
  currency: "usd",
  amountRefunded: 0,
  amountRefundPending: 0,
  duplicatePaid: false,
  source: "stripe",
  leadId: null,
  url: null,
};
test("purchase is exactly USD 3 and stable per session; no event for failed/refunded/disputed/duplicate state", async () => {
  const event = purchaseEvent(paid)!;
  assert.equal(event.params.value, 3);
  assert.equal(event.params.transaction_id, paid.sessionId);
  const h = harness();
  await h.google.capture(EMAIL, "123.456", true);
  await h.google.send(EMAIL, event, async () => true);
  await h.google.send(EMAIL, event, async () => true);
  assert.equal(h.payloads.length, 1);
  const purchaseParams = (h.payloads[0].events as { params: Record<string, unknown> }[])[0].params;
  assert.equal(purchaseParams.value, 3);
  assert.equal(purchaseParams.currency, "USD");
  assert.equal("engagement_time_msec" in purchaseParams, false);
  assert.equal(purchaseParams.transaction_id, paid.sessionId);
  assert.equal("session_id" in purchaseParams, false);
  for (const changes of [
    { status: "unpaid" },
    { paid: false },
    { status: "refunded", amountRefunded: 300 },
    { status: "partially_refunded", amountRefunded: 100 },
    { amountRefundPending: 300 },
    { status: "disputed" },
    { amountTotal: 1 },
    { currency: "eur" },
    { duplicatePaid: true },
  ])
    assert.equal(purchaseEvent({ ...paid, ...changes } as ReservationSnapshot), null);
});

test("measurement protocol drops identifiers and keeps a measured duration", () => {
  const params = measurementProtocolParams({
    transaction_id: "cs_test_verified",
    value: 3,
    currency: "USD",
    session_id: "cs_test_verified",
    email: "diver@example.test",
    phone: "+15550001111",
    user_id: "lead_secret",
    engagement_time_msec: 250,
  });
  assert.equal(params.value, 3);
  assert.equal(params.currency, "USD");
  assert.equal(params.engagement_time_msec, 250);
  assert.equal(params.transaction_id, "cs_test_verified");
  assert.equal("session_id" in params, false);
  assert.equal("email" in params, false);
  assert.equal("phone" in params, false);
  assert.equal("user_id" in params, false);
  assert.equal(params.value === 149, false);
  const omitted = measurementProtocolParams({ value: 3, currency: "USD" });
  assert.equal("engagement_time_msec" in omitted, false);
});

test("confirmation keeps the signup client id and still sends one sign_up", async () => {
  const h = verification();
  await requestVerificationService(h.submit, h.dependencies);
  await confirmVerificationService(h.mailer.sent[0].token, h.dependencies, {
    googleClientId: "999.999",
  });
  await confirmVerificationService(h.mailer.sent[0].token, h.dependencies, {
    googleClientId: "999.999",
  });
  assert.equal(h.payloads.length, 1);
  assert.equal(h.payloads[0].client_id, "123.456");
});

test("confirmation stores a client id when signup had none", async () => {
  const h = verification();
  await requestVerificationService({ ...h.submit, googleClientId: undefined }, h.dependencies);
  assert.equal(h.payloads.length, 0);
  await confirmVerificationService(h.mailer.sent[0].token, h.dependencies, {
    googleClientId: "888.777",
  });
  assert.equal(h.payloads.length, 1);
  assert.equal(h.payloads[0].client_id, "888.777");
});

test("an unverified submit does not emit sign_up or purchase", async () => {
  const h = verification();
  const pending = await requestVerificationService(h.submit, h.dependencies);
  assert.equal(pending.status, "pending");
  assert.equal(h.payloads.length, 0);
  const purchase = purchaseEvent({ ...paid, paid: false, status: "unpaid" });
  assert.equal(purchase, null);
});

test("latest allowed browser context replaces the old one; missing and stale contexts are skipped", async () => {
  const h = harness();
  await h.google.capture(EMAIL, "123.456", true);
  await h.google.capture(EMAIL, "999.999", true);
  await h.google.send(EMAIL, event, async () => true);
  assert.equal(h.payloads[0].client_id, "999.999");
  await h.google.capture(EMAIL, undefined, true);
  assert.equal(h.store.contexts.size, 0);
  const old = harness();
  await old.google.capture(EMAIL, "123.456", true);
  for (const entry of old.store.contexts.values()) entry.capturedAt = NOW - 7 * 86400000 - 1;
  assert.equal(await old.google.send(EMAIL, event, async () => true), "skipped");
});

test("GPC at signup does not capture context or permit a later completion", async () => {
  const h = verification();
  await requestVerificationService(h.submit, { ...h.dependencies, gpc: true });
  assert.equal(h.store.contexts.size, 0);
  await confirmVerificationService(h.mailer.sent[0].token, h.dependencies);
  assert.equal(h.payloads.length, 0);
});

test("withdrawal persists refusal even when cleanup fails and returns retry until cleanup succeeds", async () => {
  const h = verification();
  const pending = await requestVerificationService(h.submit, h.dependencies);
  const failed = await withdrawAttemptMeasurementService(pending.handle, {
    ...h.dependencies,
    withdrawGate: () => true,
    forgetGoogleContext: async () => {
      throw new Error("store unavailable");
    },
  });
  assert.equal(failed.recorded, false);
  await confirmVerificationService(h.mailer.sent[0].token, h.dependencies);
  assert.equal(h.payloads.length, 0);
  const retried = await withdrawAttemptMeasurementService(pending.handle, {
    ...h.dependencies,
    withdrawGate: () => true,
  });
  assert.equal(retried.recorded, true);
  assert.equal(h.store.contexts.size, 0);
});

test("server signup requires the matching public rollout switch", async () => {
  const h = harness({ env: { ...ENV, VITE_GA4_SERVER_CONVERSIONS_ENABLED: "false" } });
  assert.equal(h.google.enabled, false);
  assert.equal(await h.google.send(EMAIL, event, async () => true), "disabled");
});

test("production preflight rejects half-enabled rollout and missing durable store without exposing values", async () => {
  const { checkConversionRolloutEnv, assertVerificationEnv } =
    await import("../src/lib/verification/envPreflight.ts");
  assert.deepEqual(checkConversionRolloutEnv({}), []);
  assert.ok(checkConversionRolloutEnv({ VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true" }).length > 0);
  assert.deepEqual(checkConversionRolloutEnv(ENV), []);
  assert.throws(
    () =>
      assertVerificationEnv({
        ...ENV,
        VERCEL: "1",
        GA4_API_SECRET: "",
        NOTION_API_KEY: "fixture",
        NOTION_WAITLIST_DB_ID: "fixture",
        RESEND_API_KEY: "fixture",
        WATCHDIVE_EMAIL_FROM: "test@example.test",
      }),
    /GA4_API_SECRET/,
  );
});
