// First-touch campaign attribution for the landing page.
//
// Paid traffic arrives once on a tagged URL and then moves around the page, so
// every later read of `location.search` is empty. The first touch that carries
// a campaign is therefore written to localStorage and reused from then on —
// the same URL → storage → reuse shape `getRef()` already uses for `?ref=`.
// Without it the row records whichever untagged navigation happened to precede
// the submit, which is why signups have been landing with no campaign at all.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { normalizeCountry, measurementAllowed } from "./consentRegion.ts";
import type { LeadAttribution } from "./verification/contracts.ts";
import {
  SIGNUP_COUNTRY_SOURCE_UNKNOWN,
  SIGNUP_COUNTRY_SOURCE_VERCEL,
  SIGNUP_COUNTRY_UNKNOWN,
  type SignupCountryObservation,
} from "./verification/contracts.ts";
import { competitionRegistry, type CompetitionRound } from "./competitionRegistry.ts";
import {
  acceptsCompetitionCapture,
  isCompetitionAttempt,
  resolveCompetitionAttribution,
} from "./competitionAttribution.ts";

const STORAGE_KEY = "wd_attr";

/** Long enough for a real campaign name, short enough to stay a CRM cell. */
export const ATTRIBUTION_VALUE_MAX = 200;

/** `fbclid` is an opaque Meta token; current ones run to about 150 characters. */
export const FBCLID_MAX = 255;

export type Attribution = LeadAttribution & {
  /** Meta click id. Never persisted to the CRM — it only feeds the Meta match. */
  fbclid?: string;
  /** Google Ads click ids. Same rule: match the ad, never a CRM column. */
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  /** Stored for a later TikTok match. No TikTok tag is loaded. */
  ttclid?: string;
  /** When the click id was first seen, which is the time Meta's `fbc` encodes. */
  capturedAt?: number;
};

/**
 * The value characters a campaign token may keep. Everything a URL can carry
 * but an ad platform never legitimately emits — quotes, angle brackets, `=`,
 * `@`, control characters — is dropped rather than escaped, because the far end
 * is a CRM cell a human reads and exports rather than a string this code parses.
 * The only thing a real campaign loses here is an unresolved macro.
 */
const DISALLOWED_VALUE = /[^A-Za-z0-9 ._~:%|/+-]/g;

/** A path keeps no query and no fragment: those are captured as fields already. */
const DISALLOWED_PATH = /[^A-Za-z0-9._~/%-]/g;

const DISALLOWED_FBCLID = /[^A-Za-z0-9._-]/g;

export function sanitizeAttributionValue(value: unknown): string {
  if (typeof value !== "string") return "";
  // Whitespace collapses before the allowlist runs, so a newline becomes a
  // space rather than joining the two words either side of it.
  return value
    .replace(/\s+/g, " ")
    .replace(DISALLOWED_VALUE, "")
    .trim()
    .slice(0, ATTRIBUTION_VALUE_MAX);
}

