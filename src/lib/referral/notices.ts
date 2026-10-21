// Buddy Invite friend-joined notices, one pass per office cron tick.
//
// The referrer hears that their count went up (and which tiers that crossed),
// never who joined: the mail carries counts and tier names only. Everything
// external is injected, so the whole pass runs in tests against fakes.
//
// Delivery is at-least-once with a collapse at the provider. The order is
// send → markNotified. If the Notion write fails after Resend accepted the
// mail, the next tick sees the same unannounced count, builds the same
// idempotency key (`…-notice-<refCode>-<credited>`) and Resend returns the
// first message instead of sending a second. A count that rose in between is a
// genuinely new notice under a new key.
//
// The first notice that announces Dive Leader also stamps the write-once
// `Referral leader reached at` (the exact light-order key, ledger.ts
// `leaderInstant`) in the same PATCH as the count, and only after the
// provider accepted the mail: a failed send records nothing.
//
// Before anything is read or sent, the pass checks that the program columns
// exist (store `missingColumns`, one schema GET cached per process). Without
// them a write of the announced count would be refused after the mail went
// out, and every tick would mail the same person again.
//
// Imports from core (feat/referral-core), coded against the brief signatures:
//   computeLedger(rows, { closesAt }) → LedgerResult   (./ledger.ts)
//   statusUrl(origin, refCode, locale, secret) → string (./statusToken.ts)
import { DEFAULT_LOCALE, isLocale, type Locale } from "../i18n/locale.ts";
import { parseLaunchMarker } from "../launchMail/audience.ts";
import { reservationCanonicalEmail } from "../reservation/emailIdentity.ts";
import { parseReservationMarker } from "../reservation-mail/campaign.ts";
import { conversionBlocked } from "../verification/contracts.ts";
import { buddyUnsubscribeUrl } from "../verification/resend.ts";
import type { ReferralMailer, ReferralRow, ReferralStore } from "./contract.ts";
import { normalizeRefCode } from "./eligibility.ts";
import { computeLedger } from "./ledger.ts";
import {
  NOTICE_MIN_INTERVAL_MS,
  REFERRAL_PROGRAM_ID,
  nextTier,
  referralProgramEnabled,
  tiersCrossed,
} from "./program.ts";
import { statusUrl } from "./statusToken.ts";

/**
 * Notices need two switches: the Buddy Invite master switch
 * (WATCHDIVE_REFERRAL_PROGRAM_ENABLED=1, the owner's final go-live) and this
 * notice switch. Either one off and the pass reads nothing and sends nothing.
 */
export function referralNoticesEnabled(env: Record<string, string | undefined>): boolean {
  return referralProgramEnabled(env) && env.WATCHDIVE_REFERRAL_NOTICES_ENABLED === "1";
}

/**
 * Whether this row says its address opted out of mail: the status, or an
 * `unsubscribed` marker the /unsubscribe endpoint (or a person) wrote in the
 * `Launch mail` or `Reservation mail` cell — the same rules the launch and
 * reservation mail runs apply (reservation-mail/audience.ts).
 */
export function rowOptedOut(row: {
  status: string;
  launchMail?: string;
  reservationMail?: string;
}): boolean {
  return (
    row.status === "unsubscribed" ||
    row.status === "suppressed" ||
    parseLaunchMarker(row.launchMail).kind === "unsubscribed" ||
    parseReservationMarker(row.reservationMail).kind === "unsubscribed"
  );
}

/** The inbox key opt-outs are shared by (Gmail dots/plus and googlemail fold). */
export function optOutAddressKey(email: string): string {
  return reservationCanonicalEmail(email);
}

/**
 * Every inbox opted out on ANY of its rows. An unsubscribe on one signup row
 * holds all rows of that address, so a second row cannot reopen mail.
 */
export function optedOutAddresses(
  rows: readonly { email: string; status: string; launchMail?: string; reservationMail?: string }[],
): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    if (row.email && rowOptedOut(row)) out.add(optOutAddressKey(row.email));
  }
  return out;
}

/** Upper bound on notices handed to the provider in one tick. */
export const DEFAULT_NOTICE_MAX_SENDS = 50;

