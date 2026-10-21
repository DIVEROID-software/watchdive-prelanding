// Adversarial, seeded property tests for the Buddy Invite counting, ranking,
// rewards and notices. Independent of the module tests: the ledger is checked
// against a second, deliberately naive implementation of the official rules
// (copy.ts "What counts" / "Rewards", program.ts), and every money-relevant
// outcome (credited counts, tier instants, light order of 30, top 3, Dive Team
// list, early-notice segments) is checked to be a pure function of the rows.
//
// Seeds are fixed so a failure reproduces exactly; the seed is in the message.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReferralNoticeMail, ReferralRow } from "../src/lib/referral/contract.ts";
import { isDisposableEmail, normalizeRefCode } from "../src/lib/referral/eligibility.ts";
import {
  buildLeaderboard,
  computeLedger,
  creditDayKey,
  heldCount,
  rankedStandings,
  statusFor,
} from "../src/lib/referral/ledger.ts";
import {
  noticeIdempotencyKey,
  optOutAddressKey,
  optedOutAddresses,
  runReferralNotices,
} from "../src/lib/referral/notices.ts";
import {
  DAILY_CREDIT_CAP,
  LEADER_LIGHT_STOCK,
  NOTICE_MIN_INTERVAL_MS,
  REFERRAL_TIERS,
  TOP_PRIZE_WINNERS,
  tiersCrossed,
  tiersHeld,
} from "../src/lib/referral/program.ts";
import { referralIdentityKey } from "../src/lib/referral/identity.ts";
import { createNotionReferralStore, toReferralRow } from "../src/lib/referral/store.ts";
import { conversionBlocked } from "../src/lib/verification/contracts.ts";
import type { NotionRequest } from "../src/lib/verification/notionLead.ts";
import { buildAddressFiles, buildReport, rankStandings } from "../scripts/referral-report.ts";

// ---- seeded randomness ------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = ReturnType<typeof mulberry32>;
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const chance = (rng: Rng, p: number) => rng() < p;

