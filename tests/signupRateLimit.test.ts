import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, beforeEach, test } from "node:test";

import {
  consumeSignupRateLimit,
  isSignupRequestOriginAllowed,
} from "../src/lib/api/signupRateLimit.server.ts";

const ENV_KEYS = [
  "VERCEL_ENV",
  "NODE_ENV",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SIGNUP_RATE_LIMIT_HMAC_SECRET",
  "SIGNUP_RATE_LIMIT_WINDOW_SECONDS",
  "SIGNUP_RATE_LIMIT_MAX_ATTEMPTS",
] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

after(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureProduction(): void {
  process.env.VERCEL_ENV = "production";
  process.env.SUPABASE_URL = "https://measurement.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-only";
  process.env.SIGNUP_RATE_LIMIT_HMAC_SECRET = "signup-rate-limit-independent-test-secret-123456789";
}

test("production fails closed before storage when the rate limiter is unconfigured", async () => {
  process.env.VERCEL_ENV = "production";
  let called = false;
  const result = await consumeSignupRateLimit({ ip: "203.0.113.55" }, async () => {
    called = true;
    return Response.json(true);
  });

  assert.deepEqual(result, {
    allowed: false,
    configured: false,
    reason: "unconfigured",
  });
  assert.equal(called, false);
});

test("origin guard accepts same-host production, custom, and Preview origins", () => {
  process.env.VERCEL_ENV = "production";
  assert.equal(
    isSignupRequestOriginAllowed({
      origin: "https://watchdive.diveroid.com",
      host: "watchdive.diveroid.com",
    }),
    true,
  );
  assert.equal(
    isSignupRequestOriginAllowed({
      origin: "https://campaign.example-diving.com",
      host: "CAMPAIGN.EXAMPLE-DIVING.COM",
    }),
    true,
  );

  process.env.VERCEL_ENV = "preview";
  assert.equal(
    isSignupRequestOriginAllowed({
      origin: "https://watchdive-git-funnel-team.vercel.app",
      host: "watchdive-git-funnel-team.vercel.app",
    }),
    true,
  );
});

test("origin guard rejects cross-site, malformed, and insecure production origins", () => {
  process.env.VERCEL_ENV = "production";
  assert.equal(
    isSignupRequestOriginAllowed({
      origin: "https://attacker.example",
      host: "watchdive.diveroid.com",
    }),
    false,
  );
  assert.equal(
    isSignupRequestOriginAllowed({
      origin: "null",
      host: "watchdive.diveroid.com",
    }),
    false,
  );
  assert.equal(
    isSignupRequestOriginAllowed({
      origin: "http://watchdive.diveroid.com",
      host: "watchdive.diveroid.com",
    }),
    false,
  );
});

test("missing Origin is production-fail-closed and preview/development-safe", () => {
  process.env.VERCEL_ENV = "production";
  assert.equal(isSignupRequestOriginAllowed({ origin: "", host: "" }), false);

  process.env.VERCEL_ENV = "preview";
  assert.equal(isSignupRequestOriginAllowed({ origin: "", host: "" }), true);

  delete process.env.VERCEL_ENV;
  assert.equal(isSignupRequestOriginAllowed({ origin: "", host: "" }), true);
  assert.equal(
    isSignupRequestOriginAllowed({
      origin: "http://localhost:3000",
      host: "localhost:3000",
    }),
    true,
  );
  assert.equal(
    isSignupRequestOriginAllowed({
      origin: "http://attacker.localhost:3000",
      host: "localhost:3000",
    }),
    false,
  );
});

test("preview and development stay safely usable while configuration is absent", async () => {
  for (const environment of ["preview", undefined] as const) {
    if (environment) process.env.VERCEL_ENV = environment;
    else delete process.env.VERCEL_ENV;
    const result = await consumeSignupRateLimit({ ip: "203.0.113.55" }, async () => {
      throw new Error("storage must not be called");
    });
    assert.equal(result.allowed, true);
    assert.equal(result.configured, false);
    assert.equal(result.reason, "unconfigured");
  }
});

test("sends only a rotating keyed HMAC to the atomic Supabase RPC", async () => {
  configureProduction();
  process.env.SIGNUP_RATE_LIMIT_WINDOW_SECONDS = "3600";
  process.env.SIGNUP_RATE_LIMIT_MAX_ATTEMPTS = "120";
  const rawIp = "203.0.113.55";
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const result = await consumeSignupRateLimit(
    { ip: rawIp, now: new Date("2026-07-29T02:34:56.000Z") },
    async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json(true);
    },
  );

  assert.equal(result.allowed, true);
  assert.equal(result.configured, true);
  assert.equal(
    capturedUrl,
    "https://measurement.supabase.co/rest/v1/rpc/consume_signup_rate_limit_v1",
  );
  const serializedRequest = `${capturedUrl}\n${JSON.stringify(capturedInit)}`;
  assert.equal(serializedRequest.includes(rawIp), false);

  const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  assert.match(String(body.p_bucket_hash), /^[0-9a-f]{64}$/);
  assert.equal(body.p_environment, "production");
  assert.equal(body.p_window_started_at, "2026-07-29T02:00:00.000Z");
  assert.equal(body.p_expires_at, "2026-07-29T03:00:00.000Z");
  assert.equal(body.p_limit, 120);
  assert.equal((capturedInit?.headers as Record<string, string>).apikey, "service-role-test-only");
});

