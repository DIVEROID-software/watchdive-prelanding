import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  CDN_FRESH_SECONDS,
  CDN_SWR_SECONDS,
  SHARED_DOCUMENT_VARY,
  decideSharedDocumentCache,
  deploymentAllowsSharedCache,
  headersForSharedDocument,
  isPublicSegmentPath,
  isSensitivePath,
} from "../src/lib/httpCache.ts";
import { LOCALE_PATH_SEGMENTS, SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";

const ORIGIN = "https://watchdive.diveroid.com";

function documentRequest(
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers: init.headers,
  });
}

function decide(
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    status?: number;
    contentType?: string | null;
    setCookie?: boolean;
    vary?: string | null;
    deploymentEnvironment?: string;
  } = {},
) {
  return decideSharedDocumentCache({
    request: documentRequest(path, init),
    status: init.status ?? 200,
    contentType: init.contentType === undefined ? "text/html; charset=utf-8" : init.contentType,
    setCookie: init.setCookie ?? false,
    vary: init.vary ?? null,
    deploymentEnvironment: init.deploymentEnvironment ?? "production",
  });
}

function segmentPaths(): string[] {
  return SUPPORTED_LOCALES.flatMap((locale) => {
    const prefix = locale === "en" ? "" : `/${LOCALE_PATH_SEGMENTS[locale]}`;
    return [`${prefix}/scuba`, `${prefix}/freediving`];
  });
}

test("shared cache is 300s on the CDN, with a bounded stale window and browser revalidation", () => {
  assert.equal(CDN_FRESH_SECONDS, 300);
  assert.ok(CDN_SWR_SECONDS > 0 && CDN_SWR_SECONDS <= 60);
  assert.ok(CDN_SWR_SECONDS <= CDN_FRESH_SECONDS);
  const decision = decide("/scuba");
  assert.equal(decision.shared, true);
  if (!decision.shared) return;
  assert.equal(decision.vary, SHARED_DOCUMENT_VARY);
  assert.match(decision.headers["cache-control"], /max-age=0/);
  assert.match(decision.headers["cache-control"], /must-revalidate/);
  assert.match(decision.headers["cache-control"], new RegExp(`s-maxage=${CDN_FRESH_SECONDS}`));
  assert.match(
    decision.headers["cache-control"],
    new RegExp(`stale-while-revalidate=${CDN_SWR_SECONDS}`),
  );
  assert.equal(
    decision.headers["cdn-cache-control"],
    `public, s-maxage=${CDN_FRESH_SECONDS}, stale-while-revalidate=${CDN_SWR_SECONDS}`,
  );
  assert.equal(decision.headers["vercel-cdn-cache-control"], decision.headers["cdn-cache-control"]);
  assert.equal(decision.headers["cache-control"].includes("no-store"), false);
});

test("every locale scuba and freediving document is cacheable for GET and HEAD", () => {
  const paths = segmentPaths();
  assert.equal(paths.length, SUPPORTED_LOCALES.length * 2);
  assert.equal(new Set(paths).size, paths.length);
  for (const path of paths) {
    for (const method of ["GET", "HEAD"] as const) {
      const decision = decide(path, { method });
      assert.equal(decision.shared, true, `${method} ${path}`);
      assert.equal(isPublicSegmentPath(`${path}/`), true, path);
    }
    const slashed = decide(`${path}/`);
    assert.equal(slashed.shared, true, path);
  }
});

test("cookies do not personalize current segment HTML, including analytics and auth cookies", () => {
  for (const cookie of [
    "wd_geo=KR; watchdive.locale=ko",
    "_ga=GA1.1.1.1; _fbp=fb.1.1",
    "__Host-wd_social_state=opaque",
    "wd_admin=opaque",
    "watchdive_launchos_authority_v1=opaque",
    "wd_rt=opaque",
    "session=opaque",
    "bad name=1",
  ]) {
    const decision = decide("/ko/freediving", { headers: { cookie } });
    assert.equal(decision.shared, true, cookie);
    if (decision.shared) assert.equal(decision.vary, SHARED_DOCUMENT_VARY, cookie);
  }
});

