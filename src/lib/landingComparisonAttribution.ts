import type { Attribution } from "./attribution.ts";
import { landingVariantFromPathname, segmentFromPathname } from "./segments/navigation.ts";
import {
  landingComparisonRegistry,
  type LandingComparisonRun,
} from "./landingComparisonRegistry.ts";

type Tuple = {
  utmCampaign?: unknown;
  utmTerm?: unknown;
  utmContent?: unknown;
  landingPath?: unknown;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const ID = /^[1-9][0-9]{5,31}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
export const LANDING_COMPARISON_STORAGE_PREFIX = "wd_landing_comparison_attr_v1:";
const FIELDS = [
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "landingPath",
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "ttclid",
] as const;
const time = (value: string) =>
  typeof value === "string" && ISO.test(value) ? Date.parse(value) : NaN;
const id = (value: unknown): value is string => typeof value === "string" && ID.test(value);

/** Fail closed for malformed, duplicate, reused or ambiguous operator mappings. */
export function validLandingComparisonRegistry(registry: readonly LandingComparisonRun[]): boolean {
  if (!Array.isArray(registry)) return false;
  const phases = new Set<string>(),
    allIds = new Set<string>();
  for (const run of registry) {
    if (
      !run ||
      !LABEL.test(run.phaseId) ||
      phases.has(run.phaseId) ||
      !id(run.campaignId) ||
      allIds.has(run.campaignId)
    )
      return false;
    const capture = time(run.captureStartsAt),
      start = time(run.signupStartsAt),
      captureEnd = time(run.captureEndsAt),
      end = time(run.signupEndsAt);
    if (
      ![capture, start, captureEnd, end].every(Number.isFinite) ||
      !(capture <= start && start < captureEnd && captureEnd <= end)
    )
      return false;
    phases.add(run.phaseId);
    allIds.add(run.campaignId);
    if (!Array.isArray(run.arms) || run.arms.length !== 2) return false;
    const arms = new Set<string>();
    for (const arm of run.arms) {
      if (
        !arm ||
        !["control", "launch"].includes(arm.arm) ||
        arms.has(arm.arm) ||
        !id(arm.adsetId) ||
        allIds.has(arm.adsetId) ||
        !Array.isArray(arm.adIds) ||
        !arm.adIds.length
      )
        return false;
      arms.add(arm.arm);
      allIds.add(arm.adsetId);
      for (const ad of arm.adIds) {
        if (!id(ad) || allIds.has(ad)) return false;
        allIds.add(ad);
      }
    }
  }
  return true;
}

export function isLandingComparisonAttempt(
  raw: Tuple,
  registry: readonly LandingComparisonRun[] = landingComparisonRegistry,
): boolean {
  return (
    Array.isArray(registry) &&
    registry.some(
      (run) =>
        run &&
        (raw.utmCampaign === run.campaignId ||
          (Array.isArray(run.arms) &&
            run.arms.some(
              (arm: LandingComparisonRun["arms"][number]) =>
                arm &&
                (raw.utmTerm === arm.adsetId ||
                  (Array.isArray(arm.adIds) && arm.adIds.includes(raw.utmContent as string))),
            ))),
    )
  );
}

/** This validates attribution only; it grants no signup, authentication or conversion authority. */
export function matchLandingComparison(
  raw: Tuple,
  now: number,
  registry: readonly LandingComparisonRun[] = landingComparisonRegistry,
  window: "capture" | "signup" = "capture",
) {
  if (
    !validLandingComparisonRegistry(registry) ||
    !Number.isFinite(now) ||
    !id(raw.utmCampaign) ||
    !id(raw.utmTerm) ||
    !id(raw.utmContent)
  )
    return;
  const matches = registry.flatMap((run) =>
    run.campaignId === raw.utmCampaign &&
    time(run.captureStartsAt) <= now &&
    now < time(window === "capture" ? run.captureEndsAt : run.signupEndsAt)
      ? run.arms
          .filter(
            (arm) => arm.adsetId === raw.utmTerm && arm.adIds.includes(raw.utmContent as string),
          )
          .map((arm) => ({ run, arm }))
      : [],
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function acceptsLandingComparisonCapture(
  raw: Tuple,
  now: number,
  registry: readonly LandingComparisonRun[] = landingComparisonRegistry,
): boolean {
  const match = matchLandingComparison(raw, now, registry);
  return Boolean(
    match &&
    typeof raw.landingPath === "string" &&
    segmentFromPathname(raw.landingPath) &&
    landingVariantFromPathname(raw.landingPath) === match.arm.arm,
  );
}

/** Server signup sanitization retains an exact tuple during the delayed-signup
 * window. This is attribution, not proof of exposure: the report must join the
 * earlier measured visit and never infer a pre-end click from these fields. */
export function acceptsLandingComparisonSignupAttribution(
  raw: Tuple,
  now: number,
  registry: readonly LandingComparisonRun[] = landingComparisonRegistry,
): boolean {
  const match = matchLandingComparison(raw, now, registry, "signup");
  return Boolean(
    match &&
    typeof raw.landingPath === "string" &&
    segmentFromPathname(raw.landingPath) &&
    landingVariantFromPathname(raw.landingPath) === match.arm.arm,
  );
}

export function landingComparisonStorageKey(run: LandingComparisonRun): string {
  return `${LANDING_COMPARISON_STORAGE_PREFIX}${run.phaseId}`;
}

function cleanStored(raw: unknown): Attribution | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const record = raw as Record<string, unknown>,
    out: Attribution = {};
  for (const field of FIELDS)
    if (typeof record[field] === "string") out[field] = record[field].slice(0, 255);
  if (typeof record.capturedAt === "number" && Number.isFinite(record.capturedAt))
    out.capturedAt = record.capturedAt;
  return out;
}

function savedTouch(
  run: LandingComparisonRun,
  now: number,
  registry: readonly LandingComparisonRun[],
  storage?: Storage,
): Attribution | undefined {
  try {
    const raw = JSON.parse(storage?.getItem(landingComparisonStorageKey(run)) ?? "null");
    if (
      !raw ||
      raw.version !== 1 ||
      raw.phaseId !== run.phaseId ||
      !Number.isSafeInteger(raw.firstTouchAt) ||
      raw.firstTouchAt < time(run.captureStartsAt) ||
      raw.firstTouchAt > now ||
      raw.firstTouchAt >= time(run.captureEndsAt) ||
      now >= time(run.signupEndsAt)
    )
      return;
    const attr = cleanStored(raw.attribution);
    if (
      !attr ||
      attr.utmCampaign !== run.campaignId ||
      !acceptsLandingComparisonCapture(attr, raw.firstTouchAt, registry) ||
      !acceptsLandingComparisonSignupAttribution(attr, now, registry)
    )
      return;
    return attr;
  } catch {
    /* Optional storage cannot block signup. */
  }
}

/** New run starts its own first touch rather than inheriting an unrelated old wd_attr.
 * An untagged segment/language navigation reuses that run only inside its approved window.
 * Known bad tuples fail closed; unrelated campaigns retain their existing behavior. */
export function resolveLandingComparisonAttribution(input: {
  incoming: Attribution;
  rawTuple: Tuple;
  now: number;
  registry?: readonly LandingComparisonRun[];
  storage?: Storage;
}): { kind: "none" | "rejected" } | { kind: "comparison"; attribution: Attribution } {
  const registry = input.registry ?? landingComparisonRegistry;
  const { incoming, rawTuple, now, storage } = input;
  const attempt =
    isLandingComparisonAttempt(rawTuple, registry) ||
    isLandingComparisonAttempt(incoming, registry);
  if (!validLandingComparisonRegistry(registry)) return { kind: attempt ? "rejected" : "none" };
  const match = matchLandingComparison(rawTuple, now, registry, "signup");
  if (attempt) {
    if (
      !match ||
      !acceptsLandingComparisonSignupAttribution(
        { ...rawTuple, landingPath: incoming.landingPath },
        now,
        registry,
      )
    )
      return { kind: "rejected" };
    const saved = savedTouch(match.run, now, registry, storage);
    if (saved) return { kind: "comparison", attribution: saved };
    // A late form can reuse an earlier first touch, but cannot invent a new visit.
    if (
      !acceptsLandingComparisonCapture(
        { ...rawTuple, landingPath: incoming.landingPath },
        now,
        registry,
      )
    )
      return { kind: "rejected" };
    try {
      storage?.setItem(
        landingComparisonStorageKey(match.run),
        JSON.stringify({
          version: 1,
          phaseId: match.run.phaseId,
          firstTouchAt: now,
          attribution: incoming,
        }),
      );
    } catch {
      /* Current URL remains usable in restricted webviews. */
    }
    return { kind: "comparison", attribution: incoming };
  }
  // Never let a comparison from storage steal a later unrelated campaign click.
  if (
    incoming.utmCampaign ||
    incoming.utmTerm ||
    incoming.utmContent ||
    incoming.utmSource ||
    incoming.utmMedium
  )
    return { kind: "none" };
  const saved = registry
    .map((run) => savedTouch(run, now, registry, storage))
    .filter((value): value is Attribution => Boolean(value));
  return saved.length === 1 ? { kind: "comparison", attribution: saved[0] } : { kind: "none" };
}
