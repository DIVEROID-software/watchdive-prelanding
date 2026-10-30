import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoogleConversions,
  type ConversionStore,
  type Context,
} from "../src/lib/analytics/googleConversions.server.ts";
import { checkConversionRolloutEnv } from "../src/lib/verification/envPreflight.ts";

const ENV = {
  WATCHDIVE_GA4_CONVERSIONS_ENABLED: "true",
  VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
  VITE_GA_MEASUREMENT_ID: "G-TEST1234",
  GA4_API_SECRET: "fixture-only",
  WATCHDIVE_VERIFICATION_SECRET: "x".repeat(32),
  WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://store.example.test",
  WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "fixture-only",
  WATCHDIVE_CONVERSION_LEDGER_EPOCH: "watchdive-ledger-20261030",
};
const NOW = Date.parse("2026-10-26T10:00:00Z");
const EMAIL = "diver@example.test";
const event = { name: "sign_up" as const, key: "record-one", params: { method: "email" } };

class MemoryStore implements ConversionStore {
  contexts = new Map<string, Context>();
  claims = new Map<string, string>();
  async epoch() {
    return "watchdive-ledger-20261030";
  }
  async context(key: string) {
    return this.contexts.get(key) ?? null;
  }
  async capture(key: string, value: Context) {
    if (!this.contexts.has(key)) this.contexts.set(key, value);
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
  async finish(key: string, value: "accepted" | "uncertain") {
    this.claims.set(key, value);
  }
  async release(key: string) {
    this.claims.delete(key);
  }
}

function harness(env: Record<string, string> = ENV) {
  const store = new MemoryStore();
  const payloads: Record<string, unknown>[] = [];
  let calls = 0;
  const google = createGoogleConversions({
    env,
    store,
    now: () => NOW,
    fetchImpl: async (_url, init) => {
      calls += 1;
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    },
  });
  return { store, google, payloads, calls: () => calls };
}

test("disabled and half-configured GA4 signup never calls the network", async () => {
  for (const env of [
    {},
    { ...ENV, WATCHDIVE_GA4_CONVERSIONS_ENABLED: "false" },
    { ...ENV, VITE_GA4_SERVER_CONVERSIONS_ENABLED: "false" },
    { ...ENV, GA4_API_SECRET: "" },
    { ...ENV, WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "" },
    { ...ENV, WATCHDIVE_CONVERSION_LEDGER_EPOCH: "" },
  ]) {
    const h = harness(env);
    await h.google.capture(EMAIL, "123.456", true);
    assert.equal(h.google.enabled, false);
    assert.equal(await h.google.send(EMAIL, event, async () => true), "disabled");
    assert.equal(h.calls(), 0);
    assert.equal(h.payloads.length, 0);
  }
  assert.equal(checkConversionRolloutEnv({}).length, 0);
  assert.ok(checkConversionRolloutEnv({ VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true" }).length > 0);
  assert.equal(checkConversionRolloutEnv(ENV).length, 0);
  const missingEpoch = checkConversionRolloutEnv({
    ...ENV,
    WATCHDIVE_CONVERSION_LEDGER_EPOCH: "",
  });
  assert.ok(missingEpoch.some((problem) => problem.name === "WATCHDIVE_CONVERSION_LEDGER_EPOCH"));
  assert.equal(
    checkConversionRolloutEnv({
      WATCHDIVE_GA4_CONVERSIONS_ENABLED: "false",
      VITE_GA4_SERVER_CONVERSIONS_ENABLED: "false",
    }).length,
    0,
  );
});

test("denial, a bad client id, and a refusal during claim send no signup", async () => {
  const h = harness();
  await h.google.capture(EMAIL, "123.456", false);
  assert.equal(await h.google.send(EMAIL, event, async () => true), "skipped");
  await h.google.capture(EMAIL, "not-a-client", true);
  assert.equal(h.store.contexts.size, 0);
  await h.google.capture(EMAIL, "123.456", true);
  let reads = 0;
  assert.equal(await h.google.send(EMAIL, event, async () => ++reads === 1), "skipped");
  assert.equal(h.store.contexts.size, 0);
  assert.equal(h.store.claims.size, 0);
  assert.equal(h.calls(), 0);
  assert.equal(JSON.stringify(h.payloads).includes(EMAIL), false);
});

test("one verified signup is claimed once and a repeat is not a second event", async () => {
  const h = harness();
  await h.google.capture(EMAIL, "123.456", true);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => h.google.send(EMAIL, event, async () => true)),
  );
  assert.equal(results.filter((result) => result === "accepted").length, 1);
  assert.equal(h.payloads.length, 1);
  assert.equal(h.payloads[0].client_id, "123.456");
  assert.deepEqual((h.payloads[0].events as { name: string }[])[0].name, "sign_up");
  assert.equal(await h.google.send(EMAIL, event, async () => true), "duplicate");
  assert.equal(h.calls(), 1);
});
