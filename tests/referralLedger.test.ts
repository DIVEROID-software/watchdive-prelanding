import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReferralRow } from "../src/lib/referral/contract.ts";
import {
  ALIAS_SERVICE_DOMAINS,
  excludeReason,
  isAliasServiceEmail,
  isDisposableEmail,
} from "../src/lib/referral/eligibility.ts";
import {
  buildLeaderboard,
  computeLedger,
  creditDayKey,
  rankedStandings,
  statusFor,
} from "../src/lib/referral/ledger.ts";
import { DAILY_CREDIT_CAP, LEADER_LIGHT_STOCK } from "../src/lib/referral/program.ts";

let seq = 0;
function code(n: number): string {
  return `c${String(n).padStart(7, "0")}`;
}

function row(overrides: Partial<ReferralRow> = {}): ReferralRow {
  seq += 1;
  const id = String(seq).padStart(6, "0");
  return {
    pageId: `page-${id}`,
    refCode: `r${id}x`.slice(0, 8),
    canonicalEmail: `person${id}@example.com`,
    email: `person${id}@example.com`,
    status: "verified",
    emailVerified: true,
    verifiedAt: "2026-10-23T03:00:00.000Z",
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

function referrer(n: number, overrides: Partial<ReferralRow> = {}): ReferralRow {
  return row({ refCode: code(n), ...overrides });
}

function friendsOf(
  refCode: string,
  count: number,
  startIso: string,
  stepMs = 60_000,
): ReferralRow[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) =>
    row({ referredBy: refCode, verifiedAt: new Date(start + i * stepMs).toISOString() }),
  );
}

const OPEN = { closesAt: null };

// --- eligibility -------------------------------------------------------------

test("disposable domains match exactly and by subdomain, case-insensitively", () => {
  assert.equal(isDisposableEmail("a@mailinator.com"), true);
  assert.equal(isDisposableEmail("a@Foo.MAILINATOR.com"), true);
  assert.equal(isDisposableEmail("a@yopmail.fr."), true);
  assert.equal(isDisposableEmail("a@gmail.com"), false);
  assert.equal(isDisposableEmail("a@mailinator.com.reefdivers.org"), false);
  assert.equal(isDisposableEmail("not-an-email"), false);
});

test("the disposable list is the vendored snapshot, matched on every parent domain", () => {
  // Upstream-only entries (not on the earlier hand-made list).
  assert.equal(isDisposableEmail("a@0-mail.com"), true);
  assert.equal(isDisposableEmail("a@0815.ru"), true);
  assert.equal(isDisposableEmail("a@deep.sub.0815.ru"), true);
  // Entries the hand-made list had and upstream lacks are kept.
  assert.equal(isDisposableEmail("a@tempmail.dev"), true);
  assert.equal(isDisposableEmail("a@spamgourmet.com"), true);
});

test("mainstream providers are never disposable", () => {
  for (const domain of [
    "gmail.com",
    "googlemail.com",
    "naver.com",
    "daum.net",
    "hanmail.net",
    "kakao.com",
    "nate.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "yahoo.com",
    "yahoo.co.jp",
    "icloud.com",
    "me.com",
    "mac.com",
    "qq.com",
    "163.com",
    "126.com",
    "gmx.de",
    "web.de",
    "proton.me",
    "protonmail.com",
    "pm.me",
    "fastmail.com",
    "yandex.ru",
    "mail.ru",
    "docomo.ne.jp",
    "aol.com",
    "diveroid.com",
  ]) {
    assert.equal(isDisposableEmail(`diver@${domain}`), false, domain);
  }
});

