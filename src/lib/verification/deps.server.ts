// Server-only assembly of the verification dependencies.
//
// Named `.server.ts` and imported solely from server functions, so the Resend
// and Notion credentials have no path into a client bundle.
import { sendMetaCrmQualifiedLead, sendMetaLead } from "@/lib/api/metaCapi";
import {
  openLaunchOsReplayMetadata,
  relayLaunchOsVerificationOutcome,
  relayStoredWaitlistLead,
  sealLaunchOsReplayMetadata,
} from "@/lib/api/launchOsRelay.server";
import type { PollResponse } from "./contracts.ts";
import { createNotionLeadStore, createNotionRequest } from "./notionLead.ts";
import { createNotionMeasurementRevocationRegistry } from "./measurementRevocationRegistry.server.ts";
import { createPollGate } from "./pollGate.ts";
import { createResendMailer } from "./resend.ts";
import type { ServiceDependencies } from "./service.ts";

// One gate per server process, shared by every poll. A handle that is replayed
// in a burst is answered from memory, and no handle can ever cost the CRM more
// than its lifetime read ceiling.
const pollGate = createPollGate<PollResponse>();

export function createServiceDependencies(): ServiceDependencies {
  const databaseId = process.env.NOTION_WAITLIST_DB_ID;
  if (!databaseId) throw new Error("NOTION_WAITLIST_DB_ID is not set");
  const notionRequest = createNotionRequest();
  const launchOsReplayEnabled = process.env.LAUNCHOS_NOTION_REPLAY_ENABLED?.trim() === "true";
  const revocationRegistry = launchOsReplayEnabled
    ? createNotionMeasurementRevocationRegistry({
        request: notionRequest,
        databaseId,
        replaySecret: process.env.WAITLIST_REPLAY_HMAC_SECRET ?? "",
        readReplayAuthority: (envelope) =>
          openLaunchOsReplayMetadata(envelope)?.authorityReferenceHash,
      })
    : null;
  return {
    store: createNotionLeadStore(notionRequest, databaseId),
    mailer: createResendMailer(),
    pollGate,
    ...(launchOsReplayEnabled
      ? {
          prepareLaunchOsReplayMetadata: (input) => sealLaunchOsReplayMetadata(input),
          dispatchStoredLeadMeasurement: async (input: { replayMetadata: string }) => {
            await relayStoredWaitlistLead({
              ...input,
              dependencies: {
                sourceMeasurementRevoked: revocationRegistry!.isRevoked,
              },
            });
          },
          dispatchVerificationMeasurement: async (input: {
            replayMetadata: string;
            outcome: "verified" | "failed";
            occurredAt: string;
            reasonCode?: "expired";
          }) => {
            await relayLaunchOsVerificationOutcome({
              ...input,
              dependencies: {
                sourceMeasurementRevoked: revocationRegistry!.isRevoked,
              },
            });
          },
        }
      : {}),
    dispatchVerifiedLead: async (input) => {
      await sendMetaLead(input);
      // The CRM leg of the Conversion Leads integration rides the same gate:
      // it only fires for a consented, non-abusive confirmation, and its own
      // failure never un-confirms the lead.
      await sendMetaCrmQualifiedLead(input);
    },
  };
}

/**
 * Nothing a caller sends may come back out. A Notion or Resend error can carry
 * the recipient address or a request body; a token can only ever have come from
 * the caller. Server functions therefore surface one opaque failure and the
 * detail stays in the server log.
 */
export function sanitizeServerError(scope: string, error: unknown): Error {
  const detail = error instanceof Error ? error.name : "unknown";
  console.error(`[${scope}] failed (${detail})`);
  return new Error("Request failed");
}
