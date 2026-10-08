import { measurementAllowed } from "@/lib/consentRegion";
import type { Locale } from "@/lib/i18n/locale";
import { localeFromPathname } from "@/lib/i18n/locale";

import { recordPageBehavior } from "@/lib/api/pageBehavior.functions";
import {
  behaviorSessionId,
  getConversionExperiment,
  getConversionFunnel,
  initializeConversionExperiment,
  revokeConversionExperiment,
  EXPERIMENT_CHANGED,
  FUNNEL_CHANGED,
} from "./conversionExperimentClient";

type ClickMark = { id: string; x: number; y: number };
type SectionMark = { id: string; dwellSec: number };

let started = false;

function deviceClass(): "phone" | "tablet" | "desktop" {
  const width = window.innerWidth;
  if (width < 768) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, "")
      .slice(0, 80);
  } catch {
    return "";
  }
}

function utm(name: string): string {
  return (new URLSearchParams(window.location.search).get(name) ?? "")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 40);
}

function sectionLabel(element: Element): string {
  if (element.id && /^[a-z0-9-]{1,40}$/.test(element.id)) return element.id;
  const heading = element.querySelector("h1, h2, h3");
  const text = (heading?.textContent ?? element.tagName)
    .replace(/[@\d]/g, "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, 40);
  return text || element.tagName.toLowerCase();
}

function clickId(target: Element): string | null {
  if (target.closest("input, textarea")) return null;
  if (target.closest('select[aria-label="Language"]')) return "language";
  const href = target.closest("a")?.getAttribute("href") ?? "";
  if (href.includes("#offer-form")) {
    return target.closest("a")?.className.includes("fixed") ? "sticky-cta" : "header-cta";
  }
  if (href.includes("#beta-reviews")) return "reviews-link";
  if (href.endsWith("/privacy")) return "privacy";
  if (href.endsWith("/terms")) return "terms";
  const form = target.closest("form");
  if (target.closest("button[type=submit]") && form?.querySelector("#hero-email"))
    return "hero-submit";
  if (target.closest("button[type=submit]") && form?.querySelector("#offer-email"))
    return "offer-submit";
  if (target.closest("summary")) return "disclosure";
  const label = target.closest("button")?.getAttribute("aria-label") ?? "";
  if (
    label.startsWith("Show ") ||
    label === "Previous" ||
    label === "Next" ||
    label.startsWith("Go to ")
  ) {
    return "app-slide";
  }
  if (target.closest("[role=dialog] button")) return "cookie-choice";
  if (target.closest("button")) return "button";
  if (target.closest("a")) return "link";
  return null;
}

export function startPageBehavior(): void {
  if (started || typeof window === "undefined" || !measurementAllowed()) return;
  started = true;
  initializeConversionExperiment();
  let active = true;

  const began = Date.now();
  const id = behaviorSessionId();
  const dwell = new Map<Element, { label: string; ms: number; since: number | null }>();
  const clicks: ClickMark[] = [];
  let maxScroll = 0;

  const regions = document.querySelectorAll("header, section, footer");
  const observer = new IntersectionObserver((entries) => {
    if (!active || !measurementAllowed()) return;
    const now = Date.now();
    for (const entry of entries) {
      const state = dwell.get(entry.target) ?? {
        label: sectionLabel(entry.target),
        ms: 0,
        since: null,
      };
      if (entry.isIntersecting && state.since === null) state.since = now;
      if (!entry.isIntersecting && state.since !== null) {
        state.ms += now - state.since;
        state.since = null;
      }
      dwell.set(entry.target, state);
    }
  });
  regions.forEach((region) => observer.observe(region));

  const onScroll = () => {
    if (!active || !measurementAllowed()) return;
    const height = document.documentElement.scrollHeight - window.innerHeight;
    const next = height <= 0 ? 100 : Math.round((window.scrollY / height) * 100);
    maxScroll = Math.max(maxScroll, Math.min(100, next));
  };
  const onClick = (event: MouseEvent) => {
    if (!active || !measurementAllowed()) return;
    const target = event.target;
    if (!(target instanceof Element) || clicks.length >= 30) return;
    const mark = clickId(target);
    if (!mark) return;
    clicks.push({
      id: mark,
      x: Math.round((event.clientX / Math.max(window.innerWidth, 1)) * 100),
      y: Math.round((event.clientY / Math.max(window.innerHeight, 1)) * 100),
    });
  };

  document.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("click", onClick, true);
  onScroll();

  let lastSent = "";
  let inFlight = false;
  let sendAgain = false;
  let ignored = false;
  const send = () => {
    if (!active || ignored || !measurementAllowed()) return;
    if (inFlight) {
      sendAgain = true;
      return;
    }
    const now = Date.now();
    const sections: SectionMark[] = [];
    for (const state of dwell.values()) {
      const extra = state.since === null ? 0 : now - state.since;
      const dwellSec = Math.round((state.ms + extra) / 1000);
      if (dwellSec <= 0 || sections.length >= 16) continue;
      sections.push({ id: state.label, dwellSec });
    }
    const locale = localeFromPathname(window.location.pathname) as Locale;
    const data = {
      sessionId: getConversionExperiment()?.sessionId ?? id,
      locale,
      device: deviceClass(),
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC").slice(0, 64),
      durationSec: Math.min(86_400, Math.round((now - began) / 1000)),
      maxScroll,
      referrerHost: hostOf(document.referrer),
      utmSource: utm("utm_source"),
      utmMedium: utm("utm_medium"),
      utmCampaign: utm("utm_campaign"),
      sections,
      clicks,
      ...(getConversionExperiment()
        ? { experiment: getConversionExperiment(), funnel: getConversionFunnel() }
        : {}),
    };
    // Duration always moves, so compare everything else: a tab switched back
    // and forth without reading or clicking adds no Notion write.
    const fingerprint = JSON.stringify({ ...data, durationSec: 0 });
    if (fingerprint === lastSent) return;
    lastSent = fingerprint;
    inFlight = true;
    void recordPageBehavior({ data })
      .then((result) => {
        if (!result.stored && result.reason === "ignored") {
          ignored = true;
          return;
        }
        if (!result.stored && lastSent === fingerprint) lastSent = "";
      })
      .catch(() => {
        if (lastSent === fingerprint) lastSent = "";
      })
      .finally(() => {
        inFlight = false;
        if (sendAgain) {
          sendAgain = false;
          send();
        }
      });
  };

  // A visit must be saved before an unload, otherwise the short visits we
  // want to understand disappear. Coalesce at most the four funnel stages;
  // retries are bounded and optional measurement never delays the signup.
  let milestoneTimer: ReturnType<typeof setTimeout> | undefined;
  const queueMilestone = () => {
    if (milestoneTimer) return;
    milestoneTimer = setTimeout(() => {
      milestoneTimer = undefined;
      send();
    }, 1200);
  };
  window.addEventListener(EXPERIMENT_CHANGED, queueMilestone);
  window.addEventListener(FUNNEL_CHANGED, queueMilestone);
  const onChoice = () => {
    if (!measurementAllowed()) {
      active = false;
      started = false;
      revokeConversionExperiment();
      if (milestoneTimer) clearTimeout(milestoneTimer);
      milestoneTimer = undefined;
      observer.disconnect();
      dwell.clear();
      clicks.length = 0;
      document.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      window.removeEventListener(EXPERIMENT_CHANGED, queueMilestone);
      window.removeEventListener(FUNNEL_CHANGED, queueMilestone);
      window.removeEventListener("watchdive:measurement-choice", onChoice);
    }
  };
  window.addEventListener("watchdive:measurement-choice", onChoice);
  send();
  setTimeout(send, 6000); // One bounded retry also captures early form exposure.

  // Final summary supplements the initial visit and bounded milestones.
  const onVisibility = () => {
    if (document.visibilityState === "hidden") send();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", send);
}
