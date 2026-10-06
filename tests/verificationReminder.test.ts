import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { LeadRecord } from "../src/lib/verification/contracts.ts";
import {
  FIELD_VERIFICATION_REMINDER,
  VERIFICATION_MAX_SENDS,
} from "../src/lib/verification/contracts.ts";
import { checkCronAuthorization } from "../src/lib/verification/cronAuth.ts";
import {
  createNotionReminderStore,
  type NotionRequest,
} from "../src/lib/verification/notionLead.ts";
import {
  formatReminderSummary,
  REMINDER_TIME_BUDGET_MS,
  reminderExpiryMs,
  runVerificationReminders,
  VERIFICATION_REMINDER_DELAY_MS,
  VERIFICATION_REMINDER_MAX_AGE_MS,
  type ReminderCandidateQuery,
  type ReminderClaim,
  type ReminderStore,
} from "../src/lib/verification/reminder.ts";
import { createResendMailer } from "../src/lib/verification/resend.ts";
import { confirmVerificationService } from "../src/lib/verification/service.ts";
import { createVerificationToken, parseVerificationToken } from "../src/lib/verification/token.ts";
import { FakeLeadStore, FakeMailer, TEST_ENV, TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-06T15:00:00.000Z");
const MISSING_PROPERTY = "Notion request failed (400): validation_error";

/**
 * The lead store plus the reminder view, over the same rows, with Notion's
 * filter reproduced so the query layer is exercised too.
 */
class FakeReminderStore extends FakeLeadStore implements ReminderStore {
  missingProperty = false;
  claims: { pageId: string; claim: ReminderClaim }[] = [];
  outcomes: { pageId: string; outcome: string }[] = [];
  unsent = 0;
  onClaim?: (pageId: string) => void;
  onReread?: (pageId: string) => void;

  async findReminderCandidates(query: ReminderCandidateQuery): Promise<LeadRecord[]> {
    await Promise.resolve();
    if (this.missingProperty) throw new Error(MISSING_PROPERTY);
    const before = Date.parse(query.sentOnOrBefore);
    const after = Date.parse(query.sentOnOrAfter);
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.status === "pending" &&
          !row.emailVerified &&
          !row.suspect &&
          !row.reminder &&
          row.sentAt !== undefined &&
          Date.parse(row.sentAt) <= before &&
          Date.parse(row.sentAt) >= after,
      )
      .slice(0, query.limit)
      .map((row) => ({ ...row }));
  }

  async claimReminder(pageId: string, claim: ReminderClaim): Promise<void> {
    await Promise.resolve();
    if (this.missingProperty) throw new Error(MISSING_PROPERTY);
    this.claims.push({ pageId, claim });
    const row = this.rows.get(pageId);
    if (row) {
      this.rows.set(pageId, {
        ...row,
        reminder: claim.marker,
        expiresAt: claim.expiresAt,
        sends: claim.sends,
      });
    }
    this.onClaim?.(pageId);
  }

  async recordReminderOutcome(pageId: string, outcome: string): Promise<void> {
    await Promise.resolve();
    this.outcomes.push({ pageId, outcome });
    const row = this.rows.get(pageId);
    if (row) this.rows.set(pageId, { ...row, reminder: outcome });
  }

  async reread(pageId: string): Promise<LeadRecord | undefined> {
    await Promise.resolve();
    this.onReread?.(pageId);
    const row = this.rows.get(pageId);
    return row ? { ...row } : undefined;
  }

  async countUnsentPending(): Promise<number> {
    return this.unsent;
  }
}

let store: FakeReminderStore;
let mailer: FakeMailer;
let clock: Date;
let leadCounter = 0;

function leadId(): string {
  leadCounter += 1;
  return `aaaaaaaa-bbbb-4ccc-8ddd-${leadCounter.toString(16).padStart(12, "0")}`;
}

