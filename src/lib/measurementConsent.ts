import {
  OPTIONAL_MEASUREMENT_CONSENT_PURPOSE,
  OPTIONAL_MEASUREMENT_CONSENT_VERSION,
  grantedOptionalMeasurementConsent,
  isOptionalMeasurementConsentRecord,
  type OptionalMeasurementConsentRecord,
  type OptionalMeasurementConsentState,
} from "./measurementConsentContract.ts";

export const OPTIONAL_MEASUREMENT_CONSENT_STORAGE_KEY = "watchdive.ad-measurement-consent.v1";
export const OPTIONAL_MEASUREMENT_CONSENT_CHANGED_EVENT =
  "watchdive:optional-measurement-consent-changed";

const OPTIONAL_SESSION_STORAGE_KEYS = ["watchdive.launchos-funnel.v1"] as const;
const LEGACY_OPTIONAL_LOCAL_STORAGE_KEYS = [
  "watchdive.measurement.first_touch.v3",
  "watchdive.measurement.last_touch.v3",
] as const;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type OptionalMeasurementConsentEnvironment = {
  localStorage?: StorageLike | null;
  sessionStorage?: StorageLike | null;
  navigator?: { globalPrivacyControl?: boolean } | null;
  document?: Pick<Document, "cookie"> | null;
  location?: Pick<Location, "hostname"> | null;
  dispatchEvent?: ((eventName: string, detail: unknown) => void) | null;
};

function browserEnvironment(): OptionalMeasurementConsentEnvironment {
  if (typeof window === "undefined") return {};
  let localStorage: StorageLike | null = null;
  let sessionStorage: StorageLike | null = null;
  try {
    localStorage = window.localStorage;
  } catch {
    // Restricted storage keeps the optional purpose disabled.
  }
  try {
    sessionStorage = window.sessionStorage;
  } catch {
    // Restricted storage keeps the optional purpose disabled.
  }
  return {
    localStorage,
    sessionStorage,
    navigator: navigator as Navigator & { globalPrivacyControl?: boolean },
    document,
    location: window.location,
    dispatchEvent: dispatchOptionalMeasurementConsentChanged,
  };
}

function safeGet(storage: StorageLike | null | undefined, key: string) {
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
    // Best-effort local cleanup never blocks the privacy choice.
  }
}

export function hasGlobalPrivacyControl(
  environment: OptionalMeasurementConsentEnvironment = browserEnvironment(),
) {
  return environment.navigator?.globalPrivacyControl === true;
}

export function readStoredOptionalMeasurementConsent(
  environment: OptionalMeasurementConsentEnvironment = browserEnvironment(),
): OptionalMeasurementConsentRecord | null {
  const raw = safeGet(environment.localStorage, OPTIONAL_MEASUREMENT_CONSENT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isOptionalMeasurementConsentRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getEffectiveOptionalMeasurementConsent(
  environment: OptionalMeasurementConsentEnvironment = browserEnvironment(),
): OptionalMeasurementConsentRecord | null {
  if (hasGlobalPrivacyControl(environment)) {
    return {
      purpose: OPTIONAL_MEASUREMENT_CONSENT_PURPOSE,
      state: "denied",
      version: OPTIONAL_MEASUREMENT_CONSENT_VERSION,
    };
  }
  return readStoredOptionalMeasurementConsent(environment);
}

export function getGrantedOptionalMeasurementConsent(
  environment: OptionalMeasurementConsentEnvironment = browserEnvironment(),
) {
  const consent = getEffectiveOptionalMeasurementConsent(environment);
  return consent?.state === "granted" ? grantedOptionalMeasurementConsent() : undefined;
}

export function hasOptionalMeasurementConsent(
  environment: OptionalMeasurementConsentEnvironment = browserEnvironment(),
) {
  return Boolean(getGrantedOptionalMeasurementConsent(environment));
}

export function optionalMeasurementChoiceRequiresDocumentReset(
  previous: OptionalMeasurementConsentState | "unknown",
  resolved: OptionalMeasurementConsentState,
  authorityCode: string | null | undefined,
) {
  return (
    (resolved === "granted" && authorityCode === "CONSENT_AUTHORITY_BOUND_FRESH") ||
    (resolved === "denied" && previous === "granted")
  );
}

export function dispatchOptionalMeasurementConsentChanged(
  eventNameOrRecord: string | OptionalMeasurementConsentRecord,
  maybeRecord?: unknown,
) {
  if (typeof window === "undefined") return;
  const eventName =
    typeof eventNameOrRecord === "string"
      ? eventNameOrRecord
      : OPTIONAL_MEASUREMENT_CONSENT_CHANGED_EVENT;
  const detail = typeof eventNameOrRecord === "string" ? maybeRecord : eventNameOrRecord;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

function measurementCookieNames(documentLike: Pick<Document, "cookie"> | null | undefined) {
  const names = new Set(["_fbp", "_fbc", "fr", "_ga", "_gid", "_gat"]);
  for (const entry of (documentLike?.cookie ?? "").split(";")) {
    const name = entry.split("=", 1)[0]?.trim();
    if (name?.startsWith("_ga_")) names.add(name);
  }
  return names;
}

/** Removes browser-side identifiers; the server withdrawal path handles prior LaunchOS rows. */
export function purgeOptionalMeasurementBrowserState(
  environment: OptionalMeasurementConsentEnvironment = browserEnvironment(),
) {
  for (const key of OPTIONAL_SESSION_STORAGE_KEYS) safeRemove(environment.sessionStorage, key);
  for (const key of LEGACY_OPTIONAL_LOCAL_STORAGE_KEYS) safeRemove(environment.localStorage, key);

  const documentLike = environment.document;
  if (!documentLike) return;
  const hostname = environment.location?.hostname ?? "";
  const domains = new Set(["", hostname ? `.${hostname}` : "", ".diveroid.com"]);
  for (const name of measurementCookieNames(documentLike)) {
    for (const domain of domains) {
      try {
        documentLike.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
      } catch {
        // Browser/domain policy can make deletion best effort.
      }
    }
  }
}

export function setOptionalMeasurementConsent(
  requestedState: OptionalMeasurementConsentState,
  environment: OptionalMeasurementConsentEnvironment = browserEnvironment(),
): OptionalMeasurementConsentRecord {
  let state =
    requestedState === "granted" && hasGlobalPrivacyControl(environment)
      ? "denied"
      : requestedState;
  let record: OptionalMeasurementConsentRecord = {
    purpose: OPTIONAL_MEASUREMENT_CONSENT_PURPOSE,
    state,
    version: OPTIONAL_MEASUREMENT_CONSENT_VERSION,
  };
  if (
    !safeSet(
      environment.localStorage,
      OPTIONAL_MEASUREMENT_CONSENT_STORAGE_KEY,
      JSON.stringify(record),
    ) &&
    state === "granted"
  ) {
    state = "denied";
    record = { ...record, state };
  }
  if (state === "denied") purgeOptionalMeasurementBrowserState(environment);
  environment.dispatchEvent?.(OPTIONAL_MEASUREMENT_CONSENT_CHANGED_EVENT, record);
  return record;
}
