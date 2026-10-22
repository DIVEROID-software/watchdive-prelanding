import assert from "node:assert/strict";
import { test } from "node:test";

import { REFERRAL_COLUMNS } from "../src/lib/referral/contract.ts";
import {
  PROGRAM_ROWS_FILTER,
  SCHEMA_CACHE_MS,
  createNotionReferralStore,
  resetReferralSchemaCache,
  toReferralRow,
} from "../src/lib/referral/store.ts";
import type { NotionRequest } from "../src/lib/verification/notionLead.ts";

type Call = { method: string; path: string; body?: unknown };

const text = (value: string) => ({ rich_text: [{ plain_text: value }] });

function page(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    properties: {
      Email: { title: [{ plain_text: `${id}@Example.com` }] },
      "Verification status": { select: { name: "verified" } },
      "Email verified": { checkbox: true },
      "Verified at": { date: { start: "2026-10-23T01:00:00.000Z" } },
      "Ref code": text("ab12cd34"),
      Suspect: { checkbox: false },
      Flags: { multi_select: [{ name: "ip-repeat" }] },
      "Signup locale": text("ko"),
      ...extra,
    },
  };
}

function fake(responses: Record<string, unknown>[]): { request: NotionRequest; calls: Call[] } {
  const calls: Call[] = [];
  const request: NotionRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    return responses.shift() ?? {};
  };
  return { request, calls };
}

test("a row without the new columns parses with defaults", () => {
  const row = toReferralRow(page("p1"));
  assert.deepEqual(row, {
    pageId: "p1",
    refCode: "ab12cd34",
    canonicalEmail: "p1@example.com",
    status: "verified",
    emailVerified: true,
    verifiedAt: "2026-10-23T01:00:00.000Z",
    suspect: false,
    duplicate: false,
    flags: ["ip-repeat"],
    leaderboard: false,
    nicknameHidden: false,
    noticesOff: false,
    notifiedCount: 0,
    signupLocale: "ko",
    email: "p1@Example.com",
  });
});

test("program columns, Duplicate, Referred by and both canonical shapes are read", () => {
  const row = toReferralRow(
    page("p2", {
      "Referred by": text(" ZZ12CD34 "),
      "Canonical email": { email: "Me@Gmail.com" },
      Duplicate: { checkbox: true },
      Suspect: { checkbox: true },
      [REFERRAL_COLUMNS.nickname]: { rich_text: [{ plain_text: "바다" }, { plain_text: "거북" }] },
      [REFERRAL_COLUMNS.leaderboard]: { checkbox: true },
      [REFERRAL_COLUMNS.nicknameHidden]: { checkbox: true },
      [REFERRAL_COLUMNS.noticesOff]: { checkbox: true },
      [REFERRAL_COLUMNS.notifiedCount]: { number: 4 },
      [REFERRAL_COLUMNS.notifiedAt]: { date: { start: "2026-10-24T00:00:00.000Z" } },
      [REFERRAL_COLUMNS.rewardReview]: { select: { name: "approved" } },
    }),
  );
  assert.equal(row?.referredBy, "zz12cd34");
  assert.equal(row?.canonicalEmail, "me@gmail.com");
  assert.equal(row?.duplicate, true);
  assert.equal(row?.suspect, true);
  assert.equal(row?.nickname, "바다거북");
  assert.equal(row?.leaderboard, true);
  assert.equal(row?.nicknameHidden, true);
  assert.equal(row?.noticesOff, true);
  assert.equal(row?.notifiedCount, 4);
  assert.equal(row?.notifiedAt, "2026-10-24T00:00:00.000Z");
  assert.equal(row?.rewardReview, "approved");
  const legacy = toReferralRow(
    page("p3", {
      "Canonical email": text("old@example.com"),
      "Verification status": { select: null },
      [REFERRAL_COLUMNS.rewardReview]: { select: { name: "maybe" } },
    }),
  );
  assert.equal(legacy?.canonicalEmail, "old@example.com");
  assert.equal(legacy?.status, "legacy");
  assert.equal(legacy?.rewardReview, undefined);
  // Missing canonical column: same canonicalizer as the signup form.
  const fallback = toReferralRow({
    id: "p4",
    properties: { Email: { title: [{ plain_text: "A.B+x@gmail.com" }] } },
  });
  assert.equal(fallback?.canonicalEmail, "ab@gmail.com");
  assert.equal(toReferralRow({ properties: {} }), undefined);
});

