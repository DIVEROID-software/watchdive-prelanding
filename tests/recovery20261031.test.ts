// Offline review of the bounded 2026-10-31 recovery helper.
// No network, no Notion, no Resend, no customer addresses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { VERIFICATION_MAX_SENDS, type LeadRecord } from "../src/lib/verification/contracts.ts";
import {
  HISTORICAL_RECOVERY_CAMPAIGN,
  HISTORICAL_RECOVERY_CASES,
  RECOVERY_CAMPAIGN,
  RECOVERY_CASES,
  RECOVERY_CLOSE_AT,
  handleVerificationRecovery,
  runVerificationRecovery,
} from "../src/lib/verification/recovery20261031.server.ts";
import { createResendMailer, type VerificationMail, type VerificationMailer } from "../src/lib/verification/resend.ts";
import { createVerificationToken, parseVerificationToken } from "../src/lib/verification/token.ts";
import { TEST_ENV, TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";

const OPEN = new Date("2026-11-01T03:00:00.000Z");
const CRON_SECRET = "recovery-cron-secret-16";

const LEADS: Record<string, string> = {
  "apple-morning": "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
  "apple-afternoon": "aaaaaaaa-bbbb-4ccc-8ddd-000000000002",
  "honeypot-afternoon": "aaaaaaaa-bbbb-4ccc-8ddd-000000000003",
  "honeypot-evening": "aaaaaaaa-bbbb-4ccc-8ddd-000000000004",
};

type SentMail = {
  to: string;
  token: string;
  leadId: string;
  locale: string;
  manualCampaign?: string;
  reminder?: boolean;
};

class Mailer implements VerificationMailer {
  sent: SentMail[] = [];
  welcomes = 0;
  fail = false;
  onSend?: () => void;

  async send(input: VerificationMail): Promise<void> {
    this.onSend?.();
    if (this.fail) throw new Error("provider_down");
    this.sent.push({
      to: input.to,
      token: input.token,
      leadId: input.leadId,
      locale: input.locale,
      ...(input.manualCampaign ? { manualCampaign: input.manualCampaign } : {}),
      ...(input.reminder ? { reminder: true } : {}),
    });
  }

  async sendWelcome(): Promise<void> {
    this.welcomes += 1;
    throw new Error("welcome_not_allowed");
  }
}

class Store {
  rows = new Map<string, LeadRecord>();
  claims: { pageId: string; marker: string; sends: number }[] = [];
  outcomes: { pageId: string; outcome: string }[] = [];
  marked: { pageId: string; sentAt: string }[] = [];
  failClaimFor = new Set<string>();
  failOutcome = false;
  throwOn?: (pageId: string, n: number) => boolean;
  onReread?: (pageId: string, n: number, snap: LeadRecord) => void;
  private reads = new Map<string, number>();

  constructor(rows: LeadRecord[]) {
    for (const row of rows) this.rows.set(row.pageId, clone(row));
  }

  async reread(pageId: string): Promise<LeadRecord | undefined> {
    const n = (this.reads.get(pageId) ?? 0) + 1;
    this.reads.set(pageId, n);
    if (this.throwOn?.(pageId, n)) throw new Error("reread_down");
    const row = this.rows.get(pageId);
    if (!row) return undefined;
    const snap = clone(row);
    this.onReread?.(pageId, n, snap);
    return snap;
  }

  async claimReminder(
    pageId: string,
    claim: { marker: string; sends: number; expiresAt: string },
  ): Promise<void> {
    if (this.failClaimFor.has(pageId)) throw new Error("claim_down");
    const row = this.rows.get(pageId);
    if (!row) throw new Error("missing_page");
    this.rows.set(pageId, { ...row, reminder: claim.marker, sends: claim.sends, expiresAt: claim.expiresAt });
    this.claims.push({ pageId, marker: claim.marker, sends: claim.sends });
  }

  async recordReminderOutcome(pageId: string, outcome: string): Promise<void> {
    if (this.failOutcome) throw new Error("outcome_down");
    const row = this.rows.get(pageId);
    if (row) this.rows.set(pageId, { ...row, reminder: outcome });
    this.outcomes.push({ pageId, outcome });
  }

  async markSent(pageId: string, input: { sentAt: string }): Promise<void> {
    const row = this.rows.get(pageId);
    if (row) this.rows.set(pageId, { ...row, sentAt: input.sentAt });
    this.marked.push({ pageId, sentAt: input.sentAt });
  }
}

function clone(row: LeadRecord): LeadRecord {
  return { ...row, flags: [...row.flags] };
}

function rowFor(label: string, patch: Partial<LeadRecord> = {}): LeadRecord {
  const found = RECOVERY_CASES.find((item) => item.label === label);
  if (!found) throw new Error(`unknown case ${label}`);
  const apple = found.method === "apple";
  const row: LeadRecord = {
    pageId: `pid-${label}`,
    email: apple ? `${label}@privaterelay.appleid.com` : `${label}@gmail.com`,
    status: "pending",
    emailVerified: false,
    refCode: "abcd1234",
    source: "hero",
    suspect: !apple,
    flags: apple ? [] : ["honeypot"],
    phone: "",
    leadId: LEADS[label] ?? "aaaaaaaa-bbbb-4ccc-8ddd-0000000000ff",
    metaEventId: "",
    sends: 1,
    signupMethod: found.method,
    signupCountry: found.country,
    signupLocale: found.locale,
    signedUpAt: found.at,
    authVerificationProvenance: apple ? "apple:private-relay" : "email:double-opt-in",
    ...(apple ? { appleSubject: `subject-${label}` } : {}),
  };
  return { ...row, ...patch, flags: patch.flags ?? row.flags };
}

function fourRows(): LeadRecord[] {
  return RECOVERY_CASES.map((item) => rowFor(item.label));
}

function caseStatus(result: { cases: { case: string; status: string }[] }, label: string): string {
  const found = result.cases.find((item) => item.case === label);
  assert.ok(found, label);
  return found.status;
}

function assertNoIdentity(result: unknown, rows: LeadRecord[]): void {
  const text = JSON.stringify(result);
  for (const row of rows) {
    assert.equal(text.includes(row.email), false);
    assert.equal(text.includes(row.pageId), false);
    assert.equal(text.includes(row.leadId), false);
  }
  assert.equal(text.includes(TEST_SECRET), false);
  assert.equal(text.includes(CRON_SECRET), false);
}

async function recover(
  rows: LeadRecord[],
  options: {
    send?: boolean;
    now?: () => Date;
    store?: Store;
    mailer?: Mailer;
    listRows?: () => Promise<LeadRecord[]>;
    campaign?: typeof RECOVERY_CAMPAIGN | typeof HISTORICAL_RECOVERY_CAMPAIGN;
  } = {},
) {
  const store = options.store ?? new Store(rows);
  const mailer = options.mailer ?? new Mailer();
  const result = await runVerificationRecovery({
    rows,
    store,
    mailer,
    env: TEST_ENV,
    listRows: options.listRows ?? (async () => [...store.rows.values()].map(clone)),
    send: options.send ?? false,
    now: options.now ?? (() => OPEN),
    campaign: options.campaign,
  });
  return { result, store, mailer };
}

test("the campaign is the four incident signatures and closes 2026-11-02 13:00Z", () => {
  assert.equal(RECOVERY_CAMPAIGN, "wd-verification-recovery-20261031");
  assert.equal(RECOVERY_CLOSE_AT, "2026-11-02T13:00:00Z");
  assert.deepEqual(
    RECOVERY_CASES.map((item) => ({ ...item })),
    [
      { label: "apple-morning", at: "2026-10-31T01:08:00Z", method: "apple", country: "TW", locale: "zh-TW" },
      { label: "apple-afternoon", at: "2026-10-31T07:21:00Z", method: "apple", country: "TW", locale: "zh-TW" },
      { label: "honeypot-afternoon", at: "2026-10-31T05:29:00Z", method: "email", country: "US", locale: "ko" },
      { label: "honeypot-evening", at: "2026-10-31T08:48:00Z", method: "email", country: "AT", locale: "ko" },
    ],
  );
});

test("dry-run counts two ko and two zh-TW and writes nothing", async () => {
  const rows = fourRows();
  const { result, store, mailer } = await recover(rows);
  assert.equal(result.dryRun, true);
  assert.equal(result.eligible, 4);
  assert.equal(result.accepted, 0);
  assert.deepEqual(result.byLocale, { "zh-TW": 2, ko: 2 });
  assert.deepEqual(result.cases.map((item) => item.status), ["eligible", "eligible", "eligible", "eligible"]);
  assert.equal(store.claims.length, 0);
  assert.equal(store.outcomes.length, 0);
  assert.equal(store.marked.length, 0);
  assert.equal(mailer.sent.length, 0);
  assert.equal(mailer.welcomes, 0);
  for (const row of rows) {
    const saved = store.rows.get(row.pageId);
    assert.equal(saved?.emailVerified, false);
    assert.equal(saved?.reminder, undefined);
    assert.deepEqual(saved?.flags, row.flags);
    assert.equal(saved?.suspect, row.suspect);
  }
  assertNoIdentity(result, rows);
});

test("send mails a fresh double opt-in once and does not verify", async () => {
  const rows = fourRows();
  const { result, store, mailer } = await recover(rows, { send: true });
  assert.equal(result.dryRun, false);
  assert.equal(result.accepted, 4);
  assert.equal(result.failedOrUnknown, 0);
  assert.equal(result.recordFailed, 0);
  assert.equal(mailer.sent.length, 4);
  assert.equal(mailer.welcomes, 0);
  assert.equal(store.marked.length, 4);
  const locales = mailer.sent.map((item) => item.locale).sort();
  assert.deepEqual(locales, ["ko", "ko", "zh-TW", "zh-TW"]);
  for (const sent of mailer.sent) {
    assert.equal(sent.manualCampaign, RECOVERY_CAMPAIGN);
    assert.equal(sent.reminder, undefined);
    const parsed = parseVerificationToken(sent.token, TEST_SECRET, OPEN.getTime());
    assert.equal(parsed?.measurementConsent, false);
    assert.equal(parsed?.locale, sent.locale);
    assert.equal(parsed?.leadId, sent.leadId);
  }
  for (const claim of store.claims) {
    assert.equal(claim.marker, `${RECOVERY_CAMPAIGN} claimed ${OPEN.toISOString()}`);
    assert.equal(claim.sends, 2);
  }
  for (const outcome of store.outcomes) {
    assert.match(outcome.outcome, new RegExp(`^${RECOVERY_CAMPAIGN} provider_accepted `));
  }
  for (const row of rows) {
    const saved = store.rows.get(row.pageId);
    assert.equal(saved?.emailVerified, false);
    assert.equal(saved?.status, "pending");
    assert.ok(saved?.sentAt);
    assert.deepEqual(saved?.flags, row.flags);
  }
  assertNoIdentity(result, rows);
});

test("one extra second, a second matching row, and an old campaign row stay out", async () => {
  const shifted = rowFor("apple-morning", { signedUpAt: "2026-10-31T01:08:01.000Z" });
  const twin = rowFor("apple-afternoon", { pageId: "pid-apple-afternoon-twin" });
  const old = rowFor("honeypot-evening", {
    pageId: "pid-old-campaign",
    signedUpAt: "2026-10-19T01:00:00.000Z",
    reminder: "wd-manual-verify-20261019 sent 2026-10-19T02:00:00.000Z",
    sentAt: "2026-10-19T01:05:00.000Z",
  });
  const rows = [shifted, rowFor("apple-afternoon"), twin, old];
  const { result, mailer } = await recover(rows, { send: true });
  assert.equal(caseStatus(result, "apple-morning"), "missing");
  assert.equal(caseStatus(result, "apple-afternoon"), "ambiguous");
  assert.equal(caseStatus(result, "honeypot-afternoon"), "missing");
  assert.equal(caseStatus(result, "honeypot-evening"), "missing");
  assert.equal(result.eligible, 0);
  assert.equal(mailer.sent.length, 0);
  assert.equal(result.cases.length, 4);
});

test("the same instant with an offset or milliseconds still matches", async () => {
  const rows = [
    rowFor("apple-morning", { signedUpAt: "2026-10-31T10:08:00.000+09:00" }),
    rowFor("honeypot-afternoon", { signedUpAt: "2026-10-31T05:29:00.000Z" }),
  ];
  const { result } = await recover(rows);
  assert.equal(caseStatus(result, "apple-morning"), "eligible");
  assert.equal(caseStatus(result, "honeypot-afternoon"), "eligible");
});

test("apple signature rejects provenance, flags, suspect, subject, and domain", async () => {
  const variants: [string, Partial<LeadRecord>][] = [
    ["provenance", { authVerificationProvenance: "apple:verified-email" }],
    ["flag", { flags: ["ip-repeat"] }],
    ["suspect", { suspect: true }],
    ["subject", { appleSubject: undefined }],
    ["domain", { email: "person@example.test" }],
    ["space", { email: "apple-morning@privaterelay.appleid.com " }],
  ];
  for (const [name, patch] of variants) {
    const rows = [rowFor("apple-morning", patch)];
    const { result, mailer } = await recover(rows, { send: true });
    assert.equal(caseStatus(result, "apple-morning"), "apple_signature_mismatch", name);
    assert.equal(mailer.sent.length, 0, name);
  }
  const mixed = [rowFor("apple-morning", { email: "Apple-Morning@PrivateRelay.AppleID.com" })];
  const { result } = await recover(mixed);
  assert.equal(caseStatus(result, "apple-morning"), "eligible");
});

test("honeypot requires the single flag and email provenance, and keeps suspect", async () => {
  const blocked: Partial<LeadRecord>[] = [
    { flags: ["honeypot", "headless"] },
    { flags: [] },
    { flags: ["Honeypot"] },
    { authVerificationProvenance: "email:password" },
    { authVerificationProvenance: undefined },
  ];
  for (const patch of blocked) {
    const rows = [rowFor("honeypot-afternoon", patch)];
    const { result, mailer } = await recover(rows, { send: true });
    assert.equal(caseStatus(result, "honeypot-afternoon"), "other_abuse_or_signature_mismatch");
    assert.equal(mailer.sent.length, 0);
  }
  for (const suspect of [true, false]) {
    const rows = [rowFor("honeypot-evening", { suspect })];
    const { result, store } = await recover(rows, { send: true });
    assert.equal(caseStatus(result, "honeypot-evening"), "provider_accepted");
    assert.equal(store.rows.get(rows[0].pageId)?.suspect, suspect);
    assert.deepEqual(store.rows.get(rows[0].pageId)?.flags, ["honeypot"]);
    assert.equal(store.rows.get(rows[0].pageId)?.emailVerified, false);
  }
});

test("verified, opted out, duplicate, invalid, sent, reminded, and capped rows do not mail", async () => {
  const cases: [string, Partial<LeadRecord>][] = [
    ["verified_or_suppressed", { emailVerified: true }],
    ["verified_or_suppressed", { verifiedAt: "2026-10-31T09:00:00.000Z" }],
    ["verified_or_suppressed", { status: "verified" }],
    ["verified_or_suppressed", { status: "unsubscribed" }],
    ["verified_or_suppressed", { status: "suppressed" }],
    ["verified_or_suppressed", { status: "legacy" }],
    ["verified_or_suppressed", { launchMail: "unsubscribed 2026-10-31T09:00:00.000Z" }],
    ["verified_or_suppressed", { reservationMail: "unsubscribed 2026-10-31T09:00:00.000Z" }],
    ["duplicate", { duplicate: true }],
    ["invalid_attempt", { leadId: "not-a-uuid" }],
    ["invalid_attempt", { email: "not-an-email" }],
    ["already_sent", { sentAt: "2026-10-31T05:30:00.000Z" }],
    ["claimed_or_previous_outcome", { reminder: "sent 2026-10-31T06:00:00.000Z" }],
    ["send_cap", { sends: VERIFICATION_MAX_SENDS }],
  ];
  for (const [expected, patch] of cases) {
    const rows = [rowFor("honeypot-afternoon", patch)];
    const { result, store, mailer } = await recover(rows, { send: true });
    assert.equal(caseStatus(result, "honeypot-afternoon"), expected, JSON.stringify(patch));
    assert.equal(mailer.sent.length, 0);
    assert.equal(store.claims.length, 0);
  }
  const unchecked = [rowFor("honeypot-afternoon", { duplicate: false })];
  const open = await recover(unchecked);
  assert.equal(caseStatus(open.result, "honeypot-afternoon"), "eligible");
});

test("post-claim send cap uses greater-than, so the increment from 4 still mails", async () => {
  const rows = [rowFor("honeypot-afternoon", { sends: VERIFICATION_MAX_SENDS - 1 })];
  let result: Awaited<ReturnType<typeof recover>>["result"] | undefined;
  try {
    result = (await recover(rows, { send: true })).result;
  } catch (error) {
    assert.fail(`send of an under-cap row must return: ${error instanceof Error ? error.message : error}`);
  }
  assert.equal(
    caseStatus(result, "honeypot-afternoon"),
    "provider_accepted",
    "before-check stays sends >= MAX; after-check must be sends > MAX so a claim of 4 to 5 is mailed once",
  );
});

test("a post-claim reread of 6, above the incremented claim, does not mail", async () => {
  const rows = [rowFor("apple-morning", { sends: VERIFICATION_MAX_SENDS - 1 })];
  const store = new Store(rows);
  store.onReread = (_pageId, n, snap) => {
    if (n === 2) snap.sends = VERIFICATION_MAX_SENDS + 1;
  };
  const { result, mailer } = await recover(rows, { send: true, store });
  assert.equal(caseStatus(result, "apple-morning"), "changed_after_claim");
  assert.equal(mailer.sent.length, 0);
  assert.equal(store.claims.length, 1);
  assert.equal(result.claimedButNotSent, 1);
  assert.equal(result.notClaimed, 0);
});

test("a gmail or googlemail peer on another page blocks, including a pending peer", async () => {
  const row = rowFor("honeypot-afternoon", { email: "honey.afternoon+tag@gmail.com" });
  const peer = rowFor("honeypot-evening", {
    pageId: "pid-peer",
    email: "honeyafternoon@googlemail.com",
    signedUpAt: "2026-10-30T00:00:00.000Z",
    signupCountry: "KR",
    status: "pending",
    emailVerified: false,
  });
  const { result, mailer } = await recover([row, peer], { send: true });
  assert.equal(caseStatus(result, "honeypot-afternoon"), "other_identity_row_requires_review");
  assert.equal(mailer.sent.length, 0);
});

test("dots on a non-gmail domain are a different inbox and do not block", async () => {
  const row = rowFor("apple-morning", { email: "ab@privaterelay.appleid.com" });
  const peer = rowFor("apple-afternoon", {
    pageId: "pid-dots",
    email: "a.b@privaterelay.appleid.com",
    signedUpAt: "2026-10-30T00:00:00.000Z",
    signupCountry: "KR",
    signupMethod: "apple",
  });
  const { result, mailer } = await recover([row, peer], { send: true });
  assert.equal(caseStatus(result, "apple-morning"), "provider_accepted");
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0]?.to, "ab@privaterelay.appleid.com");
});

