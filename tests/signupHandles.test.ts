// Handles kept so a later refusal (reload, "Wrong address?", footer Cookie
// settings) still reaches the signup row — QA round 7.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  rememberSignupHandle,
  SIGNUP_HANDLE_TTL_MS,
  SIGNUP_HANDLES_KEY,
  storedSignupHandles,
} from "../src/lib/signupHandles.ts";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const NOW = 1_800_000_000_000;
const handle = (issuedAt: number, tag = "a") =>
  `aaaaaaaa-bbbb-4ccc-8ddd-00000000000${tag}.${issuedAt}.1.${"S".repeat(60)}.${"M".repeat(43)}`;

test("handles survive in storage, newest first, deduplicated and capped", () => {
  const storage = memory();
  for (let i = 0; i < 12; i++) rememberSignupHandle(handle(NOW - i, String(i % 10)), storage, NOW);
  rememberSignupHandle(handle(NOW, "0"), storage, NOW);
  const kept = storedSignupHandles(storage, NOW);
  assert.equal(kept.length, 10);
  assert.equal(kept[0], handle(NOW, "0"));
  assert.equal(new Set(kept).size, kept.length);
});

test("expired and malformed entries are dropped", () => {
  const storage = memory();
  storage.setItem(
    SIGNUP_HANDLES_KEY,
    JSON.stringify([handle(NOW - SIGNUP_HANDLE_TTL_MS - 1), 42, "short", handle(NOW, "b")]),
  );
  assert.deepEqual(storedSignupHandles(storage, NOW), [handle(NOW, "b")]);
  storage.setItem(SIGNUP_HANDLES_KEY, "{not json");
  assert.deepEqual(storedSignupHandles(storage, NOW), []);
});

test("the footer's Reject all withdraws every kept signup handle and waits for the result", () => {
  const bar = readFileSync("src/components/cookie-choice-bar.tsx", "utf8");
  const reject = bar.slice(bar.indexOf('setMetaMeasurementConsent("denied")'));
  assert.ok(reject.indexOf("storedSignupHandles()") < reject.indexOf("announceMeasurementChoice"));
  assert.ok(reject.includes("expectServerWithdrawal()"));
  assert.ok(reject.includes("withdrawStoredSignups(kept)"));
  assert.ok(reject.includes('noteMeasurementSettled({ choice: "denied", recorded })'));
  const form = readFileSync("src/routes/index.tsx", "utf8");
  assert.ok(form.includes("rememberSignupHandle(res.handle)"));
});

test("the CRM leg re-reads the row after the website call", () => {
  const deps = readFileSync("src/lib/verification/deps.server.ts", "utf8");
  const website = deps.indexOf("await sendMetaEmailVerified");
  const check = deps.indexOf("await stillAllowed()");
  const crm = deps.indexOf("await sendMetaCrmQualifiedLead");
  assert.ok(website > 0 && website < check && check < crm);
});
