import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, beforeEach, test } from "node:test";

import {
  extractMetaLeadReferences,
  handleMetaLeadgenWebhook,
  normalizeMetaGraphLead,
  verifyMetaWebhookSignature,
} from "../src/lib/api/metaLeadgenWebhook.server.ts";
import type { InstantFormLeadInput } from "../src/lib/api/waitlist.functions.ts";
import type { FunnelPropertyValue } from "../src/lib/funnel/types.ts";

const ORIGINAL_ENV = {
  META_APP_SECRET: process.env.META_APP_SECRET,
  META_PAGE_ACCESS_TOKEN: process.env.META_PAGE_ACCESS_TOKEN,
  META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN,
  META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
  META_PAGE_ID: process.env.META_PAGE_ID,
  META_LEADGEN_FORM_IDS: process.env.META_LEADGEN_FORM_IDS,
  META_LEADGEN_CAMPAIGN_IDS: process.env.META_LEADGEN_CAMPAIGN_IDS,
  META_ADSET_COUNTRY_MAP: process.env.META_ADSET_COUNTRY_MAP,
};

beforeEach(() => {
  process.env.META_APP_SECRET = "app-secret-for-test";
  process.env.META_PAGE_ACCESS_TOKEN = "page-token-for-test";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-for-test";
  process.env.META_PAGE_ID = "page-123";
  process.env.META_LEADGEN_FORM_IDS = "form-123";
  process.env.META_LEADGEN_CAMPAIGN_IDS = "campaign-123";
  process.env.META_ADSET_COUNTRY_MAP = JSON.stringify({ "adset-123": "US" });
  delete process.env.META_GRAPH_API_VERSION;
});

after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function signedRequest(body: string, secret = "app-secret-for-test"): Request {
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return new Request("https://watchdive.diveroid.com/api/meta/leadgen", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": `sha256=${signature}`,
    },
    body,
  });
}

function leadgenPayload(options?: {
  pageId?: string;
  formId?: string;
  includeCampaignId?: boolean;
}): Record<string, unknown> {
  const includeCampaignId = options?.includeCampaignId ?? true;
  return {
    object: "page",
    entry: [
      {
        id: options?.pageId ?? "page-123",
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: "lead-123",
              created_time: 1785315600,
              form_id: options?.formId ?? "form-123",
              ...(includeCampaignId ? { campaign_id: "campaign-123" } : {}),
              adset_id: "adset-123",
              ad_id: "ad-123",
            },
          },
          {
            field: "leadgen",
            value: {
              leadgen_id: "lead-123",
              created_time: 1785315600,
            },
          },
        ],
      },
    ],
  };
}

test("verifies the GET subscription challenge without caching it", async () => {
  const response = await handleMetaLeadgenWebhook(
    new Request(
      "https://watchdive.diveroid.com/api/meta/leadgen?" +
        new URLSearchParams({
          "hub.mode": "subscribe",
          "hub.verify_token": "verify-token-for-test",
          "hub.challenge": "challenge-value",
        }),
    ),
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "challenge-value");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects a wrong GET verification token", async () => {
  const response = await handleMetaLeadgenWebhook(
    new Request(
      "https://watchdive.diveroid.com/api/meta/leadgen?" +
        new URLSearchParams({
          "hub.mode": "subscribe",
          "hub.verify_token": "wrong",
          "hub.challenge": "challenge-value",
        }),
    ),
  );

  assert.ok(response);
  assert.equal(response.status, 403);
});

test("validates the raw request bytes with X-Hub-Signature-256", () => {
  const rawBody = new TextEncoder().encode('{"entry":[]}');
  const validSignature = `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`;

  assert.equal(verifyMetaWebhookSignature(rawBody, validSignature, "secret"), true);
  assert.equal(verifyMetaWebhookSignature(rawBody, validSignature, "different"), false);
  assert.equal(verifyMetaWebhookSignature(rawBody, "sha256=not-hex", "secret"), false);
});

