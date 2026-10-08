import assert from "node:assert/strict";
import test from "node:test";
import { createWithdrawalBatch } from "../src/lib/measurementSettlement.ts";

test("one signup's successful withdrawal cannot hide the other signup's failure", () => {
  for (const results of [[false, true], [true, false]]) {
    const batch = createWithdrawalBatch();
    batch.begin();
    batch.begin();
    assert.equal(batch.settle(results[0]), false);
    assert.equal(batch.settle(results[1]), false);
    // An explicit retry can resolve the failure, but only after every call settles.
    batch.begin();
    batch.begin();
    assert.equal(batch.settle(true), false);
    assert.equal(batch.settle(true), true);
  }
});
