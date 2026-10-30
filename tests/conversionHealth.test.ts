import assert from "node:assert/strict";
import { test } from "node:test";
import { handleConversionHealth } from "../src/lib/analytics/conversionHealth.server.ts";

const env = {
  WATCHDIVE_EXPERIMENT_REPORT_TOKEN: "operator-test-token-not-a-real-credential",
  WATCHDIVE_VERIFICATION_SECRET: "synthetic-verification-secret-32-characters",
  WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://ledger.example.test",
  WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "synthetic-redis-token",
  GA4_API_SECRET: "synthetic-ga-secret",
  VITE_GA_MEASUREMENT_ID: "G-TEST12345",
};
const request = (method: string, authorized = true) => new Request("https://watchdive.example/api/conversion-health", {
  method,
  headers: authorized ? { authorization: `Bearer ${env.WATCHDIVE_EXPERIMENT_REPORT_TOKEN}` } : {},
});
const forbiddenFetch: typeof fetch = async () => { throw new Error("unexpected external request"); };

test("runtime health rejects unauthenticated and missing-token requests before external work", async () => {
  for (const options of [
    { req: request("POST", false), env },
    { req: request("POST"), env: { ...env, WATCHDIVE_EXPERIMENT_REPORT_TOKEN: undefined } },
  ]) {
    const response = await handleConversionHealth(options.req, { env: options.env, fetchImpl: forbiddenFetch });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }
});

test("health GET checks runtime configuration without querying the ledger or exposing values", async () => {
  const response = await handleConversionHealth(request("GET"), { env, fetchImpl: forbiddenFetch });
  const text = await response.text();
  for (const value of Object.values(env)) assert.equal(text.includes(value), false);
  const data = JSON.parse(text);
  assert.equal(data.capability.store.configured, true);
  assert.equal(data.capability.store.epochPresent, false);
  assert.equal(data.capability.senderWouldEmit, false);
  assert.equal(data.epochPresent, false);
  assert.equal(data.epochMatches, false);
  assert.equal(data.ledgerMarker, "unconfigured");
  assert.equal(data.storeProbe, null);
  assert.equal(data.ga4ActivationReady, false);
  assert.equal(data.actualConversionReceiptVerified, false);
});

test("authenticated health POST only writes temporary synthetic keys and cleans them", async () => {
  const rows = new Map<string, string>();
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), new URL(env.WATCHDIVE_CONVERSION_REDIS_REST_URL).href);
    const [cmd, key, value, ...args] = JSON.parse(String(init?.body));
    assert.match(key, /^wdconv:preflight:[a-f0-9]{16}:(claim|read|expiry)$/);
    if (cmd === "SET") {
      if (args.includes("NX") && rows.has(key)) return Response.json({ result: null });
      rows.set(key, value);
      return Response.json({ result: "OK" });
    }
    if (cmd === "GET") return Response.json({ result: rows.get(key) ?? null });
    if (cmd === "DEL") return Response.json({ result: Number(rows.delete(key)) });
    throw new Error("unexpected command");
  };
  const response = await handleConversionHealth(request("POST"), { env, fetchImpl });
  const data = await response.json();
  assert.equal(data.probePassed, true);
  assert.equal(data.epochMatches, false);
  assert.equal(data.ledgerMarker, "unconfigured");
  assert.equal(data.ga4ActivationReady, false);
  assert.equal(data.capability.senderWouldEmit, false);
  assert.equal(data.sendsAnalytics, false);
  assert.equal(data.actualConversionReceiptVerified, false);
  assert.equal(rows.size, 0);
});

test("a matched epoch is boolean-only and still does not authorize a sender", async () => {
  const epoch = "wdledger-health-9f3a7c2e";
  const rows = new Map<string, string>([["wdconv:ledger:epoch", epoch]]);
  const commands: string[][] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), new URL(env.WATCHDIVE_CONVERSION_REDIS_REST_URL).href);
    const args = JSON.parse(String(init?.body)) as string[];
    commands.push(args);
    const [cmd, key, value, ...rest] = args;
    if (cmd === "GET" && key === "wdconv:ledger:epoch") {
      return Response.json({ result: rows.get(key) ?? null });
    }
    assert.match(String(key), /^wdconv:preflight:[a-f0-9]{16}:(claim|read|expiry)$/);
    if (cmd === "SET") {
      if (rest.includes("NX") && rows.has(key)) return Response.json({ result: null });
      rows.set(key, value);
      return Response.json({ result: "OK" });
    }
    if (cmd === "GET") return Response.json({ result: rows.get(key) ?? null });
    if (cmd === "DEL") return Response.json({ result: Number(rows.delete(key)) });
    throw new Error(`unexpected ${cmd}`);
  };
  const authed = {
    ...env,
    WATCHDIVE_CONVERSION_LEDGER_EPOCH: epoch,
  };
  const read = await handleConversionHealth(request("GET"), { env: authed, fetchImpl });
  const readText = await read.text();
  assert.equal(readText.includes(epoch), false);
  assert.equal(readText.includes(env.WATCHDIVE_CONVERSION_REDIS_REST_TOKEN), false);
  const readBody = JSON.parse(readText);
  assert.equal(readBody.epochPresent, true);
  assert.equal(readBody.epochMatches, true);
  assert.equal(readBody.ledgerMarker, "matched");
  assert.equal(readBody.ga4ActivationReady, false);
  assert.equal(readBody.storeProbe, null);
  assert.deepEqual(commands, [["GET", "wdconv:ledger:epoch"]]);
  const response = await handleConversionHealth(request("POST"), { env: authed, fetchImpl });
  const text = await response.text();
  assert.equal(text.includes(epoch), false);
  const data = JSON.parse(text);
  assert.equal(data.epochMatches, true);
  assert.equal(data.probePassed, true);
  assert.equal(data.ga4ActivationReady, true);
  assert.equal(data.capability.senderWouldEmit, false);
  assert.equal(data.sendsAnalytics, false);
  assert.equal(commands.some((args) => args[0] === "SET" && args[1] === "wdconv:ledger:epoch"), false);
  assert.equal(commands.some((args) => args[0] === "EVAL"), false);
  assert.equal(rows.get("wdconv:ledger:epoch"), epoch);
});

test("ledger errors cannot report activation ready or leak the upstream error", async () => {
  const response = await handleConversionHealth(request("POST"), { env, fetchImpl: async () => {
    throw new Error(`credential: ${env.WATCHDIVE_CONVERSION_REDIS_REST_TOKEN}`);
  } });
  const text = await response.text();
  assert.equal(text.includes(env.WATCHDIVE_CONVERSION_REDIS_REST_TOKEN), false);
  const data = JSON.parse(text);
  assert.equal(data.ga4ActivationReady, false);
  assert.equal(data.storeProbe.error, "unavailable");
});