export type ReferralNoticeDeps = {
  /** Switches are read from here (see referralNoticesEnabled). */
  env: Record<string, string | undefined>;
  store: Pick<ReferralStore, "listProgramRows" | "markNotified" | "missingColumns">;
  mailer: ReferralMailer;
  now: () => Date;
  publicOrigin: string;
  /** Status-page signing secret (core `referralSecret`). */
  secret: string;
  /**
   * Env that signs the referrer's opt-out link (WATCHDIVE_VERIFICATION_SECRET,
   * launch-mail unsubscribe token). Without it no notice can carry a working
   * opt-out, so none is sent. Defaults to `env`.
   */
  unsubscribeEnv?: Record<string, string | undefined>;
  closesAt: Date | null;
  /** Count what would be sent; send nothing and write nothing. */
  dryRun?: boolean;
  maxSends?: number;
  /**
   * Wall-clock budget for the pass. Checked before each send, so a slow
   * provider cannot hold the shared cron tick past its own timeout.
   */
  budgetMs?: number;
  /** Monotonic-ish clock for the budget; defaults to Date.now. */
  clock?: () => number;
  /** Operational log line (column names and counts only); defaults to console.error. */
  log?: (line: string) => void;
};

/** Counts only: safe for the log line and the cron response. */
export type ReferralNoticeResult = {
  /** False when either switch is off; every count is then zero. */
  enabled: boolean;
  /** Set when the pass stopped before reading rows; every count is then zero. */
  aborted?: "schema_missing";
  dryRun: boolean;
  /** Referrers whose credited count is above the last announced one. */
  pending: number;
  sent: number;
  /** Dry run only: notices that would have been sent. */
  wouldSend: number;
  skippedIneligible: number;
  skippedNoticesOff: number;
  /** The address opted out on one of its rows (Launch/Reservation mail marker, status). */
  skippedUnsubscribed: number;
  /** No signable opt-out link (no Lead ID or no signing secret). */
  skippedNoOptOut: number;
  skippedInterval: number;
  /** Left for a later tick by the per-tick cap or the time budget. */
  deferred: number;
  sendFailed: number;
  /** Sent, but the Notion bookkeeping failed; the next tick collapses at Resend. */
  markFailed: number;
};

export function noticeIdempotencyKey(refCode: string, credited: number): string {
  return `${REFERRAL_PROGRAM_ID}-notice-${refCode}-${credited}`;
}

/** Only a verified, clean, still-subscribed referrer is mailed. */
function mailable(row: ReferralRow): boolean {
  return (
    row.emailVerified &&
    row.status === "verified" &&
    !row.suspect &&
    !row.duplicate &&
    !conversionBlocked(row.flags) &&
    Boolean(row.email)
  );
}

function rowLocale(row: ReferralRow): Locale {
  return isLocale(row.signupLocale) ? row.signupLocale : DEFAULT_LOCALE;
}

function throttled(row: ReferralRow, nowMs: number): boolean {
  if (!row.notifiedAt) return false;
  const last = Date.parse(row.notifiedAt);
  // An unreadable timestamp is treated as "just now": waiting one interval is
  // cheaper than a burst of mail to someone whose bookkeeping is damaged.
  if (!Number.isFinite(last)) return true;
  return nowMs - last < NOTICE_MIN_INTERVAL_MS;
}

