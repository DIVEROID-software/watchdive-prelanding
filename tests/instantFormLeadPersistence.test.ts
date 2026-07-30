import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { setCanonicalEmailShape } from "../src/lib/api/notionCanonicalEmail.ts";
import {
  buildInstantFormNotionProperties,
  countableNotionLeadFilter,
  ingestInstantFormLead,
  type InstantFormLeadInput,
} from "../src/lib/api/waitlist.functions.ts";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = {
  NOTION_API_KEY: process.env.NOTION_API_KEY,
  NOTION_WAITLIST_DB_ID: process.env.NOTION_WAITLIST_DB_ID,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
  VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
};

const INSTANT_LEAD: InstantFormLeadInput = {
  platformLeadId: "lead-123",
  createdTime: "2026-07-29T09:00:00.000Z",
  email: "Diver@Example.com",
  phone: "+1 202 555 0100",
  fullName: "Ocean Diver",
  formId: "form-123",
  pageId: "page-123",
  publisherPlatform: "instagram",
  country: "us",
  campaignId: "campaign-123",
  campaignName: "Campaign",
  adSetId: "adset-123",
  adSetName: "Ad set",
  adId: "ad-123",
  adName: "Creative",
};

type FetchScenario = {
  notionCalls: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }>;
  leadRows: Array<Record<string, unknown>>;
  eventRows: Array<Record<string, unknown>>;
  rpcCalls: Array<{
    path: string;
    body: Record<string, unknown>;
  }>;
};

function responsePage(id: string, properties: Record<string, unknown>): Record<string, unknown> {
  return { id, properties };
}

function mockPersistence(args: {
  platformResults?: Array<Record<string, unknown>>;
  canonicalResults?: Array<Record<string, unknown>>;
  createdPageId?: string;
  failFirstNotionCreate?: boolean;
  loseFirstNotionCreateResponse?: boolean;
  failFirstFunnelLeadWrite?: boolean;
  loseFirstCompletionResponse?: boolean;
}): FetchScenario {
  const notionCalls: FetchScenario["notionCalls"] = [];
  const leadRows: FetchScenario["leadRows"] = [];
  const eventRows: FetchScenario["eventRows"] = [];
  const rpcCalls: FetchScenario["rpcCalls"] = [];
  let generation = 0;
  let reservationStatus: "absent" | "processing" | "complete" | "failed" = "absent";
  let completedOutcome: string | undefined;
  let completedPageId: string | undefined;
  let recoveredPlatformPage: Record<string, unknown> | undefined;
  let notionCreateAttempts = 0;
  let funnelLeadWriteAttempts = 0;
  let loseCompletionResponse = args.loseFirstCompletionResponse ?? false;

  globalThis.fetch = (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : ({} as Record<string, unknown>);

    if (url.hostname === "api.notion.com") {
      notionCalls.push({ path: url.pathname, method, body });
      if (url.pathname.endsWith("/databases/waitlist-db/query")) {
        const filter = body.filter;
        const filterJson = JSON.stringify(filter ?? {});
        return Response.json({
          results: filterJson.includes('"Meta Platform Lead ID"')
            ? (args.platformResults ?? (recoveredPlatformPage ? [recoveredPlatformPage] : []))
            : (args.canonicalResults ?? []),
        });
      }
      if (url.pathname.endsWith("/pages") && method === "POST") {
        notionCreateAttempts += 1;
        if (args.failFirstNotionCreate && notionCreateAttempts === 1) {
          return Response.json({}, { status: 503 });
        }
        const createdPageId = args.createdPageId ?? "created-page";
        if (args.loseFirstNotionCreateResponse && notionCreateAttempts === 1) {
          recoveredPlatformPage = responsePage(
            createdPageId,
            (body.properties as Record<string, unknown> | undefined) ?? {},
          );
          throw new Error("simulated Notion create response loss");
        }
        return Response.json({ id: createdPageId });
      }
      if (url.pathname.includes("/pages/") && method === "PATCH") {
        return Response.json({ id: url.pathname.split("/").at(-1) });
      }
      return Response.json({}, { status: 404 });
    }

    if (url.hostname === "supabase.test") {
      if (url.pathname.includes("/rest/v1/rpc/")) {
        rpcCalls.push({ path: url.pathname, body });
        if (url.pathname.endsWith("/reserve_meta_lead_ingestion_v1")) {
          if (reservationStatus === "complete") {
            return Response.json({
              state: "complete",
              generation,
              outcome: completedOutcome,
              notion_page_id: completedPageId,
            });
          }
          if (reservationStatus === "processing") {
            return Response.json({ state: "in_progress", generation });
          }
          generation += 1;
          reservationStatus = "processing";
          return Response.json({ state: "reserved", generation });
        }
        if (url.pathname.endsWith("/complete_meta_lead_ingestion_v1")) {
          const fenced = reservationStatus === "processing" && body.p_generation === generation;
          if (fenced) {
            reservationStatus = "complete";
            completedOutcome = String(body.p_outcome);
            completedPageId =
              typeof body.p_notion_page_id === "string" ? body.p_notion_page_id : undefined;
          }
          if (fenced && loseCompletionResponse) {
            loseCompletionResponse = false;
            throw new Error("simulated completion response loss");
          }
          return Response.json(fenced);
        }
        if (url.pathname.endsWith("/fail_meta_lead_ingestion_v1")) {
          const fenced = reservationStatus === "processing" && body.p_generation === generation;
          if (fenced) reservationStatus = "failed";
          return Response.json(fenced);
        }
        return Response.json({}, { status: 404 });
      }
      const rows = Array.isArray(body) ? body : [];
      if (url.pathname.endsWith("/funnel_leads")) {
        leadRows.push(...(rows as Array<Record<string, unknown>>));
        funnelLeadWriteAttempts += 1;
        if (args.failFirstFunnelLeadWrite && funnelLeadWriteAttempts === 1) {
          return Response.json({}, { status: 503 });
        }
      } else if (url.pathname.endsWith("/funnel_events")) {
        eventRows.push(...(rows as Array<Record<string, unknown>>));
      }
      return new Response(null, { status: 201 });
    }

    throw new Error(`Unexpected test request: ${url.toString()}`);
  }) as typeof fetch;

  return { notionCalls, leadRows, eventRows, rpcCalls };
}