/** A signup whose first confirmation mail went out `hoursAgo` hours before NOW. */
function seedPending(overrides: Partial<LeadRecord> = {}, hoursAgo = 7): LeadRecord {
  const sentAt = new Date(NOW.getTime() - hoursAgo * HOUR);
  const n = leadCounter + 1;
  return store.seed({
    email: `diver${n}@example.com`,
    canonical: `diver${n}@example.com`,
    status: "pending",
    leadId: leadId(),
    sends: 1,
    sentAt: sentAt.toISOString(),
    expiresAt: new Date(sentAt.getTime() + 24 * HOUR).toISOString(),
    ...overrides,
  });
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    sleep: async () => {},
    runId: () => "run-a",
    ...overrides,
  };
}

beforeEach(() => {
  store = new FakeReminderStore();
  mailer = new FakeMailer();
  clock = NOW;
});

// ---------------------------------------------------------------------------
// The reminder itself
// ---------------------------------------------------------------------------

test("an unconfirmed signup past the delay gets the same confirmation mail, flagged as the reminder", async () => {
  const row = seedPending({ landingPath: "/ko/" });

  const result = await runVerificationReminders(deps());

  assert.equal(result.sent, 1);
  assert.equal(mailer.sent.length, 1);
  const mail = mailer.sent[0];
  assert.equal(mail.to, row.email);
  assert.equal(mail.reminder, true);
  // Same attempt: the link already in their inbox keeps working.
  assert.equal(mail.leadId, row.leadId);
  assert.equal(mail.locale, "ko");
  assert.equal(new URL(mailer.lastUrl!).pathname, "/ko/verify");

  const parsed = parseVerificationToken(mail.token, TEST_SECRET, clock.getTime());
  assert.ok(parsed, "the reminded link must be valid now");
  // A full TTL from the reminder, not the remains of the first link's day.
  assert.ok(parsed.expiresAtMs >= clock.getTime() + 24 * HOUR);
  // Consent is not stored, so the reminder never grants measurement.
  assert.equal(parsed.measurementConsent, false);

  const after = store.rows.get(row.pageId)!;
  assert.equal(Date.parse(after.expiresAt!), parsed.expiresAtMs);
  assert.equal(after.sends, 2);
  assert.match(after.reminder ?? "", /^sent /);
});

test("the reminded link confirms the signup, and so does the original one", async () => {
  const row = seedPending();
  const original = createVerificationToken(
    row.leadId,
    Date.parse(row.expiresAt!),
    true,
    TEST_SECRET,
    "en",
  );
  await runVerificationReminders(deps());
  const reminded = mailer.sent[0].token;

  // 20 hours later the first link has died, the reminded one has not.
  clock = new Date(NOW.getTime() + 20 * HOUR);
  const viaOriginal = await confirmVerificationService(original, {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
  });
  assert.equal(viaOriginal.status, "invalid");

  const viaReminder = await confirmVerificationService(reminded, {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
  });
  assert.equal(viaReminder.status, "verified");
  // No measurement consent travelled with the reminder, so no pixel payload.
  assert.equal(viaReminder.browserLead, undefined);
  assert.equal(store.rows.get(row.pageId)!.emailVerified, true);
});

test("the original link still confirms after a reminder went out", async () => {
  const row = seedPending();
  const original = createVerificationToken(
    row.leadId,
    Date.parse(row.expiresAt!),
    true,
    TEST_SECRET,
    "en",
  );
  await runVerificationReminders(deps());
  const res = await confirmVerificationService(original, {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
  });
  assert.equal(res.status, "verified");
});

test("the reminder link expiry is deterministic within the hour and never shorter than a TTL", () => {
  const a = reminderExpiryMs(Date.parse("2026-10-06T15:01:00Z"));
  const b = reminderExpiryMs(Date.parse("2026-10-06T15:59:59Z"));
  assert.equal(a, b);
  assert.ok(a - Date.parse("2026-10-06T15:59:59Z") >= 24 * HOUR);
});

