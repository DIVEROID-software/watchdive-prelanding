import type { Attribution } from "./attribution.ts";
import type { CompetitionAd, CompetitionRound } from "./competitionRegistry.ts";

type Tuple = {
  utmCampaign?: unknown;
  utmTerm?: unknown;
  utmContent?: unknown;
  capturedAt?: unknown;
};
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
type Match = { round: CompetitionRound; ad: CompetitionAd };

const ID = /^\d{1,30}$/;
const LABEL = /^[A-Za-z0-9._-]{1,100}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_ROUND_MS = 72 * 60 * 60 * 1000;
const ATTRIBUTION_FIELDS = [
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "utmTerm",
  "landingPath",
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "ttclid",
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numericId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function timestamp(value: string): number {
  return typeof value === "string" && ISO_UTC.test(value) ? Date.parse(value) : NaN;
}

/** Invalid/ambiguous operator configuration fails closed for its known IDs. */
function validRound(round: CompetitionRound): boolean {
  const capture = timestamp(round.captureStartsAt);
  const start = timestamp(round.signupStartsAt);
  const end = timestamp(round.signupEndsAt);
  if (
    !LABEL.test(round.experimentId) ||
    !LABEL.test(round.roundId) ||
    !numericId(round.campaignId) ||
    !Number.isFinite(capture) ||
    !(capture <= start && start < end && end - start <= MAX_ROUND_MS) ||
    !Array.isArray(round.ads) ||
    round.ads.length === 0
  )
    return false;
  const ids = new Set<string>();
  const adsets = new Map<string, string>();
  const arms = new Map<string, string>();
  return round.ads.every((ad) => {
    if (
      !numericId(ad.adId) ||
      !numericId(ad.adsetId) ||
      !["A", "B", "C"].includes(ad.armId) ||
      !LABEL.test(ad.strategyVersion) ||
      ids.has(ad.adId) ||
      (adsets.has(ad.adsetId) && adsets.get(ad.adsetId) !== ad.armId) ||
      (arms.has(ad.armId) && arms.get(ad.armId) !== ad.adsetId)
    )
      return false;
    ids.add(ad.adId);
    adsets.set(ad.adsetId, ad.armId);
    arms.set(ad.armId, ad.adsetId);
    return true;
  });
}

export function competitionStorageKey(round: CompetitionRound): string {
  return `wd_competition_attr_v1:${round.experimentId}:${round.roundId}`;
}

/** Any known component identifies a competition attempt, even a wrong tuple. */
export function isCompetitionAttempt(raw: Tuple, registry: readonly CompetitionRound[]): boolean {
  return registry.some(
    (round) =>
      raw.utmCampaign === round.campaignId ||
      round.ads.some((ad) => raw.utmTerm === ad.adsetId || raw.utmContent === ad.adId),
  );
}

function activeRounds(registry: readonly CompetitionRound[], now: number): CompetitionRound[] {
  if (!Number.isFinite(now)) return [];
  return registry.filter(
    (round) =>
      validRound(round) &&
      registry.filter(
        (other) => other.experimentId === round.experimentId && other.roundId === round.roundId,
      ).length === 1 &&
      timestamp(round.captureStartsAt) <= now &&
      now < timestamp(round.signupEndsAt),
  );
}

function tupleMatch(raw: Tuple, rounds: readonly CompetitionRound[]): Match | undefined {
  if (!numericId(raw.utmCampaign) || !numericId(raw.utmTerm) || !numericId(raw.utmContent)) return;
  const matches = rounds.flatMap((round) =>
    round.campaignId === raw.utmCampaign
      ? round.ads
          .filter((ad) => ad.adsetId === raw.utmTerm && ad.adId === raw.utmContent)
          .map((ad) => ({ round, ad }))
      : [],
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function onlyAttribution(raw: Record<string, unknown>): Attribution {
  const clean: Attribution = {};
  for (const field of ATTRIBUTION_FIELDS) {
    if (typeof raw[field] === "string") clean[field] = raw[field].slice(0, 255);
  }
  if (typeof raw.capturedAt === "number" && Number.isFinite(raw.capturedAt)) {
    clean.capturedAt = raw.capturedAt;
  }
  return clean;
}

function storedTouch(
  storage: Storage | undefined,
  round: CompetitionRound,
  now: number,
): Attribution | undefined {
  try {
    const text = storage?.getItem(competitionStorageKey(round));
    const raw: unknown = text ? JSON.parse(text) : null;
    if (
      !record(raw) ||
      raw.version !== 1 ||
      raw.experimentId !== round.experimentId ||
      raw.roundId !== round.roundId ||
      !record(raw.attribution) ||
      typeof raw.firstTouchAt !== "number" ||
      !Number.isFinite(raw.firstTouchAt) ||
      raw.firstTouchAt < timestamp(round.captureStartsAt) ||
      raw.firstTouchAt > now ||
      raw.firstTouchAt >= timestamp(round.signupEndsAt)
    )
      return;
    const match = tupleMatch(raw.attribution, [round]);
    if (!match || raw.armId !== match.ad.armId || raw.strategyVersion !== match.ad.strategyVersion)
      return;
    // Click timestamps cannot date a different or future touch.
    if (raw.attribution.capturedAt !== undefined && raw.attribution.capturedAt !== raw.firstTouchAt)
      return;
    return onlyAttribution(raw.attribution);
  } catch {
    return;
  }
}

export type CompetitionResolution =
  { kind: "legacy" } | { kind: "rejected" } | { kind: "competition"; attribution: Attribution };

/**
 * First eligible touch per experiment/round on this browser only. rawTuple is
 * checked BEFORE sanitization: stripping punctuation must not manufacture IDs.
 * Blank navigation and later arms retain the first valid scoped touch. This
 * storage is untrusted, not proof of a real ad click or cross-device identity.
 */
export function resolveCompetitionAttribution(options: {
  incoming: Attribution;
  rawTuple: Tuple;
  now: number;
  registry: readonly CompetitionRound[];
  storage?: Storage;
}): CompetitionResolution {
  const { incoming, rawTuple, now, registry, storage } = options;
  const rounds = activeRounds(registry, now);
  const match = tupleMatch(rawTuple, rounds);
  const touches = rounds.flatMap((round) => {
    const attribution = storedTouch(storage, round, now);
    return attribution ? [{ round, attribution }] : [];
  });
  if (match) {
    const previous = touches.find((touch) => touch.round === match.round);
    if (previous) return { kind: "competition", attribution: previous.attribution };
    const attribution = onlyAttribution(incoming);
    // Copy exact verified IDs, never the potentially sanitized incoming values.
    attribution.utmCampaign = match.round.campaignId;
    attribution.utmTerm = match.ad.adsetId;
    attribution.utmContent = match.ad.adId;
    if (attribution.capturedAt !== undefined) attribution.capturedAt = now;
    try {
      storage?.setItem(
        competitionStorageKey(match.round),
        JSON.stringify({
          version: 1,
          experimentId: match.round.experimentId,
          roundId: match.round.roundId,
          armId: match.ad.armId,
          strategyVersion: match.ad.strategyVersion,
          firstTouchAt: now,
          attribution,
        }),
      );
    } catch {
      /* Current valid URL still works when storage is unavailable. */
    }
    return { kind: "competition", attribution };
  }
  if (touches.length === 1) return { kind: "competition", attribution: touches[0].attribution };
  if (touches.length > 1 || isCompetitionAttempt(rawTuple, registry)) return { kind: "rejected" };
  return { kind: "legacy" };
}

/** Server capture validation also permits explicitly configured prelaunch QA. */
export function acceptsCompetitionCapture(
  raw: Tuple,
  now: number,
  registry: readonly CompetitionRound[],
): boolean {
  const match = tupleMatch(raw, activeRounds(registry, now));
  return Boolean(
    match &&
    (raw.capturedAt === undefined ||
      (typeof raw.capturedAt === "number" &&
        Number.isSafeInteger(raw.capturedAt) &&
        timestamp(match.round.captureStartsAt) <= raw.capturedAt &&
        raw.capturedAt <= now)),
  );
}

/** Strict cohort eligibility; verification grace never extends this window. */
export function acceptsCompetitionSignup(
  raw: Tuple,
  now: number,
  registry: readonly CompetitionRound[],
): boolean {
  const rounds = activeRounds(registry, now).filter(
    (round) => timestamp(round.signupStartsAt) <= now,
  );
  return acceptsCompetitionCapture(raw, now, registry) && Boolean(tupleMatch(raw, rounds));
}