test("deduplicates repeated lead ids within one webhook delivery", () => {
  const references = extractMetaLeadReferences(leadgenPayload());
  assert.equal(references.length, 1);
  assert.deepEqual(references[0], {
    platformLeadId: "lead-123",
    createdTime: "2026-07-29T09:00:00.000Z",
    formId: "form-123",
    pageId: "page-123",
    campaignId: "campaign-123",
    adSetId: "adset-123",
    adId: "ad-123",
  });
});

test("merges complete scope and attribution into an earlier incomplete reference", () => {
  const payload = leadgenPayload();
  const entry = (payload.entry as Array<{ changes: unknown[] }>)[0];
  entry.changes.reverse();

  const references = extractMetaLeadReferences(payload);

  assert.deepEqual(references, [
    {
      platformLeadId: "lead-123",
      createdTime: "2026-07-29T09:00:00.000Z",
      formId: "form-123",
      pageId: "page-123",
      campaignId: "campaign-123",
      adSetId: "adset-123",
      adId: "ad-123",
    },
  ]);
});

test("rejects conflicting Page or Form references for the same lead id before Graph access", async () => {
  const conflictingPayloads = [
    {
      object: "page",
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "leadgen",
              value: { leadgen_id: "lead-123", form_id: "form-123" },
            },
            {
              field: "leadgen",
              value: {
                leadgen_id: "lead-123",
                page_id: "other-page",
                form_id: "form-123",
              },
            },
          ],
        },
      ],
    },
    {
      object: "page",
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "leadgen",
              value: { leadgen_id: "lead-123", form_id: "form-123" },
            },
            {
              field: "leadgen",
              value: { leadgen_id: "lead-123", form_id: "other-form" },
            },
          ],
        },
      ],
    },
  ];
  let graphCalls = 0;

  for (const payload of conflictingPayloads) {
    const response = await handleMetaLeadgenWebhook(signedRequest(JSON.stringify(payload)), {
      fetchImpl: async () => {
        graphCalls += 1;
        return Response.json({});
      },
    });

    assert.ok(response);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_leadgen_payload" });
  }

  assert.equal(graphCalls, 0);
});

test("normalizes Graph field_data without changing the platform lead id", () => {
  const normalized = normalizeMetaGraphLead(
    {
      id: "lead-123",
      created_time: "2026-07-29T09:00:00+0000",
      field_data: [
        { name: "email", values: ["Diver@Example.com"] },
        { name: "phone_number", values: ["+1 202 555 0100"] },
        { name: "first_name", values: ["Ocean"] },
        { name: "last_name", values: ["Diver"] },
      ],
      form_id: "form-123",
      platform: "ig",
      adset_id: "adset-123",
    },
    {
      platformLeadId: "lead-123",
      createdTime: "2026-07-29T09:00:00.000Z",
      campaignId: "campaign-123",
    },
  );

  assert.equal(normalized.email, "Diver@Example.com");
  assert.equal(normalized.phone, "+1 202 555 0100");
  assert.equal(normalized.fullName, "Ocean Diver");
  assert.equal(normalized.campaignId, "campaign-123");
  assert.equal(normalized.publisherPlatform, "instagram");
  assert.equal(normalized.country, "US");
});

