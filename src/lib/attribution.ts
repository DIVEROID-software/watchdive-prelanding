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
import type { LeadAttribution } from "./verification/contracts.ts";

const STORAGE_KEY = "wd_attr";

/** Long enough for a real campaign name, short enough to stay a CRM cell. */
export const ATTRIBUTION_VALUE_MAX = 200;

/** `fbclid` is an opaque Meta token; current ones run to about 150 characters. */
export const FBCLID_MAX = 255;

export type Attribution = LeadAttribution & {
  /** Meta click id. Never persisted to the CRM — it only feeds the Meta match. */
  fbclid?: string;
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
] as const;

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
  // The capture time exists to date the click id, so it travels only with one.
  if (attribution.fbclid) {
    out.fbclid = attribution.fbclid;
    if (attribution.capturedAt && Number.isFinite(attribution.capturedAt)) {
      out.capturedAt = attribution.capturedAt;
    }
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
    ...(capturedAt !== undefined ? { capturedAt } : {}),
  });
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
  const { fbclid: _fbclid, capturedAt: _capturedAt, ...lead } = attribution;
  return lead;
}

/**
 * The browser-side entry point: read this load's URL, reconcile it with the
 * first touch on record, and persist the winner. Mirrors `getRef()`, including
 * degrading to the current URL when storage is unavailable.
 */
export function getAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  const incoming = readAttribution(window.location.search, window.location.pathname, Date.now());
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    const merged = mergeAttribution(stored ? sanitizeAttribution(stored) : undefined, incoming);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    // Storage can be unavailable in a restricted webview, and stored JSON can be
    // anything. Either way this page load still reports what its own URL carried.
    return incoming;
  }
}