export function sanitizeLandingPath(value: unknown): string {
  if (typeof value !== "string") return "";
  const path = (value.split(/[?#]/)[0] ?? "")
    .replace(DISALLOWED_PATH, "")
    .slice(0, ATTRIBUTION_VALUE_MAX);
  if (!path) return "";
  // One leading slash, always: the stored value names a page on this site, and
  // `//host` is not that even though it is a legal path.
  return `/${path.replace(/^\/+/, "")}`;
}

export function sanitizeFbclid(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(DISALLOWED_FBCLID, "").slice(0, FBCLID_MAX);
}

/** A campaign, as opposed to a visit: every direct arrival has a landing path. */
const CAMPAIGN_KEYS = [
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "utmTerm",
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "ttclid",
] as const;

const CLICK_ID_KEYS = ["fbclid", "gclid", "gbraid", "wbraid", "ttclid"] as const;

export function withoutClickIds(value: Attribution): Attribution {
  const clean = { ...value };
  for (const key of CLICK_ID_KEYS) delete clean[key];
  delete clean.capturedAt;
  return clean;
}

/** Purge only our click identifiers, including retired competition rounds. */
export function clearStoredClickIds(): void {
  if (typeof window === "undefined") return;
  try {
    const storage = window.localStorage;
    for (const key of Object.keys(storage)) {
      if (key !== STORAGE_KEY && !key.startsWith("wd_competition_attr_v1:")) continue;
      try {
        const raw = JSON.parse(storage.getItem(key) ?? "null");
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          storage.removeItem(key);
          continue;
        }
        const clean =
          key === STORAGE_KEY
            ? withoutClickIds(raw)
            : { ...raw, attribution: withoutClickIds(raw.attribution ?? {}) };
        storage.setItem(key, JSON.stringify(clean));
      } catch {
        storage.removeItem(key);
      }
    }
  } catch {
    /* Storage unavailable; getAttribution still returns no click IDs. */
  }
}

export function hasCampaignSignal(attribution: Attribution | undefined): boolean {
  return Boolean(attribution && CAMPAIGN_KEYS.some((key) => attribution[key]));
}

/** Empty values are dropped, so neither the payload nor a CRM cell carries "". */
function compact(attribution: Attribution): Attribution {
  const out: Attribution = {};
  if (attribution.utmSource) out.utmSource = attribution.utmSource;
  if (attribution.utmMedium) out.utmMedium = attribution.utmMedium;
  if (attribution.utmCampaign) out.utmCampaign = attribution.utmCampaign;
  if (attribution.utmContent) out.utmContent = attribution.utmContent;
  if (attribution.utmTerm) out.utmTerm = attribution.utmTerm;
  if (attribution.landingPath) out.landingPath = attribution.landingPath;
  for (const key of CLICK_ID_KEYS) {
    if (attribution[key]) out[key] = attribution[key];
  }
  // The capture time exists to date a click id, so it travels only with one.
  if (
    CLICK_ID_KEYS.some((key) => out[key]) &&
    attribution.capturedAt &&
    Number.isFinite(attribution.capturedAt)
  ) {
    out.capturedAt = attribution.capturedAt;
  }
  return out;
}

/**
 * Re-applies every bound to an attribution that came from somewhere untrusted —
 * a client payload, or this browser's own localStorage, which its owner can
 * edit as freely as any attacker can post to the server function.
 */
export function sanitizeAttribution(raw: Record<string, unknown> | undefined | null): Attribution {
  if (!raw || typeof raw !== "object") return {};
  const capturedAt = typeof raw.capturedAt === "number" ? raw.capturedAt : undefined;
  return compact({
    utmSource: sanitizeAttributionValue(raw.utmSource),
    utmMedium: sanitizeAttributionValue(raw.utmMedium),
    utmCampaign: sanitizeAttributionValue(raw.utmCampaign),
    utmContent: sanitizeAttributionValue(raw.utmContent),
    utmTerm: sanitizeAttributionValue(raw.utmTerm),
    landingPath: sanitizeLandingPath(raw.landingPath),
    fbclid: sanitizeFbclid(raw.fbclid),
    gclid: sanitizeFbclid(raw.gclid),
    gbraid: sanitizeFbclid(raw.gbraid),
    wbraid: sanitizeFbclid(raw.wbraid),
    ttclid: sanitizeFbclid(raw.ttclid),
    ...(capturedAt !== undefined ? { capturedAt } : {}),
  });
}

/** Reject an incoherent/expired competition claim without blocking the signup. */
export function sanitizeSignupAttribution(
  raw: Record<string, unknown> | undefined | null,
  now: number = Date.now(),
  registry: readonly CompetitionRound[] = competitionRegistry,
): Attribution {
  if (
    raw &&
    isCompetitionAttempt(raw, registry) &&
    !acceptsCompetitionCapture(raw, now, registry)
  ) {
    return sanitizeAttribution({ landingPath: raw.landingPath });
  }
  // Also catch IDs manufactured by the legacy punctuation sanitizer.
  const clean = sanitizeAttribution(raw);
  if (
    isCompetitionAttempt(clean, registry) &&
    !acceptsCompetitionCapture(raw ?? {}, now, registry)
  ) {
    return sanitizeAttribution({ landingPath: raw?.landingPath });
  }
  return clean;
}

/** What this page load's own URL says, before any stored first touch applies. */
export function readAttribution(search: string, pathname: string, now: number): Attribution {
  const params = new URLSearchParams(search);
  return sanitizeAttribution({
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    utmContent: params.get("utm_content"),
    utmTerm: params.get("utm_term"),
    landingPath: pathname,
    fbclid: params.get("fbclid"),
    gclid: params.get("gclid"),
    gbraid: params.get("gbraid"),
    wbraid: params.get("wbraid"),
    ttclid: params.get("ttclid"),
    capturedAt: now,
  });
}

export function mergeAttribution(
  stored: Attribution | undefined,
  incoming: Attribution,
): Attribution {
  // First touch wins. This is the line that stops an internal navigation, whose
  // URL carries nothing, from replacing the campaign that paid for the visit.
  if (hasCampaignSignal(stored)) return stored as Attribution;
  // A stored direct visit is not attribution, so a campaign arriving later is
  // still allowed to claim the visitor.
  if (hasCampaignSignal(incoming)) return incoming;
  return stored ?? incoming;
}

/** Drops the fields that stop at the server and never reach the CRM. */
export function toLeadAttribution(attribution: Attribution): LeadAttribution {
  const {
    fbclid: _fbclid,
    gclid: _gclid,
    gbraid: _gbraid,
    wbraid: _wbraid,
    ttclid: _ttclid,
    capturedAt: _capturedAt,
    ...lead
  } = attribution;
  return lead;
}

/**
 * The browser-side entry point: read this load's URL, reconcile it with the
 * first touch on record, and persist the winner. Mirrors `getRef()`, including
 * degrading to the current URL when storage is unavailable.
 */
export function getAttribution(
  registry: readonly CompetitionRound[] = competitionRegistry,
): Attribution {
  if (typeof window === "undefined") return {};
  const now = Date.now();
  const allowed = measurementAllowed();
  if (!allowed) clearStoredClickIds();
  const rawIncoming = readAttribution(window.location.search, window.location.pathname, now);
  const incoming = allowed ? rawIncoming : withoutClickIds(rawIncoming);
  const params = new URLSearchParams(window.location.search);
  // Repeated tuple keys are ambiguous, rather than a choice of first/last value.
  const tupleValue = (key: string) =>
    params.getAll(key).length === 1 ? params.get(key) : undefined;
  const rawTuple = {
    utmCampaign: tupleValue("utm_campaign"),
    utmTerm: tupleValue("utm_term"),
    utmContent: tupleValue("utm_content"),
  };
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    /* Restricted webview. */
  }
  const scoped = resolveCompetitionAttribution({ incoming, rawTuple, now, registry, storage });
  if (scoped.kind === "competition")
    return sanitizeAttribution(allowed ? scoped.attribution : withoutClickIds(scoped.attribution));
  if (scoped.kind === "rejected" || isCompetitionAttempt(incoming, registry)) {
    return sanitizeAttribution({ landingPath: incoming.landingPath });
  }
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const stored = raw
      ? sanitizeAttribution(JSON.parse(raw) as Record<string, unknown>)
      : undefined;
    // Never resurrect a competition tuple from the unbounded legacy key.
    const legacy = stored && !isCompetitionAttempt(stored, registry) ? stored : undefined;
    const merged = mergeAttribution(allowed ? legacy : legacy && withoutClickIds(legacy), incoming);
    storage?.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    // Storage can be unavailable in a restricted webview, and stored JSON can be
    // anything. Either way this page load still reports what its own URL carried.
    return incoming;
  }
}

