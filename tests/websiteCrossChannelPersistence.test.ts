import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { setCanonicalEmailShape } from "../src/lib/api/notionCanonicalEmail.ts";
import { handleJoinWaitlist } from "../src/lib/api/waitlist.functions.ts";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = {
  NOTION_API_KEY: process.env.NOTION_API_KEY,
  NOTION_WAITLIST_DB_ID: process.env.NOTION_WAITLIST_DB_ID,
  SIGNUP_RATE_LIMIT_HMAC_SECRET: process.env.SIGNUP_RATE_LIMIT_HMAC_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

beforeEach(() => {
  process.env.NOTION_API_KEY = "notion-key-for-test";
  process.env.NOTION_WAITLIST_DB_ID = "waitlist-db";
  process.env.SIGNUP_RATE_LIMIT_HMAC_SECRET = "website-cross-channel-claim-secret-at-least-32";
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "supabase-key-for-test";
  process.env.VERCEL_ENV = "development";
  setCanonicalEmailShape("email");
});

after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("Instant-to-Website preserves a separate non-counted website touchpoint and retry", async () => {
  const instantMaster = {
    id: "instant-master",
    properties: {
      Email: { title: [{ plain_text: "diver@example.com" }] },
      "Canonical email": { email: "diver@example.com" },
      "Lead ID": { rich_text: [{ plain_text: "meta-lead-123" }] },
      "Ref code": { rich_text: [{ plain_text: "master12" }] },
      Source: { select: { name: "instant-form" } },
      "Acquisition path": { select: { name: "instant_form" } },
      Duplicate: { checkbox: false },
      Counted: { checkbox: true },
      Suspect: { checkbox: false },
    },
  };
  let websiteTouchpoint:
    | {
        id: string;
        properties: Record<string, unknown>;
      }
    | undefined;
  let canonicalClaim:
    | {
        claimantHash: string;
        acquisitionPath: string;
        refCode: string;
      }
    | undefined;
  const notionCreates: Array<Record<string, unknown>> = [];
  const leadRows: Array<Record<string, unknown>> = [];
  const rpcBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : ({} as Record<string, unknown>);

    if (url.hostname === "api.notion.com") {
      if (url.pathname.endsWith("/databases/waitlist-db/query")) {
        const filter = JSON.stringify(body.filter ?? {});
        if (filter.includes('"Lead ID"')) {
          return Response.json({ results: websiteTouchpoint ? [websiteTouchpoint] : [] });
        }
        return Response.json({ results: [instantMaster] });
      }
      if (url.pathname.endsWith("/pages") && method === "POST") {
        const properties = body.properties as Record<string, unknown>;
        notionCreates.push(properties);
        websiteTouchpoint = { id: "website-duplicate", properties };
        return Response.json({ id: websiteTouchpoint.id });
      }
      return Response.json({}, { status: 404 });
    }

    if (url.hostname === "supabase.test") {
      if (url.pathname.endsWith("/rest/v1/rpc/claim_canonical_lead_v1")) {
        rpcBodies.push(body);
        canonicalClaim ??= {
          claimantHash: String(body.p_claimant_hash),
          acquisitionPath: String(body.p_acquisition_path),
          refCode: String(body.p_ref_code),
        };
        return Response.json({
          owner: canonicalClaim.claimantHash === body.p_claimant_hash,
          acquisition_path: canonicalClaim.acquisitionPath,
          ref_code: canonicalClaim.refCode,
        });
      }
      if (url.pathname.endsWith("/rest/v1/funnel_leads")) {
        leadRows.push(...(body as unknown as Array<Record<string, unknown>>));
        return new Response(null, { status: 201 });
      }
      if (url.pathname.endsWith("/rest/v1/funnel_events")) {
        return new Response(null, { status: 201 });
      }
      return Response.json({}, { status: 404 });
    }

    throw new Error(`Unexpected test request: ${url}`);
  }) as typeof fetch;

  const request = {
    email: "Diver@example.com",
    source: "hero" as const,
    eventId: "website-event-123",
    measurementConsent: false,
  };
  const first = await handleJoinWaitlist({ data: request });
  const retried = await handleJoinWaitlist({ data: request });

  assert.deepEqual(first, {
    ok: true,
    duplicate: true,
    refCode: "master12",
    metaEventId: undefined,
    metaPhoneEventId: undefined,
  });
  assert.deepEqual(retried, first);
  assert.equal(notionCreates.length, 1);
  assert.deepEqual(notionCreates[0]?.["Acquisition path"], {
    select: { name: "website" },
  });
  assert.deepEqual(notionCreates[0]?.Source, { select: { name: "hero" } });
  assert.deepEqual(notionCreates[0]?.Duplicate, { checkbox: true });
  assert.deepEqual(notionCreates[0]?.Counted, { checkbox: false });
  assert.deepEqual(instantMaster.properties.Counted, { checkbox: true });
  assert.equal(leadRows.length, 4);
  assert.equal(
    leadRows.every((row) => row.status === "duplicate" && row.valid === false),
    true,
  );
  assert.equal(leadRows.at(-1)?.notion_page_id, "website-duplicate");
  assert.equal(
    JSON.stringify(rpcBodies).includes("diver@example.com") ||
      JSON.stringify(rpcBodies).includes("website-event-123"),
    false,
  );
});
