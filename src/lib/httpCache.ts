import { canonicalScubaHref } from "./segments/canonical-entry.ts";
import { LOCALE_PATH_SEGMENTS, SUPPORTED_LOCALES } from "./i18n/locale.ts";

/**
 * Shared-cache policy for public segment HTML.
 *
 * Vercel's CDN caches a function response only when Cache-Control carries
 * s-maxage, or when CDN-Cache-Control / Vercel-CDN-Cache-Control does.
 * A browser is a private cache, so max-age=0 makes it revalidate while the
 * shared cache keeps s-maxage. stale-while-revalidate is capped so a stale
 * public price claim cannot linger.
 *
 * https://vercel.com/docs/caching/cache-control-headers
 * https://vercel.com/docs/caching (CDN-Cache-Control, Vercel-CDN-Cache-Control)
 */
export const CDN_FRESH_SECONDS = 300;
export const CDN_SWR_SECONDS = 60;

const SENSITIVE_SEGMENT = new Set([
  "api",
  "admin",
  "reservation",
  "unsubscribe",
  "verify",
  "r",
  "buddy",
  "buddy-rules",
  "_serverfn",
]);

/**
 * Query names that do not change segment SSR. The CDN key is still the full
 * request URL: Vercel ignores the query only for static files, and a function
 * response is keyed by the URL. Two fbclid values are therefore two objects.
 * Anything outside this list, including referral, price, auth and experiment
 * inputs, is `no-store` so that body is never stored.
 *
 * https://vercel.com/docs/caching (cache key includes the request URL)
 */
const CACHEABLE_QUERY_NAMES = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "utm_language",
  "utm_segment",
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "ttclid",
  "wd_click",
  "social",
  "ad_id",
]);

/**
 * Shared segment HTML varies on this header.
 * `Vary: Cookie` is not cacheable: Vercel returns `x-vercel-cache: MISS`
 * with reason `vary_key_denied:cookie` (changelog, 2026-09-30).
 * https://vercel.com/changelog/vary-cookie-responses-no-longer-cached
 */
export const SHARED_DOCUMENT_VARY = "Save-Data";

const PUBLIC_SEGMENT_PATHS = new Set<string>(
  SUPPORTED_LOCALES.flatMap((locale) => {
    const prefix = locale === "en" ? "" : `/${LOCALE_PATH_SEGMENTS[locale]}`;
    return [`${prefix}/scuba`, `${prefix}/freediving`];
  }),
);

export type CacheHeaderMap = {
  "cache-control": string;
  "cdn-cache-control": string;
  "vercel-cdn-cache-control": string;
};

export type DocumentCacheDecision =
  | { shared: true; headers: CacheHeaderMap; vary: typeof SHARED_DOCUMENT_VARY }
  | { shared: false; reason: string; headers: CacheHeaderMap };

export type HomeRedirectPlan = {
  status: 308;
  location: string;
  headers: CacheHeaderMap;
  shared: boolean;
  reason: string;
};

export function browserAndCdnHeaders(shared: boolean): CacheHeaderMap {
  if (!shared) {
    return {
      "cache-control": "private, no-store",
      "cdn-cache-control": "no-store",
      "vercel-cdn-cache-control": "no-store",
    };
  }
  const sharedDirectives = `public, s-maxage=${CDN_FRESH_SECONDS}, stale-while-revalidate=${CDN_SWR_SECONDS}`;
  return {
    "cache-control": `public, max-age=0, s-maxage=${CDN_FRESH_SECONDS}, stale-while-revalidate=${CDN_SWR_SECONDS}, must-revalidate`,
    "cdn-cache-control": sharedDirectives,
    "vercel-cdn-cache-control": sharedDirectives,
  };
}

export function deploymentAllowsSharedCache(environment: string | undefined): boolean {
  return environment === "production" || environment === "preview";
}

/** Query substring exactly as it appeared, without URLSearchParams re-encoding. */
export function rawSearchFromRequestUrl(requestUrl: string): string {
  const hashAt = requestUrl.indexOf("#");
  const withoutHash = hashAt === -1 ? requestUrl : requestUrl.slice(0, hashAt);
  const scheme = withoutHash.indexOf("://");
  const pathStart = scheme === -1 ? 0 : withoutHash.indexOf("/", scheme + 3);
  const queryAt = withoutHash.indexOf("?", pathStart === -1 ? 0 : pathStart);
  if (queryAt === -1) return "";
  const search = withoutHash.slice(queryAt);
  return search === "?" ? "" : search;
}