function createdProperties(scenario: FetchScenario): Record<string, unknown> {
  const createCall = scenario.notionCalls.find(
    (call) => call.path.endsWith("/pages") && call.method === "POST",
  );
  assert.ok(createCall, "expected an Instant Form Notion page create");
  return createCall.body.properties as Record<string, unknown>;
}

beforeEach(() => {
  process.env.NOTION_API_KEY = "notion-key-for-test";
  process.env.NOTION_WAITLIST_DB_ID = "waitlist-db";
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "supabase-key-for-test";
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_DEPLOYMENT_ID = "deployment-123";
  process.env.VERCEL_GIT_COMMIT_SHA = "commit-123";
  setCanonicalEmailShape("email");
});

after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("a unique Instant Form lead creates one countable native-form row with source fields", async () => {
  const scenario = mockPersistence({ createdPageId: "instant-unique" });

  const result = await ingestInstantFormLead(INSTANT_LEAD);

  assert.deepEqual(result, {
    ok: true,
    status: "new",
    notionPageId: "instant-unique",
  });
  const properties = createdProperties(scenario);
  assert.deepEqual(properties["Acquisition path"], { select: { name: "instant_form" } });
  assert.deepEqual(properties.Source, { select: { name: "instant-form" } });
  assert.deepEqual(properties.Duplicate, { checkbox: false });
  assert.deepEqual(properties.Counted, { checkbox: true });
  assert.deepEqual(properties["Meta Platform Lead ID"], {
    rich_text: [{ text: { content: "lead-123" } }],
  });
  assert.deepEqual(properties["Meta Form ID"], {
    rich_text: [{ text: { content: "form-123" } }],
  });
  assert.deepEqual(properties["Meta Page ID"], {
    rich_text: [{ text: { content: "page-123" } }],
  });
  assert.deepEqual(properties["Meta Campaign ID"], {
    rich_text: [{ text: { content: "campaign-123" } }],
  });
  assert.deepEqual(properties["Meta Ad Set ID"], {
    rich_text: [{ text: { content: "adset-123" } }],
  });
  assert.deepEqual(properties["Meta Ad ID"], {
    rich_text: [{ text: { content: "ad-123" } }],
  });
  assert.deepEqual(properties["Publisher platform"], {
    rich_text: [{ text: { content: "instagram" } }],
  });
  assert.deepEqual(properties.Placement, {
    rich_text: [{ text: { content: "instant_form" } }],
  });
  assert.deepEqual(properties.Country, {
    rich_text: [{ text: { content: "US" } }],
  });

  assert.equal(scenario.leadRows.length, 1);
  assert.equal(scenario.leadRows[0]?.acquisition_path, "instant_form");
  assert.equal(scenario.leadRows[0]?.source, "instant-form");
  assert.equal(scenario.leadRows[0]?.status, "new");
  assert.equal(scenario.leadRows[0]?.valid, true);
});

