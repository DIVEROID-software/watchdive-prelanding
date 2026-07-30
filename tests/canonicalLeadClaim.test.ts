import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, beforeEach, test } from "node:test";

import { claimCanonicalLead } from "../src/lib/api/canonicalLeadClaim.server.ts";

const ORIGINAL_ENV = {
  SIGNUP_RATE_LIMIT_HMAC_SECRET: process.env.SIGNUP_RATE_LIMIT_HMAC_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeEach(() => {
  process.env.SIGNUP_RATE_LIMIT_HMAC_SECRET = "canonical-claim-test-secret-at-least-32-characters";
  process.env.SUPABASE_URL = "https://measurement.supabase.test/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-only";
});

after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

type StoredClaim = {
  claimantHash: string;
  acquisitionPath: string;
  refCode: string;
};

function claimStore(): {
  fetchImpl: typeof fetch;
  calls: Array<Record<string, unknown>>;
} {
  const claims = new Map<string, StoredClaim>();
  const calls: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (input, init) => {
    assert.equal(
      String(input),
      "https://measurement.supabase.test/rest/v1/rpc/claim_canonical_lead_v1",
    );
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.apikey, "service-role-test-only");
    assert.equal(headers.Authorization, "Bearer service-role-test-only");
    assert.ok(init?.signal instanceof AbortSignal);

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    const key = `${body.p_environment}:${body.p_canonical_hash}`;
    const existing = claims.get(key);
    const stored =
      existing ??
      ({
        claimantHash: String(body.p_claimant_hash),
        acquisitionPath: String(body.p_acquisition_path),
        refCode: String(body.p_ref_code),
      } satisfies StoredClaim);
    claims.set(key, stored);
    return Response.json({
      owner: stored.claimantHash === body.p_claimant_hash,
      acquisition_path: stored.acquisitionPath,
      ref_code: stored.refCode,
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("website and Instant Form race for one PII-free permanent owner", async () => {
  const store = claimStore();
  const [website, instant] = await Promise.all([
    claimCanonicalLead(
      {
        environment: "production",
        canonicalEmail: "diver@example.com",
        acquisitionPath: "website",
        submissionId: "website-event-123",
        candidateRefCode: "web12345",
      },
      store.fetchImpl,
    ),
    claimCanonicalLead(
      {
        environment: "production",
        canonicalEmail: "diver@example.com",
        acquisitionPath: "instant_form",
        submissionId: "meta-lead-456",
        candidateRefCode: "meta1234",
      },
      store.fetchImpl,
    ),
  ]);

  assert.equal([website, instant].filter((claim) => claim.owner).length, 1);
  assert.equal(website.refCode, instant.refCode);
  assert.equal(store.calls.length, 2);
  assert.equal(store.calls[0]?.p_canonical_hash, store.calls[1]?.p_canonical_hash);
  assert.notEqual(store.calls[0]?.p_claimant_hash, store.calls[1]?.p_claimant_hash);
  const serialized = JSON.stringify(store.calls);
  assert.doesNotMatch(serialized, /diver@example\.com|website-event-123|meta-lead-456/);
  assert.match(String(store.calls[0]?.p_canonical_hash), /^[0-9a-f]{64}$/);
  assert.match(String(store.calls[0]?.p_claimant_hash), /^[0-9a-f]{64}$/);
});

test("the same submission recovers ownership while a historical master remains non-owner", async () => {
  const store = claimStore();
  const args = {
    environment: "production" as const,
    canonicalEmail: "retry@example.com",
    acquisitionPath: "website" as const,
    submissionId: "stable-event-id",
    candidateRefCode: "retry123",
  };

  assert.equal((await claimCanonicalLead(args, store.fetchImpl)).owner, true);
  assert.equal((await claimCanonicalLead(args, store.fetchImpl)).owner, true);

  const legacy = await claimCanonicalLead(
    {
      environment: "production",
      canonicalEmail: "legacy@example.com",
      acquisitionPath: "instant_form",
      submissionId: "new-meta-lead",
      candidateRefCode: "new12345",
      existingMaster: true,
      existingMasterRefCode: "old12345",
    },
    store.fetchImpl,
  );
  assert.deepEqual(legacy, {
    owner: false,
    refCode: "old12345",
    ownerAcquisitionPath: "existing",
  });
});

test("migration exposes a service-role-only hash claim with no PII columns", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260730130000_meta_lead_ingestion_state.sql", import.meta.url),
    "utf8",
  );
  const tableBlock = migration.match(
    /create table if not exists public\.canonical_lead_claims \([\s\S]*?\n\);/,
  )?.[0];

  assert.ok(tableBlock);
  assert.match(tableBlock, /primary key \(environment, canonical_hash\)/);
  assert.match(tableBlock, /canonical_hash text not null/);
  assert.match(tableBlock, /claimant_hash text not null/);
  assert.doesNotMatch(tableBlock, /\bemail\b|\bphone\b|full.?name|submission_id/i);
  assert.match(migration, /create or replace function public\.claim_canonical_lead_v1\(/);
  assert.match(
    migration,
    /revoke all on function public\.claim_canonical_lead_v1\([\s\S]*?\) from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.claim_canonical_lead_v1\([\s\S]*?\) to service_role;/,
  );
  assert.match(migration, /alter table public\.canonical_lead_claims enable row level security;/);
  assert.match(
    migration,
    /revoke all on public\.canonical_lead_claims from public, anon, authenticated;/,
  );
});
