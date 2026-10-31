// Consent-gated referral and price-path measurement.
//
// Sends five fixed events to the already configured GA4 id and, on a public
// URL, to the existing Vercel Web Analytics track(). Never sends Meta, Google
// Ads, Lead, CompleteRegistration, or Purchase. The payload is surface,
// locale, and phase. Share arguments, counts, prices, and URL secrets are
// not read into that payload. Clipboard success is an explicit
// recordReferralCopy(surface, locale) call or a watchdive:referral-copy
// event. This module does not wrap the clipboard or the share API.

import { CONSENT_STORAGE_KEY } from "../consentRegion.ts";
import { readGoogleTagConfig } from "../googleTag.ts";
import { isLocale, localeFromPathname, stripLocalePrefix, type Locale } from "../i18n/locale.ts";
import { MEASUREMENT_CHOICE_EVENT } from "../measurementChoice.ts";
import { measurementPermitted } from "../metaPixel.ts";
import { allowsThirdPartyScripts } from "../thirdPartyScripts.ts";

export const REFERRAL_MEASUREMENT_ACTIONS = [
  "wd_referral_offer_view",
  "wd_referral_share_click",
  "wd_referral_copy",
  "wd_price_path_view",
  "wd_reservation_click",
] as const;

export type ReferralMeasurementAction = (typeof REFERRAL_MEASUREMENT_ACTIONS)[number];

export const REFERRAL_MEASUREMENT_SURFACES = [
  "price_paths",
  "price_public",
  "price_reservation",
  "price_buddy",
  "verify_card",
  "signup_success",
  "reservation_choice",
  "signup_reservation",
] as const;

export type ReferralMeasurementSurface = (typeof REFERRAL_MEASUREMENT_SURFACES)[number];

export const REFERRAL_MEASUREMENT_PHASES = ["pre_signup", "post_signup", "post_verify", "status"] as const;

export type ReferralMeasurementPhase = (typeof REFERRAL_MEASUREMENT_PHASES)[number];

export type ReferralMeasurementInput = {
  action: ReferralMeasurementAction;
  surface: ReferralMeasurementSurface;
  locale: Locale;
  phase: ReferralMeasurementPhase;
};

export type ReferralGaParams = {
  send_to: string;
  surface: ReferralMeasurementSurface;
  locale: Locale;
  phase: ReferralMeasurementPhase;
  page_location: string;
  page_referrer: string;
  page_title: "WatchDive";
};

export type ReferralMeasurementDelivery = {
  sent: boolean;
  reason: "sent" | "denied" | "withdrawn" | "invalid" | "duplicate" | "unconfigured";
  ga: boolean;
  vercel: boolean;
  eventName?: ReferralMeasurementAction;
  props?: Pick<ReferralMeasurementInput, "surface" | "locale" | "phase">;
};

const ACTION_SET = new Set<string>(REFERRAL_MEASUREMENT_ACTIONS);
const SURFACE_SET = new Set<string>(REFERRAL_MEASUREMENT_SURFACES);
const PHASE_SET = new Set<string>(REFERRAL_MEASUREMENT_PHASES);
const VIEW_ACTIONS = new Set<ReferralMeasurementAction>(["wd_referral_offer_view", "wd_price_path_view"]);
const PUBLIC_PATHS = new Set([
  "/",
  "/scuba",
  "/freediving",
  "/verify",
  "/reservation",
  "/buddy",
  "/buddy-rules",
  "/terms",
  "/privacy",
]);
const GA_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;
const CLICK_DEDUPE_MS = 40;
const VISIBLE_RATIO = 0.5;
const KNOWN_HOOKS = new Set([
  "price_paths",
  "price_path",
  "buddy_price_goal",
  "verify_choice",
  "referral_share",
]);

const SURFACES_FOR: Record<ReferralMeasurementAction, ReadonlySet<ReferralMeasurementSurface>> = {
  wd_price_path_view: new Set(["price_paths", "price_public", "price_reservation", "price_buddy"]),
  wd_referral_offer_view: new Set(["verify_card", "signup_success"]),
  wd_referral_share_click: new Set(["verify_card", "signup_success"]),
  wd_referral_copy: new Set(["verify_card", "signup_success"]),
  wd_reservation_click: new Set(["reservation_choice", "signup_reservation"]),
};

export type MeasurementLocation = {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
  referrer: string;
};

