// The Buddy Invite ledger: who has how many credited friends, when each tier
// was reached, who gets a light, and the public ranking.
//
// It is a pure function of the waitlist rows, recomputed on every read. There
// is no stored running total that could drift from the rows, and a friend that
// ops flag later simply stops counting on the next read.
//
// Credit order is deterministic — friend `Verified at` ascending, then page id
// — so the same rows always give the same tiers, light order and ranking,
// whichever order Notion returns them in.
//
// Decisions (documented for review):
//   - One person counts once: only the person's first confirmed sign-up (by
//     `Verified at`, then page id, over every row, referred or not, flagged or
//     not) may be a friend; any later row for the same canonical email is
//     `duplicate`, whoever referred it. A row ops ticked Duplicate is not the
//     sign-up of record, so the person's other row takes its place.
//   - The daily cap is per referrer per Asia/Seoul calendar day of the friend's
//     `Verified at`. Friends over the cap are `daily_cap` and never roll over.
//   - A referrer gets a standing only while their own row is a confirmed
//     (possibly since unsubscribed), unflagged single sign-up whose reward
//     review is not `rejected` (`referrerEligible`, legal review D7). Their friends' credits are
//     still computed, so a cleared row gets them back; while ineligible the
//     credits are counted in `ineligibleReferrerCredits`, not in `excluded`
//     (the contract has no reason for it).
//   - A tier the person was told about is kept (legal review D7): the held
//     count is max(credited, `Referral notified count`), see `heldCount`.
//     Removing friends later lowers `credited` (the ranking, the top 3) but
//     not the tiers already announced, and the instant a held tier was reached
//     is never later than the notice that announced it (`Referral notified
//     at`). That bound is approximate: the column holds the latest notice, so
//     an exact original instant needs a write-once column (owner decision).
//   - The ledger is live until the close and keeps moving afterwards only by
//     ops withdrawals. The official frozen result is the ops report
//     (scripts/referral-report.ts) generated at the close.
//   - Friends confirmed before the program start (22 Oct 2026) through an
//     existing link still count: the rules do not exclude them.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type {
  ExclusionReason,
  LeaderboardEntry,
  LeaderboardSnapshot,
  LedgerResult,
  ReferralRow,
  ReferralStatus,
  ReferrerStanding,
} from "./contract.ts";
import { excludeReason, normalizeRefCode, referrerEligible, verifiedAtMs } from "./eligibility.ts";
import { checkNickname } from "./nickname.ts";
import {
  CREDIT_DAY_TIME_ZONE,
  DAILY_CREDIT_CAP,
  EARLY_NOTICE_HOURS,
  LEADER_LIGHT_STOCK,
  REFERRAL_TIERS,
  highestTier,
  nextTier,
} from "./program.ts";

const EXCLUSION_REASONS: readonly ExclusionReason[] = [
  "not_verified",
  "unsubscribed",
  "suspect",
  "duplicate",
  "blocked_flag",
  "self_referral",
  "disposable_domain",
  "unknown_referrer",
  "after_close",
  "daily_cap",
];

/** LedgerResult plus the ops-only count of credits held back from ineligible referrers. */
export type Ledger = LedgerResult & { ineligibleReferrerCredits: number };

const creditDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: CREDIT_DAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` of an instant in the credit time zone (Korea Standard Time). */
export function creditDayKey(ms: number): string {
  return creditDay.format(new Date(ms));
}

type Candidate = { friend: ReferralRow; code: string; at: number };

export function computeLedger(
  rows: readonly ReferralRow[],
  options: { closesAt: Date | null },
): Ledger {
  const excluded = Object.fromEntries(EXCLUSION_REASONS.map((r) => [r, 0])) as Record<
    ExclusionReason,
    number
  >;

  // First row wins for a ref code; codes are unique by construction, and a
  // collision must not let a second row claim someone else's friends.
  const byCode = new Map<string, ReferralRow>();
  for (const row of [...rows].sort(byPageId)) {
    const code = normalizeRefCode(row.refCode);
    if (code && !byCode.has(code)) byCode.set(code, row);
  }

  const candidates: Candidate[] = [];
  for (const friend of rows) {
    const code = normalizeRefCode(friend.referredBy);
    if (!code) continue;
    const reason = excludeReason(friend, byCode.get(code), options);
    if (reason) {
      excluded[reason] += 1;
      continue;
    }
    candidates.push({ friend, code, at: verifiedAtMs(friend) as number });
  }
  candidates.sort((a, b) => a.at - b.at || compare(a.friend.pageId, b.friend.pageId));

  // Each person's sign-up of record: the earliest confirmed row over the
  // whole list, so a repeat row through a link never counts even when the
  // first row came in directly or was itself excluded.
  const firstSignup = new Map<string, { at: number; pageId: string }>();
  for (const row of rows) {
    const at = verifiedAtMs(row);
    if (!row.emailVerified || at === null || row.duplicate) continue;
    const person = personKey(row);
    if (!person) continue;
    const seen = firstSignup.get(person);
    if (!seen || at < seen.at || (at === seen.at && compare(row.pageId, seen.pageId) < 0)) {
      firstSignup.set(person, { at, pageId: row.pageId });
    }
  }

  const perDay = new Map<string, number>();
  const credits = new Map<string, number[]>();
  for (const { friend, code, at } of candidates) {
    const person = personKey(friend);
    if (person && firstSignup.get(person)?.pageId !== friend.pageId) {
      excluded.duplicate += 1;
      continue;
    }
    const dayKey = `${code}|${creditDayKey(at)}`;
    const today = perDay.get(dayKey) ?? 0;
    if (today >= DAILY_CREDIT_CAP) {
      excluded.daily_cap += 1;
      continue;
    }
    perDay.set(dayKey, today + 1);
    const list = credits.get(code) ?? [];
    list.push(at);
    credits.set(code, list);
  }

  let ineligibleReferrerCredits = 0;
  for (const [code, times] of credits) {
    const referrer = byCode.get(code);
    if (!referrer || !referrerEligible(referrer)) ineligibleReferrerCredits += times.length;
  }

  // Code order, so the map iterates the same way whatever order rows came in.
  const standings = new Map<string, ReferrerStanding>();
  for (const [code, referrer] of [...byCode].sort((a, b) => compare(a[0], b[0]))) {
    const times = credits.get(code) ?? [];
    const held = heldCount(referrer, times.length);
    if (held === 0 || !referrerEligible(referrer)) continue;
    const noticeMs = referrer.notifiedAt ? Date.parse(referrer.notifiedAt) : NaN;
    const reachedAt: ReferrerStanding["reachedAt"] = {};
    for (const tier of REFERRAL_TIERS) {
      const fromCredits =
        times.length >= tier.minFriends ? times[tier.minFriends - 1] : Number.POSITIVE_INFINITY;
      const fromNotice =
        referrer.notifiedCount >= tier.minFriends && Number.isFinite(noticeMs)
          ? noticeMs
          : Number.POSITIVE_INFINITY;
      const at = Math.min(fromCredits, fromNotice);
      if (Number.isFinite(at)) reachedAt[tier.id] = new Date(at).toISOString();
    }
    standings.set(code, {
      refCode: code,
      credited: times.length,
      reachedAt,
      leaderOrder: null,
      lightEligible: false,
      lastCreditAt: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    });
  }

  const leaders = [...standings.values()]
    .filter((s) => s.reachedAt.leader)
    .sort(
      (a, b) =>
        Date.parse(a.reachedAt.leader as string) - Date.parse(b.reachedAt.leader as string) ||
        compare(a.refCode, b.refCode),
    );
  leaders.forEach((standing, index) => {
    standing.leaderOrder = index + 1;
    standing.lightEligible = index + 1 <= LEADER_LIGHT_STOCK;
  });

  return { standings, excluded, ineligibleReferrerCredits };
}

/**
 * The count whose tiers the person holds: the credited count, or the count
 * last announced by mail when that is higher (a tier we told someone about is
 * kept when friends are removed later, legal review D7). A rejected reward
 * review keeps only what is credited now.
 */
export function heldCount(row: ReferralRow, credited: number): number {
  if (row.rewardReview === "rejected") return credited;
  const announced = Number.isSafeInteger(row.notifiedCount) ? row.notifiedCount : 0;
  return Math.max(credited, announced, 0);
}

/**
 * Everyone with at least one credited friend, best first: credited desc, then
 * the instant they reached that count asc (reached it first), then ref code.
 */
export function rankedStandings(ledger: LedgerResult): ReferrerStanding[] {
  return [...ledger.standings.values()]
    .filter((s) => s.credited > 0)
    .sort(
      (a, b) =>
        b.credited - a.credited ||
        Date.parse(a.lastCreditAt ?? "") - Date.parse(b.lastCreditAt ?? "") ||
        compare(a.refCode, b.refCode),
    );
}

/** The nickname a stranger may see for this row, or null for "private diver". */
export function publicNickname(row: ReferralRow | undefined): string | null {
  if (!row || !row.leaderboard || row.nicknameHidden || !row.nickname) return null;
  const check = checkNickname(row.nickname);
  return check.ok ? check.value : null;
}

/**
 * The public top-N. Each entry carries only rank, a vetted nickname (or null)
 * and a count — never a ref code, page id or address.
 */
export function buildLeaderboard(
  rows: readonly ReferralRow[],
  ledger: LedgerResult,
  options: { size: number; now: Date; closed: boolean },
): LeaderboardSnapshot {
  const byCode = new Map<string, ReferralRow>();
  for (const row of [...rows].sort(byPageId)) {
    const code = normalizeRefCode(row.refCode);
    if (code && !byCode.has(code)) byCode.set(code, row);
  }
  const entries: LeaderboardEntry[] = rankedStandings(ledger)
    .slice(0, Math.max(0, options.size))
    .map((standing, index) => ({
      rank: index + 1,
      nickname: publicNickname(byCode.get(standing.refCode)),
      credited: standing.credited,
    }));
  return { entries, asOf: options.now.toISOString(), closed: options.closed };
}

/** What the owner of `row` sees on their signed status page. */
export function statusFor(
  row: ReferralRow,
  ledger: LedgerResult,
  options: { shareUrl: string; closed: boolean },
): ReferralStatus {
  const code = normalizeRefCode(row.refCode);
  const standing = ledger.standings.get(code);
  const credited = standing?.credited ?? 0;
  // No standing (an ineligible referrer) holds nothing, announced or not.
  const held = standing ? heldCount(row, credited) : 0;
  const top = highestTier(held);
  const next = nextTier(held);
  const rankIndex =
    credited > 0 ? rankedStandings(ledger).findIndex((s) => s.refCode === code) : -1;
  return {
    credited,
    highestTier: top?.id ?? null,
    nextTier: next?.id ?? null,
    remainingToNext: next ? next.minFriends - credited : null,
    earlyNoticeHours: top ? EARLY_NOTICE_HOURS[top.id] : 0,
    lightEligible: standing?.lightEligible ?? false,
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    nickname: row.nickname || null,
    leaderboard: row.leaderboard,
    nicknameHidden: row.nicknameHidden,
    noticesOff: row.noticesOff,
    shareUrl: options.shareUrl,
    closed: options.closed,
  };
}

function personKey(row: ReferralRow): string {
  return row.canonicalEmail || row.email.trim().toLowerCase();
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byPageId(a: ReferralRow, b: ReferralRow): number {
  return compare(a.pageId, b.pageId);
}
