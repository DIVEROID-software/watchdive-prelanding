// Pure aggregate helper. No database calls, customer identifiers, or decision authority.
import {
  parseBehaviorSections,
  parseLeadExperiment,
  FIELD_CONVERSION_EXPERIMENT,
  EXPERIMENT_MATURITY_MS,
  unionFunnels,
  type ExperimentFunnel,
} from "../conversionExperimentContract.ts";
import {
  SEGMENT_MEASUREMENT_ID,
  SEGMENT_NAMES,
  SEGMENT_PLACEMENTS,
  emptySegmentPlacements,
  type SegmentMeasurementContext,
  type SegmentPlacementFunnel,
} from "./measurementContract.ts";
import type { ReportPages } from "../experimentReport.ts";
import {
  conversionBlocked,
  FIELD_MEASUREMENT_CONSENT,
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_WITHDRAWN,
  FLAG_MEASUREMENT_WITHDRAWN,
  FIELD_SUSPECT,
  FIELD_SIGNED_UP,
  FIELD_VERIFIED_AT,
  FIELD_EMAIL_VERIFIED,
  FIELD_VERIFICATION_STATUS,
  STATUS_VERIFIED,
} from "../verification/contracts.ts";

function text(p: unknown, field = "rich_text"): string {
  const parts = (
    p as Record<string, Array<{ plain_text?: string; text?: { content?: string } }>> | undefined
  )?.[field];
  return (parts ?? []).map((v) => v.plain_text ?? v.text?.content ?? "").join("");
}
function checked(p: unknown) {
  return (p as { checkbox?: boolean } | undefined)?.checkbox === true;
}
function date(p: unknown): number | null {
  const value = (p as { date?: { start?: string } } | undefined)?.date?.start;
  const n = value ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? n : null;
}
function flags(p: unknown): string[] {
  return ((p as { multi_select?: { name?: string }[] } | undefined)?.multi_select ?? []).map(
    (v) => v.name ?? "",
  );
}
function canonical(p: Record<string, unknown>): string {
  const v = p["Canonical email"] as { email?: string } | undefined;
  return (v?.email || text(p["Canonical email"]) || text(p.Email, "title")).trim().toLowerCase();
}
function mergePlacement(into: SegmentPlacementFunnel, from?: SegmentPlacementFunnel) {
  if (!from) return;
  for (const place of SEGMENT_PLACEMENTS)
    for (const flag of ["formVisible", "formFocused", "submitAttempted"] as const)
      into[place][flag] ||= from[place][flag];
  into.crossedSegment ||= from.crossedSegment;
}
function empty() {
  return {
    sessions: 0,
    matureSessions: 0,
    signupSessions: 0,
    verifiedSessions: 0,
    matureSignupSessions: 0,
    matureVerifiedSessions: 0,
    crossedSessions: 0,
    placements: {
      middle: { formVisible: 0, formFocused: 0, submitAttempted: 0 },
      bottom: { formVisible: 0, formFocused: 0, submitAttempted: 0 },
    },
  };
}
/** Caller must supply a fully paginated, declared source read; old legacy lead query
 * filters by its own ID and therefore cannot feed this report. Rates remain descriptive. */
