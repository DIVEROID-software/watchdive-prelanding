import assert from "node:assert/strict";
import { test } from "node:test";

import { spamFolderHintFor } from "../src/lib/spamFolderHint.ts";

test("Yahoo, Apple and Microsoft addresses get their spam-folder line; others none", () => {
  for (const address of ["a@yahoo.com", "a@yahoo.co.uk", "a@ymail.com", "A@AOL.com "]) {
    assert.equal(spamFolderHintFor(address), "providerYahoo", address);
  }
  for (const address of ["a@icloud.com", "a@me.com", "a@mac.com"]) {
    assert.equal(spamFolderHintFor(address), "providerApple", address);
  }
  for (const address of ["a@outlook.com", "a@hotmail.co.uk", "a@live.fr", "a@msn.com"]) {
    assert.equal(spamFolderHintFor(address), "providerOutlook", address);
  }
  for (const address of [
    "a@gmail.com",
    "a@naver.com",
    "a@mesh.com",
    "a@me.com.evil.io",
    "a@notyahoo.com",
    "",
  ]) {
    assert.equal(spamFolderHintFor(address), undefined, address);
  }
});
