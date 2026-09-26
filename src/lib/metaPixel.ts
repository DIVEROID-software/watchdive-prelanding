// Meta Pixel — browser side. Measurement stays off unless the public production
// gate is on and the dataset id is valid. Then the regional rule in
// `consentRegion.ts` decides: outside EU/EEA/UK/CH the pixel loads by default;
// inside (or when the country is unknown) it waits for Allow. Global Privacy
// Control and an explicit Not now always keep it off.
import { browserGpc, readGeoCountry, measurementAllowedFor } from "./consentRegion.ts";

const META_TRACKING_ENABLED =
  (import.meta.env.VITE_META_TRACKING_ENABLED as string | undefined)?.trim() === "true";
const META_PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID as string | undefined)?.trim() ?? "";
const META_CONSENT_STORAGE_KEY = "watchdive.measurement-consent.v3";
const META_PIXEL_SCRIPT_ID = "watchdive-meta-pixel";

export type MetaMeasurementConsent = "granted" | "denied";

let inMemoryConsent: MetaMeasurementConsent | null = null;

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: unknown;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    __watchDiveMetaPixelId?: string;
    __watchDiveMetaPageViewSent?: boolean;
  }
}

export function isMetaPixelConfigured(): boolean {
  return META_TRACKING_ENABLED && /^\d{10,20}$/.test(META_PIXEL_ID);
}

export function getMetaMeasurementConsent(): MetaMeasurementConsent | null {
  if (inMemoryConsent) return inMemoryConsent;
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(META_CONSENT_STORAGE_KEY);
    if (stored === "granted" || stored === "denied") {
      inMemoryConsent = stored;
      return stored;
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts. In that case,
    // consent applies only to the current page through the in-memory value.
  }

  return null;
}

/** The shared measurement rule, with this module's in-memory choice. */
export function measurementPermitted(): boolean {
  return measurementAllowedFor({
    stored: getMetaMeasurementConsent(),
    gpc: browserGpc(),
    country: readGeoCountry(),
  });
}

export function hasMetaMeasurementConsent(): boolean {
  return isMetaPixelConfigured() && measurementPermitted();
}

export function setMetaMeasurementConsent(choice: MetaMeasurementConsent): void {
  inMemoryConsent = choice;
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(META_CONSENT_STORAGE_KEY, choice);
  } catch {
    // The in-memory choice still applies for this page load.
  }

  if (choice === "denied" && window.fbq) {
    window.fbq("consent", "revoke");
  }
  if (choice === "denied") {
    // Same switch as the pixel. Imported lazily so this module stays free of
    // the Google loader when Meta is the only tag configured.
    void import("./googleTag").then(({ revokeGoogleMeasurement }) => revokeGoogleMeasurement());
  }
}

export function initMetaPixel() {
  if (typeof window === "undefined" || !hasMetaMeasurementConsent()) return;

  if (!window.fbq) {
    const fbq = function (this: unknown, ...args: unknown[]) {
      if (fbq.callMethod) {
        fbq.callMethod(...args);
      } else {
        fbq.queue.push(args);
      }
    } as Fbq;
    fbq.queue = [];
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    window.fbq = fbq;
    if (!window._fbq) window._fbq = fbq;
  }

  if (!document.getElementById(META_PIXEL_SCRIPT_ID)) {
    const script = document.createElement("script");
    script.id = META_PIXEL_SCRIPT_ID;
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }

  window.fbq("consent", "grant");
  if (window.__watchDiveMetaPixelId !== META_PIXEL_ID) {
    window.fbq("init", META_PIXEL_ID);
    window.__watchDiveMetaPixelId = META_PIXEL_ID;
  }
  if (!window.__watchDiveMetaPageViewSent) {
    window.fbq("track", "PageView");
    window.__watchDiveMetaPageViewSent = true;
  }
}

// Every deduplicated standard event has to clear the same bar: consent, an
// initialized pixel for this dataset, and an event id the server leg can match.
function canTrackStandardEvent(eventId: string): boolean {
  return (
    typeof window !== "undefined" &&
    hasMetaMeasurementConsent() &&
    Boolean(window.fbq) &&
    window.__watchDiveMetaPixelId === META_PIXEL_ID &&
    /^[A-Za-z0-9._:-]{8,64}$/.test(eventId)
  );
}

// `Lead` fires the moment the server accepts an email submit (2026-09-26,
// founder decision): waiting for the confirmation click left Meta with about
// one conversion a week, too few to optimise delivery. The server mirrors it
// through the Conversions API under the same event id, so Meta counts one.
// A tripped honeypot or a resend never fires it.
export function trackMetaLead(eventId: string, source: string) {
  if (!canTrackStandardEvent(eventId)) return;

  window.fbq!(
    "track",
    "Lead",
    { content_name: "watchdive_email_signup", content_category: source },
    { eventID: eventId },
  );
}

// The confirmation click, reported as a custom event so it never adds a second
// `Lead` for the same person. The server sends the matching CAPI leg.
export function trackMetaEmailVerified(eventId: string, source: string) {
  if (!canTrackStandardEvent(eventId)) return;

  window.fbq!(
    "trackCustom",
    "EmailVerified",
    { content_name: "watchdive_email_verified", content_category: source },
    { eventID: eventId },
  );
}

// A separate standard Contact conversion lets Ads Manager report phone-number
// acquisition cost without ever sending the phone number itself to Meta.
export function trackMetaPhoneLead(eventId: string, source: string) {
  if (!canTrackStandardEvent(eventId)) return;

  window.fbq!(
    "track",
    "Contact",
    { content_name: "watchdive_phone_signup", content_category: source },
    { eventID: eventId },
  );
}

// Funnel micro-signal (reporting only — optimization stays on Lead).
export function trackMetaCustom(name: string, params?: Record<string, unknown>) {
  if (
    typeof window === "undefined" ||
    !hasMetaMeasurementConsent() ||
    !window.fbq ||
    window.__watchDiveMetaPixelId !== META_PIXEL_ID
  ) {
    return;
  }
  window.fbq("trackCustom", name, params ?? {});
}

// _fbp/_fbc cookies are set by the pixel (_fbc only after an fbclid landing).
// Passed to the server so the Conversions API event carries the same identifiers.
export function getMetaCookies(): { fbp?: string; fbc?: string } {
  if (typeof document === "undefined" || !hasMetaMeasurementConsent()) return {};
  const read = (name: string) =>
    document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${name}=`))
      ?.slice(name.length + 1);
  const fbp = read("_fbp");
  const fbc = read("_fbc");
  return { ...(fbp ? { fbp } : {}), ...(fbc ? { fbc } : {}) };
}

export function newMetaEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `wd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
