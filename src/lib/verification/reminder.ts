// One reminder of the confirmation mail for a signup that has not confirmed.
//
// The person asked for a confirmation mail; this re-sends that same mail, with
// the same copy, once. It is the tail of the double opt-in they started, not a
// campaign: no new copy, no promotion, and never a second reminder.
//
// How a reminder is issued
//   The attempt's `Lead ID` is kept. Minting a new one (`startAttempt`) would
//   kill the link already sitting in their inbox and the poll handle in the tab
//   they left open — so a person who finds the first mail after the reminder
//   would hit "invalid". Instead the same attempt gets a second signed token
//   with a fresh expiry, `Verification expires` is moved out to match (Notion is
//   the authority on the window), and both links confirm the same row.
//
// How "exactly once" holds  (strictly: at most once)
//   1. The candidate query requires `Verification reminder` to be empty.
//   2. Before any mail, the row is claimed: a unique marker is written into
//      `Verification reminder`. If that write fails — including Notion
//      rejecting the property because it has not been created — nothing is
//      sent for that row; a rejected property aborts the whole run.
//   3. After a settle pause the row is re-read, and the mail goes out only if
//      the marker read back is this run's. Two overlapping runs (Vercel can
//      deliver one cron twice) cannot both see their own marker after both
//      writes have landed.
//   4. The marker is never cleared. A crash after the claim means that signup
//      gets no reminder at all, never a second one.
//   5. Resend backstop: the reminder has its own idempotency key per attempt
//      and a deterministic payload (expiry rounded to the hour), so even two
//      sends that slipped past 1–3 collapse into one message at the provider.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { LeadRecord } from "./contracts.ts";
import { reviewFlags, VERIFICATION_MAX_SENDS, VERIFICATION_TTL_MS } from "./contracts.ts";
import { classifyDeliveryFailure, type VerificationMailer } from "./resend.ts";
import {
  createVerificationToken,
  isLeadId,
  requirePublicOrigin,
  requireSecret,
  type TokenEnvironment,
} from "./token.ts";
import { DEFAULT_LOCALE, localeFromPathname, type Locale } from "../i18n/locale.ts";

/** How long after the confirmation mail went out before the one reminder. */
export const VERIFICATION_REMINDER_DELAY_MS = 6 * 60 * 60 * 1000;

/**
 * Signups whose mail went out longer ago than this are left alone. A reminder
 * weeks after the request no longer reads as the tail of something the person
 * just did, and the first deploy would otherwise mail the whole backlog.
 */
export const VERIFICATION_REMINDER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Rows fetched per run. The rest wait for the next run (still inside max age). */
export const REMINDER_MAX_PER_RUN = 60;

/** Rows claimed together before one settle pause. */
export const REMINDER_BATCH_SIZE = 10;

/** Gap between claiming and re-reading, so an overlapping run's write has landed. */
export const REMINDER_CLAIM_SETTLE_MS = 2000;

/** Stop starting new batches after this, well inside the function time limit. */
export const REMINDER_TIME_BUDGET_MS = 40_000;

/**
 * The window the daily sweep checks for pending rows with no recorded send.
 * Matches the cron interval in vercel.json (daily), so consecutive runs tile
 * instead of re-reporting the same rows.
 */
export const UNSENT_SWEEP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Rows younger than this may still be mid-submit, so the sweep skips them. */
export const UNSENT_SWEEP_GRACE_MS = 15 * 60 * 1000;

/**
 * The reminder link expires on an hour boundary at least a full TTL away. Two
 * duplicate cron deliveries inside the same hour therefore sign byte-identical
 * tokens, which is what lets Resend's idempotency key collapse them. The mail
 * copy says "24 hours"; this gives 24–25.
 */
export function reminderExpiryMs(nowMs: number): number {
  const hour = 60 * 60 * 1000;
  return Math.ceil(nowMs / hour) * hour + VERIFICATION_TTL_MS;
}

