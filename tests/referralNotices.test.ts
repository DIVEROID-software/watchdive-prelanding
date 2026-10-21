// Buddy Invite friend-joined notices: one pass per cron tick, against fakes.
// The ledger and the status link are the real core implementations, so these
// tests also pin how the notice pass reads them.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReferralNoticeMail, ReferralRow } from "../src/lib/referral/contract.ts";
import {
  DEFAULT_NOTICE_MAX_SENDS,
  noticeIdempotencyKey,
  referralNoticesEnabled,
  runReferralNotices,
  type ReferralNoticeDeps,
} from "../src/lib/referral/notices.ts";
import { NOTICE_MIN_INTERVAL_MS } from "../src/lib/referral/program.ts";
import { sendReferralNotices } from "../src/lib/verification/reminderCron.server.ts";

const NOW = new Date("2026-10-23T12:00:00.000Z");
const ON = { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1", WATCHDIVE_REFERRAL_NOTICES_ENABLED: "1" };
const SECRET = "status-secret-for-tests";

let pageCounter = 0;
function row(overrides: Partial<ReferralRow>): ReferralRow {
  pageCounter += 1;
  const id = `page-${String(pageCounter).padStart(4, "0")}`;
  return {
    pageId: id,
    refCode: `c${String(pageCounter).padStart(7, "0")}`,
    canonicalEmail: `${id}@divers.example`,
    email: `${id}@divers.example`,
    status: "verified",
    emailVerified: true,
    verifiedAt: "2026-10-22T01:00:00.000Z",
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

/** A referrer plus `friends` verified friends, one minute apart on one day. */
function referrerWith(friends: number, overrides: Partial<ReferralRow> = {}): ReferralRow[] {
  const referrer = row({ email: `referrer${pageCounter}@divers.example`, ...overrides });
  const list = [referrer];
  for (let i = 0; i < friends; i++) {
    list.push(
      row({
        referredBy: referrer.refCode,
        verifiedAt: new Date(Date.parse("2026-10-23T02:00:00.000Z") + i * 60_000).toISOString(),
      }),
    );
  }
  return list;
}

class FakeStore {
  rows: ReferralRow[];
  lists = 0;
  marks: { pageId: string; count: number; at: string }[] = [];
  failMark = false;
  constructor(rows: ReferralRow[]) {
    this.rows = rows;
  }
  async listProgramRows() {
    this.lists++;
    return this.rows.map((r) => ({ ...r }));
  }
  async markNotified(pageId: string, input: { count: number; at: string }) {
    if (this.failMark) throw new Error("notion down");
    this.marks.push({ pageId, ...input });
    const target = this.rows.find((r) => r.pageId === pageId)!;
    target.notifiedCount = input.count;
    target.notifiedAt = input.at;
  }
}

class FakeNoticeMailer {
  sent: ReferralNoticeMail[] = [];
  /** Keys Resend already accepted: a repeat key collapses, like the provider. */
  delivered = new Set<string>();
  fail = false;
  async sendReferralNotice(input: ReferralNoticeMail) {
    if (this.fail) throw new Error("Resend delivery failed (503)");
    this.sent.push(input);
    this.delivered.add(input.idempotencyKey);
  }
}

function deps(
  store: FakeStore,
  mailer: FakeNoticeMailer,
  extra: Partial<ReferralNoticeDeps> = {},
): ReferralNoticeDeps {
  return {
    env: ON,
    store,
    mailer,
    now: () => NOW,
    publicOrigin: "https://watchdive.example",
    secret: SECRET,
    closesAt: null,
    ...extra,
  };
}

test("both switches are required; with either off nothing is read or sent", async () => {
  for (const env of [
    {},
    { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" },
    { WATCHDIVE_REFERRAL_NOTICES_ENABLED: "1" },
    { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "true", WATCHDIVE_REFERRAL_NOTICES_ENABLED: "1" },
  ]) {
    const store = new FakeStore(referrerWith(3));
    const mailer = new FakeNoticeMailer();
    const result = await runReferralNotices(deps(store, mailer, { env }));
    assert.equal(referralNoticesEnabled(env), false);
    assert.equal(result.enabled, false);
    assert.equal(result.sent + result.pending + result.wouldSend, 0);
    assert.equal(store.lists, 0, "not even a Notion read");
    assert.equal(mailer.sent.length, 0);
    assert.equal(store.marks.length, 0);
  }
});

test("the cron hook does nothing at all with either switch off", async () => {
  let runs = 0;
  const lines: string[] = [];
  for (const env of [
    {},
    { WATCHDIVE_REFERRAL_NOTICES_ENABLED: "1" },
    { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" },
  ]) {
    await sendReferralNotices(
      "db",
      false,
      env,
      (async () => {
        runs++;
        throw new Error("must not run");
      }) as typeof runReferralNotices,
      (line) => lines.push(line),
    );
  }
  assert.equal(runs, 0);
  assert.deepEqual(lines, []);
});

test("the cron hook reduces any failure to its error name and never throws", async () => {
  const lines: string[] = [];
  const env = {
    ...ON,
    WATCHDIVE_VERIFICATION_SECRET: "x".repeat(32),
    WATCHDIVE_PUBLIC_ORIGIN: "https://watchdive.example",
    RESEND_API_KEY: "re_x",
    WATCHDIVE_EMAIL_FROM: "a@b.example",
  };
  class SecretLeak extends Error {
    name = "SecretLeak";
  }
  await sendReferralNotices(
    "db",
    false,
    env,
    (async () => {
      throw new SecretLeak("diver@example.com page-1 re_x");
    }) as typeof runReferralNotices,
    (line) => lines.push(line),
  );
  assert.deepEqual(lines, ["[referral-notices] failed — unexpected SecretLeak"]);
});

test("the cron hook passes dry-run through and logs counts only", async () => {
  const lines: string[] = [];
  let seen: ReferralNoticeDeps | undefined;
  const env = {
    ...ON,
    WATCHDIVE_VERIFICATION_SECRET: "x".repeat(32),
    WATCHDIVE_PUBLIC_ORIGIN: "https://watchdive.example",
    RESEND_API_KEY: "re_x",
    WATCHDIVE_EMAIL_FROM: "a@b.example",
  };
  await sendReferralNotices(
    "db",
    true,
    env,
    (async (d: ReferralNoticeDeps) => {
      seen = d;
      return {
        enabled: true,
        dryRun: true,
        pending: 1,
        sent: 0,
        wouldSend: 1,
        skippedIneligible: 0,
        skippedNoticesOff: 0,
        skippedInterval: 0,
        deferred: 0,
        sendFailed: 0,
        markFailed: 0,
      };
    }) as typeof runReferralNotices,
    (line) => lines.push(line),
  );
  assert.equal(seen?.dryRun, true);
  assert.equal(seen?.maxSends, 50);
  assert.ok((seen?.budgetMs ?? 0) > 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^\[referral-notices\] run \{"enabled":true,"dryRun":true/);
  assert.equal(lines[0]!.includes("@"), false);
});

test("a first friend sends one notice that announces the first tier", async () => {
  const rows = referrerWith(1);
  const store = new FakeStore(rows);
  const mailer = new FakeNoticeMailer();
  const result = await runReferralNotices(deps(store, mailer));
  assert.equal(result.sent, 1);
  const mail = mailer.sent[0]!;
  assert.equal(mail.to, rows[0]!.email);
  assert.equal(mail.credited, 1);
  assert.deepEqual(mail.crossed, ["first"]);
  assert.equal(mail.nextTier, "buddy");
  assert.equal(mail.remainingToNext, 2);
  assert.equal(mail.idempotencyKey, `wd-buddy-invite-20261022-notice-${rows[0]!.refCode}-1`);
  assert.equal(mail.idempotencyKey, noticeIdempotencyKey(rows[0]!.refCode, 1));
  assert.match(mail.statusUrl, /^https:\/\/watchdive\.example\/buddy\/[^=?#]+$/);
  assert.deepEqual(store.marks, [{ pageId: rows[0]!.pageId, count: 1, at: NOW.toISOString() }]);
  // The friend's row is never the recipient and no friend data is in the mail.
  const serialized = JSON.stringify(mail);
  for (const friend of rows.slice(1)) {
    assert.equal(serialized.includes(friend.email), false);
    assert.equal(serialized.includes(friend.pageId), false);
  }
});

test("a jump across several tiers announces each crossed tier once", async () => {
  const rows = referrerWith(5, { notifiedCount: 1, notifiedAt: "2026-10-22T00:00:00.000Z" });
  const mailer = new FakeNoticeMailer();
  await runReferralNotices(deps(new FakeStore(rows), mailer));
  assert.deepEqual(mailer.sent[0]!.crossed, ["buddy", "team"]);
  assert.equal(mailer.sent[0]!.nextTier, "leader");
  assert.equal(mailer.sent[0]!.remainingToNext, 5);
});

test("at ten friends the notice has no next tier", async () => {
  const rows = referrerWith(10, { notifiedCount: 9, notifiedAt: "2026-10-22T00:00:00.000Z" });
  const mailer = new FakeNoticeMailer();
  await runReferralNotices(deps(new FakeStore(rows), mailer));
  assert.deepEqual(mailer.sent[0]!.crossed, ["leader"]);
  assert.equal(mailer.sent[0]!.nextTier, null);
  assert.equal(mailer.sent[0]!.remainingToNext, null);
});

test("nothing new since the last announced count: no notice", async () => {
  const rows = referrerWith(3, { notifiedCount: 3, notifiedAt: "2026-10-01T00:00:00.000Z" });
  const mailer = new FakeNoticeMailer();
  const result = await runReferralNotices(deps(new FakeStore(rows), mailer));
  assert.equal(result.pending, 0);
  assert.equal(mailer.sent.length, 0);
});

test("one notice per referrer per interval; the next tick after it sends the new count", async () => {
  const recent = new Date(NOW.getTime() - NOTICE_MIN_INTERVAL_MS + 60_000).toISOString();
  const rows = referrerWith(2, { notifiedCount: 1, notifiedAt: recent });
  const store = new FakeStore(rows);
  const mailer = new FakeNoticeMailer();
  const first = await runReferralNotices(deps(store, mailer));
  assert.equal(first.skippedInterval, 1);
  assert.equal(mailer.sent.length, 0);

  const later = new Date(NOW.getTime() + 60_000);
  const second = await runReferralNotices(deps(store, mailer, { now: () => later }));
  assert.equal(second.sent, 1);
  assert.equal(mailer.sent[0]!.credited, 2);
  assert.deepEqual(mailer.sent[0]!.crossed, []);
});

test("an unreadable notified-at waits rather than risking a burst", async () => {
  const rows = referrerWith(2, { notifiedCount: 1, notifiedAt: "not-a-date" });
  const mailer = new FakeNoticeMailer();
  const result = await runReferralNotices(deps(new FakeStore(rows), mailer));
  assert.equal(result.skippedInterval, 1);
  assert.equal(mailer.sent.length, 0);
});

test("a referrer who turned notices off gets none and stays unannounced", async () => {
  const store = new FakeStore(referrerWith(3, { noticesOff: true }));
  const mailer = new FakeNoticeMailer();
  const result = await runReferralNotices(deps(store, mailer));
  assert.equal(result.skippedNoticesOff, 1);
  assert.equal(mailer.sent.length, 0);
  assert.equal(store.marks.length, 0);
});

test("unsubscribed, suspect or unverified referrers are never mailed", async () => {
  for (const overrides of [
    { status: "unsubscribed" },
    { suspect: true },
    { emailVerified: false, status: "pending" },
    { duplicate: true },
  ] as Partial<ReferralRow>[]) {
    const mailer = new FakeNoticeMailer();
    const result = await runReferralNotices(
      deps(new FakeStore(referrerWith(3, overrides)), mailer),
    );
    assert.equal(mailer.sent.length, 0, JSON.stringify(overrides));
    assert.equal(result.sent, 0);
  }
});

test("dry run counts what would go out and sends and writes nothing", async () => {
  const store = new FakeStore([...referrerWith(1), ...referrerWith(3)]);
  const mailer = new FakeNoticeMailer();
  const result = await runReferralNotices(deps(store, mailer, { dryRun: true }));
  assert.equal(result.dryRun, true);
  assert.equal(result.wouldSend, 2);
  assert.equal(result.sent, 0);
  assert.equal(mailer.sent.length, 0);
  assert.equal(store.marks.length, 0);
});

test("a failed bookkeeping write after a send retries under the same key, which the provider collapses", async () => {
  const store = new FakeStore(referrerWith(3));
  store.failMark = true;
  const mailer = new FakeNoticeMailer();
  const first = await runReferralNotices(deps(store, mailer));
  assert.equal(first.sent, 1);
  assert.equal(first.markFailed, 1);

  store.failMark = false;
  const second = await runReferralNotices(
    deps(store, mailer, { now: () => new Date(NOW.getTime() + 300_000) }),
  );
  assert.equal(second.sent, 1);
  assert.equal(mailer.sent.length, 2);
  assert.equal(mailer.sent[0]!.idempotencyKey, mailer.sent[1]!.idempotencyKey);
  assert.equal(mailer.delivered.size, 1, "one distinct message at the provider");
  assert.equal(store.marks.length, 1);

  const third = await runReferralNotices(
    deps(store, mailer, { now: () => new Date(NOW.getTime() + 600_000) }),
  );
  assert.equal(third.pending, 0);
});

test("a failed send leaves the count unannounced for the next tick", async () => {
  const store = new FakeStore(referrerWith(1));
  const mailer = new FakeNoticeMailer();
  mailer.fail = true;
  const result = await runReferralNotices(deps(store, mailer));
  assert.equal(result.sendFailed, 1);
  assert.equal(store.marks.length, 0);
  mailer.fail = false;
  assert.equal((await runReferralNotices(deps(store, mailer))).sent, 1);
});

test("sends per tick are capped; the rest wait for the next tick in a stable order", async () => {
  const rows: ReferralRow[] = [];
  for (let i = 0; i < 4; i++) rows.push(...referrerWith(1));
  const store = new FakeStore(rows);
  const mailer = new FakeNoticeMailer();
  const first = await runReferralNotices(deps(store, mailer, { maxSends: 3 }));
  assert.equal(first.sent, 3);
  assert.equal(first.deferred, 1);
  const second = await runReferralNotices(deps(store, mailer, { maxSends: 3 }));
  assert.equal(second.sent, 1);
  assert.equal(new Set(mailer.sent.map((m) => m.to)).size, 4);
  assert.equal(DEFAULT_NOTICE_MAX_SENDS, 50);
});

test("the time budget defers the remaining sends", async () => {
  const rows: ReferralRow[] = [];
  for (let i = 0; i < 3; i++) rows.push(...referrerWith(1));
  let t = 0;
  const mailer = new FakeNoticeMailer();
  const result = await runReferralNotices(
    deps(new FakeStore(rows), mailer, { budgetMs: 1_000, clock: () => (t += 600) }),
  );
  assert.ok(result.deferred >= 1);
  assert.equal(result.sent + result.deferred, 3);
});

test("the result carries counts only", async () => {
  const result = await runReferralNotices(
    deps(new FakeStore(referrerWith(2)), new FakeNoticeMailer()),
  );
  for (const [key, value] of Object.entries(result)) {
    assert.ok(typeof value === "number" || typeof value === "boolean", key);
  }
});
