// Source locks for the consent repairs that have no DOM harness. The server
// races are exercised in measurementGrant.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("footer Accept under Global Privacy Control returns before it stores or starts tags", () => {
  const source = read("src/components/cookie-choice-bar.tsx");
  const start = source.indexOf("function choose(");
  const choose = source.slice(start, start + 1600);
  const gpc = choose.indexOf("globalPrivacyControlOn()");
  const store = choose.indexOf("setMetaMeasurementConsent");
  const pixel = choose.indexOf("initMetaPixel()");
  assert.ok(gpc >= 0 && store > gpc && pixel > store);
  assert.ok(choose.includes("if (globalPrivacyControlOn()) return;"));
  assert.ok(source.includes('role={withdrawPending ? "alert" : undefined}'));
});

test("the measurement card does not store Allow under Global Privacy Control", () => {
  const source = read("src/components/measurement-ask.tsx");
  const choose = source.slice(source.indexOf("const choose = (choice"));
  const gpc = choose.indexOf("browserGpc()");
  const store = choose.indexOf("setMetaMeasurementConsent");
  assert.ok(gpc >= 0 && gpc < store);
  assert.ok(choose.includes("if (browserGpc()) return;"));
  assert.ok(source.includes('role="alert"'));
  assert.ok(source.includes("watchdive.measurement-withdrawal-recorded.v1"));
});

test("the inbox grant checks permission before tags and does not fire a browser Lead", () => {
  const source = read("src/routes/index.tsx");
  const allow = source.slice(
    source.indexOf("async function allowMeasurementAfterSubmit"),
    source.indexOf("async function declineMeasurementAfterSubmit"),
  );
  const permitted = allow.indexOf("measurementPermitted()");
  const pixel = allow.indexOf("initMetaPixel()");
  assert.ok(permitted >= 0 && permitted < pixel);
  assert.equal(allow.includes("submitLead"), false);
  assert.equal(allow.includes("res.browserLead"), false);
  assert.ok(source.includes("declineMeasurementAfterSubmit(res.handle)"));
  assert.ok(source.includes("withdrawalNeedsRetry()"));
});

test("the server trusts Sec-GPC and not a body field", () => {
  const source = read("src/lib/api/waitlist.functions.ts");
  assert.ok(source.includes('getRequestHeader("sec-gpc") === "1"'));
  assert.ok(source.includes("!globalPrivacyControl"));
  assert.equal(source.includes("data.gpc"), false);
  assert.equal(source.includes("data.secGpc"), false);
});
