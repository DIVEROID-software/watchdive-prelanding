import { z } from "zod";
import { SUPPORTED_LOCALES } from "../i18n/locale.ts";

export const SEGMENT_MEASUREMENT_ID = "wd-landing-segments-20261025" as const;
export const SEGMENT_LAYOUT_REVISION = "segments-v1" as const;
export const SEGMENT_LAYOUT_REVISIONS = [SEGMENT_LAYOUT_REVISION, "airy-v1"] as const;
export const SEGMENT_MEASUREMENT_STORAGE = "watchdive.segments.session.20261025";
export const SEGMENT_NAMES = ["freediving", "scuba"] as const;
export const SEGMENT_PLACEMENTS = ["middle", "bottom"] as const;
const metaId = z.string().regex(/^[0-9]{4,32}$/);
export const segmentContextSchema = z
  .object({
    experimentId: z.literal(SEGMENT_MEASUREMENT_ID),
    variant: z.literal("segmented"),
    team: z.enum(["A", "B", "C", "D", "E", "organic"]),
    sessionId: z.string().uuid(),
    assignedAt: z
      .number()
      .int()
      .refine((v) => Number.isSafeInteger(v) && v > 0),
    qa: z.boolean(),
    entrySegment: z.enum(SEGMENT_NAMES),
    layoutRevision: z.enum(SEGMENT_LAYOUT_REVISIONS),
    locale: z.enum(SUPPORTED_LOCALES),
    device: z.enum(["phone", "tablet", "desktop"]),
    // Exact URL tuple at enrollment, not inferred traffic source or copied first touch.
    attribution: z
      .object({
        campaignId: metaId.optional(),
        adsetId: metaId.optional(),
        adId: metaId.optional(),
      })
      .strict(),
    // Present only on the popup submit's CRM copy. The UX session context
    // leaves it off so a later body submit is not tagged entry-popup.
    acquisitionPlacement: z.literal("entry-popup").optional(),
  })
  .strict();
export type SegmentMeasurementContext = z.infer<typeof segmentContextSchema>;
const placement = z
  .object({ formVisible: z.boolean(), formFocused: z.boolean(), submitAttempted: z.boolean() })
  .strict();
export const segmentPlacementSchema = z
  .object({
    middle: placement,
    bottom: placement,
    crossedSegment: z.boolean(),
    crossedLayout: z.boolean().optional(),
  })
  .strict();
export type SegmentPlacementFunnel = z.infer<typeof segmentPlacementSchema>;
export function emptySegmentPlacements(): SegmentPlacementFunnel {
  return {
    middle: { formVisible: false, formFocused: false, submitAttempted: false },
    bottom: { formVisible: false, formFocused: false, submitAttempted: false },
    crossedSegment: false,
    crossedLayout: false,
  };
}
export function segmentSourceTuple(search: string): SegmentMeasurementContext["attribution"] {
  const p = new URLSearchParams(search);
  const get = (name: string) => {
    const values = p.getAll(name);
    return values.length === 1 && /^[0-9]{4,32}$/.test(values[0]) ? values[0] : undefined;
  };
  return { campaignId: get("utm_campaign"), adsetId: get("utm_term"), adId: get("utm_content") };
}