test("a website canonical lead stays unchanged while a full Instant Form duplicate row is added", async () => {
  const websiteMaster = responsePage("website-master", {
    Email: { title: [{ plain_text: "diver@example.com" }] },
    "Canonical email": { email: "diver@example.com" },
    Source: { select: { name: "hero" } },
    "Acquisition path": { select: { name: "website" } },
    Duplicate: { checkbox: false },
    Counted: { checkbox: true },
  });
  const originalMaster = structuredClone(websiteMaster);
  const scenario = mockPersistence({
    canonicalResults: [websiteMaster],
    createdPageId: "instant-duplicate",
  });

  const result = await ingestInstantFormLead(INSTANT_LEAD);

  assert.deepEqual(result, {
    ok: true,
    status: "duplicate",
    notionPageId: "instant-duplicate",
  });
  assert.deepEqual(websiteMaster, originalMaster);
  assert.equal(
    scenario.notionCalls.some((call) => call.method === "PATCH"),
    false,
    "the website master must not receive Meta fields",
  );

  const canonicalQuery = scenario.notionCalls.find((call) => {
    return (
      call.path.endsWith("/query") &&
      !JSON.stringify(call.body.filter ?? {}).includes('"Meta Platform Lead ID"')
    );
  });
  assert.ok(canonicalQuery);
  assert.deepEqual(canonicalQuery.body.filter, {
    and: [
      {
        or: [
          {
            property: "Canonical email",
            email: { equals: "diver@example.com" },
          },
          {
            property: "Email",
            title: { equals: "diver@example.com" },
          },
        ],
      },
      { property: "Duplicate", checkbox: { equals: false } },
    ],
  });

  const properties = createdProperties(scenario);
  assert.deepEqual(properties["Acquisition path"], { select: { name: "instant_form" } });
  assert.deepEqual(properties.Source, { select: { name: "instant-form" } });
  assert.deepEqual(properties.Duplicate, { checkbox: true });
  assert.deepEqual(properties.Counted, { checkbox: false });
  for (const property of [
    "Meta Platform Lead ID",
    "Meta Form ID",
    "Meta Page ID",
    "Meta Campaign ID",
    "Meta Ad Set ID",
    "Meta Ad ID",
    "Publisher platform",
    "Placement",
    "Country",
  ]) {
    assert.ok(properties[property], `expected duplicate row to preserve ${property}`);
  }

  assert.equal(scenario.leadRows.length, 1);
  assert.equal(scenario.leadRows[0]?.notion_page_id, "instant-duplicate");
  assert.equal(scenario.leadRows[0]?.status, "duplicate");
  assert.equal(scenario.leadRows[0]?.valid, false);
});

