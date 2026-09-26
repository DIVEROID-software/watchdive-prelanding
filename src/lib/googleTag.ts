// Google Analytics 4 and Google Ads. Both no-op until their public ids are set.
//
// Consent matches the Meta pixel: marketing storage stays off until this
// browser clicks Allow. Consent Mode v2 is set before any tag config.
// An explicit deny, no choice yet, or Global Privacy Control never loads the tag.

const GA_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;
const ADS_ID_PATTERN = /^AW-\d{6,20}$/;
const ADS_LABEL_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

export const GOOGLE_CONSENT_STORAGE_KEY = "watchdive.measurement-consent.v3";

export type GoogleTagConfig = {
  gaId?: string;
  adsId?: string;
  adsLabel?: string;
};

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
  return {
    ...(GA_ID_PATTERN.test(gaId) ? { gaId } : {}),
    ...(ADS_ID_PATTERN.test(adsId) ? { adsId } : {}),
    ...(ADS_ID_PATTERN.test(adsId) && ADS_LABEL_PATTERN.test(adsLabel) ? { adsLabel } : {}),
  };
}

export function isGoogleTagConfigured(config: GoogleTagConfig = readGoogleTagConfig()): boolean {
  return Boolean(config.gaId || config.adsId);
}

/** Same switch as the Meta pixel: only an explicit Allow turns storage on. */
export function googleConsentChoice(input: {
  stored: string | null;
  gpc: boolean;
}): GoogleConsentChoice {
  if (input.gpc || input.stored !== "granted") return "denied";
  return "granted";
}

function readBrowserConsent(): GoogleConsentChoice {
  if (typeof window === "undefined") return "denied";
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(GOOGLE_CONSENT_STORAGE_KEY);
  } catch {
    stored = null;
  }
  const gpc =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  return googleConsentChoice({ stored, gpc });
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

export function initGoogleTag() {
  if (typeof window === "undefined") return;
  const config = readGoogleTagConfig();
  if (!isGoogleTagConfigured(config) || readBrowserConsent() === "denied") return;

  const gtag = ensureGtag();
  if (!gtag) return;
  grantConsent(gtag);
  gtag("js", new Date());
  if (config.gaId) gtag("config", config.gaId, { send_page_view: false });
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
    gtag("event", "page_view", { page_path: window.location.pathname });
    window.__watchDiveGooglePageViewSent = true;
  }
}

function canTrack(): boolean {
  return (
    typeof window !== "undefined" &&
    isGoogleTagConfigured() &&
    readBrowserConsent() === "granted" &&
    Boolean(window.gtag)
  );
}

export function trackGoogleFormStart(placement: string) {
  if (!canTrack() || !readGoogleTagConfig().gaId) return;
  window.gtag!("event", "form_start", {
    form_id: placement,
    page_path: window.location.pathname,
  });
}

export function trackGoogleSubmit(eventId: string, placement: string) {
  if (!canTrack() || !readGoogleTagConfig().gaId || !EVENT_ID_PATTERN.test(eventId)) return;
  window.gtag!("event", "sign_up", {
    method: "email",
    form_id: placement,
    event_id: eventId,
  });
}

export function trackGoogleLead(eventId: string, placement: string) {
  if (!canTrack() || !EVENT_ID_PATTERN.test(eventId)) return;
  const config = readGoogleTagConfig();
  if (config.gaId) {
    window.gtag!("event", "generate_lead", {
      form_id: placement,
      event_id: eventId,
    });
  }
  if (config.adsId && config.adsLabel) {
    window.gtag!("event", "conversion", {
      send_to: `${config.adsId}/${config.adsLabel}`,
      transaction_id: eventId,
    });
  }
}

export function trackGooglePhone(eventId: string, placement: string) {
  if (!canTrack() || !readGoogleTagConfig().gaId || !EVENT_ID_PATTERN.test(eventId)) return;
  window.gtag!("event", "watchdive_phone", {
    form_id: placement,
    event_id: eventId,
  });
}

/** Inline head snippet. Empty when no id is configured. */
export function googleTagBootstrap(config: GoogleTagConfig): string {
  if (!isGoogleTagConfigured(config)) return "";
  const srcId = loaderId(config)!;
  return `(function(){try{
  if(localStorage.getItem(${JSON.stringify(GOOGLE_CONSENT_STORAGE_KEY)})!=="granted")return;
  if(navigator.globalPrivacyControl===true)return;
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
