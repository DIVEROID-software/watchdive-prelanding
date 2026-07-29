import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import {
  enumerateInsightDates,
  normalizedInsight,
  reserveMetaInsightsSync,
  replaceMetaInsightsRange,
  syncMetaInsights,
} from "../src/lib/api/metaInsights.server.ts";

const ORIGINAL_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  META_MARKETING_ACCESS_TOKEN: process.env.META_MARKETING_ACCESS_TOKEN,
  META_AD_ACCOUNT_ID: process.env.META_AD_ACCOUNT_ID,
  META_CAMPAIGN_IDS: process.env.META_CAMPAIGN_IDS,
  META_WEBSITE_CAMPAIGN_IDS: process.env.META_WEBSITE_CAMPAIGN_IDS,
  META_INSTANT_FORM_CAMPAIGN_IDS: process.env.META_INSTANT_FORM_CAMPAIGN_IDS,
  META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
};

let nextReservationGeneration = 100;

function metaSyncControlResponse(url: URL): Response | null {
  if (
    url.hostname === "measurement.supabase.co" &&
    url.pathname.endsWith("/rpc/reserve_meta_insights_sync_v2")
  ) {
    const generation = nextReservationGeneration;
    nextReservationGeneration += 1;
    return Response.json({
      generation,
      reserved_at: `2026-07-29T08:00:${String(generation % 60).padStart(2, "0")}.000Z`,
    });
  }
  if (
    url.hostname === "measurement.supabase.co" &&
    url.pathname.endsWith("/rpc/fail_meta_insights_sync")
  ) {
    return Response.json(true);
  }
  return null;
}

beforeEach(() => {
  nextReservationGeneration = 100;
  process.env.SUPABASE_URL = "https://measurement.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-only";
  process.env.META_MARKETING_ACCESS_TOKEN = "marketing-token-test-only";
  process.env.META_AD_ACCOUNT_ID = "727396218766985";
  process.env.META_CAMPAIGN_IDS = "120251217895480717";
  process.env.META_WEBSITE_CAMPAIGN_IDS = "120251217895480717";
  process.env.META_INSTANT_FORM_CAMPAIGN_IDS = "";
  process.env.META_GRAPH_API_VERSION = "v21.0";
});

after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("enumerates an inclusive bounded date range", () => {
  assert.deepEqual(enumerateInsightDates("2026-07-28", "2026-07-30"), [
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
  ]);
  assert.throws(() => enumerateInsightDates("2026-07-30", "2026-07-28"));
  assert.throws(() => enumerateInsightDates("2026-01-01", "2026-07-30"));
});

test("replaces a complete campaign and date range with one storage request", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  await replaceMetaInsightsRange(
    {
      accountId: "727396218766985",
      campaignIds: ["120251250561470717", "120251217895480717"],
      from: "2026-07-28",
      to: "2026-07-29",
      rows: [],
      generation: 7,
      exactRange: {
        accountId: "727396218766985",
        campaignIds: ["120251217895480717", "120251250561470717"],
        from: "2026-07-28",
        to: "2026-07-29",
        impressions: 0,
        reach: 0,
        frequency: 0,
        spendEur: 0,
        linkClicks: 0,
        cpm: null,
        linkCtr: null,
        linkCpc: null,
        generation: 7,
        syncedAt: "2026-07-29T08:00:00.000Z",
      },
    },
    async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(null, { status: 204 });
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.url,
    "https://measurement.supabase.co/rest/v1/rpc/replace_meta_insights_range",
  );
  assert.deepEqual(calls[0]?.body, {
    p_account_id: "727396218766985",
    p_campaign_ids: ["120251217895480717", "120251250561470717"],
    p_from: "2026-07-28",
    p_to: "2026-07-29",
    p_rows: [],
    p_exact_impressions: 0,
    p_exact_reach: 0,
    p_exact_frequency: 0,
    p_exact_spend_eur: 0,
    p_exact_link_clicks: 0,
    p_generation: 7,
  });
});

