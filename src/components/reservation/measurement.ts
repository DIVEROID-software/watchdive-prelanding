// Client recorder for an authoritative reservation status.
// Does not import the server planner.

import { markDeviceSignupStatus } from "../retargeting/device-status.ts";
import { trackRetargetingBrowser, type BrowserSinks } from "../../lib/retargeting/browser.ts";
import type { BrowserRetargetingEvent } from "../../lib/retargeting/events.ts";

const fired = new Set<string>();

export function resetReservationMeasurementForTests(): void {
  fired.clear();
}

export function recordAuthoritativeReservation(
  status: { authoritativePaid: boolean; purchase?: BrowserRetargetingEvent | null },
  options?: { store?: Pick<Storage, "getItem" | "setItem">; sinks?: BrowserSinks },
): void {
  if (status.authoritativePaid) markDeviceSignupStatus("paid", options?.store);
  const event = status.authoritativePaid ? status.purchase : null;
  if (!event || fired.has(event.eventId)) return;
  const result = trackRetargetingBrowser(event, options?.sinks);
  if (result.reason !== "consent") fired.add(event.eventId);
}
