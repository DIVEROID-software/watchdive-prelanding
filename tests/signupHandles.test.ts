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
  // One caller per Reject all: the on-screen signup's listener, or the bar.
  assert.ok(reject.indexOf("announceMeasurementChoice") < reject.indexOf("storedSignupHandles()"));
  assert.ok(reject.includes("if (!takeServerWithdrawalExpected())"));
  assert.ok(reject.includes("expectServerWithdrawal()"));
  assert.ok(reject.includes("withdrawEverySignup(kept)"));
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

test("the browser keeps handles exactly as long as the server lets them refuse", async () => {
  const { WITHDRAW_HANDLE_TTL_MS, VERIFICATION_TTL_MS } =
    await import("../src/lib/verification/contracts.ts");
  const { VERIFICATION_REMINDER_MAX_AGE_MS } = await import("../src/lib/verification/reminder.ts");
  assert.equal(SIGNUP_HANDLE_TTL_MS, WITHDRAW_HANDLE_TTL_MS);
  assert.ok(WITHDRAW_HANDLE_TTL_MS >= VERIFICATION_REMINDER_MAX_AGE_MS + VERIFICATION_TTL_MS);
});

test("the browser-wide refusal receipt is set only when every kept signup was recorded", () => {
  const helper = readFileSync("src/lib/signupHandleWithdrawal.ts", "utf8");
  assert.ok(helper.includes("if (all) markWithdrawalRecorded();"));
  for (const file of [
    "src/routes/index.tsx",
    "src/routes/verify.tsx",
    "src/components/cookie-choice-bar.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("markWithdrawalRecorded()"), false, file);
    assert.ok(source.includes("withdrawEverySignup("), file);
  }
  // Every caller that reports success uses the helper's own result.
  assert.ok(
    readFileSync("src/routes/verify.tsx", "utf8").includes("return await withdrawEverySignup();"),
  );
  assert.ok(readFileSync("src/routes/index.tsx", "utf8").includes("return withdrawEverySignup("));
  assert.equal(
    /await withdrawEverySignup\(\);\s*return true/.test(
      readFileSync("src/routes/verify.tsx", "utf8"),
    ),
    false,
  );
});