test("alias and forwarding services count: never disposable, flagged as alias", () => {
  for (const domain of ALIAS_SERVICE_DOMAINS) {
    assert.equal(isDisposableEmail(`x@${domain}`), false, domain);
    assert.equal(isAliasServiceEmail(`x@${domain}`), true, domain);
  }
  assert.equal(isAliasServiceEmail("shop@reefer.mozmail.com"), true);
  assert.equal(isAliasServiceEmail("shop@kim.anonaddy.com"), true);
  assert.equal(isAliasServiceEmail("X@DUCK.COM"), true);
  assert.equal(isAliasServiceEmail("x@gmail.com"), false);
  assert.equal(isAliasServiceEmail("x@icloud.com"), false);
  assert.equal(isAliasServiceEmail("x@notduck.com"), false);
  const ref = referrer(1);
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, email: "a@duck.com" }), ref, OPEN),
    null,
  );
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, email: "a@33mail.com" }), ref, OPEN),
    null,
  );
});

test("excludeReason covers every friend-level rule", () => {
  const ref = referrer(1);
  const ok = row({ referredBy: ref.refCode });
  assert.equal(excludeReason(ok, ref, OPEN), null);
  assert.equal(excludeReason(row({ referredBy: "zzzzzzzz" }), undefined, OPEN), "unknown_referrer");
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, canonicalEmail: ref.canonicalEmail }), ref, OPEN),
    "self_referral",
  );
  assert.equal(excludeReason({ ...ref, referredBy: ref.refCode }, ref, OPEN), "self_referral");
  // Confirmed, then unsubscribed: still a friend (counts never drop on unsubscribe).
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, status: "unsubscribed" }), ref, OPEN),
    null,
  );
  // Unsubscribed without ever confirming: never a friend.
  assert.equal(
    excludeReason(
      row({ referredBy: ref.refCode, status: "unsubscribed", emailVerified: false }),
      ref,
      OPEN,
    ),
    "unsubscribed",
  );
  assert.equal(
    excludeReason(
      row({ referredBy: ref.refCode, status: "unsubscribed", verifiedAt: undefined }),
      ref,
      OPEN,
    ),
    "unsubscribed",
  );
  // Unsubscribed and excluded for abuse still does not count.
  assert.equal(
    excludeReason(
      row({ referredBy: ref.refCode, status: "unsubscribed", suspect: true }),
      ref,
      OPEN,
    ),
    "suspect",
  );
  assert.equal(
    excludeReason(
      row({ referredBy: ref.refCode, status: "pending", emailVerified: false }),
      ref,
      OPEN,
    ),
    "not_verified",
  );
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, verifiedAt: undefined }), ref, OPEN),
    "not_verified",
  );
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, suspect: true }), ref, OPEN),
    "suspect",
  );
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, duplicate: true }), ref, OPEN),
    "duplicate",
  );
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, email: "x@sub.yopmail.com" }), ref, OPEN),
    "disposable_domain",
  );
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, flags: ["disposable"] }), ref, OPEN),
    "disposable_domain",
  );
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, flags: ["honeypot"] }), ref, OPEN),
    "blocked_flag",
  );
  // A shared IP is a review flag, not a block — same as the public counters.
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, flags: ["ip-repeat"] }), ref, OPEN),
    null,
  );
  const closesAt = new Date("2026-12-01T00:00:00.000Z");
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, verifiedAt: "2026-12-01T00:00:00.000Z" }), ref, {
      closesAt,
    }),
    "after_close",
  );
  assert.equal(
    excludeReason(row({ referredBy: ref.refCode, verifiedAt: "2026-11-30T23:59:59.999Z" }), ref, {
      closesAt,
    }),
    null,
  );
});

// --- ledger ------------------------------------------------------------------

test("credit day is the Asia/Seoul calendar day", () => {
  assert.equal(creditDayKey(Date.parse("2026-10-23T14:59:59.999Z")), "2026-10-23");
  assert.equal(creditDayKey(Date.parse("2026-10-23T15:00:00.000Z")), "2026-10-24");
});

