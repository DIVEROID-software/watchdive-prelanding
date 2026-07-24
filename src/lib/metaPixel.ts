// Meta Pixel — browser side. Loads only when VITE_META_PIXEL_ID is set, so dev
// and preview builds without the env var stay pixel-free. The Lead event fires
// with an eventID shared with the server (Conversions API) so Meta dedupes the
// browser+server pair into a single conversion.
const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;

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
  }
}

export function initMetaPixel() {
  if (!PIXEL_ID || typeof window === "undefined" || window.fbq) return;
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
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  window.fbq("init", PIXEL_ID);
  window.fbq("track", "PageView");
}

// Fire only after the server confirms a NEW signup (never on button click, never
// for duplicates) — otherwise ad optimization learns from junk conversions.
export function trackMetaLead(eventId: string, source: string) {
  if (!PIXEL_ID || typeof window === "undefined" || !window.fbq) return;
  window.fbq(
    "track",
    "Lead",
    { content_name: "watchdive_email_signup", content_category: source },
    { eventID: eventId },
  );
}

// _fbp/_fbc cookies are set by the pixel (_fbc only after an fbclid landing).
// Passed to the server so the Conversions API event carries the same identifiers.
export function getMetaCookies(): { fbp?: string; fbc?: string } {
  if (typeof document === "undefined") return {};
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