test("listProgramRows pages fully with the Ref code / Referred by filter", async () => {
  const { request, calls } = fake([
    { results: [page("p1"), page("p2")], has_more: true, next_cursor: "cur-1" },
    { results: [page("p3")], has_more: false, next_cursor: null },
  ]);
  const rows = await createNotionReferralStore(request, "db1").listProgramRows();
  assert.deepEqual(
    rows.map((r) => r.pageId),
    ["p1", "p2", "p3"],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "databases/db1/query");
  assert.deepEqual((calls[0].body as { filter: unknown }).filter, PROGRAM_ROWS_FILTER);
  assert.deepEqual(PROGRAM_ROWS_FILTER, {
    or: [
      { property: "Ref code", rich_text: { is_not_empty: true } },
      { property: "Referred by", rich_text: { is_not_empty: true } },
    ],
  });
  assert.equal((calls[0].body as { start_cursor?: string }).start_cursor, undefined);
  assert.equal((calls[1].body as { start_cursor?: string }).start_cursor, "cur-1");
});

test("findByRefCode queries one exact code and refuses malformed input", async () => {
  const { request, calls } = fake([{ results: [page("p1")] }]);
  const store = createNotionReferralStore(request, "db1");
  assert.equal((await store.findByRefCode("AB12CD34"))?.pageId, "p1");
  assert.deepEqual((calls[0].body as { filter: unknown }).filter, {
    property: "Ref code",
    rich_text: { equals: "ab12cd34" },
  });
  assert.equal(await store.findByRefCode("bad"), undefined);
  assert.equal(await store.findByRefCode("ab12cd3!"), undefined);
  assert.equal(calls.length, 1);
  const empty = fake([{ results: [] }]);
  assert.equal(
    await createNotionReferralStore(empty.request, "db1").findByRefCode("ab12cd34"),
    undefined,
  );
});

test("writeSettings and markNotified write only their own columns", async () => {
  const { request, calls } = fake([{}, {}, {}]);
  const store = createNotionReferralStore(request, "db1");
  await store.writeSettings("p1", { nickname: "바다거북", leaderboard: true, noticesOff: false });
  await store.writeSettings("p1", { nickname: null, leaderboard: false, noticesOff: true });
  await store.markNotified("p1", { count: 3, at: "2026-10-24T00:00:00.000Z" });
  assert.deepEqual(calls[0], {
    method: "PATCH",
    path: "pages/p1",
    body: {
      properties: {
        "Referral nickname": { rich_text: [{ text: { content: "바다거북" } }] },
        "Referral leaderboard": { checkbox: true },
        "Referral notices off": { checkbox: false },
      },
    },
  });
  assert.deepEqual(
    (calls[1].body as { properties: Record<string, unknown> }).properties["Referral nickname"],
    {
      rich_text: [],
    },
  );
  assert.deepEqual(calls[2].body, {
    properties: {
      "Referral notified count": { number: 3 },
      "Referral notified at": { date: { start: "2026-10-24T00:00:00.000Z" } },
    },
  });
  await assert.rejects(store.markNotified("p1", { count: -1, at: "x" }));
});