test("rejects an empty daily range paired with a nonzero exact marker", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      replaceMetaInsightsRange(
        {
          accountId: "727396218766985",
          campaignIds: ["120251217895480717"],
          from: "2026-07-28",
          to: "2026-07-29",
          rows: [],
          generation: 8,
          exactRange: {
            accountId: "727396218766985",
            campaignIds: ["120251217895480717"],
            from: "2026-07-28",
            to: "2026-07-29",
            impressions: 1,
            reach: 1,
            frequency: 1,
            spendEur: 0.01,
            linkClicks: 1,
            cpm: 10,
            linkCtr: 100,
            linkCpc: 0.01,
            generation: 8,
            syncedAt: "2026-07-29T08:00:00.000Z",
          },
        },
        async () => {
          calls += 1;
          return new Response(null, { status: 204 });
        },
      ),
    /empty Meta daily range conflicts with nonzero exact-range metrics/i,
  );
  assert.equal(calls, 0);
});

test("rejects an out-of-range row before the range RPC is called", async () => {
  let calls = 0;
  await assert.rejects(() =>
    replaceMetaInsightsRange(
      {
        accountId: "727396218766985",
        campaignIds: ["120251217895480717"],
        from: "2026-07-28",
        to: "2026-07-29",
        generation: 7,
        rows: [
          {
            account_id: "727396218766985",
            campaign_id: "120251217895480717",
            insight_date: "2026-07-30",
          },
        ],
        exactRange: {
          accountId: "727396218766985",
          campaignIds: ["120251217895480717"],
          from: "2026-07-28",
          to: "2026-07-29",
          impressions: 0,
          reach: 0,
          frequency: 0,
          spendEur: 0,
          linkClicks: 0,
          cpm: null,
          linkCtr: null,
          linkCpc: null,
          generation: 7,
          syncedAt: "2026-07-29T08:00:00.000Z",
        },
      },
      async () => {
        calls += 1;
        return new Response(null, { status: 204 });
      },
    ),
  );
  assert.equal(calls, 0);
});

test("normalizes Meta video actions into typed additive daily metrics", () => {
  const normalized = normalizedInsight(
    {
      account_id: "727396218766985",
      campaign_id: "120251217895480717",
      adset_id: "120251217895480718",
      ad_id: "120251217895480719",
      date_start: "2026-07-29",
      country: "us",
      publisher_platform: "instagram",
      platform_position: "story",
      actions: [
        { action_type: "video_view", value: "91" },
        { action_type: "landing_page_view", value: "12" },
        { action_type: "offsite_conversion.fb_pixel_contact", value: "7" },
      ],
      video_thruplay_watched_actions: [{ action_type: "video_view", value: "44" }],
      video_p25_watched_actions: [{ action_type: "video_view", value: "82" }],
      video_p50_watched_actions: [{ action_type: "video_view", value: "66" }],
      video_p75_watched_actions: [{ action_type: "video_view", value: "53" }],
      video_p95_watched_actions: [{ action_type: "video_view", value: "39" }],
      video_p100_watched_actions: [{ action_type: "video_view", value: "35" }],
    },
    "2026-07-29T08:00:00.000Z",
    "website",
    7,
  );

  assert.ok(normalized);
  assert.equal(normalized.website_contacts, 7);
  assert.equal(normalized.video_3s, 91);
  assert.equal(normalized.video_thruplay, 44);
  assert.equal(normalized.video_25, 82);
  assert.equal(normalized.video_50, 66);
  assert.equal(normalized.video_75, 53);
  assert.equal(normalized.video_95, 39);
  assert.equal(normalized.video_100, 35);
  assert.equal(normalized.sync_generation, 7);
});

test("reserves a canonical database generation with a bounded service RPC", async () => {
  let request:
    | {
        url: string;
        body: Record<string, unknown>;
        signal: AbortSignal | null | undefined;
      }
    | undefined;
  const reservation = await reserveMetaInsightsSync(
    "727396218766985",
    ["120251250561470717", "120251217895480717"],
    "2026-07-28",
    "2026-07-29",
    async (input, init) => {
      request = {
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        signal: init?.signal,
      };
      return Response.json({
        generation: 42,
        reserved_at: "2026-07-29T08:00:00.000Z",
      });
    },
  );

  assert.deepEqual(reservation, {
    generation: 42,
    reservedAt: "2026-07-29T08:00:00.000Z",
    state: "reserved",
  });
  assert.equal(
    request?.url,
    "https://measurement.supabase.co/rest/v1/rpc/reserve_meta_insights_sync_v2",
  );
  assert.deepEqual(request?.body, {
    p_account_id: "727396218766985",
    p_campaign_ids: ["120251217895480717", "120251250561470717"],
    p_from: "2026-07-28",
    p_to: "2026-07-29",
  });
  assert.ok(request?.signal instanceof AbortSignal);
});

