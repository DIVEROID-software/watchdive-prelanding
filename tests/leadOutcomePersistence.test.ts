import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { recordLeadOutcome } from "../src/lib/api/funnel.functions.ts";

const ORIGINAL_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeEach(() => {
  process.env.SUPABASE_URL = "https://measurement.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-only";
});

after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("lead outcome retries omit unknown or false verification fields instead of resetting true values", async () => {
  const originalFetch = globalThis.fetch;
  let storedRow: Record<string, unknown> | undefined;

  globalThis.fetch = (async (_input, init) => {
    const rows = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
    storedRow = rows[0];
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  try {
    const stored = await recordLeadOutcome({
      leadId: "platform-lead-123",
      acquisitionPath: "instant_form",
      status: "new",
      valid: true,
      verified: false,
      emailVerified: false,
      phoneVerified: false,
      signedUpAt: "2026-07-29T00:00:00.000Z",
      schemaVersion: "2026-07-29.v1",
    });

    assert.equal(stored, true);
    assert.ok(storedRow);
    assert.equal(Object.hasOwn(storedRow, "verified"), false);
    assert.equal(Object.hasOwn(storedRow, "email_verified"), false);
    assert.equal(Object.hasOwn(storedRow, "phone_verified"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("lead outcome includes only monotonic true verification fields", async () => {
  const originalFetch = globalThis.fetch;
  let storedRow: Record<string, unknown> | undefined;

  globalThis.fetch = (async (_input, init) => {
    const rows = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
    storedRow = rows[0];
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  try {
    await recordLeadOutcome({
      leadId: "lead-verified-123",
      acquisitionPath: "website",
      status: "new",
      valid: true,
      verified: true,
      emailVerified: true,
      phoneVerified: false,
      signedUpAt: "2026-07-29T00:00:00.000Z",
      schemaVersion: "2026-07-29.v1",
    });

    assert.equal(storedRow?.verified, true);
    assert.equal(storedRow?.email_verified, true);
    assert.equal(Object.hasOwn(storedRow ?? {}, "phone_verified"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
