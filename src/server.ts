import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { autoLocaleRedirect } from "./lib/i18n/auto-locale";
import { localeFromPathname } from "./lib/i18n/locale";
import { isI18nReviewEnabled } from "./lib/i18n/review-gate";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

const AUTO_LOCALE_VARY = "Cookie, Accept-Language, User-Agent, X-Vercel-IP-Country, CF-IPCountry";

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
      return await normalizeCatastrophicSsrResponse(response, locale);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(locale), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
