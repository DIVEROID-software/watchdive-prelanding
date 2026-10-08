// Read-only aggregates for the form-first experiment.
//
// The visit denominator is a consented exposure session. Withdrawing measurement
// clears the lead's experiment cell and removes that lead from conversion
// counts. It does not delete the exposure, and a later grant does not backfill
// a session that was never stored. No email, session id, page id, or click id
// is placed on the returned object.
import { createHash, timingSafeEqual } from "node:crypto";

import { createBehaviorNotion } from "./api/behaviorNotion.ts";
import {
  EXPERIMENT_ID,
  EXPERIMENT_MATURITY_MS,
  EXPERIMENT_SECTION_MARKER,
  EXPERIMENT_TEAMS,
  EXPERIMENT_VARIANTS,
  FIELD_CONVERSION_EXPERIMENT,
  milestoneGap,
  monotonicFunnel,
  parseBehaviorSections,
  parseLeadExperiment,
  unionFunnels,
  type ExperimentContext,
  type ExperimentFunnel,
} from "./conversionExperimentContract.ts";
import {
  conversionBlocked,
  FIELD_EMAIL_VERIFIED,
  FIELD_MEASUREMENT_CONSENT,
  FIELD_SIGNED_UP,
  FIELD_SUSPECT,
  FIELD_VERIFICATION_STATUS,
  FIELD_VERIFIED_AT,
  FLAG_MEASUREMENT_WITHDRAWN,
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_WITHDRAWN,
  STATUS_VERIFIED,
} from "./verification/contracts.ts";
import { createNotionRequest, NotionRequestError, type NotionRequest } from "./verification/notionLead.ts";

export const EXPERIMENT_REPORT_TOKEN_MIN = 32;
export const EXPERIMENT_REPORT_MAX_PAGES = 40;
const PAGE_SIZE = 100;
const ASSIGNED_AT_MIN = Date.parse("2026-10-01T00:00:00.000Z");
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const FUTURE_SKEW_MS = 10 * 60 * 1000;

const BEHAVIOR_COUNT_KEYS = [
  "sessions",
  "exposed",
  "formVisible",
  "formFocused",
  "submitAttempted",
  "matureSessions",
] as const;

const LEAD_COUNT_KEYS = [
  "newEmails",
  "newEmailsWithin48h",
  "verifiedWithin48h",
  "matureNewEmailsWithin48h",
  "matureVerifiedWithin48h",
  "sessionsWithNewEmail",
  "sessionsWithVerifiedEmail",
  "matureSessionsWithNewEmail",
  "matureSessionsWithVerifiedEmail",
  "immatureSessionsWithNewEmail",
] as const;

const COUNT_KEYS = [...BEHAVIOR_COUNT_KEYS, ...LEAD_COUNT_KEYS] as const;

type CountKey = (typeof COUNT_KEYS)[number];
type Bucket = Record<CountKey, number>;
type Availability = "ok" | "unconfigured" | "unavailable";
type ColumnState = "present" | "missing" | "unknown";

export type FunnelCounts = Record<CountKey, number | null>;

export type FunnelRates = {
  formVisiblePerExposed: number | null;
  formFocusedPerExposed: number | null;
  submitAttemptedPerExposed: number | null;
  newEmailWithin48hPerAttempt: number | null;
  verifiedWithin48hPerNewEmail: number | null;
  matureVerifiedWithin48hPerMatureSession: number | null;
  /** Distinct sessions with a saved email, divided by eligible exposure sessions. */
  newEmailSessionsPerSession: number | null;
  verifiedEmailSessionsPerSession: number | null;
  matureNewEmailPerSession: number | null;
  matureVerifiedEmailPerSession: number | null;
  /** Descriptive. Immature sessions that saved an email, divided by immature exposure sessions. */
  savedEmailSessionsPerSession: number | null;
};

export type ExperimentReportCell = { counts: FunnelCounts; rates: FunnelRates };

