import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ATTRIBUTION_VALUE_MAX,
  hasCampaignSignal,
  mergeAttribution,
  readAttribution,
  sanitizeAttribution,
  sanitizeAttributionValue,
  sanitizeFbclid,
  sanitizeLandingPath,
  toLeadAttribution,
} from "../src/lib/attribution.ts";
import { attributionProperties } from "../src/lib/verification/notionLead.ts";

const NOW = 1_784_000_000_000;

// --- first-touch precedence ------------------------------------------------

test("a tagged landing is captured whole", () => {
  const captured = readAttribution(
    "?utm_source=meta&utm_medium=paid_social&utm_campaign=202607_en_wd&utm_content=v4&utm_term=divers&fbclid=IwAR0abc",
    "/",
    NOW,
  );

  assert.deepEqual(captured, {
    utmSource: "meta",
    utmMedium: "paid_social",
    utmCampaign: "202607_en_wd",
    utmContent: "v4",
    utmTerm: "divers",
    landingPath: "/",
    fbclid: "IwAR0abc",
    capturedAt: NOW,
  });
});

test("a later untagged navigation never blanks a stored campaign", () => {
  const first = readAttribution("?utm_source=meta&utm_campaign=202607_en_wd", "/", NOW);
  const internal = readAttribution("", "/privacy", NOW + 60_000);

  const merged = mergeAttribution(first, internal);

  assert.equal(merged.utmSource, "meta");
  assert.equal(merged.utmCampaign, "202607_en_wd");
  assert.equal(merged.landingPath, "/");
});

test("a second campaign does not overwrite the one that paid for the visit", () => {
  const first = readAttribution("?utm_source=meta&utm_campaign=first", "/", NOW);
  const second = readAttribution("?utm_source=google&utm_campaign=second", "/", NOW + 60_000);

  assert.equal(mergeAttribution(first, second).utmCampaign, "first");
});

test("fbclid alone counts as a first touch worth keeping", () => {
  const first = readAttribution("?fbclid=IwAR0abc", "/", NOW);
  const later = readAttribution("?utm_source=google", "/", NOW + 60_000);

  assert.equal(mergeAttribution(first, later).fbclid, "IwAR0abc");
  assert.equal(mergeAttribution(first, later).utmSource, undefined);
});

test("a stored direct visit still lets a real campaign claim the visitor", () => {
  const direct = readAttribution("", "/", NOW);
  const campaign = readAttribution("?utm_source=meta", "/", NOW + 60_000);

  assert.equal(hasCampaignSignal(direct), false);
  assert.equal(mergeAttribution(direct, campaign).utmSource, "meta");
});

test("with nothing stored, an untagged landing is still recorded as the path", () => {
  const merged = mergeAttribution(undefined, readAttribution("", "/offer", NOW));

  assert.deepEqual(merged, { landingPath: "/offer" });
});

// --- sanitisation ----------------------------------------------------------

test("control characters and quoting tricks never reach a CRM cell", () => {
  // `/` survives: ad platforms put paths in utm_content and it is inert here.
  assert.equal(
    sanitizeAttributionValue('meta"><script>alert(1)</script>'),
    "metascriptalert1/script",
  );
  assert.equal(sanitizeAttributionValue("summer\n\tsale"), "summer sale");
  assert.equal(sanitizeAttributionValue("  spaced  "), "spaced");
  // `=` and `@` are dropped, which is also what a spreadsheet export needs.
  assert.equal(sanitizeAttributionValue("=cmd|'/c calc'!A1"), "cmd|/c calcA1");
});

test("attribution values are bounded", () => {
  const long = "a".repeat(ATTRIBUTION_VALUE_MAX + 500);
  assert.equal(sanitizeAttributionValue(long).length, ATTRIBUTION_VALUE_MAX);
});

test("non-strings contribute nothing", () => {
  assert.equal(sanitizeAttributionValue(undefined), "");
  assert.equal(sanitizeAttributionValue(null), "");
  assert.equal(sanitizeAttributionValue(42), "");
  assert.equal(sanitizeAttributionValue({ toString: () => "meta" }), "");
  assert.deepEqual(sanitizeAttribution(null), {});
});

test("a landing path keeps only a path", () => {
  assert.equal(sanitizeLandingPath("/offer?utm_source=meta#form"), "/offer");
  assert.equal(sanitizeLandingPath("offer"), "/offer");
  assert.equal(sanitizeLandingPath("//evil.example.com/x"), "/evil.example.com/x");
  assert.equal(sanitizeLandingPath(""), "");
});

test("fbclid keeps only token characters", () => {
  assert.equal(sanitizeFbclid("IwAR0-abc_def.9"), "IwAR0-abc_def.9");
  assert.equal(sanitizeFbclid("abc<>&'\" def"), "abcdef");
});

test("storage that has been tampered with is re-bounded on read", () => {
  const restored = sanitizeAttribution({
    utmSource: "meta<img src=x>",
    utmCampaign: "b".repeat(ATTRIBUTION_VALUE_MAX + 10),
    landingPath: "https://evil.example.com/x?a=1",
    fbclid: 12345,
    capturedAt: "not-a-number",
  });

  assert.equal(restored.utmSource, "metaimg srcx");
  assert.equal(restored.utmCampaign?.length, ATTRIBUTION_VALUE_MAX);
  // Stripped of its scheme it is no longer a URL, just an odd-looking path.
  assert.equal(restored.landingPath, "/https//evil.example.com/x");
  assert.equal(restored.fbclid, undefined);
  assert.equal(restored.capturedAt, undefined);
});

test("the capture time travels only with the click id it dates", () => {
  assert.equal(readAttribution("?utm_source=meta", "/", NOW).capturedAt, undefined);
  assert.equal(readAttribution("?fbclid=IwAR0abc", "/", NOW).capturedAt, NOW);
});

// --- what crosses into the CRM --------------------------------------------

test("the click id stops at the server", () => {
  const lead = toLeadAttribution(readAttribution("?utm_source=meta&fbclid=IwAR0abc", "/", NOW));

  assert.deepEqual(lead, { utmSource: "meta", landingPath: "/" });
  assert.equal("fbclid" in lead, false);
  assert.equal("capturedAt" in lead, false);
});

// --- Notion property mapping ----------------------------------------------

test("attribution maps onto the exact live column names", () => {
  const properties = attributionProperties({
    utmSource: "meta",
    utmMedium: "paid_social",
    utmCampaign: "202607_en_wd",
    utmContent: "v4",
    utmTerm: "divers",
    landingPath: "/offer",
  });

  assert.deepEqual(Object.keys(properties).sort(), [
    "Landing path",
    "UTM Campaign",
    "UTM Content",
    "UTM Medium",
    "UTM Source",
    "UTM Term",
  ]);
  assert.deepEqual(properties["UTM Source"], { rich_text: [{ text: { content: "meta" } }] });
  assert.deepEqual(properties["Landing path"], { rich_text: [{ text: { content: "/offer" } }] });
});

test("a partly tagged URL leaves the remaining columns untouched", () => {
  const properties = attributionProperties({
    utmSource: "meta",
    utmMedium: "",
    utmCampaign: "   ",
    landingPath: "/",
  });

  assert.deepEqual(Object.keys(properties).sort(), ["Landing path", "UTM Source"]);
});

test("no attribution writes no properties at all", () => {
  assert.deepEqual(attributionProperties(undefined), {});
  assert.deepEqual(attributionProperties({}), {});
});
