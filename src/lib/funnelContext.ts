import {
  isOptionalMeasurementConsentRecord,
  type GrantedOptionalMeasurementConsentRecord,
} from "./measurementConsentContract.ts";
import { getGrantedOptionalMeasurementConsent } from "./measurementConsent.ts";

const STORAGE_KEY = "watchdive.launchos-funnel.v1";
const SNAPSHOT_VERSION = 1 as const;
const RANDOM_BYTES = 24;

const EVENT_NAMES = new Set(["landing_viewed", "cta_viewed", "form_started", "submit_attempted"]);
const EVENT_PLACEMENTS = new Set(["page", "hero", "offer"]);
const FUNNEL_INSTANCE_ID = /^fi_v1_[A-Za-z0-9_-]{32}$/;
const EVENT_ID = /^loe_v1_[A-Za-z0-9_-]{32}$/;
const META_ID = /^[0-9]{4,32}$/;
export const LAUNCHOS_BROWSER_MEASUREMENT_ENABLED =
  String(import.meta.env?.VITE_LAUNCHOS_MEASUREMENT_CONSENT_UI_ENABLED ?? "").toLowerCase() ===
  "true";

export type WatchDiveAttribution = {
  campaignId?: string;
  adsetId?: string;
  targetId?: string;
  adId?: string;
  contentId?: string;
};

export type WatchDiveMeasurementContext = {
  funnelInstanceId: string;
  attribution: WatchDiveAttribution;
  measurementConsent: GrantedOptionalMeasurementConsentRecord;
};

export type WatchDiveBrowserEventName =
  "landing_viewed" | "cta_viewed" | "form_started" | "submit_attempted";
export type WatchDiveEventPlacement = "page" | "hero" | "offer";

export type WatchDiveBrowserEvent = {
  eventName: WatchDiveBrowserEventName;
  eventId: string;
  occurredAt: string;
  placement: WatchDiveEventPlacement;
};

export type WatchDiveBrowserEventDeliveryState = "pending" | "accepted";

type StoredWatchDiveBrowserEvent = WatchDiveBrowserEvent & {
  delivery: WatchDiveBrowserEventDeliveryState;
};