test("verified or unsubscribed before the claim is not claimed", async () => {
  for (const patch of [
    { emailVerified: true },
    { status: "unsubscribed" as const },
    { launchMail: "unsubscribed 2026-11-01T00:00:00.000Z" },
  ]) {
    const rows = [rowFor("apple-afternoon")];
    const store = new Store(rows);
    store.onReread = (_pageId, n, snap) => {
      if (n === 1) Object.assign(snap, patch);
    };
    const { result, mailer } = await recover(rows, { send: true, store });
    assert.equal(caseStatus(result, "apple-afternoon"), "changed_before_claim");
    assert.equal(store.claims.length, 0);
    assert.equal(mailer.sent.length, 0);
  }
});

test("verified or unsubscribed after the claim is not mailed and is not replayed", async () => {
  const rows = [rowFor("apple-morning")];
  const store = new Store(rows);
  store.onReread = (_pageId, n, snap) => {
    if (n === 2) {
      snap.emailVerified = true;
      snap.status = "unsubscribed";
      snap.launchMail = "unsubscribed 2026-11-01T03:00:01.000Z";
    }
  };
  const first = await recover(rows, { send: true, store });
  assert.equal(caseStatus(first.result, "apple-morning"), "changed_after_claim");
  assert.equal(first.store.claims.length, 1);
  assert.equal(first.mailer.sent.length, 0);
  assert.equal(first.result.claimedButNotSent, 1);
  assert.equal(first.result.notClaimed, 0);
  const secondRows = [...first.store.rows.values()];
  const second = await recover(secondRows, { send: true });
  assert.equal(caseStatus(second.result, "apple-morning"), "claimed_or_previous_outcome");
  assert.equal(second.mailer.sent.length, 0);
  assert.equal(second.store.claims.length, 0);
});

