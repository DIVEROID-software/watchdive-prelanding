// Server-side gate for a retargeting event. Opt-out, Global Privacy Control,
// and an unknown choice all refuse. This does not read cookies or Notion.

import {
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_LEAD_PENDING,
  MEASUREMENT_CONSENT_WITHDRAWN,
  MEASUREMENT_CONSENT_WITHHELD,
} from "../verification/contracts.ts";

export type RetargetingConsentState =
  | "granted"
  | "pending"
  | "denied"
  | "withdrawn"
  | "withheld"
  | "unknown";

export type RetargetingConsent = {
  state: RetargetingConsentState;
  gpc: boolean;
  unsubscribed: boolean;
};

export function retargetingConsentAllows(consent: RetargetingConsent | null | undefined): boolean {
  if (!consent || consent.gpc || consent.unsubscribed) return false;
  return consent.state === "granted" || consent.state === "pending";
}

/**
 * Map the stored Measurement consent cell onto the retargeting gate.
 * An empty historical cell is unknown and does not measure.
 * Pass gpc from the request that is sending the event, and unsubscribed from the row.
 */
export function retargetingConsentFromRow(input: {
  measurementConsent: string | null | undefined;
  gpc?: boolean;
  unsubscribed?: boolean;
}): RetargetingConsent {
  const cell = input.measurementConsent?.trim() ?? "";
  let state: RetargetingConsentState = "unknown";
  if (cell === MEASUREMENT_CONSENT_GRANTED) state = "granted";
  else if (cell === MEASUREMENT_CONSENT_LEAD_PENDING) state = "pending";
  else if (cell === MEASUREMENT_CONSENT_WITHDRAWN) state = "withdrawn";
  else if (cell === MEASUREMENT_CONSENT_WITHHELD) state = "withheld";
  return {
    state,
    gpc: input.gpc === true,
    unsubscribed: input.unsubscribed === true,
  };
}
