import { INLINE_MEASUREMENT_ALLOWED_JS, measurementAllowed } from "./consentRegion.ts";
import { competitionRegistry } from "./competitionRegistry.ts";
import type { ExperimentContext } from "./conversionExperimentContract.ts";

export const EXPERIMENT_ENABLED = import.meta.env?.VITE_CONVERSION_EXPERIMENT_ENABLED === "true";
export const EXPERIMENT_STORAGE_KEY = "watchdive.form-first.variant.20261008";
export const BEHAVIOR_SESSION_KEY = "watchdive.behavior-session.v1";
const SESSION_SEEN_KEY = "watchdive.behavior-seen.v1";
export const EXPERIMENT_CHANGED = "watchdive:experiment-ready";
export const FUNNEL_CHANGED = "watchdive:funnel-milestone";
const EXPERIMENT_ID = "wd-form-first-20261008" as const;
type Variant = ExperimentContext["variant"];

declare global {
  interface Window {
    __wdLandingVariant?: Variant;
    __wdLandingQa?: boolean;
  }
}

/** Before first paint: visual choice is ephemeral until measurement is allowed.
 * The QA override never writes the visitor's assignment and never counts. */
export function experimentBootstrap(enabled: boolean): string {
  if (!enabled) return "";
  return `(function(){try{
var p=new URLSearchParams(location.search),qa=p.get('wd_qa')==='1';
var v=crypto.getRandomValues(new Uint8Array(1))[0]<128?'control':'form_first';
if(!qa&&${INLINE_MEASUREMENT_ALLOWED_JS}){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(EXPERIMENT_STORAGE_KEY)})||'null');if(s&&s.expiresAt>Date.now()&&(s.variant==='control'||s.variant==='form_first'))v=s.variant;}catch(e){}}
if(qa&&(p.get('wd_variant')==='control'||p.get('wd_variant')==='form_first'))v=p.get('wd_variant');
window.__wdLandingVariant=v;window.__wdLandingQa=qa;document.documentElement.dataset.wdLanding=v;
}catch(e){}})();`;
}

export function variantFromRandomByte(byte: number): Variant {
  return byte < 128 ? "control" : "form_first";
}

/** Match the complete registered ad tuple; a team label supplied in a URL is not evidence. */
export function experimentTeam(search: string): ExperimentContext["team"] {
  const p = new URLSearchParams(search);
  const one = (key: string) => (p.getAll(key).length === 1 ? p.get(key) : null);
  const campaign = one("utm_campaign"),
    adset = one("utm_term"),
    ad = one("utm_content");
  for (const round of competitionRegistry) {
    if (round.campaignId !== campaign) continue;
    const match = round.ads.find((item) => item.adsetId === adset && item.adId === ad);
    if (match) return match.armId;
  }
  return "organic";
}

let ephemeralSession: string | undefined;
export function behaviorSessionId(): string {
  if (ephemeralSession) return ephemeralSession;
  try {
    const stored = sessionStorage.getItem(BEHAVIOR_SESSION_KEY);
    const seen = Number(sessionStorage.getItem(SESSION_SEEN_KEY));
    const now = Date.now();
    if (
      stored &&
      seen > now - 30 * 60_000 &&
      seen <= now &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)
    ) {
      sessionStorage.setItem(SESSION_SEEN_KEY, String(now));
      return (ephemeralSession = stored);
    }
    ephemeralSession = crypto.randomUUID();
    sessionStorage.setItem(BEHAVIOR_SESSION_KEY, ephemeralSession);
    sessionStorage.setItem(SESSION_SEEN_KEY, String(now));
  } catch {
    ephemeralSession ??= crypto.randomUUID();
  }
  return ephemeralSession;
}

let context: ExperimentContext | undefined;
let revoked = false;
let enrollmentClosed = false;
const SESSION_CONTEXT_KEY = "watchdive.form-first.session.20261008";
const funnel = { exposed: false, formVisible: false, formFocused: false, submitAttempted: false };

export function currentLandingVariant(): Variant {
  return EXPERIMENT_ENABLED &&
    typeof window !== "undefined" &&
    window.__wdLandingVariant === "form_first"
    ? "form_first"
    : "control";
}

export function initializeConversionExperiment(): void {
  if (!EXPERIMENT_ENABLED || typeof window === "undefined" || !window.__wdLandingVariant) return;
  if (!measurementAllowed()) return;
  if (context || revoked || enrollmentClosed) return;
  // Opening a background tab is not an exposure. Begin the observation
  // window only when the visitor can actually see this document.
  if (document.visibilityState === "hidden") return;
  const qa = window.__wdLandingQa === true || location.hostname !== "watchdive.diveroid.com";
  const variant = currentLandingVariant();
  const now = Date.now();
  if (!qa) {
    try {
      localStorage.setItem(
        EXPERIMENT_STORAGE_KEY,
        JSON.stringify({ variant, expiresAt: now + 30 * 86400_000 }),
      );
    } catch {
      /* In-memory assignment remains valid for this page. */
    }
  }
  const sessionId = qa ? crypto.randomUUID() : behaviorSessionId();
  context = {
    experimentId: EXPERIMENT_ID,
    variant,
    sessionId,
    assignedAt: now,
    team: experimentTeam(location.search),
    qa,
  };
  if (!qa) {
    try {
      const old = JSON.parse(sessionStorage.getItem(SESSION_CONTEXT_KEY) ?? "null");
      if (
        old?.experimentId === EXPERIMENT_ID &&
        old.sessionId === sessionId &&
        old.variant === variant &&
        old.qa === false &&
        Number.isSafeInteger(old.assignedAt) &&
        old.assignedAt <= now &&
        old.assignedAt > now - 86400_000 &&
        ["A", "B", "C", "D", "E", "organic"].includes(old.team)
      )
        context = old as ExperimentContext;
      sessionStorage.setItem(SESSION_CONTEXT_KEY, JSON.stringify(context));
    } catch {
      /* Restricted browser: use this page's assignment. */
    }
  }
  funnel.exposed = true;
  window.dispatchEvent(new Event(EXPERIMENT_CHANGED));
}

/** No backfill of actions that happened before permission. A withdrawn session
 * does not resume a half-measured experiment after a later grant. */
export function revokeConversionExperiment(): void {
  if (context) revoked = true;
  context = undefined;
  try {
    localStorage.removeItem(EXPERIMENT_STORAGE_KEY);
  } catch {
    /* unavailable */
  }
  try {
    sessionStorage.removeItem(SESSION_CONTEXT_KEY);
    sessionStorage.removeItem(BEHAVIOR_SESSION_KEY);
    sessionStorage.removeItem(SESSION_SEEN_KEY);
    ephemeralSession = undefined;
  } catch {
    /* unavailable */
  }
}

export function getConversionExperiment(): ExperimentContext | undefined {
  initializeConversionExperiment();
  return measurementAllowed() && !revoked ? context : undefined;
}

/** The measured cohort must start before the first submit. Consent given on
 * the inbox card must not turn an unmeasured signup into a measured non-converter. */
export function closeExperimentEnrollmentOnSubmit(): void {
  if (!getConversionExperiment()) enrollmentClosed = true;
}

export function markConversionMilestone(
  name: "formVisible" | "formFocused" | "submitAttempted",
): void {
  if (!getConversionExperiment() || funnel[name]) return;
  funnel[name] = true;
  window.dispatchEvent(new Event(FUNNEL_CHANGED));
}

export function getConversionFunnel() {
  return { ...funnel };
}
