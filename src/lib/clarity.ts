// Microsoft Clarity. Heatmaps and session recordings stay off until a project
// id is set and this browser has clicked Allow. Input text is masked.

const CLARITY_ID_PATTERN = /^[a-z0-9]{6,20}$/;
const CONSENT_STORAGE_KEY = "watchdive.measurement-consent.v3";

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };

declare global {
  interface Window {
    clarity?: ClarityFn;
  }
}

export function readClarityProjectId(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): string {
  const id = env.VITE_CLARITY_PROJECT_ID?.trim().toLowerCase() ?? "";
  return CLARITY_ID_PATTERN.test(id) ? id : "";
}

function consentGranted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(CONSENT_STORAGE_KEY) !== "granted") return false;
  } catch {
    return false;
  }
  return (
    typeof navigator === "undefined" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl !== true
  );
}

function maskInputs(): void {
  document.querySelectorAll("input, textarea").forEach((field) => {
    field.setAttribute("data-clarity-mask", "true");
  });
}

export function initClarity(projectId = readClarityProjectId()): void {
  if (typeof window === "undefined" || !projectId || !consentGranted()) return;
  if (!window.clarity) {
    const clarity = function (...args: unknown[]) {
      (clarity.q = clarity.q || []).push(args);
    } as ClarityFn;
    window.clarity = clarity;
  }
  if (!document.getElementById("watchdive-clarity")) {
    const script = document.createElement("script");
    script.id = "watchdive-clarity";
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${projectId}`;
    document.head.appendChild(script);
  }
  window.clarity("consentv2", {
    ad_Storage: "granted",
    analytics_Storage: "granted",
  });
  maskInputs();
}

export function trackClarity(event: string, formId?: string): void {
  if (!window.clarity || !consentGranted()) return;
  if (formId && /^[a-z0-9-]{1,40}$/.test(formId)) window.clarity("set", "form", formId);
  if (/^[a-z0-9_]{1,40}$/.test(event)) window.clarity("event", event);
}