export type ExposureStore = {
  ready: boolean;
  page: string;
  epoch: number;
  allowed: boolean;
  exposures: Set<string>;
  inflight: Set<string>;
  retried: Set<string>;
  clicks: Map<string, number>;
};

export function createExposureStore(): ExposureStore {
  return {
    ready: false,
    page: "",
    epoch: 0,
    allowed: false,
    exposures: new Set(),
    inflight: new Set(),
    retried: new Set(),
    clicks: new Map(),
  };
}

/** Same function the pixel and GA tags already use. Denied and GPC stay off. */
export const readSharedMeasurementPermission = measurementPermitted;

export function referralMeasurementPermitted(
  read: () => boolean = readSharedMeasurementPermission,
): boolean {
  return read() === true;
}

export function gaMeasurementId(config: { gaId?: string } = readGoogleTagConfig()): string | undefined {
  const id = config.gaId;
  return id && GA_ID_PATTERN.test(id) ? id : undefined;
}

export function safeMeasurementPath(pathname: string): string {
  const raw = pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (!raw.startsWith("/")) return "/";
  let stripped = "/";
  try {
    stripped = stripLocalePrefix(raw);
  } catch {
    return "/";
  }
  const clean = stripped.replace(/\/+$/, "") || "/";
  if (PUBLIC_PATHS.has(clean)) return clean;
  if (clean === "/r" || clean.startsWith("/r/")) return "/r";
  return "/";
}

export function pageKey(pathname: string): string {
  let locale: Locale = "en";
  if (pathname.startsWith("/")) {
    try {
      locale = localeFromPathname(pathname);
    } catch {
      locale = "en";
    }
  }
  return `${locale}|${safeMeasurementPath(pathname)}`;
}

function safeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function safePageLocation(location: MeasurementLocation): string | null {
  const origin = safeOrigin(location.origin);
  if (!origin) return null;
  return `${origin}${safeMeasurementPath(location.pathname)}`;
}

export function safePageReferrer(referrer: string, pageOrigin: string): string {
  if (!referrer) return "";
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.username || url.password) return "";
  // Another site's path, query, or fragment can identify a person. Keep the origin only.
  if (url.origin !== pageOrigin) return url.origin;
  return `${url.origin}${safeMeasurementPath(url.pathname)}`;
}

/**
 * Vercel track() attaches the live URL and would load analytics script.
 * /verify, /reservation, and /buddy already forbid that script, including
 * when the fragment is empty. A fresh private page therefore has no Vercel
 * sink. gtag is used only when the page already created it.
 */
export function vercelPageIsPublic(location: MeasurementLocation): boolean {
  if (location.search && location.search !== "?") return false;
  if (location.hash && location.hash !== "#") return false;
  const raw = location.pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (!raw.startsWith("/")) return false;
  if (!allowsThirdPartyScripts(raw)) return false;
  let stripped = "/";
  try {
    stripped = stripLocalePrefix(raw);
  } catch {
    return false;
  }
  const clean = stripped.replace(/\/+$/, "") || "/";
  return PUBLIC_PATHS.has(clean);
}

function isMeasurementInput(value: ReferralMeasurementInput | null): value is ReferralMeasurementInput {
  return value !== null;
}

export function parseMeasurementInput(value: unknown): ReferralMeasurementInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const action = record.action;
  const surface = record.surface;
  const locale = record.locale;
  const phase = record.phase;
  if (typeof action !== "string" || !ACTION_SET.has(action)) return null;
  if (typeof surface !== "string" || !SURFACE_SET.has(surface)) return null;
  if (!isLocale(locale) || !PHASE_SET.has(String(phase))) return null;
  const typedAction = action as ReferralMeasurementAction;
  const typedSurface = surface as ReferralMeasurementSurface;
  if (!SURFACES_FOR[typedAction].has(typedSurface)) return null;
  return {
    action: typedAction,
    surface: typedSurface,
    locale,
    phase: phase as ReferralMeasurementPhase,
  };
}

function localeFromPublicPath(pathname: string): Locale {
  if (!pathname.startsWith("/")) return "en";
  try {
    return localeFromPathname(pathname);
  } catch {
    return "en";
  }
}

function phaseForLanding(pathname: string): ReferralMeasurementPhase {
  const path = safeMeasurementPath(pathname);
  if (path === "/buddy") return "status";
  if (path === "/verify") return "post_verify";
  return "pre_signup";
}

