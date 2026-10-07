// The public "spots left" figure. It is server-rendered, so it must be cheap to
// read on every request, must not change a second after load, and must never
// pass the baseline off as the whole list when the live count is unreadable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { COUNT_FAILURE_TTL_MS, COUNT_TTL_MS, createCountReader } from "../src/lib/waitlistCount.ts";
import { OFF_PLATFORM_BASELINE } from "../src/lib/waitlistProgress.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a good count is reused for a short while, then read again", async () => {
  let clock = 0;
  let calls = 0;
  const reader = createCountReader(async () => ++calls * 10, { now: () => clock });
  assert.equal(await reader.read(), 10);
  clock = COUNT_TTL_MS - 1;
  assert.equal(await reader.read(), 10);
  assert.equal(calls, 1);
  clock = COUNT_TTL_MS;
  assert.equal(await reader.read(), 20);
  assert.equal(calls, 2);
});

test("concurrent renders share one request", async () => {
  let calls = 0;
  let release!: (value: number) => void;
  const reader = createCountReader(
    () => {
      calls += 1;
      return new Promise<number>((resolve) => (release = resolve));
    },
    { now: () => 0 },
  );
  const pending = Promise.all([reader.read(), reader.read(), reader.read()]);
  await new Promise((resolve) => setImmediate(resolve));
  release(31);
  assert.deepEqual(await pending, [31, 31, 31]);
  assert.equal(calls, 1);
});

test("a failure reads as unknown, is logged once, and is retried after a pause", async () => {
  let clock = 0;
  let calls = 0;
  const errors: unknown[] = [];
  const reader = createCountReader(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("Notion 502 body that must not reach a page");
      return 31;
    },
    { now: () => clock, onError: (error) => errors.push(error) },
  );
  assert.equal(await reader.read(), null);
  assert.equal(errors.length, 1);
  clock = COUNT_FAILURE_TTL_MS - 1;
  assert.equal(await reader.read(), null);
  assert.equal(calls, 1, "a failing CRM is not asked again on every request");
  clock = COUNT_FAILURE_TTL_MS;
  assert.equal(await reader.read(), 31);
});

test("a malformed count is unknown, never a number", async () => {
  for (const bad of [Number.NaN, -1, 1.5, "31" as unknown as number]) {
    const reader = createCountReader(async () => bad, { onError: () => {} });
    assert.equal(await reader.read(), null, String(bad));
  }
});

test("a slow count does not hold the render back, and fills the cache for the next one", async () => {
  let release!: (value: number) => void;
  const reader = createCountReader(() => new Promise<number>((resolve) => (release = resolve)));
  assert.equal(await reader.readWithin(5), null);
  release(31);
  assert.equal(await reader.readWithin(5), 31);
});

test("the server never answers with a baseline-only figure", () => {
  const functions = read("src/lib/api/waitlist.functions.ts");
  const handler = functions.slice(functions.indexOf("export const getWaitlistCount"));
  assert.match(handler, /publicCount\.readWithin\(COUNT_RENDER_BUDGET_MS\)/);
  assert.doesNotMatch(handler.slice(0, 400), /count:\s*0\b/);
  // The failure is logged through the sanitizer (scope + error name only).
  assert.match(functions, /sanitizeServerError\("waitlist-count", error\)/);
  // The cap gate still reads the uncached-by-this-layer counter directly.
  assert.match(functions, /waitlistClosed\(await countableRows\(dbId\)\)/);
  assert.equal(OFF_PLATFORM_BASELINE, 26_321);
});

test("both landing routes render the count on the server and the page hides it when unknown", () => {
  for (const path of ["src/routes/index.tsx", "src/routes/$locale.index.tsx"]) {
    assert.match(
      read(path),
      /waitlistCount[:,]?[\s\S]{0,40}loadWaitlistCount\(\)|loadWaitlistCount\(\)/,
      path,
    );
    assert.match(read(path), /loader:/, path);
  }
  const component = read("src/components/waitlist-progress.tsx");
  assert.match(component, /useLoaderData\(\{ strict: false \}\)/);
  assert.match(component, /initialData: seeded/);
  assert.match(component, /if \(!known\) return null;/);
  // No `?? 0` fallback that would turn "unknown" into the baseline alone.
  assert.doesNotMatch(component, /count \?\? 0/);
});