/**
 * Assigned ISO 3166-1 alpha-2 codes, plus `XK`.
 *
 * `XK` is the user-assigned code geo databases, including the one behind
 * Vercel's country header, emit for Kosovo. It is not an official ISO
 * assignment. Proxy and reserved codes (`T1`, `A1`, `EU`, `XX`, `UK`) are
 * absent on purpose: those observations are stored as `unknown`.
 */
const ISO_SIGNUP_COUNTRIES = new Set(
  `
  AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
  BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
  CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
  DE DJ DK DM DO DZ
  EC EE EG EH ER ES ET
  FI FJ FK FM FO FR
  GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
  HK HM HN HR HT HU
  ID IE IL IM IN IO IQ IR IS IT
  JE JM JO JP
  KE KG KH KI KM KN KP KR KW KY KZ
  LA LB LC LI LK LR LS LT LU LV LY
  MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
  NA NC NE NF NG NI NL NO NP NR NU NZ
  OM
  PA PE PF PG PH PK PL PM PN PR PS PT PW PY
  QA
  RE RO RS RU RW
  SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
  TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
  UA UG UM US UY UZ
  VA VC VE VG VI VN VU
  WF WS
  XK
  YE YT
  ZA ZM ZW
`
    .split(/\s+/)
    .filter(Boolean),
);

