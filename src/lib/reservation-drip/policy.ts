import { parseReservationMarker } from "../reservation-mail/campaign.ts";
import { parseVerifiedInstant } from "../reservation-mail/schedule.ts";

export const DRIP_CAMPAIGN = "wd-reservation-drip-v1";
export const DRIP_STAGES = ["d0", "d1", "d3", "d7"] as const;
export type DripStage = (typeof DRIP_STAGES)[number];
export const DAY = 86_400_000;
export const DRIP_DELAY: Record<DripStage, number> = { d0: 180_000, d1: DAY, d3: 3 * DAY, d7: 7 * DAY };
export const DRIP_FIELD: Record<DripStage, string> = {
  d0: "Reservation mail", d1: "Reservation D1 mail", d3: "Reservation D3 mail", d7: "Reservation D7 mail",
};
/** Additive schema proposal; no migration is run by this module or sender. */
export const DRIP_SCHEMA_PLAN = Object.fromEntries(DRIP_STAGES.slice(1).map(stage => [DRIP_FIELD[stage], { rich_text: {} }]));
export type DripHistory = Partial<Record<DripStage, string>>;

/** Sequence clock starts at verification, preserving the approved D0 +3m rule.
 * A delayed previous send never causes a burst of catch-up messages. */
export function dripHold(stage: DripStage, history: DripHistory, nowMs: number): string | null {
  if (!Number.isFinite(nowMs)) return "invalid_clock";
  for (const value of Object.values(history)) {
    const marker = parseReservationMarker(value);
    if (["unsubscribed", "unknown", "hold", "failed"].includes(marker.kind)) return "history_held";
  }
  const index = DRIP_STAGES.indexOf(stage);
  if (index < 0) return "invalid_stage";
  for (let n = 0; n < index; n++) {
    const previous = parseReservationMarker(history[DRIP_STAGES[n]]);
    if (previous.kind !== "sent" || !previous.at) return "previous_not_sent";
    const instant = parseVerifiedInstant(previous.at);
    if (!instant.ok || instant.ms > nowMs) return "previous_time_invalid";
    if (n === index - 1 && nowMs - instant.ms < DAY) return "minimum_gap";
  }
  return null;
}

export function dripEnabled(env: Record<string, string | undefined>, copyHash: string): boolean {
  return env.WATCHDIVE_RESERVATION_DRIP_ENABLED === "true" &&
    env.WATCHDIVE_RESERVATION_DRIP_APPROVED_COPY_SHA256 === copyHash &&
    env.WATCHDIVE_RESERVATION_DRIP_LEGACY_JOB_DISABLED === "true";
}
