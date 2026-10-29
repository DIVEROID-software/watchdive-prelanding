import { createMetaPurchases } from "../analytics/metaPurchases.server.ts";
// Server-only assembly of the verification dependencies.
//
// Named `.server.ts` and imported solely from server functions, so the Resend
// and Notion credentials have no path into a client bundle.
import { createGoogleConversions } from "../analytics/googleConversions.server.ts";
import {
  sendMetaCrmQualifiedLead,
  sendMetaEmailVerified,
} from "@/lib/api/metaCapi";
import {
  deliverRetargetingLead,
  deliverRetargetingRegistration,
} from "@/lib/retargeting/capi.ts";
import type { PollResponse } from "./contracts.ts";
import { createDeliveryAlerter, createSlackPoster } from "./deliveryAlert.ts";
import { createNotionLeadStore, createNotionRequest } from "./notionLead.ts";
import { reportPressStage } from "../press/pressAttribution.server.ts";
import { createPollGate } from "./pollGate.ts";
import { createVercelAfterResponse } from "./asyncVerificationMail.server.ts";
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
  const notionRequest = createNotionRequest();
  const google = createGoogleConversions();
  const metaPurchases = createMetaPurchases();
  return {
    store: createNotionLeadStore(notionRequest, databaseId),
    // capture() is a no-op while the GA4 server sender is off, but the signup
    // path rereads Notion before calling it. Omit the hook so that read does
    // not run. Withdrawal still calls google.forget below.
    ...(google.enabled ? { captureGoogleContext: google.capture } : {}),
    forgetGoogleContext: async (email) => {
      // Attempt both even if one store operation fails. Persisted Notion refusal
      // independently prevents either sink from dispatching afterwards.
      const results = await Promise.allSettled([google.forget(email), metaPurchases.forget(email)]);
      if (results.some((result) => result.status === "rejected"))
        throw new Error("conversion_context_withdrawal_incomplete");
    },
    dispatchGoogleVerified: async (row, allowed) => {
      const result = await google.send(
        row.email,
        {
          name: "sign_up",
          key: row.pageId,
          params: { method: row.signupMethod ?? "email" },
        },
        allowed,
      );
      if (result === "retry" || result === "uncertain")
        console.warn(`[ga4] verified signup delivery ${result}`);
    },
    mailer: createResendMailer(),
    // Holds the verification send when this request has a Vercel waitUntil.
    // Outside that runtime the hook throws and the service awaits the send.
    // The package call alone is a no-op without the request context.
    scheduleAfterResponse: createVercelAfterResponse(),
    resolveWelcomeShareCode: async (refCode) => {
      const [{ referralServiceDeps }, { getMyShareCodeService }] = await Promise.all([
        import("../api/referral.functions"),
        import("../referral/service.server.ts"),
      ]);
      const result = await getMyShareCodeService(refCode, await referralServiceDeps());
      return result.enabled ? result.code : null;
    },
    // Completed press-attributed signups (pressAttribution.server.ts). Off unless configured.
    reportPress: (stage, row) => reportPressStage(stage, row, notionRequest),
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
    // Historical submit Lead stopped in the same edit as the durable Lead.
    // Kept so an older caller cannot revive deliverMetaLead from this assembly.
    dispatchSubmitLead: async () => false,
    dispatchDurableMeasurement: async (input) => {
      const payload = { ...input, ...client };
      if (input.plan.browser?.eventName === "CompleteRegistration") {
        await deliverRetargetingRegistration(payload);
        return;
      }
      await deliverRetargetingLead(payload);
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
