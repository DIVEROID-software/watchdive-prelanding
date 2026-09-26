import assert from "node:assert/strict";
import test from "node:test";

import { adminCookieMatches, adminPasswordsMatch, adminSessionToken } from "../src/lib/adminAuth.ts";

test("admin sign-in matches the full password and a derived cookie, not a prefix", () => {
  assert.equal(adminPasswordsMatch("correct-horse-1", "correct-horse-1"), true);
  assert.equal(adminPasswordsMatch("correct-horse-1", "correct-horse-2"), false);
  assert.equal(adminPasswordsMatch("short", "longer-secret"), false);
  const token = adminSessionToken("correct-horse-1");
  assert.equal(adminCookieMatches(token, "correct-horse-1"), true);
  assert.equal(adminCookieMatches(token, "correct-horse-2"), false);
  assert.equal(token.includes("correct-horse-1"), false);
});
