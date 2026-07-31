import {
  DEFAULT_LOCALE,
  isLocale,
  localeFromPathSegment,
  localePathPrefix,
  matchLocale,
  type Locale,
} from "./locale.ts";

export const LOCALE_PREFERENCE_COOKIE = "watchdive.locale";
const LOCALE_PREFERENCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const COUNTRY_LOCALE = new Map<string, Locale>([
  ["KR", "ko"],
  ["CN", "zh-CN"],
  ["TW", "zh-TW"],
  ["HK", "zh-TW"],
  ["MO", "zh-TW"],
  ["JP", "ja"],
  ["ES", "es"],
  ["MX", "es"],
  ["AR", "es"],
  ["BO", "es"],
  ["CL", "es"],
  ["CO", "es"],
  ["CR", "es"],
  ["CU", "es"],
  ["DO", "es"],
  ["EC", "es"],
  ["GQ", "es"],
  ["GT", "es"],
  ["HN", "es"],
  ["NI", "es"],
  ["PA", "es"],
  ["PE", "es"],
  ["PR", "es"],
  ["PY", "es"],
  ["SV", "es"],
  ["UY", "es"],
  ["VE", "es"],
  ["FR", "fr"],
  ["DE", "de"],
  ["AT", "de"],
  ["BR", "pt-BR"],
]);

const CRAWLER_USER_AGENT =
  /(?:googlebot|bingbot|yandexbot|baiduspider|duckduckbot|applebot|crawler|spider|slurp|bingpreview|google-inspectiontool|facebookexternalhit|twitterbot|linkedinbot|slackbot|whatsapp)/i;

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader || cookieHeader.length > 16_384) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const encoded = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(encoded);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function localeFromPreferenceCookie(cookieHeader: string | null): Locale | undefined {
  const value = readCookie(cookieHeader, LOCALE_PREFERENCE_COOKIE);
  if (!value) return undefined;
  if (isLocale(value)) return value;
  return localeFromPathSegment(value);
}

export function localeFromCountry(value: string | null): Locale | undefined {
  const normalized = value?.trim().toUpperCase();
  if (!normalized || !/^[A-Z]{2}$/.test(normalized)) return undefined;
  return COUNTRY_LOCALE.get(normalized);
}

type WeightedLanguage = {
  tag: string;
  quality: number;
  order: number;
};

/** Parse only the small, standards-shaped subset needed for locale selection. */
export function localeFromAcceptLanguage(value: string | null): Locale | undefined {
  if (!value || value.length > 4_096) return undefined;

  const weighted: WeightedLanguage[] = [];
  for (const [order, rawEntry] of value.split(",").slice(0, 32).entries()) {
    const [rawTag, ...parameters] = rawEntry.trim().split(";");
    const tag = rawTag?.trim();
    if (!tag || tag === "*" || !/^[A-Za-z0-9_*.-]{1,64}$/.test(tag)) continue;

    let quality = 1;
    const qualityParameter = parameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.toLowerCase().startsWith("q="));
    if (qualityParameter) {
      const rawQuality = qualityParameter.slice(2).trim();
      if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(rawQuality)) continue;
      quality = Number(rawQuality);
    }
    if (quality === 0) continue;
    weighted.push({ tag, quality, order });
  }

  weighted.sort((left, right) => right.quality - left.quality || left.order - right.order);
  for (const entry of weighted) {
    const locale = matchLocale(entry.tag);
    if (locale) return locale;
  }
  return undefined;
}

function isCrawlerOrUnknownClient(request: Request): boolean {
  const userAgent = request.headers.get("user-agent")?.trim().slice(0, 1_024) ?? "";
  if (!userAgent) return true;
  return CRAWLER_USER_AGENT.test(userAgent);
}

function isDocumentRequest(request: Request): boolean {
  const destination = request.headers.get("sec-fetch-dest")?.toLowerCase();
  if (destination && destination !== "document") return false;

  const accept = request.headers.get("accept")?.toLowerCase();
  return !accept || accept.includes("text/html") || accept.includes("application/xhtml+xml");
}

export function preferredLocaleFromRequest(request: Request): Locale {
  const cookieLocale = localeFromPreferenceCookie(request.headers.get("cookie"));
  if (cookieLocale) return cookieLocale;

  for (const header of ["x-vercel-ip-country", "cf-ipcountry"] as const) {
    const countryLocale = localeFromCountry(request.headers.get(header));
    if (countryLocale) return countryLocale;
  }

  return localeFromAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LOCALE;
}

/**
 * Return a temporary redirect only for a first document request to `/`.
 * Localized, verification, legal and referral routes never reach this branch,
 * so the redirect cannot loop or move a bearer-token URL between locales.
 */
export type AutoLocaleRedirect = {
  locale: Locale;
  location: string;
  /** Reserved for an explicit server-side choice; automatic inference never sets it. */
  setCookie?: string;
};

export function autoLocaleRedirect(
  request: Request,
  reviewEnabled = false,
): AutoLocaleRedirect | undefined {
  if (!reviewEnabled) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return undefined;
  }

  if (url.pathname !== "/" || !isDocumentRequest(request) || isCrawlerOrUnknownClient(request)) {
    return undefined;
  }

  const locale = preferredLocaleFromRequest(request);
  if (locale === DEFAULT_LOCALE) return undefined;

  return {
    locale,
    location: `${localePathPrefix(locale)}${url.search}`,
  };
}

/** Serialize the explicit preference written by the language switcher. */
export function localePreferenceCookie(locale: Locale, secure: boolean): string {
  return [
    `${LOCALE_PREFERENCE_COOKIE}=${encodeURIComponent(locale)}`,
    "Path=/",
    `Max-Age=${LOCALE_PREFERENCE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
