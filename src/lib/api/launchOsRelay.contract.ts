import { z } from "zod";

import {
  OPTIONAL_MEASUREMENT_CONSENT_PURPOSE,
  OPTIONAL_MEASUREMENT_CONSENT_VERSION,
} from "../measurementConsentContract.ts";

const META_ID = /^[0-9]{4,32}$/;
const FUNNEL_INSTANCE_ID = /^fi_v1_[A-Za-z0-9_-]{32}$/;
const BROWSER_EVENT_ID = /^loe_v1_[A-Za-z0-9_-]{32}$/;

const optionalMetaId = z.string().regex(META_ID).optional();
const attributionSchema = z
  .object({
    campaignId: optionalMetaId,
    adsetId: optionalMetaId,
    targetId: optionalMetaId,
    adId: optionalMetaId,
    contentId: optionalMetaId,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.targetId && value.targetId !== value.adsetId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetId"], message: "mismatch" });
    }
    if (value.contentId && value.contentId !== value.adId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["contentId"], message: "mismatch" });
    }
  });

export const launchOsOptionalMeasurementConsentSchema = z
  .object({
    purpose: z.literal(OPTIONAL_MEASUREMENT_CONSENT_PURPOSE),
    state: z.literal("granted"),
    version: z.literal(OPTIONAL_MEASUREMENT_CONSENT_VERSION),
  })
  .strict();

export const launchOsConsentChoiceSchema = z
  .object({
    purpose: z.literal(OPTIONAL_MEASUREMENT_CONSENT_PURPOSE),
    state: z.enum(["granted", "denied"]),
    version: z.literal(OPTIONAL_MEASUREMENT_CONSENT_VERSION),
  })
  .strict();

export const launchOsMeasurementContextSchema = z
  .object({
    funnelInstanceId: z.string().regex(FUNNEL_INSTANCE_ID),
    attribution: attributionSchema,
    measurementConsent: launchOsOptionalMeasurementConsentSchema,
    placement: z.enum(["hero", "offer"]).optional(),
  })
  .strict();

export const launchOsWaitlistMeasurementSchema = launchOsMeasurementContextSchema
  .optional()
  .catch(undefined);

export const launchOsWebEventSchema = launchOsMeasurementContextSchema
  .omit({ placement: true })
  .extend({
    eventName: z.enum(["landing_viewed", "cta_viewed", "form_started", "submit_attempted"]),
    eventId: z.string().regex(BROWSER_EVENT_ID),
    occurredAt: z.string().datetime({ offset: true }),
    placement: z.enum(["page", "hero", "offer"]),
  })
  .strict()
  .superRefine((value, context) => {
    const valid =
      value.eventName === "landing_viewed"
        ? value.placement === "page"
        : value.placement === "hero" || value.placement === "offer";
    if (!valid) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["placement"], message: "mismatch" });
    }
  });

export type LaunchOsWebEventInput = z.infer<typeof launchOsWebEventSchema>;
export type LaunchOsStreamStatus = "accepted" | "disabled" | "failed" | "invalid";

/**
 * `/api/events` proves that a row arrived; it does not prove the source was
 * complete. A separate coverage adapter must declare partial/complete days
 * before LaunchOS can use these rows as an official decision metric.
 */
export type LaunchOsStreamDiagnostic = {
  status: LaunchOsStreamStatus;
  attempts: number;
  code: string;
  evidenceState: "event_observation_only";
  coveragePublished: false;
  decisionReady: false;
};

export type LaunchOsPostDependencies = {
  fetchImpl?: typeof fetch;
  nowImpl?: () => number;
  nonceFactory?: () => string;
  sleepImpl?: (delayMs: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  /**
   * Source-side durable privacy gate. Stored-CRM and verification replays must
   * never reach LaunchOS unless this check succeeds and returns false.
   */
  sourceMeasurementRevoked?: (authorityReferenceHash: string) => Promise<boolean>;
};

export type LaunchOsBrowserRequestFacts = {
  requestUrl: string;
  origin: string | null;
  secFetchSite: string | null;
  secGpc: string | null;
  serverFnHeader: string | null;
  consentCookie: string | null;
  configuredPublicOrigin?: string;
  nodeEnv?: string;
};