export type MeasurementElement = {
  nodeType: number;
  parentElement: MeasurementElement | null;
  getAttribute(name: string): string | null;
  querySelectorAll?(selector: string): ArrayLike<MeasurementElement>;
};

function closest(
  node: MeasurementElement | null,
  predicate: (element: MeasurementElement) => boolean,
): MeasurementElement | null {
  let current = node;
  while (current) {
    if (current.nodeType === 1 && predicate(current)) return current;
    current = current.parentElement;
  }
  return null;
}

function priceSurface(value: string | null): ReferralMeasurementSurface | null {
  if (value === "public") return "price_public";
  if (value === "reservation") return "price_reservation";
  if (value === "buddy") return "price_buddy";
  return null;
}

function placementSurface(value: string | null): "verify_card" | "signup_success" | null {
  if (value === "verify_card" || value === "signup_success") return value;
  return null;
}

/** View mapping for elements already marked by the UI. Returns null for non-events. */
export function resolveVisibleMeasurement(
  element: MeasurementElement,
  pathname: string,
): ReferralMeasurementInput | null {
  const hook = element.getAttribute("data-analytics-hook");
  const locale = localeFromPublicPath(pathname);
  if (hook === "price_paths") {
    return { action: "wd_price_path_view", surface: "price_paths", locale, phase: phaseForLanding(pathname) };
  }
  if (hook === "price_path") {
    const surface = priceSurface(element.getAttribute("data-price-path"));
    if (!surface) return null;
    return { action: "wd_price_path_view", surface, locale, phase: phaseForLanding(pathname) };
  }
  if (hook === "buddy_price_goal") {
    const surface = placementSurface(element.getAttribute("data-share-placement"));
    if (!surface) return null;
    // Both placements are mounted only after verification. The landing card
    // still sits on "/", so the phase follows the placement, not the path.
    return { action: "wd_referral_offer_view", surface, locale, phase: "post_verify" };
  }
  if (hook === "verify_choice") {
    const choice = element.getAttribute("data-verify-choice");
    if (choice === "buddy") {
      return { action: "wd_referral_offer_view", surface: "verify_card", locale, phase: "post_verify" };
    }
    if (choice === "reservation") {
      return { action: "wd_price_path_view", surface: "price_reservation", locale, phase: "post_verify" };
    }
    return null;
  }
  return null;
}

/** Click mapping. Copy success is not a click. Phone and detail toggles are not events. */
export function resolveClickMeasurement(
  target: MeasurementElement | null,
  pathname: string,
): ReferralMeasurementInput | null {
  if (!target) return null;
  const hookElement = closest(target, (element) => KNOWN_HOOKS.has(element.getAttribute("data-analytics-hook") ?? ""));
  if (hookElement?.getAttribute("data-analytics-hook") === "referral_share") {
    const surface = placementSurface(hookElement.getAttribute("data-share-placement"));
    if (!surface) return null;
    return {
      action: "wd_referral_share_click",
      surface,
      locale: localeFromPublicPath(pathname),
      phase: "post_verify",
    };
  }
  const button = closest(target, (element) => element.getAttribute("data-reservation-action") !== null);
  if (!button) return null;
  const action = button.getAttribute("data-reservation-action");
  if (action !== "verified" && action !== "pending") return null;
  const choice = closest(button, (element) => element.getAttribute("data-verify-choice") !== null);
  const onVerify = choice?.getAttribute("data-verify-choice") === "reservation";
  const path = stripLocalePrefix(pathname).replace(/\/+$/, "") || "/";
  if (choice && !onVerify) return null;
  if (!onVerify && path !== "/" && path !== "/scuba" && path !== "/freediving") return null;
  return {
    action: "wd_reservation_click",
    surface: onVerify ? "reservation_choice" : "signup_reservation",
    locale: localeFromPublicPath(pathname),
    phase: action === "verified" ? "post_verify" : "post_signup",
  };
}

/** Fired by the share handler only after clipboard.writeText fulfills. Detail is surface and locale. */
export const REFERRAL_COPY_EVENT = "watchdive:referral-copy";

/**
 * Records a successful clipboard copy. Call only after writeText fulfills.
 * A native share promise is not a copy and is not a delivered invite.
 */
