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

test("review signals: quick mail confirmations flag; social sign-ins are exempt", () => {
  const friends = Array.from({ length: 3 }, (_, i) =>
    row({ pageId: `q${i}`, email: `q${i}@gmail.com`, verifiedAt: at(i * 3600 + 12) }),
  );
  const mail = new Map(friends.map((f, i) => [f.pageId, { signedUpAt: at(i * 3600 - 5), verificationSentAt: at(i * 3600) }]));
  const flagged = computeReviewSignals(friends, mail, { domainCounts: new Map() }, noDisposable);
  assert.equal(flagged.signals.quickConfirmations, 3);
  assert.ok(flagged.reasons.includes("quick_confirmation"));

  // Exactly at the threshold, or slower, is not quick.
  const slow = new Map(friends.map((f, i) => [f.pageId, { verificationSentAt: at(i * 3600 - 8) }]));
  assert.equal(computeReviewSignals(friends, slow, { domainCounts: new Map() }, noDisposable).signals.quickConfirmations, 0);

  // Google/Apple sign-ins verify with no mail click.
  const social = new Map(
    friends.map((f, i) => [
      f.pageId,
      i === 0
        ? { verificationSentAt: at(0), signupMethod: "google" }
        : i === 1
          ? { verificationSentAt: at(3600), signupMethod: "apple" }
          : { verificationSentAt: at(7200), socialVerified: true },
    ]),
  );
  const exempt = computeReviewSignals(friends, social, { domainCounts: new Map() }, noDisposable);
  assert.equal(exempt.signals.quickConfirmations, 0);
  assert.equal(exempt.reasons.includes("quick_confirmation"), false);

  // One quick confirmation alone (a mail scanner) is not enough.
  const one = new Map([[friends[0].pageId, { verificationSentAt: at(0) }]]);
  assert.equal(computeReviewSignals(friends, one, { domainCounts: new Map() }, noDisposable).reasons.includes("quick_confirmation"), false);
});

test("review signals: alias services count but flag above the allowance", () => {
  const isAlias = (email: string) => /@(duck\.com|mozmail\.com)$/.test(email);
  const mk = (k: number) =>
    Array.from({ length: 5 }, (_, i) =>
      row({ pageId: `a${k}${i}`, email: i < k ? `x${i}@duck.com` : `y${i}@gmail.com`, verifiedAt: at(i * 7200) }),
    );
  const two = computeReviewSignals(mk(2), new Map(), { domainCounts: new Map() }, noDisposable, { isAliasService: isAlias });
  assert.equal(two.signals.aliasFriends, 2);
  assert.equal(two.reasons.includes("alias_services"), false);
  const three = computeReviewSignals(mk(3), new Map(), { domainCounts: new Map() }, noDisposable, { isAliasService: isAlias });
  assert.equal(three.signals.aliasFriends, 3);
  assert.equal(three.signals.aliasShare, 0.6);
  assert.ok(three.reasons.includes("alias_services"));
  // Without the alias test the signal stays off (older callers).
  assert.equal(computeReviewSignals(mk(3), new Map(), { domainCounts: new Map() }, noDisposable).signals.aliasFriends, 0);
});

test("review signals: more than three friends on one non-mainstream domain", () => {
  const mk = (k: number) =>
    Array.from({ length: k }, (_, i) => row({ pageId: `d${k}${i}`, email: `p${i}@reefclub.dev`, verifiedAt: at(i * 7200) }));
  const three = computeReviewSignals(mk(3), new Map(), { domainCounts: new Map([["reefclub.dev", 3]]) }, noDisposable);
  assert.equal(three.signals.topOtherDomainFriends, 3);
  assert.equal(three.reasons.includes("domain_concentration"), false);
  const four = computeReviewSignals(mk(4), new Map(), { domainCounts: new Map([["reefclub.dev", 4]]) }, noDisposable);
  assert.ok(four.reasons.includes("domain_concentration"));
  // Mainstream providers never concentrate.
  const gmail = Array.from({ length: 6 }, (_, i) => row({ pageId: `m${i}`, email: `p${i}@gmail.com`, verifiedAt: at(i * 7200) }));
  assert.equal(computeReviewSignals(gmail, new Map(), { domainCounts: new Map() }, noDisposable).signals.topOtherDomainFriends, 0);
});