test("tracking queries stay on their own URL, and sensitive queries are no-store", () => {
  const tracking = [
    "?utm_source=meta&utm_medium=paid&utm_campaign=sg&utm_content=video%204&utm_term=dive%2Bwatch",
    "?fbclid=IwAR0",
    "?fbclid=IwAR1",
    "?gclid=EAIa&gbraid=gb&wbraid=wb",
    "?ttclid=tt.1",
    "?wd_click=click%3D1&social=ig",
    "?ad_id=120251732832820215",
    "?utm_id=launch",
  ];
  const locations = new Set<string>();
  for (const search of tracking) {
    const decision = decide(`/scuba${search}`);
    assert.equal(decision.shared, true, search);
    if (decision.shared) assert.equal(decision.vary, SHARED_DOCUMENT_VARY, search);
    locations.add(search);
  }
  assert.equal(locations.size, tracking.length);
  assert.equal(Number.isSafeInteger(Number("120251732832820215")), false);
  assert.notEqual(String(JSON.parse("120251732832820215")), "120251732832820215");

  const sensitive = [
    "?ref=abcd1234",
    "?press_ref=opaque_ref",
    "?token=opaque",
    "?code=oauth",
    "?state=opaque",
    "?invite=opaque",
    "?auth=confirmed",
    "?wd_qa=1&wd_variant=control",
    "?session_id=cs_test",
    "?price=149",
    "?fbclid=IwAR0&token=opaque",
    "?%72ef=encoded",
    "?utm_source=meta&unknown=1",
    "?&utm_source=meta",
  ];
  for (const search of sensitive) {
    const decision = decide(`/scuba${search}`);
    assert.equal(decision.shared, false, search);
    if (decision.shared) continue;
    assert.equal(decision.reason, "query", search);
    assert.equal(decision.headers["cache-control"], "private, no-store");
    assert.equal(decision.headers["cdn-cache-control"], "no-store");
    assert.equal(decision.headers["vercel-cdn-cache-control"], "no-store");
  }
  // A dangling `?` carries no parameter. It stays the public segment document.
  assert.equal(decide("/scuba?").shared, true);
});

test("shared HTML drops Set-Cookie and varies on Save-Data for both media variants", () => {
  for (const saveData of [undefined, "on"] as const) {
    const decision = decide("/ja/scuba", saveData ? { headers: { "save-data": saveData } } : {});
    assert.equal(decision.shared, true, String(saveData));
    if (!decision.shared) continue;
    const headers = new Headers({
      "content-type": "text/html; charset=utf-8",
      "set-cookie": "wd_geo=KR; Path=/; HttpOnly",
    });
    headers.append("set-cookie", "_ga=GA1.1.1.1");
    headersForSharedDocument(headers, decision);
    assert.equal(headers.get("set-cookie"), null, String(saveData));
    assert.equal(headers.getSetCookie().length, 0, String(saveData));
    assert.equal(headers.get("vary"), "Save-Data", String(saveData));
    assert.match(headers.get("cache-control") ?? "", /s-maxage=300/);
    assert.equal((headers.get("cache-control") ?? "").includes("no-store"), false);
  }
});

test("Save-Data is its own shared variant, not a bypass of an already cached document", () => {
  for (const saveData of ["on", "ON", "off", null]) {
    const headers = saveData ? { "save-data": saveData } : undefined;
    const decision = decide("/scuba", headers ? { headers } : {});
    assert.equal(decision.shared, true, String(saveData));
    if (decision.shared) assert.equal(decision.vary, "Save-Data");
  }
});

