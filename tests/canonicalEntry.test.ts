import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { LOCALE_PATH_SEGMENTS, SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { canonicalScubaHref, legacyHomeAnchor } from "../src/lib/segments/canonical-entry.ts";

const RAW_QUERY =
  "?utm_source=meta&utm_medium=paid&utm_campaign=sg&utm_content=video%204&utm_term=dive%2Bwatch&fbclid=IwAR0&gclid=EAIa&ttclid=tt.1&ref=abcd1234&press_ref=opaque_ref&wd_click=click%3D1&social=ig";

test("every locale home, including the English alias, opens scuba and keeps the raw query and fragment", () => {
  assert.equal(canonicalScubaHref({ pathname: "/", searchStr: RAW_QUERY, hash: "offer-form" }), `/scuba${RAW_QUERY}#offer-form`);
  assert.equal(canonicalScubaHref({ pathname: "/", searchStr: "", hash: "" }), "/scuba");

  for (const locale of SUPPORTED_LOCALES) {
    const prefix = locale === "en" ? "" : `/${LOCALE_PATH_SEGMENTS[locale]}`;
    const home = locale === "en" ? "/" : `${prefix}`;
    const alias = `/${LOCALE_PATH_SEGMENTS[locale]}`;
    for (const pathname of new Set([home, `${alias}/`, alias])) {
      const href = canonicalScubaHref({ pathname, searchStr: RAW_QUERY, hash: "signed.fixture-only" });
      assert.equal(href, `${prefix}/scuba${RAW_QUERY}#signed.fixture-only`, pathname);
      const url = new URL(href ?? "/", "https://watchdive.diveroid.com");
      assert.equal(url.search, RAW_QUERY);
      assert.equal(url.hash, "#signed.fixture-only");
      assert.equal(url.search.includes("signed.fixture"), false);
      assert.equal(url.search.includes("invite"), false);
      assert.equal(canonicalScubaHref({ pathname: url.pathname, searchStr: url.search, hash: url.hash.slice(1) }), undefined, pathname);
    }
  }
});

test("non-home routes are not redirected and a second pass cannot loop", () => {
  for (const pathname of [
    "/scuba",
    "/scuba/",
    "/freediving",
    "/ko/freediving",
    "/en/scuba",
    "/en/freediving",
    "/ko/scuba",
    "/zh-cn/scuba",
    "/pt-br/freediving",
    "/privacy",
    "/terms",
    "/verify",
    "/ko/verify",
    "/buddy",
    "/ko/buddy",
    "/buddy-rules",
    "/reservation",
    "/r/abcd1234",
    "/ko/r/abcd1234",
    "/api/geo",
    "/unsubscribe/token",
    "/admin/behavior",
    "/unknown",
    "/KO/scuba",
    "//scuba",
    "/scuba?next=freediving",
    "/ko/../scuba",
  ]) {
    assert.equal(canonicalScubaHref({ pathname, searchStr: RAW_QUERY, hash: "offer-form" }), undefined, pathname);
  }
  assert.equal(canonicalScubaHref({ pathname: "/ko", searchStr: "?next=/freediving#invite=secret", hash: "invite=opaque" }), "/ko/scuba?next=/freediving#invite=opaque");
  const bearer = canonicalScubaHref({ pathname: "/fr/", searchStr: "?ref=abcd1234", hash: "#invite=opaque-token" });
  assert.equal(bearer, "/fr/scuba?ref=abcd1234#invite=opaque-token");
  assert.equal(new URL(bearer ?? "/", "https://watchdive.diveroid.com").search, "?ref=abcd1234");
});

test("legacy signup anchors map to segment ids without touching the query", () => {
  assert.equal(legacyHomeAnchor("#offer-form"), "#signup-bottom");
  assert.equal(legacyHomeAnchor("compatibility"), "#segment-compatibility");
  for (const hash of ["#constructor", "#toString", "#__proto__", "#signup-middle", "#signup-bottom", "#hero-email", "#offer-email", "#segment-hero", "#signed.fixture-only", "#invite=opaque-token", "#offer-form?token=secret", "", "#"]) {
    assert.equal(legacyHomeAnchor(hash), undefined, hash);
  }
  const landing = `${canonicalScubaHref({ pathname: "/ko", searchStr: RAW_QUERY, hash: "offer-form" })}`;
  const url = new URL(landing, "https://watchdive.diveroid.com");
  const alias = legacyHomeAnchor(url.hash);
  assert.equal(alias, "#signup-bottom");
  assert.equal(`${url.pathname}${url.search}${alias}`, `/ko/scuba${RAW_QUERY}#signup-bottom`);
});

test("home routes redirect before the frozen page and do not import the segment page", () => {
  const root = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const localized = readFileSync(new URL("../src/routes/$locale.index.tsx", import.meta.url), "utf8");
  const freediving = readFileSync(new URL("../src/routes/freediving.tsx", import.meta.url), "utf8");
  const localizedFreediving = readFileSync(new URL("../src/routes/$locale.freediving.tsx", import.meta.url), "utf8");
  const autoLocale = readFileSync(new URL("../src/lib/i18n/auto-locale.ts", import.meta.url), "utf8");

  assert.match(root, /export function DesignFrozenLanding\(/);
  assert.match(root, /beforeLoad:\s*\(\{ location \}\) =>/);
  assert.match(root, /canonicalScubaHref\(location,/);
  assert.match(root, /statusCode:\s*307/);
  assert.match(root, /location\.searchStr/);
  assert.doesNotMatch(root, /SegmentLanding/);
  assert.match(localized, /canonicalScubaHref\(location,/);
  assert.match(localized, /statusCode:\s*307/);
  assert.match(localized, /location\.searchStr/);
  assert.doesNotMatch(localized, /throw redirect\(\{ to: "\/" \}\)/);
  assert.doesNotMatch(freediving, /canonicalScubaHref/);
  assert.doesNotMatch(localizedFreediving, /canonicalScubaHref/);
  assert.match(autoLocale, /location: `\$\{localePathPrefix\(locale\)\}\$\{url\.search\}`/);
  assert.match(readFileSync(new URL("../src/components/segments/SegmentLanding.tsx", import.meta.url), "utf8"), /legacyHomeAnchor\(window\.location\.hash\)/);
});

test("committed client entry preserves large ad IDs and raw fragments without borrowing another page's state", () => {
  const actual = { pathname: "/ko", search: "?ad_id=120251732832820215&utm_content=video%204&ref=00001234", hash: "#state=opaque?next=a#b%20c" };
  const parsed = { pathname: "/ko", searchStr: "?ad_id=120251732832820210&utm_content=video+4&ref=00001234", hash: "state=opaque?next=a#b c" };
  assert.equal(canonicalScubaHref(parsed, actual), `/ko/scuba${actual.search}${actual.hash}`);
  assert.equal(canonicalScubaHref({ pathname: "/fr", searchStr: "?ref=target", hash: "offer-form" }, actual), "/fr/scuba?ref=target#offer-form");
  assert.equal(canonicalScubaHref({ pathname: "/", hash: "opaque?x=1#part\\tail" }), "/scuba#opaque?x=1#part\\tail");
});