test("daily cap applies per referrer per KST day and resets at KST midnight", () => {
  const ref = referrer(1);
  // 12 friends just before KST midnight (14:30–14:41 UTC), 3 just after.
  const before = friendsOf(ref.refCode, 12, "2026-10-23T14:30:00.000Z");
  const after = friendsOf(ref.refCode, 3, "2026-10-23T15:00:00.000Z");
  const ledger = computeLedger([ref, ...after, ...before], OPEN);
  const standing = ledger.standings.get(ref.refCode);
  assert.equal(standing?.credited, DAILY_CREDIT_CAP + 3);
  assert.equal(ledger.excluded.daily_cap, 2);
  // The 10th credited friend (tier leader) is the 10th of the first day.
  assert.equal(standing?.reachedAt.leader, before[9].verifiedAt);
  assert.equal(standing?.lastCreditAt, after[2].verifiedAt);
});

test("cap is per referrer: another referrer's friends that day are unaffected", () => {
  const a = referrer(1);
  const b = referrer(2);
  const rows = [
    a,
    b,
    ...friendsOf(a.refCode, 11, "2026-10-23T01:00:00Z"),
    ...friendsOf(b.refCode, 4, "2026-10-23T01:00:00Z"),
  ];
  const ledger = computeLedger(rows, OPEN);
  assert.equal(ledger.standings.get(a.refCode)?.credited, 10);
  assert.equal(ledger.standings.get(b.refCode)?.credited, 4);
  assert.equal(ledger.excluded.daily_cap, 1);
});

test("one person counts once: a repeat canonical email is a duplicate", () => {
  const a = referrer(1);
  const b = referrer(2);
  const first = row({
    referredBy: a.refCode,
    canonicalEmail: "same@gmail.com",
    verifiedAt: "2026-10-23T01:00:00Z",
  });
  const again = row({
    referredBy: b.refCode,
    canonicalEmail: "same@gmail.com",
    verifiedAt: "2026-10-23T02:00:00Z",
  });
  const ledger = computeLedger([b, again, a, first], OPEN);
  assert.equal(ledger.standings.get(a.refCode)?.credited, 1);
  assert.equal(ledger.standings.has(b.refCode), false);
  assert.equal(ledger.excluded.duplicate, 1);
});

test("exclusions are counted by reason and never credited", () => {
  const a = referrer(1);
  const rows = [
    a,
    row({ referredBy: a.refCode, canonicalEmail: a.canonicalEmail }),
    row({ referredBy: a.refCode, suspect: true }),
    row({ referredBy: a.refCode, email: "z@mailinator.com" }),
    row({ referredBy: a.refCode, verifiedAt: "2027-01-01T00:00:00Z" }),
    row({ referredBy: "nobody00" }),
    row({ referredBy: a.refCode }),
  ];
  const ledger = computeLedger(rows, { closesAt: new Date("2026-12-01T00:00:00Z") });
  assert.equal(ledger.standings.get(a.refCode)?.credited, 1);
  assert.equal(ledger.excluded.self_referral, 1);
  assert.equal(ledger.excluded.suspect, 1);
  assert.equal(ledger.excluded.disposable_domain, 1);
  assert.equal(ledger.excluded.after_close, 1);
  assert.equal(ledger.excluded.unknown_referrer, 1);
});

test("an ineligible referrer holds no standing; credits return when cleared", () => {
  const a = referrer(1, { suspect: true });
  const friends = friendsOf(a.refCode, 2, "2026-10-23T01:00:00Z");
  const ledger = computeLedger([a, ...friends], OPEN);
  assert.equal(ledger.standings.has(a.refCode), false);
  assert.equal(ledger.ineligibleReferrerCredits, 2);
  for (const bad of [
    { rewardReview: "rejected" as const },
    { status: "pending", emailVerified: false },
    { duplicate: true },
    { flags: ["headless"] },
  ]) {
    const r = referrer(1, bad);
    assert.equal(computeLedger([r, ...friends], OPEN).standings.has(r.refCode), false);
  }
  // D7: an unsubscribed referrer keeps the standing they reached.
  assert.equal(
    computeLedger([referrer(1, { status: "unsubscribed" }), ...friends], OPEN).standings.get(
      a.refCode,
    )?.credited,
    2,
  );
  const cleared = { ...a, suspect: false };
  assert.equal(computeLedger([cleared, ...friends], OPEN).standings.get(a.refCode)?.credited, 2);
});