test("enforces the atomic RPC decision and fails closed on production storage errors", async () => {
  configureProduction();

  const limited = await consumeSignupRateLimit({ ip: "203.0.113.55" }, async () =>
    Response.json(false),
  );
  assert.deepEqual(limited, {
    allowed: false,
    configured: true,
    reason: "limited",
  });

  const unavailable = await consumeSignupRateLimit({ ip: "203.0.113.55" }, async () =>
    Response.json({ error: "unavailable" }, { status: 503 }),
  );
  assert.deepEqual(unavailable, {
    allowed: false,
    configured: true,
    reason: "storage_unavailable",
  });
});

test("waitlist wiring consumes the bucket before the first CRM lookup", async () => {
  const source = await readFile(
    new URL("../src/lib/api/waitlist.functions.ts", import.meta.url),
    "utf8",
  );
  const handlerStart = source.indexOf("export const handleJoinWaitlist");
  const originGuard = source.indexOf(
    "isSignupRequestOriginAllowed({ origin, host })",
    handlerStart,
  );
  const limiterCall = source.indexOf("consumeSignupRateLimit({ ip })", handlerStart);
  const firstCrmLookup = source.indexOf("notionFetch(`databases/${dbId}/query`", handlerStart);

  assert.notEqual(handlerStart, -1);
  assert.notEqual(originGuard, -1);
  assert.notEqual(limiterCall, -1);
  assert.notEqual(firstCrmLookup, -1);
  assert.ok(originGuard < limiterCall);
  assert.ok(limiterCall < firstCrmLookup);
});

test("migration keeps rate-limit buckets private and exposes only the atomic service RPC", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260729090000_funnel_measurement.sql", import.meta.url),
    "utf8",
  );
  const tableBlock = migration.match(
    /create table if not exists public\.signup_rate_limit_buckets \([\s\S]*?\n\);/,
  )?.[0];

  assert.ok(tableBlock);
  assert.equal(/\bip\b/i.test(tableBlock), false);
  assert.match(
    migration,
    /alter table public\.signup_rate_limit_buckets enable row level security;/,
  );
  assert.match(
    migration,
    /revoke all on public\.signup_rate_limit_buckets from anon, authenticated;/,
  );
  assert.match(migration, /create or replace function public\.consume_signup_rate_limit_v1\(/);
  assert.match(
    migration,
    /revoke all on function public\.consume_signup_rate_limit_v1\([\s\S]*?\) from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.consume_signup_rate_limit_v1\([\s\S]*?\) to service_role;/,
  );
});
