import assert from "node:assert/strict";
import test from "node:test";

import { allowsThirdPartyScripts } from "../src/lib/thirdPartyScripts.ts";

test("the reservation page does not load chat, analytics, or other third-party scripts", () => {
  for (const path of [
    "/reservation",
    "/reservation/",
    "/ko/reservation",
    "/en/reservation",
    "/ja/reservation",
    "/reservation?lang=ko",
  ]) {
    assert.equal(allowsThirdPartyScripts(path), false, path);
  }
  assert.equal(allowsThirdPartyScripts("/"), true);
  assert.equal(allowsThirdPartyScripts("/privacy"), true);
  assert.equal(allowsThirdPartyScripts("/terms"), true);
});

test("the Buddy Invite status page keeps its signed token away from every third-party tag", () => {
  const token = "abcd2345.1.AAAAAAAAAAAAAAAAAAAAAAAA";
  for (const path of [
    // Current links carry the token in the fragment; the pathname is bare.
    "/ko/buddy",
    "/en/buddy",
    "/zh-tw/buddy/",
    // Retired path-token links stay isolated too.
    `/buddy/${token}`,
    `/buddy/${token}/`,
    `/ko/buddy/${token}`,
    `/ja/buddy/${token}`,
    `/zh-tw/buddy/${token}`,
    `/en/buddy/${token}`,
    "/buddy",
    "/buddy/",
  ]) {
    assert.equal(allowsThirdPartyScripts(path), false, path);
  }
  // The public rules page and share links carry no credential.
  assert.equal(allowsThirdPartyScripts("/buddy-rules"), true);
  assert.equal(allowsThirdPartyScripts("/ko/buddy-rules"), true);
  assert.equal(allowsThirdPartyScripts("/r/abcd2345"), true);
});