export function recordReferralCopy(
  surface: unknown,
  locale: unknown,
  sinks?: ReferralMeasurementSinks,
): Promise<ReferralMeasurementDelivery> {
  return trackReferralMeasurement(
    { action: "wd_referral_copy", surface, locale, phase: "post_verify" },
    sinks,
  );
}

export function copyInputFromDetail(detail: unknown): ReferralMeasurementInput | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const record = detail as Record<string, unknown>;
  return parseMeasurementInput({
    action: "wd_referral_copy",
    surface: record.surface,
    locale: record.locale,
    phase: "post_verify",
  });
}

type GtagFn = (command: string, name: string, params: Readonly<Record<string, string>>) => void;
type VercelTrackFn = (name: string, props: Record<string, string>) => void;

export type ReferralMeasurementSinks = {
  permitted: () => boolean;
  gaId: () => string | undefined;
  gtag: () => GtagFn | undefined;
  loadVercelTrack?: () => Promise<VercelTrackFn>;
  location: () => MeasurementLocation;
  now: () => number;
  schedule: (callback: () => void) => void;
  store: ExposureStore;
};

function alignPage(store: ExposureStore, pathname: string) {
  const page = pageKey(pathname);
  if (store.page === page) return;
  store.page = page;
  store.exposures.clear();
  store.inflight.clear();
  store.retried.clear();
  store.clicks.clear();
}

function closedProps(input: ReferralMeasurementInput): Pick<ReferralMeasurementInput, "surface" | "locale" | "phase"> {
  return { surface: input.surface, locale: input.locale, phase: input.phase };
}

function buildGaParams(input: ReferralMeasurementInput, location: MeasurementLocation, gaId: string): ReferralGaParams | null {
  const pageLocation = safePageLocation(location);
  if (!pageLocation) return null;
  const origin = safeOrigin(location.origin);
  if (!origin) return null;
  return {
    send_to: gaId,
    surface: input.surface,
    locale: input.locale,
    phase: input.phase,
    page_location: pageLocation,
    page_referrer: safePageReferrer(location.referrer, origin),
    page_title: "WatchDive",
  };
}

async function sendMeasurement(
  input: ReferralMeasurementInput,
  sinks: ReferralMeasurementSinks,
  allowRetry: boolean,
): Promise<ReferralMeasurementDelivery> {
  const props = closedProps(input);
  if (!sinks.permitted()) {
    return { sent: false, reason: "denied", ga: false, vercel: false, eventName: input.action, props };
  }
  const location = sinks.location();
  const gaId = sinks.gaId();
  const gtag = sinks.gtag();
  let ga = false;
  if (gaId && gtag) {
    const params = buildGaParams(input, location, gaId);
    if (!sinks.permitted()) {
      return { sent: false, reason: "withdrawn", ga: false, vercel: false, eventName: input.action, props };
    }
    if (params) {
      try {
        gtag("event", input.action, params);
        ga = true;
      } catch {
        ga = false;
      }
    }
  }
  let vercel = false;
  if (vercelPageIsPublic(location) && sinks.loadVercelTrack) {
    const startedPage = pageKey(location.pathname);
    try {
      const track = await sinks.loadVercelTrack();
      const current = sinks.location();
      const pageMoved = pageKey(current.pathname) !== startedPage;
      if (!sinks.permitted() || pageMoved || !vercelPageIsPublic(current)) {
        return {
          sent: ga,
          reason: ga ? "sent" : "withdrawn",
          ga,
          vercel: false,
          eventName: input.action,
          props,
        };
      }
      track(input.action, props);
      vercel = true;
    } catch {
      vercel = false;
    }
  }
  if (!ga && !vercel && allowRetry && gaId && !gtag && !sinks.store.retried.has(exposureKey(sinks.store, input))) {
    const key = exposureKey(sinks.store, input);
    sinks.store.retried.add(key);
    sinks.schedule(() => {
      void trackReferralMeasurement(input, sinks);
    });
    return { sent: false, reason: "unconfigured", ga: false, vercel: false, eventName: input.action, props };
  }
  if (!ga && !vercel) {
    return { sent: false, reason: "unconfigured", ga: false, vercel: false, eventName: input.action, props };
  }
  return { sent: true, reason: "sent", ga, vercel, eventName: input.action, props };
}

function exposureKey(store: ExposureStore, input: ReferralMeasurementInput): string {
  return `${store.page}|${store.epoch}|${input.action}|${input.surface}|${input.locale}|${input.phase}`;
}

