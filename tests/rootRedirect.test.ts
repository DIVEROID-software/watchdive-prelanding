import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { homeRedirectResponse, planHomeRedirect, rawSearchFromRequestUrl } from "../src/lib/httpCache.ts";
import { LOCALE_PATH_SEGMENTS, SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { canonicalScubaHref } from "../src/lib/segments/canonical-entry.ts";

const ORIGIN = "https://watchdive.diveroid.com";
const RAW_QUERY =
  "?utm_source=meta&utm_medium=paid&utm_campaign=sg&utm_content=video%204&utm_term=dive%2Bwatch&fbclid=IwAR0&gclid=EAIa&ttclid=tt.1&ref=abcd1234&press_ref=opaque_ref&wd_click=click%3D1&social=ig&ad_id=120251732832820215";

function plan(
  pathname: string,
  init: { method?: string; search?: string; review?: boolean; environment?: string; hash?: string } = {},
) {
  const search = init.search ?? "";
  const hash = init.hash ?? "";
  return planHomeRedirect({
    method: init.method ?? "GET",
    pathname,
    requestUrl: `${ORIGIN}${pathname}${search}${hash}`,
    reviewEnabled: init.review ?? false,
    deploymentEnvironment: init.environment ?? "production",
  });
}

test("root and every locale home 308 to scuba and keep the raw query", () => {
  const root = plan("/", { search: RAW_QUERY });
  assert.ok(root);
  assert.equal(root.status, 308);
  assert.equal(root.location, `/scuba${RAW_QUERY}`);
  assert.equal(root.shared, false);
  assert.equal(root.headers["cache-control"], "private, no-store");
  assert.equal(new URL(root.location, ORIGIN).search, RAW_QUERY);
  assert.equal(root.location.includes("120251732832820215"), true);
  assert.equal(root.location.includes("120251732832820210"), false);
  assert.equal(root.location.includes("video%204"), true);
  assert.equal(new URLSearchParams(RAW_QUERY.slice(1)).toString().includes("video+4"), true);

  for (const locale of SUPPORTED_LOCALES) {
    const prefix = locale === "en" ? "" : `/${LOCALE_PATH_SEGMENTS[locale]}`;
    const paths = locale === "en" ? ["/"] : [prefix, `${prefix}/`];
    for (const pathname of paths) {
      const planned = plan(pathname, { search: RAW_QUERY, hash: "#offer-form" });
      assert.ok(planned, pathname);
      assert.equal(planned.status, 308);
      assert.equal(planned.location, `${prefix}/scuba${RAW_QUERY}`, pathname);
      assert.equal(planned.location.includes("#"), false, pathname);
      assert.equal(rawSearchFromRequestUrl(`${ORIGIN}${pathname}${RAW_QUERY}#offer-form`), RAW_QUERY);
    }
  }
});

test("a tracking query is cached only as that exact URL, and a sensitive query is not", () => {
  const first = plan("/", { search: "?fbclid=AAA&utm_content=video%204&ad_id=120251732832820215" });
  const second = plan("/", { search: "?fbclid=BBB&utm_content=video%204&ad_id=120251732832820215" });
  assert.ok(first && second);
  assert.equal(first.shared, true);
  assert.equal(second.shared, true);
  assert.equal(first.reason, "tracking-url");
  assert.equal(first.location, "/scuba?fbclid=AAA&utm_content=video%204&ad_id=120251732832820215");
  assert.equal(second.location, "/scuba?fbclid=BBB&utm_content=video%204&ad_id=120251732832820215");
  assert.notEqual(first.location, second.location);
  assert.equal(first.location.includes("120251732832820210"), false);

  const sensitive = plan("/ko", { search: "?fbclid=AAA&ref=abcd1234", review: false });
  assert.ok(sensitive);
  assert.equal(sensitive.shared, false);
  assert.equal(sensitive.reason, "query");
  assert.equal(sensitive.location, "/ko/scuba?fbclid=AAA&ref=abcd1234");

  const reviewedClick = plan("/", { search: "?fbclid=AAA", review: true });
  assert.ok(reviewedClick);
  assert.equal(reviewedClick.shared, false);
  assert.equal(reviewedClick.reason, "auto-locale");
  assert.equal(reviewedClick.location, "/scuba?fbclid=AAA");
});

test("locale homes stay a raw 308 when review is off and when it is on", () => {
  for (const review of [false, true]) {
    const empty = plan("/ko", { review });
    assert.ok(empty);
    assert.equal(empty.location, "/ko/scuba");
    assert.equal(empty.shared, true, `review ${review}`);
    const tracked = plan("/ko/", {
      review,
      search: "?utm_source=ig&fbclid=IwAR0&utm_content=video%204",
    });
    assert.ok(tracked);
    assert.equal(tracked.shared, true, `review ${review}`);
    assert.equal(tracked.location, "/ko/scuba?utm_source=ig&fbclid=IwAR0&utm_content=video%204");
  }
});

test("an empty home redirect can be cached, and a review-mode root cannot", () => {
  const cached = plan("/", { environment: "preview" });
  assert.ok(cached);
  assert.equal(cached.location, "/scuba");
  assert.equal(cached.shared, true);
  assert.match(cached.headers["cache-control"], /max-age=0/);
  assert.match(cached.headers["vercel-cdn-cache-control"], /s-maxage=300/);
  const response = homeRedirectResponse(cached);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "/scuba");
  assert.equal(response.headers.get("set-cookie"), null);

  const reviewed = plan("/", { review: true });
  assert.ok(reviewed);
  assert.equal(reviewed.location, "/scuba");
  assert.equal(reviewed.shared, false);
  assert.equal(reviewed.reason, "auto-locale");

  const localized = plan("/ko", { review: true, environment: "preview" });
  assert.ok(localized);
  assert.equal(localized.location, "/ko/scuba");
  assert.equal(localized.shared, true);
});

