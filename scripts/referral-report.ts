// Read-only Buddy Invite report for the weekly review and the launch hand-off.
//
//   node --experimental-strip-types --env-file=.env scripts/referral-report.ts [--out summary.json]
//   node --experimental-strip-types --env-file=.env scripts/referral-report.ts \
//     --with-emails --out-dir <dir> [--out summary.json]
//
// The summary is PII-free: counts, ref codes, nicknames, aggregate review
// signals. It never holds an email address or a page id. Only --with-emails
// writes address files (mode 0600, directory 0700), and only to --out-dir.
// Nothing here writes to Notion or sends mail.
//
// The ledger, leaderboard and disposable-domain list come from the core
// modules (loaded lazily by main()), so the logic below stays testable with
// fakes. The review signals only ever flag; ops decides (see the runbook).
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import type {
  LeaderboardSnapshot,
  LedgerResult,
  ReferralRow,
  ReferrerStanding,
} from "../src/lib/referral/contract.ts";
import {
  EARLY_NOTICE_HOURS,
  LEADERBOARD_SIZE,
  LEADER_LIGHT_STOCK,
  REFERRAL_PROGRAM_ID,
  REFERRAL_TIERS,
  TOP_PRIZE_WINNERS,
  highestTier,
  type ReferralTierId,
} from "../src/lib/referral/program.ts";
import { heldCount } from "../src/lib/referral/ledger.ts";

/** Review thresholds. Signals only flag a person for a human look. */
export const REVIEW = {
  topCandidates: 20,
  burstWindowMs: 10 * 60 * 1000,
  burstMinFriends: 5,
  /** Share thresholds apply once a referrer has at least this many friends. */
  minFriendsForShares: 5,
  disposableShare: 0.2,
  rareDomainShare: 0.5,
  sameValueShare: 0.8,
  fastVerifyMs: 60 * 1000,
  fastVerifyShare: 0.5,
  fastVerifyMinFriends: 3,
} as const;

/** Domains big enough that a single occurrence is not "rare". */
const COMMON_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "naver.com", "daum.net", "hanmail.net", "kakao.com", "nate.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.co.jp", "yahoo.co.kr",
  "icloud.com", "me.com", "qq.com", "163.com", "126.com", "gmx.de", "web.de", "t-online.de",
  "orange.fr", "free.fr", "uol.com.br", "bol.com.br", "proton.me", "protonmail.com",
]);

/** Friend-level facts the ledger rows do not carry. Never leave this process. */
export type RowSignals = {
  signedUpAt?: string;
  landingPath?: string;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
};

export type ReviewSignals = {
  friends: number;
  domains: { domain: string; count: number }[];
  otherDomainFriends: number;
  disposableShare: number;
  rareDomainShare: number;
  maxVerifiedInBurstWindow: number;
  sameLocaleShare: number;
  sameLandingPathShare: number;
  sameUtmShare: number;
  fastVerifyShare: number;
};

export type ReviewReason =
  | "burst_verifications"
  | "disposable_domains"
  | "rare_domains"
  | "same_locale"
  | "same_landing_path"
  | "same_utm"
  | "fast_verify";

const ZERO = 0;

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}

function share(count: number, total: number): number {
  return total === 0 ? ZERO : Math.round((count / total) * 1000) / 1000;
}