test("ledger is independent of input order", () => {
  const a = referrer(1);
  const b = referrer(2);
  const rows = [
    a,
    b,
    ...friendsOf(a.refCode, 7, "2026-10-23T00:00:00Z"),
    ...friendsOf(b.refCode, 7, "2026-10-23T00:00:30Z"),
  ];
  const one = computeLedger(rows, OPEN);
  const two = computeLedger([...rows].reverse(), OPEN);
  assert.deepEqual([...one.standings.entries()].sort(), [...two.standings.entries()].sort());
});

test("ranking: count desc, then whoever reached the count first", () => {
  const a = referrer(1);
  const b = referrer(2);
  const c = referrer(3);
  const rows = [
    a,
    b,
    c,
    ...friendsOf(a.refCode, 3, "2026-10-23T02:00:00Z"),
    ...friendsOf(b.refCode, 3, "2026-10-23T01:00:00Z"),
    ...friendsOf(c.refCode, 4, "2026-10-24T01:00:00Z"),
  ];
  const ranked = rankedStandings(computeLedger(rows, OPEN)).map((s) => s.refCode);
  assert.deepEqual(ranked, [c.refCode, b.refCode, a.refCode]);
});

test("leader order follows the instant of reaching 10; lights stop at the stock", () => {
  const rows: ReferralRow[] = [];
  const refs: ReferralRow[] = [];
  const total = LEADER_LIGHT_STOCK + 2;
  for (let i = 0; i < total; i++) {
    const r = referrer(100 + i);
    refs.push(r);
    // Later referrers reach 10 earlier in time, so order is by instant, not index.
    const start = new Date(Date.parse("2026-11-01T00:00:00Z") - i * 3_600_000).toISOString();
    rows.push(r, ...friendsOf(r.refCode, 10, start));
  }
  const ledger = computeLedger(rows, OPEN);
  const last = ledger.standings.get(refs[0].refCode);
  const first = ledger.standings.get(refs[total - 1].refCode);
  assert.equal(first?.leaderOrder, 1);
  assert.equal(first?.lightEligible, true);
  assert.equal(ledger.standings.get(refs[2].refCode)?.leaderOrder, LEADER_LIGHT_STOCK);
  assert.equal(ledger.standings.get(refs[2].refCode)?.lightEligible, true);
  assert.equal(ledger.standings.get(refs[1].refCode)?.leaderOrder, LEADER_LIGHT_STOCK + 1);
  assert.equal(ledger.standings.get(refs[1].refCode)?.lightEligible, false);
  assert.equal(last?.leaderOrder, total);
  assert.equal(last?.lightEligible, false);
  // Fewer than 10: no order at all.
  const small = referrer(999);
  const l2 = computeLedger([small, ...friendsOf(small.refCode, 9, "2026-10-23T00:00:00Z")], OPEN);
  assert.equal(l2.standings.get(small.refCode)?.leaderOrder, null);
  assert.equal(l2.standings.get(small.refCode)?.lightEligible, false);
});

// --- leaderboard & status ----------------------------------------------------