export async function trackReferralMeasurement(
  value: unknown,
  sinks: ReferralMeasurementSinks = browserSinks(),
): Promise<ReferralMeasurementDelivery> {
  const input = parseMeasurementInput(value);
  if (!isMeasurementInput(input)) {
    return { sent: false, reason: "invalid", ga: false, vercel: false };
  }
  alignPage(sinks.store, sinks.location().pathname);
  if (!sinks.permitted()) {
    return {
      sent: false,
      reason: "denied",
      ga: false,
      vercel: false,
      eventName: input.action,
      props: closedProps(input),
    };
  }
  if (VIEW_ACTIONS.has(input.action)) {
    const key = exposureKey(sinks.store, input);
    if (sinks.store.exposures.has(key) || sinks.store.inflight.has(key)) {
      return { sent: false, reason: "duplicate", ga: false, vercel: false, eventName: input.action, props: closedProps(input) };
    }
    sinks.store.inflight.add(key);
    try {
      const delivery = await sendMeasurement(input, sinks, true);
      if (delivery.sent) sinks.store.exposures.add(key);
      return delivery;
    } finally {
      sinks.store.inflight.delete(key);
    }
  }
  const clickKey = `${sinks.store.page}|${input.action}|${input.surface}|${input.locale}|${input.phase}`;
  const now = sinks.now();
  const previous = sinks.store.clicks.get(clickKey);
  if (previous !== undefined && now - previous < CLICK_DEDUPE_MS) {
    return { sent: false, reason: "duplicate", ga: false, vercel: false, eventName: input.action, props: closedProps(input) };
  }
  sinks.store.clicks.set(clickKey, now);
  return sendMeasurement(input, sinks, false);
}

const browserStore = createExposureStore();
let browserSinksSingleton: ReferralMeasurementSinks | null = null;

function browserLocation(): MeasurementLocation {
  if (typeof window === "undefined") {
    return { origin: "https://watchdive.diveroid.com", pathname: "/", search: "", hash: "", referrer: "" };
  }
  return {
    origin: window.location.origin,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    referrer: typeof document === "undefined" ? "" : document.referrer,
  };
}

function browserSinks(): ReferralMeasurementSinks {
  if (browserSinksSingleton) return browserSinksSingleton;
  browserSinksSingleton = {
    permitted: () => referralMeasurementPermitted(),
    gaId: () => gaMeasurementId(),
    gtag: () => {
      if (typeof window === "undefined") return undefined;
      const gtag = (window as Window & { gtag?: GtagFn }).gtag;
      return typeof gtag === "function" ? gtag : undefined;
    },
    loadVercelTrack: async () => {
      const mod = await import("@vercel/analytics");
      return (name: string, props: Record<string, string>) => {
        mod.track(name, props);
      };
    },
    location: browserLocation,
    now: () => Date.now(),
    schedule: (callback) => {
      if (typeof queueMicrotask === "function") queueMicrotask(callback);
      else setTimeout(callback, 0);
    },
    store: browserStore,
  };
  return browserSinksSingleton;
}

export type MeasurementDomEvent = {
  type: string;
  target: MeasurementElement | null;
  key?: string | null;
  detail?: unknown;
};

export type IntersectionObserverLike = new (
  callback: (entries: ReadonlyArray<{ target: MeasurementElement; intersectionRatio: number }>) => void,
) => {
  observe: (element: MeasurementElement) => void;
  unobserve: (element: MeasurementElement) => void;
  disconnect: () => void;
};

export type MutationObserverLike = new (
  callback: (
    records: ReadonlyArray<{
      addedNodes: ArrayLike<MeasurementElement>;
      removedNodes: ArrayLike<MeasurementElement>;
    }>,
  ) => void,
) => {
  observe: (element: MeasurementElement, options: { childList: boolean; subtree: boolean }) => void;
  disconnect: () => void;
};

export type MeasurementHost = {
  root: MeasurementElement;
  location: () => MeasurementLocation;
  addEventListener: (type: string, listener: (event: MeasurementDomEvent) => void, capture?: boolean) => void;
  removeEventListener: (type: string, listener: (event: MeasurementDomEvent) => void, capture?: boolean) => void;
  IntersectionObserver: IntersectionObserverLike;
  MutationObserver: MutationObserverLike;
};

