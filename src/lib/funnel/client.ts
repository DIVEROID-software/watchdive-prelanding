import { recordFunnelEvents } from "@/lib/api/funnel.functions";
import { hasMetaMeasurementConsent } from "@/lib/metaPixel";
import {
  FUNNEL_SCHEMA_VERSION,
  MAX_CLIENT_FUNNEL_EVENTS_PER_REQUEST,
  attributionForMeasurementConsent,
  hasFunnelAttribution,
  isHalfVisibleIntersection,
  parseFunnelAttribution,
  type ClientFunnelEventInput,
  type ClientFunnelEventName,
  type ClientFunnelProperties,
  type ClientFunnelSource,
  type FunnelAttribution,
} from "./types";

const FLUSH_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_QUEUED_EVENTS = 100;

let queuedEvents: ClientFunnelEventInput[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let landingViewSent = false;
let lifecycleListenersInstalled = false;
let consecutiveFlushFailures = 0;
let pageSessionId: string | undefined;
let pageVisitorId: string | undefined;
let pageAttribution: FunnelAttribution | undefined;
const ctaViewsSent = new Set<Extract<ClientFunnelSource, "launch_banner" | "sticky_banner">>();

type VideoMeasurementState = {
  milestones: Set<string>;
  lastObservedTime?: number;
  viewableWatchSeconds: number;
};

const videoMeasurement = new WeakMap<HTMLVideoElement, VideoMeasurementState>();

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function getFunnelAttribution(): FunnelAttribution {
  if (typeof window === "undefined") return {};
  if (pageAttribution) return pageAttribution;
  const fromUrl = parseFunnelAttribution(window.location.search);
  // Attribution and pseudonymous identifiers deliberately remain memory-only.
  // The campaign is a single-page experience, so durable browser storage is
  // unnecessary and would create a stale cross-visit identity.
  pageAttribution = hasFunnelAttribution(fromUrl) ? fromUrl : {};
  return pageAttribution;
}

export type FunnelClientContext = {
  sessionId: string;
  visitorId?: string;
  attribution: FunnelAttribution;
  pagePath: string;
};

export function getFunnelClientContext(): FunnelClientContext | undefined {
  if (typeof window === "undefined") return undefined;
  const measurementConsent = hasMetaMeasurementConsent();
  pageSessionId ??= newUuid();
  if (measurementConsent) pageVisitorId ??= newUuid();
  return {
    sessionId: pageSessionId,
    visitorId: measurementConsent ? pageVisitorId : undefined,
    attribution: attributionForMeasurementConsent(getFunnelAttribution(), measurementConsent),
    pagePath: window.location.pathname.slice(0, 500),
  };
}

function externalReferrerHost(): string | undefined {
  if (typeof document === "undefined" || !document.referrer) return undefined;
  try {
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin ? undefined : referrer.hostname.slice(0, 300);
  } catch {
    return undefined;
  }
}

async function flushFunnelEvents(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!queuedEvents.length) return;

  // Keep the client batch exactly within the public server schema limit.
  // A failed batch is prepended to newer events, so the queue can legitimately
  // grow beyond ten while retrying even though normal flushes start at ten.
  const batch = queuedEvents.slice(0, MAX_CLIENT_FUNNEL_EVENTS_PER_REQUEST);
  queuedEvents = queuedEvents.slice(batch.length);
  try {
    const result = await recordFunnelEvents({ data: { events: batch } });
    if (!result.ok) throw new Error("Funnel storage did not accept the batch");
    consecutiveFlushFailures = 0;
  } catch (error) {
    console.warn("[funnel] event batch failed", error);
    consecutiveFlushFailures += 1;
    queuedEvents = [...batch, ...queuedEvents].slice(0, MAX_QUEUED_EVENTS);
  }
  if (queuedEvents.length) {
    const retryDelay = consecutiveFlushFailures
      ? Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** (consecutiveFlushFailures - 1))
      : FLUSH_DELAY_MS;
    flushTimer = setTimeout(() => void flushFunnelEvents(), retryDelay);
  }
}

export function trackFunnelEvent(
  eventName: ClientFunnelEventName,
  options: {
    source?: ClientFunnelSource;
    properties?: ClientFunnelProperties;
  } = {},
): string | undefined {
  const context = getFunnelClientContext();
  if (!context) return undefined;

  const eventId = newUuid();
  queuedEvents.push({
    eventId,
    sessionId: context.sessionId,
    visitorId: context.visitorId,
    eventName,
    occurredAt: new Date().toISOString(),
    acquisitionPath: "website",
    source: options.source,
    pagePath: context.pagePath === "/" ? "/" : undefined,
    referrerHost: externalReferrerHost(),
    attribution: context.attribution,
    properties: options.properties,
    schemaVersion: FUNNEL_SCHEMA_VERSION,
  });

  if (queuedEvents.length >= MAX_CLIENT_FUNNEL_EVENTS_PER_REQUEST) void flushFunnelEvents();
  else if (!flushTimer) flushTimer = setTimeout(() => void flushFunnelEvents(), FLUSH_DELAY_MS);
  return eventId;
}