function shuffle<T>(rng: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** Korea has had no DST since 1988, so a fixed +9h is the whole rule. */
function kstDay(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

const BASE = Date.parse("2026-10-23T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function code8(rng: Rng): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += pick(rng, [...alphabet]);
  return out;
}

function baseRow(
  id: number,
  refCode: string,
  person: string,
  overrides: Partial<ReferralRow> = {},
): ReferralRow {
  return {
    pageId: `page-${String(id).padStart(5, "0")}`,
    refCode,
    canonicalEmail: person,
    email: person,
    status: "verified",
    emailVerified: true,
    verifiedAt: new Date(BASE).toISOString(),
    suspect: false,
    duplicate: false,
    flags: [],
    leaderboard: false,
    nicknameHidden: false,
    noticesOff: false,
    notifiedCount: 0,
    ...overrides,
  };
}

/**
 * A messy waitlist: referrers that are also friends, hot codes that hit the
 * daily cap, the same person signing up twice (and through different links),
 * self-referrals, disposable domains, abusive flags, unconfirmed and
 * unsubscribed rows, unparseable dates, verifications clustered on the KST
 * midnight, codes with stray case/whitespace, unknown codes, and sometimes a
 * close instant equal to some friend's `Verified at`.
 */
function randomRows(seed: number): { rows: ReferralRow[]; closesAt: Date | null } {
  const rng = mulberry32(seed);
  const n = 40 + Math.floor(rng() * 160);
  const people = Array.from({ length: Math.ceil(n * 0.85) }, (_, i) => {
    const domain = chance(rng, 0.06)
      ? pick(rng, ["mailinator.com", "x.yopmail.com", "sharklasers.com"])
      : pick(rng, ["gmail.com", "naver.com", "example.com", "divers.example"]);
    return `p${seed}-${i}@${domain}`;
  });
  const codes = Array.from({ length: n }, () => code8(rng));
  const hot = [codes[0], codes[1], codes[2]];
  const rows: ReferralRow[] = [];
  for (let i = 0; i < n; i++) {
    const person = pick(rng, people);
    // Verifications land on 4 KST days; a third of them within 20 minutes of
    // a KST midnight (15:00Z), where an off-by-one day bucket would show.
    const day = Math.floor(rng() * 4);
    const at = chance(rng, 0.33)
      ? BASE + day * 24 * HOUR + 15 * HOUR + Math.floor((rng() - 0.5) * 40 * 60 * 1000)
      : BASE + Math.floor(rng() * 4 * 24 * HOUR);
    const verifiedAt = chance(rng, 0.04)
      ? undefined
      : chance(rng, 0.02)
        ? "not-a-date"
        : new Date(at).toISOString();
    let referredBy: string | undefined;
    const r = rng();
    if (r < 0.35) referredBy = pick(rng, hot);
    else if (r < 0.75) referredBy = pick(rng, codes);
    else if (r < 0.8)
      referredBy = code8(rng); // unknown code
    else if (r < 0.82) referredBy = codes[i]; // own code
    if (referredBy && chance(rng, 0.1)) referredBy = ` ${referredBy.toUpperCase()} `;
    const flags = chance(rng, 0.85)
      ? []
      : [pick(rng, ["ip-repeat", "disposable", "honeypot", "headless", "measurement-withdrawn"])];
    rows.push(
      baseRow(i, codes[i], person, {
        ...(referredBy ? { referredBy } : {}),
        // Rows older than the canonical column read "" in some fakes; the
        // ledger falls back to the address.
        canonicalEmail: chance(rng, 0.05) ? "" : person,
        status: pick(rng, [
          "verified",
          "verified",
          "verified",
          "verified",
          "pending",
          "unsubscribed",
          "legacy",
        ]),
        emailVerified: chance(rng, 0.9),
        ...(verifiedAt ? { verifiedAt } : { verifiedAt: undefined }),
        suspect: chance(rng, 0.05),
        duplicate: chance(rng, 0.03),
        flags,
        leaderboard: chance(rng, 0.5),
        nickname: chance(rng, 0.5) ? `diver${i}` : undefined,
        noticesOff: chance(rng, 0.1),
        // Announced counts, sometimes above what is credited now (friends
        // removed after the mail), sometimes with an unreadable timestamp.
        ...(chance(rng, 0.15)
          ? {
              notifiedCount: Math.floor(rng() * 14),
              ...(chance(rng, 0.9)
                ? { notifiedAt: new Date(at + Math.floor(rng() * 6 * HOUR)).toISOString() }
                : {}),
            }
          : {}),
        ...(chance(rng, 0.08)
          ? { rewardReview: pick(rng, ["pending", "approved", "rejected"] as const) }
          : {}),
      }),
    );
  }
  // Self-referral by the same person under a different row.
  for (let k = 0; k < 3; k++) {
    const target = rows[Math.floor(rng() * rows.length)];
    rows.push(
      baseRow(n + k, code8(rng), target.canonicalEmail || target.email, {
        referredBy: target.refCode,
        verifiedAt: new Date(BASE + Math.floor(rng() * 4 * 24 * HOUR)).toISOString(),
      }),
    );
  }
  let closesAt: Date | null = null;
  const c = rng();
  if (c < 0.3) {
    const withDate = rows.filter(
      (row) => row.verifiedAt && Number.isFinite(Date.parse(row.verifiedAt)),
    );
    if (withDate.length) closesAt = new Date(pick(rng, withDate).verifiedAt as string);
  } else if (c < 0.6) {
    closesAt = new Date(BASE + Math.floor(rng() * 4 * 24 * HOUR));
  }
  return { rows, closesAt };
}

// ---- independent oracle of the official rules ------------------------------

type OracleStanding = { credited: number; times: number[] };

function oracle(rows: readonly ReferralRow[], closesAt: Date | null) {
  const atOf = (row: ReferralRow) => {
    const ms = row.verifiedAt ? Date.parse(row.verifiedAt) : NaN;
    return Number.isFinite(ms) ? ms : null;
  };
  const owner = new Map<string, ReferralRow>();
  for (const row of [...rows].sort((a, b) => (a.pageId < b.pageId ? -1 : 1))) {
    const code = row.refCode.trim().toLowerCase();
    if (code && !owner.has(code)) owner.set(code, row);
  }
  const personOf = (row: ReferralRow) => row.canonicalEmail || row.email.trim().toLowerCase();

  // The same mailbox under either key: the signup's canonical email (or the
  // address when the column is empty) or the referral identity key
  // (documented provider aliases, identity.ts, tested on its own).
  const identityOf = (row: ReferralRow) => {
    const key = referralIdentityKey(row.email);
    return key.includes("@") ? key : "";
  };
  const samePerson = (a: ReferralRow, b: ReferralRow) =>
    (a.canonicalEmail !== "" && a.canonicalEmail === b.canonicalEmail) ||
    (identityOf(a) !== "" && identityOf(a) === identityOf(b));

  // "Repeat sign-ups by the same person do not count": a person's first
  // confirmed sign-up is the only one that may be a friend. Rows ops marked
  // Duplicate are, by that mark, not the person's sign-up of record. Naive
  // on purpose: a friend is a repeat when any earlier confirmed row shares
  // either key with it.
  const recordRows = rows.filter(
    (row) => row.emailVerified && atOf(row) !== null && !row.duplicate,
  );
  const isRepeat = (friend: ReferralRow, at: number) =>
    recordRows.some((row) => {
      if (row.pageId === friend.pageId) return false;
      const sharesKey =
        (personOf(row) !== "" && personOf(row) === personOf(friend)) ||
        (identityOf(row) !== "" && identityOf(row) === identityOf(friend));
      const rowAt = atOf(row) as number;
      return sharesKey && (rowAt < at || (rowAt === at && row.pageId < friend.pageId));
    });

  const countable: { code: string; at: number; pageId: string }[] = [];
  let referred = 0;
  for (const friend of rows) {
    const code = (friend.referredBy ?? "").trim().toLowerCase();
    if (!code) continue;
    referred++;
    const ref = owner.get(code);
    const at = atOf(friend);
    if (!ref) continue;
    if (ref.pageId === friend.pageId || friend.refCode.trim().toLowerCase() === code) continue;
    if (samePerson(friend, ref)) continue;
    // D7: a confirmation stands after an unsubscribe.
    if (
      !(friend.status === "verified" || friend.status === "unsubscribed") ||
      !friend.emailVerified ||
      at === null
    )
      continue;
    if (friend.suspect || friend.duplicate) continue;
    if (isDisposableEmail(friend.email) || friend.flags.includes("disposable")) continue;
    if (conversionBlocked(friend.flags)) continue;
    if (closesAt && at >= closesAt.getTime()) continue;
    if (isRepeat(friend, at)) continue;
    countable.push({ code, at, pageId: friend.pageId });
  }
  countable.sort((a, b) => a.at - b.at || (a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0));
  const perDay = new Map<string, number>();
  const byCode = new Map<string, OracleStanding>();
  for (const item of countable) {
    const key = `${item.code}|${kstDay(item.at)}`;
    const today = perDay.get(key) ?? 0;
    if (today >= DAILY_CREDIT_CAP) continue;
    perDay.set(key, today + 1);
    const s = byCode.get(item.code) ?? { credited: 0, times: [] };
    s.credited++;
    s.times.push(item.at);
    byCode.set(item.code, s);
  }
  // D7: unsubscribed referrers keep their standing; rejected ones lose it.
  const eligibleReferrer = (row: ReferralRow) =>
    (row.status === "verified" || row.status === "unsubscribed") &&
    row.emailVerified &&
    atOf(row) !== null &&
    !row.suspect &&
    !row.duplicate &&
    !conversionBlocked(row.flags) &&
    row.rewardReview !== "rejected";
  const standings = new Map<string, OracleStanding>();
  for (const [code, s] of byCode) {
    const ref = owner.get(code);
    if (ref && eligibleReferrer(ref)) standings.set(code, s);
  }
  // Held tiers (D7): the announced count keeps tiers; the instant of a held
  // tier is never later than the notice that announced it.
  const reached = new Map<string, Partial<Record<string, number>>>();
  for (const [code, ref] of owner) {
    if (!eligibleReferrer(ref)) continue;
    const times = standings.get(code)?.times ?? [];
    const notice = ref.notifiedAt ? Date.parse(ref.notifiedAt) : NaN;
    const out: Partial<Record<string, number>> = {};
    for (const tier of REFERRAL_TIERS) {
      const candidates: number[] = [];
      if (times.length >= tier.minFriends) candidates.push(times[tier.minFriends - 1]);
      if (ref.notifiedCount >= tier.minFriends && Number.isFinite(notice)) candidates.push(notice);
      if (candidates.length) out[tier.id] = Math.min(...candidates);
    }
    if (times.length || ref.notifiedCount > 0) reached.set(code, out);
  }
  return { standings, perDay, referred, creditedTotal: countable.length, reached, owner };
}

const SEEDS = Array.from({ length: 300 }, (_, i) => 1000 + i * 7919);

// ---- ledger vs oracle -------------------------------------------------------

test("ledger matches an independent implementation of the rules (300 seeded row sets)", () => {
  for (const seed of SEEDS) {
    const { rows, closesAt } = randomRows(seed);
    const ledger = computeLedger(rows, { closesAt });
    const expected = oracle(rows, closesAt);
    const actual = new Map(
      [...ledger.standings]
        .filter(([, s]) => s.credited > 0)
        .map(([code, s]) => [code, s.credited]),
    );
    const want = new Map([...expected.standings].map(([code, s]) => [code, s.credited]));
    assert.deepEqual(actual, want, `seed ${seed}: credited per referrer`);
    assert.deepEqual(
      [...ledger.standings.keys()].sort(),
      [...expected.reached.keys()].sort(),
      `seed ${seed}: who holds a standing`,
    );
    for (const [code, s] of ledger.standings) {
      const times = expected.standings.get(code)?.times ?? [];
      const want = expected.reached.get(code)!;
      for (const tier of REFERRAL_TIERS) {
        const at = want[tier.id];
        assert.equal(
          s.reachedAt[tier.id],
          at === undefined ? undefined : new Date(at).toISOString(),
          `seed ${seed}: ${code} ${tier.id} instant`,
        );
      }
      assert.equal(
        s.lastCreditAt,
        times.length ? new Date(times[times.length - 1]).toISOString() : null,
        `seed ${seed}: lastCreditAt`,
      );
      // A held tier is never lost to a removal: status shows at least the announced tier.
      const row = expected.owner.get(code)!;
      const status = statusFor(row, ledger, { shareUrl: "s", closed: false });
      const heldTiers = tiersHeld(Math.max(s.credited, row.notifiedCount));
      assert.equal(
        status.highestTier,
        heldTiers.length ? heldTiers[heldTiers.length - 1].id : null,
        `seed ${seed}: held tier`,
      );
      assert.equal(status.credited, s.credited);
      if (status.remainingToNext !== null) assert.ok(status.remainingToNext >= 1);
    }
  }
});

test("conservation: every referred row is either credited, held for an ineligible referrer, or excluded once", () => {
  for (const seed of SEEDS) {
    const { rows, closesAt } = randomRows(seed);
    const ledger = computeLedger(rows, { closesAt });
    const referred = rows.filter((row) => normalizeRefCode(row.referredBy)).length;
    const credited = [...ledger.standings.values()].reduce((sum, s) => sum + s.credited, 0);
    const excluded = Object.values(ledger.excluded).reduce((sum, n) => sum + n, 0);
    assert.equal(credited + ledger.ineligibleReferrerCredits + excluded, referred, `seed ${seed}`);
    for (const value of Object.values(ledger.excluded))
      assert.ok(Number.isInteger(value) && value >= 0);
  }
});

test("daily cap: no referrer is credited more than DAILY_CREDIT_CAP friends on one KST day", () => {
  for (const seed of SEEDS) {
    const { rows, closesAt } = randomRows(seed);
    const { perDay } = oracle(rows, closesAt);
    for (const [key, count] of perDay) assert.ok(count <= DAILY_CREDIT_CAP, `seed ${seed} ${key}`);
    // The production bucket agrees with fixed-offset arithmetic at every instant used.
    for (const row of rows) {
      const ms = row.verifiedAt ? Date.parse(row.verifiedAt) : NaN;
      if (Number.isFinite(ms))
        assert.equal(creditDayKey(ms), kstDay(ms), `seed ${seed}: ${row.verifiedAt}`);
    }
  }
});

test("no friend is credited twice, to two referrers, or at all when excluded", () => {
  for (const seed of SEEDS.slice(0, 120)) {
    const { rows, closesAt } = randomRows(seed);
    const base = computeLedger(rows, { closesAt });
    const total = (l: typeof base) =>
      [...l.standings.values()].reduce((s, x) => s + x.credited, 0) + l.ineligibleReferrerCredits;
    // Cut each friend's link in turn (the row stays, it may be a referrer
    // too): totals drop by 0 or 1, so it was counted at most once, for at
    // most one referrer, and an excluded friend (drop 0) frees nothing extra.
    const rng = mulberry32(seed);
    const referred = rows.filter((row) => normalizeRefCode(row.referredBy));
    for (const victim of shuffle(rng, referred).slice(0, 15)) {
      const cut = rows.map((row) => (row === victim ? { ...row, referredBy: undefined } : row));
      const drop = total(base) - total(computeLedger(cut, { closesAt }));
      assert.ok(drop === 0 || drop === 1, `seed ${seed}: cutting one link dropped ${drop}`);
    }
  }
});

test("withdrawing a friend (Suspect, unsubscribe, abusive flag) never raises anyone's count", () => {
  for (const seed of SEEDS) {
    const { rows, closesAt } = randomRows(seed);
    const before = computeLedger(rows, { closesAt });
    const rng = mulberry32(seed ^ 0x5eed);
    const referred = rows.filter((row) => normalizeRefCode(row.referredBy));
    for (const victim of shuffle(rng, referred).slice(0, 10)) {
      const changes: Partial<ReferralRow>[] = [
        { suspect: true },
        { flags: [...victim.flags, "honeypot"] },
      ];
      if (victim.status === "verified") changes.push({ status: "unsubscribed" });
      for (const change of changes) {
        const after = computeLedger(
          rows.map((row) => (row === victim ? { ...row, ...change } : row)),
          { closesAt },
        );
        for (const [code, s] of after.standings) {
          const prior = before.standings.get(code)?.credited ?? 0;
          assert.ok(
            s.credited <= prior,
            `seed ${seed}: ${JSON.stringify(change)} on ${victim.pageId} raised ${code} ${prior}→${s.credited}`,
          );
          // D7: a friend unsubscribing after confirming changes nothing.
          if (change.status === "unsubscribed" && victim.referredBy)
            assert.equal(s.credited, prior);
        }
      }
    }
  }
});

test("a repeat sign-up by the same person never counts, whichever link it used", () => {
  const referrerA = baseRow(1, "aaaaaaaa", "a@example.com");
  const referrerB = baseRow(2, "bbbbbbbb", "b@example.com");
  // The person joined directly first (no link), then a second row for the
  // same canonical inbox came in through A's link (a race the signup dedupe
  // missed; ops have not ticked Duplicate yet).
  const direct = baseRow(3, "cccccccc", "f@gmail.com", { verifiedAt: "2026-10-23T01:00:00.000Z" });
  const repeat = baseRow(4, "dddddddd", "f@gmail.com", {
    email: "f+x@gmail.com",
    referredBy: "aaaaaaaa",
    verifiedAt: "2026-10-23T02:00:00.000Z",
  });
  let ledger = computeLedger([referrerA, referrerB, direct, repeat], { closesAt: null });
  assert.equal(ledger.standings.get("aaaaaaaa")?.credited ?? 0, 0);
  assert.equal(ledger.excluded.duplicate, 1);

  // First sign-up was flagged Suspect: the person's later sign-up through B is
  // still a repeat, not a fresh friend.
  const flagged = { ...direct, referredBy: "aaaaaaaa", suspect: true };
  const again = { ...repeat, referredBy: "bbbbbbbb" };
  ledger = computeLedger([referrerA, referrerB, flagged, again], { closesAt: null });
  assert.equal(ledger.standings.get("aaaaaaaa")?.credited ?? 0, 0);
  assert.equal(ledger.standings.get("bbbbbbbb")?.credited ?? 0, 0);

  // Ops ticking Duplicate on the earlier row names the later one the record.
  ledger = computeLedger([referrerA, { ...direct, duplicate: true }, repeat], { closesAt: null });
  assert.equal(ledger.standings.get("aaaaaaaa")?.credited, 1);
});

// ---- determinism and ranking -------------------------------------------------

test("ledger, ranking, leaderboard and status are invariant under input shuffles", () => {
  for (const seed of SEEDS.slice(0, 150)) {
    const { rows, closesAt } = randomRows(seed);
    const now = new Date(BASE + 5 * 24 * HOUR);
    const ledger = computeLedger(rows, { closesAt });
    const board = buildLeaderboard(rows, ledger, { size: TOP_PRIZE_WINNERS, now, closed: false });
    const rng = mulberry32(seed + 1);
    for (let k = 0; k < 4; k++) {
      const mixed = shuffle(rng, rows);
      const other = computeLedger(mixed, { closesAt });
      assert.deepEqual(
        [...other.standings.entries()],
        [...ledger.standings.entries()],
        `seed ${seed}`,
      );
      assert.deepEqual(other.excluded, ledger.excluded, `seed ${seed}`);
      assert.deepEqual(rankedStandings(other), rankedStandings(ledger), `seed ${seed}`);
      assert.deepEqual(
        buildLeaderboard(mixed, other, { size: TOP_PRIZE_WINNERS, now, closed: false }),
        board,
      );
      for (const row of rows.slice(0, 10)) {
        assert.deepEqual(
          statusFor(row, other, { shareUrl: "s", closed: false }),
          statusFor(row, ledger, { shareUrl: "s", closed: false }),
        );
      }
    }
  }
});

test("ranking is a strict total order: credited desc, reached-it-first, then code", () => {
  for (const seed of SEEDS) {
    const { rows, closesAt } = randomRows(seed);
    const ledger = computeLedger(rows, { closesAt });
    const ranked = rankedStandings(ledger);
    assert.equal(
      ranked.length,
      [...ledger.standings.values()].filter((s) => s.credited > 0).length,
    );
    for (let i = 1; i < ranked.length; i++) {
      const a = ranked[i - 1];
      const b = ranked[i];
      const before =
        a.credited > b.credited ||
        (a.credited === b.credited && Date.parse(a.lastCreditAt!) < Date.parse(b.lastCreditAt!)) ||
        (a.credited === b.credited && a.lastCreditAt === b.lastCreditAt && a.refCode < b.refCode);
      assert.ok(before, `seed ${seed}: ${a.refCode} before ${b.refCode}`);
    }
    // The ops report ranks with its own comparator; it must agree exactly, or
    // the top-3 file and the public board could name different people.
    assert.deepEqual(rankStandings(ledger.standings.values()), ranked, `seed ${seed}`);
    // Status rank is the position on that same order.
    ranked.forEach((s, index) => {
      const row = rows.find((r) => r.refCode.trim().toLowerCase() === s.refCode)!;
      assert.equal(statusFor(row, ledger, { shareUrl: "s", closed: false }).rank, index + 1);
    });
    const board = buildLeaderboard(rows, ledger, {
      size: TOP_PRIZE_WINNERS,
      now: new Date(BASE),
      closed: false,
    });
    assert.deepEqual(
      board.entries.map((e) => e.credited),
      ranked.slice(0, TOP_PRIZE_WINNERS).map((s) => s.credited),
    );
    assert.deepEqual(
      board.entries.map((e) => e.rank),
      board.entries.map((_, i) => i + 1),
    );
  }
});

/** `count` referrers each reaching 10+ friends, at scattered instants. */
function leaderRows(seed: number, count: number) {
  const rng = mulberry32(seed);
  const rows: ReferralRow[] = [];
  let id = 0;
  for (let r = 0; r < count; r++) {
    const code = `l${String(r).padStart(7, "0")}`;
    rows.push(baseRow(id++, code, `leader${r}@example.com`));
    const friends = 10 + Math.floor(rng() * 5);
    // Two KST days so the cap (10/day) is not what decides, plus ties: some
    // referrers' 10th friend lands on the exact same millisecond.
    const tenth = BASE + Math.floor(rng() * 6) * HOUR;
    for (let f = 0; f < friends; f++) {
      // Friends 1–9 on day one; the 10th and later the next KST day.
      const at = f >= 9 ? tenth + 25 * HOUR + (f - 9) * 1000 : BASE + Math.floor(rng() * 5 * HOUR);
      rows.push(
        baseRow(id++, `f${String(id).padStart(7, "0")}`, `f${seed}-${r}-${f}@example.com`, {
          referredBy: code,
          verifiedAt: new Date(at).toISOString(),
        }),
      );
    }
  }
  return rows;
}

test("light order: contiguous 1..n by the instant of the 10th friend; exactly the first 30 are eligible", () => {
  for (const seed of SEEDS.slice(0, 60)) {
    const rows = leaderRows(seed, 45);
    const ledger = computeLedger(rows, { closesAt: null });
    const leaders = [...ledger.standings.values()].filter((s) => s.reachedAt.leader);
    const orders = leaders.map((s) => s.leaderOrder).sort((a, b) => a! - b!);
    assert.deepEqual(
      orders,
      leaders.map((_, i) => i + 1),
      `seed ${seed}`,
    );
    for (const s of ledger.standings.values()) {
      if (!s.reachedAt.leader) {
        assert.equal(s.leaderOrder, null);
        assert.equal(s.lightEligible, false);
        continue;
      }
      assert.equal(s.lightEligible, s.leaderOrder! <= LEADER_LIGHT_STOCK, `seed ${seed}`);
    }
    const byOrder = [...leaders].sort((a, b) => a.leaderOrder! - b.leaderOrder!);
    for (let i = 1; i < byOrder.length; i++) {
      const a = byOrder[i - 1];
      const b = byOrder[i];
      const ta = Date.parse(a.reachedAt.leader!);
      const tb = Date.parse(b.reachedAt.leader!);
      assert.ok(ta < tb || (ta === tb && a.refCode < b.refCode), `seed ${seed}: light order`);
    }
    assert.equal(
      leaders.filter((s) => s.lightEligible).length,
      Math.min(LEADER_LIGHT_STOCK, leaders.length),
    );
  }
});

test("D7: a Dive Leader who unsubscribes keeps the light; a suspect or rejected one frees it for the next in order", () => {
  const rows = leaderRows(77, 32);
  const before = computeLedger(rows, { closesAt: null });
  const first = [...before.standings.values()].find((s) => s.leaderOrder === 1)!;
  const thirtyFirst = [...before.standings.values()].find((s) => s.leaderOrder === 31)!;
  assert.equal(thirtyFirst.lightEligible, false);

  const unsub = rows.map((row) =>
    row.refCode === first.refCode ? { ...row, status: "unsubscribed" } : row,
  );
  const kept = computeLedger(unsub, { closesAt: null });
  assert.deepEqual(kept.standings.get(first.refCode), first);
  assert.equal(kept.standings.get(thirtyFirst.refCode)!.lightEligible, false);
  const status = statusFor(
    unsub.find((r) => r.refCode === first.refCode)!,
    kept,
    { shareUrl: "s", closed: false },
  );
  assert.equal(status.credited, first.credited);
  assert.equal(status.lightEligible, true);
  assert.equal(
    status.rank,
    rankedStandings(kept).findIndex((s) => s.refCode === first.refCode) + 1,
  );

  for (const change of [
    { suspect: true },
    { rewardReview: "rejected" as const },
    { duplicate: true },
  ]) {
    const changed = rows.map((row) =>
      row.refCode === first.refCode ? { ...row, ...change } : row,
    );
    const after = computeLedger(changed, { closesAt: null });
    assert.equal(after.standings.has(first.refCode), false, JSON.stringify(change));
    assert.equal(after.standings.get(thirtyFirst.refCode)!.leaderOrder, 30);
    assert.equal(after.standings.get(thirtyFirst.refCode)!.lightEligible, true);
    assert.equal(after.ineligibleReferrerCredits, first.credited);
    const lost = statusFor(
      changed.find((r) => r.refCode === first.refCode)!,
      after,
      { shareUrl: "s", closed: false },
    );
    assert.equal(lost.credited, 0);
    assert.equal(lost.rank, null);
    assert.equal(lost.highestTier, null);
    assert.equal(lost.lightEligible, false);
  }
});

test("D7: a told Dive Leader whose friends are removed keeps the tier and a light place no later than the notice", () => {
  const rows = leaderRows(78, 32);
  const before = computeLedger(rows, { closesAt: null });
  const third = [...before.standings.values()].find((s) => s.leaderOrder === 3)!;
  const reached = Date.parse(third.reachedAt.leader!);
  // Told by mail 30 minutes after the 10th friend; then 4 friends are removed.
  const noticeAt = new Date(reached + 30 * 60 * 1000).toISOString();
  let removed = 0;
  const changed = rows.map((row) => {
    if (row.refCode === third.refCode)
      return { ...row, notifiedCount: third.credited, notifiedAt: noticeAt };
    if (row.referredBy === third.refCode && removed < 4) {
      removed++;
      return { ...row, suspect: true };
    }
    return row;
  });
  const after = computeLedger(changed, { closesAt: null });
  const standing = after.standings.get(third.refCode)!;
  assert.ok(standing.credited < 10);
  assert.equal(standing.reachedAt.leader, noticeAt);
  assert.ok(standing.leaderOrder! <= LEADER_LIGHT_STOCK);
  assert.equal(standing.lightEligible, true);
  const status = statusFor(
    changed.find((r) => r.refCode === third.refCode)!,
    after,
    { shareUrl: "s", closed: false },
  );
  assert.equal(status.highestTier, "leader");
  assert.equal(status.nextTier, null);
  assert.equal(status.earlyNoticeHours, 2);
  // The ranking (top 3) uses what is credited now.
  assert.equal(
    rankedStandings(after).find((s) => s.refCode === third.refCode)!.credited,
    standing.credited,
  );

  // Every friend removed: the held standing remains with credited 0, off the ranking.
  const allGone = changed.map((row) =>
    row.referredBy === third.refCode ? { ...row, suspect: true } : row,
  );
  const empty = computeLedger(allGone, { closesAt: null }).standings.get(third.refCode)!;
  assert.equal(empty.credited, 0);
  assert.equal(empty.lastCreditAt, null);
  assert.equal(empty.reachedAt.leader, noticeAt);
  assert.equal(empty.lightEligible, true);

  // Rejected: only what is credited now, and the standing goes.
  const rejected = changed.map((row) =>
    row.refCode === third.refCode ? { ...row, rewardReview: "rejected" as const } : row,
  );
  assert.equal(computeLedger(rejected, { closesAt: null }).standings.has(third.refCode), false);
});

test("D7: a friend who confirmed and later unsubscribed keeps counting; one who never confirmed does not", () => {
  const ref = baseRow(0, "unsubref", "ref@example.com");
  const confirmedThenLeft = baseRow(1, "unsubf01", "u1@example.com", {
    referredBy: "unsubref",
    status: "unsubscribed",
  });
  const leftUnconfirmed = baseRow(2, "unsubf02", "u2@example.com", {
    referredBy: "unsubref",
    status: "unsubscribed",
    emailVerified: false,
    verifiedAt: undefined,
  });
  const ledger = computeLedger([ref, confirmedThenLeft, leftUnconfirmed], { closesAt: null });
  assert.equal(ledger.standings.get("unsubref")!.credited, 1);
  assert.equal(ledger.excluded.unsubscribed, 1);
});

// ---- tiers ------------------------------------------------------------------

test("tiersCrossed: sums, composes, never negative, never repeats", () => {
  for (let a = 0; a <= 15; a++) {
    for (let b = 0; b <= 15; b++) {
      const crossed = tiersCrossed(a, b);
      if (b <= a) assert.deepEqual(crossed, [], `${a}→${b}`);
      else assert.equal(crossed.length, tiersHeld(b).length - tiersHeld(a).length, `${a}→${b}`);
      for (let c = b; c <= 15; c++) {
        if (a <= b) {
          assert.deepEqual(
            [...tiersCrossed(a, b), ...tiersCrossed(b, c)].map((t) => t.id),
            tiersCrossed(a, c).map((t) => t.id),
          );
        }
      }
    }
  }
});

// ---- instants ---------------------------------------------------------------

test("KST midnight: 10 friends at 23:59:59.999 KST and the 11th at 00:00:00.000 KST all count", () => {
  const ref = baseRow(0, "kstkst00", "ref@example.com");
  const day1 = Date.parse("2026-10-23T14:59:59.999Z"); // 23:59:59.999 KST on 23 Oct
  const friends = Array.from({ length: 10 }, (_, i) =>
    baseRow(i + 1, `kf${String(i).padStart(6, "0")}`, `k${i}@example.com`, {
      referredBy: "kstkst00",
      verifiedAt: new Date(day1 - i).toISOString(),
    }),
  );
  const atMidnight = baseRow(50, "kf000050", "k50@example.com", {
    referredBy: "kstkst00",
    verifiedAt: "2026-10-23T15:00:00.000Z",
  });
  const oneMsEarlier = { ...atMidnight, verifiedAt: "2026-10-23T14:59:59.999Z" };
  assert.equal(
    computeLedger([ref, ...friends, atMidnight], { closesAt: null }).standings.get("kstkst00")!
      .credited,
    11,
  );
  const capped = computeLedger([ref, ...friends, oneMsEarlier], { closesAt: null });
  assert.equal(capped.standings.get("kstkst00")!.credited, 10);
  assert.equal(capped.excluded.daily_cap, 1);
  // A cap-excluded friend never rolls over to the next day.
  const later = baseRow(51, "kf000051", "k51@example.com", {
    referredBy: "kstkst00",
    verifiedAt: "2026-10-24T01:00:00.000Z",
  });
  assert.equal(
    computeLedger([ref, ...friends, oneMsEarlier, later], { closesAt: null }).standings.get(
      "kstkst00",
    )!.credited,
    11,
  );
  // Offsets in the stored string do not matter, only the instant.
  const offset = { ...atMidnight, verifiedAt: "2026-10-24T00:00:00.000+09:00" };
  assert.equal(
    computeLedger([ref, ...friends, offset], { closesAt: null }).standings.get("kstkst00")!
      .credited,
    11,
  );
});

test("close instant: a friend verified exactly at the close does not count, 1 ms before does", () => {
  const close = new Date("2026-12-01T00:00:00.000Z");
  const ref = baseRow(0, "closecls", "ref@example.com");
  const at = baseRow(1, "closef01", "f1@example.com", {
    referredBy: "closecls",
    verifiedAt: close.toISOString(),
  });
  const before = baseRow(2, "closef02", "f2@example.com", {
    referredBy: "closecls",
    verifiedAt: new Date(close.getTime() - 1).toISOString(),
  });
  const ledger = computeLedger([ref, at, before], { closesAt: close });
  assert.equal(ledger.standings.get("closecls")!.credited, 1);
  assert.equal(ledger.excluded.after_close, 1);
  // The report calls the contest closed at the same instant the ledger stops counting.
  const report = buildReport({
    rows: [ref, at, before],
    signals: new Map(),
    ledger,
    leaderboard: buildLeaderboard([ref, at, before], ledger, { size: 3, now: close, closed: true }),
    now: close,
    closesAt: close,
    isDisposable: isDisposableEmail,
  });
  assert.equal(report.summary.closed, true);
});

// ---- notices ----------------------------------------------------------------

// Every notice carries the referrer's signed one-click opt-out, so the pass
// needs the launch-mail signing secret and each referrer's Lead ID; without
// either it sends nothing (skippedNoOptOut).
const ON = {
  WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1",
  WATCHDIVE_REFERRAL_NOTICES_ENABLED: "1",
  WATCHDIVE_VERIFICATION_SECRET: "adversarial-unsubscribe-secret-32bytes+",
};

/** A valid v4-shaped Lead ID per row number, as createPending would mint one. */
function leadIdFor(id: number): string {
  return `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
}

test("notices over 40 random ticks: once per (code,count), never to opted-out, ineligible or shrunk referrers", async () => {
  // The random world must actually reach the opt-out paths it claims to cover.
  const covered = { skippedUnsubscribed: 0, skippedNoOptOut: 0, sent: 0 };
  for (const seed of SEEDS.slice(0, 40)) {
    const rng = mulberry32(seed);
    const rows: ReferralRow[] = [];
    let id = 0;
    const referrers: ReferralRow[] = [];
    for (let r = 0; r < 6; r++) {
      const row = baseRow(
        id++,
        `n${seed % 1000}${String(r).padStart(4, "0")}`.slice(0, 8).padEnd(8, "0"),
        `nr${seed}-${r}@example.com`,
        {
          signupLocale: pick(rng, ["ko", "en", "ja", "xx"]),
          // Referrer 5 predates Lead IDs: no signable opt-out, so never mailed.
          ...(r === 5 ? {} : { leadId: leadIdFor(id - 1) }),
        },
      );
      rows.push(row);
      referrers.push(row);
    }
    let now = BASE + 24 * HOUR;
    const sentKeys = new Map<string, number>();
    const markedKeys = new Set<string>();
    const lastMailAt = new Map<string, number>();
    const mails: ReferralNoticeMail[] = [];
    let failMark = false;
    const store = {
      async listProgramRows() {
        return rows.map((row) => ({ ...row, flags: [...row.flags] }));
      },
      async markNotified(pageId: string, input: { count: number; at: string }) {
        if (failMark) throw new Error("notion down");
        const target = rows.find((row) => row.pageId === pageId)!;
        target.notifiedCount = input.count;
        target.notifiedAt = input.at;
      },
    };
    for (let tick = 0; tick < 40; tick++) {
      // Mutate the world between ticks.
      for (let k = Math.floor(rng() * 4); k > 0; k--) {
        const ref = pick(rng, referrers);
        rows.push(
          baseRow(id++, `x${String(id).padStart(7, "0")}`, `nf${seed}-${id}@example.com`, {
            referredBy: ref.refCode,
            verifiedAt: new Date(now - Math.floor(rng() * 10 * 60 * 1000)).toISOString(),
          }),
        );
      }
      if (chance(rng, 0.2)) {
        const friends = rows.filter((row) => row.referredBy && !row.suspect);
        if (friends.length) pick(rng, friends).suspect = true;
      }
      if (chance(rng, 0.08)) pick(rng, referrers).status = pick(rng, ["unsubscribed", "verified"]);
      if (chance(rng, 0.1)) {
        const ref = pick(rng, referrers);
        ref.noticesOff = !ref.noticesOff;
      }
      if (chance(rng, 0.05)) pick(rng, referrers).suspect = chance(rng, 0.5);
      // An opt-out on another row of the same inbox (a repeat sign-up whose
      // Launch or Reservation mail cell says unsubscribed) holds every row.
      if (chance(rng, 0.04)) {
        const ref = pick(rng, referrers);
        rows.push(
          baseRow(id++, `o${String(id).padStart(7, "0")}`, ref.email.toUpperCase(), {
            status: "pending",
            emailVerified: false,
            verifiedAt: undefined,
            ...(chance(rng, 0.5)
              ? { launchMail: `unsubscribed ${new Date(now).toISOString()}` }
              : { reservationMail: "unsubscribed" }),
          }),
        );
      }
      failMark = chance(rng, 0.1);

      const snapshot = rows.map((row) => ({ ...row }));
      const ledger = computeLedger(snapshot, { closesAt: null });
      const before = mails.length;
      const result = await runReferralNotices({
        env: ON,
        store,
        mailer: {
          async sendReferralNotice(mail) {
            mails.push(mail);
          },
        },
        now: () => new Date(now),
        publicOrigin: "https://watchdive.example",
        secret: "adversarial-secret",
        closesAt: null,
        maxSends: 3,
      });
      const sentNow = mails.slice(before);
      const optedOut = optedOutAddresses(snapshot);
      covered.skippedUnsubscribed += result.skippedUnsubscribed;
      covered.skippedNoOptOut += result.skippedNoOptOut;
      covered.sent += result.sent;
      assert.equal(result.sent, sentNow.length, `seed ${seed} tick ${tick}`);
      assert.equal(
        result.pending,
        result.sent +
          result.skippedIneligible +
          result.skippedUnsubscribed +
          result.skippedNoticesOff +
          result.skippedNoOptOut +
          result.skippedInterval +
          result.deferred +
          result.sendFailed,
        `seed ${seed} tick ${tick}: pending accounting`,
      );
      assert.ok(result.sent <= 3);
      for (const mail of sentNow) {
        const owner = snapshot.find((row) => row.email === mail.to)!;
        assert.ok(owner, "mail goes to a referrer row");
        const standing = ledger.standings.get(owner.refCode)!;
        assert.ok(standing, `seed ${seed}: mail only for a referrer with a standing`);
        assert.equal(owner.status, "verified");
        assert.equal(owner.suspect, false);
        assert.equal(owner.noticesOff, false, `seed ${seed}: opted-out referrer mailed`);
        assert.equal(
          optedOut.has(optOutAddressKey(owner.email)),
          false,
          `seed ${seed}: an address unsubscribed on another row was mailed`,
        );
        assert.ok(owner.leadId, `seed ${seed}: a referrer without a Lead ID was mailed`);
        assert.ok(
          mail.unsubscribeUrl?.startsWith("https://watchdive.example/unsubscribe/"),
          `seed ${seed}: the notice carries its https opt-out`,
        );
        assert.equal(mail.credited, standing.credited);
        assert.ok(mail.credited > owner.notifiedCount, `seed ${seed}: count did not rise`);
        assert.deepEqual(
          mail.crossed,
          tiersCrossed(owner.notifiedCount, mail.credited).map((t) => t.id),
        );
        assert.ok(mail.remainingToNext === null || mail.remainingToNext >= 1);
        assert.equal(mail.idempotencyKey, noticeIdempotencyKey(owner.refCode, mail.credited));
        assert.ok(!/@|page-/.test(mail.statusUrl), "status link carries no address or page id");
        const last = lastMailAt.get(owner.refCode);
        assert.ok(
          last === undefined ||
            now - last >= NOTICE_MIN_INTERVAL_MS ||
            owner.notifiedAt === undefined ||
            Date.parse(owner.notifiedAt) !== last,
          `seed ${seed}: interval`,
        );
        // A key repeats only while every earlier send under it failed its
        // bookkeeping; the provider then collapses it onto the first message.
        if (sentKeys.has(mail.idempotencyKey))
          assert.equal(
            markedKeys.has(mail.idempotencyKey),
            false,
            `seed ${seed}: resent after bookkeeping`,
          );
        sentKeys.set(mail.idempotencyKey, (sentKeys.get(mail.idempotencyKey) ?? 0) + 1);
        if (!failMark) markedKeys.add(mail.idempotencyKey);
        const mailedRow = rows.find((row) => row.pageId === owner.pageId)!;
        if (mailedRow.notifiedAt) lastMailAt.set(owner.refCode, Date.parse(mailedRow.notifiedAt));
      }
      // Bookkeeping that succeeded never goes down, and never exceeds a real count.
      for (const ref of referrers)
        assert.ok(ref.notifiedCount >= 0 && Number.isInteger(ref.notifiedCount));
      now += (5 + Math.floor(rng() * 50)) * 60 * 1000;
    }
  }
  for (const [path, count] of Object.entries(covered)) assert.ok(count > 0, `${path} never hit`);
});

test("a friend withdrawn after the notice: status shows the lower count but keeps the announced tier; no mail until it passes the announced count", async () => {
  const ref = baseRow(0, "wdwdwd01", "ref@example.com", {
    signupLocale: "ko",
    leadId: leadIdFor(0),
  });
  const friends = Array.from({ length: 5 }, (_, i) =>
    baseRow(i + 1, `wf${String(i).padStart(6, "0")}`, `wf${i}@example.com`, {
      referredBy: "wdwdwd01",
      verifiedAt: new Date(BASE + i * 60_000).toISOString(),
    }),
  );
  const rows = [ref, ...friends];
  const mails: ReferralNoticeMail[] = [];
  let now = BASE + 2 * HOUR;
  const deps = () => ({
    env: ON,
    store: {
      async listProgramRows() {
        return rows.map((row) => ({ ...row }));
      },
      async markNotified(pageId: string, input: { count: number; at: string }) {
        const target = rows.find((row) => row.pageId === pageId)!;
        target.notifiedCount = input.count;
        target.notifiedAt = input.at;
      },
    },
    mailer: {
      async sendReferralNotice(mail: ReferralNoticeMail) {
        mails.push(mail);
      },
    },
    now: () => new Date(now),
    publicOrigin: "https://watchdive.example",
    secret: "s",
    closesAt: null,
  });
  await runReferralNotices(deps());
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].crossed, ["first", "buddy", "team"]);

  // Two friends turn out to be fake: 5 → 3. Status is honest, nobody is mailed.
  friends[0].suspect = true;
  friends[1].suspect = true;
  now += 3 * HOUR;
  let ledger = computeLedger(rows, { closesAt: null });
  const status = statusFor(ref, ledger, { shareUrl: "s", closed: false });
  assert.equal(status.credited, 3);
  // D7: Dive Team was announced, so it is kept; the next tier counts from what is credited.
  assert.equal(status.highestTier, "team");
  assert.equal(status.earlyNoticeHours, 2);
  assert.equal(status.nextTier, "leader");
  assert.equal(status.remainingToNext, 7);
  const quiet = await runReferralNotices(deps());
  assert.equal(quiet.pending, 0);
  assert.equal(mails.length, 1);

  // Climbing back to the announced 5 is silent; the 6th is a plain update
  // with no tier re-announced.
  for (let i = 0; i < 3; i++) {
    rows.push(
      baseRow(20 + i, `wg${String(i).padStart(6, "0")}`, `wg${i}@example.com`, {
        referredBy: "wdwdwd01",
        verifiedAt: new Date(now - 1000 * (3 - i)).toISOString(),
      }),
    );
    now += 2 * HOUR;
    await runReferralNotices(deps());
  }
  ledger = computeLedger(rows, { closesAt: null });
  assert.equal(ledger.standings.get("wdwdwd01")!.credited, 6);
  assert.equal(mails.length, 2);
  assert.equal(mails[1].credited, 6);
  assert.deepEqual(mails[1].crossed, []);
  assert.equal(rows[0].notifiedCount, 6);
});

// ---- Notion row parsing and paging ------------------------------------------

const text = (value: string) => ({ rich_text: value ? [{ plain_text: value }] : [] });

function notionPage(id: string, extra: Record<string, unknown> = {}) {
  return {
    object: "page",
    id,
    properties: {
      Email: {
        id: "title",
        type: "title",
        title: [{ type: "text", plain_text: `${id}@Example.com` }],
      },
      "Verification status": { type: "select", select: { name: "verified", color: "green" } },
      "Email verified": { type: "checkbox", checkbox: true },
      "Verified at": {
        type: "date",
        date: { start: "2026-10-23T01:00:00.000+00:00", end: null, time_zone: null },
      },
      "Ref code": { type: "rich_text", ...text("ab12cd34") },
      Suspect: { type: "checkbox", checkbox: false },
      Flags: { type: "multi_select", multi_select: [] },
      ...extra,
    },
  };
}

test("Notion shapes: empty selects, null dates, null numbers, both canonical shapes, missing columns", () => {
  const cases: [Record<string, unknown>, Partial<ReferralRow>][] = [
    [{ "Verification status": { type: "select", select: null } }, { status: "legacy" }],
    [
      { "Verification status": { type: "select", select: { name: "suppressed" } } },
      { status: "legacy" },
    ],
    [
      { "Verification status": { type: "select", select: { name: "Verified" } } },
      { status: "legacy" },
    ],
    [{ "Verified at": { type: "date", date: null } }, { verifiedAt: undefined }],
    [{ "Referral notified count": { type: "number", number: null } }, { notifiedCount: 0 }],
    [{ "Referral notified at": { type: "date", date: null } }, { notifiedAt: undefined }],
    [{ "Canonical email": { type: "email", email: null } }, { canonicalEmail: "p@example.com" }],
    [{ "Canonical email": { type: "email", email: " X@Y.com " } }, { canonicalEmail: "x@y.com" }],
    [
      { "Canonical email": { type: "rich_text", ...text("Z@Y.com") } },
      { canonicalEmail: "z@y.com" },
    ],
    [
      { "Referral reward review": { type: "select", select: { name: "Approved" } } },
      { rewardReview: undefined },
    ],
    [{ "Referred by": { type: "rich_text", rich_text: [] } }, { referredBy: undefined }],
    [
      {
        "Referred by": {
          type: "rich_text",
          rich_text: [{ plain_text: "AB12" }, { plain_text: "CD99" }],
        },
      },
      { referredBy: "ab12cd99" },
    ],
    [
      { Flags: { type: "multi_select", multi_select: [{ name: "honeypot" }, { name: "" }] } },
      { flags: ["honeypot"] },
    ],
  ];
  for (const [extra, expected] of cases) {
    const row = toReferralRow(notionPage("p", extra))!;
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(
        (row as Record<string, unknown>)[key],
        value,
        `${JSON.stringify(extra)} → ${key}`,
      );
    }
  }
  // A page whose referral columns do not exist yet reads as all defaults.
  const bare = toReferralRow(notionPage("p"))!;
  assert.equal(bare.leaderboard, false);
  assert.equal(bare.noticesOff, false);
  assert.equal(bare.nicknameHidden, false);
  assert.equal(bare.notifiedCount, 0);
  // Not a page.
  assert.equal(toReferralRow({ object: "page" }), undefined);
});

test("listProgramRows pages with the 2022-06-28 query shape and stops on a missing cursor", async () => {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const pages = [
    { results: [notionPage("a"), notionPage("b")], has_more: true, next_cursor: "cur-1" },
    { results: [notionPage("c")], has_more: true, next_cursor: null },
  ];
  const request: NotionRequest = async (method, path, body) => {
    calls.push({ method, path, body: body as Record<string, unknown> });
    return (pages.shift() ?? { results: [], has_more: false }) as Record<string, unknown>;
  };
  const rows = await createNotionReferralStore(request, "db123").listProgramRows();
  assert.deepEqual(
    rows.map((r) => r.pageId),
    ["a", "b", "c"],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "databases/db123/query");
  assert.equal(calls[0].body.page_size, 100);
  assert.equal("start_cursor" in calls[0].body, false);
  assert.equal(calls[1].body.start_cursor, "cur-1");
  assert.deepEqual(calls[0].body.sorts, [{ timestamp: "created_time", direction: "ascending" }]);
  const filter = calls[0].body.filter as {
    or: { property: string; rich_text: Record<string, unknown> }[];
  };
  assert.deepEqual(
    filter.or.map((c) => [c.property, Object.keys(c.rich_text)[0]]),
    [
      ["Ref code", "is_not_empty"],
      ["Referred by", "is_not_empty"],
    ],
  );
});

// ---- ops report: money lists ------------------------------------------------

function reportFor(rows: ReferralRow[]) {
  const ledger = computeLedger(rows, { closesAt: null });
  const now = new Date(BASE + 10 * 24 * HOUR);
  return buildReport({
    rows,
    signals: new Map(),
    ledger,
    leaderboard: buildLeaderboard(rows, ledger, { size: 3, now, closed: false }),
    now,
    closesAt: null,
    isDisposable: isDisposableEmail,
  });
}

function csvRows(content: string): string[][] {
  return content
    .trim()
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split(","));
}

test("report: a rejected Dive Leader's light passes to the next person in order; still exactly 30", () => {
  const rows = leaderRows(99, 33);
  const ledger = computeLedger(rows, { closesAt: null });
  const byOrder = [...ledger.standings.values()]
    .filter((s) => s.leaderOrder)
    .sort((a, b) => a.leaderOrder! - b.leaderOrder!);
  const rejected = byOrder[1].refCode;
  const marked = rows.map((row) =>
    row.refCode === rejected ? { ...row, rewardReview: "rejected" as const } : row,
  );
  const { summary, ranked, rowsByRef } = reportFor(marked);
  assert.equal(summary.lightAllocation.length, LEADER_LIGHT_STOCK);
  assert.ok(!summary.lightAllocation.some((e) => e.refCode === rejected));
  assert.ok(
    summary.lightAllocation.some((e) => e.refCode === byOrder[30].refCode),
    "31st moves up",
  );
  assert.ok(!summary.lightAllocation.some((e) => e.refCode === byOrder[31].refCode));
  const files = buildAddressFiles(summary, ranked, rowsByRef);
  const light = csvRows(files["light-winners.csv"]);
  assert.equal(light.length, LEADER_LIGHT_STOCK);
  // Ordered by reaching 10, without gaps in who is listed.
  const listed = light.map((line) => line[2]);
  assert.deepEqual(
    listed,
    byOrder
      .filter((s) => s.refCode !== rejected)
      .slice(0, LEADER_LIGHT_STOCK)
      .map((s) => s.refCode),
  );
});

test("report segments are deterministic and match the ledger for every seed", () => {
  for (const seed of SEEDS.slice(0, 80)) {
    const { rows } = randomRows(seed);
    const a = reportFor(rows);
    const b = reportFor(shuffle(mulberry32(seed), rows));
    const filesA = buildAddressFiles(a.summary, a.ranked, a.rowsByRef, a.holders);
    const filesB = buildAddressFiles(b.summary, b.ranked, b.rowsByRef, b.holders);
    assert.deepEqual(filesA, filesB, `seed ${seed}`);
    const ledger = computeLedger(rows, { closesAt: null });
    const early1 = csvRows(filesA["early-notice-1h.csv"]).map((l) => l[1]);
    const early2 = csvRows(filesA["early-notice-2h.csv"]).map((l) => l[1]);
    const team = csvRows(filesA["dive-team.csv"]).map((l) => l[1]);
    for (const [code, s] of ledger.standings) {
      const row = a.rowsByRef.get(code)!;
      // Segments follow the held tier (D7), not only what is credited now.
      const held = heldCount(row, s.credited);
      const inOne = early1.includes(code);
      const inTwo = early2.includes(code);
      assert.ok(!(inOne && inTwo), `seed ${seed}: ${code} in both segments`);
      if (inOne) assert.ok(held >= 1 && held < 3);
      if (inTwo) assert.ok(held >= 3);
      const told = row.status === "verified" && row.email.includes("@");
      if (told)
        assert.equal(
          inOne || inTwo,
          held >= 1,
          `seed ${seed}: ${code} missing from launch segments`,
        );
      else assert.ok(!inOne && !inTwo, `seed ${seed}: unsubscribed ${code} in a launch segment`);
      assert.equal(team.includes(code), held >= 5, `seed ${seed}: ${code} Dive Team list`);
    }
    for (const code of [...early1, ...early2, ...team])
      assert.ok(ledger.standings.has(code), `seed ${seed}: ${code} has no standing`);
    assert.ok(!JSON.stringify(a.summary).includes("@"));
  }
});
