import assert from "node:assert/strict";
import { test } from "node:test";

import { launchOsMeasurementLocaleAllowed } from "../src/lib/funnelContext.ts";
import {
  OPTIONAL_MEASUREMENT_CONSENT_STORAGE_KEY,
  getEffectiveOptionalMeasurementConsent,
  optionalMeasurementChoiceRequiresDocumentReset,
  readStoredOptionalMeasurementConsent,
  setOptionalMeasurementConsent,
} from "../src/lib/measurementConsent.ts";

function storage(initial: Record<string, string> = {}, failWrites = false) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("blocked");
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  };
}

test("legacy plain consent is never upgraded into the versioned LaunchOS purpose", () => {
  const local = storage({ "watchdive.measurement-consent.v3": "granted" });
  assert.equal(readStoredOptionalMeasurementConsent({ localStorage: local }), null);
  assert.equal(getEffectiveOptionalMeasurementConsent({ localStorage: local }), null);
});

test("only the exact versioned JSON record is accepted", () => {
  const exact = {
    purpose: "advertising_measurement",
    state: "granted",
    version: "WD-AD-MEASUREMENT-CONSENT-V1",
  } as const;
  const local = storage({ [OPTIONAL_MEASUREMENT_CONSENT_STORAGE_KEY]: JSON.stringify(exact) });
  assert.deepEqual(readStoredOptionalMeasurementConsent({ localStorage: local }), exact);

  local.values.set(
    OPTIONAL_MEASUREMENT_CONSENT_STORAGE_KEY,
    JSON.stringify({ ...exact, inferredFromLegacy: true }),
  );
  assert.equal(readStoredOptionalMeasurementConsent({ localStorage: local }), null);
});

test("unavailable or throwing storage turns a requested grant into denied", () => {
  for (const localStorage of [null, storage({}, true)]) {
    const events: unknown[] = [];
    const result = setOptionalMeasurementConsent("granted", {
      localStorage,
      dispatchEvent: (_name, detail) => events.push(detail),
    });
    assert.equal(result.state, "denied");
    assert.equal((events[0] as { state: string }).state, "denied");
  }
});

test("Global Privacy Control overrides an exact stored grant", () => {
  const local = storage();
  setOptionalMeasurementConsent("granted", { localStorage: local });
  assert.equal(
    getEffectiveOptionalMeasurementConsent({
      localStorage: local,
      navigator: { globalPrivacyControl: true },
    })?.state,
    "denied",
  );
});

test("the first consent UI release is limited to English and Korean paths", () => {
  assert.equal(launchOsMeasurementLocaleAllowed("/"), true);
  assert.equal(launchOsMeasurementLocaleAllowed("/ko"), true);
  assert.equal(launchOsMeasurementLocaleAllowed("/ko/"), true);
  for (const path of ["/fr", "/de", "/es", "/ja", "/zh-cn", "/zh-tw", "/id"]) {
    assert.equal(launchOsMeasurementLocaleAllowed(path), false, path);
  }
});

test("grant-deny-grant resets every one-shot funnel boundary", () => {
  assert.equal(
    optionalMeasurementChoiceRequiresDocumentReset(
      "unknown",
      "granted",
      "CONSENT_AUTHORITY_BOUND_FRESH",
    ),
    true,
  );
  assert.equal(
    optionalMeasurementChoiceRequiresDocumentReset(
      "granted",
      "denied",
      "CONSENT_AUTHORITY_REVOKED",
    ),
    true,
  );
  assert.equal(
    optionalMeasurementChoiceRequiresDocumentReset(
      "denied",
      "granted",
      "CONSENT_AUTHORITY_BOUND_FRESH",
    ),
    true,
  );
  assert.equal(
    optionalMeasurementChoiceRequiresDocumentReset(
      "granted",
      "granted",
      "CONSENT_AUTHORITY_REUSED",
    ),
    false,
  );
});