// ---------------------------------------------------------------------------
// Exactly once
// ---------------------------------------------------------------------------

test("a second run never sends a second reminder", async () => {
  seedPending();
  await runVerificationReminders(deps());
  clock = new Date(NOW.getTime() + 24 * HOUR);
  const second = await runVerificationReminders(deps({ runId: () => "run-b" }));

  assert.equal(second.sent, 0);
  assert.equal(mailer.sent.length, 1);
});

test("two overlapping runs (a duplicated cron delivery) send one reminder", async () => {
  seedPending();
  seedPending();
  const [a, b] = await Promise.all([
    runVerificationReminders(deps({ runId: () => "run-a" })),
    runVerificationReminders(deps({ runId: () => "run-b" })),
  ]);

  assert.equal(a.sent + b.sent, 2, "one reminder per signup across both runs");
  assert.equal(mailer.sent.length, 2);
  assert.notEqual(mailer.sent[0].leadId, mailer.sent[1].leadId);
});

test("a crash after the claim means no reminder, never a duplicate", async () => {
  seedPending();
  await assert.rejects(
    runVerificationReminders(
      deps({
        sleep: async () => {
          throw new Error("function killed");
        },
      }),
    ),
  );
  assert.equal(mailer.sent.length, 0);

  const rerun = await runVerificationReminders(deps({ runId: () => "run-b" }));
  assert.equal(rerun.sent, 0);
  assert.equal(mailer.sent.length, 0);
});

test("a failed reminder send is recorded and never retried", async () => {
  const row = seedPending();
  mailer.fail = true;
  const first = await runVerificationReminders(deps());
  assert.equal(first.sendFailed, 1);
  assert.match(store.rows.get(row.pageId)!.reminder ?? "", /^failed /);

  mailer.fail = false;
  const second = await runVerificationReminders(deps({ runId: () => "run-b" }));
  assert.equal(second.sent, 0);
  assert.equal(mailer.sent.length, 0);
});

test("a confirmation landing between claim and send stops the reminder", async () => {
  const row = seedPending();
  store.onReread = (pageId) => {
    const current = store.rows.get(pageId)!;
    store.rows.set(pageId, { ...current, status: "verified", emailVerified: true });
  };
  const result = await runVerificationReminders(deps());
  assert.equal(result.sent, 0);
  assert.equal(mailer.sent.length, 0);
  assert.ok(store.rows.get(row.pageId)!.reminder, "claim stays so nothing retries");
});

test("a resubmit that re-armed the attempt before the send stops the reminder", async () => {
  seedPending();
  store.onReread = (pageId) => {
    const current = store.rows.get(pageId)!;
    store.rows.set(pageId, { ...current, leadId: leadId() });
  };
  const result = await runVerificationReminders(deps());
  assert.equal(result.sent, 0);
});

test("a claim overwritten by another run is not ours to send", async () => {
  seedPending();
  store.onClaim = (pageId) => {
    const current = store.rows.get(pageId)!;
    store.rows.set(pageId, { ...current, reminder: "claimed 2026-10-06T15:00:00.000Z run:other" });
  };
  const result = await runVerificationReminders(deps());
  assert.equal(result.sent, 0);
  assert.equal(result.notClaimed, 1);
});

// ---------------------------------------------------------------------------
// Fail soft on the missing Notion property
// ---------------------------------------------------------------------------

test("without the Notion property the query fails and nothing is sent", async () => {
  seedPending();
  store.missingProperty = true;
  const result = await runVerificationReminders(deps());
  assert.equal(result.aborted, "reminder_property_missing");
  assert.equal(mailer.sent.length, 0);
});