test("leaderboard shows only opted-in, unhidden, valid nicknames and leaks nothing", () => {
  const shown = referrer(1, { nickname: "바다거북", leaderboard: true });
  const notOpted = referrer(2, { nickname: "Reefy", leaderboard: false });
  const hidden = referrer(3, { nickname: "Manta", leaderboard: true, nicknameHidden: true });
  const invalid = referrer(4, { nickname: "call 010-1234-5678", leaderboard: true });
  const fifth = referrer(5, { nickname: "Fifth", leaderboard: true });
  const rows = [
    shown,
    notOpted,
    hidden,
    invalid,
    fifth,
    ...friendsOf(shown.refCode, 5, "2026-10-23T00:00:00Z"),
    ...friendsOf(notOpted.refCode, 4, "2026-10-23T00:00:00Z"),
    ...friendsOf(hidden.refCode, 3, "2026-10-23T00:00:00Z"),
    ...friendsOf(invalid.refCode, 2, "2026-10-23T00:00:00Z"),
    ...friendsOf(fifth.refCode, 1, "2026-10-23T00:00:00Z"),
  ];
  const ledger = computeLedger(rows, OPEN);
  const now = new Date("2026-10-24T00:00:00Z");
  const board = buildLeaderboard(rows, ledger, { size: 4, now, closed: false });
  assert.deepEqual(board, {
    entries: [
      { rank: 1, nickname: "바다거북", credited: 5 },
      { rank: 2, nickname: null, credited: 4 },
      { rank: 3, nickname: null, credited: 3 },
      { rank: 4, nickname: null, credited: 2 },
    ],
    asOf: now.toISOString(),
    closed: false,
  });
  const serialized = JSON.stringify(board);
  for (const r of rows) {
    assert.equal(serialized.includes(r.email), false);
    assert.equal(serialized.includes(r.pageId), false);
    assert.equal(serialized.includes(r.refCode), false);
  }
  assert.equal(serialized.includes("@"), false);
  assert.equal(buildLeaderboard(rows, ledger, { size: 0, now, closed: true }).entries.length, 0);
});

test("statusFor reports tiers, rank and early notice for the owner", () => {
  const a = referrer(1, { nickname: "Hidden one", nicknameHidden: true, leaderboard: true });
  const b = referrer(2);
  const lonely = referrer(3);
  const rows = [
    a,
    b,
    lonely,
    ...friendsOf(a.refCode, 3, "2026-10-23T00:00:00Z"),
    ...friendsOf(b.refCode, 5, "2026-10-23T00:00:00Z"),
  ];
  const ledger = computeLedger(rows, OPEN);
  const status = statusFor(a, ledger, { shareUrl: "https://x.test/r/c0000001", closed: false });
  assert.deepEqual(status, {
    credited: 3,
    highestTier: "buddy",
    nextTier: "team",
    remainingToNext: 2,
    earlyNoticeHours: 2,
    lightEligible: false,
    rank: 2,
    nickname: "Hidden one",
    leaderboard: true,
    nicknameHidden: true,
    noticesOff: false,
    shareUrl: "https://x.test/r/c0000001",
    closed: false,
    shareCode: null,
    shareCodeCustom: false,
    shareCodeLocked: false,
  });
  const none = statusFor(lonely, ledger, { shareUrl: "s", closed: true });
  assert.equal(none.credited, 0);
  assert.equal(none.rank, null);
  assert.equal(none.highestTier, null);
  assert.equal(none.nextTier, "first");
  assert.equal(none.remainingToNext, 1);
  assert.equal(none.earlyNoticeHours, 0);
  assert.equal(none.nickname, null);
  assert.equal(none.closed, true);
  const first = statusFor(row({ refCode: "x1234567" }), computeLedger([], OPEN), {
    shareUrl: "s",
    closed: false,
  });
  assert.equal(first.credited, 0);
});

test("a friend who unsubscribes after confirming keeps the referrer's count", () => {
  const ref = referrer(1);
  const friends = friendsOf(ref.refCode, 3, "2026-10-23T01:00:00Z");
  const before = computeLedger([ref, ...friends], OPEN).standings.get(ref.refCode);
  const left = friends.map((f, i) => (i === 1 ? { ...f, status: "unsubscribed" } : f));
  const after = computeLedger([ref, ...left], OPEN).standings.get(ref.refCode);
  assert.equal(before?.credited, 3);
  assert.equal(after?.credited, 3);
  assert.deepEqual(after?.reachedAt, before?.reachedAt);
  // Abuse exclusions still remove the friend.
  const flagged = left.map((f, i) => (i === 1 ? { ...f, suspect: true } : f));
  assert.equal(computeLedger([ref, ...flagged], OPEN).standings.get(ref.refCode)?.credited, 2);
});

