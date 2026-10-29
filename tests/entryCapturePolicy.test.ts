import { test } from "node:test";
import assert from "node:assert/strict";
import { entryDismissed, entryReturnFlow, ENTRY_DISMISS_MS } from "../src/components/retargeting/entry-policy.ts";

test("dismissal expires at seven days and corrupt/future values do not persist forever", () => {
  const now = 1800000000000;
  assert.equal(entryDismissed(String(now - ENTRY_DISMISS_MS + 1), now), true);
  assert.equal(entryDismissed(String(now - ENTRY_DISMISS_MS), now), false);
  for (const value of [null, "", "NaN", "Infinity", "0", "-1", String(now + 1)]) assert.equal(entryDismissed(value, now), false);
});
test("verification, checkout and direct signup returns bypass the entry prompt", () => {
  for (const key of ["auth", "token", "attempt", "session_id", "reservation", "unsubscribe"]) assert.equal(entryReturnFlow(`?${key}=anything`, ""), true);
  assert.equal(entryReturnFlow("", "#signup-middle"), true);
  assert.equal(entryReturnFlow("?utm_campaign=120251732986720215&ref=abcd1234", ""), false);
});