export function isPublicSegmentPath(pathname: string): boolean {
  if (!pathname.startsWith("/") || pathname.startsWith("//") || /[?#\s\\]/.test(pathname)) return false;
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return PUBLIC_SEGMENT_PATHS.has(trimmed);
}

export function isSensitivePath(pathname: string): boolean {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return true;
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  const localeSegments = new Set<string>(Object.values(LOCALE_PATH_SEGMENTS));
  const tail = localeSegments.has(parts[0]!.toLowerCase()) ? parts.slice(1) : parts;
  if (tail.length === 0) return false;
  return SENSITIVE_SEGMENT.has(tail[0]!.toLowerCase());
}

/**
 * Parameter names in a raw query, without URLSearchParams re-encoding.
 * An empty query is an empty list. A name that cannot be decoded fails closed.
 */
export function queryNamesFromRawSearch(search: string): string[] | undefined {
  if (search === "") return [];
  if (!search.startsWith("?") || search.includes("#")) return undefined;
  if (search === "?") return [];
  const names: string[] = [];
  for (const part of search.slice(1).split("&")) {
    if (part.length === 0) return undefined;
    const eq = part.indexOf("=");
    const rawName = eq === -1 ? part : part.slice(0, eq);
    if (rawName.length === 0 || rawName.length > 128) return undefined;
    let name: string;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      return undefined;
    }
    if (!name || /[\s&=]/.test(name)) return undefined;
    names.push(name);
  }
  return names;
}

/** True when every name is an attribution parameter, or the query is empty. */
export function trackingSearchMayBeCached(search: string): boolean {
  const names = queryNamesFromRawSearch(search);
  if (!names) return false;
  return names.every((name) => CACHEABLE_QUERY_NAMES.has(name));
}

function varyBlocksSharing(vary: string | null): boolean {
  if (!vary) return false;
  return vary.split(",").some((part) => {
    const name = part.trim().toLowerCase();
    return name === "cookie" || name === "authorization" || name === "*";
  });
}

/**
 * Whether this document may be stored by a shared CDN.
 *
 * Segment SSR reads Save-Data into `liteMedia` and does not read cookies.
 * A cached full-media object would be served to a later Save-Data visitor
 * unless the stored response varies on that header, so every shared document
 * sets `Vary: Save-Data`. Vercel combines that request header with the full
 * URL cache key only when s-maxage enables caching. `Vary: Cookie` is not
 * stored (`vary_key_denied:cookie`). Unknown cookies are therefore not a bypass:
 * current segment HTML does not change for `_ga`, `_fbp`, `wd_geo`, or an
 * auth cookie the loader never reads. A response that already sets a cookie,
 * or that varies on Cookie, stays private.
 *
 * A tracking query is cacheable only as that exact URL. The function does not
 * strip or rewrite it. `?fbclid=A` and `?fbclid=B` are different keys, so a
 * unique click id misses. Referral, price, auth, and experiment names stay
 * `no-store`. An Authorization header stays `no-store` without `Vary`.
 */
export function decideSharedDocumentCache(input: {
  request: Request;
  status: number;
  contentType: string | null;
  setCookie: boolean;
  vary: string | null;
  deploymentEnvironment: string | undefined;
}): DocumentCacheDecision {
  const nostore = (reason: string): DocumentCacheDecision => ({
    shared: false,
    reason,
    headers: browserAndCdnHeaders(false),
  });
  const request = input.request;
  let pathname = "/";
  let search = "";
  try {
    const url = new URL(request.url);
    pathname = url.pathname;
    search = rawSearchFromRequestUrl(request.url);
  } catch {
    return nostore("malformed-url");
  }

  if (request.method !== "GET" && request.method !== "HEAD") return nostore("method");
  if (request.headers.has("authorization") || request.headers.has("proxy-authorization")) {
    return nostore("authorization");
  }
  if (request.headers.has("x-tsr-serverfn") || request.headers.has("range")) return nostore("unsafe-request");
  if (isSensitivePath(pathname)) return nostore("sensitive-path");
  if (!isPublicSegmentPath(pathname)) return nostore("not-public-segment");
  if (!trackingSearchMayBeCached(search)) return nostore("query");
  if (!deploymentAllowsSharedCache(input.deploymentEnvironment)) return nostore("deployment");
  if (input.status !== 200) return nostore("status");
  if (!(input.contentType ?? "").toLowerCase().includes("text/html")) return nostore("content-type");
  if (input.setCookie) return nostore("set-cookie");
  if (varyBlocksSharing(input.vary)) return nostore("vary");
  return { shared: true, headers: browserAndCdnHeaders(true), vary: SHARED_DOCUMENT_VARY };
}

/**
 * Headers for a document the CDN may store.
 * Deletes every `Set-Cookie`, including `wd_geo`, because Vercel will not
 * cache a response that sets a cookie. Adds `Vary: Save-Data` for both the
 * ordinary and lite variants. Does not add `Vary: Cookie`.
 *
 * https://vercel.com/docs/caching/cdn-cache
 * https://vercel.com/docs/caching/cdn-cache/purge
 */
export function headersForSharedDocument(headers: Headers, decision: { vary: typeof SHARED_DOCUMENT_VARY; headers: CacheHeaderMap }): Headers {
  for (const [key, value] of Object.entries(decision.headers)) headers.set(key, value);
  const existingVary = headers.get("vary");
  const alreadyVariesSaveData = (existingVary ?? "")
    .split(",")
    .some((part) => part.trim().toLowerCase() === "save-data");
  if (!alreadyVariesSaveData) {
    headers.set("vary", existingVary ? `${existingVary}, ${decision.vary}` : decision.vary);
  }
  headers.delete("set-cookie");
  return headers;
}

/**
 * Permanent redirect for old home URLs, using the raw query.
 *
 * 308 keeps the method (RFC 9110) and the browser keeps a fragment the
 * request never contained. The Location copies the raw query and is never
 * rewritten to a shared, query-stripped path. A tracking query may be stored
 * only under that exact URL. A referral, auth, price, or other non-tracking
 * query is `no-store`. `/` while locale review is on is `no-store` as well:
 * the auto-locale redirect in front of this one depends on country and the
 * locale cookie, and a cached 308 would skip it.
 *
 * Locale homes such as `/ko` stay 308 even when review is off. The route
 * `beforeLoad` already sends them to scuba, and this server step runs first
 * so TanStack's default JSON search parser cannot round an 18-digit ad id
 * or turn `%20` into `+` before the browser follows Location.
 */
export function planHomeRedirect(input: {
  method: string;
  pathname: string;
  requestUrl: string;
  reviewEnabled: boolean;
  deploymentEnvironment?: string;
}): HomeRedirectPlan | undefined {
  if (input.method !== "GET" && input.method !== "HEAD") return undefined;
  if (isSensitivePath(input.pathname)) return undefined;
  const search = rawSearchFromRequestUrl(input.requestUrl);
  const location = canonicalScubaHref({ pathname: input.pathname, searchStr: search });
  if (!location || location.includes("#") || !location.startsWith("/") || location.startsWith("//")) {
    return undefined;
  }
  const cacheableSearch = trackingSearchMayBeCached(search);
  const reviewVariesRoot = input.reviewEnabled && (input.pathname === "/" || input.pathname === "");
  const shared =
    cacheableSearch && !reviewVariesRoot && deploymentAllowsSharedCache(input.deploymentEnvironment);
  const reason = shared
    ? search
      ? "tracking-url"
      : "invariant-home"
    : !cacheableSearch
      ? "query"
      : reviewVariesRoot
        ? "auto-locale"
        : "deployment";
  return {
    status: 308,
    location,
    shared,
    reason,
    headers: browserAndCdnHeaders(shared),
  };
}

export function homeRedirectResponse(plan: HomeRedirectPlan): Response {
  const headers = new Headers(plan.headers);
  headers.set("location", plan.location);
  return new Response(null, { status: 308, headers });
}