export type ExperimentReport = {
  experimentId: typeof EXPERIMENT_ID;
  generatedAt: string;
  complete: boolean;
  partial: boolean;
  maturityMs: number;
  decision: { winner: null; ready: false; matureCohortAvailable: boolean; reason: string };
  caveats: string[];
  sources: {
    behavior: Availability;
    leads: Availability;
    conversionExperimentColumn: ColumnState;
  };
  quality: {
    inconsistentSessions: number;
    malformedBehaviorRows: number;
    malformedLeadRows: number;
    qaExcludedSessions: number;
    qaExcludedLeads: number;
    withdrawnExcluded: number;
    suspectExcluded: number;
    blockedExcluded: number;
    duplicateExcluded: number;
    unmatchedLeads: number;
    mismatchedLeads: number;
    contextWithoutExposure: number;
    consentMissing: number;
    eventsBeforeExposure: number;
    lateEvents: number;
    immatureSessions: number;
    milestoneGaps: number;
    futureTimestamps: number;
    verifiedBeforeSignup: number;
    behaviorPagesRead: number;
    leadPagesRead: number;
    behaviorTruncated: boolean;
    leadsTruncated: boolean;
  };
  byArm: Record<
    (typeof EXPERIMENT_VARIANTS)[number],
    { byTeam: Record<(typeof EXPERIMENT_TEAMS)[number], ExperimentReportCell>; total: ExperimentReportCell }
  >;
  total: ExperimentReportCell;
};

export type NotionPageLike = { properties?: Record<string, unknown> };

export type ReportPages = {
  now: number;
  behavior: { availability: Availability; pages: NotionPageLike[]; truncated: boolean };
  leads: {
    availability: Availability;
    column: ColumnState;
    pages: NotionPageLike[];
    truncated: boolean;
  };
};

const CAVEATS = [
  "The measured cohort is a consented landing exposure stored before the first submit. A later inbox consent does not enroll a visit that had no experiment context, and a saved email does not create an exposure.",
  "The visit denominator is those consented sessions with an explicit exposed event. A session is not a person. Duplicate rows for one session are unioned, and a later milestone does not invent an earlier one.",
  "Diagnostic stage rates divide each observed stage by exposed sessions. They are not a conditional funnel. The primary visit conversion is distinct sessions with a new email divided by those exposures.",
  "A saved email does not count as a frontend milestone. Raw email counts can be higher than distinct converting sessions, so a raw-email rate is not the visit conversion.",
  "Obvious crawler and headless clients are dropped before storage and are absent here. Ordinary browser strings can still be bots. This denominator is not a count of humans and is not the historical Clarity denominator.",
  "Assignment is 50:50 within each paid team only in expectation. A finite sample is not exactly balanced.",
  "Spend is shared by both variants after the click. This report does not attribute cost or CPA.",
  "A measurement denial or withdrawal does not remove an exposure already stored, and a later grant does not backfill one that was not.",
  "New email and verified email come only from the CRM row saved at create time. A generic accepted submit is not a new email.",
  "matureCohortAvailable means the 48 hour cohort can be read while newer visits are still open. It is not a statistical result. This report never names a winner. The immature email rate is descriptive.",
];

export function experimentReportAuthorized(
  authorizationHeader: string | null | undefined,
  secret: string | undefined,
): boolean {
  const expected = (secret ?? "").trim();
  if (expected.length < EXPERIMENT_REPORT_TOKEN_MIN) return false;
  const presented = authorizationHeader ?? "";
  const left = createHash("sha256").update(presented).digest();
  const right = createHash("sha256").update(`Bearer ${expected}`).digest();
  return timingSafeEqual(left, right);
}

