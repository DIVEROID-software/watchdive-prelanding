import { createHash } from "node:crypto";
import { RESERVATION_COPY } from "../reservation-mail/copy.ts";
import { RESERVATION_PRESENTATION } from "../../components/reservation/presentation.ts";
import { renderMarketingMail, renderReservationMail, renderSegmentedReservationMail, type ReservationMailInput } from "../reservation-mail/render.ts";
import { DRIP_COPY } from "./copy.ts";
import { SEGMENT_MEDIA_MANIFEST } from "./media.ts";
import { PERSONALIZED_COPY } from "./personalized-copy.ts";
import type { DripStage } from "./policy.ts";

export const DRIP_COPY_HASH = createHash("sha256").update(JSON.stringify({
  version: 2,
  base: RESERVATION_COPY,
  presentation: RESERVATION_PRESENTATION,
  drafts: DRIP_COPY,
  personalized: PERSONALIZED_COPY,
  media: SEGMENT_MEDIA_MANIFEST,
})).digest("hex");

export function renderDripMail(stage: DripStage, input: ReservationMailInput) {
  // D0 stays on renderReservationMail. The provider key is per lead, not a body hash.
  // A segment selects the new stage; omitting it keeps the legacy underwater invite.
  if (input.segment) {
    if (stage === "d0") return renderReservationMail(input);
    return renderSegmentedReservationMail(input, stage);
  }
  if (stage === "d0") return renderReservationMail(input);
  const draft = DRIP_COPY[input.locale][stage];
  const base = RESERVATION_COPY[input.locale];
  return renderMarketingMail(input, {
    subject: draft.subject,
    preheader: draft.preheader,
    headline: draft.headline,
    sentence1: draft.sentence1,
    sentence2: draft.sentence2,
    feeNote: base.feeNote,
    cta: base.button,
  });
}