test("an archived reread and a changed attempt do not mail", async () => {
  const missing = [rowFor("apple-morning")];
  const dropped = await recover(missing, {
    send: true,
    store: new Store([]),
    listRows: async () => [],
  });
  assert.equal(caseStatus(dropped.result, "apple-morning"), "identity_or_cohort_changed");
  assert.equal(dropped.store.claims.length, 0);
  assert.equal(dropped.mailer.sent.length, 0);

  const stillListed = new Store([]);
  const archived = await recover(missing, {
    send: true,
    store: stillListed,
    listRows: async () => missing.map(clone),
  });
  assert.equal(caseStatus(archived.result, "apple-morning"), "changed_before_claim");
  assert.equal(archived.mailer.sent.length, 0);

  const changedLead = [rowFor("apple-afternoon")];
  const leadStore = new Store(changedLead);
  leadStore.onReread = (_pageId, n, snap) => {
    if (n === 1) snap.leadId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000099";
  };
  const lead = await recover(changedLead, { send: true, store: leadStore });
  assert.equal(caseStatus(lead.result, "apple-afternoon"), "changed_before_claim");
  assert.equal(lead.store.claims.length, 0);

  const changedEmail = [rowFor("honeypot-evening")];
  const emailStore = new Store(changedEmail);
  emailStore.onReread = (_pageId, n, snap) => {
    if (n === 2) snap.email = "other-person@example.test";
  };
  const email = await recover(changedEmail, { send: true, store: emailStore });
  assert.equal(caseStatus(email.result, "honeypot-evening"), "changed_after_claim");
  assert.equal(email.store.claims.length, 1);
  assert.equal(email.mailer.sent.length, 0);
});

