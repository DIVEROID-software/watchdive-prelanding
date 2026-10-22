import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  NOTION_BACKOFF_MS,
  REFERRAL_COUNT_CACHE_MS,
  createReferralCountCache,
  isNotionRateLimited,
  loadReferralTally,
  loadLegacyReferralCount,
  withNotionBackoff,
  withRateLimitBackoff,
} from "../src/lib/api/referralCount.ts";
import { NotionRequestError, type NotionRequest } from "../src/lib/verification/notionLead.ts";

const noSleep = { sleep: async () => {}, random: () => 0.5 };

function rateLimited(): NotionRequestError {
  return new NotionRequestError(429, '{"code":"rate_limited"}');
}

test("a malformed code is 0 without loading anything", async () => {
  let loads = 0;
  const cache = createReferralCountCache(async () => {
    loads += 1;
    return new Map([["abcd1234", 2]]);
  });
  for (const code of ["", "abc", "ABCD1234", "abcd12345", "abcd-123", "abcd 123"]) {
    assert.equal(await cache.count(code), 0, code);
  }
  assert.equal(loads, 0);
});

test("one tally serves every code until it is stale, then refreshes once", async () => {
  let loads = 0;
  let nowMs = 1_000;
  const cache = createReferralCountCache(
    async () => {
      loads += 1;
      return new Map([["abcd1234", loads + 1]]);
    },
    { now: () => nowMs },
  );
  assert.equal(await cache.count("abcd1234"), 2);
  // Random well-formed codes cost no extra read.
  for (let i = 0; i < 50; i++)
    assert.equal(await cache.count(`zz${String(i).padStart(6, "0")}`), 0);
  assert.equal(loads, 1);
  nowMs += REFERRAL_COUNT_CACHE_MS - 1;
  assert.equal(await cache.count("abcd1234"), 2);
  assert.equal(loads, 1);
  nowMs += 1;
  assert.equal(await cache.count("abcd1234"), 3);
  assert.equal(loads, 2);
});

test("concurrent readers share one refresh", async () => {
  let loads = 0;
  let release: (value: Map<string, number>) => void = () => {};
  const cache = createReferralCountCache(() => {
    loads += 1;
    return new Promise((resolve) => (release = resolve));
  });
  const reads = Array.from({ length: 20 }, () => cache.count("abcd1234"));
  release(new Map([["abcd1234", 4]]));
  assert.deepEqual(await Promise.all(reads), Array(20).fill(4));
  assert.equal(loads, 1);
});

test("a failed refresh serves the last good tally; with none it throws and is retried", async () => {
  let nowMs = 0;
  let fail = true;
  let loads = 0;
  const cache = createReferralCountCache(
    async () => {
      loads += 1;
      if (fail) throw new Error("notion down");
      return new Map([["abcd1234", 1]]);
    },
    { now: () => nowMs },
  );
  await assert.rejects(cache.count("abcd1234"), /notion down/);
  fail = false;
  assert.equal(await cache.count("abcd1234"), 1);
  nowMs += REFERRAL_COUNT_CACHE_MS;
  fail = true;
  assert.equal(await cache.count("abcd1234"), 1);
  assert.equal(loads, 3);
});

test("429s are retried with backoff; other errors and the last 429 are thrown", async () => {
  assert.equal(isNotionRateLimited(rateLimited()), true);
  assert.equal(isNotionRateLimited(new NotionRequestError(500, "")), false);
  assert.equal(isNotionRateLimited(new Error("x")), false);

  const waits: number[] = [];
  let calls = 0;
  const value = await withNotionBackoff(
    async () => {
      calls += 1;
      if (calls < 3) throw rateLimited();
      return "ok";
    },
    { sleep: async (ms) => void waits.push(ms), random: () => 0.5 },
  );
  assert.equal(value, "ok");
  assert.deepEqual(waits, [NOTION_BACKOFF_MS[0], NOTION_BACKOFF_MS[1]]);

  calls = 0;
  await assert.rejects(
    withNotionBackoff(async () => {
      calls += 1;
      throw rateLimited();
    }, noSleep),
    (error: unknown) => isNotionRateLimited(error),
  );
  assert.equal(calls, NOTION_BACKOFF_MS.length + 1);

  calls = 0;
  await assert.rejects(
    withNotionBackoff(async () => {
      calls += 1;
      throw new NotionRequestError(400, "");
    }, noSleep),
  );
  assert.equal(calls, 1);
});

