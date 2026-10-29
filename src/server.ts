import "./lib/error-capture";
import { reservationInitialLocaleRedirect } from "./components/reservation/query";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { geoCookie, normalizeCountry, consentRegionFor } from "./lib/consentRegion";
import { autoLocaleRedirect } from "./lib/i18n/auto-locale";
import { decideSharedDocumentCache, headersForSharedDocument, homeRedirectResponse, planHomeRedirect } from "./lib/httpCache";
import { publicCrawlResponse, applySearchIndexingPolicy } from "./lib/i18n/crawl.ts";
import { localeFromPathname } from "./lib/i18n/locale";
import { isI18nReviewEnabled } from "./lib/i18n/review-gate";
import { checkMetaCapiToken, metaCapiConfigStatus } from "./lib/api/metaCapi";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

const AUTO_LOCALE_VARY = "Cookie, Accept-Language, User-Agent, X-Vercel-IP-Country";

/**
 * The visitor's country from Vercel's edge (`x-vercel-ip-country`). Off Vercel
 * (local dev, tests) `WATCHDIVE_DEV_GEO_COUNTRY` can stand in for it; on
 * Vercel that override is ignored so it can never mask the real header.
 */
function requestCountry(request: Request): string | undefined {
  const header = normalizeCountry(request.headers.get("x-vercel-ip-country"));
  if (header) return header;
  if (process.env.VERCEL === "1") return undefined;
  return normalizeCountry(process.env.WATCHDIVE_DEV_GEO_COUNTRY);
}

function isSecureRequest(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:" || process.env.VERCEL === "1";
  } catch {
    return false;
  }
}

/** `/api/geo` — `{ country, consentRequired }`, never cached. */
function geoResponse(request: Request): Response {
  const country = requestCountry(request);
  return new Response(
    JSON.stringify({
      country: country ?? null,
      consentRequired: consentRegionFor(country) === "opt-in",
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store",
        "set-cookie": geoCookie(country, isSecureRequest(request)),
      },
    },
  );
}

/**
 * `/api/capi-status` — whether the Meta Conversions API leg is configured, as
 * booleans and variable *names* only (never a value), plus a cached read-only
 * Graph API check that the token can see the dataset. Lets anyone without
 * Vercel access tell "server Lead is off" from "server Lead is failing".
 */
async function capiStatusResponse(): Promise<Response> {
  const config = metaCapiConfigStatus();
  const token = await checkMetaCapiToken();
  return new Response(JSON.stringify({ ...config, tokenCheck: token }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}

function responseHasSetCookie(headers: Headers): boolean {
  if (typeof headers.getSetCookie === "function" && headers.getSetCookie().length > 0) return true;
  return headers.has("set-cookie");
}

/**
 * Public segment HTML can be cached only when the decision says the body is
 * safe to share. That response must not carry `wd_geo`: the cookie is the
 * visitor's country, and a shared cache would hand one country to the next
 * visitor. It also sets `Vary: Save-Data`, because a per-request bypass does
 * not stop Vercel from serving an object that was stored without that vary.
 * The existing head bootstrap still fails closed, and `resolveGeoCountry()`
 * asks `/api/geo` when the cookie is absent. Every other HTML response keeps
 * the cookie and is `private, no-store`.
 */
function finishDocument(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  if (response.status >= 400 && !headers.has("x-robots-tag")) {
    headers.set("x-robots-tag", "noindex");
  }
  const contentType = headers.get("content-type");
  const html = (contentType ?? "").includes("text/html");
  const decision = decideSharedDocumentCache({
    request,
    status: response.status,
    contentType,
    setCookie: responseHasSetCookie(headers),
    vary: headers.get("vary"),
    deploymentEnvironment: process.env.VERCEL_ENV,
  });

  if (html && decision.shared) {
    headersForSharedDocument(headers, decision);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (html) {
    headers.append("set-cookie", geoCookie(requestCountry(request), isSecureRequest(request)));
    for (const [key, value] of Object.entries(decision.headers)) headers.set(key, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const sensitive =
    !decision.shared &&
    (decision.reason === "sensitive-path" ||
      decision.reason === "method" ||
      decision.reason === "authorization" ||
      decision.reason === "unsafe-request" ||
      response.status >= 400 ||
      responseHasSetCookie(headers));
  if (sensitive && !decision.shared) {
    for (const [key, value] of Object.entries(decision.headers)) headers.set(key, value);
  }
  if (!sensitive && headers.get("x-robots-tag") === response.headers.get("x-robots-tag")) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  locale: ReturnType<typeof localeFromPathname>,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(locale), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const server = {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    let pathname = "/";
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      // Fall through to the normal handler, which answers malformed URLs.
    }
    if (pathname === "/api/geo" && (request.method === "GET" || request.method === "HEAD")) {
      return geoResponse(request);
    }
    if (pathname === "/api/capi-status" && request.method === "GET") {
      return capiStatusResponse();
    }
    const crawl = publicCrawlResponse(pathname, request.method);
    if (crawl) return crawl;

    const reservationRedirect = reservationInitialLocaleRedirect(
      request,
      process.env.VERCEL === "1" ? (requestCountry(request) ?? null) : null,
    );
    if (reservationRedirect)
      return new Response(null, {
        status: 307,
        headers: {
          location: reservationRedirect,
          "cache-control": "private, no-store",
          vary: "Cookie, Accept-Language, X-Vercel-IP-Country",
        },
      });

    const redirect = autoLocaleRedirect(
      request,
      isI18nReviewEnabled(import.meta.env.VITE_WATCHDIVE_I18N_REVIEW),
      requestCountry(request) ?? null,
    );
    if (redirect) {
      return new Response(null, {
        status: 307,
        headers: {
          "cache-control": "private, no-store",
          location: redirect.location,
          vary: AUTO_LOCALE_VARY,
          ...(redirect.setCookie ? { "set-cookie": redirect.setCookie } : {}),
        },
      });
    }

    // Redirect public home documents before TanStack parses search values.
    // Meta's numeric IDs exceed Number.MAX_SAFE_INTEGER; resolving the redirect
    // through the router can round them and turn `%20` into `+`. The Location
    // uses the raw query. 308 preserves the method. The browser keeps a
    // fragment this request cannot see. Auth callbacks live under `/api/auth`
    // and are not home paths.
    const home = planHomeRedirect({
      method: request.method,
      pathname,
      requestUrl: request.url,
      reviewEnabled: isI18nReviewEnabled(import.meta.env.VITE_WATCHDIVE_I18N_REVIEW),
      deploymentEnvironment: process.env.VERCEL_ENV,
    });
    if (home) return homeRedirectResponse(home);

    const locale = localeFromPathname(new URL(request.url).pathname);
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return finishDocument(request, await normalizeCatastrophicSsrResponse(response, locale));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(locale), {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, no-store",
          "cdn-cache-control": "no-store",
          "vercel-cdn-cache-control": "no-store",
        },
      });
    }
  },
};

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const response = await server.fetch(request, env, ctx);
    return applySearchIndexingPolicy(response, new URL(request.url).pathname, process.env.VERCEL_ENV);
  },
};
