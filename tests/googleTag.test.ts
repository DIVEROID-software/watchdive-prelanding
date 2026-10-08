import assert from "node:assert/strict";
import test from "node:test";

import {
  googleConsentChoice,
  googleTagBootstrap,
  isGoogleEventId,
  isGoogleTagConfigured,
  readGoogleTagConfig,
} from "../src/lib/googleTag.ts";
import { allowsThirdPartyScripts } from "../src/lib/thirdPartyScripts.ts";

test("google ids that are blank or malformed configure nothing", () => {
  assert.deepEqual(readGoogleTagConfig({}), {});
  assert.deepEqual(
    readGoogleTagConfig({
      VITE_GA_MEASUREMENT_ID: "UA-123",
      VITE_GOOGLE_ADS_ID: "G-ABCD12",
      VITE_GOOGLE_ADS_CONVERSION_LABEL: "label",
    }),
    {},
  );
  assert.equal(isGoogleTagConfigured({}), false);
});

test("a real GA4 id and ads id are kept, and the label needs an ads id", () => {
  const config = readGoogleTagConfig({
    VITE_GA_MEASUREMENT_ID: "G-ABC123XY",
    VITE_GOOGLE_ADS_ID: "AW-123456789",
    VITE_GOOGLE_ADS_CONVERSION_LABEL: "AbC_d-1",
  });
  assert.deepEqual(config, {
    gaId: "G-ABC123XY",
    adsId: "AW-123456789",
    adsLabel: "AbC_d-1",
  });
  assert.equal(
    readGoogleTagConfig({ VITE_GOOGLE_ADS_CONVERSION_LABEL: "AbC_d-1" }).adsLabel,
    undefined,
  );
});

test("Google storage stays off until Allow, and Global Privacy Control overrides Allow", () => {
  assert.equal(googleConsentChoice({ stored: null, gpc: false }), "denied");
  assert.equal(googleConsentChoice({ stored: "granted", gpc: false }), "granted");
  assert.equal(googleConsentChoice({ stored: "denied", gpc: false }), "denied");
  assert.equal(googleConsentChoice({ stored: "granted", gpc: true }), "denied");
  assert.equal(googleConsentChoice({ stored: null, gpc: true }), "denied");
});

test("the bootstrap is empty without ids and refuses a denied browser", () => {
  assert.equal(googleTagBootstrap({}), "");
  const snippet = googleTagBootstrap({ gaId: "G-ABC123XY", adsId: "AW-123456789" });
  assert.match(snippet, /consent","default"/);
  assert.match(snippet, /ad_storage:"denied"/);
  // The shared regional rule gates the loader (see consentRegion.ts).
  assert.match(snippet, /if\(!\(function\(\)\{/);
  assert.match(snippet, /s==="denied"\)return false/);
  assert.match(snippet, /globalPrivacyControl===true\)return false/);
  assert.match(snippet, /wd_geo=/);
  assert.match(snippet, /G-ABC123XY/);
  assert.match(snippet, /AW-123456789/);
  assert.equal(snippet.includes("generate_lead"), false);
});

test("a 64-hex id and its :phone suffix are event ids; 81 characters is not", () => {
  const id = "a".repeat(64);
  assert.equal(isGoogleEventId(id), true);
  assert.equal(isGoogleEventId(`${id}:phone`), true);
  assert.equal(`${id}:phone`.length, 70);
  assert.equal(isGoogleEventId("a".repeat(81)), false);
  assert.equal(isGoogleEventId("short"), false);
});

test("the confirmation page still loads no third-party tag", () => {
  assert.equal(allowsThirdPartyScripts("/verify"), false);
  assert.equal(allowsThirdPartyScripts("/ko/verify"), false);
  assert.equal(allowsThirdPartyScripts("/"), true);
  assert.equal(allowsThirdPartyScripts("/admin/behavior"), false);
});