test("a provider error keeps the claim and the next run does not send", async () => {
  const rows = [rowFor("honeypot-afternoon")];
  const mailer = new Mailer();
  mailer.fail = true;
  const store = new Store(rows);
  const first = await recover(rows, { send: true, store, mailer });
  assert.equal(caseStatus(first.result, "honeypot-afternoon"), "failed_or_unknown");
  assert.equal(first.result.failedOrUnknown, 1);
  assert.equal(first.mailer.sent.length, 0);
  assert.equal(store.claims.length, 1);
  assert.equal(store.marked.length, 0);
  assert.match(store.outcomes[0]?.outcome ?? "", /failed_or_unknown/);
  assert.equal(store.rows.get(rows[0].pageId)?.sentAt, undefined);
  const second = await recover([...store.rows.values()], { send: true });
  assert.equal(caseStatus(second.result, "honeypot-afternoon"), "claimed_or_previous_outcome");
  assert.equal(second.mailer.sent.length, 0);
});

test("a claim failure skips that case and still mails the next one", async () => {
  const rows = [rowFor("apple-morning"), rowFor("apple-afternoon")];
  const store = new Store(rows);
  store.failClaimFor.add(rows[0].pageId);
  const { result, mailer } = await recover(rows, { send: true, store });
  assert.equal(caseStatus(result, "apple-morning"), "claim_failed_or_unknown");
  assert.equal(caseStatus(result, "apple-afternoon"), "provider_accepted");
  assert.equal(store.claims.length, 1);
  assert.equal(store.claims[0]?.pageId, rows[1].pageId);
  assert.equal(mailer.sent.length, 1);
});