export const SIGNUP_COUNTRY_CODE_COUNT = ISO_SIGNUP_COUNTRIES.size;

/** A stored country cell: `unknown`, or one coarse ISO code. Nothing else. */
export function persistableSignupCountry(value: unknown): string | undefined {
  if (value === SIGNUP_COUNTRY_UNKNOWN) return SIGNUP_COUNTRY_UNKNOWN;
  const code = normalizeCountry(typeof value === "string" ? value : undefined);
  return code && ISO_SIGNUP_COUNTRIES.has(code) ? code : undefined;
}

/**
 * Last gate before a CRM write. A vercel-sourced code that is not a country
 * becomes `unknown` while keeping that sensor. Any other source cannot carry
 * a country code. An unparseable timestamp drops the whole observation rather
 * than inventing one.
 */
export function coerceSignupCountryObservation(
  raw: SignupCountryObservation | undefined,
): SignupCountryObservation | undefined {
  if (!raw) return undefined;
  const observedMs = Date.parse(raw.countryObservedAt);
  if (!Number.isFinite(observedMs)) return undefined;
  const countryObservedAt = new Date(observedMs).toISOString();
  if (raw.countrySource === SIGNUP_COUNTRY_SOURCE_VERCEL) {
    return {
      country: persistableSignupCountry(raw.country) ?? SIGNUP_COUNTRY_UNKNOWN,
      countrySource: SIGNUP_COUNTRY_SOURCE_VERCEL,
      countryObservedAt,
    };
  }
  return {
    country: SIGNUP_COUNTRY_UNKNOWN,
    countrySource: SIGNUP_COUNTRY_SOURCE_UNKNOWN,
    countryObservedAt,
  };
}

export type SignupCountryProbe = {
  trustedVercel: boolean;
  /**
   * The raw `x-vercel-ip-country` value. Only read when this process is the
   * Vercel runtime. An untrusted local process leaves this `null` and does
   * not consult the header a client can set.
   */
  header: string | null;
};

/**
 * Whether this process may believe `x-vercel-ip-country`.
 *
 * Vercel sets `VERCEL=1` and overwrites that header. A laptop, a test, or a
 * preview that is not Vercel must not treat a client-supplied copy as the
 * visitor's country. `WATCHDIVE_DEV_GEO_COUNTRY` is intentionally not a
 * substitute here: it may shape the consent cookie, but it must not become a
 * CRM country.
 */
export function readSignupCountryProbe(input: {
  vercelEnv: string | undefined;
  readHeader: () => string | null | undefined;
}): SignupCountryProbe {
  if (input.vercelEnv !== "1") return { trustedVercel: false, header: null };
  try {
    const header = input.readHeader();
    return { trustedVercel: true, header: typeof header === "string" ? header : null };
  } catch {
    return { trustedVercel: true, header: null };
  }
}

/** The country this signup may persist. Never an IP, city, or client claim. */
export function observeSignupCountry(input: {
  trustedVercel: boolean;
  header: string | null | undefined;
  observedAt: Date;
}): SignupCountryObservation {
  const ms = input.observedAt.getTime();
  const countryObservedAt = Number.isFinite(ms)
    ? new Date(ms).toISOString()
    : new Date(0).toISOString();
  if (!input.trustedVercel) {
    return {
      country: SIGNUP_COUNTRY_UNKNOWN,
      countrySource: SIGNUP_COUNTRY_SOURCE_UNKNOWN,
      countryObservedAt,
    };
  }
  return {
    country: persistableSignupCountry(input.header) ?? SIGNUP_COUNTRY_UNKNOWN,
    countrySource: SIGNUP_COUNTRY_SOURCE_VERCEL,
    countryObservedAt,
  };
}