test("sensitive flows and non-HTML or unsafe responses are no-store", () => {
  const paths = [
    "/api/geo",
    "/api/capi-status",
    "/api/auth/google/callback",
    "/api/auth/apple/callback",
    "/api/auth/start",
    "/api/auth/continuation",
    "/api/reservation/checkout",
    "/api/reservation/webhook",
    "/api/reservation/return",
    "/api/reservation/status",
    "/verify",
    "/ko/verify",
    "/reservation",
    "/r/abcd1234",
    "/ko/r/abcd1234",
    "/buddy",
    "/ko/buddy",
    "/buddy-rules",
    "/unsubscribe/token",
    "/admin/behavior",
    "/_serverFn/joinWaitlist",
    "/privacy",
    "/terms",
    "/",
    "/ko",
    "/en/scuba",
  ];
  for (const path of paths) {
    const decision = decide(path);
    assert.equal(decision.shared, false, path);
    if (!decision.shared) assert.equal(decision.headers["cache-control"], "private, no-store");
    if (path.startsWith("/api") || path.includes("/verify") || path.includes("/r/") || path.includes("buddy") || path.includes("reservation") || path.includes("unsubscribe") || path.includes("admin") || path.includes("_serverFn")) {
      assert.equal(isSensitivePath(path), true, path);
    }
  }

  for (const [label, init] of [
    ["post", { method: "POST" }],
    ["server-fn", { headers: { "x-tsr-serverfn": "true" } }],
    ["authorization", { headers: { authorization: "Bearer opaque" } }],
    ["range", { headers: { range: "bytes=0-1" } }],
    ["set-cookie", { setCookie: true }],
    ["error", { status: 500 }],
    ["redirect", { status: 302 }],
    ["json", { contentType: "application/json" }],
    ["missing-type", { contentType: null }],
    ["vary-cookie", { vary: "Accept-Encoding, Cookie" }],
    ["preview-off", { deploymentEnvironment: "development" }],
    ["unset-env", { deploymentEnvironment: "" }],
  ] as const) {
    const decision = decide("/ja/scuba", init);
    assert.equal(decision.shared, false, label);
    if (!decision.shared) {
      assert.equal(decision.headers["cdn-cache-control"], "no-store", label);
      assert.equal(decision.headers["vercel-cdn-cache-control"], "no-store", label);
    }
  }
});

test("preview and production may share a safe document; other environments may not", () => {
  assert.equal(deploymentAllowsSharedCache("production"), true);
  assert.equal(deploymentAllowsSharedCache("preview"), true);
  assert.equal(decide("/pt-br/scuba", { deploymentEnvironment: "preview" }).shared, true);
  assert.equal(deploymentAllowsSharedCache("development"), false);
  assert.equal(deploymentAllowsSharedCache(undefined), false);
});

test("the server wires the decision, skips the geo cookie on a shared document, and does not use private no-cache", () => {
  const server = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  const cache = readFileSync(new URL("../src/lib/httpCache.ts", import.meta.url), "utf8");
  const segment = readFileSync(new URL("../src/lib/segments/route.ts", import.meta.url), "utf8");
  const root = readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
  const consent = readFileSync(new URL("../src/lib/consentRegion.ts", import.meta.url), "utf8");
  assert.match(server, /decideSharedDocumentCache/);
  assert.match(server, /headersForSharedDocument\(headers, decision\)/);
  assert.match(cache, /headers\.delete\("set-cookie"\)/);
  assert.match(server, /Save-Data/);
  const finish = server.slice(server.indexOf("function finishDocument"));
  const sharedAt = finish.indexOf("headersForSharedDocument(headers, decision)");
  const geoAt = finish.indexOf("geoCookie(");
  assert.ok(sharedAt > 0 && geoAt > sharedAt);
  assert.match(server, /resolveGeoCountry\(\)/);
  assert.match(cache, /SHARED_DOCUMENT_VARY = "Save-Data"/);
  assert.doesNotMatch(cache, /vary:\s*"Cookie"/);
  assert.doesNotMatch(server, /private, no-cache/);
  assert.match(segment, /readLiteMediaHint\(\)/);
  assert.match(segment, /loadReferralPriceClaim\(locale\)/);
  assert.match(root, /resolveGeoCountry\(\)/);
  assert.match(consent, /fetch\("\/api\/geo"/);
  assert.match(readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8"), /preset: "vercel"/);
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    regions?: string[];
    headers?: unknown;
    routes?: unknown;
  };
  assert.deepEqual(vercel.regions, ["icn1"]);
  assert.equal(vercel.headers, undefined);
  assert.equal(vercel.routes, undefined);
});
