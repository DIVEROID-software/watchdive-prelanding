// Google Analytics 4 and Google Ads. Both no-op until their public ids are set.
//
// Consent matches the Meta pixel (`consentRegion.ts`): outside EU/EEA/UK/CH
// the tag loads by default; inside, or with an unknown country, only after
// Allow. "Not now" or Global Privacy Control never loads it. Consent Mode v2
// is set before any tag config.
//
// Three Ads labels stay separate. `VITE_GOOGLE_ADS_CONVERSION_LABEL` is only the
// historical confirmed-email conversion. The signup label is the verified
// signup (first CompleteRegistration), not the raw email Lead. The purchase
// label is the Stripe-confirmed USD 3 reservation. A set label only means this
// tag will call that send_to. It does not mean the Ads account has that action
// configured, or that GA4 and Ads are both primary. A blank env sends nothing.

import {
  CONSENT_STORAGE_KEY,
  INLINE_MEASUREMENT_ALLOWED_JS,
  measurementAllowedFor,
  readGeoCountry,
  readStoredMeasurementChoice,
} from "./consentRegion.ts";
import { stripLocalePrefix } from "./i18n/locale.ts";
import { RESERVATION_CURRENCY, RESERVATION_FEE_CENTS } from "./reservation/constants.ts";
import { googleClientId } from "./analytics/browserContext.ts";

export { googleClientId };

const GA_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;
const ADS_ID_PATTERN = /^AW-\d{6,20}$/;
const ADS_LABEL_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
// 64 hex chars plus a short suffix such as `:phone` (70). The pixel accepts
// the same width; a 64-char ceiling dropped the phone conversion.
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;

export function isGoogleEventId(eventId: string): boolean {
  return EVENT_ID_PATTERN.test(eventId);
}

export const GOOGLE_CONSENT_STORAGE_KEY = CONSENT_STORAGE_KEY;

export type GoogleTagConfig = {
  gaId?: string;
  adsId?: string;
  /** Historical confirmed-email conversion. Not signup and not purchase. */
  adsLabel?: string;
  /** Verified signup (first CompleteRegistration). Not the raw email Lead. */
  signupLabel?: string;
  /** Stripe-confirmed USD 3 reservation. Charge time is the transaction time. */
  purchaseLabel?: string;
};

const RESERVATION_PURCHASE_VALUE = RESERVATION_FEE_CENTS / 100;
const RESERVATION_PURCHASE_CURRENCY = RESERVATION_CURRENCY.toUpperCase();

export type GoogleConsentChoice = "granted" | "denied";

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    __watchDiveGooglePageViewSent?: boolean;
  }
}

export function readGoogleTagConfig(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): GoogleTagConfig {
  const gaId = env.VITE_GA_MEASUREMENT_ID?.trim() ?? "";
  const adsId = env.VITE_GOOGLE_ADS_ID?.trim() ?? "";
  const adsLabel = env.VITE_GOOGLE_ADS_CONVERSION_LABEL?.trim() ?? "";
  const signupLabel = env.VITE_GOOGLE_ADS_SIGNUP_LABEL?.trim() ?? "";
  const purchaseLabel = env.VITE_GOOGLE_ADS_PURCHASE_LABEL?.trim() ?? "";
  const adsReady = ADS_ID_PATTERN.test(adsId);
  return {
    ...(GA_ID_PATTERN.test(gaId) ? { gaId } : {}),
    ...(adsReady ? { adsId } : {}),
    ...(adsReady && ADS_LABEL_PATTERN.test(adsLabel) ? { adsLabel } : {}),
    ...(adsReady && ADS_LABEL_PATTERN.test(signupLabel) ? { signupLabel } : {}),
    ...(adsReady && ADS_LABEL_PATTERN.test(purchaseLabel) ? { purchaseLabel } : {}),
  };
}

export function isGoogleTagConfigured(config: GoogleTagConfig = readGoogleTagConfig()): boolean {
  return Boolean(config.gaId || config.adsId);
}

