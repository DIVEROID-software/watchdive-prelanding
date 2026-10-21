import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { LedgerResult, ReferralRow, ReferrerStanding } from "../src/lib/referral/contract.ts";
import { REFERRAL_PROGRAM_ID } from "../src/lib/referral/program.ts";
import { planReferralSchema, runReferralSchema } from "../scripts/referral-schema.ts";
import {
  buildAddressFiles,
  buildReport,
  computeReviewSignals,
  maxInWindow,
  writePrivateFiles,
} from "../scripts/referral-report.ts";
import {
  announceKey,
  announceSkipReason,
  maskEmail,
  renderAnnouncement,
  runAnnounce,
  type AnnounceDeps,
  type AnnounceMessage,
  type AnnounceRow,
} from "../scripts/referral-announce.ts";

// ---- schema -----------------------------------------------------------------

const allPresent = {
  properties: {
    "Referral nickname": { type: "rich_text" },
    "Referral leaderboard": { type: "checkbox" },
    "Referral nickname hidden": { type: "checkbox" },
    "Referral notices off": { type: "checkbox" },
    "Referral notified count": { type: "number" },
    "Referral notified at": { type: "date" },
    "Referral reward review": {
      type: "select",
      select: { options: ["pending", "approved", "rejected"].map((name) => ({ id: name, name })) },
    },
    Email: { type: "title" },
  },
};

test("schema plan: everything missing adds seven properties and nothing else", () => {
  const plan = planReferralSchema({ properties: { Email: { type: "title" } } });
  assert.equal(plan.ok, true);
  assert.equal(plan.actions.filter((a) => a.op === "add").length, 7);
  assert.equal(Object.keys(plan.patch!.properties).length, 7);
  assert.equal("Email" in plan.patch!.properties, false);
  const select = plan.patch!.properties["Referral reward review"] as { select: { options: { name: string }[] } };
  assert.deepEqual(select.select.options.map((o) => o.name), ["pending", "approved", "rejected"]);
});

test("schema plan: all present is a no-op", () => {
  const plan = planReferralSchema(allPresent);
  assert.equal(plan.ok, true);
  assert.equal(plan.patch, null);
});

test("schema plan: wrong type refuses and patches nothing", () => {
  const plan = planReferralSchema({ properties: { ...allPresent.properties, "Referral nickname": { type: "title" } } });
  assert.equal(plan.ok, false);
  assert.equal(plan.patch, null);
  assert.deepEqual(plan.conflicts, [{ name: "Referral nickname", reason: "wrong_type", found: "title" }]);
});

test("schema plan: select missing an option keeps existing options by id", () => {
  const props = structuredClone(allPresent.properties);
  props["Referral reward review"].select.options = [{ id: "x1", name: "pending" }];
  const plan = planReferralSchema({ properties: props });
  const sel = plan.patch!.properties["Referral reward review"] as { select: { options: unknown[] } };
  assert.deepEqual(sel.select.options, [{ id: "x1" }, { name: "approved" }, { name: "rejected" }]);
});

