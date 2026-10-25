import { z } from "zod";
import { SUPPORTED_LOCALES } from "../i18n/locale.ts";

export const SEGMENT_MEASUREMENT_ID = "wd-landing-segments-20261025" as const;
export const SEGMENT_LAYOUT_REVISION = "segments-v1" as const;
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
    layoutRevision: z.literal(SEGMENT_LAYOUT_REVISION),
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
  })
  .strict();
export type SegmentMeasurementContext = z.infer<typeof segmentContextSchema>;
const placement = z
  .object({ formVisible: z.boolean(), formFocused: z.boolean(), submitAttempted: z.boolean() })
  .strict();
export const segmentPlacementSchema = z
  .object({ middle: placement, bottom: placement, crossedSegment: z.boolean() })
  .strict();
export type SegmentPlacementFunnel = z.infer<typeof segmentPlacementSchema>;
export function emptySegmentPlacements(): SegmentPlacementFunnel {
  return {
    middle: { formVisible: false, formFocused: false, submitAttempted: false },
    bottom: { formVisible: false, formFocused: false, submitAttempted: false },
    crossedSegment: false,
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
