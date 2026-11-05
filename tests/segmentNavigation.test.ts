import assert from "node:assert/strict";
import { test } from "node:test";
import { SUPPORTED_LOCALES, LOCALE_PATH_SEGMENTS } from "../src/lib/i18n/locale.ts";
import { allowsThirdPartyScripts } from "../src/lib/thirdPartyScripts.ts";
import { isLandingSegment, segmentFromPathname, segmentPath, languageSwitchPath, landingVariantFromPathname, isLandingVariant } from "../src/lib/segments/navigation.ts";

for (const segment of ["freediving", "scuba"] as const) {
  test(`${segment} recognizes exact routes across every locale and English alias`, () => {
    for (const locale of SUPPORTED_LOCALES) {
      const expected = locale === "en" ? `/${segment}` : `/${LOCALE_PATH_SEGMENTS[locale]}/${segment}`;
      assert.equal(segmentPath(segment, locale), expected);
      assert.equal(segmentFromPathname(expected), segment);
      assert.equal(segmentFromPathname(`${expected}/`), segment);
    }
    assert.equal(segmentFromPathname(`/en/${segment}`), segment);
  });
}

test("segment recognition rejects arbitrary URLs, partial routes and unrecognized locales", () => {
  for (const path of ["/", "/ko", "/unknown/scuba", "/ko/scuba/extra", "/scuba-dive", "/Scuba", "/KO/scuba", "//scuba", "https://watchdive.diveroid.com/scuba", "/scuba?next=freediving", "/scuba#offer", "/%73cuba", "/ko/../scuba", "/ko//scuba", "/scuba\\evil", "/verify/scuba", "/scuba\n", "/ko/scuba\r\n"]) {
    assert.equal(segmentFromPathname(path), undefined, path);
  }
  for (const value of [null, undefined, {}, ["scuba"], "scuba/", "https://evil.example", "//evil.example"]) assert.equal(isLandingSegment(value), false);
});

test("language switch preserves segment, attribution query and form anchor without storage", () => {
  const location = { pathname: "/ko/freediving", search: "?utm_source=meta&utm_content=video%204&ref=abcd1234&press_ref=opaque", hash: "#signup-bottom" };
  assert.equal(languageSwitchPath(location, "en"), `/freediving${location.search}${location.hash}`);
  assert.equal(languageSwitchPath(location, "zh-TW"), `/zh-tw/freediving${location.search}${location.hash}`);
  assert.equal(languageSwitchPath({ pathname: "/", search: "?utm_campaign=sg", hash: "#offer-form" }, "ko"), "/ko?utm_campaign=sg#offer-form");
});

test("language switch leaves token fragments on the same isolated route, never in query", () => {
  for (const pathname of ["/verify", "/buddy", "/reservation"]) {
    const target = languageSwitchPath({ pathname, search: "?lang=en", hash: "#signed.fixture-only" }, "ko");
    assert.equal(target, `/ko${pathname}?lang=en#signed.fixture-only`);
    const url = new URL(target, "https://watchdive.diveroid.com");
    assert.equal(url.search.includes("signed.fixture"), false);
    assert.equal(allowsThirdPartyScripts(url.pathname), false);
  }
  for (const pathname of ["https://evil.example/scuba", "//evil.example/scuba"]) {
    assert.throws(() => languageSwitchPath({ pathname, search: "", hash: "" }, "ko"));
  }
});


test("launch routes preserve variant, segment and language without accepting arbitrary paths", () => {
  for (const locale of SUPPORTED_LOCALES) for (const segment of ["scuba", "freediving"] as const) {
    const path = segmentPath(segment, locale, "launch");
    assert.equal(segmentFromPathname(path), segment);
    assert.equal(landingVariantFromPathname(path), "launch");
    assert.equal(landingVariantFromPathname(segmentPath(segment, locale)), "control");
    const search = "?utm_campaign=120251732986720215&utm_term=dive%20watch&fbclid=fixture";
    assert.equal(languageSwitchPath({pathname:path,search,hash:"#signup-middle"},"ko"), `/ko/launch/${segment}${search}#signup-middle`);
  }
  for (const path of ["/launch", "/launch/scuba/extra", "/launch/ko/scuba", "/bad/launch/scuba", "/ko/launch//scuba", "/launch/scuba?variant=launch", "/launch/scuba#signup-middle", "/launch/scuba\n", "//launch/scuba", "https://evil.example/launch/scuba"]) {
    assert.equal(segmentFromPathname(path), undefined, path);
    assert.equal(landingVariantFromPathname(path), undefined, path);
  }
  for (const value of ["/launch/scuba", "new", "https://evil.example", null, {}]) assert.equal(isLandingVariant(value), false);
});
