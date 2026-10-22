import assert from "node:assert/strict";
import { test } from "node:test";
import { createProgramStateReader } from "../src/lib/referral/programState.ts";

test("client state lookup shares one RPC across concurrent and subsequent loaders", async () => {
  let calls = 0;
  const read = createProgramStateReader(async () => { calls++; return { enabled: true }; });
  const one = read(false);
  assert.equal(read(false), one);
  assert.deepEqual(await one, { enabled: true });
  assert.deepEqual(await read(false), { enabled: true });
  assert.equal(calls, 1);
});

test("hung client state fails closed at timeout and a late ON cannot change the session", async () => {
  let finish!: (state: { enabled: boolean }) => void;
  let calls = 0;
  const read = createProgramStateReader(() => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  }, 5);
  assert.deepEqual(await read(false), { enabled: false });
  finish({ enabled: true });
  assert.deepEqual(await read(false), { enabled: false });
  assert.equal(calls, 1);
});

test("client rejection and synchronous failure fail closed and are memoised", async () => {
  for (const load of [() => Promise.reject(new Error("offline")), () => { throw new Error("offline"); }]) {
    const read = createProgramStateReader(load);
    const one = read(false);
    assert.deepEqual(await one, { enabled: false });
    assert.equal(read(false), one);
  }
});

test("SSR reads per request and is not cached or subjected to client fallback", async () => {
  let calls = 0;
  const read = createProgramStateReader(async () => ({ enabled: ++calls === 1 }));
  assert.deepEqual(await read(true), { enabled: true });
  assert.deepEqual(await read(true), { enabled: false });
  assert.equal(calls, 2);
  await assert.rejects(createProgramStateReader(async () => { throw new Error("SSR failure"); })(true), /SSR failure/);
});