type Installation = { users: number; stop: () => void };
const installations = new WeakMap<object, Installation>();

function rememberPermission(store: ExposureStore, sinks: ReferralMeasurementSinks) {
  if (store.ready) return;
  store.allowed = sinks.permitted();
  store.epoch = store.allowed ? 1 : 0;
  store.ready = true;
}

export function bindReferralMeasurement(options?: {
  host?: MeasurementHost;
  sinks?: ReferralMeasurementSinks;
}): () => void {
  const sinks = options?.sinks ?? browserSinks();
  const host = options?.host ?? browserHost();
  if (!host) return () => undefined;
  rememberPermission(sinks.store, sinks);
  const existing = installations.get(host);
  if (existing) {
    existing.users += 1;
    return () => releaseInstallation(host);
  }
  const stop = startMeasurement(host, sinks);
  installations.set(host, { users: 1, stop });
  return () => releaseInstallation(host);
}

function releaseInstallation(host: object) {
  const existing = installations.get(host);
  if (!existing) return;
  existing.users -= 1;
  if (existing.users > 0) return;
  existing.stop();
  installations.delete(host);
}

function startMeasurement(host: MeasurementHost, sinks: ReferralMeasurementSinks): () => void {
  const visible = new Map<MeasurementElement, { ratio: number; input: ReferralMeasurementInput }>();
  const observed = new Set<MeasurementElement>();
  const intersection = new host.IntersectionObserver((entries) => {
    const pathname = sinks.location().pathname;
    for (const entry of entries) {
      const input = resolveVisibleMeasurement(entry.target, pathname);
      if (!input) continue;
      visible.set(entry.target, { ratio: entry.intersectionRatio, input });
      if (entry.intersectionRatio >= VISIBLE_RATIO) void trackReferralMeasurement(input, sinks);
    }
  });
  const observeElement = (element: MeasurementElement) => {
    if (observed.has(element)) return;
    if (!resolveVisibleMeasurement(element, sinks.location().pathname)) return;
    observed.add(element);
    intersection.observe(element);
  };
  const forgetElement = (element: MeasurementElement) => {
    if (!observed.has(element)) return;
    observed.delete(element);
    visible.delete(element);
    intersection.unobserve(element);
  };
  const scan = (element: MeasurementElement) => {
    if (element.nodeType === 1 && element.getAttribute("data-analytics-hook")) observeElement(element);
    const listed = element.querySelectorAll?.("[data-analytics-hook]");
    if (!listed) return;
    for (const child of Array.from(listed)) observeElement(child);
  };
  scan(host.root);
  const mutation = new host.MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node?.nodeType === 1) scan(node);
      }
      for (const node of Array.from(record.removedNodes)) {
        if (node?.nodeType !== 1) continue;
        forgetElement(node);
        const listed = node.querySelectorAll?.("[data-analytics-hook]");
        if (!listed) continue;
        for (const child of Array.from(listed)) forgetElement(child);
      }
    }
  });
  mutation.observe(host.root, { childList: true, subtree: true });

  const flushVisible = () => {
    if (!sinks.permitted()) return;
    const pathname = sinks.location().pathname;
    for (const [element, entry] of visible.entries()) {
      if (entry.ratio < VISIBLE_RATIO) continue;
      const input = resolveVisibleMeasurement(element, pathname) ?? entry.input;
      void trackReferralMeasurement(input, sinks);
    }
  };
  const onChoice = () => {
    sinks.schedule(() => {
      const allowed = sinks.permitted();
      if (allowed === sinks.store.allowed) return;
      sinks.store.allowed = allowed;
      if (!allowed) return;
      sinks.store.epoch += 1;
      flushVisible();
    });
  };
  const onStorage = (event: MeasurementDomEvent) => {
    if (event.key && event.key !== CONSENT_STORAGE_KEY) return;
    onChoice();
  };
  const onClick = (event: MeasurementDomEvent) => {
    const input = resolveClickMeasurement(event.target, sinks.location().pathname);
    if (!input || !sinks.permitted()) return;
    void trackReferralMeasurement(input, sinks);
  };
  const onCopy = (event: MeasurementDomEvent) => {
    const input = copyInputFromDetail(event.detail);
    if (!input) return;
    void trackReferralMeasurement(input, sinks);
  };
  host.addEventListener("click", onClick, true);
  host.addEventListener(MEASUREMENT_CHOICE_EVENT, onChoice, false);
  host.addEventListener("storage", onStorage, false);
  host.addEventListener(REFERRAL_COPY_EVENT, onCopy, false);
  return () => {
    host.removeEventListener("click", onClick, true);
    host.removeEventListener(MEASUREMENT_CHOICE_EVENT, onChoice, false);
    host.removeEventListener("storage", onStorage, false);
    host.removeEventListener(REFERRAL_COPY_EVENT, onCopy, false);
    intersection.disconnect();
    mutation.disconnect();
    visible.clear();
    observed.clear();
  };
}

