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