export type ReminderCandidateQuery = {
  /** ISO instant: `Verification sent` on or before this. */
  sentOnOrBefore: string;
  /** ISO instant: `Verification sent` on or after this. */
  sentOnOrAfter: string;
  limit: number;
};

export type ReminderClaim = {
  marker: string;
  /** New `Verification expires`, covering the reminder link. */
  expiresAt: string;
  sends: number;
};

export interface ReminderStore {
  findReminderCandidates(query: ReminderCandidateQuery): Promise<LeadRecord[]>;
  claimReminder(pageId: string, claim: ReminderClaim): Promise<void>;
  /** Overwrites the claim marker with the outcome. Never with an empty value. */
  recordReminderOutcome(pageId: string, outcome: string): Promise<void>;
  reread(pageId: string): Promise<LeadRecord | undefined>;
  /** Pending, non-suspect rows signed up in the window with no `Verification sent`. */
  countUnsentPending(window: {
    signedUpOnOrAfter: string;
    signedUpBefore: string;
  }): Promise<number>;
}

export type ReminderDependencies = {
  store: ReminderStore;
  mailer: VerificationMailer;
  env?: TokenEnvironment;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  runId?: () => string;
};

export type ReminderSkipReason =
  | "not_pending"
  | "verified"
  | "suspect"
  | "flagged"
  | "already_reminded"
  | "no_recorded_send"
  | "too_soon"
  | "too_old"
  | "send_cap"
  | "no_attempt";

export type ReminderRunResult = {
  /** Set when the run stopped before mailing anyone, e.g. the property is missing. */
  aborted?: "reminder_property_missing" | "candidate_query_failed" | "not_configured";
  candidates: number;
  sent: number;
  /** Claimed, but the provider refused the mail. Never retried. */
  sendFailed: number;
  /** Claim write failed, or another run owns the claim, or the row changed. */
  notClaimed: number;
  skipped: Partial<Record<ReminderSkipReason, number>>;
  failureClasses: Record<string, number>;
  /** Not reached this run because of the time budget; next run picks them up. */
  deferred: number;
  /** Pending rows from the sweep window whose confirmation mail never left. */
  unsentPending?: number;
};

/**
 * Every reason a row must not be reminded. The query already filters on most
 * of these; they are checked again here because a reminder is the one place a
 * stale or mis-filtered row would turn into a real message.
 */
export function reminderSkipReason(
  record: LeadRecord,
  nowMs: number,
): ReminderSkipReason | undefined {
  // Only `pending` is mailable. Verified, unsubscribed, a withdrawn/suppressed
  // row, and legacy single opt-in rows (no status) are all excluded.
  if (record.status !== "pending") return "not_pending";
  if (record.emailVerified) return "verified";
  // Suspect covers every abuse flag, including a shared network.
  if (record.suspect) return "suspect";
  if (reviewFlags(record.flags).length > 0) return "flagged";
  if (record.reminder) return "already_reminded";
  // No recorded send means the first mail never left or was deliberately
  // suppressed (abuse, network block). The submit path refused to mail it, so
  // the reminder does too; the sweep reports these instead.
  const sentAt = record.sentAt ? Date.parse(record.sentAt) : Number.NaN;
  if (!Number.isFinite(sentAt)) return "no_recorded_send";
  if (nowMs - sentAt < VERIFICATION_REMINDER_DELAY_MS) return "too_soon";
  if (nowMs - sentAt > VERIFICATION_REMINDER_MAX_AGE_MS) return "too_old";
  if (record.sends >= VERIFICATION_MAX_SENDS) return "send_cap";
  if (!isLeadId(record.leadId) || !record.email.trim()) return "no_attempt";
  return undefined;
}

/** The language the person signed up in, as far as the first-touch path tells. */
export function reminderLocale(record: LeadRecord): Locale {
  if (!record.landingPath) return DEFAULT_LOCALE;
  try {
    return localeFromPathname(record.landingPath);
  } catch {
    return DEFAULT_LOCALE;
  }
}

