import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  behaviorProperties,
  campaignLine,
  createBehaviorNotion,
} from "../src/lib/api/behaviorNotion.ts";
import {
  describeNotionFailure,
  NotionRequestError,
  sanitizeNotionMessage,
} from "../src/lib/verification/notionLead.ts";
import { countryFromHeader, pageBehaviorSummarySchema } from "../src/lib/pageBehaviorSummary.ts";

const sample = {
  sessionId: "8d8b6c3e-1f4a-4e2b-9c7d-0a1b2c3d4e5f",
  locale: "ko" as const,
  device: "phone" as const,
  viewportW: 390,
  viewportH: 844,
  timezone: "Asia/Seoul",
  durationSec: 42,
  maxScroll: 80,
  referrerHost: "www.google.com",
  utmSource: "meta",
  utmMedium: "paid",
  utmCampaign: "launch",
  sections: [{ id: "offer-form", dwellSec: 12 }],
  clicks: [{ id: "header-cta", x: 50, y: 10 }],
};

test("a consented session summary keeps device, country code, time and named clicks", () => {
  assert.equal(pageBehaviorSummarySchema.safeParse(sample).success, true);
  assert.equal(countryFromHeader("kr"), "KR");
  assert.equal(countryFromHeader("korea"), "");
});

test("email, phone and addresses never fit a behavior summary", () => {
  assert.equal(
    pageBehaviorSummarySchema.safeParse({
      ...sample,
      sections: [{ id: "ada@example.com", dwellSec: 1 }],
    }).success,
    false,
  );
  assert.equal(
    pageBehaviorSummarySchema.safeParse({
      ...sample,
      clicks: [{ id: "01012345678", x: 1, y: 1 }],
    }).success,
    false,
  );
  assert.equal(
    pageBehaviorSummarySchema.safeParse({ ...sample, referrerHost: "https://evil.test" }).success,
    false,
  );
});

test("the behavior store does not read an address or a raw user agent", () => {
  // The store is split: the request handler reads headers, behaviorNotion
  // reads the env and builds the row. The guard covers both.
  const source = ["../src/lib/api/pageBehavior.server.ts", "../src/lib/api/behaviorNotion.ts"]
    .map((file) => readFileSync(new URL(file, import.meta.url), "utf8"))
    .join("\n");
  assert.equal(source.includes("x-forwarded-for"), false);
  assert.equal(source.includes("user-agent"), false);
  assert.equal(source.includes("NOTION_WAITLIST_DB_ID"), false);
  assert.ok(source.includes("NOTION_UX_DB_ID"));
});

// ---- Notion write path ------------------------------------------------------

const DB_ID = "0123456789abcdef0123456789abcdef";
const KEY = "ntn_test_secret_key";

type Call = {
  url: string;
  method: string;
  version: string;
  body: Record<string, unknown> | undefined;
};

function fakeNotion(answers: Array<{ status: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      url,
      method: String(init.method),
      version: headers["Notion-Version"],
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = answers.shift() ?? { status: 200, body: { id: "page-default" } };
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function harness(
  answers: Array<{ status: number; body: unknown } | Error>,
  env = { NOTION_API_KEY: KEY, NOTION_UX_DB_ID: DB_ID },
) {
  const notion = fakeNotion(answers);
  const lines: string[] = [];
  let clock = 1_000_000;
  const store = createBehaviorNotion({
    fetchImpl: notion.fetchImpl,
    env,
    now: () => clock,
    log: (text) => lines.push(text),
  });
  return { ...notion, lines, store, advance: (ms: number) => (clock += ms) };
}

const NOT_FOUND = {
  status: 404,
  body: {
    object: "error",
    status: 404,
    code: "object_not_found",
    message: `Could not find database with ID: 01234567-89ab-cdef-0123-456789abcdef. Make sure the relevant pages and databases are shared with your integration.`,
  },
};

test("a database id writes one row with exactly the live columns", async () => {
  const { calls, store, lines } = harness([{ status: 200, body: { id: "page-1" } }]);
  assert.deepEqual(await store.write(sample, "KR"), { stored: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.notion.com/v1/pages");
  assert.equal(calls[0].version, "2022-06-28");
  assert.deepEqual(calls[0].body?.parent, { database_id: DB_ID });
  const properties = calls[0].body?.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(properties).sort(), [
    "Campaign",
    "Clicks",
    "Country",
    "Device",
    "Duration",
    "Locale",
    "Name",
    "Referrer",
    "Scroll",
    "Sections",
    "Timezone",
    "Viewport",
  ]);
  assert.deepEqual(properties.Name, { title: [{ text: { content: sample.sessionId } }] });
  assert.deepEqual(properties.Duration, { number: 42 });
  assert.deepEqual(properties.Scroll, { number: 80 });
  assert.deepEqual(properties.Campaign, {
    rich_text: [{ text: { content: "meta / paid / launch" } }],
  });
  assert.deepEqual(properties.Sections, { rich_text: [{ text: { content: "offer-form 12s" } }] });
  assert.deepEqual(properties.Clicks, { rich_text: [{ text: { content: "header-cta 50,10" } }] });
  assert.deepEqual(lines, []);
});

test("an empty value is an empty cell, and campaign positions never shift", () => {
  assert.equal(campaignLine({ utmSource: "", utmMedium: "", utmCampaign: "" }), "");
  assert.equal(
    campaignLine({ utmSource: "meta", utmMedium: "", utmCampaign: "launch" }),
    "meta / - / launch",
  );
  const properties = behaviorProperties({ ...sample, referrerHost: "" }, "");
  assert.deepEqual(properties.Country, { rich_text: [] });
  assert.deepEqual(properties.Referrer, { rich_text: [] });
});

test("a data-source id is accepted: 404 as a database, then created under the data-source API", async () => {
  const { calls, store, lines } = harness([
    NOT_FOUND,
    { status: 200, body: { id: "page-1" } },
    { status: 200, body: { id: "page-2" } },
  ]);
  assert.deepEqual(await store.write(sample, "KR"), { stored: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].version, "2025-09-03");
  assert.deepEqual(calls[1].body?.parent, { type: "data_source_id", data_source_id: DB_ID });
  assert.deepEqual(lines, []);

  // Remembered: the next session goes straight to the data source.
  await store.write({ ...sample, sessionId: "9d8b6c3e-1f4a-4e2b-9c7d-0a1b2c3d4e5f" }, "KR");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].version, "2025-09-03");
});

test("a rejected write logs one sanitized line, tells the browser only 'failed', and pauses", async () => {
  const { calls, store, lines, advance } = harness([NOT_FOUND, NOT_FOUND]);
  assert.deepEqual(await store.write(sample, "KR"), { stored: false, reason: "failed" });
  assert.equal(calls.length, 2);
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    '[page-behavior] write failed — as database_id: 404 object_not_found "Could not find database with ID: <id>. Make sure the relevant pages and databases are shared with your integration."; as data_source_id: 404 object_not_found "Could not find database with ID: <id>. Make sure the relevant pages and databases are shared with your integration."',
  );
  for (const secret of [DB_ID, "01234567-89ab", KEY, sample.sessionId]) {
    assert.equal(lines[0].includes(secret), false, `log leaked ${secret}`);
  }

  // Paused: a broken config must not spend the integration's rate limit.
  assert.deepEqual(await store.write(sample, "KR"), { stored: false, reason: "failed" });
  assert.equal(calls.length, 2);
  assert.equal(lines.length, 1);

  advance(61_000);
  assert.deepEqual(await store.write(sample, "KR"), { stored: true });
  assert.equal(calls.length, 3);
});