function topShare(values: (string | undefined)[]): number {
  const counts = new Map<string, number>();
  let known = 0;
  for (const value of values) {
    if (!value) continue;
    known += 1;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  // Unknown values must not look like agreement.
  return known === 0 ? ZERO : share(Math.max(...counts.values()), values.length);
}

function utmKey(signal: RowSignals | undefined): string | undefined {
  const utm = signal?.utm;
  if (!utm) return undefined;
  const parts = [utm.source, utm.medium, utm.campaign, utm.content, utm.term].map((v) => v ?? "");
  return parts.some(Boolean) ? parts.join("|") : undefined;
}

/** Largest number of friends verified inside any `windowMs` span. */
export function maxInWindow(timesMs: number[], windowMs: number): number {
  const sorted = [...timesMs].filter(Number.isFinite).sort((a, b) => a - b);
  let best = 0;
  let from = 0;
  for (let to = 0; to < sorted.length; to += 1) {
    while (sorted[to] - sorted[from] > windowMs) from += 1;
    best = Math.max(best, to - from + 1);
  }
  return best;
}

export function computeReviewSignals(
  friends: ReferralRow[],
  signals: Map<string, RowSignals>,
  population: { domainCounts: Map<string, number> },
  isDisposable: (email: string) => boolean,
): { signals: ReviewSignals; reasons: ReviewReason[] } {
  const n = friends.length;
  const perDomain = new Map<string, number>();
  let disposable = 0;
  let rare = 0;
  let fast = 0;
  let fastKnown = 0;
  for (const friend of friends) {
    const domain = domainOf(friend.email);
    perDomain.set(domain, (perDomain.get(domain) ?? 0) + 1);
    if (isDisposable(friend.email)) disposable += 1;
    if (!COMMON_DOMAINS.has(domain) && (population.domainCounts.get(domain) ?? 0) <= 1) rare += 1;
    const signedUp = Date.parse(signals.get(friend.pageId)?.signedUpAt ?? "");
    const verified = Date.parse(friend.verifiedAt ?? "");
    if (Number.isFinite(signedUp) && Number.isFinite(verified)) {
      fastKnown += 1;
      if (verified - signedUp < REVIEW.fastVerifyMs) fast += 1;
    }
  }
  // Only domains shared by two or more friends are listed, so a one-off
  // domain (often a person's own) never appears in the summary.
  const shared = [...perDomain.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out: ReviewSignals = {
    friends: n,
    domains: shared.slice(0, 8).map(([domain, count]) => ({ domain, count })),
    otherDomainFriends: n - Math.min(n, shared.slice(0, 8).reduce((sum, [, c]) => sum + c, 0)),
    disposableShare: share(disposable, n),
    rareDomainShare: share(rare, n),
    maxVerifiedInBurstWindow: maxInWindow(friends.map((f) => Date.parse(f.verifiedAt ?? "")), REVIEW.burstWindowMs),
    sameLocaleShare: topShare(friends.map((f) => f.signupLocale)),
    sameLandingPathShare: topShare(friends.map((f) => signals.get(f.pageId)?.landingPath)),
    sameUtmShare: topShare(friends.map((f) => utmKey(signals.get(f.pageId)))),
    fastVerifyShare: share(fast, fastKnown),
  };
  const reasons: ReviewReason[] = [];
  if (out.maxVerifiedInBurstWindow >= REVIEW.burstMinFriends) reasons.push("burst_verifications");
  if (n >= 1 && out.disposableShare >= REVIEW.disposableShare) reasons.push("disposable_domains");
  if (n >= REVIEW.minFriendsForShares) {
    if (out.rareDomainShare >= REVIEW.rareDomainShare) reasons.push("rare_domains");
    if (out.sameLocaleShare >= REVIEW.sameValueShare) reasons.push("same_locale");
    if (out.sameLandingPathShare >= REVIEW.sameValueShare) reasons.push("same_landing_path");
    if (out.sameUtmShare >= REVIEW.sameValueShare) reasons.push("same_utm");
  }
  if (fastKnown >= REVIEW.fastVerifyMinFriends && out.fastVerifyShare >= REVIEW.fastVerifyShare) reasons.push("fast_verify");
  return { signals: out, reasons };
}

export type Candidate = {
  refCode: string;
  nickname: string | null;
  credited: number;
  reachedAt: ReferrerStanding["reachedAt"];
  rewardReview: "pending" | "approved" | "rejected" | null;
  review_needed: boolean;
  reasons: ReviewReason[];
  signals: ReviewSignals;
};

export type ReportInput = {
  rows: ReferralRow[];
  signals: Map<string, RowSignals>;
  ledger: LedgerResult;
  leaderboard: LeaderboardSnapshot;
  now: Date;
  closesAt: Date | null;
  isDisposable: (email: string) => boolean;
};

export type ReportSummary = {
  programId: string;
  generatedAt: string;
  closesAt: string | null;
  closed: boolean;
  rowsScanned: number;
  referrers: number;
  tierCounts: Record<ReferralTierId, number>;
  excluded: LedgerResult["excluded"];
  top10: { rank: number; refCode: string; nickname: string | null; credited: number; reachedAt: ReferrerStanding["reachedAt"]; review_needed: boolean }[];
  lightAllocation: { order: number; refCode: string; nickname: string | null; reachedLeaderAt: string | null; review_needed: boolean }[];
  lightStock: number;
  leaderboardSnapshot: LeaderboardSnapshot;
  review: Candidate[];
};

/** Credit order used everywhere: credited desc, lastCreditAt asc, refCode asc. */
export function rankStandings(standings: Iterable<ReferrerStanding>): ReferrerStanding[] {
  return [...standings]
    .filter((s) => s.credited > 0)
    .sort(
      (a, b) =>
        b.credited - a.credited ||
        Date.parse(a.lastCreditAt ?? "") - Date.parse(b.lastCreditAt ?? "") ||
        (a.refCode < b.refCode ? -1 : a.refCode > b.refCode ? 1 : 0),
    );
}

/** A nickname is public by design, but never let an address slip into the summary. */
function safeNickname(value: string | undefined): string | null {
  if (!value) return null;
  return value.includes("@") ? "[redacted]" : value;
}

/** Verified friends of one referrer, as the review sees them (before caps). */
function friendsOf(refCode: string, referrer: ReferralRow | undefined, byReferrer: Map<string, ReferralRow[]>): ReferralRow[] {
  return (byReferrer.get(refCode) ?? []).filter(
    (row) =>
      row.emailVerified &&
      row.status === "verified" &&
      !row.suspect &&
      !row.duplicate &&
      row.canonicalEmail !== referrer?.canonicalEmail,
  );
}

/** Every standing in code order (the ranking drops credited 0; reward lists must not). */
function holders(standings: Iterable<ReferrerStanding>): ReferrerStanding[] {
  return [...standings].sort((a, b) => (a.refCode < b.refCode ? -1 : a.refCode > b.refCode ? 1 : 0));
}

export function buildReport(input: ReportInput): {
  summary: ReportSummary;
  ranked: ReferrerStanding[];
  rowsByRef: Map<string, ReferralRow>;
  /** Every standing, credited 0 included (held tiers after removals). */
  holders: ReferrerStanding[];
} {
  const ranked = rankStandings(input.ledger.standings.values());
  const rowsByRef = new Map<string, ReferralRow>();
  const byReferrer = new Map<string, ReferralRow[]>();
  const domainCounts = new Map<string, number>();
  // First row by page id owns a code, exactly as in the ledger.
  for (const row of [...input.rows].sort((a, b) => (a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0))) {
    if (row.refCode && !rowsByRef.has(row.refCode)) rowsByRef.set(row.refCode, row);
  }
  for (const row of input.rows) {
    if (row.referredBy) byReferrer.set(row.referredBy, [...(byReferrer.get(row.referredBy) ?? []), row]);
    const domain = domainOf(row.email);
    if (domain) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }

  const leaderMin = REFERRAL_TIERS.find((t) => t.id === "leader")?.minFriends ?? Infinity;
  const reviewSet = new Set<string>(ranked.slice(0, REVIEW.topCandidates).map((s) => s.refCode));
  for (const s of ranked) if (s.credited >= leaderMin) reviewSet.add(s.refCode);

  const review: Candidate[] = [];
  const flags = new Map<string, boolean>();
  for (const standing of ranked) {
    if (!reviewSet.has(standing.refCode)) continue;
    const referrer = rowsByRef.get(standing.refCode);
    const { signals, reasons } = computeReviewSignals(
      friendsOf(standing.refCode, referrer, byReferrer),
      input.signals,
      { domainCounts },
      input.isDisposable,
    );
    flags.set(standing.refCode, reasons.length > 0);
    review.push({
      refCode: standing.refCode,
      nickname: safeNickname(referrer?.nickname),
      credited: standing.credited,
      reachedAt: standing.reachedAt,
      rewardReview: referrer?.rewardReview ?? null,
      review_needed: reasons.length > 0,
      reasons,
      signals,
    });
  }

  // Every standing, including people whose friends were removed after a tier
  // was announced (credited may be below the tier, even 0; legal review D7).
  const all = holders(input.ledger.standings.values());
  const tierCounts = Object.fromEntries(
    REFERRAL_TIERS.map((t) => [t.id, all.filter((s) => s.reachedAt[t.id] !== undefined).length]),
  ) as Record<ReferralTierId, number>;

  const lightAllocation = all
    .filter((s) => s.leaderOrder !== null && s.leaderOrder <= LEADER_LIGHT_STOCK)
    .sort((a, b) => (a.leaderOrder ?? 0) - (b.leaderOrder ?? 0))
    .map((s) => ({
      order: s.leaderOrder as number,
      refCode: s.refCode,
      nickname: safeNickname(rowsByRef.get(s.refCode)?.nickname),
      reachedLeaderAt: s.reachedAt.leader ?? null,
      review_needed: flags.get(s.refCode) ?? false,
    }));

  const summary: ReportSummary = {
    programId: REFERRAL_PROGRAM_ID,
    generatedAt: input.now.toISOString(),
    closesAt: input.closesAt ? input.closesAt.toISOString() : null,
    closed: input.closesAt ? input.now.getTime() >= input.closesAt.getTime() : false,
    rowsScanned: input.rows.length,
    referrers: ranked.length,
    tierCounts,
    excluded: input.ledger.excluded,
    top10: ranked.slice(0, 10).map((s, index) => ({
      rank: index + 1,
      refCode: s.refCode,
      nickname: safeNickname(rowsByRef.get(s.refCode)?.nickname),
      credited: s.credited,
      reachedAt: s.reachedAt,
      review_needed: flags.get(s.refCode) ?? false,
    })),
    lightAllocation,
    lightStock: LEADER_LIGHT_STOCK,
    leaderboardSnapshot: input.leaderboard,
    review,
  };
  return { summary, ranked, rowsByRef, holders: all };
}

// ---- address files (--with-emails) -----------------------------------------

export type AddressFiles = Record<string, string>;

function csv(header: string[], lines: (string | number)[][]): string {
  const cell = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${[header, ...lines].map((line) => line.map(cell).join(",")).join("\n")}\n`;
}

/** Can receive any program mail: verified, not unsubscribed, not suspect, not a duplicate. */
export function mailable(row: ReferralRow | undefined): row is ReferralRow {
  return Boolean(
    row && row.emailVerified && row.status === "verified" && !row.suspect && !row.duplicate && row.email.includes("@"),
  );
}

/**
 * May receive a reward they reached: like `mailable`, but an unsubscribed
 * person keeps their reward (legal review D7). Their row is marked
 * `unsubscribed` so the contact is about that reward only.
 */
function rewardable(row: ReferralRow | undefined): row is ReferralRow {
  return Boolean(
    row &&
      row.emailVerified &&
      (row.status === "verified" || row.status === "unsubscribed") &&
      !row.suspect &&
      !row.duplicate &&
      row.rewardReview !== "rejected" &&
      row.email.includes("@"),
  );
}

export function buildAddressFiles(
  summary: ReportSummary,
  ranked: ReferrerStanding[],
  rowsByRef: Map<string, ReferralRow>,
  /** Every standing (buildReport `holders`); defaults to `ranked`. */
  everyone: ReferrerStanding[] = ranked,
): AddressFiles {
  const reviewByRef = new Map(summary.review.map((c) => [c.refCode, c]));
  // A rejected reward review withdraws the reward from every list below.
  // The launch notice is a mail like any other: never to an unsubscribed person.
  const notifiable = (refCode: string): ReferralRow | undefined => {
    const row = rowsByRef.get(refCode);
    return mailable(row) && row.rewardReview !== "rejected" ? row : undefined;
  };
  const rewardee = (refCode: string): ReferralRow | undefined => {
    const row = rowsByRef.get(refCode);
    return rewardable(row) ? row : undefined;
  };
  const contact = (row: ReferralRow) => (row.status === "unsubscribed" ? "unsubscribed" : "");
  const all = holders(everyone);

  const oneHour: string[][] = [];
  const twoHour: string[][] = [];
  for (const s of all) {
    const row = notifiable(s.refCode);
    if (!row) continue;
    // The held tier: a tier announced by mail stays, even if friends were removed since.
    const tier = highestTier(heldCount(row, s.credited));
    if (!tier) continue;
    (EARLY_NOTICE_HOURS[tier.id] >= 2 ? twoHour : oneHour).push([row.email, s.refCode, String(s.credited)]);
  }
  const teamMin = REFERRAL_TIERS.find((t) => t.id === "team")?.minFriends ?? Infinity;
  const team = all.flatMap((s) => {
    const row = rewardee(s.refCode);
    // Held, not only credited: a Dive Team we announced stays on this list.
    return row && heldCount(row, s.credited) >= teamMin
      ? [[row.email, s.refCode, s.credited, s.reachedAt.team ?? "", contact(row)]]
      : [];
  });
  const light = summary.lightAllocation.flatMap((entry) => {
    const row = rewardee(entry.refCode);
    return row
      ? [[entry.order, row.email, entry.refCode, entry.reachedLeaderAt ?? "", entry.review_needed ? "review_needed" : "", contact(row)]]
      : [];
  });
  const top = ranked.slice(0, TOP_PRIZE_WINNERS + 7).flatMap((s, index) => {
    const row = rewardee(s.refCode);
    const review = reviewByRef.get(s.refCode);
    return row
      ? [[index + 1, row.email, s.refCode, s.credited, review?.review_needed ? "review_needed" : "", (review?.reasons ?? []).join("|"), contact(row)]]
      : [];
  });

  return {
    "early-notice-1h.csv": csv(["email", "refCode", "credited"], oneHour),
    "early-notice-2h.csv": csv(["email", "refCode", "credited"], twoHour),
    "dive-team.csv": csv(["email", "refCode", "credited", "reachedTeamAt", "contact"], team),
    "light-winners.csv": csv(["order", "email", "refCode", "reachedLeaderAt", "flag", "contact"], light),
    "top-candidates.csv": csv(["rank", "email", "refCode", "credited", "flag", "reasons", "contact"], top),
  };
}

export async function writePrivateFiles(dir: string, files: AddressFiles): Promise<string[]> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const written: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    await writeFile(path, content, { mode: 0o600 });
    // writeFile's mode applies only to a new file and is masked by umask.
    await chmod(path, 0o600);
    written.push(name);
  }
  return written;
}

// ---- CLI --------------------------------------------------------------------

export const USAGE = `Usage: node --experimental-strip-types --env-file=<env> scripts/referral-report.ts
  [--out <summary.json>]      PII-free summary (default stdout)
  [--with-emails --out-dir <dir>]  also write 0600 address files (launch segments, Dive Team, light, top)
  [--now <ISO instant>]       compute as of this instant (default now)
Reads NOTION_API_KEY, NOTION_WAITLIST_DB_ID, WATCHDIVE_REFERRAL_CLOSES_AT. Read-only.`;

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        out: { type: "string" },
        "with-emails": { type: "boolean" },
        "out-dir": { type: "string" },
        now: { type: "string" },
        help: { type: "boolean" },
      },
    }));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
    return 1;
  }
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (values["with-emails"] && !values["out-dir"]) {
    process.stderr.write(`--with-emails needs --out-dir\n`);
    return 1;
  }
  const databaseId = (env.NOTION_WAITLIST_DB_ID ?? "").trim();
  if (!env.NOTION_API_KEY || !databaseId) {
    process.stderr.write("NOTION_API_KEY and NOTION_WAITLIST_DB_ID are required\n");
    return 1;
  }
  const now = values.now ? new Date(values.now) : new Date();
  if (!Number.isFinite(now.getTime())) {
    process.stderr.write("--now is not a valid instant\n");
    return 1;
  }

  // Core modules are loaded here so the pure logic above has no hard dependency.
  const [{ createNotionRequest, toLeadRecord }, { referralClosesAt }, ledgerMod, storeMod, eligibilityMod] =
    await Promise.all([
      import("../src/lib/verification/notionLead.ts"),
      import("../src/lib/referral/program.ts"),
      import("../src/lib/referral/ledger.ts"),
      import("../src/lib/referral/store.ts"),
      import("../src/lib/referral/eligibility.ts"),
    ]);
  const request = createNotionRequest(fetch, env);
  const store = storeMod.createNotionReferralStore(request, databaseId);
  const rows = await store.listProgramRows();
  const closesAt = referralClosesAt(env);
  const closed = closesAt ? now.getTime() >= closesAt.getTime() : false;
  const ledger = ledgerMod.computeLedger(rows, { closesAt });
  const leaderboard = ledgerMod.buildLeaderboard(rows, ledger, { size: LEADERBOARD_SIZE, now, closed });

  // Friend-level facts the store rows do not carry: signup time, path, UTM.
  const signals = new Map<string, RowSignals>();
  let cursor: string | undefined;
  do {
    const page = (await request("POST", `databases/${encodeURIComponent(databaseId)}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })) as { results?: Record<string, unknown>[]; has_more?: boolean; next_cursor?: string | null };
    for (const result of page.results ?? []) {
      const lead = toLeadRecord(result);
      if (lead) signals.set(lead.pageId, { signedUpAt: lead.signedUpAt, landingPath: lead.landingPath, utm: lead.utm });
    }
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor);

  const { summary, ranked, rowsByRef, holders: everyone } = buildReport({
    rows,
    signals,
    ledger,
    leaderboard,
    now,
    closesAt,
    isDisposable: eligibilityMod.isDisposableEmail,
  });
  const json = `${JSON.stringify(summary, null, 2)}\n`;
  if (json.includes("@")) {
    process.stderr.write("summary unexpectedly contains '@'; refusing to write it\n");
    return 2;
  }
  if (values.out) await writeFile(values.out, json, { mode: 0o600 });
  else process.stdout.write(json);
  if (values["with-emails"] && values["out-dir"]) {
    const written = await writePrivateFiles(values["out-dir"], buildAddressFiles(summary, ranked, rowsByRef, everyone));
    process.stderr.write(`wrote ${written.length} private files (0600) to ${values["out-dir"]}\n`);
  }
  return 0;
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) process.exitCode = await main(process.argv.slice(2));