test("fetches Graph data with a bearer header and completes only after both stores", async () => {
  const body = JSON.stringify(leadgenPayload());
  const recordedEvents: Array<Record<string, unknown>> = [];
  const ingestedLeads: Array<Record<string, unknown>> = [];
  let graphCalls = 0;

  const response = await handleMetaLeadgenWebhook(signedRequest(body), {
    fetchImpl: async (input, init) => {
      graphCalls += 1;
      const url = new URL(String(input));
      assert.equal(url.searchParams.has("access_token"), false);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer page-token-for-test");
      return Response.json({
        id: "lead-123",
        created_time: "2026-07-29T09:00:00+0000",
        field_data: [
          { name: "email", values: ["diver@example.com"] },
          { name: "phone_number", values: ["+1 202 555 0100"] },
          { name: "full_name", values: ["Ocean Diver"] },
        ],
        form_id: "form-123",
        platform: "instagram",
        campaign_id: "campaign-123",
        campaign_name: "Campaign",
        adset_id: "adset-123",
        adset_name: "Ad set",
        ad_id: "ad-123",
        ad_name: "Creative",
      });
    },
    recordWebhookEvent: async (event) => {
      recordedEvents.push(event);
      return true;
    },
    ingestLead: async (lead) => {
      ingestedLeads.push(lead);
      return { ok: true, status: "new", notionPageId: "notion-page" };
    },
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: 1 });
  assert.equal(graphCalls, 1);
  assert.equal(recordedEvents.length, 1);
  assert.deepEqual(recordedEvents[0]?.properties, {
    metaFormId: "form-123",
    metaPageId: "page-123",
    campaignScopeStatus: "verified",
  });
  assert.equal(
    (recordedEvents[0]?.attribution as { publisherPlatform?: string } | undefined)
      ?.publisherPlatform,
    "instagram",
  );
  assert.equal(ingestedLeads.length, 1);
  assert.equal(ingestedLeads[0]?.email, "diver@example.com");
  assert.equal(ingestedLeads[0]?.publisherPlatform, "instagram");
  assert.equal(ingestedLeads[0]?.country, "US");
});

test("accepts an allowed Page+Form when campaign_id is absent from the webhook", async () => {
  const body = JSON.stringify(leadgenPayload({ includeCampaignId: false }));
  let graphCalls = 0;
  let ingested = 0;

  const response = await handleMetaLeadgenWebhook(signedRequest(body), {
    fetchImpl: async () => {
      graphCalls += 1;
      return Response.json({
        id: "lead-123",
        created_time: "2026-07-29T09:00:00+0000",
        field_data: [{ name: "email", values: ["diver@example.com"] }],
        form_id: "form-123",
        campaign_id: "campaign-123",
      });
    },
    recordWebhookEvent: async () => true,
    ingestLead: async () => {
      ingested += 1;
      return { ok: true, status: "new" };
    },
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: 1 });
  assert.equal(graphCalls, 1);
  assert.equal(ingested, 1);
});

test("preserves a dedicated Page+Form lead when Campaign attribution is unavailable", async () => {
  const body = JSON.stringify(leadgenPayload({ includeCampaignId: false }));
  let ingestedLead: InstantFormLeadInput | undefined;
  let webhookProperties: Record<string, FunnelPropertyValue> | undefined;

  const response = await handleMetaLeadgenWebhook(signedRequest(body), {
    fetchImpl: async () =>
      Response.json({
        id: "lead-123",
        created_time: "2026-07-29T09:00:00+0000",
        field_data: [{ name: "email", values: ["diver@example.com"] }],
        form_id: "form-123",
      }),
    recordWebhookEvent: async (event) => {
      webhookProperties = event.properties;
      return true;
    },
    ingestLead: async (lead) => {
      ingestedLead = lead;
      return { ok: true, status: "new" };
    },
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: 1 });
  assert.equal(ingestedLead?.campaignScopeStatus, "unverified");
  assert.equal(webhookProperties?.campaignScopeStatus, "unverified");
});

test("uses the dedicated Page+Form scope when no Campaign allowlist is configured", async () => {
  process.env.META_LEADGEN_CAMPAIGN_IDS = "";
  const body = JSON.stringify(leadgenPayload({ includeCampaignId: false }));
  let ingested = 0;

  const response = await handleMetaLeadgenWebhook(signedRequest(body), {
    fetchImpl: async () =>
      Response.json({
        id: "lead-123",
        created_time: "2026-07-29T09:00:00+0000",
        field_data: [{ name: "email", values: ["diver@example.com"] }],
        form_id: "form-123",
      }),
    recordWebhookEvent: async () => true,
    ingestLead: async () => {
      ingested += 1;
      return { ok: true, status: "new" };
    },
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: 1 });
  assert.equal(ingested, 1);
});

