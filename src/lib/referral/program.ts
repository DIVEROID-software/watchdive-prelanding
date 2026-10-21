// Buddy Invite referral program — owner-approved rules (2026-10-22).
//
// Every reward, threshold and limit the site, the mails and the rules page
// state comes from this file, so a copy change can never promise something the
// counter does not enforce. Change a number here, never in copy.
//
// Owner decisions, 2026-10-22:
//   1 verified friend   → launch notice 1 hour before the general list
//   3  Buddy            → launch notice 2 hours before (owner confirmed 2026-10-22)
//   5  Dive Team        → $149 early-bird price kept by a private Kickstarter
//                         reward link even after the first 100 are gone
//   10 Dive Leader      → one underwater light, first 30 people to reach it
//                         (office stock), shipping and taxes paid by recipient
//   Top 3 at the close  → one WatchDive each, shipping and taxes paid by recipient
//   Close               → immediately before the Kickstarter campaign goes
//                         live; date not set yet (planned for December 2026)

export const REFERRAL_PROGRAM_ID = "wd-buddy-invite-20261022" as const;

/**
 * Master switch. Off unless `WATCHDIVE_REFERRAL_PROGRAM_ENABLED=1` (server env).
 * The owner releases the program only after a final review, so a deploy with
 * the switch off must change nothing a visitor or inbox can see: the old
 * welcome mail, the old referral card, no leaderboard, no status or rules page
 * (404), no notices. Every surface checks this on the server.
 */
export function referralProgramEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.WATCHDIVE_REFERRAL_PROGRAM_ENABLED === "1";
}

export type ReferralTierId = "first" | "buddy" | "team" | "leader";

export type ReferralTier = {
  id: ReferralTierId;
  /** Credited (verified, eligible) friends needed. */
  minFriends: number;
};

/** Ascending. A referrer holds every tier whose threshold they meet. */
export const REFERRAL_TIERS: readonly ReferralTier[] = [
  { id: "first", minFriends: 1 },
  { id: "buddy", minFriends: 3 },
  { id: "team", minFriends: 5 },
  { id: "leader", minFriends: 10 },
] as const;

/** Hours ahead of the general list, by highest tier held. */
export const EARLY_NOTICE_HOURS: Record<ReferralTierId, number> = {
  first: 1,
  buddy: 2,
  team: 2,
  leader: 2,
};

/** Early-bird price kept for Dive Team and above (USD cents). */
export const GUARANTEED_PRICE_USD_CENTS = 14900;
export const EARLY_BIRD_SEATS = 100;

/** Underwater lights in stock for Dive Leaders, awarded in order of reaching the tier. */
export const LEADER_LIGHT_STOCK = 30;

/** WatchDive units for the final top referrers. */
export const TOP_PRIZE_WINNERS = 3;

/**
 * Anti-abuse: at most this many friends are credited to one referrer per
 * Asia/Seoul calendar day (by the friend's `Verified at`). Extra friends still
 * join the waitlist; they just do not count toward that referrer that day.
 */
export const DAILY_CREDIT_CAP = 10;
export const CREDIT_DAY_TIME_ZONE = "Asia/Seoul";

/**
 * Close of the contest. Unset until the Kickstarter launch time is fixed; the
 * rules promise the date at least 7 days ahead. When set (ISO instant, env
 * `WATCHDIVE_REFERRAL_CLOSES_AT`), friends verified at or after it are not
 * credited to anyone.
 */
export const CLOSE_NOTICE_DAYS = 7;
export function referralClosesAt(env: Record<string, string | undefined> = process.env): Date | null {
  const raw = env.WATCHDIVE_REFERRAL_CLOSES_AT;
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isFinite(at.getTime()) ? at : null;
}

/** A referrer gets at most one friend-joined mail per this interval. */
export const NOTICE_MIN_INTERVAL_MS = 60 * 60 * 1000;

/** Leaderboard size shown on the landing page and its public cache lifetime. */
export const LEADERBOARD_SIZE = 3;
export const LEADERBOARD_CACHE_SECONDS = 300;

/** Nickname bounds (Unicode code points, after trim/whitespace collapse). */
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;

export function tiersHeld(friends: number): ReferralTier[] {
  return REFERRAL_TIERS.filter((t) => friends >= t.minFriends);
}

export function highestTier(friends: number): ReferralTier | null {
  const held = tiersHeld(friends);
  return held.length ? held[held.length - 1] : null;
}

export function nextTier(friends: number): ReferralTier | null {
  return REFERRAL_TIERS.find((t) => friends < t.minFriends) ?? null;
}

/** Tiers newly reached when the count moves from `before` to `after`. */
export function tiersCrossed(before: number, after: number): ReferralTier[] {
  return REFERRAL_TIERS.filter((t) => before < t.minFriends && after >= t.minFriends);
}