type StoredSnapshot = WatchDiveMeasurementContext & {
  version: typeof SNAPSHOT_VERSION;
  events: Record<string, StoredWatchDiveBrowserEvent>;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type RemovableStorageLike = StorageLike & Pick<Storage, "removeItem">;
type ResolveOptions = {
  search?: string;
  storage?: StorageLike | null;
  fillRandom?: (bytes: Uint8Array) => void;
  consent?: GrantedOptionalMeasurementConsentRecord;
};
type RecordOptions = ResolveOptions & { now?: () => Date };

let memorySnapshot: StoredSnapshot | null = null;

function secureFill(bytes: Uint8Array) {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure randomness is unavailable.");
  globalThis.crypto.getRandomValues(bytes);
}

function randomBase64Url(fillRandom = secureFill) {
  const bytes = new Uint8Array(RANDOM_BYTES);
  fillRandom(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function parseWatchDiveAttribution(search: string): WatchDiveAttribution {
  const params = new URLSearchParams(search);
  const values = ["campaign_id", "adset_id", "ad_id"].map((key) => params.getAll(key));
  if (values.some((candidates) => candidates.length !== 1 || !META_ID.test(candidates[0] ?? ""))) {
    return {};
  }
  const [campaignId, adsetId, adId] = values.map(([value]) => value);
  return { campaignId, adsetId, targetId: adsetId, adId, contentId: adId };
}

function validAttribution(value: unknown): value is WatchDiveAttribution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowed = new Set(["campaignId", "adsetId", "targetId", "adId", "contentId"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return false;
  if (Object.values(record).some((raw) => typeof raw !== "string" || !META_ID.test(raw))) {
    return false;
  }
  return record.targetId === record.adsetId && record.contentId === record.adId;
}

function eventSlot(eventName: WatchDiveBrowserEventName, placement: WatchDiveEventPlacement) {
  return `${eventName}:${placement}`;
}

function validEvent(value: unknown): value is WatchDiveBrowserEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (
    typeof event.eventName !== "string" ||
    !EVENT_NAMES.has(event.eventName) ||
    typeof event.placement !== "string" ||
    !EVENT_PLACEMENTS.has(event.placement) ||
    typeof event.eventId !== "string" ||
    !EVENT_ID.test(event.eventId) ||
    typeof event.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(event.occurredAt))
  ) {
    return false;
  }
  return event.eventName === "landing_viewed"
    ? event.placement === "page"
    : event.placement === "hero" || event.placement === "offer";
}

function normalizeStoredEvent(value: unknown): StoredWatchDiveBrowserEvent | null {
  if (!validEvent(value)) return null;
  const delivery = (value as { delivery?: unknown }).delivery;
  if (delivery !== undefined && delivery !== "pending" && delivery !== "accepted") return null;
  return {
    eventName: value.eventName,
    eventId: value.eventId,
    occurredAt: value.occurredAt,
    placement: value.placement,
    // Snapshots created by the first v1 implementation predate browser ACK
    // tracking. They are safely migrated to pending without changing identity.
    delivery: delivery ?? "pending",
  };
}

function parseSnapshot(raw: string | null): StoredSnapshot | null {
  if (!raw) return null;
  try {
    const candidate = JSON.parse(raw) as Record<string, unknown>;
    if (
      candidate.version !== SNAPSHOT_VERSION ||
      typeof candidate.funnelInstanceId !== "string" ||
      !FUNNEL_INSTANCE_ID.test(candidate.funnelInstanceId) ||
      !validAttribution(candidate.attribution) ||
      !isOptionalMeasurementConsentRecord(candidate.measurementConsent) ||
      candidate.measurementConsent.state !== "granted" ||
      !candidate.events ||
      typeof candidate.events !== "object" ||
      Array.isArray(candidate.events)
    ) {
      return null;
    }
    const events: Record<string, StoredWatchDiveBrowserEvent> = {};
    for (const [slot, rawEvent] of Object.entries(candidate.events as Record<string, unknown>)) {
      const event = normalizeStoredEvent(rawEvent);
      if (!event || slot !== eventSlot(event.eventName, event.placement)) return null;
      events[slot] = event;
    }
    return {
      version: SNAPSHOT_VERSION,
      funnelInstanceId: candidate.funnelInstanceId,
      attribution: candidate.attribution,
      measurementConsent: candidate.measurementConsent,
      events,
    } as StoredSnapshot;
  } catch {
    return null;
  }
}

function readSnapshot(storage?: StorageLike | null) {
  if (storage) {
    try {
      return parseSnapshot(storage.getItem(STORAGE_KEY));
    } catch {
      // Restricted storage falls back to memory for this page.
    }
  }
  return memorySnapshot;
}

function writeSnapshot(snapshot: StoredSnapshot, storage?: StorageLike | null) {
  memorySnapshot = snapshot;
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Page-memory state still preserves this session's first touch.
  }
}

function freezeContext(snapshot: StoredSnapshot): WatchDiveMeasurementContext {
  return Object.freeze({
    funnelInstanceId: snapshot.funnelInstanceId,
    attribution: Object.freeze({ ...snapshot.attribution }),
    measurementConsent: Object.freeze({ ...snapshot.measurementConsent }),
  });
}

function freezeEvent(event: StoredWatchDiveBrowserEvent): WatchDiveBrowserEvent {
  return Object.freeze({
    eventName: event.eventName,
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    placement: event.placement,
  });
}

function resolveSnapshot(options: ResolveOptions = {}) {
  if (!isOptionalMeasurementConsentRecord(options.consent) || options.consent.state !== "granted") {
    throw new Error("Optional advertising measurement consent is required.");
  }
  const current = readSnapshot(options.storage);
  if (current) return current;
  const created: StoredSnapshot = {
    version: SNAPSHOT_VERSION,
    funnelInstanceId: `fi_v1_${randomBase64Url(options.fillRandom)}`,
    attribution: parseWatchDiveAttribution(options.search ?? ""),
    measurementConsent: options.consent,
    events: {},
  };
  writeSnapshot(created, options.storage);
  return created;
}

export function getOrCreateWatchDiveMeasurementContext(options: ResolveOptions = {}) {
  return freezeContext(resolveSnapshot(options));
}

export function recordWatchDiveBrowserEvent(
  eventName: WatchDiveBrowserEventName,
  placement: WatchDiveEventPlacement,
  options: RecordOptions = {},
) {
  if (eventName === "landing_viewed" ? placement !== "page" : placement === "page") {
    throw new Error("The LaunchOS browser event placement is invalid.");
  }
  const snapshot = resolveSnapshot(options);
  const slot = eventSlot(eventName, placement);
  const existing = snapshot.events[slot];
  if (existing) {
    return { measurementContext: freezeContext(snapshot), event: freezeEvent(existing) };
  }
  const event: StoredWatchDiveBrowserEvent = {
    eventName,
    eventId: `loe_v1_${randomBase64Url(options.fillRandom)}`,
    occurredAt: (options.now?.() ?? new Date()).toISOString(),
    placement,
    delivery: "pending",
  };
  const updated = { ...snapshot, events: { ...snapshot.events, [slot]: event } };
  writeSnapshot(updated, options.storage);
  return { measurementContext: freezeContext(updated), event: freezeEvent(event) };
}

export function getPendingWatchDiveBrowserEvents(options: ResolveOptions = {}) {
  const snapshot = resolveSnapshot(options);
  return Object.freeze(
    Object.values(snapshot.events)
      .filter((event) => event.delivery === "pending")
      .map((event) =>
        Object.freeze({ measurementContext: freezeContext(snapshot), event: freezeEvent(event) }),
      ),
  );
}

export function getWatchDiveBrowserEventDeliveryState(
  eventId: string,
  options: Pick<ResolveOptions, "storage"> = {},
) {
  const snapshot = readSnapshot(options.storage);
  return Object.values(snapshot?.events ?? {}).find((event) => event.eventId === eventId)?.delivery;
}

export function isWatchDiveBrowserEventCurrentPending(
  eventId: string,
  funnelInstanceId: string,
  options: Pick<ResolveOptions, "storage" | "consent"> = {},
) {
  if (!EVENT_ID.test(eventId) || !FUNNEL_INSTANCE_ID.test(funnelInstanceId)) return false;
  if (!isOptionalMeasurementConsentRecord(options.consent) || options.consent.state !== "granted") {
    return false;
  }
  const snapshot = readSnapshot(options.storage);
  if (!snapshot || snapshot.funnelInstanceId !== funnelInstanceId) return false;
  return Object.values(snapshot.events).some(
    (event) => event.eventId === eventId && event.delivery === "pending",
  );
}

export function markWatchDiveBrowserEventAccepted(eventId: string, options: ResolveOptions = {}) {
  if (!isOptionalMeasurementConsentRecord(options.consent) || options.consent.state !== "granted") {
    throw new Error("Optional advertising measurement consent is required.");
  }
  // An ACK may arrive after a consent clear. Never create a new funnel merely
  // to acknowledge an event that no longer exists in the browser queue.
  const snapshot = readSnapshot(options.storage);
  if (!snapshot) return false;
  const entry = Object.entries(snapshot.events).find(([, event]) => event.eventId === eventId);
  if (!entry) return false;
  const [slot, event] = entry;
  if (event.delivery === "accepted") return true;
  const updated: StoredSnapshot = {
    ...snapshot,
    events: { ...snapshot.events, [slot]: { ...event, delivery: "accepted" } },
  };
  writeSnapshot(updated, options.storage);
  return true;
}

export function clearWatchDiveMeasurementContext(storage?: RemovableStorageLike | null) {
  memorySnapshot = null;
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Consent denial still applies even if cleanup is restricted.
  }
}