export function buildSegmentMeasurementReport(
  input: ReportPages & {
    exposureFrom: number;
    exposureTo: number;
    device?: SegmentMeasurementContext["device"];
  },
) {
  if (
    !Number.isFinite(input.now) ||
    !Number.isFinite(input.exposureFrom) ||
    !Number.isFinite(input.exposureTo) ||
    input.exposureFrom >= input.exposureTo ||
    input.exposureTo > input.now
  )
    throw new Error("Invalid segment cohort window");
  const behaviorOk = input.behavior.availability === "ok" && !input.behavior.truncated;
  const leadsOk =
    behaviorOk &&
    input.leads.availability === "ok" &&
    input.leads.column === "present" &&
    !input.leads.truncated;
  const quality = {
    malformedBehaviorRows: 0,
    missingContextRows: 0,
    malformedLeadRows: 0,
    inconsistentSessions: 0,
    qaExcluded: 0,
    noExposure: 0,
    placementMissingSessions: 0,
    placementGaps: 0,
    duplicateLeadRows: 0,
    excludedLeadGroups: 0,
    unmatchedLeads: 0,
    mismatchedLeads: 0,
    invalidOrLateSignup: 0,
    invalidOrLateVerification: 0,
  };
  type Session = {
    context: SegmentMeasurementContext;
    rows: ExperimentFunnel[];
    placements: SegmentPlacementFunnel;
    hasPlacements: boolean;
    invalid: boolean;
    signup: boolean;
    verified: boolean;
  };
  const sessions = new Map<string, Session>();
  const malformedSessions = new Set<string>();
  if (behaviorOk)
    for (const row of input.behavior.pages) {
      const p = row.properties ?? {};
      const parsed = parseBehaviorSections(text(p.Sections));
      if (!parsed.context) {
        if (parsed.malformed) quality.malformedBehaviorRows++;
        else quality.missingContextRows++;
        continue;
      }
      const ctx = parsed.context;
      if (ctx.experimentId !== SEGMENT_MEASUREMENT_ID) continue;
      const key = ctx.sessionId.toLowerCase();
      if (text(p.Name, "title").toLowerCase() !== key || ctx.assignedAt > input.now) {
        quality.malformedBehaviorRows++;
        const prior = sessions.get(key);
        if (prior) prior.invalid = true;
        malformedSessions.add(key);
        continue;
      }
      const previous = sessions.get(key);
      if (previous) {
        if (JSON.stringify(previous.context) !== JSON.stringify(ctx)) previous.invalid = true;
        if (parsed.funnel) previous.rows.push(parsed.funnel);
        previous.hasPlacements ||= Boolean(parsed.funnel?.placements);
        mergePlacement(previous.placements, parsed.funnel?.placements);
      } else {
        const placements = emptySegmentPlacements();
        mergePlacement(placements, parsed.funnel?.placements);
        sessions.set(key, {
          context: ctx,
          rows: parsed.funnel ? [parsed.funnel] : [],
          placements,
          hasPlacements: Boolean(parsed.funnel?.placements),
          invalid: false,
          signup: false,
          verified: false,
        });
      }
    }
  // Canonical groups are internal only, including contextless rows so a withdrawal
  // or prior signup cannot be bypassed by a later duplicate with fresh context.
  const groups = new Map<string, Record<string, unknown>[]>();
  if (leadsOk)
    for (const row of input.leads.pages) {
      const p = row.properties ?? {},
        key = canonical(p);
      if (!key) {
        quality.malformedLeadRows++;
        continue;
      }
      const group = groups.get(key) ?? [];
      group.push(p);
      groups.set(key, group);
    }
  for (const rows of groups.values()) {
    quality.duplicateLeadRows += rows.length - 1;
    if (
      rows.some(
        (p) =>
          checked(p[FIELD_SUSPECT]) ||
          checked(p.Duplicate) ||
          conversionBlocked(flags(p.Flags)) ||
          flags(p.Flags).includes(FLAG_MEASUREMENT_WITHDRAWN) ||
          text(p[FIELD_MEASUREMENT_CONSENT]) === MEASUREMENT_CONSENT_WITHDRAWN,
      )
    ) {
      quality.excludedLeadGroups++;
      continue;
    }
    if (rows.some((p) => date(p[FIELD_SIGNED_UP]) === null)) {
      quality.malformedLeadRows++;
      continue;
    }
    rows.sort((a, b) => date(a[FIELD_SIGNED_UP])! - date(b[FIELD_SIGNED_UP])!);
    const first = rows[0],
      signed = date(first[FIELD_SIGNED_UP])!;
    const parsed = parseLeadExperiment(text(first[FIELD_CONVERSION_EXPERIMENT]));
    if (!parsed.context) {
      if (parsed.malformed) quality.malformedLeadRows++;
      else quality.missingContextRows++;
      continue;
    }
    const ctx = parsed.context;
    if (ctx.experimentId !== SEGMENT_MEASUREMENT_ID || ctx.qa) continue;
    if (text(first[FIELD_MEASUREMENT_CONSENT]) !== MEASUREMENT_CONSENT_GRANTED) {
      quality.excludedLeadGroups++;
      continue;
    }
    const session = sessions.get(ctx.sessionId.toLowerCase());
    if (
      !session ||
      session.invalid ||
      malformedSessions.has(ctx.sessionId.toLowerCase()) ||
      !unionFunnels(session.rows).exposed
    ) {
      quality.unmatchedLeads++;
      continue;
    }
    if (JSON.stringify(session.context) !== JSON.stringify(ctx)) {
      quality.mismatchedLeads++;
      continue;
    }
    if (
      signed < ctx.assignedAt ||
      signed > input.now ||
      signed - ctx.assignedAt > EXPERIMENT_MATURITY_MS
    ) {
      quality.invalidOrLateSignup++;
      continue;
    }
    session.signup = true;
    for (const row of rows) {
      const at = date(row[FIELD_VERIFIED_AT]);
      const verified =
        checked(row[FIELD_EMAIL_VERIFIED]) ||
        (row[FIELD_VERIFICATION_STATUS] as { select?: { name?: string } } | undefined)?.select
          ?.name === STATUS_VERIFIED;
      if (!verified) continue;
      if (
        at === null ||
        at < signed ||
        at > input.now ||
        at - ctx.assignedAt > EXPERIMENT_MATURITY_MS
      ) {
        quality.invalidOrLateVerification++;
        continue;
      }
      session.verified = true;
    }
  }
  const counts = { freediving: empty(), scuba: empty() };
  for (const session of sessions.values()) {
    const ctx = session.context;
    if (session.invalid || malformedSessions.has(ctx.sessionId.toLowerCase())) {
      quality.inconsistentSessions++;
      continue;
    }
    if (ctx.qa) {
      quality.qaExcluded++;
      continue;
    }
    if (!unionFunnels(session.rows).exposed) {
      quality.noExposure++;
      continue;
    }
    if (
      ctx.assignedAt < input.exposureFrom ||
      ctx.assignedAt >= input.exposureTo ||
      (input.device && input.device !== ctx.device)
    )
      continue;
    const b = counts[ctx.entrySegment],
      mature = input.now - ctx.assignedAt >= EXPERIMENT_MATURITY_MS;
    b.sessions++;
    if (mature) b.matureSessions++;
    if (session.signup) {
      b.signupSessions++;
      if (mature) b.matureSignupSessions++;
    }
    if (session.verified) {
      b.verifiedSessions++;
      if (mature) b.matureVerifiedSessions++;
    }
    if (session.placements.crossedSegment) b.crossedSessions++;
    if (!session.hasPlacements) quality.placementMissingSessions++;
    for (const place of SEGMENT_PLACEMENTS) {
      const f = session.placements[place];
      if ((f.formFocused && !f.formVisible) || (f.submitAttempted && !f.formFocused))
        quality.placementGaps++;
      for (const flag of ["formVisible", "formFocused", "submitAttempted"] as const)
        if (f[flag]) b.placements[place][flag]++;
    }
  }
  const bySegment = Object.fromEntries(
    SEGMENT_NAMES.map((segment) => {
      const b = counts[segment];
      return [
        segment,
        {
          sessions: behaviorOk ? b.sessions : null,
          matureSessions: behaviorOk ? b.matureSessions : null,
          signupSessions: leadsOk ? b.signupSessions : null,
          verifiedSessions: leadsOk ? b.verifiedSessions : null,
          matureSignupSessions: leadsOk ? b.matureSignupSessions : null,
          matureVerifiedSessions: leadsOk ? b.matureVerifiedSessions : null,
          crossedSessions: behaviorOk ? b.crossedSessions : null,
          placements: behaviorOk ? b.placements : null,
          matureSignupRate:
            leadsOk && b.matureSessions > 0 ? b.matureSignupSessions / b.matureSessions : null,
          matureVerifiedRate:
            leadsOk && b.matureSessions > 0 ? b.matureVerifiedSessions / b.matureSessions : null,
        },
      ];
    }),
  );
  return {
    experimentId: SEGMENT_MEASUREMENT_ID,
    generatedAt: new Date(input.now).toISOString(),
    cohort: {
      from: new Date(input.exposureFrom).toISOString(),
      toExclusive: new Date(input.exposureTo).toISOString(),
      device: input.device ?? "all",
      maturityMs: EXPERIMENT_MATURITY_MS,
    },
    complete: leadsOk,
    partial: !leadsOk,
    coverage: {
      allVisitors: null,
      consentCoverage: null,
      contextPersistence: "unknown",
      sourceReadComplete: leadsOk,
      decisionReady: false,
    },
    caveats: [
      "Descriptive consented-session cohort, not all visitors or a randomized audience comparison.",
      "Complete means supplied reads are complete, not that all leads retained optional measurement context.",
      "The caller must supply complete relevant canonical history, including contextless prior/withdrawn rows; an ID-only query cannot establish canonical-history coverage.",
      "Freeze entry segment for disjoint counts; placement counts may overlap. Timestamp skew is not forgiven in this new cohort.",
      "Withdrawal removes conversion context; previously stored exposure remains. Existing customer rows are not new acquisitions.",
      "No deployment, paid test, causal winner, purchase intent or 8% guarantee follows from this helper.",
    ],
    quality,
    bySegment,
  };
}
