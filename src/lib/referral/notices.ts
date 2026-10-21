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
// Imports from core (feat/referral-core), coded against the brief signatures:
//   computeLedger(rows, { closesAt }) → LedgerResult   (./ledger.ts)
//   statusUrl(origin, refCode, locale, secret) → string (./statusToken.ts)
import { DEFAULT_LOCALE, isLocale, type Locale } from "../i18n/locale.ts";
import { conversionBlocked } from "../verification/contracts.ts";
import type { ReferralMailer, ReferralRow, ReferralStore } from "./contract.ts";
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

/** Upper bound on notices handed to the provider in one tick. */
export const DEFAULT_NOTICE_MAX_SENDS = 50;

export type ReferralNoticeDeps = {
  /** Switches are read from here (see referralNoticesEnabled). */
  env: Record<string, string | undefined>;
  store: Pick<ReferralStore, "listProgramRows" | "markNotified">;
  mailer: ReferralMailer;
  now: () => Date;
  publicOrigin: string;
  /** Status-page signing secret (core `referralSecret`). */
  secret: string;
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
};

/** Counts only: safe for the log line and the cron response. */
export type ReferralNoticeResult = {
  /** False when either switch is off; every count is then zero. */
  enabled: boolean;
  dryRun: boolean;
  /** Referrers whose credited count is above the last announced one. */
  pending: number;
  sent: number;
  /** Dry run only: notices that would have been sent. */
  wouldSend: number;
  skippedIneligible: number;
  skippedNoticesOff: number;
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
    skippedInterval: 0,
    deferred: 0,
    sendFailed: 0,
    markFailed: 0,
  };

  // Off means off: not even a Notion read, so a switched-off program costs
  // nothing and cannot fail the tick it rides.
  if (!result.enabled) return result;

  const rows = await deps.store.listProgramRows();
  const ledger = computeLedger(rows, { closesAt: deps.closesAt });
  // Same lookup the ledger uses (first row by page id wins a code, codes
  // compared trimmed and lowercased), so a notice always reaches the row that
  // owns the standing.
  const byRefCode = new Map<string, ReferralRow>();
  for (const row of [...rows].sort((a, b) =>
    a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0,
  )) {
    const code = (row.refCode ?? "").trim().toLowerCase();
    if (code && !byRefCode.has(code)) byRefCode.set(code, row);
  }

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
    if (row.noticesOff) {
      result.skippedNoticesOff++;
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
    const locale = rowLocale(row);
    const next = nextTier(credited);
    try {
      await deps.mailer.sendReferralNotice({
        to: row.email,
        locale,
        credited,
        crossed: tiersCrossed(announced, credited).map((tier) => tier.id),
        nextTier: next ? next.id : null,
        remainingToNext: next ? next.minFriends - credited : null,
        statusUrl: statusUrl(deps.publicOrigin, standing.refCode, locale, deps.secret),
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
      await deps.store.markNotified(row.pageId, { count: credited, at: now.toISOString() });
    } catch {
      result.markFailed++;
    }
  }

  return result;
}