function blank(): Bucket {
  return {
    sessions: 0,
    exposed: 0,
    formVisible: 0,
    formFocused: 0,
    submitAttempted: 0,
    matureSessions: 0,
    newEmails: 0,
    newEmailsWithin48h: 0,
    verifiedWithin48h: 0,
    matureNewEmailsWithin48h: 0,
    matureVerifiedWithin48h: 0,
    sessionsWithNewEmail: 0,
    sessionsWithVerifiedEmail: 0,
    matureSessionsWithNewEmail: 0,
    matureSessionsWithVerifiedEmail: 0,
    immatureSessionsWithNewEmail: 0,
  };
}

function richText(property: unknown): string {
  const rich = (property as { rich_text?: { plain_text?: string }[] } | undefined)?.rich_text;
  return (rich ?? []).map((part) => part.plain_text ?? "").join("");
}

function titleText(property: unknown): string {
  const title = (property as { title?: { plain_text?: string }[] } | undefined)?.title;
  return (title ?? []).map((part) => part.plain_text ?? "").join("");
}

function checkbox(property: unknown): boolean | undefined {
  const value = (property as { checkbox?: boolean | null } | undefined)?.checkbox;
  return typeof value === "boolean" ? value : undefined;
}

function selectName(property: unknown): string {
  return (property as { select?: { name?: string } | null } | undefined)?.select?.name ?? "";
}

function flagNames(property: unknown): string[] {
  const options = (property as { multi_select?: { name?: string }[] } | undefined)?.multi_select;
  return (options ?? []).map((option) => option.name ?? "").filter(Boolean);
}