function isMissingPropertyError(error: unknown): boolean {
  // `describeNotionFailure` keeps Notion's machine code; an unknown property
  // in a filter or a write is a `validation_error`.
  return error instanceof Error && /validation_error/.test(error.message);
}

function bump<K extends string>(counts: Partial<Record<K, number>>, key: K): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultRunId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

export async function runVerificationReminders(
  dependencies: ReminderDependencies,
): Promise<ReminderRunResult> {
  const clock = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? defaultSleep;
  const env = dependencies.env ?? process.env;
  const startedAtMs = clock().getTime();
  const runId = (dependencies.runId ?? defaultRunId)();
  const result: ReminderRunResult = {
    candidates: 0,
    sent: 0,
    sendFailed: 0,
    notClaimed: 0,
    skipped: {},
    failureClasses: {},
    deferred: 0,
  };

  let secret: string;
  let publicOrigin: string;
  try {
    secret = requireSecret(env);
    publicOrigin = requirePublicOrigin(env);
  } catch {
    return { ...result, aborted: "not_configured" };
  }

  const { store } = dependencies;
  let candidates: LeadRecord[];
  try {
    candidates = await store.findReminderCandidates({
      sentOnOrBefore: new Date(startedAtMs - VERIFICATION_REMINDER_DELAY_MS).toISOString(),
      sentOnOrAfter: new Date(startedAtMs - VERIFICATION_REMINDER_MAX_AGE_MS).toISOString(),
      limit: REMINDER_MAX_PER_RUN,
    });
  } catch (error) {
    const aborted = isMissingPropertyError(error)
      ? "reminder_property_missing"
      : "candidate_query_failed";
    console.error("[watchdive] verification_reminder_aborted", { reason: aborted });
    return { ...result, aborted };
  }

  const eligible: LeadRecord[] = [];
  for (const record of candidates.slice(0, REMINDER_MAX_PER_RUN)) {
    const skip = reminderSkipReason(record, startedAtMs);
    if (skip) bump(result.skipped, skip);
    else eligible.push(record);
  }
  result.candidates = eligible.length;

  for (let offset = 0; offset < eligible.length; offset += REMINDER_BATCH_SIZE) {
    if (clock().getTime() - startedAtMs > REMINDER_TIME_BUDGET_MS) {
      result.deferred = eligible.length - offset;
      break;
    }
    const batch = eligible.slice(offset, offset + REMINDER_BATCH_SIZE);
    const nowMs = clock().getTime();
    const expiresAtMs = reminderExpiryMs(nowMs);

    // --- claim ---------------------------------------------------------
    const claimed: { record: LeadRecord; marker: string }[] = [];
    for (const record of batch) {
      // Read back by the claimant only: unique per run and per row.
      const marker = `claimed ${new Date(nowMs).toISOString()} run:${runId}`;
      const previousExpiry = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
      const expiresAt = new Date(
        Number.isFinite(previousExpiry) ? Math.max(previousExpiry, expiresAtMs) : expiresAtMs,
      ).toISOString();
      try {
        await store.claimReminder(record.pageId, { marker, expiresAt, sends: record.sends + 1 });
        claimed.push({ record, marker });
      } catch (error) {
        if (isMissingPropertyError(error)) {
          // The property is missing or mistyped. Without it "once" cannot be
          // recorded, so nothing at all is sent.
          console.error("[watchdive] verification_reminder_aborted", {
            reason: "reminder_property_missing",
          });
          result.notClaimed += batch.length - claimed.length;
          return { ...result, aborted: "reminder_property_missing" };
        }
        result.notClaimed += 1;
      }
    }
    if (claimed.length === 0) continue;

    // --- settle, verify ownership, send ---------------------------------
    await sleep(REMINDER_CLAIM_SETTLE_MS);

    for (const { record, marker } of claimed) {
      let fresh: LeadRecord | undefined;
      try {
        fresh = await store.reread(record.pageId);
      } catch {
        fresh = undefined;
      }
      // Not our claim, confirmed meanwhile, or re-armed by a resubmit (new
      // lead id, so they just got a fresh mail anyway): no reminder. The claim
      // stays, which is the safe direction.
      if (
        !fresh ||
        fresh.reminder !== marker ||
        fresh.status !== "pending" ||
        fresh.emailVerified ||
        fresh.suspect ||
        reviewFlags(fresh.flags).length > 0 ||
        fresh.leadId !== record.leadId
      ) {
        result.notClaimed += 1;
        continue;
      }

      const locale = reminderLocale(fresh);
      let outcome: string;
      try {
        // The reminder link is minted without a consent bit, so opening it
        // cannot grant measurement. Consent already stored on the row still
        // converts at confirmation; a withdrawal on the row still blocks it.
        const token = createVerificationToken(fresh.leadId, expiresAtMs, false, secret, locale);
        await dependencies.mailer.send({
          to: fresh.email,
          token,
          leadId: fresh.leadId,
          publicOrigin,
          locale,
          reminder: true,
        });
        result.sent += 1;
        outcome = `sent ${clock().toISOString()}`;
      } catch (error) {
        const failure = classifyDeliveryFailure(error);
        const key =
          failure.status === null ? failure.reason : `${failure.reason} (HTTP ${failure.status})`;
        result.failureClasses[key] = (result.failureClasses[key] ?? 0) + 1;
        result.sendFailed += 1;
        outcome = `failed ${failure.reason} ${clock().toISOString()}`;
      }
      try {
        await store.recordReminderOutcome(fresh.pageId, outcome);
      } catch {
        // The claim marker stays in place, which already blocks a repeat.
      }
    }
  }

  try {
    result.unsentPending = await store.countUnsentPending({
      signedUpOnOrAfter: new Date(
        startedAtMs - UNSENT_SWEEP_GRACE_MS - UNSENT_SWEEP_WINDOW_MS,
      ).toISOString(),
      signedUpBefore: new Date(startedAtMs - UNSENT_SWEEP_GRACE_MS).toISOString(),
    });
  } catch {
    // The sweep is diagnostic; its failure never undoes the reminders.
  }

  return result;
}

