import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, beforeEach, test } from "node:test";

import {
  completeMetaLeadIngestion,
  failMetaLeadIngestion,
  reserveMetaLeadIngestion,
} from "../src/lib/api/metaLeadIngestionReservation.server.ts";

const ORIGINAL_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeEach(() => {
  process.env.SUPABASE_URL = "https://measurement.supabase.test/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-only";
});

after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

type CoordinatorState = {
  generation: number;
  status: "absent" | "processing" | "complete" | "failed";
  outcome?: string;
  notionPageId?: string;
};

function coordinatorFetch(options?: { loseCompletionResponse?: boolean }): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const state: CoordinatorState = { generation: 0, status: "absent" };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let loseCompletionResponse = options?.loseCompletionResponse ?? false;

  const fetchImpl = (async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    if (url.endsWith("/reserve_meta_lead_ingestion_v1")) {
      if (state.status === "complete") {
        return Response.json({
          state: "complete",
          generation: state.generation,
          outcome: state.outcome,
          notion_page_id: state.notionPageId,
        });
      }
      if (state.status === "processing") {
        return Response.json({ state: "in_progress", generation: state.generation });
      }
      state.generation += 1;
      state.status = "processing";
      return Response.json({ state: "reserved", generation: state.generation });
    }

    if (url.endsWith("/complete_meta_lead_ingestion_v1")) {
      const fenced = state.status === "processing" && body.p_generation === state.generation;
      if (fenced) {
        state.status = "complete";
        state.outcome = String(body.p_outcome);
        state.notionPageId =
          typeof body.p_notion_page_id === "string" ? body.p_notion_page_id : undefined;
      }
      if (fenced && loseCompletionResponse) {
        loseCompletionResponse = false;
        throw new Error("simulated RPC response loss");
      }
      return Response.json(fenced);
    }

    if (url.endsWith("/fail_meta_lead_ingestion_v1")) {
      const fenced = state.status === "processing" && body.p_generation === state.generation;
      if (fenced) state.status = "failed";
      return Response.json(fenced);
    }

    return Response.json({}, { status: 404 });
  }) as typeof fetch;

  return { fetchImpl, calls };
}

const SCOPE = {
  environment: "production" as const,
  platformLeadId: "lead-123",
};

test("reservation moves through reserved, in_progress, and complete states", async () => {
  const coordinator = coordinatorFetch();

  assert.deepEqual(await reserveMetaLeadIngestion(SCOPE, coordinator.fetchImpl), {
    state: "reserved",
    generation: 1,
  });
  assert.deepEqual(await reserveMetaLeadIngestion(SCOPE, coordinator.fetchImpl), {
    state: "in_progress",
    generation: 1,
  });
  assert.equal(
    await completeMetaLeadIngestion(
      {
        ...SCOPE,
        generation: 1,
        outcome: "new",
        notionPageId: "11111111-1111-1111-1111-111111111111",
      },
      coordinator.fetchImpl,
    ),
    true,
  );
  assert.deepEqual(await reserveMetaLeadIngestion(SCOPE, coordinator.fetchImpl), {
    state: "complete",
    generation: 1,
    outcome: "new",
    notionPageId: "11111111-1111-1111-1111-111111111111",
  });

  for (const call of coordinator.calls) {
    assert.equal(call.url.startsWith("https://measurement.supabase.test/rest/v1/rpc/"), true);
    const headers = call.init?.headers as Record<string, string>;
    assert.equal(headers.apikey, "service-role-test-only");
    assert.equal(headers.Authorization, "Bearer service-role-test-only");
    assert.ok(call.init?.signal instanceof AbortSignal);
  }
  const serializedBodies = JSON.stringify(
    coordinator.calls.map((call) => JSON.parse(String(call.init?.body))),
  );
  assert.doesNotMatch(serializedBodies, /email|phone|full.?name|field_data/i);
});

test("failed work is immediately recoverable and stale generations are fenced", async () => {
  const coordinator = coordinatorFetch();
  const first = await reserveMetaLeadIngestion(SCOPE, coordinator.fetchImpl);
  assert.equal(first.state, "reserved");
  assert.equal(
    await failMetaLeadIngestion({ ...SCOPE, generation: first.generation }, coordinator.fetchImpl),
    true,
  );

  const recovered = await reserveMetaLeadIngestion(SCOPE, coordinator.fetchImpl);
  assert.deepEqual(recovered, { state: "reserved", generation: 2 });
  assert.equal(
    await completeMetaLeadIngestion(
      {
        ...SCOPE,
        generation: first.generation,
        outcome: "new",
        notionPageId: "11111111-1111-1111-1111-111111111111",
      },
      coordinator.fetchImpl,
    ),
    false,
  );
  assert.equal(
    await completeMetaLeadIngestion(
      {
        ...SCOPE,
        generation: recovered.generation,
        outcome: "new",
        notionPageId: "22222222-2222-2222-2222-222222222222",
      },
      coordinator.fetchImpl,
    ),
    true,
  );
});