test("auth callbacks, unsafe methods, and non-home routes are not redirected", () => {
  for (const pathname of [
    "/api/auth/google/callback",
    "/api/auth/apple/callback",
    "/api/auth/start",
    "/api/auth/continuation",
    "/verify",
    "/ko/verify",
    "/reservation",
    "/scuba",
    "/freediving",
    "/ko/scuba",
    "/r/abcd1234",
    "/buddy",
  ]) {
    assert.equal(plan(pathname, { search: "?code=oauth&state=opaque" }), undefined, pathname);
    assert.equal(canonicalScubaHref({ pathname, searchStr: "?code=oauth&state=opaque" }), undefined, pathname);
  }
  assert.equal(plan("/", { method: "POST", search: RAW_QUERY }), undefined);
  assert.equal(plan("/", { method: "PUT" }), undefined);
});

test("the raw query survives characters URLSearchParams would rewrite", () => {
  const search = "?utm_content=video%204&utm_term=dive%2Bwatch&fbclid=IwAR0%3D&ref=ab%2Bcd";
  const planned = plan("/zh-tw/", { search });
  assert.ok(planned);
  assert.equal(planned.location, `/zh-tw/scuba${search}`);
  const reencoded = `?${new URLSearchParams(search.slice(1)).toString()}`;
  assert.notEqual(reencoded, search);
  assert.equal(planned.location.endsWith(search), true);
  assert.equal(planned.location.includes("#"), false);
});

test("server.ts redirects homes with the raw planner before the router, including locale homes", () => {
  const source = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  const cache = readFileSync(new URL("../src/lib/httpCache.ts", import.meta.url), "utf8");
  assert.match(source, /planHomeRedirect\(/);
  assert.match(source, /homeRedirectResponse\(home\)/);
  assert.match(cache, /status: 308/);
  assert.doesNotMatch(source, /canonicalScubaHref\(/);
  assert.doesNotMatch(source, /new URL\(request\.url\)\.search/);
  assert.match(source, /autoLocaleRedirect\(/);
  assert.match(source, /status:\s*307/);
  assert.match(source, /private, no-store/);
  const root = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const localized = readFileSync(new URL("../src/routes/$locale.index.tsx", import.meta.url), "utf8");
  assert.match(root, /statusCode:\s*308/);
  assert.match(localized, /statusCode:\s*308/);
  assert.match(root, /canonicalScubaHref\(location,/);
  assert.match(localized, /canonicalScubaHref\(location,/);
});
