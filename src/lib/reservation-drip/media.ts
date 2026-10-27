// Segmented reservation-mail media. Root supplies the files. This module only
// names them. GIFs are D0 for every segment, plus freediving D7.
// The segment union is owned by reservation-mail/segment.ts.
import type { DripStage } from "./policy.ts";
import {
  RESERVATION_EMAIL_SEGMENTS,
  isReservationEmailSegment,
  type ReservationEmailSegment,
} from "../reservation-mail/segment.ts";

export { RESERVATION_EMAIL_SEGMENTS, isReservationEmailSegment, type ReservationEmailSegment };

export const STAGE_LAYOUT = {
  d0: "welcome",
  d1: "proof",
  d3: "urgency",
  d7: "assurance",
} as const;
export type StageLayout = (typeof STAGE_LAYOUT)[DripStage];

/** Public path on the invite origin. Extension follows the root asset list. */
export function segmentedHeroPath(segment: ReservationEmailSegment, stage: DripStage): string {
  const gif = stage === "d0" || (stage === "d7" && segment === "freediving");
  return `/brand/reservation/segmented/${segment}-${stage}.${gif ? "gif" : "jpg"}`;
}

export const SEGMENT_MEDIA_MANIFEST: readonly string[] = RESERVATION_EMAIL_SEGMENTS.flatMap((segment) =>
  (["d0", "d1", "d3", "d7"] as const).map((stage) => segmentedHeroPath(segment, stage)),
);

/** Preview only. Production HTML keeps the invite origin. Checkout links are not brand paths. */
export const PREVIEW_ASSET_ORIGIN = "http://127.0.0.1:5195";

export function rewritePreviewAssetUrls(html: string): string {
  return html.replace(
    /https:\/\/[^/"'\s]+(\/brand\/reservation\/[^"'\s]+)/g,
    `${PREVIEW_ASSET_ORIGIN}$1`,
  );
}
