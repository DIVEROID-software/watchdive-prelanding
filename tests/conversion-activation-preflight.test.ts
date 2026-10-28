import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  conversionCapability,
  parseConversionOperatorEnv,
  probeConversionRest,
} from "../src/lib/analytics/activationPreflight.ts";
import { readDeliveryStoreConfig } from "../src/lib/analytics/googleConversions.server.ts";

const SECRET = "v".repeat(32);
const PLANTED_GA = "planted-ga4-secret-9f3a";
const PLANTED_REDIS = "planted-redis-token-9f3a";

const READY = {
  WATCHDIVE_VERIFICATION_SECRET: SECRET,
  WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://store.example.test/rest",
  WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: PLANTED_REDIS,
  VITE_GA_MEASUREMENT_ID: "G-TEST1234",
  GA4_API_SECRET: PLANTED_GA,
  WATCHDIVE_GA4_CONVERSIONS_ENABLED: "false",
  VITE_GA4_SERVER_CONVERSIONS_ENABLED: "false",
  WATCHDIVE_META_PURCHASE_ENABLED: "false",
};

test("redacted CLI pulls are not treated as usable credentials", async () => {
  const parsed = parseConversionOperatorEnv(
    'export GA4_API_SECRET="[SENSITIVE]"\nVITE_GA_MEASUREMENT_ID="G-TEST1234\\n"',
  );
  assert.equal(parsed.GA4_API_SECRET, undefined);
  assert.equal(parsed.VITE_GA_MEASUREMENT_ID?.trim(), "G-TEST1234");
  const env = {
    ...READY,
    GA4_API_SECRET: "[SENSITIVE]",
    WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "[SENSITIVE]",
  };
  const capability = conversionCapability(env);
  assert.equal(capability.ga4.apiSecretPresent, false);
  assert.equal(capability.readyToProbe, false);
  let calls = 0;
  const probe = await probeConversionRest({
    env,
    namespace: "wdconv:preflight:0123456789abcdef",
    fetchImpl: async () => {
      calls++;
      return Response.json({ result: null });
    },
  });
  assert.equal(probe.attempted, false);
  assert.equal(calls, 0);
});

function atomicRedis() {
  const data = new Map<string, string>();
  const hosts: string[] = [];
  const commands: string[][] = [];
  let chain = Promise.resolve();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    hosts.push(url.hostname);
    const args = JSON.parse(String(init?.body)) as string[];
    commands.push(args);
    const run = () => {
      const [cmd, key, value] = args;
      if (cmd === "SET") {
        const nx = args.includes("NX");
        if (nx && data.has(key)) return { result: null };
        data.set(key, value);
        return { result: "OK" };
      }
      if (cmd === "GET") return { result: data.get(key) ?? null };
      if (cmd === "DEL") return { result: data.delete(key) ? 1 : 0 };
      return { error: "unknown" };
    };
    const previous = chain;
    let release: () => void = () => {};
    chain = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return Response.json(run());
    } finally {
      release();
    }
  };
  return { fetchImpl, data, hosts, commands };
}

test("capability is booleans and stays off until both GA4 switches and the ledger exist", () => {
  const empty = conversionCapability({});
  assert.equal(empty.flags.ga4ServerEnabled, false);
  assert.equal(empty.flags.ga4PublicEnabled, false);
  assert.equal(empty.flags.ga4FlagsPaired, true);
  assert.equal(empty.senderWouldEmit, false);
  assert.equal(empty.readyToProbe, false);
  const half = conversionCapability({
    ...READY,
    WATCHDIVE_GA4_CONVERSIONS_ENABLED: "true",
  });
  assert.equal(half.flags.ga4FlagsPaired, false);
  assert.equal(half.senderWouldEmit, false);
  assert.equal(half.readyToProbe, true);
  const armed = conversionCapability({
    ...READY,
    WATCHDIVE_GA4_CONVERSIONS_ENABLED: "true",
    VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
  });
  assert.equal(armed.senderWouldEmit, true);
  assert.equal(JSON.stringify(armed).includes(PLANTED_GA), false);
  assert.equal(JSON.stringify(armed).includes(PLANTED_REDIS), false);
  assert.equal(JSON.stringify(armed).includes(SECRET), false);
});