test("review signals: many never-confirmed sign-ups and signup bursts", () => {
  const friends = [0, 1].map((i) => row({ pageId: `v${i}`, email: `v${i}@gmail.com`, verifiedAt: at(i * 7200) }));
  const pending = Array.from({ length: 5 }, (_, i) =>
    row({ pageId: `p${i}`, email: `p${i}@gmail.com`, status: "pending", emailVerified: false, verifiedAt: undefined }),
  );
  const sig = new Map(pending.map((p, i) => [p.pageId, { signedUpAt: at(i * 20) }]));
  const { signals, reasons } = computeReviewSignals(friends, sig, { domainCounts: new Map() }, noDisposable, { pending });
  assert.equal(signals.pendingFriends, 5);
  assert.equal(signals.pendingShare, 0.714);
  assert.equal(signals.maxSignedUpInBurstWindow, 5);
  assert.ok(reasons.includes("pending_ratio"));
  assert.ok(reasons.includes("burst_signups"));
  // A normal verify rate does not flag.
  const calm = computeReviewSignals(friends, new Map(), { domainCounts: new Map() }, noDisposable, { pending: pending.slice(0, 1) });
  assert.equal(calm.reasons.includes("pending_ratio"), false);
  assert.equal(calm.reasons.includes("burst_signups"), false);
});