export function getBrowserWatchDiveMeasurementContext() {
  if (typeof window === "undefined") throw new Error("Browser measurement is client-only.");
  if (!launchOsMeasurementLocaleAllowed(window.location.pathname)) {
    throw new Error("LaunchOS measurement is not enabled for this locale.");
  }
  if (!LAUNCHOS_BROWSER_MEASUREMENT_ENABLED) {
    throw new Error("LaunchOS browser measurement is disabled.");
  }
  const consent = getGrantedOptionalMeasurementConsent();
  if (!consent) throw new Error("Optional advertising measurement consent is required.");
  return getOrCreateWatchDiveMeasurementContext({
    search: window.location.search,
    storage: window.sessionStorage,
    consent,
  });
}

export function launchOsBrowserMeasurementGateAllowed(input: {
  pathname: string;
  enabled: boolean;
  consent?: GrantedOptionalMeasurementConsentRecord;
}) {
  return (
    input.enabled &&
    launchOsMeasurementLocaleAllowed(input.pathname) &&
    isOptionalMeasurementConsentRecord(input.consent) &&
    input.consent.state === "granted"
  );
}

export function browserWatchDiveMeasurementGateOpen() {
  if (typeof window === "undefined") return false;
  return launchOsBrowserMeasurementGateAllowed({
    pathname: window.location.pathname,
    enabled: LAUNCHOS_BROWSER_MEASUREMENT_ENABLED,
    consent: getGrantedOptionalMeasurementConsent(),
  });
}