/** Same switch as the Meta pixel (see `measurementAllowedFor`). */
export function googleConsentChoice(input: {
  stored: string | null;
  gpc: boolean;
  country?: string | null;
}): GoogleConsentChoice {
  const stored = input.stored === "granted" || input.stored === "denied" ? input.stored : null;
  return measurementAllowedFor({ stored, gpc: input.gpc, country: input.country })
    ? "granted"
    : "denied";
}

export function readBrowserConsent(): GoogleConsentChoice {
  if (typeof window === "undefined") return "denied";
  const stored = readStoredMeasurementChoice();
  const gpc =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  return googleConsentChoice({ stored, gpc, country: readGeoCountry() });
}

function ensureGtag(): Gtag | null {
  if (typeof window === "undefined") return null;
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
  }
  return window.gtag;
}

function grantConsent(gtag: Gtag) {
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    functionality_storage: "granted",
    security_storage: "granted",
    wait_for_update: 500,
  });
  gtag("consent", "update", {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "granted",
  });
}

export function revokeGoogleMeasurement(): void {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("consent", "update", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
}

function loaderId(config: GoogleTagConfig): string | undefined {
  return config.gaId ?? config.adsId;
}

type MeasurementLocation = {
  pathname?: string;
  search?: string;
  hash?: string;
  origin?: string;
  protocol?: string;
};

/** Reservation, a still-present verify token, or a Stripe session id. */
export function tagLoadBlocked(locationLike: MeasurementLocation): boolean {
  const pathname = locationLike.pathname || "/";
  let path = "/";
  try {
    path = stripLocalePrefix(pathname).replace(/\/+$/, "") || "/";
  } catch {
    return true;
  }
  if (path === "/reservation" || path === "/admin/behavior" || path === "/buddy" || path.startsWith("/buddy/")) {
    return true;
  }
  if (path === "/verify" && (locationLike.hash ?? "").length > 1) return true;
  const raw = locationLike.search ?? "";
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  return params.has("session_id") || params.has("token");
}

/** True only after the confirmation token and any Stripe session id are gone. */
export function verifyMeasurementUrlSafe(locationLike: MeasurementLocation): boolean {
  if ((locationLike.hash ?? "").length > 1) return false;
  return !tagLoadBlocked(locationLike);
}

function mintGoogleClientId(): string {
  const part = () => {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = new Uint32Array(1);
      crypto.getRandomValues(bytes);
      return String(1000000000 + (bytes[0] % 9000000000));
    }
    return String(1000000000 + Math.floor(Math.random() * 9000000000));
  };
  return `${part()}.${part()}`;
}

export type GoogleTagInitOptions = {
  clientId?: string;
  pageLocation?: string;
  config?: GoogleTagConfig;
};