test("an analytics host is not accepted as the durable ledger", () => {
  assert.equal(
    readDeliveryStoreConfig({
      ...READY,
      WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://www.google-analytics.com/mp/collect",
    }),
    null,
  );
  assert.equal(
    conversionCapability({
      ...READY,
      WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://www.google-analytics.com/mp/collect",
    }).store.redisUrlShapeValid,
    false,
  );
});

test("the probe claims once, reads, and deletes only the synthetic namespace", async () => {
  const redis = atomicRedis();
  const report = await probeConversionRest({
    env: READY,
    namespace: "wdconv:preflight:0123456789abcdef",
    fetchImpl: redis.fetchImpl,
  });
  assert.equal(report.claimAtomic, true);
  assert.equal(report.readMatched, true);
  assert.equal(report.expiryFormAccepted, true);
  assert.equal(report.deleted, true);
  assert.equal(report.leftoverCleared, true);
  assert.equal(report.productionPrefixesUsed, false);
  assert.equal(report.analyticsHostsContacted, false);
  assert.equal(report.error, null);
  assert.equal(redis.data.size, 0);
  assert.ok(redis.hosts.length >= 8);
  assert.ok(redis.hosts.every((host) => host === "store.example.test"));
  assert.ok(
    redis.commands.every((args) =>
      String(args[1]).startsWith("wdconv:preflight:0123456789abcdef:"),
    ),
  );
  assert.equal(
    (
      await probeConversionRest({
        env: READY,
        namespace: "wdconv:event:real",
        fetchImpl: redis.fetchImpl,
      })
    ).error,
    "namespace",
  );
});

test("two NX successes are reported as not atomic and no analytics host is called", async () => {
  const live = new Set<string>();
  const fetchImpl: typeof fetch = async (_input, init) => {
    const args = JSON.parse(String(init?.body)) as string[];
    const key = args[1] ?? "";
    if (args[0] === "SET" && args.includes("NX")) {
      live.add(key);
      return Response.json({ result: "OK" });
    }
    if (args[0] === "SET") {
      live.add(key);
      return Response.json({ result: "OK" });
    }
    if (args[0] === "GET") {
      if (!live.has(key)) return Response.json({ result: null });
      return Response.json({ result: key.endsWith(":read") ? "probe" : "uncertain" });
    }
    if (args[0] === "DEL") {
      live.delete(key);
      return Response.json({ result: 1 });
    }
    return Response.json({ error: "no" });
  };
  const report = await probeConversionRest({
    env: READY,
    namespace: "wdconv:preflight:abcdef0123456789",
    fetchImpl,
  });
  assert.equal(report.claimAtomic, false);
  assert.equal(report.error, "protocol");
  assert.equal(report.analyticsHostsContacted, false);
});

test("the CLI returns booleans and does not echo planted secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-preflight-"));
  const envFile = join(dir, "secrets.env");
  writeFileSync(
    envFile,
    [
      `GA4_API_SECRET=${PLANTED_GA}`,
      `WATCHDIVE_CONVERSION_REDIS_REST_TOKEN=${PLANTED_REDIS}`,
      "WATCHDIVE_CONVERSION_REDIS_REST_URL=https://www.google-analytics.com/mp/collect",
      `WATCHDIVE_VERIFICATION_SECRET=${SECRET}`,
      "WATCHDIVE_GA4_CONVERSIONS_ENABLED=false",
    ].join("\n"),
  );
  const run = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/conversion-activation-preflight.ts",
      "--env-file",
      envFile,
      "--require-ready",
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    },
  );
  assert.equal(run.status, 2);
  assert.equal(run.stdout.includes(PLANTED_GA), false);
  assert.equal(run.stdout.includes(PLANTED_REDIS), false);
  assert.equal(run.stdout.includes(SECRET), false);
  assert.equal(run.stderr.includes(PLANTED_GA), false);
  const body = JSON.parse(run.stdout) as {
    sendsAnalytics: boolean;
    flagsDefaultOff: boolean;
    capability: { readyToProbe: boolean; ga4: { apiSecretPresent: boolean } };
    storeProbe: { attempted: boolean; error: string };
    ga4ActivationReady: boolean;
  };
  assert.equal(body.sendsAnalytics, false);
  assert.equal(body.flagsDefaultOff, true);
  assert.equal(body.capability.ga4.apiSecretPresent, true);
  assert.equal(body.capability.readyToProbe, false);
  assert.equal(body.storeProbe.attempted, false);
  assert.equal(body.ga4ActivationReady, false);
});