function dateMs(property: unknown): number | null {
  const start = (property as { date?: { start?: string } | null } | undefined)?.date?.start;
  if (!start) return null;
  const parsed = Date.parse(start);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Dedupe key only. Never copied onto the report. */
function dedupeKey(properties: Record<string, unknown>): string {
  const property = properties["Canonical email"] as
    | { email?: unknown; rich_text?: { plain_text?: string }[] }
    | undefined;
  if (typeof property?.email === "string" && property.email.trim()) {
    return property.email.trim().toLowerCase();
  }
  const rich = richText(property).trim().toLowerCase();
  if (rich) return rich;
  return titleText(properties.Email).trim().toLowerCase();
}

function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function cell(bucket: Bucket, behaviorOk: boolean, leadsOk: boolean): ExperimentReportCell {
  const pick = (key: CountKey, ok: boolean): number | null => (ok ? bucket[key] : null);
  const counts: FunnelCounts = {
    sessions: pick("sessions", behaviorOk),
    exposed: pick("exposed", behaviorOk),
    formVisible: pick("formVisible", behaviorOk),
    formFocused: pick("formFocused", behaviorOk),
    submitAttempted: pick("submitAttempted", behaviorOk),
    matureSessions: pick("matureSessions", behaviorOk),
    newEmails: pick("newEmails", leadsOk),
    newEmailsWithin48h: pick("newEmailsWithin48h", leadsOk),
    verifiedWithin48h: pick("verifiedWithin48h", leadsOk),
    matureNewEmailsWithin48h: pick("matureNewEmailsWithin48h", leadsOk),
    matureVerifiedWithin48h: pick("matureVerifiedWithin48h", leadsOk),
    sessionsWithNewEmail: pick("sessionsWithNewEmail", leadsOk),
    sessionsWithVerifiedEmail: pick("sessionsWithVerifiedEmail", leadsOk),
    matureSessionsWithNewEmail: pick("matureSessionsWithNewEmail", leadsOk),
    matureSessionsWithVerifiedEmail: pick("matureSessionsWithVerifiedEmail", leadsOk),
    immatureSessionsWithNewEmail: pick("immatureSessionsWithNewEmail", leadsOk),
  };
  const immatureSessions =
    counts.sessions === null || counts.matureSessions === null
      ? null
      : counts.sessions - counts.matureSessions;
  return {
    counts,
    rates: {
      formVisiblePerExposed: rate(counts.formVisible, counts.exposed),
      formFocusedPerExposed: rate(counts.formFocused, counts.exposed),
      submitAttemptedPerExposed: rate(counts.submitAttempted, counts.exposed),
      newEmailWithin48hPerAttempt: rate(counts.newEmailsWithin48h, counts.submitAttempted),
      verifiedWithin48hPerNewEmail: rate(counts.verifiedWithin48h, counts.newEmailsWithin48h),
      matureVerifiedWithin48hPerMatureSession: rate(
        counts.matureVerifiedWithin48h,
        counts.matureSessions,
      ),
      newEmailSessionsPerSession: rate(counts.sessionsWithNewEmail, counts.sessions),
      verifiedEmailSessionsPerSession: rate(counts.sessionsWithVerifiedEmail, counts.sessions),
      matureNewEmailPerSession: rate(counts.matureSessionsWithNewEmail, counts.matureSessions),
      matureVerifiedEmailPerSession: rate(
        counts.matureSessionsWithVerifiedEmail,
        counts.matureSessions,
      ),
      savedEmailSessionsPerSession: rate(counts.immatureSessionsWithNewEmail, immatureSessions),
    },
  };
}

type SessionStatus = "ok" | "inconsistent" | "qa" | "malformed" | "no_exposure";

type Session = {
  variant: ExperimentContext["variant"];
  team: ExperimentContext["team"];
  assignedAt: number;
  funnels: ExperimentFunnel[];
  status: SessionStatus;
};

function assignedAtUsable(assignedAt: number, now: number): boolean {
  return assignedAt >= ASSIGNED_AT_MIN && assignedAt <= now + FUTURE_SKEW_MS;
}

function withinWindow(eventAt: number, assignedAt: number): boolean {
  const delta = eventAt - assignedAt;
  return delta >= -CLOCK_SKEW_MS && delta <= EXPERIMENT_MATURITY_MS;
}

function timestampUsable(eventAt: number, now: number): boolean {
  return eventAt <= now + FUTURE_SKEW_MS;
}

export function buildExperimentReport(input: ReportPages): ExperimentReport {
  const behaviorOk = input.behavior.availability === "ok";
  const leadsReadable = input.leads.availability === "ok" && input.leads.column === "present";
  const leadsOk = behaviorOk && leadsReadable;
  const quality: ExperimentReport["quality"] = {
    inconsistentSessions: 0,
    malformedBehaviorRows: 0,
    malformedLeadRows: 0,
    qaExcludedSessions: 0,
    qaExcludedLeads: 0,
    withdrawnExcluded: 0,
    suspectExcluded: 0,
    blockedExcluded: 0,
    duplicateExcluded: 0,
    unmatchedLeads: 0,
    mismatchedLeads: 0,
    contextWithoutExposure: 0,
    consentMissing: 0,
    eventsBeforeExposure: 0,
    lateEvents: 0,
    immatureSessions: 0,
    milestoneGaps: 0,
    futureTimestamps: 0,
    verifiedBeforeSignup: 0,
    behaviorPagesRead: behaviorOk ? input.behavior.pages.length : 0,
    leadPagesRead: leadsReadable ? input.leads.pages.length : 0,
    behaviorTruncated: input.behavior.truncated,
    leadsTruncated: input.leads.truncated,
  };

  const sessions = new Map<string, Session>();
  if (behaviorOk) {
    for (const page of input.behavior.pages) {
      const properties = page.properties ?? {};
      const title = titleText(properties.Name).trim();
      const parsed = parseBehaviorSections(richText(properties.Sections));
      if (parsed.malformed || !parsed.context || !title) {
        quality.malformedBehaviorRows += 1;
        if (title) mark(sessions, title.toLowerCase(), "malformed");
        continue;
      }
      if (parsed.context.sessionId.toLowerCase() !== title.toLowerCase()) {
        quality.malformedBehaviorRows += 1;
        mark(sessions, title.toLowerCase(), "malformed");
        continue;
      }
      if (!assignedAtUsable(parsed.context.assignedAt, input.now)) {
        quality.malformedBehaviorRows += 1;
        mark(sessions, title.toLowerCase(), "malformed");
        continue;
      }
      absorb(sessions, parsed.context, parsed.funnel);
    }
  }

  for (const session of sessions.values()) {
    if (session.status === "malformed") continue;
    if (session.status === "inconsistent") {
      quality.inconsistentSessions += 1;
      continue;
    }
    const funnel = unionFunnels(session.funnels);
    if (session.status === "qa") {
      quality.qaExcludedSessions += 1;
      continue;
    }
    if (!funnel.exposed) {
      session.status = "no_exposure";
      quality.contextWithoutExposure += 1;
    }
    if (milestoneGap(funnel)) quality.milestoneGaps += 1;
  }

  const buckets = new Map<string, Bucket>();
  const bucketFor = (variant: string, team: string) => {
    const key = `${variant}/${team}`;
    const existing = buckets.get(key);
    if (existing) return existing;
    const created = blank();
    buckets.set(key, created);
    return created;
  };

  if (behaviorOk) {
    for (const session of sessions.values()) {
      if (session.status !== "ok") continue;
      const funnel = unionFunnels(session.funnels);
      const mature = input.now - session.assignedAt >= EXPERIMENT_MATURITY_MS;
      if (!mature) quality.immatureSessions += 1;
      const bucket = bucketFor(session.variant, session.team);
      bucket.sessions += 1;
      bucket.exposed += funnel.exposed ? 1 : 0;
      bucket.formVisible += funnel.formVisible ? 1 : 0;
      bucket.formFocused += funnel.formFocused ? 1 : 0;
      bucket.submitAttempted += funnel.submitAttempted ? 1 : 0;
      if (mature) bucket.matureSessions += 1;
    }
  }

  const conversions = new Map<string, { emails: number; verified: number }>();
  if (leadsOk) {
    const kept = new Map<string, { context: ExperimentContext; signedUp: number; verifiedAt: number | null }>();
    for (const page of input.leads.pages) {
      const properties = page.properties ?? {};
      const parsed = parseLeadExperiment(richText(properties[FIELD_CONVERSION_EXPERIMENT]));
      if (!parsed.context) {
        if (parsed.malformed) quality.malformedLeadRows += 1;
        continue;
      }
      if (parsed.context.qa) {
        quality.qaExcludedLeads += 1;
        continue;
      }
      const flags = flagNames(properties.Flags);
      if (checkbox(properties[FIELD_SUSPECT]) === true) {
        quality.suspectExcluded += 1;
        continue;
      }
      if (conversionBlocked(flags)) {
        quality.blockedExcluded += 1;
        continue;
      }
      if (checkbox(properties.Duplicate) === true) {
        quality.duplicateExcluded += 1;
        continue;
      }
      const consent = richText(properties[FIELD_MEASUREMENT_CONSENT]);
      if (consent === MEASUREMENT_CONSENT_WITHDRAWN || flags.includes(FLAG_MEASUREMENT_WITHDRAWN)) {
        quality.withdrawnExcluded += 1;
        continue;
      }
      if (consent !== MEASUREMENT_CONSENT_GRANTED) {
        quality.consentMissing += 1;
        continue;
      }
      const signedUp = dateMs(properties[FIELD_SIGNED_UP]);
      if (signedUp === null) {
        quality.malformedLeadRows += 1;
        continue;
      }
      const verifiedAt = dateMs(properties[FIELD_VERIFIED_AT]);
      const verified =
        verifiedAt !== null &&
        (checkbox(properties[FIELD_EMAIL_VERIFIED]) === true ||
          selectName(properties[FIELD_VERIFICATION_STATUS]) === STATUS_VERIFIED);
      const key = dedupeKey(properties);
      if (!key) {
        quality.malformedLeadRows += 1;
        continue;
      }
      const previous = kept.get(key);
      if (previous && previous.signedUp <= signedUp) {
        quality.duplicateExcluded += 1;
        continue;
      }
      if (previous) quality.duplicateExcluded += 1;
      kept.set(key, { context: parsed.context, signedUp, verifiedAt: verified ? verifiedAt : null });
    }

    for (const lead of kept.values()) {
      const sessionKey = lead.context.sessionId.toLowerCase();
      const session = sessions.get(sessionKey);
      if (!session || session.status !== "ok") {
        quality.unmatchedLeads += 1;
        continue;
      }
      if (session.variant !== lead.context.variant || session.team !== lead.context.team) {
        quality.mismatchedLeads += 1;
        continue;
      }
      if (!timestampUsable(lead.signedUp, input.now)) {
        quality.futureTimestamps += 1;
        continue;
      }
      if (!withinWindow(lead.signedUp, session.assignedAt)) {
        if (lead.signedUp + CLOCK_SKEW_MS < session.assignedAt) quality.eventsBeforeExposure += 1;
        else quality.lateEvents += 1;
        continue;
      }
      let verified = false;
      if (lead.verifiedAt !== null) {
        if (!timestampUsable(lead.verifiedAt, input.now)) {
          quality.futureTimestamps += 1;
        } else if (lead.verifiedAt + CLOCK_SKEW_MS < lead.signedUp) {
          quality.verifiedBeforeSignup += 1;
        } else if (lead.verifiedAt + CLOCK_SKEW_MS < session.assignedAt) {
          quality.eventsBeforeExposure += 1;
        } else if (!withinWindow(lead.verifiedAt, session.assignedAt)) {
          quality.lateEvents += 1;
        } else {
          verified = true;
        }
      }
      const current = conversions.get(sessionKey) ?? { emails: 0, verified: 0 };
      current.emails += 1;
      if (verified) current.verified += 1;
      conversions.set(sessionKey, current);
    }
  }

  if (behaviorOk) {
    for (const [sessionKey, session] of sessions) {
      const hit = conversions.get(sessionKey);
      if (session.status !== "ok" || !hit || hit.emails === 0) continue;
      const bucket = bucketFor(session.variant, session.team);
      const mature = input.now - session.assignedAt >= EXPERIMENT_MATURITY_MS;
      bucket.newEmails += hit.emails;
      bucket.newEmailsWithin48h += hit.emails;
      bucket.sessionsWithNewEmail += 1;
      if (mature) {
        bucket.matureNewEmailsWithin48h += hit.emails;
        bucket.matureSessionsWithNewEmail += 1;
      } else {
        bucket.immatureSessionsWithNewEmail += 1;
      }
      if (hit.verified === 0) continue;
      bucket.verifiedWithin48h += hit.verified;
      bucket.sessionsWithVerifiedEmail += 1;
      if (mature) {
        bucket.matureVerifiedWithin48h += hit.verified;
        bucket.matureSessionsWithVerifiedEmail += 1;
      }
    }
  }

  const total = blank();
  const byArm = {} as ExperimentReport["byArm"];
  for (const variant of EXPERIMENT_VARIANTS) {
    const armTotal = blank();
    const byTeam = {} as ExperimentReport["byArm"][typeof variant]["byTeam"];
    for (const team of EXPERIMENT_TEAMS) {
      const bucket = buckets.get(`${variant}/${team}`) ?? blank();
      addBucket(armTotal, bucket);
      byTeam[team] = cell(bucket, behaviorOk, leadsOk);
    }
    addBucket(total, armTotal);
    byArm[variant] = { byTeam, total: cell(armTotal, behaviorOk, leadsOk) };
  }

  const complete =
    behaviorOk &&
    leadsReadable &&
    !input.behavior.truncated &&
    !input.leads.truncated;
  const partial = input.behavior.truncated || input.leads.truncated;
  const matureSessions = behaviorOk ? total.matureSessions : 0;
  // Winner readiness stays false: no statistical test is applied, and new
  // visits keep the immature count above zero for as long as traffic continues.
  const matureCohortAvailable = complete && leadsOk && matureSessions > 0;

  return {
    experimentId: EXPERIMENT_ID,
    generatedAt: new Date(input.now).toISOString(),
    complete,
    partial,
    maturityMs: EXPERIMENT_MATURITY_MS,
    decision: {
      winner: null,
      ready: false,
      matureCohortAvailable,
      reason: matureCohortAvailable
        ? "The 48 hour cohort can be read. Newer visits stay immature until their own window closes. No statistical test is applied, and this report does not name a winner."
        : "The mature cohort is incomplete or empty. This report does not name a winner.",
    },
    caveats: CAVEATS,
    sources: {
      behavior: input.behavior.availability,
      leads: input.leads.availability,
      conversionExperimentColumn: input.leads.column,
    },
    quality,
    byArm,
    total: cell(total, behaviorOk, leadsOk),
  };
}

function mark(sessions: Map<string, Session>, key: string, status: SessionStatus) {
  const existing = sessions.get(key);
  if (!existing) {
    sessions.set(key, {
      variant: "control",
      team: "organic",
      assignedAt: ASSIGNED_AT_MIN,
      funnels: [],
      status,
    });
    return;
  }
  existing.status = status === "malformed" || existing.status === "malformed" ? "malformed" : status;
}

function absorb(
  sessions: Map<string, Session>,
  context: ExperimentContext,
  funnel: ExperimentFunnel | null,
) {
  const key = context.sessionId.toLowerCase();
  const existing = sessions.get(key);
  if (!existing) {
    sessions.set(key, {
      variant: context.variant,
      team: context.team,
      assignedAt: context.assignedAt,
      funnels: [monotonicFunnel(funnel)],
      status: context.qa ? "qa" : "ok",
    });
    return;
  }
  if (existing.status === "malformed") return;
  if (existing.variant !== context.variant || existing.team !== context.team) {
    existing.status = "inconsistent";
  } else if (context.qa || existing.status === "qa") {
    existing.status = "qa";
  }
  existing.assignedAt = Math.min(existing.assignedAt, context.assignedAt);
  existing.funnels.push(monotonicFunnel(funnel));
}

function addBucket(into: Bucket, extra: Bucket) {
  for (const key of COUNT_KEYS) into[key] += extra[key];
}

export type BehaviorQuery = (body: Record<string, unknown>) => Promise<
  | { ok: true; page: Record<string, unknown> }
  | { ok: false; reason: "unconfigured" | "failed" }
>;

export type ExperimentReportSource = {
  env?: {
    NOTION_API_KEY?: string;
    NOTION_UX_DB_ID?: string;
    NOTION_WAITLIST_DB_ID?: string;
    WATCHDIVE_EXPERIMENT_REPORT_TOKEN?: string;
  };
  now?: () => number;
  maxPages?: number;
  behaviorQuery?: BehaviorQuery;
  waitlistRequest?: NotionRequest;
  log?: (line: string) => void;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Vary: "Authorization",
    },
  });
}

