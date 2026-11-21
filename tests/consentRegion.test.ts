import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { readBrowserCookies, writeBrowserCookie } from "../src/lib/browserCookies.ts";

import {
  CONSENT_REQUIRED_COUNTRIES,
  consentRegionFor,
  geoCookie,
  INLINE_MEASUREMENT_ALLOWED_JS,
  measurementAllowedFor,
  normalizeCountry,
  resolveGeoCountryWithin,
  resetGeoLookupForTests,
  measurementAllowed,
} from "../src/lib/consentRegion.ts";

test("EU/EEA, UK and Switzerland need an opt-in; the US and the rest do not", () => {
  for (const country of ["DE", "FR", "IE", "NL", "IS", "NO", "LI", "GB", "CH", "JE"]) {
    assert.equal(consentRegionFor(country), "opt-in", country);
  }
  for (const country of ["US", "CA", "KR", "JP", "AU", "BR", "MX"]) {
    assert.equal(consentRegionFor(country), "default-on", country);
  }
  assert.equal(CONSENT_REQUIRED_COUNTRIES.size >= 27 + 3 + 1 + 1, true);
});

test("an unknown or malformed country fails closed", () => {
  for (const value of [undefined, null, "", "XX", "ZZZ", "u", "1A"]) {
    assert.equal(consentRegionFor(value), "opt-in", String(value));
  }
  assert.equal(normalizeCountry(" us "), "US");
  assert.equal(normalizeCountry("XX"), undefined);
});

test("stored Not now and GPC always win; Allow always turns it on", () => {
  assert.equal(measurementAllowedFor({ stored: null, gpc: false, country: "US" }), true);
  assert.equal(measurementAllowedFor({ stored: "denied", gpc: false, country: "US" }), false);
  assert.equal(measurementAllowedFor({ stored: null, gpc: true, country: "US" }), false);
  assert.equal(measurementAllowedFor({ stored: "granted", gpc: true, country: "US" }), false);
  assert.equal(measurementAllowedFor({ stored: null, gpc: false, country: "DE" }), false);
  assert.equal(measurementAllowedFor({ stored: "granted", gpc: false, country: "DE" }), true);
  assert.equal(measurementAllowedFor({ stored: null, gpc: false, country: undefined }), false);
});

test("the inline head rule matches the module rule", () => {
  const run = (stored: string | null, gpc: boolean, cookie: string) =>
    vm.runInNewContext(INLINE_MEASUREMENT_ALLOWED_JS, {
      localStorage: { getItem: () => stored },
      navigator: { globalPrivacyControl: gpc },
      document: { cookie },
    });
  assert.equal(run(null, false, "a=1; wd_geo=US"), true);
  assert.equal(run(null, false, "wd_geo=DE"), false);
  assert.equal(run(null, false, "wd_geo=XX"), false);
  assert.equal(run(null, false, ""), false);
  assert.equal(run("denied", false, "wd_geo=US"), false);
  assert.equal(run(null, true, "wd_geo=US"), false);
  assert.equal(run("granted", false, "wd_geo=GB"), true);
});

test("the geo cookie is readable by the page and records unknown as XX", () => {
  assert.equal(geoCookie("US", true), "wd_geo=US; Path=/; Max-Age=86400; SameSite=Lax; Secure");
  assert.equal(geoCookie(undefined, false), "wd_geo=XX; Path=/; Max-Age=86400; SameSite=Lax");
  assert.equal(geoCookie("US", true).includes("HttpOnly"), false);
});

test("a browser denying cookie access can continue verification with optional tracking off", async (t) => {
  const blocked = {
    get cookie(): string { throw new DOMException("Access denied", "SecurityError"); },
    set cookie(_value: string) { throw new DOMException("Access denied", "SecurityError"); },
  };
  const before = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: blocked });
  t.after(() => {
    if (before) Object.defineProperty(globalThis, "document", before);
    else Reflect.deleteProperty(globalThis, "document");
    resetGeoLookupForTests();
  });
  t.mock.method(globalThis, "fetch", async () => new Response('{"country":null}'));
  assert.equal(await resolveGeoCountryWithin(100), undefined);
  assert.equal(measurementAllowed(), false);
  assert.equal(readBrowserCookies(), "");
  assert.equal(writeBrowserCookie("qa=1"), false);
  assert.equal(vm.runInNewContext(INLINE_MEASUREMENT_ALLOWED_JS, {
    document: blocked, navigator: {}, localStorage: { getItem: () => null },
  }), false);
});
