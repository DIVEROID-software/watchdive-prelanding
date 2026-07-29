import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLIENT_FUNNEL_EVENT_NAMES,
  MAX_CLIENT_FUNNEL_EVENTS_PER_REQUEST,
  attributionForMeasurementConsent,
  attributionCompleteness,
  hasFunnelAttribution,
  isHalfVisibleIntersection,
  parseFunnelAttribution,
} from "../src/lib/funnel/types.ts";

test("parses the approved UTM and Meta dynamic URL fields", () => {
  const attribution = parseFunnelAttribution(
    "?utm_source=instagram&utm_medium=paid_social&utm_campaign=WD_Leads" +
      "&utm_content=video_01&utm_term=broad&campaign_id=1201&adset_id=1202" +
      "&ad_id=1203&site_source_name=instagram&placement=instagram_reels&fbclid=click-1",
  );

  assert.deepEqual(attribution, {
    utmSource: "instagram",
    utmMedium: "paid_social",
    utmCampaign: "WD_Leads",
    utmContent: "video_01",
    utmTerm: "broad",
    metaCampaignId: "1201",
    metaAdSetId: "1202",
    metaAdId: "1203",
    publisherPlatform: "instagram",
    placement: "instagram_reels",
    fbclid: "click-1",
  });
  assert.equal(attributionCompleteness(attribution), "complete");
});

test("drops unknown and personal query fields", () => {
  const attribution = parseFunnelAttribution(
    "?email=private%40example.com&phone=%2B14155550100&name=Private" +
      "&utm_source=meta&utm_medium=paid_social",
  );

  assert.deepEqual(attribution, {
    utmSource: "meta",
    utmMedium: "paid_social",
  });
  assert.equal("email" in attribution, false);
  assert.equal("phone" in attribution, false);
  assert.equal(attributionCompleteness(attribution), "partial");
});

test("strips control characters and bounds campaign values", () => {
  const longValue = `${"a".repeat(320)}%00%0A`;
  const attribution = parseFunnelAttribution(`?utm_campaign=${longValue}`);

  assert.equal(attribution.utmCampaign?.length, 300);
  assert.equal(attribution.utmCampaign?.includes("\n"), false);
  assert.equal(hasFunnelAttribution(attribution), true);
});

test("returns none for an unattributed visit", () => {
  const attribution = parseFunnelAttribution("?ref=abcd1234");
  assert.deepEqual(attribution, {});
  assert.equal(attributionCompleteness(attribution), "none");
});

test("pre-consent attribution excludes click identifiers but keeps campaign diagnostics", () => {
  const attribution = parseFunnelAttribution(
    "?utm_source=instagram&utm_medium=paid_social&campaign_id=1201&fbclid=click-1",
  );

  assert.deepEqual(attributionForMeasurementConsent(attribution, false), {
    utmSource: "instagram",
    utmMedium: "paid_social",
    metaCampaignId: "1201",
  });
  assert.deepEqual(attributionForMeasurementConsent(attribution, true), attribution);
});

test("CTA exposure requires an intersecting element with at least 50% visibility", () => {
  assert.equal(isHalfVisibleIntersection({ isIntersecting: true, intersectionRatio: 0.49 }), false);
  assert.equal(isHalfVisibleIntersection({ isIntersecting: false, intersectionRatio: 1 }), false);
  assert.equal(isHalfVisibleIntersection({ isIntersecting: true, intersectionRatio: 0.5 }), true);
});

test("client event allowlist includes separate browser Lead and Contact dispatch coverage", () => {
  assert.equal(CLIENT_FUNNEL_EVENT_NAMES.includes("meta_browser_lead_dispatched"), true);
  assert.equal(CLIENT_FUNNEL_EVENT_NAMES.includes("meta_browser_contact_dispatched"), true);
});

test("client and server share the same bounded funnel batch contract", () => {
  assert.equal(MAX_CLIENT_FUNNEL_EVENTS_PER_REQUEST, 10);
});