test("withRateLimitBackoff wraps a NotionRequest transparently", async () => {
  const seen: unknown[] = [];
  let calls = 0;
  const request: NotionRequest = async (method, path, body) => {
    calls += 1;
    seen.push([method, path, body]);
    if (calls === 1) throw rateLimited();
    return { ok: true };
  };
  const wrapped = withRateLimitBackoff(request, noSleep);
  assert.deepEqual(await wrapped("PATCH", "pages/x", { a: 1 }), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(seen[1], ["PATCH", "pages/x", { a: 1 }]);
});

function page(referredBy: string | undefined) {
  return {
    properties: {
      "Referred by": { rich_text: referredBy === undefined ? [] : [{ plain_text: referredBy }] },
    },
  };
}

test("the tally pages fully, keeps the countable filter and counts exact codes", async () => {
  const bodies: Record<string, unknown>[] = [];
  const request: NotionRequest = async (_method, _path, body) => {
    bodies.push(body as Record<string, unknown>);
    return bodies.length === 1
      ? {
          results: [page("abcd1234"), page("abcd1234"), page("wxyz9876"), page("")],
          has_more: true,
          next_cursor: "c2",
        }
      : { results: [page("abcd1234"), page("ABCD1234"), page("abcd1234 junk")], has_more: false };
  };
  const filter = { and: [{ property: "Suspect", checkbox: { equals: false } }] };
  const tally = await loadReferralTally(request, "db", filter);
  assert.deepEqual([...tally].sort(), [
    ["abcd1234", 3],
    ["wxyz9876", 1],
  ]);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].start_cursor, "c2");
  assert.deepEqual(bodies[0].filter, filter);
});

test("OFF count reads only the requested code, pages its matches and never caches stale data", async () => {
  const calls: { path: string; body: any }[] = [];
  const countable = [{ property: "Suspect", checkbox: { equals: false } }];
  const request = async (path: string, body: unknown) => {
    calls.push({ path, body });
    return calls.length === 1
      ? { results: [1, 2], has_more: true, next_cursor: "next" }
      : { results: [3], has_more: false };
  };
  assert.equal(await loadLegacyReferralCount(request, "db", "abc", countable), 3);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.path, "databases/db/query");
    assert.deepEqual(call.body.filter, {
      and: [{ property: "Referred by", rich_text: { equals: "abc" } }, ...countable],
    });
  }
  assert.equal(calls[1].body.start_cursor, "next");
  assert.equal(await loadLegacyReferralCount(request, "db", "abc", countable), 1);
  assert.equal(calls.length, 3);
  await assert.rejects(loadLegacyReferralCount(async () => { throw new Error("unavailable"); }, "db", "abc", countable), /unavailable/);
});

test("getReferralCount keeps the legacy OFF query and isolates the ON ledger", () => {
  const source = readFileSync(new URL("../src/lib/api/waitlist.functions.ts", import.meta.url), "utf8");
  const start = source.indexOf("export const getReferralCount");
  const body = source.slice(start, source.indexOf("\n  });", start));
  assert.match(body, /if \(!dbId \|\| !code\) return \{ count: 0 \}/);
  assert.match(body, /referralProgramEnabled\(process\.env\)/);
  assert.match(body, /getReferralProgressService\(code/);
  assert.match(body, /loadLegacyReferralCount\(notionFetch, dbId, code, COUNTABLE\.and\)/);
  assert.doesNotMatch(source, /loadReferralTally|createReferralCountCache/);
});
