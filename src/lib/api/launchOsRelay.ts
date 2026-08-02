import { createServerFn } from "@tanstack/react-start";

import {
  launchOsConsentChoiceSchema,
  launchOsWebEventSchema,
  type LaunchOsStreamDiagnostic,
} from "./launchOsRelay.contract.ts";

export {
  launchOsMeasurementContextSchema,
  launchOsConsentChoiceSchema,
  launchOsOptionalMeasurementConsentSchema,
  launchOsWaitlistMeasurementSchema,
  launchOsWebEventSchema,
} from "./launchOsRelay.contract.ts";
export type {
  LaunchOsBrowserRequestFacts,
  LaunchOsPostDependencies,
  LaunchOsStreamDiagnostic,
  LaunchOsStreamStatus,
  LaunchOsWebEventInput,
} from "./launchOsRelay.contract.ts";

const requestContextUnavailable = (): LaunchOsStreamDiagnostic => ({
  status: "invalid",
  code: "REQUEST_CONTEXT_UNAVAILABLE",
  attempts: 0,
  evidenceState: "event_observation_only",
  coveragePublished: false,
  decisionReady: false,
});

/**
 * Client-safe server-function shell. The cryptographic relay is imported only
 * inside the server handler, so `node:crypto` and every secret-bearing helper
 * are absent from the hydrated browser graph.
 */
export const trackLaunchOsWebEvent = createServerFn({ method: "POST" })
  .validator(launchOsWebEventSchema)
  .handler(async ({ data }) => {
    try {
      const { relayLaunchOsWebEventFromCurrentRequest } = await import("./launchOsRelay.server.ts");
      return await relayLaunchOsWebEventFromCurrentRequest(data);
    } catch {
      return requestContextUnavailable();
    }
  });

export const setLaunchOsMeasurementAuthority = createServerFn({ method: "POST" })
  .validator(launchOsConsentChoiceSchema)
  .handler(async ({ data }) => {
    try {
      const { setLaunchOsMeasurementAuthorityForCurrentRequest } =
        await import("./launchOsRelay.server.ts");
      return setLaunchOsMeasurementAuthorityForCurrentRequest(data);
    } catch {
      return { ok: false as const, state: "denied" as const, code: "AUTHORITY_UNAVAILABLE" };
    }
  });