test("report: pending and unsubscribed-after-confirming friends reach the review signals", () => {
  const referrer = row({ pageId: "rr", refCode: "bbbbbbbb", email: "lead@example.com", canonicalEmail: "lead@example.com" });
  const confirmed = Array.from({ length: 3 }, (_, i) =>
    row({ pageId: `c${i}`, referredBy: "bbbbbbbb", email: `c${i}@gmail.com`, verifiedAt: at(i * 7200), status: i === 0 ? "unsubscribed" : "verified" }),
  );
  const never = Array.from({ length: 7 }, (_, i) =>
    row({ pageId: `n${i}`, referredBy: "bbbbbbbb", email: `n${i}@gmail.com`, status: "pending", emailVerified: false }),
  );
  const standing: ReferrerStanding = {
    refCode: "bbbbbbbb", credited: 3, reachedAt: {}, leaderOrder: null, lightEligible: false, lastCreditAt: at(14400),
  };
  const ledger = { standings: new Map([["bbbbbbbb", standing]]), excluded: {} } as unknown as LedgerResult;
  const { summary } = buildReport({
    rows: [referrer, ...confirmed, ...never],
    signals: new Map(),
    ledger,
    leaderboard: { entries: [], asOf: at(0), closed: false },
    now: new Date(T0),
    closesAt: null,
    isDisposable: noDisposable,
    isAliasService: () => false,
  });
  const candidate = summary.review.find((c) => c.refCode === "bbbbbbbb");
  assert.equal(candidate?.signals.friends, 3);
  assert.equal(candidate?.signals.pendingFriends, 7);
  assert.ok(candidate?.reasons.includes("pending_ratio"));
  assert.equal(candidate?.review_needed, true);
  assert.equal(JSON.stringify(summary).includes("@"), false);
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
  // The unsubscribed referrer gets no launch notice (it is a mail), but keeps
  // a reached reward, marked for reward-only contact (legal review D7).
  for (const name of ["early-notice-1h.csv", "early-notice-2h.csv"]) {
    assert.equal(files[name].includes("gone@example.com"), false);
  }
  assert.match(files["top-candidates.csv"], /gone@example\.com,cccccccc,1,,,unsubscribed/);
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

test("announce: a one-click unsubscribe or an abuse flag stops the announcement", () => {
  // The unsubscribe link this mail carries writes `Launch mail`, not the status.
  assert.equal(announceSkipReason(arow({ launchMail: "unsubscribed 2026-11-02T00:00:00.000Z" }), RELEASE), "unsubscribed");
  assert.equal(announceSkipReason(arow({ reservationMail: "unsubscribed 2026-11-02T00:00:00.000Z" }), RELEASE), "unsubscribed");
  // Even the --only self-test never mails an opted-out address.
  assert.equal(announceSkipReason(arow({ launchMail: "Unsubscribe" }), RELEASE, true), "unsubscribed");
  assert.equal(announceSkipReason(arow({ launchMail: "t-1d sent 2026-12-01T00:00:00Z" }), RELEASE), null);
  assert.equal(announceSkipReason(arow({ flags: ["bot-signal"] }), RELEASE), "blocked_flag");
  assert.equal(announceSkipReason(arow({ flags: ["ip-repeat"] }), RELEASE), null);
});

test("announce: one mail per address, and an opt-out on any of its rows covers it", async () => {
  const rows = [
    arow({ pageId: "a1", leadId: "44444440-4444-4444-8444-444444444444", email: "twice@example.com", refCode: "abcd0001" }),
    arow({ pageId: "a2", leadId: "44444441-4444-4444-8444-444444444444", email: "Twice@Example.com ", refCode: "abcd0002" }),
    arow({ pageId: "b1", leadId: "44444442-4444-4444-8444-444444444444", email: "gone@example.com", refCode: "abcd0003" }),
    arow({ pageId: "b2", leadId: "44444443-4444-4444-8444-444444444444", email: "gone@example.com", refCode: "abcd0004", launchMail: "unsubscribed 2026-11-02T00:00:00.000Z" }),
  ];
  const { sent, dir, deps } = await setup(rows, { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" });
  const result = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: RELEASE, receiptDir: dir }, deps);
  assert.deepEqual(sent.map((m) => m.to), ["twice@example.com"]);
  assert.equal(result.skipped.duplicate_address, 1);
  assert.equal(result.skipped.unsubscribed_address, 1);
  assert.equal(result.skipped.unsubscribed, 1);
  // The lead id is what signs the opt-out link: no id, no mail.
  assert.equal(announceSkipReason(arow({ leadId: "" }), RELEASE), "no_opt_out");
});

test("announce idempotency key", () => {
  assert.equal(announceKey(arow()), `${REFERRAL_PROGRAM_ID}-announce-${LEAD}`);
  assert.equal(announceKey(arow({ leadId: "" })), `${REFERRAL_PROGRAM_ID}-announce-p1`);
  assert.notEqual(announceKey(arow(), true), announceKey(arow()));
});

const PHONE = "+82 10-0000-0000";
const UNSUB = `https://x.test/unsubscribe/u1.${LEAD}.ko.${"A".repeat(43)}`;
const LINKS = {
  share: "https://x.test/r/abcd1234",
  status: "https://x.test/buddy#t",
  rules: "https://x.test/buddy-rules",
  unsubscribe: UNSUB,
};

test("announce render is the welcome guide and escapes every value", async () => {
  const { buddyGuideBody } = await import("../src/lib/verification/resend.ts");
  const mail = renderAnnouncement(
    "en",
    { ...LINKS, status: 'https://x.test/buddy#t"><script>x</script>' },
    { env: {} },
  );
  assert.equal(mail.html.includes("<script>"), false);
  assert.ok(mail.html.includes("&lt;script&gt;"));
  // Single source: byte-identical to the welcome-guide renderer.
  const guide = buddyGuideBody(
    { shareUrl: LINKS.share, statusUrl: LINKS.status, rulesUrl: LINKS.rules },
    "fr",
    { unsubscribeUrl: UNSUB, korean: false },
  );
  const announce = renderAnnouncement("fr", LINKS, { env: {} });
  assert.equal(announce.html, guide.html);
  assert.equal(announce.text, guide.text);
  assert.equal(announce.subject, guide.subject);
  assert.equal(announce.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(announce.headers["List-Unsubscribe"].startsWith(`<${UNSUB}>`));
  assert.equal(maskEmail("diver@example.com"), "d***@example.com");
});

test("announce render: Korean rules for ko or KR, refused without the sender phone", () => {
  assert.throws(() => renderAnnouncement("ko", LINKS, { env: {} }), /WATCHDIVE_SENDER_PHONE/);
  assert.throws(() => renderAnnouncement("en", LINKS, { signupCountry: "KR", env: {} }), /WATCHDIVE_SENDER_PHONE/);
  const ko = renderAnnouncement("ko", LINKS, { env: { WATCHDIVE_SENDER_PHONE: PHONE } });
  assert.ok(ko.subject.startsWith("(광고) "));
  assert.ok(ko.text.includes(`보내는 곳: DIVEROID LTD · help@diveroid.com · ${PHONE} · `));
  assert.ok(ko.html.includes(`href="${UNSUB}"`));
  assert.throws(() => renderAnnouncement("en", { ...LINKS, unsubscribe: undefined }, { env: {} }), /https unsubscribe/);
});

async function setup(rows: AnnounceRow[], env: Record<string, string | undefined>) {
  const sent: AnnounceMessage[] = [];
  const dir = await mkdtemp(join(tmpdir(), "refann-"));
  const deps: AnnounceDeps = {
    rows, env: { WATCHDIVE_SENDER_PHONE: PHONE, ...env },
    links: (r) => ({ ...LINKS, share: `https://x.test/r/${r.refCode}` }),
    send: async (m) => void sent.push(m),
    sleep: async () => {},
  };
  return { sent, dir, deps };
}

test("announce: dry run sends and writes nothing, sample address is masked", async () => {
  const { sent, dir, deps } = await setup([arow(), arow({ pageId: "p2", leadId: "22222222-2222-4222-8222-222222222222", email: "late@example.com", verifiedAt: "2026-11-05T00:00:00Z" })], {});
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
  const rows = ["a", "b", "c"].map((id, i) => arow({ pageId: id, leadId: `3333333${i}-3333-4333-8333-333333333333`, email: `${id}@example.com`, refCode: `abcd123${i}` }));
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

test("announce: rows opted out by a marker, or sharing an opted-out inbox, are skipped", async () => {
  const rows = [
    arow({ pageId: "a", email: "one@example.com", launchMail: "unsubscribed 2026-10-01T00:00:00Z" }),
    arow({ pageId: "b", email: "two@example.com", reservationMail: "unsubscribed 2026-10-01T00:00:00Z" }),
    // Same Gmail inbox as an opted-out legacy row.
    arow({ pageId: "c", email: "Three.X+promo@gmail.com" }),
    arow({ pageId: "d", email: "threex@googlemail.com", status: "unsubscribed" }),
    arow({ pageId: "e", email: "four@example.com", leadId: "" }),
    arow({ pageId: "f", email: "ok@example.com" }),
  ];
  const { sent, dir, deps } = await setup(rows, { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" });
  const result = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: RELEASE, receiptDir: dir }, deps);
  assert.deepEqual(sent.map((m) => m.to), ["ok@example.com"]);
  assert.equal(result.skipped.unsubscribed, 3);
  assert.equal(result.skipped.unsubscribed_address, 1);
  assert.equal(result.skipped.no_opt_out, 1);
  assert.equal(sent[0]!.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("announce: a Korean recipient without WATCHDIVE_SENDER_PHONE aborts the whole run before any send", async () => {
  const rows = [arow({ pageId: "en", email: "en@example.com", signupLocale: "en" }), arow()];
  const { sent, dir, deps } = await setup(rows, { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" });
  const noPhone = { ...deps, env: { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" } };
  const opts = { apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: RELEASE, receiptDir: dir };
  const refused = await runAnnounce(opts, noPhone);
  assert.equal(refused.aborted, "sender_phone_missing");
  assert.equal(refused.senderPhoneMissing, 1);
  assert.equal(sent.length, 0);
  await assert.rejects(stat(join(dir, `${REFERRAL_PROGRAM_ID}-announce.jsonl`)));
  // Dry run reports it and still samples the renderable English row.
  const dry = await runAnnounce({ ...opts, apply: false }, noPhone);
  assert.equal(dry.senderPhoneMissing, 1);
  assert.equal(dry.sample?.locale, "en");
  // With the phone set both go out; the ko one carries the prefix.
  const ok = await runAnnounce(opts, deps);
  assert.equal(ok.sent, 2);
  assert.ok(sent.find((m) => m.to === "diver@example.com")!.subject.startsWith("(광고) "));
});
