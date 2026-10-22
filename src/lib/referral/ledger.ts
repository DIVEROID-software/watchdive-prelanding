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
//     not) may be a friend; any later row sharing its canonical email or its
//     referral identity key (identity.ts: Gmail dots/+tags, Apple
//     me.com/mac.com, documented +tags) is `duplicate`, whoever referred it.
//     A row ops ticked Duplicate is not the sign-up of record, so the
//     person's other row takes its place.
//   - A friend who confirmed and later unsubscribed keeps counting
//     (`wasConfirmed`, legal review D7): counts never drop because a friend
//     left the list.
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
//     at`). That bound alone is approximate (the column holds the latest
//     notice), so Dive Leader also has a write-once column, `Referral leader
//     reached at`, set by the notice that first announced it. When present
//     it IS the leader instant for the light order (`leaderInstant`); rows
//     without it (never announced, or announced before the column existed)
//     fall back to the credited timeline bounded by the notice.
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
import { referralIdentityKey } from "./identity.ts";
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
    if (!code) {
      // A `Referred by` that is not a code at all still came in on a link.
      if ((friend.referredBy ?? "").trim()) excluded.unknown_referrer += 1;
      continue;
    }
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
  // first row came in directly or was itself excluded. A person is seen under
  // both keys, the signup's canonical email and the referral identity key
  // (documented provider aliases, identity.ts); a friend counts only when it
  // is the first row under each, so the ledger is never laxer than either.
  const firstByCanonical = new Map<string, { at: number; pageId: string }>();
  const firstByIdentity = new Map<string, { at: number; pageId: string }>();
  for (const row of rows) {
    const at = verifiedAtMs(row);
    if (!row.emailVerified || at === null || row.duplicate) continue;
    keepEarliest(firstByCanonical, personKey(row), at, row.pageId);
    keepEarliest(firstByIdentity, identityKey(row), at, row.pageId);
  }

  const perDay = new Map<string, number>();
  const credits = new Map<string, number[]>();
  for (const { friend, code, at } of candidates) {
    const canonical = personKey(friend);
    const identity = identityKey(friend);
    if (
      (canonical && firstByCanonical.get(canonical)?.pageId !== friend.pageId) ||
      (identity && firstByIdentity.get(identity)?.pageId !== friend.pageId)
    ) {
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
    const recorded = leaderInstant(referrer, held);
    if (recorded !== null) reachedAt.leader = new Date(recorded).toISOString();
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
 * The recorded Dive Leader instant (epoch ms), or null to use the timeline.
 * Only a readable stamp on a row that still holds the tier and whose reward
 * review was not rejected counts; it is never moved by later credits or
 * removals, which is what makes the light order exact and stable.
 */
export function leaderInstant(row: ReferralRow, held: number): number | null {
  if (!row.leaderReachedAt || row.rewardReview === "rejected") return null;
  const leader = REFERRAL_TIERS.find((tier) => tier.id === "leader");
  if (!leader || held < leader.minFriends) return null;
  const ms = Date.parse(row.leaderReachedAt);
  return Number.isFinite(ms) ? ms : null;
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

/** The referral identity key, or "" for a value that is not an address. */
function identityKey(row: ReferralRow): string {
  const key = referralIdentityKey(row.email);
  return key.includes("@") ? key : "";
}

function keepEarliest(
  first: Map<string, { at: number; pageId: string }>,
  key: string,
  at: number,
  pageId: string,
): void {
  if (!key) return;
  const seen = first.get(key);
  if (!seen || at < seen.at || (at === seen.at && compare(pageId, seen.pageId) < 0)) {
    first.set(key, { at, pageId });
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byPageId(a: ReferralRow, b: ReferralRow): number {
  return compare(a.pageId, b.pageId);
}