test("a Platform Lead ID retry reuses its duplicate Instant row and remains non-valid", async () => {
  const scenario = mockPersistence({
    platformResults: [
      responsePage("instant-duplicate", {
        Source: { select: { name: "instant-form" } },
        "Acquisition path": { select: { name: "instant_form" } },
        "Meta Page ID": { rich_text: [{ plain_text: "page-123" }] },
        Duplicate: { checkbox: true },
        Counted: { checkbox: false },
        Suspect: { checkbox: false },
        Flags: { multi_select: [] },
      }),
    ],
  });

  const result = await ingestInstantFormLead(INSTANT_LEAD);

  assert.deepEqual(result, {
    ok: true,
    status: "duplicate",
    notionPageId: "instant-duplicate",
  });
  assert.equal(
    scenario.notionCalls.some((call) => call.path.endsWith("/pages") && call.method === "POST"),
    false,
  );
  const platformQuery = scenario.notionCalls.find((call) => call.path.endsWith("/query"));
  assert.ok(platformQuery);
  assert.deepEqual(platformQuery.body.filter, {
    and: [
      {
        property: "Meta Platform Lead ID",
        rich_text: { equals: "lead-123" },
      },
      {
        or: [
          {
            property: "Acquisition path",
            select: { equals: "instant_form" },
          },
          {
            property: "Source",
            select: { equals: "instant-form" },
          },
        ],
      },
    ],
  });
  const enrichmentPatch = scenario.notionCalls.find(
    (call) => call.path.endsWith("/pages/instant-duplicate") && call.method === "PATCH",
  );
  assert.ok(enrichmentPatch);
  const patchedProperties = enrichmentPatch.body.properties as Record<string, unknown>;
  for (const property of [
    "Meta Platform Lead ID",
    "Meta Form ID",
    "Meta Page ID",
    "Meta Campaign ID",
    "Meta Ad Set ID",
    "Meta Ad ID",
    "Publisher platform",
    "Placement",
    "Country",
    "Attribution status",
    "Source coverage",
  ]) {
    assert.ok(patchedProperties[property], `expected retry to enrich ${property}`);
  }
  assert.equal(
    scenario.notionCalls.filter((call) => call.path.endsWith("/query")).length,
    1,
    "the Platform Lead ID hit must short-circuit canonical lookup",
  );
  assert.equal(scenario.leadRows.length, 1);
  assert.equal(scenario.leadRows[0]?.acquisition_path, "instant_form");
  assert.equal(scenario.leadRows[0]?.source, "instant-form");
  assert.equal(scenario.leadRows[0]?.status, "duplicate");
  assert.equal(scenario.leadRows[0]?.valid, false);
  assert.equal(scenario.eventRows.length, 2);
  assert.equal(scenario.eventRows[0]?.acquisition_path, "instant_form");
  assert.equal(scenario.eventRows[0]?.source, "instant-form");
  assert.deepEqual(scenario.eventRows[0]?.properties, {
    valid: false,
    status: "duplicate",
  });
});

test("concurrent deliveries allow only one Instant Form Notion creator", async () => {
  const scenario = mockPersistence({ createdPageId: "instant-concurrent" });

  const results = await Promise.allSettled([
    ingestInstantFormLead(INSTANT_LEAD),
    ingestInstantFormLead(INSTANT_LEAD),
  ]);

  assert.equal(
    scenario.notionCalls.filter((call) => call.path.endsWith("/pages") && call.method === "POST")
      .length,
    1,
  );
  assert.equal(
    scenario.rpcCalls.filter((call) => call.path.endsWith("/complete_meta_lead_ingestion_v1"))
      .length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled" && result.value.status === "new")
      .length,
    1,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof Error &&
        result.reason.message === "Meta lead ingestion is already in progress",
    ).length,
    1,
  );
});

test("a failed creator releases its fenced generation for an immediate retry", async () => {
  const scenario = mockPersistence({
    createdPageId: "instant-recovered",
    failFirstNotionCreate: true,
  });

  await assert.rejects(ingestInstantFormLead(INSTANT_LEAD), /Notion pages failed \(503\)/);
  const recovered = await ingestInstantFormLead(INSTANT_LEAD);

  assert.deepEqual(recovered, {
    ok: true,
    status: "new",
    notionPageId: "instant-recovered",
  });
  const reserveCalls = scenario.rpcCalls.filter((call) =>
    call.path.endsWith("/reserve_meta_lead_ingestion_v1"),
  );
  assert.equal(reserveCalls.length, 2);
  assert.equal(
    scenario.rpcCalls.filter((call) => call.path.endsWith("/fail_meta_lead_ingestion_v1")).length,
    1,
  );
  const completeCall = scenario.rpcCalls.find((call) =>
    call.path.endsWith("/complete_meta_lead_ingestion_v1"),
  );
  assert.equal(completeCall?.body.p_generation, 2);
});

