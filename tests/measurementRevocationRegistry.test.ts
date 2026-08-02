import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  openLaunchOsReplayMetadata,
  relayStoredWaitlistLead,
  sealLaunchOsReplayMetadata,
} from "../src/lib/api/launchOsRelay.server.ts";
import {
  FIELD_ACQUISITION_PATH,
  FIELD_EMAIL_VERIFIED,
  FIELD_ENVIRONMENT,
  FIELD_LANDING_PATH,
  FIELD_LAUNCHOS_REPLAY_METADATA,
  FIELD_MEASUREMENT_CONSENT,
  FIELD_META_ADSET_ID,
  FIELD_META_AD_ID,
  FIELD_META_CAMPAIGN_ID,
  FIELD_QUALIFICATION_RULE_VERSION,
  FIELD_SOURCE_SCHEMA_VERSION,
  FIELD_UTM_CAMPAIGN,
  FIELD_UTM_CONTENT,
  FIELD_UTM_MEDIUM,
  FIELD_UTM_SOURCE,
  FIELD_UTM_TERM,
  FIELD_VERIFICATION_STATUS,
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_WITHDRAWN,
  STATUS_SUPPRESSED,
  STATUS_UNSUBSCRIBED,
  type LaunchOsAuthorizedMeasurementContext,
} from "../src/lib/verification/contracts.ts";
import {
  createNotionMeasurementRevocationRegistry,
  SOURCE_MEASUREMENT_TOMBSTONE_SOURCE,
} from "../src/lib/verification/measurementRevocationRegistry.server.ts";
import { COUNTABLE_STATUS_FILTER, type NotionRequest } from "../src/lib/verification/notionLead.ts";

const NOW = Date.parse("2026-08-02T09:00:00.000Z");
const AUTHORITY = "e".repeat(64);
const OTHER_AUTHORITY = "f".repeat(64);
const REQUEST_ID = `pwr_v1_${"B".repeat(32)}`;
const ENV = {
  LAUNCHOS_MEASUREMENT_ENABLED: "true",
  LAUNCHOS_BASE_URL: "http://localhost:4178",
  LAUNCHOS_PROJECT_ID: "watchdive-prelanding",
  LAUNCHOS_FUNNEL_VERSION: "wd-prelaunch-v1",
  LAUNCHOS_ENVIRONMENT: "development",
  LAUNCHOS_WEB_EVENTS_INGRESS_KEY_ID: "watchdive.web.v1",
  LAUNCHOS_WEB_EVENTS_INGRESS_SECRET: "web-events-secret-32-bytes-minimum-01",
  LAUNCHOS_LEAD_STORE_INGRESS_KEY_ID: "watchdive.lead.v1",
  LAUNCHOS_LEAD_STORE_INGRESS_SECRET: "lead-store-secret-32-bytes-minimum-02",
  LAUNCHOS_VERIFICATION_INGRESS_KEY_ID: "watchdive.verify.v1",
  LAUNCHOS_VERIFICATION_INGRESS_SECRET: "verification-secret-32-bytes-min-03",
  LAUNCHOS_CANONICAL_LEAD_HMAC_SECRET: "canonical-lead-secret-32-bytes-min-04",
  WAITLIST_REPLAY_HMAC_SECRET: "replay-envelope-secret-32-bytes-min-05",
  LAUNCHOS_QUALITY_RULE_VERSION: "wd-suspect-v1",
  LAUNCHOS_VERIFICATION_POLICY_VERSION: "wd-email-double-opt-in-v1",
  LAUNCHOS_APPROVED_META_IDENTITY_REGISTRY_JSON: "[]",
} satisfies NodeJS.ProcessEnv;

function envelope(authorityReferenceHash: string, suffix: string) {
  const context: LaunchOsAuthorizedMeasurementContext = {
    funnelInstanceId: `fi_v1_${suffix.repeat(32)}`,
    attribution: {},
    measurementConsent: {
      purpose: "advertising_measurement",
      state: "granted",
      version: "WD-AD-MEASUREMENT-CONSENT-V1",
    },
    authorityReferenceHash,
    attributionAuthority: "approved_meta_identity_snapshot_v1",
  };
  return sealLaunchOsReplayMetadata(
    {
      canonicalEmail: `${suffix.toLowerCase()}@example.com`,
      suspect: false,
      signedUpAt: "2026-08-02T09:00:00.000Z",
      context,
    },
    ENV,
  );
}

type Row = { id: string; properties: Record<string, unknown> };

const LIVE_VERIFICATION_STATUS_OPTIONS = new Set(["pending", "verified", "expired", "suppressed"]);