test("the write-once leader column parses, and markNotified names it only when asked", async () => {
  const row = toReferralRow(
    page("p1", { "Referral leader reached at": { date: { start: "2026-10-24T03:00:00.000Z" } } }),
  );
  assert.equal(row?.leaderReachedAt, "2026-10-24T03:00:00.000Z");
  assert.equal("leaderReachedAt" in (toReferralRow(page("p2")) ?? {}), false);
  assert.equal(
    "leaderReachedAt" in
      (toReferralRow(page("p3", { "Referral leader reached at": { date: null } })) ?? {}),
    false,
  );

  const { request, calls } = fake([{}, {}]);
  const store = createNotionReferralStore(request, "db1");
  await store.markNotified("p1", {
    count: 10,
    at: "2026-10-24T04:00:00.000Z",
    leaderReachedAt: "2026-10-24T03:00:00.000Z",
  });
  assert.deepEqual(calls[0], {
    method: "PATCH",
    path: "pages/p1",
    body: {
      properties: {
        "Referral notified count": { number: 10 },
        "Referral notified at": { date: { start: "2026-10-24T04:00:00.000Z" } },
        "Referral leader reached at": { date: { start: "2026-10-24T03:00:00.000Z" } },
      },
    },
  });
  await assert.rejects(
    store.markNotified("p1", {
      count: 10,
      at: "2026-10-24T04:00:00.000Z",
      leaderReachedAt: "soon",
    }),
  );
  assert.equal(calls.length, 1, "an unreadable stamp is refused before any write");
});

test("missingColumns: one schema GET, names only; success is cached per process, a miss is not", async () => {
  resetReferralSchemaCache();
  const all = Object.fromEntries(
    Object.values(REFERRAL_COLUMNS).map((name) => [name, { type: "x" }]),
  );
  const { [REFERRAL_COLUMNS.leaderReachedAt]: _gone, ...partial } = all;
  let nowMs = 1_000_000;
  const { request, calls } = fake([
    { properties: partial },
    { properties: all },
    { properties: all },
  ]);
  const store = createNotionReferralStore(request, "db1", { clock: () => nowMs });
  assert.deepEqual(await store.missingColumns(), ["Referral leader reached at"]);
  assert.deepEqual(calls[0], { method: "GET", path: "databases/db1", body: undefined });
  // A miss is re-checked on the next pass, so adding the column takes effect at once.
  assert.deepEqual(await store.missingColumns(), []);
  assert.equal(calls.length, 2);
  // Cached across store instances (one per cron tick) within the window…
  const again = createNotionReferralStore(request, "db1", { clock: () => nowMs });
  nowMs += SCHEMA_CACHE_MS - 1;
  assert.deepEqual(await again.missingColumns(), []);
  assert.equal(calls.length, 2);
  // …and read again after it.
  nowMs += 2;
  assert.deepEqual(await again.missingColumns(), []);
  assert.equal(calls.length, 3);
  // Another database is its own entry.
  const other = fake([{ properties: {} }]);
  const missing = await createNotionReferralStore(other.request, "db2").missingColumns();
  assert.deepEqual(missing, Object.values(REFERRAL_COLUMNS));
  resetReferralSchemaCache();
});

test("a failed schema read propagates and caches nothing", async () => {
  resetReferralSchemaCache();
  let fail = true;
  let reads = 0;
  const request: NotionRequest = async () => {
    reads++;
    if (fail) throw new Error("notion down");
    return { properties: Object.fromEntries(Object.values(REFERRAL_COLUMNS).map((n) => [n, {}])) };
  };
  const store = createNotionReferralStore(request, "db9");
  await assert.rejects(store.missingColumns());
  fail = false;
  assert.deepEqual(await store.missingColumns(), []);
  assert.equal(reads, 2);
  resetReferralSchemaCache();
});

test("definitive rejection rollback can clear only the newly claimed leader date", async () => {
  const { request, calls } = fake([{}]);
  await createNotionReferralStore(request, "db1").markNotified("p1", {
    count: 9, at: "2026-10-22T00:00:00.000Z", clearLeaderReachedAt: true,
  });
  const properties = (calls[0].body as { properties: Record<string, unknown> }).properties;
  assert.deepEqual(properties[REFERRAL_COLUMNS.leaderReachedAt], { date: null });
  assert.deepEqual(properties[REFERRAL_COLUMNS.notifiedCount], { number: 9 });
});