test("a reread throw after claim does not abort the later case", async () => {
  const rows = [rowFor("apple-morning"), rowFor("apple-afternoon")];
  const store = new Store(rows);
  store.throwOn = (pageId, n) => pageId === rows[0].pageId && n === 2;
  let result: Awaited<ReturnType<typeof recover>>["result"] | undefined;
  const mailer = new Mailer();
  try {
    result = (await recover(rows, { send: true, store, mailer })).result;
  } catch (error) {
    assert.fail(
      `post-claim reread must be caught per case so later cases still run: ${error instanceof Error ? error.message : error}`,
    );
  }
  assert.equal(caseStatus(result, "apple-morning"), "read_failed_after_claim");
  assert.equal(result.claimedButNotSent, 1);
  assert.equal(store.claims.some((claim) => claim.pageId === rows[0].pageId), true);
  assert.equal(mailer.sent.some((sent) => sent.leadId === rows[0].leadId), false);
  assert.equal(caseStatus(result, "apple-afternoon"), "provider_accepted");
});

test("a reread throw before claim does not abort the later case", async () => {
  const rows = [rowFor("apple-morning"), rowFor("honeypot-evening")];
  const store = new Store(rows);
  store.throwOn = (pageId, n) => pageId === rows[0].pageId && n === 1;
  let result: Awaited<ReturnType<typeof recover>>["result"] | undefined;
  const mailer = new Mailer();
  try {
    result = (await recover(rows, { send: true, store, mailer })).result;
  } catch (error) {
    assert.fail(
      `pre-claim reread must be caught per case so later cases still run: ${error instanceof Error ? error.message : error}`,
    );
  }
  assert.equal(caseStatus(result, "apple-morning"), "read_failed_before_claim");
  assert.equal(store.claims.some((claim) => claim.pageId === rows[0].pageId), false);
  assert.equal(mailer.sent.some((sent) => sent.leadId === rows[0].leadId), false);
  assert.equal(caseStatus(result, "honeypot-evening"), "provider_accepted");
});

test("an outcome write failure still marks the accepted send", async () => {
  const rows = [rowFor("honeypot-evening")];
  const store = new Store(rows);
  store.failOutcome = true;
  let marked = 0;
  const mailer = new Mailer();
  try {
    const { result } = await recover(rows, { send: true, store, mailer });
    assert.equal(caseStatus(result, "honeypot-evening"), "provider_accepted");
    assert.equal(result.recordFailed, 1);
    marked = store.marked.length;
  } catch (error) {
    assert.fail(error instanceof Error ? error.message : String(error));
  }
  assert.equal(marked, 1, "provider_accepted with the same attempt must markSent even when the outcome write throws");
  assert.equal(mailer.sent.length, 1);
  assert.equal(store.claims.length, 1);
});

test("markSent is skipped when the attempt changed after acceptance", async () => {
  const rows = [rowFor("apple-afternoon")];
  const store = new Store(rows);
  const original = rows[0].leadId;
  store.recordReminderOutcome = async (pageId, outcome) => {
    const row = store.rows.get(pageId);
    if (row) {
      store.rows.set(pageId, {
        ...row,
        reminder: outcome,
        leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000077",
      });
    }
    store.outcomes.push({ pageId, outcome });
  };
  const { result, mailer } = await recover(rows, { send: true, store });
  assert.equal(caseStatus(result, "apple-afternoon"), "provider_accepted");
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0]?.leadId, original);
  assert.equal(store.marked.length, 0);
});