test("a claim Notion rejects for the property aborts the run before any mail", async () => {
  seedPending();
  seedPending();
  const original = store.claimReminder.bind(store);
  store.claimReminder = async () => {
    throw new Error(MISSING_PROPERTY);
  };
  const result = await runVerificationReminders(deps());
  store.claimReminder = original;
  assert.equal(result.aborted, "reminder_property_missing");
  assert.equal(mailer.sent.length, 0);
});

test("a claim that fails for any other reason skips only that row", async () => {
  const a = seedPending();
  seedPending();
  const original = store.claimReminder.bind(store);
  store.claimReminder = async (pageId, claim) => {
    if (pageId === a.pageId) throw new Error("Notion request failed (502)");
    return original(pageId, claim);
  };
  const result = await runVerificationReminders(deps());
  assert.equal(result.sent, 1);
  assert.equal(result.notClaimed, 1);
  assert.ok(mailer.sent.every((mail) => mail.leadId !== a.leadId));
});

test("the Notion store names the reminder property in every query and claim", async () => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const request: NotionRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    return { results: [] };
  };
  const notion = createNotionReminderStore(request, "db");
  await notion.findReminderCandidates({
    sentOnOrBefore: NOW.toISOString(),
    sentOnOrAfter: NOW.toISOString(),
    limit: 10,
  });
  await notion.claimReminder("page", {
    marker: "claimed x",
    expiresAt: NOW.toISOString(),
    sends: 2,
  });

  const query = JSON.stringify(calls[0].body);
  assert.ok(query.includes(`"${FIELD_VERIFICATION_REMINDER}"`));
  assert.ok(query.includes('"is_empty":true'));
  assert.ok(query.includes('"equals":"pending"'));
  assert.ok(query.includes('"Suspect"'));
  const claim = calls[1].body as { properties: Record<string, unknown> };
  assert.ok(FIELD_VERIFICATION_REMINDER in claim.properties);
  await assert.rejects(notion.recordReminderOutcome("page", "  "));
});

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

test("nobody who must not be mailed is reminded", async () => {
  seedPending({ status: "verified", emailVerified: true });
  seedPending({ emailVerified: true });
  seedPending({ status: "unsubscribed" });
  // A legacy single opt-in row, or any status this flow does not know
  // (suppressed / withdrawn), reads as "legacy".
  seedPending({ status: "legacy" });
  seedPending({ suspect: true, flags: ["ip-repeat"] });
  seedPending({ suspect: true, flags: ["honeypot"] });
  seedPending({ flags: ["disposable"] });
  seedPending({ reminder: "sent 2026-10-05T15:00:00.000Z" });
  seedPending({ sentAt: undefined });
  seedPending({ sends: VERIFICATION_MAX_SENDS });
  seedPending({}, 2); // too soon
  seedPending({}, (VERIFICATION_REMINDER_MAX_AGE_MS + HOUR) / HOUR); // too old

  // The store filter is a first line only; bypass it to prove the second.
  const everything = [...store.rows.values()];
  store.findReminderCandidates = async () => everything.map((row) => ({ ...row }));

  const result = await runVerificationReminders(deps());
  assert.equal(result.sent, 0);
  assert.equal(mailer.sent.length, 0);
  assert.equal(store.claims.length, 0, "an excluded row is not even claimed");
  assert.deepEqual(result.skipped, {
    not_pending: 3,
    verified: 1,
    suspect: 2,
    flagged: 1,
    already_reminded: 1,
    no_recorded_send: 1,
    send_cap: 1,
    too_soon: 1,
    too_old: 1,
  });
});

test("the delay is respected to the hour", async () => {
  seedPending({}, VERIFICATION_REMINDER_DELAY_MS / HOUR - 0.5);
  assert.equal((await runVerificationReminders(deps())).sent, 0);
  clock = new Date(NOW.getTime() + HOUR);
  assert.equal((await runVerificationReminders(deps())).sent, 1);
});