test("a lost completion response is recovered by reading the durable complete state", async () => {
  const coordinator = coordinatorFetch({ loseCompletionResponse: true });
  const reservation = await reserveMetaLeadIngestion(SCOPE, coordinator.fetchImpl);
  assert.equal(reservation.state, "reserved");

  await assert.rejects(
    completeMetaLeadIngestion(
      {
        ...SCOPE,
        generation: reservation.generation,
        outcome: "duplicate",
        notionPageId: "33333333-3333-3333-3333-333333333333",
      },
      coordinator.fetchImpl,
    ),
    /simulated RPC response loss/,
  );

  assert.deepEqual(await reserveMetaLeadIngestion(SCOPE, coordinator.fetchImpl), {
    state: "complete",
    generation: 1,
    outcome: "duplicate",
    notionPageId: "33333333-3333-3333-3333-333333333333",
  });
});

test("invalid-email completion still requires and returns its quarantined CRM row", async () => {
  const coordinator = coordinatorFetch();
  const reservation = await reserveMetaLeadIngestion(SCOPE, coordinator.fetchImpl);
  assert.equal(reservation.state, "reserved");

  await assert.rejects(
    completeMetaLeadIngestion(
      {
        ...SCOPE,
        generation: reservation.generation,
        outcome: "invalid",
      },
      coordinator.fetchImpl,
    ),
    /Invalid Meta lead ingestion CRM reference/,
  );

  assert.equal(
    await completeMetaLeadIngestion(
      {
        ...SCOPE,
        generation: reservation.generation,
        outcome: "invalid",
        notionPageId: "44444444-4444-4444-4444-444444444444",
      },
      coordinator.fetchImpl,
    ),
    true,
  );
  assert.deepEqual(await reserveMetaLeadIngestion(SCOPE, coordinator.fetchImpl), {
    state: "complete",
    generation: 1,
    outcome: "invalid",
    notionPageId: "44444444-4444-4444-4444-444444444444",
  });
});

test("migration provides a private five-minute fenced lease through service-role RPCs", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260730130000_meta_lead_ingestion_state.sql", import.meta.url),
    "utf8",
  );
  const helper = await readFile(
    new URL("../src/lib/api/metaLeadIngestionReservation.server.ts", import.meta.url),
    "utf8",
  );
  const tableBlock = migration.match(
    /create table if not exists public\.meta_lead_ingestion_state \([\s\S]*?\n\);/,
  )?.[0];

  assert.ok(tableBlock);
  assert.match(tableBlock, /primary key \(environment, platform_lead_id\)/);
  assert.doesNotMatch(tableBlock, /email|phone|full.?name|field_data/i);
  assert.match(
    migration,
    /alter table public\.meta_lead_ingestion_state enable row level security;/,
  );
  assert.match(
    migration,
    /revoke all on public\.meta_lead_ingestion_state from public, anon, authenticated;/,
  );
  assert.match(migration, /interval '5 minutes'/);
  assert.match(tableBlock, /status = 'complete'[\s\S]*?notion_page_id is not null/);
  assert.match(migration, /if p_notion_page_id is null then/);
  assert.doesNotMatch(migration, /invalid leads cannot reference a CRM row/);
  assert.ok((migration.match(/pg_advisory_xact_lock/g) ?? []).length >= 3);

  for (const rpc of [
    "reserve_meta_lead_ingestion_v1",
    "complete_meta_lead_ingestion_v1",
    "fail_meta_lead_ingestion_v1",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${rpc}\\(`));
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${rpc}\\([\\s\\S]*?\\) from public, anon, authenticated;`,
      ),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*?\\) to service_role;`),
    );
  }
  assert.ok(
    (migration.match(/and generation = p_generation[\s\S]*?and status = 'processing'/g) ?? [])
      .length >= 2,
  );
  assert.match(helper, /const SUPABASE_RPC_TIMEOUT_MS = 5_000;/);
  assert.equal(
    (helper.match(/signal: AbortSignal\.timeout\(SUPABASE_RPC_TIMEOUT_MS\)/g) ?? []).length,
    1,
  );
});
