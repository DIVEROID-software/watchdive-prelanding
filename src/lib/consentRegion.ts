// Where measurement needs an opt-in first.
//
// EU/EEA, the UK and Switzerland (plus the UK Crown Dependencies and
// Gibraltar) keep the opt-in cookie choice: nothing measures until the visitor
// presses Allow. Everywhere else — the US ad audience in particular — the Meta
// pixel and the other measurement tags load by default, and the visitor can
// still opt out ("Not now"/footer link) or send Global Privacy Control.
//
// The country comes from the server (`x-vercel-ip-country`), handed to the
// browser as the `wd_geo` cookie on every HTML response and at `/api/geo`.
// An unknown country is treated as opt-in required: fail closed.
//
// Kept free of path-alias imports so `npm test` can load it directly.

export const GEO_COOKIE = "wd_geo";
export const GEO_UNKNOWN = "XX";
export const CONSENT_STORAGE_KEY = "watchdive.measurement-consent.v3";

export const CONSENT_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set([
  // EU 27
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  // EEA (non-EU)
  "IS",
  "LI",
  "NO",
  // UK, Crown Dependencies, Gibraltar
  "GB",
  "GG",
  "JE",
  "IM",
  "GI",
  // Switzerland
  "CH",
]);

export type ConsentRegion = "default-on" | "opt-in";

export function normalizeCountry(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) && normalized !== GEO_UNKNOWN
    ? normalized
    : undefined;
}

export function consentRegionFor(country: string | null | undefined): ConsentRegion {
  const normalized = normalizeCountry(country);
  if (!normalized) return "opt-in";
  return CONSENT_REQUIRED_COUNTRIES.has(normalized) ? "opt-in" : "default-on";
}

export type StoredChoice = "granted" | "denied" | null;

/**
 * The one rule every measurement tag follows.
 * - "Not now" (stored denied) always wins.
 * - Global Privacy Control is an opt-out signal and wins over everything else.
 * - An explicit Allow pressed in this browser turns measurement on.
 * - Otherwise the region decides: on outside EU/EEA/UK/CH, off inside it or
 *   when the country is unknown.
 */
export function measurementAllowedFor(input: {
  stored: StoredChoice;
  gpc: boolean;
  country: string | null | undefined;
}): boolean {
  if (input.stored === "denied") return false;
  if (input.gpc) return false;
  if (input.stored === "granted") return true;
  return consentRegionFor(input.country) === "default-on";
}

export function readCookieValue(cookieHeader: string | null | undefined, name: string) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    return part.slice(index + 1).trim();
  }
  return undefined;
}

// ---- browser helpers --------------------------------------------------------

export function readStoredMeasurementChoice(): StoredChoice {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  } catch {
    return null;
  }
}

export function browserGpc(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}

/** Country handed down by the server; `undefined` when unknown or not yet known. */
export function readGeoCountry(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return normalizeCountry(readCookieValue(document.cookie, GEO_COOKIE));
}

/** True when the server has answered at all (a known country or explicit unknown). */
export function geoResolved(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(readCookieValue(document.cookie, GEO_COOKIE));
}

export function measurementAllowed(): boolean {
  return measurementAllowedFor({
    stored: readStoredMeasurementChoice(),
    gpc: browserGpc(),
    country: readGeoCountry(),
  });
}

export function browserConsentRegion(): ConsentRegion {
  return consentRegionFor(readGeoCountry());
}

let geoRequest: Promise<string | undefined> | undefined;

/**
 * Resolves the visitor's country. Normally already present as the `wd_geo`
 * cookie from the HTML response; otherwise asks `/api/geo` once (which also
 * sets the cookie). Failure resolves to `undefined` → opt-in required.
 */
export function resolveGeoCountry(): Promise<string | undefined> {
  if (geoResolved()) return Promise.resolve(readGeoCountry());
  if (typeof fetch === "undefined") return Promise.resolve(undefined);
  geoRequest ??= fetch("/api/geo", { credentials: "same-origin", cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { country?: string | null } | null) => normalizeCountry(body?.country ?? null))
    .catch(() => undefined);
  return geoRequest;
}

/**
 * The same rule as `measurementAllowedFor`, as a JavaScript expression for the
 * inline head bootstraps (which run before the bundle and cannot import).
 */
export const INLINE_MEASUREMENT_ALLOWED_JS = `(function(){
var s=null;try{s=localStorage.getItem(${JSON.stringify(CONSENT_STORAGE_KEY)});}catch(e){}
if(s==="denied")return false;
if(navigator.globalPrivacyControl===true)return false;
if(s==="granted")return true;
var m=document.cookie.match(/(?:^|;\\s*)${GEO_COOKIE}=([A-Za-z]{2})/);
var c=m?m[1].toUpperCase():"";
if(!c||c===${JSON.stringify(GEO_UNKNOWN)})return false;
return ${JSON.stringify([...CONSENT_REQUIRED_COUNTRIES])}.indexOf(c)<0;
})()`;

/** Serialises the server-side geo cookie. Not HttpOnly: the head bootstrap reads it. */
export function geoCookie(country: string | undefined, secure: boolean): string {
  return [
    `${GEO_COOKIE}=${country ?? GEO_UNKNOWN}`,
    "Path=/",
    "Max-Age=86400",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
