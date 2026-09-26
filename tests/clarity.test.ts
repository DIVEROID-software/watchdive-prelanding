import assert from "node:assert/strict";
import test from "node:test";

import { readClarityProjectId } from "../src/lib/clarity.ts";

test("Clarity accepts a project id and rejects a measurement id or a blank value", () => {
  assert.equal(readClarityProjectId({}), "");
  assert.equal(readClarityProjectId({ VITE_CLARITY_PROJECT_ID: "G-JFZR7BHTQ3" }), "");
  assert.equal(readClarityProjectId({ VITE_CLARITY_PROJECT_ID: "abcd12ef" }), "abcd12ef");
});