export function initGoogleTag(options?: GoogleTagInitOptions) {
  if (typeof window === "undefined") return;
  if (tagLoadBlocked(window.location)) return;
  const config = options?.config ?? readGoogleTagConfig();
  if (!isGoogleTagConfigured(config) || readBrowserConsent() === "denied") return;

  const gtag = ensureGtag();
  if (!gtag) return;
  grantConsent(gtag);
  gtag("js", new Date());
  if (config.gaId) {
    gtag("config", config.gaId, {
      send_page_view: false,
      ...(options?.clientId ? { client_id: options.clientId } : {}),
      ...(options?.pageLocation ? { page_location: options.pageLocation } : {}),
    });
  }
  if (config.adsId) gtag("config", config.adsId);

  const srcId = loaderId(config);
  if (srcId && !document.getElementById("watchdive-google-tag")) {
    const script = document.createElement("script");
    script.id = "watchdive-google-tag";
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(srcId)}`;
    document.head.appendChild(script);
  }

  if (config.gaId && !window.__watchDiveGooglePageViewSent) {
    gtag("event", "page_view", {
      page_path: window.location.pathname,
      ...(options?.pageLocation ? { page_location: options.pageLocation } : {}),
    });
    window.__watchDiveGooglePageViewSent = true;
  }
}

/**
 * Synchronous. Does not wait for gtag.js.
 * Used on /verify only after the token hash is gone, and only when the server
 * rollout is on and this browser has no client id yet. An existing landing
 * cookie is left alone so this page does not load a third party or mint a
 * second identity. Reservation and session_id URLs are refused.
 */
export function attachVerifiedGoogleClient(
  locationLike: MeasurementLocation = typeof window === "undefined"
    ? { hash: "#", search: "", pathname: "/verify" }
    : window.location,
  env?: Record<string, string | undefined>,
  config?: GoogleTagConfig,
): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (!verifyMeasurementUrlSafe(locationLike)) return false;
  if (readBrowserConsent() !== "granted") return false;
  if (!serverSignupMeasurementEnabled(env)) return false;
  if (googleClientId()) return false;
  const clientId = mintGoogleClientId();
  const protocol = locationLike.protocol ?? window.location.protocol;
  const secure = protocol === "https:" ? "; Secure" : "";
  document.cookie = `_ga=GA1.1.${clientId}; Path=/; Max-Age=63072000; SameSite=Lax${secure}`;
  const origin = locationLike.origin ?? window.location.origin;
  initGoogleTag({
    clientId,
    pageLocation: `${origin}${locationLike.pathname ?? ""}`,
    ...(config ? { config } : {}),
  });
  return googleClientId() === clientId;
}

function canTrack(config: GoogleTagConfig = readGoogleTagConfig()): boolean {
  return (
    typeof window !== "undefined" &&
    !tagLoadBlocked(window.location) &&
    isGoogleTagConfigured(config) &&
    readBrowserConsent() === "granted" &&
    Boolean(window.gtag)
  );
}

export function trackGoogleFormStart(placement: string, config: GoogleTagConfig = readGoogleTagConfig()) {
  if (!canTrack(config) || !config.gaId) return;
  window.gtag!("event", "form_start", {
    form_id: placement,
    page_path: window.location.pathname,
  });
}

const browserVerifiedLeadIds = new Set<string>();

export function trackGoogleSubmit(
  eventId: string,
  placement: string,
  config: GoogleTagConfig = readGoogleTagConfig(),
) {
  if (!canTrack(config) || !config.gaId || !isGoogleEventId(eventId)) return;
  window.gtag!("event", "signup_pending", {
    method: "email",
    form_id: placement,
    event_id: eventId,
  });
}

export function serverSignupMeasurementEnabled(
  env: Record<string, string | undefined> = import.meta.env ?? {},
): boolean {
  return env.VITE_GA4_SERVER_CONVERSIONS_ENABLED === "true";
}

/** First call for an event id wins, including a later reload of the same browser. */
function claimBrowserVerifiedLead(eventId: string): boolean {
  if (browserVerifiedLeadIds.has(eventId)) return false;
  const storageKey = `wd.ga4.verified-signup.${eventId}`;
  try {
    if (window.localStorage.getItem(storageKey) === "1") {
      browserVerifiedLeadIds.add(eventId);
      return false;
    }
    window.localStorage.setItem(storageKey, "1");
  } catch {
    // Private mode and test doubles keep the in-memory claim below.
  }
  if (browserVerifiedLeadIds.size > 1000) browserVerifiedLeadIds.clear();
  browserVerifiedLeadIds.add(eventId);
  return true;
}

export function trackGoogleLead(
  eventId: string,
  placement: string,
  config: GoogleTagConfig = readGoogleTagConfig(),
  env?: Record<string, string | undefined>,
) {
  if (!canTrack(config) || !isGoogleEventId(eventId)) return;
  // Landing poll only. /verify does not call this. While the public server
  // switch is off, one claim sends generate_lead and the imported sign_up.
  // When that switch is on, the server Measurement Protocol owns sign_up and
  // both browser events stay quiet. signup_pending is a different function.
  if (config.gaId && !serverSignupMeasurementEnabled(env) && claimBrowserVerifiedLead(eventId)) {
    window.gtag!("event", "generate_lead", {
      form_id: placement,
      event_id: eventId,
    });
    window.gtag!("event", "sign_up", {
      method: "email",
      form_id: placement,
      event_id: eventId,
    });
  }
  // Confirmed-email label only. Signup and purchase labels must not ride this call.
  // Google Ads remains separate from the GA4 server signup.
  if (config.adsId && config.adsLabel) {
    window.gtag!("event", "conversion", {
      send_to: `${config.adsId}/${config.adsLabel}`,
      transaction_id: eventId,
    });
  }
}

export function trackGooglePhone(
  eventId: string,
  placement: string,
  config: GoogleTagConfig = readGoogleTagConfig(),
) {
  if (!canTrack(config) || !config.gaId || !isGoogleEventId(eventId)) return;
  window.gtag!("event", "watchdive_phone", {
    form_id: placement,
    event_id: eventId,
  });
}

/**
 * Verified-signup Ads conversion. Callers pass the CompleteRegistration event id.
 * The raw email Lead does not call this. No-op until VITE_GOOGLE_ADS_SIGNUP_LABEL
 * is set. Setting the label does not create or verify an Ads account action.
 */
export function trackGoogleDurableSignup(
  eventId: string,
  config: GoogleTagConfig = readGoogleTagConfig(),
): boolean {
  if (!canTrack(config) || !isGoogleEventId(eventId) || !config.adsId || !config.signupLabel) return false;
  window.gtag!("event", "conversion", {
    send_to: `${config.adsId}/${config.signupLabel}`,
    transaction_id: eventId,
  });
  return true;
}

/**
 * Stripe-confirmed reservation fee. Browser GA4 `purchase` is the fallback
 * until the public server switch is on; the server sender then owns that
 * event. The Ads conversion stays separate and fires only when its own label
 * is set. A set label does not mean the Ads account has that action.
 */
export function trackGoogleReservationPurchase(
  eventId: string,
  config: GoogleTagConfig = readGoogleTagConfig(),
  env?: Record<string, string | undefined>,
): { ads: boolean; ga4: boolean } {
  const result = { ads: false, ga4: false };
  if (!canTrack(config) || !isGoogleEventId(eventId)) return result;
  if (config.gaId && !serverSignupMeasurementEnabled(env)) {
    window.gtag!("event", "purchase", {
      transaction_id: eventId,
      value: RESERVATION_PURCHASE_VALUE,
      currency: RESERVATION_PURCHASE_CURRENCY,
      items: [
        {
          item_id: "watchdive_reservation_fee",
          item_name: "WatchDive reservation fee",
          price: RESERVATION_PURCHASE_VALUE,
          quantity: 1,
        },
      ],
    });
    result.ga4 = true;
  }
  if (config.adsId && config.purchaseLabel) {
    window.gtag!("event", "conversion", {
      send_to: `${config.adsId}/${config.purchaseLabel}`,
      transaction_id: eventId,
      value: RESERVATION_PURCHASE_VALUE,
      currency: RESERVATION_PURCHASE_CURRENCY,
    });
    result.ads = true;
  }
  return result;
}

/** Inline head snippet. Empty when no id is configured. */
export function googleTagBootstrap(config: GoogleTagConfig): string {
  if (!isGoogleTagConfigured(config)) return "";
  const srcId = loaderId(config)!;
  return `(function(){try{
  if(!${INLINE_MEASUREMENT_ALLOWED_JS})return;
  window.dataLayer=window.dataLayer||[];
  window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
  window.gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",analytics_storage:"denied",functionality_storage:"granted",security_storage:"granted",wait_for_update:500});
  window.gtag("consent","update",{ad_storage:"granted",ad_user_data:"granted",ad_personalization:"granted",analytics_storage:"granted"});
  window.gtag("js",new Date());
  ${config.gaId ? `window.gtag("config",${JSON.stringify(config.gaId)},{send_page_view:false});` : ""}
  ${config.adsId ? `window.gtag("config",${JSON.stringify(config.adsId)});` : ""}
  ${config.gaId ? `if(!window.__watchDiveGooglePageViewSent){window.gtag("event","page_view",{page_path:location.pathname});window.__watchDiveGooglePageViewSent=true;}` : ""}
  if(!document.getElementById("watchdive-google-tag")){var s=document.createElement("script");s.id="watchdive-google-tag";s.async=true;s.src=${JSON.stringify(`https://www.googletagmanager.com/gtag/js?id=${srcId}`)};document.head.appendChild(s);}
}catch(e){}})();`;
}