test("schema run: dry run never PATCHes; --apply patches once and verifies", async () => {
  const calls: string[] = [];
  let patched = false;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(String(init.method));
    if (init.method === "PATCH") patched = true;
    const body = patched ? allPresent : { properties: { Email: { type: "title" } } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const env = { NOTION_API_KEY: "k", NOTION_WAITLIST_DB_ID: "0123456789abcdef0123456789abcdef" };
  const dry = await runReferralSchema({ args: [], env, fetchImpl });
  assert.equal(dry.exitCode, 0);
  assert.deepEqual(calls, ["GET"]);
  calls.length = 0;
  const applied = await runReferralSchema({ args: ["--apply"], env, fetchImpl });
  assert.equal(applied.exitCode, 0);
  assert.deepEqual(calls, ["GET", "PATCH", "GET"]);
});

// ---- report -----------------------------------------------------------------

function row(over: Partial<ReferralRow> & { pageId: string }): ReferralRow {
  return {
    refCode: "", canonicalEmail: `${over.pageId}@example.com`, status: "verified", emailVerified: true,
    suspect: false, duplicate: false, flags: [], leaderboard: false, nicknameHidden: false,
    noticesOff: false, notifiedCount: 0, email: `${over.pageId}@example.com`, ...over,
  };
}

const T0 = Date.parse("2026-11-01T10:00:00Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const noDisposable = (email: string) => email.endsWith("@mailinator.com");

test("maxInWindow finds the densest window", () => {
  assert.equal(maxInWindow([0, 60e3, 120e3, 1e9], 10 * 60e3), 3);
  assert.equal(maxInWindow([], 1000), 0);
});

test("review signals: burst, disposable, same landing path, fast verify", () => {
  const friends = Array.from({ length: 6 }, (_, i) =>
    row({ pageId: `f${i}`, email: `u${i}@mailinator.com`, verifiedAt: at(i * 30 + 20), signupLocale: "ko", referredBy: "aaaaaaaa" }),
  );
  const sig = new Map(friends.map((f, i) => [f.pageId, { signedUpAt: at(i * 30), landingPath: "/ko", utm: { source: "x" } }]));
  const { signals, reasons } = computeReviewSignals(friends, sig, { domainCounts: new Map([["mailinator.com", 6]]) }, noDisposable);
  assert.ok(signals.maxVerifiedInBurstWindow >= 5);
  for (const r of ["burst_verifications", "disposable_domains", "same_locale", "same_landing_path", "same_utm", "fast_verify"]) {
    assert.ok(reasons.includes(r as never), r);
  }
  assert.deepEqual(signals.domains, [{ domain: "mailinator.com", count: 6 }]);
});

test("review signals: a varied organic referrer is not flagged", () => {
  const domains = ["gmail.com", "naver.com", "outlook.com", "icloud.com", "gmail.com", "yahoo.com"];
  const locales = ["ko", "en", "ja", "de", "fr", "es"];
  const friends = domains.map((d, i) =>
    row({ pageId: `g${i}`, email: `p${i}@${d}`, verifiedAt: at(i * 7200), signupLocale: locales[i] }),
  );
  const sig = new Map(friends.map((f, i) => [f.pageId, { signedUpAt: at(i * 7200 - 600), landingPath: `/p${i}` }]));
  const { reasons } = computeReviewSignals(friends, sig, { domainCounts: new Map() }, noDisposable);
  assert.deepEqual(reasons, []);
});

function fixture() {
  const referrer = row({ pageId: "r1", refCode: "aaaaaaaa", nickname: "Neo", email: "boss@example.com", canonicalEmail: "boss@example.com" });
  const friends = Array.from({ length: 5 }, (_, i) =>
    row({ pageId: `c${i}`, refCode: `bbbbbbb${i}`, referredBy: "aaaaaaaa", email: `friend${i}@gmail.com`, verifiedAt: at(i * 90000) }),
  );
  const unsub = row({ pageId: "r2", refCode: "cccccccc", status: "unsubscribed", email: "gone@example.com" });
  const rows = [referrer, ...friends, unsub];
  const standing = (refCode: string, credited: number, extra: Partial<ReferrerStanding> = {}): ReferrerStanding => ({
    refCode, credited, reachedAt: {}, leaderOrder: null, lightEligible: false, lastCreditAt: at(1), ...extra,
  });
  const standings = new Map<string, ReferrerStanding>([
    ["aaaaaaaa", standing("aaaaaaaa", 5, { reachedAt: { first: at(1), buddy: at(2), team: at(3) } })],
    ["cccccccc", standing("cccccccc", 1, { reachedAt: { first: at(1) } })],
  ]);
  const ledger: LedgerResult = {
    standings,
    excluded: { not_verified: 0, unsubscribed: 0, suspect: 0, duplicate: 0, blocked_flag: 0, self_referral: 0, disposable_domain: 0, unknown_referrer: 0, after_close: 0, daily_cap: 0 },
  };
  return { rows, ledger };
}

test("report summary is PII-free and address files respect eligibility", async () => {
  const { rows, ledger } = fixture();
  const { summary, ranked, rowsByRef } = buildReport({
    rows, signals: new Map(), ledger, leaderboard: { entries: [], asOf: at(0), closed: false },
    now: new Date(at(10)), closesAt: null, isDisposable: noDisposable,
  });
  assert.equal(JSON.stringify(summary).includes("@"), false);
  assert.equal(summary.tierCounts.team, 1);
  assert.equal(summary.top10[0].refCode, "aaaaaaaa");
  const files = buildAddressFiles(summary, ranked, rowsByRef);
  assert.match(files["dive-team.csv"], /boss@example.com/);
  // The unsubscribed referrer is in no segment.
  for (const content of Object.values(files)) assert.equal(content.includes("gone@example.com"), false);
  assert.match(files["early-notice-2h.csv"], /boss@example.com/);
  assert.equal(files["early-notice-1h.csv"].includes("boss@example.com"), false);

  const dir = await mkdtemp(join(tmpdir(), "refops-"));
  await writePrivateFiles(join(dir, "out"), files);
  assert.equal((await stat(join(dir, "out", "dive-team.csv"))).mode & 0o777, 0o600);
});

test("a rejected reward review removes the person from reward and notice files", () => {
  const { rows, ledger } = fixture();
  rows[0] = { ...rows[0], rewardReview: "rejected" };
  const { summary, ranked, rowsByRef } = buildReport({
    rows, signals: new Map(), ledger, leaderboard: { entries: [], asOf: at(0), closed: false },
    now: new Date(at(10)), closesAt: null, isDisposable: noDisposable,
  });
  const files = buildAddressFiles(summary, ranked, rowsByRef);
  assert.equal(Object.values(files).some((c) => c.includes("boss@example.com")), false);
});

// ---- announce ---------------------------------------------------------------

const RELEASE = new Date("2026-11-01T00:00:00Z");
const LEAD = "11111111-1111-4111-8111-111111111111";
function arow(over: Partial<AnnounceRow> = {}): AnnounceRow {
  return {
    pageId: "p1", leadId: LEAD, email: "diver@example.com", status: "verified", emailVerified: true,
    suspect: false, duplicate: false, verifiedAt: "2026-10-20T00:00:00Z", refCode: "abcd1234", signupLocale: "ko", ...over,
  };
}

test("announce eligibility: before release only, not unsubscribed or suspect", () => {
  assert.equal(announceSkipReason(arow(), RELEASE), null);
  assert.equal(announceSkipReason(arow({ verifiedAt: "2026-11-02T00:00:00Z" }), RELEASE), "verified_after_release");
  assert.equal(announceSkipReason(arow({ verifiedAt: undefined }), RELEASE), "verified_at_missing");
  assert.equal(announceSkipReason(arow({ status: "unsubscribed" }), RELEASE), "unsubscribed");
  assert.equal(announceSkipReason(arow({ suspect: true }), RELEASE), "suspect");
  assert.equal(announceSkipReason(arow({ duplicate: true }), RELEASE), "duplicate");
  assert.equal(announceSkipReason(arow({ status: "pending", emailVerified: false }), RELEASE), "not_verified");
  assert.equal(announceSkipReason(arow({ refCode: "" }), RELEASE), "no_ref_code");
  assert.equal(announceSkipReason(arow({ verifiedAt: "2026-11-02T00:00:00Z" }), RELEASE, true), null);
});

test("announce idempotency key", () => {
  assert.equal(announceKey(arow()), `${REFERRAL_PROGRAM_ID}-announce-${LEAD}`);
  assert.equal(announceKey(arow({ leadId: "" })), `${REFERRAL_PROGRAM_ID}-announce-p1`);
  assert.notEqual(announceKey(arow(), true), announceKey(arow()));
});

test("announce render escapes every value", () => {
  const mail = renderAnnouncement(
    "en",
    { share: "https://x.test/r/abcd1234", status: "https://x.test/buddy/t", rules: "https://x.test/buddy-rules" },
    { price: "<b>$149</b>", seats: 100, stock: 30, winners: 3, hours: 1 },
  );
  assert.equal(mail.html.includes("<b>$149</b>"), false);
  assert.ok(mail.html.includes("&lt;b&gt;$149"));
  assert.equal(maskEmail("diver@example.com"), "d***@example.com");
});

async function setup(rows: AnnounceRow[], env: Record<string, string | undefined>) {
  const sent: AnnounceMessage[] = [];
  const dir = await mkdtemp(join(tmpdir(), "refann-"));
  const deps: AnnounceDeps = {
    rows, env,
    values: () => ({ price: "$149", seats: 100, stock: 30, winners: 3, hours: 1 }),
    links: (r) => ({ share: `https://x.test/r/${r.refCode}`, status: "https://x.test/buddy/t", rules: "https://x.test/buddy-rules" }),
    send: async (m) => void sent.push(m),
    sleep: async () => {},
  };
  return { sent, dir, deps };
}

test("announce: dry run sends and writes nothing, sample address is masked", async () => {
  const { sent, dir, deps } = await setup([arow(), arow({ pageId: "p2", leadId: "", email: "late@example.com", verifiedAt: "2026-11-05T00:00:00Z" })], {});
  const result = await runAnnounce({ apply: false, releasedAt: RELEASE, receiptDir: dir }, deps);
  assert.equal(sent.length, 0);
  assert.equal(result.eligible, 1);
  assert.equal(result.skipped.verified_after_release, 1);
  assert.equal(result.sample?.to, "d***@example.com");
  assert.equal(JSON.stringify(result).includes("diver@"), false);
});

test("announce: --apply is refused without the switch or the confirm flag", async () => {
  const a = await setup([arow()], {});
  assert.equal((await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: RELEASE, receiptDir: a.dir }, a.deps)).aborted, "switch_off");
  const b = await setup([arow()], { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" });
  assert.equal((await runAnnounce({ apply: true, releasedAt: RELEASE, receiptDir: b.dir }, b.deps)).aborted, "confirm_missing");
  assert.equal((await runAnnounce({ apply: true, confirm: "nope", releasedAt: RELEASE, receiptDir: b.dir }, b.deps)).aborted, "confirm_missing");
  assert.equal(a.sent.length + b.sent.length, 0);
});

test("announce: staged batches resume without duplicates; receipts hold no address", async () => {
  const rows = ["a", "b", "c"].map((id, i) => arow({ pageId: id, leadId: "", email: `${id}@example.com`, refCode: `abcd123${i}` }));
  const { sent, dir, deps } = await setup(rows, { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" });
  const opts = { apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: RELEASE, receiptDir: dir };
  const first = await runAnnounce({ ...opts, limit: 1 }, deps);
  assert.equal(first.sent, 1);
  const second = await runAnnounce(opts, deps);
  assert.equal(second.alreadySent, 1);
  assert.equal(second.sent, 2);
  assert.equal(new Set(sent.map((m) => m.idempotencyKey)).size, 3);
  const third = await runAnnounce(opts, deps);
  assert.equal(third.sent, 0);
  assert.equal(third.alreadySent, 3);
  const receipt = await readFile(join(dir, `${REFERRAL_PROGRAM_ID}-announce.jsonl`), "utf8");
  assert.equal(receipt.includes("@"), false);
});

test("announce: --only self-test ignores the release gate and uses its own key", async () => {
  const { sent, dir, deps } = await setup(
    [arow({ email: "me@example.com", verifiedAt: "2026-11-09T00:00:00Z" }), arow({ pageId: "p9", email: "other@example.com" })],
    { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" },
  );
  const result = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: RELEASE, only: "ME@example.com", receiptDir: dir }, deps);
  assert.equal(result.sent, 1);
  assert.equal(sent[0].to, "me@example.com");
  assert.ok(sent[0].idempotencyKey.endsWith("-selftest"));
});

test("announce: a clear failure is retried; an intent with no outcome is held", async () => {
  const { sent, dir, deps } = await setup([arow()], { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" });
  const failing = { ...deps, send: async () => { throw new Error("boom"); } };
  const opts = { apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: RELEASE, receiptDir: dir };
  assert.equal((await runAnnounce(opts, failing)).failed, 1);
  // A clear failure may be retried.
  assert.equal((await runAnnounce(opts, deps)).sent, 1);
  assert.equal(sent.length, 1);
});

test("announce: a crash after intent holds the recipient instead of resending", async () => {
  const { sent, dir, deps } = await setup([arow()], { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" });
  const { createHash } = await import("node:crypto");
  const { writeFile } = await import("node:fs/promises");
  const k = createHash("sha256").update(announceKey(arow())).digest("hex").slice(0, 24);
  await writeFile(join(dir, `${REFERRAL_PROGRAM_ID}-announce.jsonl`), `${JSON.stringify({ k, state: "intent" })}\n`);
  const result = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: RELEASE, receiptDir: dir }, deps);
  assert.equal(result.heldUnresolved, 1);
  assert.equal(sent.length, 0);
});