test("a lost Notion create response is recovered by query-first retry without another creator", async () => {
  const scenario = mockPersistence({
    createdPageId: "instant-notion-response-loss",
    loseFirstNotionCreateResponse: true,
  });

  await assert.rejects(
    ingestInstantFormLead(INSTANT_LEAD),
    /simulated Notion create response loss/,
  );
  const recovered = await ingestInstantFormLead(INSTANT_LEAD);

  assert.deepEqual(recovered, {
    ok: true,
    status: "new",
    notionPageId: "instant-notion-response-loss",
  });
  assert.equal(
    scenario.notionCalls.filter((call) => call.path.endsWith("/pages") && call.method === "POST")
      .length,
    1,
  );
  assert.ok(
    scenario.notionCalls.some(
      (call) =>
        call.path.endsWith("/pages/instant-notion-response-loss") && call.method === "PATCH",
    ),
  );
  const completeCall = scenario.rpcCalls.find((call) =>
    call.path.endsWith("/complete_meta_lead_ingestion_v1"),
  );
  assert.equal(completeCall?.body.p_generation, 2);
});

test("a lost completion response recovers from complete state without a second creator", async () => {
  const scenario = mockPersistence({
    createdPageId: "instant-response-loss",
    loseFirstCompletionResponse: true,
  });

  await assert.rejects(ingestInstantFormLead(INSTANT_LEAD), /simulated completion response loss/);
  const recovered = await ingestInstantFormLead(INSTANT_LEAD);

  assert.deepEqual(recovered, {
    ok: true,
    status: "new",
    notionPageId: "instant-response-loss",
  });
  assert.equal(
    scenario.notionCalls.filter((call) => call.path.endsWith("/pages") && call.method === "POST")
      .length,
    1,
  );
  assert.ok(
    scenario.notionCalls.some(
      (call) => call.path.endsWith("/pages/instant-response-loss") && call.method === "PATCH",
    ),
  );
  const serializedRpcBodies = JSON.stringify(scenario.rpcCalls.map((call) => call.body));
  for (const submittedValue of ["diver@example.com", "+1 202 555 0100", "Ocean Diver"]) {
    assert.equal(serializedRpcBodies.includes(submittedValue), false);
  }
});

test("a funnel failure after completion retries measurement without another Notion creator", async () => {
  const scenario = mockPersistence({
    createdPageId: "instant-funnel-recovery",
    failFirstFunnelLeadWrite: true,
  });

  await assert.rejects(
    ingestInstantFormLead(INSTANT_LEAD),
    /Instant Form lead outcome storage is unavailable/,
  );
  const recovered = await ingestInstantFormLead(INSTANT_LEAD);

  assert.deepEqual(recovered, {
    ok: true,
    status: "new",
    notionPageId: "instant-funnel-recovery",
  });
  assert.equal(
    scenario.notionCalls.filter((call) => call.path.endsWith("/pages") && call.method === "POST")
      .length,
    1,
  );
  assert.equal(
    scenario.notionCalls.filter(
      (call) => call.path.endsWith("/pages/instant-funnel-recovery") && call.method === "PATCH",
    ).length,
    1,
  );
  assert.equal(
    scenario.rpcCalls.filter((call) => call.path.endsWith("/reserve_meta_lead_ingestion_v1"))
      .length,
    2,
  );
  assert.equal(
    scenario.rpcCalls.filter((call) => call.path.endsWith("/complete_meta_lead_ingestion_v1"))
      .length,
    1,
  );
  assert.equal(scenario.leadRows.length, 2);
  assert.equal(scenario.eventRows.length, 2);
});

test("unique suspect rows and all duplicates are excluded from public and referral counts", () => {
  const suspectProperties = buildInstantFormNotionProperties({
    data: INSTANT_LEAD,
    email: "diver@example.com",
    canonical: "diver@example.com",
    signedUpAt: "2026-07-29T09:00:00.000Z",
    refCode: "abcdefgh",
    flags: ["disposable"],
    suspect: true,
    duplicate: false,
  });
  assert.deepEqual(suspectProperties.Duplicate, { checkbox: false });
  assert.deepEqual(suspectProperties.Counted, { checkbox: false });

  assert.deepEqual(countableNotionLeadFilter(), {
    and: [
      { property: "Suspect", checkbox: { equals: false } },
      { property: "Duplicate", checkbox: { equals: false } },
    ],
  });
  assert.deepEqual(
    countableNotionLeadFilter([{ property: "Referred by", rich_text: { equals: "abcdefgh" } }]),
    {
      and: [
        { property: "Referred by", rich_text: { equals: "abcdefgh" } },
        { property: "Suspect", checkbox: { equals: false } },
        { property: "Duplicate", checkbox: { equals: false } },
      ],
    },
  );
});