export function recordBrowserWatchDiveEvent(
  eventName: WatchDiveBrowserEventName,
  placement: WatchDiveEventPlacement,
) {
  if (typeof window === "undefined") throw new Error("Browser measurement is client-only.");
  if (!launchOsMeasurementLocaleAllowed(window.location.pathname)) {
    throw new Error("LaunchOS measurement is not enabled for this locale.");
  }
  if (!LAUNCHOS_BROWSER_MEASUREMENT_ENABLED) {
    throw new Error("LaunchOS browser measurement is disabled.");
  }
  const consent = getGrantedOptionalMeasurementConsent();
  if (!consent) throw new Error("Optional advertising measurement consent is required.");
  return recordWatchDiveBrowserEvent(eventName, placement, {
    search: window.location.search,
    storage: window.sessionStorage,
    consent,
  });
}

export function getPendingBrowserWatchDiveEvents() {
  if (typeof window === "undefined") throw new Error("Browser measurement is client-only.");
  if (!launchOsMeasurementLocaleAllowed(window.location.pathname)) {
    throw new Error("LaunchOS measurement is not enabled for this locale.");
  }
  if (!LAUNCHOS_BROWSER_MEASUREMENT_ENABLED) {
    throw new Error("LaunchOS browser measurement is disabled.");
  }
  const consent = getGrantedOptionalMeasurementConsent();
  if (!consent) throw new Error("Optional advertising measurement consent is required.");
  return getPendingWatchDiveBrowserEvents({
    search: window.location.search,
    storage: window.sessionStorage,
    consent,
  });
}

export function markBrowserWatchDiveEventAccepted(eventId: string) {
  if (typeof window === "undefined") throw new Error("Browser measurement is client-only.");
  if (!launchOsMeasurementLocaleAllowed(window.location.pathname)) {
    throw new Error("LaunchOS measurement is not enabled for this locale.");
  }
  if (!LAUNCHOS_BROWSER_MEASUREMENT_ENABLED) {
    throw new Error("LaunchOS browser measurement is disabled.");
  }
  const consent = getGrantedOptionalMeasurementConsent();
  if (!consent) throw new Error("Optional advertising measurement consent is required.");
  return markWatchDiveBrowserEventAccepted(eventId, {
    search: window.location.search,
    storage: window.sessionStorage,
    consent,
  });
}

export function isBrowserWatchDiveEventCurrentPending(eventId: string, funnelInstanceId: string) {
  if (typeof window === "undefined" || !browserWatchDiveMeasurementGateOpen()) return false;
  const consent = getGrantedOptionalMeasurementConsent();
  if (!consent) return false;
  return isWatchDiveBrowserEventCurrentPending(eventId, funnelInstanceId, {
    storage: window.sessionStorage,
    consent,
  });
}

export function clearBrowserWatchDiveMeasurementContext() {
  if (typeof window === "undefined") {
    clearWatchDiveMeasurementContext();
    return;
  }
  try {
    clearWatchDiveMeasurementContext(window.sessionStorage);
  } catch {
    clearWatchDiveMeasurementContext();
  }
}

export function launchOsMeasurementLocaleAllowed(pathname: string) {
  if (pathname === "/" || pathname.startsWith("/ko/")) return true;
  return pathname === "/ko";
}
