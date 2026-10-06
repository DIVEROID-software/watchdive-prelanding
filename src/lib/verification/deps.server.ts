// Server-only assembly of the verification dependencies.
//
// Named `.server.ts` and imported solely from server functions, so the Resend
// and Notion credentials have no path into a client bundle.
import { sendMetaCrmQualifiedLead, sendMetaEmailVerified } from "@/lib/api/metaCapi";
import type { PollResponse } from "./contracts.ts";
import { createDeliveryAlerter, createSlackPoster } from "./deliveryAlert.ts";
import { createNotionLeadStore, createNotionRequest } from "./notionLead.ts";
import { createPollGate } from "./pollGate.ts";
import { createResendMailer } from "./resend.ts";
import type { ServiceDependencies } from "./service.ts";

// One gate per server process, shared by every poll. A handle that is replayed
// in a burst is answered from memory, and no handle can ever cost the CRM more
// than its lifetime read ceiling.
const pollGate = createPollGate<PollResponse>();

// One aggregation window per server process, so an outage produces one Slack
// alert per instance per window instead of one per visitor.
const deliveryAlerter = createDeliveryAlerter({ post: createSlackPoster() });

export function createServiceDependencies(): ServiceDependencies {
  const databaseId = process.env.NOTION_WAITLIST_DB_ID;
  if (!databaseId) throw new Error("NOTION_WAITLIST_DB_ID is not set");
  return {
    store: createNotionLeadStore(createNotionRequest(), databaseId),
    mailer: createResendMailer(),
    pollGate,
    onDeliveryFailure: (error) => deliveryAlerter.record(error),
    dispatchVerifiedLead: async (input) => {
      await sendMetaEmailVerified(input);
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