function elementFromEventTarget(target: EventTarget | null): MeasurementElement | null {
  if (typeof Element !== "undefined" && target instanceof Element) return target as MeasurementElement;
  if (typeof Node !== "undefined" && target instanceof Node) {
    return (target.parentElement as MeasurementElement | null) ?? null;
  }
  return null;
}

type BrowserListener = {
  type: string;
  capture: boolean;
  listener: (event: MeasurementDomEvent) => void;
  wrapped: EventListener;
  target: EventTarget;
};

function createBrowserHost(): MeasurementHost | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const root = document.documentElement as unknown as MeasurementElement;
  const records: BrowserListener[] = [];
  const addEventListener: MeasurementHost["addEventListener"] = (type, listener, capture) => {
    const useCapture = capture === true;
    const wrapped: EventListener = (event) => {
      if (type === "click") {
        listener({ type, target: elementFromEventTarget((event as Event).target) });
        return;
      }
      if (type === "storage") {
        listener({ type, target: null, key: (event as StorageEvent).key });
        return;
      }
      listener({ type, target: null, detail: (event as CustomEvent).detail });
    };
    const target = type === "click" ? document : window;
    records.push({ type, capture: useCapture, listener, wrapped, target });
    target.addEventListener(type, wrapped, useCapture);
  };
  const removeEventListener: MeasurementHost["removeEventListener"] = (type, listener, capture) => {
    const useCapture = capture === true;
    const index = records.findIndex(
      (record) => record.type === type && record.listener === listener && record.capture === useCapture,
    );
    if (index < 0) return;
    const [record] = records.splice(index, 1);
    record.target.removeEventListener(record.type, record.wrapped, record.capture);
  };
  return {
    root,
    location: browserLocation,
    addEventListener,
    removeEventListener,
    IntersectionObserver: class {
      private readonly observer: IntersectionObserver;
      constructor(
        callback: (entries: ReadonlyArray<{ target: MeasurementElement; intersectionRatio: number }>) => void,
      ) {
        this.observer = new IntersectionObserver(
          (entries) => {
            callback(
              entries.map((entry) => ({
                target: entry.target as MeasurementElement,
                intersectionRatio: entry.intersectionRatio,
              })),
            );
          },
          { threshold: [0, VISIBLE_RATIO, 1] },
        );
      }
      observe(element: MeasurementElement) {
        this.observer.observe(element as unknown as Element);
      }
      unobserve(element: MeasurementElement) {
        this.observer.unobserve(element as unknown as Element);
      }
      disconnect() {
        this.observer.disconnect();
      }
    } as unknown as IntersectionObserverLike,
    MutationObserver: class {
      private readonly observer: MutationObserver;
      constructor(
        callback: (
          records: ReadonlyArray<{
            addedNodes: ArrayLike<MeasurementElement>;
            removedNodes: ArrayLike<MeasurementElement>;
          }>,
        ) => void,
      ) {
        this.observer = new MutationObserver((records) => {
          callback(
            records.map((record) => ({
              addedNodes: Array.from(record.addedNodes) as unknown as MeasurementElement[],
              removedNodes: Array.from(record.removedNodes) as unknown as MeasurementElement[],
            })),
          );
        });
      }
      observe(element: MeasurementElement) {
        this.observer.observe(element as unknown as Node, { childList: true, subtree: true });
      }
      disconnect() {
        this.observer.disconnect();
      }
    } as unknown as MutationObserverLike,
  };
}

let cachedBrowserHost: MeasurementHost | null = null;

function browserHost(): MeasurementHost | null {
  if (cachedBrowserHost) return cachedBrowserHost;
  cachedBrowserHost = createBrowserHost();
  return cachedBrowserHost;
}