test("the close instant rejects, and a clock that crosses it stops the later case", async () => {
  await assert.rejects(recover(fourRows(), { now: () => new Date(RECOVERY_CLOSE_AT) }), /recovery_closed/);
  await assert.rejects(
    recover(fourRows(), { send: true, now: () => new Date(Date.parse(RECOVERY_CLOSE_AT) + 1) }),
    /recovery_closed/,
  );
  const justOpen = await recover(fourRows(), { now: () => new Date(Date.parse(RECOVERY_CLOSE_AT) - 1) });
  assert.equal(justOpen.result.eligible, 4);
  assert.equal(justOpen.mailer.sent.length, 0);

  let now = new Date(Date.parse(RECOVERY_CLOSE_AT) - 1000);
  const rows = [rowFor("apple-morning"), rowFor("apple-afternoon")];
  const mailer = new Mailer();
  mailer.onSend = () => {
    now = new Date(RECOVERY_CLOSE_AT);
  };
  const { result } = await recover(rows, { send: true, mailer, now: () => now });
  assert.equal(caseStatus(result, "apple-morning"), "provider_accepted");
  assert.equal(caseStatus(result, "apple-afternoon"), "closed");
  assert.equal(mailer.sent.length, 1);
  assert.equal(result.byLocale["zh-TW"], 2);
  assert.equal(result.accepted, 1);
});

test("a stale reread after a successful claim does not mail and the claim blocks a replay", async () => {
  const rows = [rowFor("honeypot-afternoon")];
  const store = new Store(rows);
  store.onReread = (_pageId, n, snap) => {
    if (n === 2) {
      delete snap.reminder;
      snap.sends = 1;
    }
  };
  const first = await recover(rows, { send: true, store });
  assert.equal(caseStatus(first.result, "honeypot-afternoon"), "changed_after_claim");
  assert.equal(first.mailer.sent.length, 0);
  assert.equal(store.claims.length, 1);
  const second = await recover([...store.rows.values()], { send: true });
  assert.equal(caseStatus(second.result, "honeypot-afternoon"), "claimed_or_previous_outcome");
  assert.equal(second.mailer.sent.length, 0);
});

test("a peer that appears in the fresh cohort read blocks before the claim", async () => {
  const rows = [rowFor("honeypot-evening", { email: "same.person@gmail.com" })];
  const store = new Store(rows);
  const peer = rowFor("honeypot-afternoon", {
    pageId: "pid-new-peer",
    email: "sameperson@gmail.com",
    signedUpAt: "2026-10-30T00:00:00.000Z",
    signupCountry: "KR",
  });
  const { result, mailer } = await recover(rows, {
    send: true,
    store,
    listRows: async () => [clone(rows[0]), peer],
  });
  assert.equal(caseStatus(result, "honeypot-evening"), "identity_or_cohort_changed");
  assert.equal(store.claims.length, 0);
  assert.equal(mailer.sent.length, 0);
});

test("a peer that appears after the claim is not mailed and is not replayed", async () => {
  const rows = [rowFor("honeypot-evening", { email: "same.person@gmail.com" })];
  const store = new Store(rows);
  const peer = rowFor("honeypot-afternoon", {
    pageId: "pid-new-peer",
    email: "sameperson@gmail.com",
    signedUpAt: "2026-10-30T00:00:00.000Z",
    signupCountry: "KR",
  });
  let reads = 0;
  const first = await recover(rows, {
    send: true,
    store,
    listRows: async () => {
      reads += 1;
      return reads === 1 ? [clone(store.rows.get(rows[0].pageId) ?? rows[0])] : [clone(store.rows.get(rows[0].pageId) ?? rows[0]), peer];
    },
  });
  assert.equal(caseStatus(first.result, "honeypot-evening"), "identity_or_cohort_changed_after_claim");
  assert.equal(first.store.claims.length, 1);
  assert.equal(first.mailer.sent.length, 0);
  assert.equal(first.result.claimedButNotSent, 1);
  const second = await recover([...store.rows.values(), peer], { send: true });
  assert.equal(second.mailer.sent.length, 0);
  assert.notEqual(caseStatus(second.result, "honeypot-evening"), "provider_accepted");
});

test("a markSent reread failure keeps the acceptance and does not resend", async () => {
  const rows = [rowFor("apple-morning")];
  const store = new Store(rows);
  store.throwOn = (pageId, n) => pageId === rows[0].pageId && n === 3;
  const first = await recover(rows, { send: true, store });
  assert.equal(caseStatus(first.result, "apple-morning"), "provider_accepted");
  assert.equal(first.mailer.sent.length, 1);
  assert.equal(store.marked.length, 0);
  assert.equal(first.result.recordFailed, 1);
  assert.equal(store.rows.get(rows[0].pageId)?.sentAt, undefined);
  const second = await recover([...store.rows.values()], { send: true });
  assert.equal(caseStatus(second.result, "apple-morning"), "claimed_or_previous_outcome");
  assert.equal(second.mailer.sent.length, 0);
});

test("honeypot recipient is the trimmed address", async () => {
  const rows = [rowFor("honeypot-evening", { email: "  honey-evening@gmail.com" })];
  const { result, mailer } = await recover(rows, { send: true });
  assert.equal(caseStatus(result, "honeypot-evening"), "provider_accepted");
  assert.equal(mailer.sent[0]?.to, "honey-evening@gmail.com");
});

test("hero and a gmail domain are part of the honeypot signature", async () => {
  const offer = await recover([rowFor("honeypot-afternoon", { source: "offer" })]);
  assert.equal(caseStatus(offer.result, "honeypot-afternoon"), "missing");
  const googlemail = await recover([rowFor("honeypot-evening", { email: "person@googlemail.com" })]);
  assert.equal(caseStatus(googlemail.result, "honeypot-evening"), "other_abuse_or_signature_mismatch");
  const mixed = await recover([rowFor("honeypot-afternoon", { email: "Person@Gmail.com" })]);
  assert.equal(caseStatus(mixed.result, "honeypot-afternoon"), "eligible");
  const badCount = await recover([rowFor("honeypot-evening", { sends: -1 })], { send: true });
  assert.equal(caseStatus(badCount.result, "honeypot-evening"), "invalid_send_count");
  assert.equal(badCount.mailer.sent.length, 0);
});