test("a schema mismatch names the problem without echoing the rejected value", async () => {
  const invalid = {
    status: 400,
    body: {
      code: "validation_error",
      message:
        'Scroll is expected to be number. Name is expected to be title. Value "ada@example.com" was rejected.',
    },
  };
  const { store, lines } = harness([invalid, NOT_FOUND]);
  assert.deepEqual(await store.write(sample, "KR"), { stored: false, reason: "failed" });
  assert.match(
    lines[0],
    /as database_id: 400 validation_error "Scroll is expected to be number\. Name is expected to be title\. Value <value> was rejected\."/,
  );
  assert.equal(lines[0].includes("ada@example.com"), false);
});

test("a network failure is logged without the request URL and does not pause", async () => {
  const { calls, store, lines } = harness([
    new TypeError(`fetch failed https://api.notion.com/v1/databases/${DB_ID}`),
    { status: 200, body: { id: "page-1" } },
  ]);
  assert.deepEqual(await store.write(sample, "KR"), { stored: false, reason: "failed" });
  assert.deepEqual(lines, ["[page-behavior] write failed — as database_id: network_error"]);
  assert.deepEqual(await store.write(sample, "KR"), { stored: true });
  assert.equal(calls.length, 2);
});

test("an unset id or key says 'unconfigured', calls nothing, and logs once", async () => {
  const { calls, store, lines } = harness([], { NOTION_API_KEY: KEY, NOTION_UX_DB_ID: " " });
  assert.deepEqual(await store.write(sample, "KR"), { stored: false, reason: "unconfigured" });
  assert.deepEqual(await store.write(sample, "KR"), { stored: false, reason: "unconfigured" });
  assert.equal(calls.length, 0);
  assert.deepEqual(lines, [
    "[page-behavior] write skipped: NOTION_UX_DB_ID or NOTION_API_KEY is not set",
  ]);
});

test("a session's later summary updates its row instead of adding one", async () => {
  const { calls, store } = harness([
    { status: 200, body: { id: "page-1" } },
    { status: 200, body: { id: "page-1" } },
  ]);
  await store.write(sample, "KR");
  assert.deepEqual(await store.write({ ...sample, durationSec: 90 }, "KR"), { stored: true });
  assert.equal(calls[1].method, "PATCH");
  assert.equal(calls[1].url, "https://api.notion.com/v1/pages/page-1");
  assert.equal(calls[1].body?.parent, undefined);
});

test("the admin read follows the same database-or-data-source resolution", async () => {
  const { calls, store } = harness([NOT_FOUND, { status: 200, body: { results: [] } }]);
  assert.deepEqual(await store.query({ page_size: 1 }), { results: [] });
  assert.equal(calls[0].url, `https://api.notion.com/v1/databases/${DB_ID}/query`);
  assert.equal(calls[1].url, `https://api.notion.com/v1/data_sources/${DB_ID}/query`);
  assert.equal(calls[1].version, "2025-09-03");
});

test("Notion messages lose ids, quoted values, addresses and tokens", () => {
  assert.equal(
    sanitizeNotionMessage(
      'Could not find database with ID: 0123456789abcdef0123456789abcdef. Value "x" by ada@example.com via https://www.notion.so/abc token ntn_abc123 phone 01012345678',
    ),
    "Could not find database with ID: <id>. Value <value> by <email> via <url> token <token> phone <n>",
  );
  const error = new NotionRequestError(404, JSON.stringify(NOT_FOUND.body));
  assert.equal(error.message, describeNotionFailure(404, JSON.stringify(NOT_FOUND.body)));
  assert.equal(error.code, "object_not_found");
  assert.equal(error.detail.includes("01234567-89ab"), false);
  assert.equal(new NotionRequestError(502, "<html>").detail, "");
});