async function readBehavior(source: ExperimentReportSource, maxPages: number): Promise<ReportPages["behavior"]> {
  const env = source.env ?? process.env;
  if (!env.NOTION_API_KEY?.trim() || !env.NOTION_UX_DB_ID?.trim()) {
    return { availability: "unconfigured", pages: [], truncated: false };
  }
  const notion = createBehaviorNotion({ env, log: source.log });
  const query = source.behaviorQuery ?? ((body: Record<string, unknown>) => notion.queryDetailed(body));
  const pages: NotionPageLike[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const result = await query({
      filter: { property: "Sections", rich_text: { contains: EXPERIMENT_SECTION_MARKER } },
      page_size: PAGE_SIZE,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (!result.ok) {
      if (pages.length === 0) {
        return {
          availability: result.reason === "unconfigured" ? "unconfigured" : "unavailable",
          pages: [],
          truncated: false,
        };
      }
      return { availability: "ok", pages, truncated: true };
    }
    const results = (result.page.results as NotionPageLike[] | undefined) ?? [];
    pages.push(...results);
    if (!result.page.has_more) return { availability: "ok", pages, truncated: false };
    if (typeof result.page.next_cursor !== "string" || pageNumber === maxPages - 1) {
      return { availability: "ok", pages, truncated: true };
    }
    cursor = result.page.next_cursor;
  }
  return { availability: "ok", pages, truncated: true };
}

async function readLeads(source: ExperimentReportSource, maxPages: number): Promise<ReportPages["leads"]> {
  const env = source.env ?? process.env;
  if (!env.NOTION_API_KEY?.trim() || !env.NOTION_WAITLIST_DB_ID?.trim()) {
    return { availability: "unconfigured", column: "unknown", pages: [], truncated: false };
  }
  const request = source.waitlistRequest ?? createNotionRequest(fetch, env);
  const databaseId = env.NOTION_WAITLIST_DB_ID.trim();
  const pages: NotionPageLike[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    try {
      const result = await request("POST", `databases/${databaseId}/query`, {
        filter: {
          property: FIELD_CONVERSION_EXPERIMENT,
          rich_text: { contains: EXPERIMENT_ID },
        },
        page_size: PAGE_SIZE,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      const results = (result.results as NotionPageLike[] | undefined) ?? [];
      pages.push(...results);
      if (!result.has_more) {
        return { availability: "ok", column: "present", pages, truncated: false };
      }
      if (typeof result.next_cursor !== "string" || pageNumber === maxPages - 1) {
        return { availability: "ok", column: "present", pages, truncated: true };
      }
      cursor = result.next_cursor;
    } catch (error) {
      const missing =
        error instanceof NotionRequestError &&
        error.status === 400 &&
        error.code === "validation_error" &&
        error.rejectedOptionalColumns.includes(FIELD_CONVERSION_EXPERIMENT);
      if (pages.length === 0) {
        return {
          availability: "unavailable",
          column: missing ? "missing" : "unknown",
          pages: [],
          truncated: false,
        };
      }
      return { availability: "ok", column: "present", pages, truncated: true };
    }
  }
  return { availability: "ok", column: "present", pages, truncated: true };
}

export async function loadExperimentReport(source: ExperimentReportSource = {}): Promise<ExperimentReport> {
  const now = source.now?.() ?? Date.now();
  const maxPages = source.maxPages ?? EXPERIMENT_REPORT_MAX_PAGES;
  const [behavior, leads] = await Promise.all([readBehavior(source, maxPages), readLeads(source, maxPages)]);
  return buildExperimentReport({ now, behavior, leads });
}

export async function handleExperimentReport(
  request: Request,
  source?: ExperimentReportSource,
): Promise<Response> {
  const env = source?.env ?? process.env;
  // Refuse before any CRM or behavior read, including when the token is unset.
  if (!experimentReportAuthorized(request.headers.get("authorization"), env.WATCHDIVE_EXPERIMENT_REPORT_TOKEN)) {
    return json(401, { error: "unauthorized" });
  }
  try {
    return json(200, await loadExperimentReport({ ...source, env }));
  } catch (error) {
    source?.log?.(`[conversion-experiment] report failed — ${error instanceof Error ? error.name : "error"}`);
    const now = source?.now?.() ?? Date.now();
    return json(
      200,
      buildExperimentReport({
        now,
        behavior: { availability: "unavailable", pages: [], truncated: false },
        leads: { availability: "unavailable", column: "unknown", pages: [], truncated: false },
      }),
    );
  }
}