function validateLiveSelectOptions(properties: Record<string, unknown>) {
  const status = (
    properties[FIELD_VERIFICATION_STATUS] as { select?: { name?: string } | null } | undefined
  )?.select?.name;
  if (status && !LIVE_VERIFICATION_STATUS_OPTIONS.has(status)) {
    throw new Error(`NOTION_SELECT_OPTION_UNKNOWN:${status}`);
  }
}

class FakeNotion {
  rows: Row[] = [];
  createdProperties: Record<string, unknown> | undefined;
  failTombstoneCreate = false;
  patchCalls: string[] = [];

  addReplay(id: string, replayMetadata: string) {
    this.rows.push({
      id,
      properties: {
        Email: { title: [{ plain_text: `${id}@example.com` }] },
        [FIELD_VERIFICATION_STATUS]: { select: { name: "verified" } },
        [FIELD_EMAIL_VERIFIED]: { checkbox: true },
        Counted: { checkbox: true },
        Suspect: { checkbox: false },
        Duplicate: { checkbox: false },
        [FIELD_LAUNCHOS_REPLAY_METADATA]: {
          rich_text: [{ plain_text: replayMetadata }],
        },
        [FIELD_MEASUREMENT_CONSENT]: {
          rich_text: [{ plain_text: MEASUREMENT_CONSENT_GRANTED }],
        },
        [FIELD_UTM_SOURCE]: { rich_text: [{ plain_text: "facebook" }] },
        [FIELD_UTM_MEDIUM]: { rich_text: [{ plain_text: "paid_social" }] },
        [FIELD_UTM_CAMPAIGN]: { rich_text: [{ plain_text: "watchdive_launch" }] },
        [FIELD_UTM_CONTENT]: { rich_text: [{ plain_text: "hero_video_a" }] },
        [FIELD_UTM_TERM]: { rich_text: [{ plain_text: "cold_divers" }] },
        [FIELD_LANDING_PATH]: { rich_text: [{ plain_text: "/watchdive" }] },
        [FIELD_ENVIRONMENT]: { select: { name: "production" } },
        [FIELD_ACQUISITION_PATH]: { select: { name: "website" } },
        [FIELD_QUALIFICATION_RULE_VERSION]: {
          rich_text: [{ plain_text: "wd-suspect-v1" }],
        },
        [FIELD_SOURCE_SCHEMA_VERSION]: { rich_text: [{ plain_text: "wd-v1" }] },
        [FIELD_META_CAMPAIGN_ID]: { rich_text: [{ plain_text: "1001" }] },
        [FIELD_META_ADSET_ID]: { rich_text: [{ plain_text: "2002" }] },
        [FIELD_META_AD_ID]: { rich_text: [{ plain_text: "3003" }] },
      },
    });
  }

