// Shared contract for the Buddy Invite referral program. Implementations live
// in sibling modules; this file only fixes the shapes every part agrees on.
//
// Privacy invariants (enforced by tests, never relaxed):
//   - No email address, canonical email, Notion page id, or another person's
//     ref code ever leaves the server in any referral response, page, or mail.
//   - A friend is never identified to the referrer: mails and pages show counts.
//   - The public leaderboard shows only a nickname the person set AND opted in
//     to show AND ops did not hide; otherwise the placeholder "private diver".

import type { Locale } from "../i18n/locale.ts";
import type { ReferralTierId } from "./program.ts";

/** Notion columns added for the program (all on the waitlist database). */
export const REFERRAL_COLUMNS = {
  /** Durable one-off announcement intent/sent receipt. */
  announce: "Referral announce",
  /** Existing: the person's own 8-char code. */
  refCode: "Ref code",
  /** Existing: the code of whoever invited this row. */
  referredBy: "Referred by",
  /** New rich_text: nickname the person chose for the leaderboard. */
  nickname: "Referral nickname",
  /** New checkbox: person opted in to show the nickname publicly. */
  leaderboard: "Referral leaderboard",
  /** New checkbox: ops hid this nickname (offensive, impersonation). */
  nicknameHidden: "Referral nickname hidden",
  /** New checkbox: person turned off friend-joined mails. */
  noticesOff: "Referral notices off",
  /** New number: credited count last announced by mail. */
  notifiedCount: "Referral notified count",
  /** New date: when that mail was handed to the provider. */
  notifiedAt: "Referral notified at",
  /** New select (ops): pending | approved | rejected — manual reward review. */
  rewardReview: "Referral reward review",
  /**
   * New date, write-once: the instant the person first reached Dive Leader,
   * recorded with the notice that announced it. The exact key of the light
   * order; never overwritten once set (see notices.ts).
   */
  leaderReachedAt: "Referral leader reached at",
  /**
   * New rich_text: the memorable code (A–Z0–9, 4–12). Stored uppercase.
   * Notion annotations on that cell carry the two flags a second column would
   * otherwise need: `code` means the person claimed it (once), `italic` means
   * a signup was attributed through it and it no longer changes. Ops reset is
   * clearing the cell. Italic is the lock only because Notion has no second
   * flag on rich text; toggling italic in the Notion UI changes the lock.
   */
  shareCode: "Referral share code",
} as const;

/** One waitlist row, reduced to what the referral program may read. */
export type ReferralRow = {
  pageId: string;
  refCode: string;
  referredBy?: string;
  /** Canonical email, for self-referral and duplicate checks. Server-only. */
  canonicalEmail: string;
  status: "pending" | "verified" | "unsubscribed" | string;
  emailVerified: boolean;
  verifiedAt?: string;
  suspect: boolean;
  duplicate: boolean;
  flags: string[];
  nickname?: string;
  leaderboard: boolean;
  nicknameHidden: boolean;
  noticesOff: boolean;
  notifiedCount: number;
  notifiedAt?: string;
  rewardReview?: "pending" | "approved" | "rejected";
  /** Write-once `Referral leader reached at` (ISO), when recorded. */
  leaderReachedAt?: string;
  signupLocale?: string;
  /**
   * Opaque `Lead ID`, server-only: signs the referrer's own opt-out link
   * (launch-mail /unsubscribe token). Never shown on a page or to anyone else.
   */
  leadId?: string;
  /** Coarse signup country (`KR` applies the Korean advertising rules to mail). */
  signupCountry?: string;
  /**
   * Raw `Launch mail` / `Reservation mail` cells. An `unsubscribed` marker on
   * any row of an address stops every Buddy Invite mail to that address.
   */
  launchMail?: string;
  reservationMail?: string;
  email: string;
  /**
   * Memorable share code, uppercase. Absent when the column is empty or the
   * cell is not a 4–12 character A–Z0–9 code. See REFERRAL_COLUMNS.shareCode
   * for what the rich-text annotations mean.
   */
  shareCode?: string;
  /** True when the person claimed this code (annotation `code`). */
  shareCodeCustom?: boolean;
  /** True when a signup was attributed through this code (annotation `italic`). */
  shareCodeLocked?: boolean;
};

export type ExclusionReason =
  | "not_verified"
  | "unsubscribed"
  | "suspect"
  | "duplicate"
  | "blocked_flag"
  | "self_referral"
  | "disposable_domain"
  | "unknown_referrer"
  | "after_close"
  | "daily_cap";

/** A friend credited to a referrer, in credit order (by verifiedAt, then pageId). */
export type CreditedFriend = { verifiedAt: string; pageId: string };