test("reuses a fresh database generation without calling Meta Graph", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());
    if (url.pathname.endsWith("/rpc/reserve_meta_insights_sync_v2")) {
      return Response.json({
        generation: 43,
        reserved_at: "2026-07-29T08:01:00.000Z",
        state: "ready",
      });
    }
    throw new Error(`Unexpected request after a fresh reservation: ${url}`);
  }) as typeof fetch;

  try {
    assert.deepEqual(await syncMetaInsights("2026-07-29", "2026-07-29"), {
      configured: true,
      ok: true,
      rows: 0,
      source: "cache",
      generation: 43,
    });
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0] ?? "", /reserve_meta_insights_sync_v2$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not duplicate an in-progress cross-replica Meta refresh", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());
    if (url.pathname.endsWith("/rpc/reserve_meta_insights_sync_v2")) {
      return Response.json({
        generation: 44,
        reserved_at: "2026-07-29T08:02:00.000Z",
        state: "in_progress",
      });
    }
    throw new Error(`Unexpected request during an active reservation: ${url}`);
  }) as typeof fetch;

  try {
    assert.deepEqual(await syncMetaInsights("2026-07-30", "2026-07-30"), {
      configured: true,
      ok: false,
      rows: 0,
      reason: "sync_in_progress",
      generation: 44,
    });
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0] ?? "", /reserve_meta_insights_sync_v2$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an account-level in-progress reservation blocks a different-range Graph request", async () => {
  const originalFetch = globalThis.fetch;
  let releaseFirstAccount: (() => void) | undefined;
  let signalFirstAccount: (() => void) | undefined;
  let firstReservationActive = false;
  let accountCalls = 0;
  let insightCalls = 0;
  const firstAccountReached = new Promise<void>((resolve) => {
    signalFirstAccount = resolve;
  });

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/rpc/reserve_meta_insights_sync_v2")) {
      const body = JSON.parse(String(init?.body)) as { p_from?: string };
      if (body.p_from === "2026-07-30") {
        firstReservationActive = true;
        return Response.json({
          generation: 45,
          reserved_at: "2026-07-29T08:03:00.000Z",
          state: "reserved",
        });
      }
      assert.equal(body.p_from, "2026-07-31");
      assert.equal(firstReservationActive, true);
      return Response.json({
        generation: 45,
        reserved_at: "2026-07-29T08:03:00.000Z",
        state: "in_progress",
      });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/act_727396218766985")) {
      accountCalls += 1;
      signalFirstAccount?.();
      return new Promise<Response>((resolve) => {
        releaseFirstAccount = () => resolve(Response.json({ currency: "EUR" }));
      });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/insights")) {
      insightCalls += 1;
      return Response.json({ data: [] });
    }
    if (url.pathname.endsWith("/rpc/replace_meta_insights_range")) {
      firstReservationActive = false;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const first = syncMetaInsights("2026-07-30", "2026-07-30");
    await firstAccountReached;
    const second = await syncMetaInsights("2026-07-31", "2026-07-31");
    assert.deepEqual(second, {
      configured: true,
      ok: false,
      rows: 0,
      reason: "sync_in_progress",
      generation: 45,
    });
    assert.equal(accountCalls, 1);
    assert.equal(insightCalls, 0);

    releaseFirstAccount?.();
    assert.equal((await first).ok, true);
    assert.equal(insightCalls, 2);
  } finally {
    releaseFirstAccount?.();
    globalThis.fetch = originalFetch;
  }
});