export function initLandingFunnel(): void {
  if (landingViewSent || typeof window === "undefined") return;
  landingViewSent = true;
  if (!lifecycleListenersInstalled) {
    lifecycleListenersInstalled = true;
    const flushIfLeaving = () => {
      if (document.visibilityState === "hidden") void flushFunnelEvents();
    };
    document.addEventListener("visibilitychange", flushIfLeaving);
    window.addEventListener("pagehide", () => void flushFunnelEvents());
  }
  trackFunnelEvent("landing_view", {
    source: "landing",
    properties: {
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
    },
  });
  // Start the landing write immediately. Waiting for the normal batching
  // window loses the most important denominator on very fast bounces.
  void flushFunnelEvents();
}

export function observeFunnelCtaView(
  source: Extract<ClientFunnelSource, "launch_banner" | "sticky_banner">,
  element: Element,
): () => void {
  if (ctaViewsSent.has(source) || typeof IntersectionObserver === "undefined") {
    return () => {};
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (ctaViewsSent.has(source)) {
        observer.disconnect();
        return;
      }
      if (!entries.some(isHalfVisibleIntersection)) return;

      ctaViewsSent.add(source);
      trackFunnelEvent("cta_view", {
        source,
        properties: { viewable: true },
      });
      observer.disconnect();
    },
    { threshold: 0.5 },
  );
  observer.observe(element);
  return () => observer.disconnect();
}

function videoState(video: HTMLVideoElement): VideoMeasurementState {
  const existing = videoMeasurement.get(video);
  if (existing) return existing;
  const created: VideoMeasurementState = {
    milestones: new Set<string>(),
    viewableWatchSeconds: 0,
  };
  videoMeasurement.set(video, created);
  return created;
}

function isVideoViewable(video: HTMLVideoElement): boolean {
  if (typeof window === "undefined" || document.visibilityState === "hidden") return false;
  const rect = video.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const visibleWidth = Math.max(
    0,
    Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
  );
  const visibleHeight = Math.max(
    0,
    Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
  );
  return (visibleWidth * visibleHeight) / (rect.width * rect.height) >= 0.5;
}

export function trackFunnelVideoPlay(
  videoId: Extract<ClientFunnelSource, "functions" | "compatibility" | "connected_app">,
  video: HTMLVideoElement,
): void {
  if (!isVideoViewable(video)) return;
  const state = videoState(video);
  state.lastObservedTime = video.currentTime;
  const { milestones } = state;
  if (milestones.has("play")) return;
  milestones.add("play");
  trackFunnelEvent("video_play", {
    source: videoId,
    properties: { autoplay: video.autoplay, viewable: true },
  });
}

export function trackFunnelVideoProgress(
  videoId: Extract<ClientFunnelSource, "functions" | "compatibility" | "connected_app">,
  video: HTMLVideoElement,
): void {
  const state = videoState(video);
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    state.lastObservedTime = video.currentTime;
    return;
  }
  const currentTime = video.currentTime;
  const previousTime = state.lastObservedTime;
  state.lastObservedTime = currentTime;
  if (!isVideoViewable(video)) return;

  if (previousTime !== undefined) {
    const mediaDelta = currentTime - previousTime;
    // Native timeupdate fires several times per second. Large jumps are seeks,
    // throttled background work, or loop resets and must not inflate viewing.
    if (mediaDelta > 0 && mediaDelta <= 2.5) {
      state.viewableWatchSeconds = Math.min(
        video.duration,
        state.viewableWatchSeconds + mediaDelta,
      );
    }
  }

  const ratio = state.viewableWatchSeconds / video.duration;
  const { milestones } = state;
  if (!milestones.has("play")) {
    milestones.add("play");
    trackFunnelEvent("video_play", {
      source: videoId,
      properties: { autoplay: video.autoplay, viewable: true },
    });
  }
  const thresholds = [
    { key: "25", ratio: 0.25, eventName: "video_25" },
    { key: "50", ratio: 0.5, eventName: "video_50" },
    { key: "75", ratio: 0.75, eventName: "video_75" },
  ] as const;

  for (const threshold of thresholds) {
    if (ratio >= threshold.ratio && !milestones.has(threshold.key)) {
      milestones.add(threshold.key);
      trackFunnelEvent(threshold.eventName, { source: videoId });
    }
  }
  if (ratio >= 0.98 && !milestones.has("complete")) {
    milestones.add("complete");
    trackFunnelEvent("video_complete", { source: videoId });
  }
}

export function trackFunnelVideoComplete(
  videoId: Extract<ClientFunnelSource, "functions" | "compatibility" | "connected_app">,
  video: HTMLVideoElement,
): void {
  trackFunnelVideoProgress(videoId, video);
  const state = videoState(video);
  if (
    !Number.isFinite(video.duration) ||
    video.duration <= 0 ||
    state.viewableWatchSeconds / video.duration < 0.98
  ) {
    return;
  }
  const { milestones } = state;
  if (milestones.has("complete")) return;
  milestones.add("complete");
  trackFunnelEvent("video_complete", { source: videoId });
}
