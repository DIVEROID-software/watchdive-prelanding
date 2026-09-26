import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { geoCookie, normalizeCountry, consentRegionFor } from "./lib/consentRegion";
import { autoLocaleRedirect } from "./lib/i18n/auto-locale";
import { localeFromPathname } from "./lib/i18n/locale";
import { isI18nReviewEnabled } from "./lib/i18n/review-gate";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

const AUTO_LOCALE_VARY = "Cookie, Accept-Language, User-Agent";

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
 * Hands the country to the page as the `wd_geo` cookie on every HTML response,
 * so the inline pixel bootstrap can apply the regional consent rule before any
 * bundle loads. The response is marked private so no shared cache keeps one
 * visitor's country for another.
 */
function withGeoCookie(request: Request, response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", geoCookie(requestCountry(request), isSecureRequest(request)));
  headers.set("cache-control", "private, no-cache");
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

export default {
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

    const redirect = autoLocaleRedirect(
      request,
      isI18nReviewEnabled(import.meta.env.VITE_WATCHDIVE_I18N_REVIEW),
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

    const locale = localeFromPathname(new URL(request.url).pathname);
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withGeoCookie(request, await normalizeCatastrophicSsrResponse(response, locale));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(locale), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