test("rejects a wrong Page or Form before fetching Graph lead PII", async () => {
  let graphCalls = 0;
  const response = await handleMetaLeadgenWebhook(
    signedRequest(JSON.stringify(leadgenPayload({ formId: "other-form" }))),
    {
      fetchImpl: async () => {
        graphCalls += 1;
        return Response.json({});
      },
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: 0, ignored: 1 });
  assert.equal(graphCalls, 0);
});

test("requires a non-empty Form allowlist even when a Campaign list exists", async () => {
  process.env.META_LEADGEN_FORM_IDS = "";
  let graphCalls = 0;
  const response = await handleMetaLeadgenWebhook(signedRequest(JSON.stringify(leadgenPayload())), {
    fetchImpl: async () => {
      graphCalls += 1;
      return Response.json({});
    },
  });

  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(graphCalls, 0);
});

test("checks the optional Campaign allowlist only after Graph returns a campaign", async () => {
  let recorded = 0;
  let ingested = 0;
  const response = await handleMetaLeadgenWebhook(
    signedRequest(JSON.stringify(leadgenPayload({ includeCampaignId: false }))),
    {
      fetchImpl: async () =>
        Response.json({
          id: "lead-123",
          created_time: "2026-07-29T09:00:00+0000",
          field_data: [{ name: "email", values: ["diver@example.com"] }],
          form_id: "form-123",
          campaign_id: "other-campaign",
        }),
      recordWebhookEvent: async () => {
        recorded += 1;
        return true;
      },
      ingestLead: async () => {
        ingested += 1;
        return { ok: true, status: "new" };
      },
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: 0, ignored: 1 });
  assert.equal(recorded, 0);
  assert.equal(ingested, 0);
});

test("rejects an invalid POST signature before Graph or CRM access", async () => {
  let called = false;
  const response = await handleMetaLeadgenWebhook(
    signedRequest(JSON.stringify(leadgenPayload()), "wrong-secret"),
    {
      fetchImpl: async () => {
        called = true;
        return Response.json({});
      },
    },
  );

  assert.ok(response);
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("returns 500 when durable storage fails so Meta can retry", async () => {
  const body = JSON.stringify(leadgenPayload());
  const originalError = console.error;
  console.error = () => {};
  let ingested = false;

  try {
    const failed = await handleMetaLeadgenWebhook(signedRequest(body), {
      fetchImpl: async () =>
        Response.json({
          id: "lead-123",
          created_time: "2026-07-29T09:00:00+0000",
          field_data: [{ name: "email", values: ["diver@example.com"] }],
        }),
      recordWebhookEvent: async () => false,
      ingestLead: async () => {
        ingested = true;
        return { ok: true, status: "new" };
      },
    });

    assert.ok(failed);
    assert.equal(failed.status, 500);
    assert.equal(ingested, false);

    const retried = await handleMetaLeadgenWebhook(signedRequest(body), {
      fetchImpl: async () =>
        Response.json({
          id: "lead-123",
          created_time: "2026-07-29T09:00:00+0000",
          field_data: [{ name: "email", values: ["diver@example.com"] }],
        }),
      recordWebhookEvent: async () => true,
      ingestLead: async () => {
        ingested = true;
        return { ok: true, status: "new" };
      },
    });

    assert.ok(retried);
    assert.equal(retried.status, 200);
    assert.equal(ingested, true);
  } finally {
    console.error = originalError;
  }
});

test("returns null for unrelated routes", async () => {
  const response = await handleMetaLeadgenWebhook(new Request("https://watchdive.diveroid.com/"));
  assert.equal(response, null);
});
