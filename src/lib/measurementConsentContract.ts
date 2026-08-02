export const OPTIONAL_MEASUREMENT_CONSENT_PURPOSE = "advertising_measurement" as const;
export const OPTIONAL_MEASUREMENT_CONSENT_VERSION = "WD-AD-MEASUREMENT-CONSENT-V1" as const;

export type OptionalMeasurementConsentState = "granted" | "denied";

export type OptionalMeasurementConsentRecord = {
  purpose: typeof OPTIONAL_MEASUREMENT_CONSENT_PURPOSE;
  state: OptionalMeasurementConsentState;
  version: typeof OPTIONAL_MEASUREMENT_CONSENT_VERSION;
};

export type GrantedOptionalMeasurementConsentRecord = Omit<
  OptionalMeasurementConsentRecord,
  "state"
> & { state: "granted" };

export function isOptionalMeasurementConsentRecord(
  value: unknown,
): value is OptionalMeasurementConsentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 3 &&
    record.purpose === OPTIONAL_MEASUREMENT_CONSENT_PURPOSE &&
    (record.state === "granted" || record.state === "denied") &&
    record.version === OPTIONAL_MEASUREMENT_CONSENT_VERSION
  );
}

export function grantedOptionalMeasurementConsent(): GrantedOptionalMeasurementConsentRecord {
  return Object.freeze({
    purpose: OPTIONAL_MEASUREMENT_CONSENT_PURPOSE,
    state: "granted",
    version: OPTIONAL_MEASUREMENT_CONSENT_VERSION,
  });
}