test("empty Graph results atomically replace the complete requested range", async () => {
  const originalFetch = globalThis.fetch;
  const rpcBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const control = metaSyncControlResponse(url);
    if (control) return control;
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/act_727396218766985")) {
      return Response.json({ currency: "EUR" });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/insights")) {
      return Response.json({ data: [] });
    }
    if (
      url.hostname === "measurement.supabase.co" &&
      url.pathname.endsWith("/rpc/replace_meta_insights_range")
    ) {
      rpcBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const result = await syncMetaInsights("2026-07-28", "2026-07-29");
    assert.equal(result.configured, true);
    assert.equal(result.ok, true);
    assert.equal(result.rows, 0);
    assert.deepEqual(result.exactRange, {
      accountId: "727396218766985",
      campaignIds: ["120251217895480717"],
      from: "2026-07-28",
      to: "2026-07-29",
      impressions: 0,
      reach: 0,
      frequency: 0,
      spendEur: 0,
      linkClicks: 0,
      cpm: null,
      linkCtr: null,
      linkCpc: null,
      generation: result.generation,
      syncedAt: result.exactRange?.syncedAt,
    });
    assert.equal(rpcBodies.length, 1);
    assert.equal(rpcBodies[0]?.p_from, "2026-07-28");
    assert.equal(rpcBodies[0]?.p_to, "2026-07-29");
    assert.deepEqual(rpcBodies[0]?.p_rows, []);
    assert.equal(rpcBodies[0]?.p_exact_reach, 0);
    assert.equal(rpcBodies[0]?.p_exact_frequency, 0);
    assert.equal(rpcBodies[0]?.p_generation, result.generation);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses a no-breakdown exact-range query and persists typed video metrics", async () => {
  const originalFetch = globalThis.fetch;
  let dailyInsightsUrl: URL | undefined;
  let exactInsightsUrl: URL | undefined;
  let dailyRow: Record<string, unknown> | undefined;
  let rangeBody: Record<string, unknown> | undefined;

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const control = metaSyncControlResponse(url);
    if (control) return control;
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/act_727396218766985")) {
      return Response.json({ currency: "EUR" });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/insights")) {
      if (url.searchParams.has("time_increment")) {
        dailyInsightsUrl = url;
        return Response.json({
          data: [
            {
              account_id: "727396218766985",
              campaign_id: "120251217895480717",
              adset_id: "120251217895480718",
              ad_id: "120251217895480719",
              date_start: "2026-08-01",
              country: "us",
              publisher_platform: "instagram",
              platform_position: "story",
              impressions: "1000",
              reach: "800",
              spend: "20",
              inline_link_clicks: "100",
              actions: [
                { action_type: "video_view", value: "90" },
                { action_type: "offsite_conversion.contact", value: "6" },
              ],
              video_thruplay_watched_actions: [{ action_type: "video_view", value: "44" }],
              video_p25_watched_actions: [{ action_type: "video_view", value: "82" }],
              video_p50_watched_actions: [{ action_type: "video_view", value: "66" }],
              video_p75_watched_actions: [{ action_type: "video_view", value: "53" }],
              video_p95_watched_actions: [{ action_type: "video_view", value: "39" }],
              video_p100_watched_actions: [{ action_type: "video_view", value: "35" }],
            },
          ],
        });
      }
      exactInsightsUrl = url;
      return Response.json({
        data: [
          {
            account_id: "727396218766985",
            date_start: "2026-08-01",
            date_stop: "2026-08-01",
            impressions: "1000",
            reach: "800",
            frequency: "1.25",
            spend: "20",
            inline_link_clicks: "100",
          },
        ],
      });
    }
    if (
      url.hostname === "measurement.supabase.co" &&
      url.pathname.endsWith("/rpc/replace_meta_insights_range")
    ) {
      const body = JSON.parse(String(init?.body)) as { p_rows?: Array<Record<string, unknown>> };
      dailyRow = body.p_rows?.[0];
      rangeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const result = await syncMetaInsights("2026-08-01", "2026-08-01");
    assert.equal(result.ok, true);
    assert.equal(result.rows, 1);
    assert.equal(result.exactRange?.reach, 800);
    assert.equal(result.exactRange?.frequency, 1.25);
    assert.equal(result.exactRange?.cpm, 20);
    assert.equal(result.exactRange?.linkCtr, 10);
    assert.equal(result.exactRange?.linkCpc, 0.2);

    assert.ok(dailyInsightsUrl);
    const requestedDailyFields = dailyInsightsUrl.searchParams.get("fields") ?? "";
    assert.match(requestedDailyFields, /video_thruplay_watched_actions/);
    assert.match(requestedDailyFields, /video_p95_watched_actions/);
    assert.match(requestedDailyFields, /video_p100_watched_actions/);
    assert.equal(dailyInsightsUrl.searchParams.get("time_increment"), "1");
    assert.equal(
      dailyInsightsUrl.searchParams.get("breakdowns"),
      "country,publisher_platform,platform_position",
    );

    assert.ok(exactInsightsUrl);
    assert.equal(exactInsightsUrl.searchParams.has("time_increment"), false);
    assert.equal(exactInsightsUrl.searchParams.has("breakdowns"), false);
    assert.equal(exactInsightsUrl.searchParams.get("level"), "account");
    assert.match(exactInsightsUrl.searchParams.get("fields") ?? "", /frequency/);

    assert.equal(dailyRow?.video_3s, 90);
    assert.equal(dailyRow?.website_contacts, 6);
    assert.equal(dailyRow?.video_thruplay, 44);
    assert.equal(dailyRow?.video_25, 82);
    assert.equal(dailyRow?.video_50, 66);
    assert.equal(dailyRow?.video_75, 53);
    assert.equal(dailyRow?.video_95, 39);
    assert.equal(dailyRow?.video_100, 35);
    assert.equal(dailyRow?.sync_generation, result.generation);
    assert.equal(dailyRow?.synced_at, result.exactRange?.syncedAt);
    assert.equal(rangeBody?.p_exact_reach, 800);
    assert.equal(rangeBody?.p_exact_frequency, 1.25);
    assert.equal(rangeBody?.p_generation, result.generation);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failed range commit is not cached and the next sync fetches and commits again", async () => {
  const originalFetch = globalThis.fetch;
  let accountCalls = 0;
  let dailyCalls = 0;
  let exactCalls = 0;
  let rpcCalls = 0;

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    const control = metaSyncControlResponse(url);
    if (control) return control;
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/act_727396218766985")) {
      accountCalls += 1;
      return Response.json({ currency: "EUR" });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/insights")) {
      if (url.searchParams.has("time_increment")) dailyCalls += 1;
      else exactCalls += 1;
      return Response.json({ data: [] });
    }
    if (
      url.hostname === "measurement.supabase.co" &&
      url.pathname.endsWith("/rpc/replace_meta_insights_range")
    ) {
      rpcCalls += 1;
      return rpcCalls === 1
        ? new Response("temporary failure", { status: 500 })
        : new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const failed = await syncMetaInsights("2026-08-02", "2026-08-02");
    assert.deepEqual(failed, {
      configured: true,
      ok: false,
      rows: 0,
      reason: "sync_failed",
    });

    const recovered = await syncMetaInsights("2026-08-02", "2026-08-02");
    assert.equal(recovered.ok, true);
    assert.equal(recovered.rows, 0);
    assert.equal(accountCalls, 2);
    assert.equal(dailyCalls, 2);
    assert.equal(exactCalls, 2);
    assert.equal(rpcCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sequential paid syncs always refresh Graph even after another range fails", async () => {
  const originalFetch = globalThis.fetch;
  const dailyCalls = new Map<string, number>();
  const exactCalls = new Map<string, number>();

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const control = metaSyncControlResponse(url);
    if (control) return control;
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/act_727396218766985")) {
      return Response.json({ currency: "EUR" });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/insights")) {
      const range = JSON.parse(url.searchParams.get("time_range") ?? "{}") as { since?: string };
      const calls = url.searchParams.has("time_increment") ? dailyCalls : exactCalls;
      const key = range.since ?? "unknown";
      calls.set(key, (calls.get(key) ?? 0) + 1);
      return Response.json({ data: [] });
    }
    if (
      url.hostname === "measurement.supabase.co" &&
      url.pathname.endsWith("/rpc/replace_meta_insights_range")
    ) {
      const body = JSON.parse(String(init?.body)) as { p_from?: string };
      return body.p_from === "2026-08-04"
        ? new Response("temporary failure", { status: 500 })
        : new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    assert.equal((await syncMetaInsights("2026-08-03", "2026-08-03")).ok, true);
    assert.equal((await syncMetaInsights("2026-08-04", "2026-08-04")).ok, false);
    assert.equal((await syncMetaInsights("2026-08-03", "2026-08-03")).ok, true);
    assert.equal(dailyCalls.get("2026-08-03"), 2);
    assert.equal(exactCalls.get("2026-08-03"), 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("coalesces only concurrent identical syncs and refreshes the next request", async () => {
  const originalFetch = globalThis.fetch;
  let accountCalls = 0;
  let dailyCalls = 0;
  let exactCalls = 0;
  let rpcCalls = 0;

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    const control = metaSyncControlResponse(url);
    if (control) return control;
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/act_727396218766985")) {
      accountCalls += 1;
      return Response.json({ currency: "EUR" });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/insights")) {
      if (url.searchParams.has("time_increment")) dailyCalls += 1;
      else exactCalls += 1;
      return Response.json({ data: [] });
    }
    if (
      url.hostname === "measurement.supabase.co" &&
      url.pathname.endsWith("/rpc/replace_meta_insights_range")
    ) {
      rpcCalls += 1;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const [first, second] = await Promise.all([
      syncMetaInsights("2026-08-05", "2026-08-05"),
      syncMetaInsights("2026-08-05", "2026-08-05"),
    ]);
    assert.equal(first.ok, true);
    assert.equal(first.source, "refresh");
    assert.deepEqual(second, first);
    assert.equal((await syncMetaInsights("2026-08-05", "2026-08-05")).source, "refresh");
    assert.equal(accountCalls, 2);
    assert.equal(dailyCalls, 2);
    assert.equal(exactCalls, 2);
    assert.equal(rpcCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("overlapping sequential ranges are each refreshed from Graph", async () => {
  const originalFetch = globalThis.fetch;
  const dailyCalls = new Map<string, number>();

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    const control = metaSyncControlResponse(url);
    if (control) return control;
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/act_727396218766985")) {
      return Response.json({ currency: "EUR" });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/insights")) {
      const range = JSON.parse(url.searchParams.get("time_range") ?? "{}") as { since?: string };
      if (url.searchParams.has("time_increment")) {
        const key = range.since ?? "unknown";
        dailyCalls.set(key, (dailyCalls.get(key) ?? 0) + 1);
      }
      return Response.json({ data: [] });
    }
    if (
      url.hostname === "measurement.supabase.co" &&
      url.pathname.endsWith("/rpc/replace_meta_insights_range")
    ) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    assert.equal((await syncMetaInsights("2026-08-06", "2026-08-07")).source, "refresh");
    assert.equal((await syncMetaInsights("2026-08-07", "2026-08-08")).source, "refresh");
    assert.equal((await syncMetaInsights("2026-08-06", "2026-08-07")).source, "refresh");
    assert.equal(dailyCalls.get("2026-08-06"), 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an in-flight success fails closed after another range fails", async () => {
  const originalFetch = globalThis.fetch;
  let releaseFirstRangeRpc: (() => void) | undefined;
  let signalFirstRangeRpc: (() => void) | undefined;
  let firstRangeRpcAttempts = 0;
  let firstRangeDailyCalls = 0;
  const firstRangeRpcReached = new Promise<void>((resolve) => {
    signalFirstRangeRpc = resolve;
  });

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const control = metaSyncControlResponse(url);
    if (control) return control;
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/act_727396218766985")) {
      return Response.json({ currency: "EUR" });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/insights")) {
      const range = JSON.parse(url.searchParams.get("time_range") ?? "{}") as { since?: string };
      if (range.since === "2026-08-09" && url.searchParams.has("time_increment")) {
        firstRangeDailyCalls += 1;
      }
      return Response.json({ data: [] });
    }
    if (
      url.hostname === "measurement.supabase.co" &&
      url.pathname.endsWith("/rpc/replace_meta_insights_range")
    ) {
      const body = JSON.parse(String(init?.body)) as { p_from?: string };
      if (body.p_from === "2026-08-10") {
        return new Response("temporary failure", { status: 500 });
      }
      firstRangeRpcAttempts += 1;
      if (firstRangeRpcAttempts > 1) return new Response(null, { status: 204 });
      return new Promise<Response>((resolve) => {
        // The real database sees that generation 101 replaced generation 100
        // while this request was in flight and rejects the stale commit.
        releaseFirstRangeRpc = () => resolve(new Response("stale generation", { status: 409 }));
        signalFirstRangeRpc?.();
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const olderInFlight = syncMetaInsights("2026-08-09", "2026-08-09");
    await firstRangeRpcReached;
    assert.equal((await syncMetaInsights("2026-08-10", "2026-08-10")).ok, false);
    releaseFirstRangeRpc?.();
    const staleResult = await olderInFlight;
    assert.equal(staleResult.ok, false);
    assert.equal(staleResult.reason, "generation_conflict");
    assert.equal((await syncMetaInsights("2026-08-09", "2026-08-09")).source, "refresh");
    assert.equal(firstRangeDailyCalls, 2);
  } finally {
    releaseFirstRangeRpc?.();
    globalThis.fetch = originalFetch;
  }
});

test("reserves the database generation before Graph and uses it for the atomic replace", async () => {
  const originalFetch = globalThis.fetch;
  let rpcBody: Record<string, unknown> | undefined;
  const order: string[] = [];
  const reservedAt = "2026-07-29T07:55:00.000Z";
  let reserveSignal: AbortSignal | null | undefined;
  let replaceSignal: AbortSignal | null | undefined;

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (
      url.hostname === "measurement.supabase.co" &&
      url.pathname.endsWith("/rpc/reserve_meta_insights_sync_v2")
    ) {
      order.push("reserve");
      reserveSignal = init?.signal;
      return Response.json({ generation: 733, reserved_at: reservedAt });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/act_727396218766985")) {
      order.push("account");
      return Response.json({ currency: "EUR" });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/insights")) {
      order.push(url.searchParams.has("time_increment") ? "daily" : "exact");
      return Response.json({ data: [] });
    }
    if (
      url.hostname === "measurement.supabase.co" &&
      url.pathname.endsWith("/rpc/replace_meta_insights_range")
    ) {
      order.push("replace");
      replaceSignal = init?.signal;
      rpcBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const result = await syncMetaInsights("2026-08-11", "2026-08-11");
    assert.equal(result.ok, true);
    assert.equal(result.generation, 733);
    assert.equal(result.exactRange?.generation, 733);
    assert.equal(result.exactRange?.syncedAt, reservedAt);
    assert.deepEqual(order, ["reserve", "account", "daily", "exact", "replace"]);
    assert.equal(rpcBody?.p_generation, 733);
    assert.equal("p_synced_at" in (rpcBody ?? {}), false);
    assert.deepEqual(rpcBody?.p_rows, []);
    assert.ok(reserveSignal instanceof AbortSignal);
    assert.ok(replaceSignal instanceof AbortSignal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reservation failure stops before Graph and does not publish a paid snapshot", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());
    if (url.pathname.endsWith("/rpc/reserve_meta_insights_sync_v2")) {
      return new Response("temporarily unavailable", { status: 503 });
    }
    throw new Error(`Unexpected request after failed reservation: ${url}`);
  }) as typeof fetch;

  try {
    assert.deepEqual(await syncMetaInsights("2026-08-12", "2026-08-12"), {
      configured: true,
      ok: false,
      rows: 0,
      reason: "sync_failed",
    });
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0] ?? "", /reserve_meta_insights_sync_v2$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a post-reservation failure marks the same generation failed", async () => {
  const originalFetch = globalThis.fetch;
  const failBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/rpc/reserve_meta_insights_sync_v2")) {
      return Response.json({
        generation: 812,
        reserved_at: "2026-07-29T08:12:00.000Z",
      });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/act_727396218766985")) {
      return new Response("permission denied", { status: 403 });
    }
    if (url.pathname.endsWith("/rpc/fail_meta_insights_sync")) {
      failBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      assert.ok(init?.signal instanceof AbortSignal);
      return Response.json(true);
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    assert.equal((await syncMetaInsights("2026-08-13", "2026-08-13")).ok, false);
    assert.deepEqual(failBodies, [
      {
        p_account_id: "727396218766985",
        p_generation: 812,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
