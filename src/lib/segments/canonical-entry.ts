import { LOCALE_PATH_SEGMENTS, localeFromPathSegment } from "../i18n/locale.ts";

/**
 * Temporary canonical entry for the old home URLs.
 *
 * `/` and every supported locale home, including the `/en` alias, open the
 * scuba segment. Freediving and every non-home route stay on their own path.
 * The query string and fragment are copied as they arrived. A fragment is
 * never written into the query, so a bearer token cannot leak into access logs
 * through a search parameter.
 */
export function canonicalScubaHref(location: {
  pathname: string;
  searchStr?: string;
  hash?: string;
}, browserLocation?: { pathname: string; search: string; hash: string }): string | undefined {
  const target = scubaTargetForHome(location.pathname);
  if (!target) return undefined;
  // Router search parsing can round 18-digit Meta IDs. On a committed browser
  // navigation use the actual URL; never borrow another page's token or query
  // while a different destination is merely being preloaded.
  const current = browserLocation?.pathname === location.pathname ? browserLocation : undefined;
  return `${target}${rawSearch(current ? current.search : location.searchStr)}${rawHash(current ? current.hash : location.hash)}`;
}

/** Old in-page signup/compatibility ids that the segment page can still honor. */
const LEGACY_HOME_ANCHORS: Readonly<Record<string, string>> = {
  "offer-form": "signup-bottom",
  compatibility: "segment-compatibility",
};

/**
 * Return a replacement fragment for a known home anchor, or undefined when the
 * current fragment should stay untouched. The result is always a fragment and
 * never a query string.
 */
export function legacyHomeAnchor(hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,64}$/.test(body)) return undefined;
  const mapped = Object.hasOwn(LEGACY_HOME_ANCHORS, body) ? LEGACY_HOME_ANCHORS[body] : undefined;
  return mapped ? `#${mapped}` : undefined;
}

function scubaTargetForHome(pathname: string): string | undefined {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) return undefined;
  if (/[?#\s\\]/.test(pathname)) return undefined;

  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (trimmed === "/") return "/scuba";
  if (trimmed.slice(1).includes("/")) return undefined;

  const locale = localeFromPathSegment(trimmed.slice(1));
  if (!locale) return undefined;
  return locale === "en" ? "/scuba" : `/${LOCALE_PATH_SEGMENTS[locale]}/scuba`;
}

function rawSearch(search: string | undefined): string {
  if (!search) return "";
  const value = search.split("#", 1)[0] ?? "";
  if (!value || value === "?") return "";
  return value.startsWith("?") ? value : `?${value}`;
}

function rawHash(hash: string | undefined): string {
  if (!hash) return "";
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!body || /[\r\n\0]/.test(body)) return "";
  return `#${body}`;
}
