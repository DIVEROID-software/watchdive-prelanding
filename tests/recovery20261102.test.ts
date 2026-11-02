// Offline guards for the one-off 2026-11-02 recovery endpoint.
// No network, no Notion, no Resend, no customer addresses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { LeadRecord } from "../src/lib/verification/contracts.ts";
import { MEASUREMENT_CONSENT_GRANTED } from "../src/lib/verification/contracts.ts";
import {
  APPROVED_PAGE_SET_SHA256,
  CAMPAIGN,
  CLOSE_AT,
  FROZEN_MANIFEST_SHA256,
  MAX_IDENTITIES,
  RecoveryProviderAmbiguousError,
  RecoveryProviderRejectedError,
  approvedPageSetDigest,
  createRecovery20261102Provider,
  handleVerificationServiceRecovery,
  normalizePageId,
  parseRecoveryRequest,
  recoveryLocale,
  recoverySkip,
  runVerificationServiceRecovery,
  type RecoveryProvider,
} from "../src/lib/verification/recovery20261102.server.ts";
import { RECOVERY_20261102_ORIGIN } from "../src/lib/verification/recovery20261102.mail.ts";
import { parseVerificationToken } from "../src/lib/verification/token.ts";
import { TEST_ENV, TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";

const OPEN = new Date("2026-11-02T08:00:00.000Z");
const CRON_SECRET = "recovery-cron-secret-16";
const LEAD = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const PREVIOUS = "sent 2026-10-21T00:00:00.000Z";

const pages = Array.from({ length: MAX_IDENTITIES }, (_, index) =>
  `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
);
const digest = approvedPageSetDigest(pages);
if (!digest) throw new Error("fixture digest");

function row(patch: Partial<LeadRecord> = {}): LeadRecord {
  return {
    pageId: pages[0],
    email: "person@example.com",
    status: "pending",
    emailVerified: false,
    refCode: "abcd1234",
    source: "hero",
    suspect: false,
    flags: [],
    phone: "",
    leadId: LEAD,
    metaEventId: "",
    sends: 2,
    sentAt: "2026-10-20T00:00:00.000Z",
    expiresAt: "2026-10-21T00:00:00.000Z",
    reminder: PREVIOUS,
    signupLocale: "ko",
    signupMethod: "email",
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
    ...patch,
  };
}

function clone(record: LeadRecord): LeadRecord {
  return { ...record, flags: [...record.flags] };
}

class Store {
  claims: { marker: string; sends: number; expiresAt: string }[] = [];
  outcomes: string[] = [];
  failClaim = false;
  failOutcome = false;
  addPeerOnClaim = false;
  rows: LeadRecord[];
  constructor(rows: LeadRecord[]) {
    this.rows = rows;
  }

  async reread(pageId: string): Promise<LeadRecord | undefined> {
    const found = this.rows.find((item) => item.pageId === pageId);
    return found ? clone(found) : undefined;
  }

  async claimReminder(
    pageId: string,
    claim: { marker: string; sends: number; expiresAt: string },
  ): Promise<void> {
    if (this.failClaim) throw new Error("claim_down");
    const found = this.rows.find((item) => item.pageId === pageId);
    if (!found) throw new Error("missing");
    found.reminder = claim.marker;
    found.sends = claim.sends;
    found.expiresAt = claim.expiresAt;
    this.claims.push(claim);
    if (this.addPeerOnClaim) {
      this.rows.push(
        row({
          pageId: pages[1],
          leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002",
        }),
      );
    }
  }

  async recordReminderOutcome(pageId: string, outcome: string): Promise<void> {
    if (this.failOutcome) throw new Error("outcome_down");
    const found = this.rows.find((item) => item.pageId === pageId);
    if (!found) throw new Error("missing");
    found.reminder = outcome;
    this.outcomes.push(outcome);
  }
}

class Provider implements RecoveryProvider {
  calls: { to: string; subject: string; html: string; text: string; idempotencyKey: string }[] = [];
  mode: "ok" | "ambiguous" | "rejected" = "ok";

  async send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
  }): Promise<{ receiptId: string }> {
    this.calls.push(input);
    if (this.mode === "ambiguous") throw new RecoveryProviderAmbiguousError();
    if (this.mode === "rejected") throw new RecoveryProviderRejectedError();
    return { receiptId: "re_test_receipt" };
  }
}

function env() {
  return {
    ...TEST_ENV,
    RESEND_API_KEY: "re_test_key",
    WATCHDIVE_REMINDER_CRON_SECRET: CRON_SECRET,
    WATCHDIVE_EMAIL_FROM_NAME: "WatchDive",
  };
}

function body(patch: Record<string, unknown> = {}) {
  return {
    campaign: CAMPAIGN,
    mode: "dry-run",
    manifestDigest: FROZEN_MANIFEST_SHA256,
    approvedPageIds: pages,
    approvedPageSetDigest: digest,
    pageId: pages[0],
    leadId: LEAD,
    locale: "ko",
    ...patch,
  };
}

function request(patch: Record<string, unknown> = {}, authorization = `Bearer ${CRON_SECRET}`) {
  return new Request("https://watchdive.diveroid.com/api/cron/verification-recovery-20261102", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body(patch)),
  });
}

async function run(store: Store, provider: Provider, patch: Record<string, unknown> = {}, time = OPEN) {
  const parsed = parseRecoveryRequest(body(patch), digest!);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("parse");
  return runVerificationServiceRecovery({
    request: parsed.request,
    approvedPageSetSha256: digest!,
    listRows: async () => store.rows.map(clone),
    store,
    provider,
    env: env(),
    now: () => time,
  });
}

test("the approved-set digest is campaign-bound, sorted, and hyphen-stable", () => {
  assert.equal(approvedPageSetDigest(pages), approvedPageSetDigest([...pages].reverse()));
  const bare = pages.map((id) => id.replace(/-/g, ""));
  assert.equal(approvedPageSetDigest(bare), digest);
  assert.equal(approvedPageSetDigest(pages.slice(0, 24)), undefined);
  assert.equal(normalizePageId(pages[0]), pages[0]);
  assert.equal(APPROVED_PAGE_SET_SHA256, "d6519d5d37a4f2db14c4d228754bfe6bed02f13e986ed3d4a6d83db48672e1b7");
  assert.equal(MAX_IDENTITIES, 25);
});

test("the placeholder binding fails closed before a body is trusted", async () => {
  const response = await handleVerificationServiceRecovery(request(), {
    env: env(),
    approvedPageSetSha256: "PENDING_ROOT",
    now: () => OPEN,
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "binding_unset" });
});

test("the production binding refuses a synthetic cohort before any CRM read", async () => {
  let reads = 0;
  const response = await handleVerificationServiceRecovery(request(), {
    env: env(),
    now: () => OPEN,
    listRows: async () => { reads += 1; return []; },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "binding_mismatch" });
  assert.equal(reads, 0);
});

test("auth, manifest, set size, extra fields, and a foreign page are refused", async () => {
  const denied = await handleVerificationServiceRecovery(request({}, "Bearer wrong-secret-value"), {
    env: env(),
    approvedPageSetSha256: digest,
    now: () => OPEN,
  });
  assert.equal(denied.status, 401);

  const manifest = await handleVerificationServiceRecovery(
    request({ manifestDigest: "a".repeat(64) }),
    { env: env(), approvedPageSetSha256: digest, now: () => OPEN },
  );
  assert.equal(manifest.status, 403);
  assert.equal((await manifest.json()).error, "manifest_mismatch");

  const short = await handleVerificationServiceRecovery(
    request({ approvedPageIds: pages.slice(0, 24), approvedPageSetDigest: digest }),
    { env: env(), approvedPageSetSha256: digest, now: () => OPEN },
  );
  assert.equal(short.status, 400);

  const extra = await handleVerificationServiceRecovery(request({ email: "person@example.com" }), {
    env: env(),
    approvedPageSetSha256: digest,
    now: () => OPEN,
  });
  assert.equal(extra.status, 400);

  const outside = await handleVerificationServiceRecovery(
    request({ pageId: "00000000-0000-4000-8000-000000000099" }),
    { env: env(), approvedPageSetSha256: digest, now: () => OPEN },
  );
  assert.equal(outside.status, 400);
  assert.equal((await outside.json()).error, "outside_frozen_set");
});

test("a matching body digest still fails when it is not the server constant", () => {
  const other = approvedPageSetDigest(pages.map((id, index) => (index === 0 ? pages[0] : id)));
  assert.ok(other);
  const parsed = parseRecoveryRequest(body(), "ab".repeat(32));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.error, "binding_mismatch");
  void other;
});

test("the endpoint is closed at 15:00Z", async () => {
  const store = new Store([row()]);
  const response = await handleVerificationServiceRecovery(request({ mode: "send" }), {
    env: env(),
    approvedPageSetSha256: digest,
    now: () => new Date(CLOSE_AT),
    listRows: async () => store.rows,
    store,
    provider: new Provider(),
  });
  assert.equal(response.status, 403);
  assert.equal(store.claims.length, 0);
});

test("dry-run reports eligibility and does not claim or render a send", async () => {
  const store = new Store([row()]);
  const provider = new Provider();
  const result = await run(store, provider);
  assert.equal(result.status, "eligible");
  assert.equal(result.receiptId, undefined);
  assert.equal(store.claims.length, 0);
  assert.equal(provider.calls.length, 0);
  assert.equal(store.rows[0].reminder, PREVIOUS);
  assert.equal(store.rows[0].measurementConsent, MEASUREMENT_CONSENT_GRANTED);
});

test("live guards shrink the frozen set", () => {
  const expected = { pageId: pages[0], leadId: LEAD, locale: "ko" as const };
  const approved = new Set(pages);
  const now = OPEN.getTime();
  const cases: [string, Partial<LeadRecord>, LeadRecord[]?][] = [
    ["verified", { emailVerified: true }],
    ["verified", { verifiedAt: "2026-10-22T00:00:00.000Z" }],
    ["unsubscribed", { status: "unsubscribed" }],
    ["unsubscribed", { launchMail: "unsubscribed 2026-10-01T00:00:00.000Z" }],
    ["not_pending", { status: "legacy" }],
    ["suspect", { suspect: true }],
    ["suspect", { flags: ["honeypot"] }],
    ["ip_repeat_review", { flags: ["ip-repeat"] }],
    ["duplicate", { duplicate: true }],
    ["social", { signupMethod: "apple" }],
    ["social", { signupMethod: "google" }],
    ["native", { source: "instant-form" }],
    ["invalid", { leadId: "not-a-lead" }],
    ["qa", { email: "wdqa-internal@example.com" }],
    ["recent_mail", { sentAt: "2026-11-02T07:30:00.000Z" }],
    ["live_expiry", { expiresAt: "2026-11-03T00:00:00.000Z" }],
    ["expiry_unproven", { expiresAt: undefined }],
    ["prior_recovery", { reminder: "wd-manual-verify-20261019 accepted 2026-10-19T00:00:00.000Z" }],
    ["prior_recovery", { reminder: "wd-verification-recovery-20261031 provider_accepted 2026-10-31T00:00:00.000Z" }],
    ["prior_recovery", { reminder: "wd-honeypot-recovery-20261031 provider_accepted 2026-10-31T00:00:00.000Z" }],
    ["already_claimed", { reminder: `${CAMPAIGN} claimed 2026-11-02T01:00:00.000Z` }],
    ["send_cap", { sends: 5 }],
    ["locale_mismatch", { signupLocale: "ja" }],
    ["locale_unresolved", { signupLocale: undefined, landingPath: "/scuba" }],
    ["lead_mismatch", { leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002" }],
    ["outside_frozen_set", { pageId: "00000000-0000-4000-8000-000000000099" }],
  ];
  for (const [reason, patch, peers] of cases) {
    assert.equal(recoverySkip(row(patch), peers ?? [], expected, approved, now), reason, reason);
  }
  const peer = row({ pageId: pages[1], email: "a.b+tag@gmail.com" });
  const target = row({ email: "ab@gmail.com" });
  assert.equal(recoverySkip(target, [peer], expected, approved, now), "duplicate");
  assert.equal(recoveryLocale(row({ signupLocale: undefined, landingPath: "/" })), "en");
  assert.equal(recoveryLocale(row({ signupLocale: undefined, landingPath: "/ja" })), "ja");
  assert.equal(recoverySkip(row({ flags: ["measurement-withdrawn"] }), [], expected, approved, now), undefined);
});

test("send claims before the provider, appends history, and returns only a receipt", async () => {
  const store = new Store([row()]);
  const provider = new Provider();
  const result = await run(store, provider, { mode: "send" });
  assert.equal(result.status, "provider_accepted");
  assert.equal(result.receiptId, "re_test_receipt");
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].idempotencyKey, `${CAMPAIGN}-${LEAD}`);
  assert.equal(provider.calls[0].subject, "WatchDive: 이메일 인증을 다시 부탁드립니다");
  assert.equal(store.claims.length, 1);
  assert.equal(store.claims[0].sends, 3);
  assert.equal(store.claims[0].expiresAt, new Date(OPEN.getTime() + 24 * 60 * 60 * 1000).toISOString());
  assert.ok(store.rows[0].reminder?.startsWith(`${PREVIOUS}\n${CAMPAIGN} claimed`));
  assert.match(store.rows[0].reminder ?? "", new RegExp(`${CAMPAIGN} provider_accepted`));
  assert.equal(store.rows[0].sentAt, "2026-10-20T00:00:00.000Z");
  assert.equal(store.rows[0].status, "pending");
  assert.equal(store.rows[0].emailVerified, false);
  assert.equal(store.rows[0].measurementConsent, MEASUREMENT_CONSENT_GRANTED);
  assert.equal(store.rows[0].sends, 3);
  const href = provider.calls[0].html.match(/https:\/\/watchdive\.diveroid\.com\/ko\/verify#[^"]+/)?.[0];
  assert.ok(href);
  const token = href!.slice(href!.indexOf("#") + 1);
  const parsed = parseVerificationToken(token, TEST_SECRET, OPEN.getTime());
  assert.equal(parsed?.measurementConsent, false);
  assert.equal(parsed?.locale, "ko");
  assert.equal(parsed?.leadId, LEAD);
  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes("person@example.com"), false);
  assert.equal(encoded.includes(pages[0]), false);
  assert.equal(encoded.includes(LEAD), false);
  assert.equal(encoded.includes(token), false);
  assert.equal(TEST_ORIGIN, RECOVERY_20261102_ORIGIN);
});

test("Notion second precision and UTC offset spelling preserve the claimed expiry", async () => {
  class NotionDateStore extends Store {
    async claimReminder(pageId: string, claim: { marker: string; sends: number; expiresAt: string }) {
      await super.claimReminder(pageId, claim);
      const row = this.rows.find((r) => r.pageId === pageId)!;
      row.expiresAt = new Date(Math.floor(Date.parse(claim.expiresAt) / 1000) * 1000)
        .toISOString().replace("Z", "+00:00");
    }
  }
  const store = new NotionDateStore([row()]);
  const provider = new Provider();
  const result = await run(store, provider, { mode: "send" }, new Date(OPEN.getTime() + 321));
  assert.equal(result.status, "provider_accepted");
  assert.equal(provider.calls.length, 1);
  assert.equal(Date.parse(store.claims[0].expiresAt) % 1000, 0);
});

test("a genuinely changed expiry still stops before the provider", async () => {
  class ChangedDateStore extends Store {
    async claimReminder(pageId: string, claim: { marker: string; sends: number; expiresAt: string }) {
      await super.claimReminder(pageId, claim);
      this.rows.find((r) => r.pageId === pageId)!.expiresAt = new Date(Date.parse(claim.expiresAt) + 1000).toISOString();
    }
  }
  const store = new ChangedDateStore([row()]);
  const provider = new Provider();
  const result = await run(store, provider, { mode: "send" });
  assert.equal(result.status, "expiry_changed");
  assert.equal(provider.calls.length, 0);
  assert.equal(store.claims.length, 1);
});

test("an ambiguous provider is not retried, and a later request does not send", async () => {
  const store = new Store([row()]);
  const provider = new Provider();
  provider.mode = "ambiguous";
  const first = await run(store, provider, { mode: "send" });
  assert.equal(first.status, "provider_ambiguous");
  assert.equal(first.receiptId, undefined);
  assert.equal(provider.calls.length, 1);
  assert.equal(store.claims.length, 1);
  assert.match(store.rows[0].reminder ?? "", /provider_ambiguous/);
  assert.match(store.rows[0].reminder ?? "", new RegExp(PREVIOUS.replace(/[.]/g, "\\.")));
  provider.mode = "ok";
  const second = await run(store, provider, { mode: "send" });
  assert.equal(second.status, "already_claimed");
  assert.equal(provider.calls.length, 1);
});

test("a canonical gmail peer and a peer that appears after the claim are not mailed", async () => {
  const canonical = new Store([
    row({ email: "ab@gmail.com" }),
    row({
      pageId: pages[1],
      email: "a.b+tag@gmail.com",
      leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002",
    }),
  ]);
  const canonicalProvider = new Provider();
  const canonicalResult = await run(canonical, canonicalProvider, { mode: "send" });
  assert.equal(canonicalResult.status, "duplicate");
  assert.equal(canonicalProvider.calls.length, 0);
  assert.equal(canonical.claims.length, 0);

  const raced = new Store([row()]);
  raced.addPeerOnClaim = true;
  const racedProvider = new Provider();
  const racedResult = await run(raced, racedProvider, { mode: "send" });
  assert.equal(racedResult.status, "duplicate");
  assert.equal(racedProvider.calls.length, 0);
  assert.equal(raced.claims.length, 1);
  assert.match(raced.rows[0].reminder ?? "", new RegExp(`^${PREVIOUS.replace(/[.]/g, "\\.")}\n`));
});

test("a rejected provider and a post-claim peer both keep the claim", async () => {
  const rejectedStore = new Store([row()]);
  const rejected = new Provider();
  rejected.mode = "rejected";
  const rejectedResult = await run(rejectedStore, rejected, { mode: "send" });
  assert.equal(rejectedResult.status, "provider_rejected");
  assert.equal(rejected.calls.length, 1);
  assert.equal(rejectedStore.claims.length, 1);

  const store = new Store([row(), row({ pageId: pages[1], email: "person@example.com", leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002" })]);
  const provider = new Provider();
  const result = await run(store, provider, { mode: "send" });
  assert.equal(result.status, "duplicate");
  assert.equal(provider.calls.length, 0);
  assert.equal(store.claims.length, 0);
});

test("the four review locales render through the design module", async () => {
  const subjects = {
    en: "WatchDive: please confirm your email",
    ko: "WatchDive: 이메일 인증을 다시 부탁드립니다",
    ja: "WatchDive：メールアドレスをもう一度ご確認ください",
    "zh-TW": "WatchDive：請重新確認您的電子郵件",
  } as const;
  for (const locale of ["en", "ko", "ja", "zh-TW"] as const) {
    const store = new Store([row({ signupLocale: locale })]);
    const provider = new Provider();
    const result = await run(store, provider, { mode: "send", locale });
    assert.equal(result.status, "provider_accepted", locale);
    assert.equal(provider.calls[0].subject, subjects[locale]);
    assert.equal(provider.calls[0].text.includes("help@diveroid.com"), true);
  }
});

test("the provider adapter posts once and keeps the fixed sender", async () => {
  const calls: { url: string; method: string; headers: Headers; body: string }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ""),
    });
    if (calls.length === 1) return new Response("no", { status: 500 });
    return Response.json({ id: "re_should_not_retry" });
  };
  const provider = createRecovery20261102Provider(env(), fetchImpl);
  await assert.rejects(() =>
    provider.send({
      to: "person@example.com",
      subject: "WatchDive: please confirm your email",
      html: "<p>x</p>",
      text: "x",
      idempotencyKey: `${CAMPAIGN}-${LEAD}`,
    }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].headers.get("Idempotency-Key"), `${CAMPAIGN}-${LEAD}`);
  assert.equal(calls[0].headers.get("User-Agent"), "watchdive-prelanding/1.0");
  const payload = JSON.parse(calls[0].body) as { from: string; reply_to: string };
  assert.equal(payload.from, "WatchDive <help@diveroid.com>");
  assert.equal(payload.reply_to, "help@diveroid.com");
});

test("the route and server stay strict about reads, consent, and the mail file", () => {
  const server = readFileSync(
    new URL("../src/lib/verification/recovery20261102.server.ts", import.meta.url),
    "utf8",
  );
  const route = readFileSync(
    new URL("../src/routes/api.cron.verification-recovery-20261102.ts", import.meta.url),
    "utf8",
  );
  assert.equal(server.includes("markVerified"), false);
  assert.equal(server.includes("startAttempt"), false);
  assert.equal(server.includes("recordMeasurement"), false);
  assert.equal(server.includes('method: "GET"'), false);
  assert.match(server, /method: "POST"/);
  assert.match(server, /createVerificationToken\([^)]*false/);
  assert.match(server, /renderRecovery20261102/);
  assert.match(route, /handleVerificationServiceRecovery\(request\)/);
  assert.equal(route.includes("mode"), false);
});