/**
 * The run's Slack summary, or undefined when there is nothing worth a message.
 * Built from counts only: no address, name, lead id or page id can reach it.
 */
export function formatReminderSummary(result: ReminderRunResult): string | undefined {
  const lines: string[] = [];
  if (result.aborted === "reminder_property_missing") {
    lines.push(
      ":warning: WatchDive confirmation reminders are OFF: the Notion waitlist database has no " +
        "`Verification reminder` (text) property. No reminder was sent. Add the property to enable them.",
    );
  } else if (result.aborted) {
    lines.push(
      `:warning: WatchDive confirmation reminder run stopped early (${result.aborted}). No reminder was sent.`,
    );
  } else if (result.sent > 0 || result.sendFailed > 0 || result.deferred > 0) {
    lines.push(
      `WatchDive confirmation reminders: ${result.sent} sent` +
        (result.sendFailed ? `, ${result.sendFailed} failed to send` : "") +
        (result.deferred ? `, ${result.deferred} deferred to the next run` : "") +
        ".",
    );
    const classes = Object.entries(result.failureClasses)
      .map(([name, count]) => `${name} x${count}`)
      .join(", ");
    if (classes) lines.push(`Send error class: ${classes}.`);
  }
  if (result.unsentPending && result.unsentPending > 0) {
    lines.push(
      `:warning: ${result.unsentPending} pending signup${result.unsentPending === 1 ? "" : "s"} from the last ` +
        `${Math.round(UNSENT_SWEEP_WINDOW_MS / 3600000)}h have no recorded confirmation send: the mail ` +
        "most likely never left (it can also mean the send was not recorded, or the network-volume " +
        "breaker held it back). They are not reminded automatically.",
    );
  }
  return lines.length ? lines.join("\n") : undefined;
}