  request: NotionRequest = async (method, path, body) => {
    if (method === "POST" && path.endsWith("/query")) {
      const query = body as {
        filter?: { property?: string; title?: { equals?: string }; rich_text?: unknown };
        start_cursor?: string;
        page_size?: number;
      };
      if (query.filter?.property === "Email") {
        const expected = query.filter.title?.equals;
        const found = this.rows.filter((row) => {
          const title = (
            row.properties.Email as { title?: Array<{ plain_text?: string }> } | undefined
          )?.title?.[0]?.plain_text;
          return title === expected;
        });
        return { results: found.slice(0, 1), has_more: false, next_cursor: null };
      }
      const nonEmpty = this.rows.filter((row) => {
        const rich = (
          row.properties[FIELD_LAUNCHOS_REPLAY_METADATA] as
            { rich_text?: Array<{ plain_text?: string }> } | undefined
        )?.rich_text;
        return Boolean(rich?.[0]?.plain_text);
      });
      const start = query.start_cursor ? Number(query.start_cursor) : 0;
      const size = Math.min(query.page_size ?? 100, 100);
      const page = nonEmpty.slice(start, start + size);
      const next = start + page.length;
      return {
        results: page,
        has_more: next < nonEmpty.length,
        next_cursor: next < nonEmpty.length ? String(next) : null,
      };
    }
    if (method === "POST" && path === "pages") {
      if (this.failTombstoneCreate) throw new Error("notion unavailable");
      const properties = (body as { properties: Record<string, unknown> }).properties;
      validateLiveSelectOptions(properties);
      this.createdProperties = properties;
      const title = (properties.Email as { title?: Array<{ text?: { content?: string } }> })
        .title?.[0]?.text?.content;
      const row = {
        id: `tombstone-${this.rows.length}`,
        properties: {
          ...properties,
          Email: { title: [{ plain_text: title }] },
        },
      };
      this.rows.push(row);
      return row;
    }
    if (method === "PATCH" && path.startsWith("pages/")) {
      const id = path.slice("pages/".length);
      const row = this.rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error("row missing");
      const properties = (body as { properties: Record<string, unknown> }).properties;
      validateLiveSelectOptions(properties);
      Object.assign(row.properties, properties);
      this.patchCalls.push(id);
      return row;
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
}

function registry(fake: FakeNotion) {
  return createNotionMeasurementRevocationRegistry({
    request: fake.request,
    databaseId: "waitlist-db",
    replaySecret: ENV.WAITLIST_REPLAY_HMAC_SECRET,
    readReplayAuthority: (value) => openLaunchOsReplayMetadata(value, ENV)?.authorityReferenceHash,
  });
}

test("source revocation creates an excluded PII-free tombstone and clears only exact envelopes", async () => {
  const fake = new FakeNotion();
  fake.addReplay("target", envelope(AUTHORITY, "A"));
  fake.addReplay("other", envelope(OTHER_AUTHORITY, "B"));
  const sourceRegistry = registry(fake);

  const result = await sourceRegistry.revoke({
    authorityReferenceHash: AUTHORITY,
    requestId: REQUEST_ID,
    occurredAt: "2026-08-02T09:00:00.000Z",
  });
  assert.equal(result.matchedRows, 1);
  assert.deepEqual(fake.patchCalls, ["target"]);
  assert.equal(await sourceRegistry.isRevoked(AUTHORITY), true);
  assert.equal(await sourceRegistry.isRevoked(OTHER_AUTHORITY), false);

  const props = fake.createdProperties!;
  const raw = JSON.stringify(props);
  assert.equal(
    (props["Verification status"] as { select: { name: string } }).select.name,
    STATUS_SUPPRESSED,
  );
  assert.equal(
    (
      props[FIELD_MEASUREMENT_CONSENT] as {
        rich_text: Array<{ text: { content: string } }>;
      }
    ).rich_text[0].text.content,
    MEASUREMENT_CONSENT_WITHDRAWN,
  );
  assert.equal((props.Suspect as { checkbox: boolean }).checkbox, true);
  assert.equal(
    (props.Source as { select: { name: string } }).select.name,
    SOURCE_MEASUREMENT_TOMBSTONE_SOURCE,
  );
  assert.match(raw, /wd_privacy_v1_[a-f0-9]{64}/);
  assert.ok(!raw.includes("@"));
  assert.ok(!raw.includes(AUTHORITY), "raw authority hash leaked into the source row");
  const target = fake.rows.find((row) => row.id === "target")!.properties;
  assert.equal(
    (target.Email as { title: Array<{ plain_text: string }> }).title[0].plain_text,
    "target@example.com",
  );
  assert.equal(
    (target[FIELD_VERIFICATION_STATUS] as { select: { name: string } }).select.name,
    "verified",
  );
  assert.equal((target[FIELD_EMAIL_VERIFIED] as { checkbox: boolean }).checkbox, true);
  assert.equal((target.Counted as { checkbox: boolean }).checkbox, true);
  assert.equal((target.Suspect as { checkbox: boolean }).checkbox, false);
  assert.equal((target.Duplicate as { checkbox: boolean }).checkbox, false);
  assert.equal(
    (
      target[FIELD_MEASUREMENT_CONSENT] as {
        rich_text: Array<{ text: { content: string } }>;
      }
    ).rich_text[0].text.content,
    MEASUREMENT_CONSENT_WITHDRAWN,
  );
  for (const field of [
    FIELD_LAUNCHOS_REPLAY_METADATA,
    FIELD_UTM_SOURCE,
    FIELD_UTM_MEDIUM,
    FIELD_UTM_CAMPAIGN,
    FIELD_UTM_CONTENT,
    FIELD_UTM_TERM,
    FIELD_LANDING_PATH,
    FIELD_QUALIFICATION_RULE_VERSION,
    FIELD_SOURCE_SCHEMA_VERSION,
    FIELD_META_CAMPAIGN_ID,
    FIELD_META_ADSET_ID,
    FIELD_META_AD_ID,
  ]) {
    assert.deepEqual((target[field] as { rich_text: unknown[] }).rich_text, [], field);
  }
  assert.equal((target[FIELD_ENVIRONMENT] as { select: unknown }).select, null);
  assert.equal((target[FIELD_ACQUISITION_PATH] as { select: unknown }).select, null);

  const other = fake.rows.find((row) => row.id === "other")!.properties;
  assert.notEqual(
    (
      other[FIELD_LAUNCHOS_REPLAY_METADATA] as {
        rich_text: Array<{ plain_text: string }>;
      }
    ).rich_text[0].plain_text,
    "",
  );
  assert.equal(
    (other[FIELD_MEASUREMENT_CONSENT] as { rich_text: Array<{ plain_text: string }> }).rich_text[0]
      .plain_text,
    MEASUREMENT_CONSENT_GRANTED,
  );
});

test("the Notion fake rejects status values absent from the live select schema", async () => {
  const fake = new FakeNotion();
  await assert.rejects(
    fake.request("POST", "pages", {
      properties: {
        Email: { title: [{ text: { content: "opaque" } }] },
        [FIELD_VERIFICATION_STATUS]: { select: { name: STATUS_UNSUBSCRIBED } },
      },
    }),
    /NOTION_SELECT_OPTION_UNKNOWN:unsubscribed/,
  );
});

test("synthetic tombstones are excluded from every in-app operational count and mail lookup", () => {
  assert.deepEqual(COUNTABLE_STATUS_FILTER, {
    or: [
      { property: "Verification status", select: { equals: "verified" } },
      { property: "Verification status", select: { is_empty: true } },
    ],
  });
  const waitlist = readFileSync("src/lib/api/waitlist.functions.ts", "utf8");
  const store = readFileSync("src/lib/verification/notionLead.ts", "utf8");
  assert.ok(waitlist.includes("const NOT_SUSPECT"));
  assert.ok(waitlist.includes("const COUNTABLE = { and: [NOT_SUSPECT, COUNTABLE_STATUS_FILTER] }"));
  assert.ok(waitlist.includes("filter: COUNTABLE"));
  assert.ok(waitlist.includes("...COUNTABLE.and]"));
  assert.ok(store.includes('{ property: "Email", title: { equals: email } }'));
  assert.ok(!SOURCE_MEASUREMENT_TOMBSTONE_SOURCE.includes("@"));
});

test("a durable tombstone blocks a lead created after the withdrawal scan", async () => {
  const fake = new FakeNotion();
  const sourceRegistry = registry(fake);
  await sourceRegistry.revoke({
    authorityReferenceHash: AUTHORITY,
    requestId: REQUEST_ID,
    occurredAt: "2026-08-02T09:00:00.000Z",
  });
  const replayMetadata = envelope(AUTHORITY, "A");
  fake.addReplay("concurrent-late-lead", replayMetadata);
  let fetchCalls = 0;
  const result = await relayStoredWaitlistLead({
    replayMetadata,
    dependencies: {
      env: ENV,
      nowImpl: () => NOW,
      sourceMeasurementRevoked: sourceRegistry.isRevoked,
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json({ ok: true });
      },
    },
  });
  assert.equal(result.webEvents.code, "SOURCE_MEASUREMENT_REVOKED");
  assert.equal(result.leadStore.code, "SOURCE_MEASUREMENT_REVOKED");
  assert.equal(fetchCalls, 0);
});

test("Notion tombstone failure leaves every stored relay fail-closed", async () => {
  const fake = new FakeNotion();
  fake.failTombstoneCreate = true;
  const sourceRegistry = registry(fake);
  await assert.rejects(
    sourceRegistry.revoke({
      authorityReferenceHash: AUTHORITY,
      requestId: REQUEST_ID,
      occurredAt: "2026-08-02T09:00:00.000Z",
    }),
    /notion unavailable/,
  );
  const replayMetadata = envelope(AUTHORITY, "A");
  let fetchCalls = 0;
  const result = await relayStoredWaitlistLead({
    replayMetadata,
    dependencies: {
      env: ENV,
      sourceMeasurementRevoked: async () => {
        throw new Error("registry unavailable");
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json({ ok: true });
      },
    },
  });
  assert.equal(result.webEvents.code, "SOURCE_REVOCATION_CHECK_FAILED");
  assert.equal(result.leadStore.code, "SOURCE_REVOCATION_CHECK_FAILED");
  assert.equal(fetchCalls, 0);
});

test("the source scan refuses to claim completion beyond its explicit 1,000-row bound", async () => {
  const fake = new FakeNotion();
  for (let index = 0; index < 1_001; index += 1) {
    fake.addReplay(`row-${index}`, "lorm_v3.invalid-but-nonempty.invalid");
  }
  const sourceRegistry = registry(fake);
  await assert.rejects(
    sourceRegistry.revoke({
      authorityReferenceHash: AUTHORITY,
      requestId: REQUEST_ID,
      occurredAt: "2026-08-02T09:00:00.000Z",
    }),
    /scan bound was exceeded/,
  );
  assert.equal(fake.patchCalls.length, 0, "a partial scan mutated source rows");
  assert.equal(
    await sourceRegistry.isRevoked(AUTHORITY),
    true,
    "the durable block disappeared when cleanup remained pending",
  );
});
