// Meta Pixel — browser side. Measurement remains completely off unless the
// public production gate is explicitly enabled, the dataset id is valid, and
// the visitor has explicitly submitted a waitlist form. Form submission is the
// consent action described by the existing privacy contract; no visual consent
// surface is added to the locked production design.
const META_TRACKING_ENABLED =
  (import.meta.env?.VITE_META_TRACKING_ENABLED as string | undefined)?.trim() === "true";
const META_PIXEL_ID = (import.meta.env?.VITE_META_PIXEL_ID as string | undefined)?.trim() ?? "";
const META_CONSENT_STORAGE_KEY = "watchdive.measurement-consent.v3";
const META_PIXEL_SCRIPT_ID = "watchdive-meta-pixel";
const dispatchedStandardEvents = new Set<string>();

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

export function isMetaMeasurementAllowed(args: {
  configured: boolean;
  consent: MetaMeasurementConsent | null;
  globalPrivacyControl: boolean;
}): boolean {
  return args.configured && args.consent === "granted" && !args.globalPrivacyControl;
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

export function hasMetaMeasurementConsent(): boolean {
  const globalPrivacyControl =
    typeof navigator !== "undefined" &&
    "globalPrivacyControl" in navigator &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  return isMetaMeasurementAllowed({
    configured: isMetaPixelConfigured(),
    consent: getMetaMeasurementConsent(),
    globalPrivacyControl,
  });
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

// Fire only after the server confirms a NEW signup (never on button click, never
// for duplicates) — otherwise ad optimization learns from junk conversions.
export function enqueueMetaStandardEvent(args: {
  fbq?: (...args: unknown[]) => void;
  eventName: "Lead" | "Contact";
  eventId: string;
  source: string;
  contentName: "watchdive_email_signup" | "watchdive_phone_signup";
}): boolean {
  if (!args.fbq || !/^[A-Za-z0-9._:-]{8,64}$/.test(args.eventId)) return false;

  try {
    args.fbq(
      "track",
      args.eventName,
      { content_name: args.contentName, content_category: args.source },
      { eventID: args.eventId },
    );
    return true;
  } catch {
    return false;
  }
}

export function trackMetaLead(eventId: string, source: string): boolean {
  if (
    typeof window === "undefined" ||
    !hasMetaMeasurementConsent() ||
    !window.fbq ||
    window.__watchDiveMetaPixelId !== META_PIXEL_ID ||
    !/^[A-Za-z0-9._:-]{8,64}$/.test(eventId)
  ) {
    return false;
  }

  const dispatchKey = `Lead:${eventId}`;
  if (dispatchedStandardEvents.has(dispatchKey)) return false;
  const enqueued = enqueueMetaStandardEvent({
    fbq: window.fbq,
    eventName: "Lead",
    eventId,
    source,
    contentName: "watchdive_email_signup",
  });
  if (enqueued) dispatchedStandardEvents.add(dispatchKey);
  return enqueued;
}

// A separate standard Contact conversion lets Ads Manager report phone-number
// acquisition cost without ever sending the phone number itself to Meta.
export function trackMetaPhoneLead(eventId: string, source: string): boolean {
  if (
    typeof window === "undefined" ||
    !hasMetaMeasurementConsent() ||
    !window.fbq ||
    window.__watchDiveMetaPixelId !== META_PIXEL_ID ||
    !/^[A-Za-z0-9._:-]{8,64}$/.test(eventId)
  ) {
    return false;
  }

  const dispatchKey = `Contact:${eventId}`;
  if (dispatchedStandardEvents.has(dispatchKey)) return false;
  const enqueued = enqueueMetaStandardEvent({
    fbq: window.fbq,
    eventName: "Contact",
    eventId,
    source,
    contentName: "watchdive_phone_signup",
  });
  if (enqueued) dispatchedStandardEvents.add(dispatchKey);
  return enqueued;
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

export function metaEventIdForSubmissionAttempt(
  pendingEventId: string | undefined,
  measurementConsent: boolean,
): string | undefined {
  if (!measurementConsent) return undefined;
  return pendingEventId ?? newMetaEventId();
}
