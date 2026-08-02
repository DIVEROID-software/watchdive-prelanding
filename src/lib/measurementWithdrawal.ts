import {
  launchOsMeasurementWithdrawalSchema,
  type LaunchOsMeasurementWithdrawalInput,
} from "./api/launchOsWithdrawal.contract.ts";
import {
  OPTIONAL_MEASUREMENT_CONSENT_PURPOSE,
  OPTIONAL_MEASUREMENT_CONSENT_VERSION,
} from "./measurementConsentContract.ts";

export const MEASUREMENT_WITHDRAWAL_PENDING_STORAGE_KEY =
  "watchdive.ad-measurement-withdrawal.pending.v1";

const FUNNEL_CONTEXT_STORAGE_KEY = "watchdive.launchos-funnel.v1";
const RANDOM_BYTES = 24;
let memoryPending: LaunchOsMeasurementWithdrawalInput | null = null;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type MeasurementWithdrawalBrowserEnvironment = {
  localStorage?: StorageLike | null;
  sessionStorage?: Pick<Storage, "getItem"> | null;
  now?: () => Date;
  fillRandom?: (bytes: Uint8Array) => void;
};

function browserEnvironment(): MeasurementWithdrawalBrowserEnvironment {
  if (typeof window === "undefined") return {};
  let localStorage: StorageLike | null = null;
  let sessionStorage: Pick<Storage, "getItem"> | null = null;
  try {
    localStorage = window.localStorage;
  } catch {
    // A restricted browser cannot persist a retry marker.
  }
  try {
    sessionStorage = window.sessionStorage;
  } catch {
    // There is no measurement subject to withdraw when the session is hidden.
  }
  return { localStorage, sessionStorage };
}

function safeGet(storage: Pick<Storage, "getItem"> | null | undefined, key: string) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: StorageLike | null | undefined, key: string, value: string) {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(storage: StorageLike | null | undefined, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // The caller retains an in-memory copy and must not claim persistence.
  }
}

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

function readStoredFunnelInstanceId(
  storage: Pick<Storage, "getItem"> | null | undefined,
): string | null {
  const raw = safeGet(storage, FUNNEL_CONTEXT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const consent = value.measurementConsent as Record<string, unknown> | undefined;
    const candidate = {
      requestId: `pwr_v1_${"A".repeat(32)}`,
      funnelInstanceId: value.funnelInstanceId,
      occurredAt: "2026-01-01T00:00:00.000Z",
      reason: "user_denied",
    };
    return value.version === 1 &&
      consent?.purpose === OPTIONAL_MEASUREMENT_CONSENT_PURPOSE &&
      consent.state === "granted" &&
      consent.version === OPTIONAL_MEASUREMENT_CONSENT_VERSION
      ? launchOsMeasurementWithdrawalSchema.safeParse(candidate).success
        ? String(value.funnelInstanceId)
        : null
      : null;
  } catch {
    return null;
  }
}

export function readPendingMeasurementWithdrawal(
  environment: MeasurementWithdrawalBrowserEnvironment = browserEnvironment(),
): LaunchOsMeasurementWithdrawalInput | null {
  const raw = safeGet(environment.localStorage, MEASUREMENT_WITHDRAWAL_PENDING_STORAGE_KEY);
  if (!raw) return memoryPending ? Object.freeze({ ...memoryPending }) : null;
  try {
    const parsed = launchOsMeasurementWithdrawalSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return memoryPending ? Object.freeze({ ...memoryPending }) : null;
    memoryPending = parsed.data;
    return Object.freeze({ ...parsed.data });
  } catch {
    return memoryPending ? Object.freeze({ ...memoryPending }) : null;
  }
}

/**
 * Creates and durably stores one idempotent withdrawal intent before consent
 * cleanup removes the session snapshot. Existing pending work always wins.
 */
export function beginPendingMeasurementWithdrawal(
  reason: LaunchOsMeasurementWithdrawalInput["reason"],
  environment: MeasurementWithdrawalBrowserEnvironment = browserEnvironment(),
): { intent: LaunchOsMeasurementWithdrawalInput; persisted: boolean } | null {
  const existing = readPendingMeasurementWithdrawal(environment);
  if (existing) return { intent: existing, persisted: true };
  const funnelInstanceId = readStoredFunnelInstanceId(environment.sessionStorage);
  if (!funnelInstanceId) return null;
  const intent = launchOsMeasurementWithdrawalSchema.parse({
    requestId: `pwr_v1_${randomBase64Url(environment.fillRandom)}`,
    funnelInstanceId,
    occurredAt: (environment.now?.() ?? new Date()).toISOString(),
    reason,
  });
  memoryPending = intent;
  return {
    intent: Object.freeze(intent),
    persisted: safeSet(
      environment.localStorage,
      MEASUREMENT_WITHDRAWAL_PENDING_STORAGE_KEY,
      JSON.stringify(intent),
    ),
  };
}

export function acknowledgePendingMeasurementWithdrawal(
  requestId: string,
  environment: MeasurementWithdrawalBrowserEnvironment = browserEnvironment(),
) {
  const pending = readPendingMeasurementWithdrawal(environment);
  if (!pending || pending.requestId !== requestId) return false;
  memoryPending = null;
  safeRemove(environment.localStorage, MEASUREMENT_WITHDRAWAL_PENDING_STORAGE_KEY);
  return readPendingMeasurementWithdrawal(environment) === null;
}