test("self-referral and duplicates use the referral identity key as well as the canonical", () => {
  // Stored canonicals differ (as on rows written before a canonical rule
  // existed); the identity key still sees one Gmail mailbox.
  const ref = referrer(1, { email: "J.Doe@gmail.com", canonicalEmail: "j.doe@gmail.com" });
  const selfGmail = row({
    referredBy: ref.refCode,
    email: "jdoe+buddy@googlemail.com",
    canonicalEmail: "legacy-a",
  });
  assert.equal(excludeReason(selfGmail, ref, OPEN), "self_referral");

  const apple = referrer(2, { email: "reef@me.com", canonicalEmail: "reef@me.com" });
  const selfApple = row({
    referredBy: apple.refCode,
    email: "reef@icloud.com",
    canonicalEmail: "reef@icloud.com",
  });
  assert.equal(excludeReason(selfApple, apple, OPEN), "self_referral");

  // Two friends that are one Apple mailbox count once, the earlier confirmation.
  const other = referrer(3);
  const first = row({
    referredBy: other.refCode,
    email: "kim@mac.com",
    canonicalEmail: "kim@mac.com",
    verifiedAt: "2026-10-23T01:00:00.000Z",
  });
  const second = row({
    referredBy: other.refCode,
    email: "KIM@icloud.com",
    canonicalEmail: "kim@icloud.com",
    verifiedAt: "2026-10-23T02:00:00.000Z",
  });
  const ledger = computeLedger([other, second, first], OPEN);
  assert.equal(ledger.standings.get(other.refCode)?.credited, 1);
  assert.equal(ledger.excluded.duplicate, 1);

  // Undocumented aliases stay distinct: Outlook +tags and Proton domains.
  const third = referrer(4);
  const distinct = [
    row({ referredBy: third.refCode, email: "sea@outlook.com", canonicalEmail: "a1" }),
    row({ referredBy: third.refCode, email: "sea+x@outlook.com", canonicalEmail: "a2" }),
    row({ referredBy: third.refCode, email: "sea@proton.me", canonicalEmail: "a3" }),
    row({ referredBy: third.refCode, email: "sea@pm.me", canonicalEmail: "a4" }),
  ];
  assert.equal(computeLedger([third, ...distinct], OPEN).standings.get(third.refCode)?.credited, 4);
});

test("the sign-up of record is the earliest confirmed row on the whole list under either key", () => {
  // The person first joined directly (no link) as kim@mac.com, then again
  // through a link as KIM@icloud.com: one Apple mailbox, so the linked row is
  // a repeat even though the first row was never anyone's friend.
  const ref = referrer(1);
  const direct = row({
    email: "kim@mac.com",
    canonicalEmail: "kim@mac.com",
    verifiedAt: "2026-10-23T01:00:00.000Z",
  });
  const repeat = row({
    referredBy: ref.refCode,
    email: "KIM@icloud.com",
    canonicalEmail: "kim@icloud.com",
    verifiedAt: "2026-10-23T02:00:00.000Z",
  });
  const ledger = computeLedger([ref, repeat, direct], OPEN);
  assert.equal(ledger.standings.get(ref.refCode), undefined);
  assert.equal(ledger.excluded.duplicate, 1);

  // An earlier row ops ticked Duplicate is not the sign-up of record, and a
  // friend who confirmed then unsubscribed is still the one that counts.
  const ticked = { ...direct, duplicate: true };
  const left = { ...repeat, status: "unsubscribed" as const };
  const cleared = computeLedger([ref, left, ticked], OPEN);
  assert.equal(cleared.standings.get(ref.refCode)?.credited, 1);
  assert.equal(cleared.excluded.duplicate, 0);
});
