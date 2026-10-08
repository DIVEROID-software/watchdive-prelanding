// Server-only assembly of the verification dependencies.
//
// Named `.server.ts` and imported solely from server functions, so the Resend
// and Notion credentials have no path into a client bundle.
import {
  deliverMetaLead,
  sendMetaCrmQualifiedLead,
  sendMetaEmailVerified,
} from "@/lib/api/metaCapi";
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

/**
 * `request` is the calling request's own network address and user agent. They
 * reach Meta only inside a conversion this request produced — a website event
 * Meta cannot match without a user agent — and are never stored.
 */
export function createServiceDependencies(
  request: { ip?: string; ua?: string; gpc?: boolean } = {},
): ServiceDependencies {
  const client = {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(request.ua ? { ua: request.ua } : {}),
  };
  const databaseId = process.env.NOTION_WAITLIST_DB_ID;
  if (!databaseId) throw new Error("NOTION_WAITLIST_DB_ID is not set");
  return {
    store: createNotionLeadStore(createNotionRequest(), databaseId),
    mailer: createResendMailer(),
    pollGate,
    ...(request.gpc ? { gpc: true as const } : {}),
    onDeliveryFailure: (error) => deliveryAlerter.record(error),
    dispatchVerifiedLead: async (input) => {
      const { stillAllowed, ...event } = input;
      const sent = await sendMetaEmailVerified({ ...event, ...client });
      // The CRM leg of the Conversion Leads integration rides the same gate:
      // it only fires for a consented, non-abusive confirmation, and its own
      // failure never un-confirms the lead. The row is read again first: a
      // refusal that committed while the website call was in flight stops it.
      if (stillAllowed && !(await stillAllowed().catch(() => false))) return sent;
      await sendMetaCrmQualifiedLead(event);
      return sent;
    },
    // The submit Lead: for a brand-new consented signup, and for a re-submit
    // that newly allows measurement, under the browser pixel's id; when
    // allowed later (inbox card, confirmation page), server-only under the
    // row-derived id.
    dispatchSubmitLead: async (input) => {
      // Acknowledged only when Meta took it; anything else stays pending.
      return (await deliverMetaLead({ ...input, ...client })) === "sent";
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