export type ReferrerStanding = {
  refCode: string;
  credited: number;
  /** ISO instant the referrer reached each held tier (credit order). */
  reachedAt: Partial<Record<ReferralTierId, string>>;
  /** 1-based order among people who reached `leader`, or null. */
  leaderOrder: number | null;
  /** True when leaderOrder <= LEADER_LIGHT_STOCK. */
  lightEligible: boolean;
  /** Earliest instant of the referrer's last credited friend (tie-break). */
  lastCreditAt: string | null;
};

export type LedgerResult = {
  standings: Map<string, ReferrerStanding>;
  /** Counts only, for ops reports. Never per-person reasons in public output. */
  excluded: Record<ExclusionReason, number>;
};

/**
 * Ranking: credited desc, then lastCreditAt asc (reached the count first),
 * then refCode asc for determinism.
 */
export type LeaderboardEntry = {
  rank: number;
  /** Public nickname, or null → render the localized "private diver" label. */
  nickname: string | null;
  credited: number;
};

export type LeaderboardSnapshot = {
  entries: LeaderboardEntry[];
  /** ISO instant the snapshot was computed. */
  asOf: string;
  closed: boolean;
};

/** What the signed status page shows its owner. */
export type ReferralStatus = {
  credited: number;
  highestTier: ReferralTierId | null;
  nextTier: ReferralTierId | null;
  remainingToNext: number | null;
  earlyNoticeHours: number;
  lightEligible: boolean;
  /** 1-based rank on the full leaderboard, or null with 0 credited. */
  rank: number | null;
  nickname: string | null;
  leaderboard: boolean;
  nicknameHidden: boolean;
  noticesOff: boolean;
  shareUrl: string;
  closed: boolean;
  /** The owner's memorable code, or null when they do not have one yet. */
  shareCode: string | null;
  /** True when the person chose this code themselves. */
  shareCodeCustom: boolean;
  /** True when a friend has signed up through this code, so it no longer changes. */
  shareCodeLocked: boolean;
};

export type ReferralSettingsInput = {
  /** null clears the nickname. */
  nickname: string | null;
  leaderboard: boolean;
  noticesOff: boolean;
  /**
   * Server-set only, never from the request: a person whose nickname ops hid
   * picks a new one, so the hide no longer applies. Ops can hide it again.
   */
  clearHidden?: boolean;
};

export type NicknameCheck =
  | { ok: true; value: string }
  | { ok: false; reason: "too_short" | "too_long" | "contact_info" | "link" | "reserved" | "invalid_chars" };

/**
 * One share-code cell. An empty `code` clears it (and both flags). `custom`
 * and `locked` are written as the rich-text annotations `code` and `italic`.
 */
export type ShareCodeWrite = {
  code: string;
  custom: boolean;
  locked: boolean;
};

/** Read/write access the program needs. Implemented over the Notion API. */
export interface ReferralStore {
  /** Every row that has a Ref code or a Referred by value (paged fully). */
  listProgramRows(): Promise<ReferralRow[]>;
  findByRefCode(refCode: string): Promise<ReferralRow | undefined>;
  /**
   * The row that owns this memorable code (uppercase, case-insensitive).
   * On a collision the lowest page id wins, the same rule as ref codes.
   * The caller's response must not include the row's email or nickname.
   */
  findByShareCode(shareCode: string): Promise<ReferralRow | undefined>;
  /** Patches only the share-code column. */
  writeShareCode(pageId: string, input: ShareCodeWrite): Promise<void>;
  writeSettings(pageId: string, input: ReferralSettingsInput): Promise<void>;
  /**
   * Claims the notice count before sending. `leaderReachedAt` is passed only on the
   * notice that first announced Dive Leader to a row whose write-once column
   * is still empty, and is written in the same PATCH. A definitive send rejection
   * may restore the previous count and clear its newly claimed leader stamp.
   */
  markNotified(
    pageId: string,
    input: { count: number; at: string; leaderReachedAt?: string; clearLeaderReachedAt?: boolean },
  ): Promise<void>;
  /**
   * Program columns (REFERRAL_COLUMNS) missing from the database schema, by
   * name; empty when all exist. One lightweight schema read, cached briefly.
   */
  missingColumns(): Promise<string[]>;
}

/** Friend-joined / tier-reached mail, one per referrer per tick at most. */
export type ReferralNoticeMail = {
  to: string;
  locale: Locale;
  credited: number;
  /** Tiers crossed since the last announced count (may be empty). */
  crossed: ReferralTierId[];
  nextTier: ReferralTierId | null;
  remainingToNext: number | null;
  statusUrl: string;
  /**
   * The referrer's https one-click opt-out (launch-mail /unsubscribe token).
   * The mailer refuses to send without it.
   */
  unsubscribeUrl?: string;
  /** Coarse signup country; `KR` applies the Korean advertising rules. */
  signupCountry?: string;
  /** Idempotency: `${REFERRAL_PROGRAM_ID}-notice-${refCode}-${credited}`. */
  idempotencyKey: string;
};

export interface ReferralMailer {
  sendReferralNotice(input: ReferralNoticeMail): Promise<void>;
}