test("the clock crossing the close after the claim does not mail", async () => {
  const rows = [rowFor("apple-afternoon")];
  const store = new Store(rows);
  let now = new Date(Date.parse(RECOVERY_CLOSE_AT) - 1000);
  store.onReread = (_pageId, n) => {
    if (n === 2) now = new Date(RECOVERY_CLOSE_AT);
  };
  const { result, mailer } = await recover(rows, { send: true, store, now: () => now });
  assert.equal(caseStatus(result, "apple-afternoon"), "closed_after_claim");
  assert.equal(store.claims.length, 1);
  assert.equal(mailer.sent.length, 0);
  assert.equal(result.claimedButNotSent, 1);
});

test("createResendMailer uses the recovery key and the fixed help sender", async () => {
  const calls: { url: string; key: string | null; body: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      key: headers.get("Idempotency-Key"),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ id: "msg_test_recovery" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const lead = "aaaaaaaa-bbbb-4ccc-8ddd-0000000000aa";
  const expiry = OPEN.getTime() + 60 * 60 * 1000;
  const env = {
    RESEND_API_KEY: "test-key-not-live",
    WATCHDIVE_EMAIL_FROM: "verify@mail.oceanwick.ai",
    WATCHDIVE_EMAIL_REPLY_TO: "help@diveroid.com",
    WATCHDIVE_EMAIL_FROM_NAME: "WatchDive",
  };
  const mailer = createResendMailer(env, fetchImpl, async () => undefined);
  const send = async (patch: Partial<VerificationMail> & { locale: VerificationMail["locale"] }) => {
    const token = createVerificationToken(lead, expiry, false, TEST_SECRET, patch.locale);
    await mailer.send({
      to: "person@example.test",
      token,
      leadId: lead,
      publicOrigin: TEST_ORIGIN,
      ...patch,
    });
  };
  await send({ locale: "zh-TW", manualCampaign: RECOVERY_CAMPAIGN, to: "relay-one@privaterelay.appleid.com" });
  await send({ locale: "ko", reminder: true });
  await send({ locale: "ko" });
  await send({ locale: "en", manualCampaign: "wd-manual-verify-20261019" });
  const nativeKey = `watchdive-instant-form-${"ab".repeat(32)}`;
  await send({ locale: "en", idempotencyKey: nativeKey });
  await send({ locale: "ko", reminder: true, manualCampaign: RECOVERY_CAMPAIGN });

  assert.deepEqual(calls.map((call) => call.key), [
    `${RECOVERY_CAMPAIGN}-${lead}`,
    `watchdive-verification-reminder-${lead}`,
    `watchdive-verification-${lead}`,
    `wd-manual-verify-20261019-${lead}`,
    nativeKey,
    `${RECOVERY_CAMPAIGN}-${lead}`,
  ]);
  assert.equal(calls[0]?.url, "https://api.resend.com/emails");
  assert.equal(calls[0]?.body.from, "WatchDive <help@diveroid.com>");
  assert.equal(calls[0]?.body.reply_to, "help@diveroid.com");
  assert.equal(JSON.stringify(calls[0]?.body).includes("oceanwick"), false);
  assert.equal(calls[0]?.body.to instanceof Array ? (calls[0].body.to as string[])[0] : "", "relay-one@privaterelay.appleid.com");

  const before = calls.length;
  const wrongLocale = createVerificationToken(lead, expiry, false, TEST_SECRET, "zh-TW");
  await assert.rejects(
    mailer.send({
      to: "person@example.test",
      token: wrongLocale,
      leadId: lead,
      publicOrigin: TEST_ORIGIN,
      locale: "ko",
      manualCampaign: RECOVERY_CAMPAIGN,
    }),
    /Verification token locale mismatch/,
  );
  assert.equal(calls.length, before);
});

test("the helper's accepted send carries the recovery key, fixed from, and a consent-off token", async () => {
  const calls: { key: string | null; body: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ key: headers.get("Idempotency-Key"), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ id: "msg_helper_recovery" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const mailer = createResendMailer(
    {
      RESEND_API_KEY: "test-key-not-live",
      WATCHDIVE_EMAIL_FROM: "verify@mail.oceanwick.ai",
      WATCHDIVE_EMAIL_REPLY_TO: "help@diveroid.com",
    },
    fetchImpl,
    async () => undefined,
  );
  const rows = [rowFor("apple-morning")];
  const store = new Store(rows);
  const result = await runVerificationRecovery({
    rows,
    store,
    mailer,
    env: TEST_ENV,
    listRows: async () => [...store.rows.values()].map(clone),
    send: true,
    now: () => OPEN,
  });
  assert.equal(caseStatus(result, "apple-morning"), "provider_accepted");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.key, `${RECOVERY_CAMPAIGN}-${rows[0].leadId}`);
  assert.equal(calls[0]?.body.from, "WatchDive <help@diveroid.com>");
  assert.equal(calls[0]?.body.reply_to, "help@diveroid.com");
  assert.equal(JSON.stringify(calls[0]?.body).includes("oceanwick"), false);
  const text = String(calls[0]?.body.text);
  const url = text.match(/https:\/\/watchdive\.diveroid\.com\/\S+/)?.[0];
  assert.ok(url);
  assert.match(url, /\/zh-tw\/verify/);
  const parsed = parseVerificationToken(decodeURIComponent(new URL(url).hash.slice(1)), TEST_SECRET, OPEN.getTime());
  assert.equal(parsed?.locale, "zh-TW");
  assert.equal(parsed?.measurementConsent, false);
  assert.equal(parsed?.leadId, rows[0].leadId);
  assert.equal(store.rows.get(rows[0].pageId)?.emailVerified, false);
  assert.deepEqual(store.rows.get(rows[0].pageId)?.flags, []);
});

test("the cron handler refuses auth, method, campaign, mode, and a missing database without echoing input", async () => {
  const previousSecret = process.env.WATCHDIVE_REMINDER_CRON_SECRET;
  const previousDatabase = process.env.NOTION_WAITLIST_DB_ID;
  process.env.WATCHDIVE_REMINDER_CRON_SECRET = CRON_SECRET;
  delete process.env.NOTION_WAITLIST_DB_ID;
  const endpoint = "https://example.test/api/cron/verification-recovery-20261031";
  const authorized = (method: string, body?: string) =>
    new Request(endpoint, {
      method,
      headers: { authorization: `Bearer ${CRON_SECRET}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body }),
    });
  try {
    const denied = await handleVerificationRecovery(new Request(endpoint, { method: "POST", body: "{}" }));
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { ok: false });
    assert.equal(denied.headers.get("cache-control"), "no-store");
    assert.equal(denied.headers.get("x-robots-tag"), "noindex");

    const junk = await handleVerificationRecovery(authorized("POST", "not-json"));
    assert.equal(junk.status, 400);
    assert.deepEqual(await junk.json(), { ok: false });

    const oldCampaign = await handleVerificationRecovery(
      authorized("POST", JSON.stringify({ campaign: "wd-manual-verify-20261019", mode: "send" })),
    );
    assert.equal(oldCampaign.status, 400);

    const replay = await handleVerificationRecovery(
      authorized("POST", JSON.stringify({ campaign: RECOVERY_CAMPAIGN, mode: "replay" })),
    );
    assert.equal(replay.status, 400);

    const get = await handleVerificationRecovery(authorized("GET"));
    assert.equal(get.status, 405);

    process.env.WATCHDIVE_REMINDER_CRON_SECRET = "short-secret";
    const unconfigured = await handleVerificationRecovery(
      authorized("POST", JSON.stringify({ campaign: RECOVERY_CAMPAIGN, mode: "dry-run" })),
    );
    assert.equal(unconfigured.status, 401);
    process.env.WATCHDIVE_REMINDER_CRON_SECRET = CRON_SECRET;

    const hidden = "hidden-person@example.test";
    const noDatabase = await handleVerificationRecovery(
      authorized("POST", JSON.stringify({ campaign: RECOVERY_CAMPAIGN, mode: "send", email: hidden })),
    );
    assert.equal(noDatabase.status, 503);
    const body = await noDatabase.json();
    assert.deepEqual(body, { ok: false });
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(hidden), false);
    assert.equal(serialized.includes(CRON_SECRET), false);
  } finally {
    if (previousSecret === undefined) delete process.env.WATCHDIVE_REMINDER_CRON_SECRET;
    else process.env.WATCHDIVE_REMINDER_CRON_SECRET = previousSecret;
    if (previousDatabase === undefined) delete process.env.NOTION_WAITLIST_DB_ID;
    else process.env.NOTION_WAITLIST_DB_ID = previousDatabase;
  }
});

test("the route is POST-only and the helper never verifies or sends a welcome", () => {
  const route = readFileSync(
    new URL("../src/routes/api.cron.verification-recovery-20261031.ts", import.meta.url),
    "utf8",
  );
  const source = readFileSync(
    new URL("../src/lib/verification/recovery20261031.server.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /POST:/);
  assert.doesNotMatch(route, /\b(?:GET|PUT|PATCH|DELETE):/);
  assert.match(route, /handleVerificationRecovery/);
  assert.doesNotMatch(source, /markVerified/);
  assert.doesNotMatch(source, /sendWelcome/);
  assert.doesNotMatch(source, /markWelcomeScheduled/);
  assert.doesNotMatch(source, /recordMeasurement/);
  assert.match(source, /manualCampaign: campaign/);
  assert.match(source, /input\.campaign \?\? RECOVERY_CAMPAIGN/);
  assert.match(source, /createVerificationToken\(fresh\.leadId, expiry, false,/);
});

test("the historical batch leaves the original four incidents unsent", async () => {
  const rows = fourRows();
  const { result, store, mailer } = await recover(rows, {
    send: true,
    campaign: HISTORICAL_RECOVERY_CAMPAIGN,
  });
  assert.equal(result.campaign, HISTORICAL_RECOVERY_CAMPAIGN);
  assert.deepEqual(
    result.cases.map((item) => item.case),
    [
      "historical-fr-offer",
      "historical-fr-hero",
      "historical-en-jp",
      "historical-ko-se",
      "historical-en-sg",
    ],
  );
  assert.deepEqual(
    result.cases.map((item) => item.status),
    ["missing", "missing", "missing", "missing", "missing"],
  );
  assert.equal(result.eligible, 0);
  assert.equal(result.accepted, 0);
  assert.equal(mailer.sent.length, 0);
  assert.equal(mailer.welcomes, 0);
  assert.equal(store.claims.length, 0);
  assert.equal(store.outcomes.length, 0);
  assert.equal(store.marked.length, 0);
  for (const row of rows) {
    const saved = store.rows.get(row.pageId);
    assert.equal(saved?.emailVerified, false);
    assert.equal(saved?.status, "pending");
    assert.equal(saved?.sentAt, undefined);
    assert.equal(saved?.reminder, undefined);
  }
});