export async function runReferralNotices(deps: ReferralNoticeDeps): Promise<ReferralNoticeResult> {
  const dryRun = deps.dryRun === true;
  const maxSends = Math.max(0, deps.maxSends ?? DEFAULT_NOTICE_MAX_SENDS);
  const clock = deps.clock ?? Date.now;
  const startedAt = clock();
  const result: ReferralNoticeResult = {
    enabled: referralNoticesEnabled(deps.env),
    dryRun,
    pending: 0,
    sent: 0,
    wouldSend: 0,
    skippedIneligible: 0,
    skippedNoticesOff: 0,
    skippedUnsubscribed: 0,
    skippedNoOptOut: 0,
    skippedInterval: 0,
    deferred: 0,
    sendFailed: 0,
    markFailed: 0,
  };

  // Off means off: not even a Notion read, so a switched-off program costs
  // nothing and cannot fail the tick it rides.
  if (!result.enabled) return result;

  // All or nothing: a missing column would let mail go out with no record of
  // it (and then go out again every tick), so nothing is read or sent.
  const missing = await deps.store.missingColumns();
  if (missing.length > 0) {
    (deps.log ?? ((line: string) => console.error(line)))(
      `[referral-notices] referral_notices_schema_missing ${JSON.stringify({ missing })}`,
    );
    result.aborted = "schema_missing";
    return result;
  }

  const rows = await deps.store.listProgramRows();
  const ledger = computeLedger(rows, { closesAt: deps.closesAt });
  // Same lookup the ledger uses (first row by page id wins a code, codes
  // compared by normalizeRefCode), so a notice always reaches the row that
  // owns the standing.
  const byRefCode = new Map<string, ReferralRow>();
  for (const row of [...rows].sort((a, b) =>
    a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0,
  )) {
    const code = normalizeRefCode(row.refCode);
    if (code && !byRefCode.has(code)) byRefCode.set(code, row);
  }

  const optedOut = optedOutAddresses(rows);
  const now = deps.now();
  const nowMs = now.getTime();
  // Deterministic order, so a capped tick and the next one agree on who waits.
  const standings = [...ledger.standings.values()].sort((a, b) =>
    a.refCode < b.refCode ? -1 : a.refCode > b.refCode ? 1 : 0,
  );

  let attempts = 0;
  for (const standing of standings) {
    const row = byRefCode.get(standing.refCode);
    const announced = row ? Math.max(0, row.notifiedCount || 0) : 0;
    if (!row || standing.credited <= announced) continue;
    result.pending++;

    if (!mailable(row)) {
      result.skippedIneligible++;
      continue;
    }
    if (rowOptedOut(row) || optedOut.has(optOutAddressKey(row.email))) {
      result.skippedUnsubscribed++;
      continue;
    }
    if (row.noticesOff) {
      result.skippedNoticesOff++;
      continue;
    }
    const locale = rowLocale(row);
    const unsubscribeUrl = buddyUnsubscribeUrl(
      deps.publicOrigin,
      row.leadId ?? "",
      locale,
      deps.unsubscribeEnv ?? deps.env,
    );
    if (!unsubscribeUrl) {
      result.skippedNoOptOut++;
      continue;
    }
    if (throttled(row, nowMs)) {
      result.skippedInterval++;
      continue;
    }
    if (
      attempts >= maxSends ||
      (deps.budgetMs !== undefined && clock() - startedAt >= deps.budgetMs)
    ) {
      result.deferred++;
      continue;
    }
    attempts++;

    if (dryRun) {
      result.wouldSend++;
      continue;
    }

    const credited = standing.credited;
    const next = nextTier(credited);
    const crossed = tiersCrossed(announced, credited).map((tier) => tier.id);
    // Write-once: stamped only by the notice that first announces Dive
    // Leader to a row with an empty cell; an existing stamp is never touched.
    const leaderReachedAt =
      crossed.includes("leader") && !row.leaderReachedAt
        ? (standing.reachedAt.leader ?? now.toISOString())
        : undefined;
    try {
      await deps.mailer.sendReferralNotice({
        to: row.email,
        locale,
        credited,
        crossed,
        nextTier: next ? next.id : null,
        remainingToNext: next ? next.minFriends - credited : null,
        statusUrl: statusUrl(deps.publicOrigin, standing.refCode, locale, deps.secret),
        unsubscribeUrl,
        ...(row.signupCountry ? { signupCountry: row.signupCountry } : {}),
        idempotencyKey: noticeIdempotencyKey(standing.refCode, credited),
      });
    } catch {
      // The mailer already logged a fixed operation/status/reason line. The
      // count stays unannounced, so the next tick tries again.
      result.sendFailed++;
      continue;
    }
    result.sent++;
    try {
      await deps.store.markNotified(row.pageId, {
        count: credited,
        at: now.toISOString(),
        ...(leaderReachedAt ? { leaderReachedAt } : {}),
      });
    } catch {
      result.markFailed++;
    }
  }

  return result;
}