test("a run that is missing its signing configuration sends nothing", async () => {
  seedPending();
  const result = await runVerificationReminders(deps({ env: {} }));
  assert.equal(result.aborted, "not_configured");
  assert.equal(mailer.sent.length, 0);
});

test("a run past its time budget defers the rest instead of racing the platform limit", async () => {
  for (let i = 0; i < 15; i++) seedPending();
  let calls = 0;
  const result = await runVerificationReminders(
    deps({
      now: () => {
        calls += 1;
        // First batch runs at NOW; everything after looks past the budget.
        return calls > 3 ? new Date(NOW.getTime() + REMINDER_TIME_BUDGET_MS + 1) : NOW;
      },
    }),
  );
  assert.equal(result.sent, 10);
  assert.equal(result.deferred, 5);
});

// ---------------------------------------------------------------------------
// Reporting, provider key, endpoint gate
// ---------------------------------------------------------------------------

test("the run summary carries counts and never an address or identifier", async () => {
  const rows = [seedPending(), seedPending()];
  mailer.fail = true;
  store.unsent = 3;
  const result = await runVerificationReminders(deps());
  const summary = formatReminderSummary(result)!;
  const blob = `${summary}\n${JSON.stringify(result)}`;

  assert.match(summary, /failed to send/);
  assert.match(summary, /3 pending signups/);
  for (const row of rows) {
    assert.ok(!blob.includes(row.email));
    assert.ok(!blob.includes(row.email.split("@")[0]));
    assert.ok(!blob.includes(row.leadId));
    assert.ok(!blob.includes(row.pageId));
  }
  assert.ok(!blob.includes("@"));
});

test("a missing property is reported as reminders being off", () => {
  const summary = formatReminderSummary({
    aborted: "reminder_property_missing",
    candidates: 0,
    sent: 0,
    sendFailed: 0,
    notClaimed: 0,
    skipped: {},
    failureClasses: {},
    deferred: 0,
  });
  assert.match(summary!, /reminders are OFF/);
});

test("a quiet run posts nothing", () => {
  assert.equal(
    formatReminderSummary({
      candidates: 0,
      sent: 0,
      sendFailed: 0,
      notClaimed: 0,
      skipped: {},
      failureClasses: {},
      deferred: 0,
      unsentPending: 0,
    }),
    undefined,
  );
});

test("the reminder has its own idempotency key, distinct from the first send", async () => {
  const keys: string[] = [];
  const impl = (async (_url: string | URL, init: RequestInit = {}) => {
    keys.push((init.headers as Record<string, string>)["Idempotency-Key"]);
    return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
  }) as unknown as typeof fetch;
  const resend = createResendMailer(
    { RESEND_API_KEY: "re_test_key", WATCHDIVE_EMAIL_FROM: "hello@watchdive.example" },
    impl,
    async () => {},
  );
  const id = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
  const token = createVerificationToken(id, NOW.getTime() + 24 * HOUR, false, TEST_SECRET, "en");
  const mail = {
    to: "diver@example.com",
    token,
    leadId: id,
    publicOrigin: TEST_ORIGIN,
    locale: "en" as const,
  };
  await resend.send(mail);
  await resend.send({ ...mail, reminder: true });
  assert.deepEqual(keys, [`watchdive-verification-${id}`, `watchdive-verification-reminder-${id}`]);
});

test("the cron endpoint refuses everything without a configured secret", () => {
  assert.equal(checkCronAuthorization("Bearer anything", undefined), "not_configured");
  assert.equal(checkCronAuthorization("Bearer short", "short"), "not_configured");
  const secret = "cron-secret-for-tests-0123456789";
  assert.equal(checkCronAuthorization(`Bearer ${secret}`, secret), "authorized");
  assert.equal(checkCronAuthorization(secret, secret), "unauthorized");
  assert.equal(checkCronAuthorization(`Bearer ${secret}x`, secret), "unauthorized");
  assert.equal(checkCronAuthorization(null, secret), "unauthorized");
});
