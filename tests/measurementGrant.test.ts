// Measurement allowed or refused after the submit (2026-10-08, rebuilt after
// three Grok QA rounds). The `Measurement consent` cell is a state machine —
// withheld → granted-lead-pending → granted, or withdrawn (plus a flag a grant
// never writes). The late submit Lead is server-only, sent once Meta takes it,
// under an id derived from the row; every send re-reads the row right before
// it leaves and fails closed. These pin each scenario the QA rounds raised.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import {
  conversionBlocked,
  FLAG_MEASUREMENT_WITHDRAWN,
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_LEAD_PENDING,
  MEASUREMENT_CONSENT_WITHDRAWN,
  MEASUREMENT_CONSENT_WITHHELD,
  reviewFlags,
} from "../src/lib/verification/contracts.ts";
import {
  confirmVerificationService,
  createGrantGate,
  grantAttemptMeasurementService,
  grantConfirmationMeasurementService,
  measurementAllows,
  pollVerificationService,
  requestVerificationService,
  withdrawAttemptMeasurementService,
  withdrawConfirmationMeasurementService,
} from "../src/lib/verification/service.ts";
import { deterministicSubmitEventId, signPollHandle } from "../src/lib/verification/token.ts";
import { isMetaFbc } from "../src/lib/verification/notionLead.ts";
import {
  FakeLeadStore,
  FakeMailer,
  leadIdFactory,
  TEST_ENV,
  TEST_SECRET,
} from "./helpers/fakes.ts";

const EMAIL = "diver@example.com";
const CANONICAL = canonicalEmail(EMAIL);
const FBC = "fb.1.1759900000000.IwAR0abcdefghijklmnop";

let store: FakeLeadStore;
let mailer: FakeMailer;
let verified: Record<string, unknown>[];
let submits: Record<string, unknown>[];
let metaAcks: boolean;
let slept: number[];
let clock: Date;
let gate: (leadId: string) => boolean;

function deps() {
  return {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async (ms: number) => {
      slept.push(ms);
    },
    dispatchVerifiedLead: async (input: Record<string, unknown>) => {
      verified.push(input);
    },
    dispatchSubmitLead: async (input: Record<string, unknown>) => {
      submits.push(input);
      return metaAcks;
    },
    grantGate: gate,
  };
}

function submit(measurementConsent: boolean, extra: Record<string, unknown> = {}) {
  return {
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    flags: [] as string[],
    suspect: false,
    measurementConsent,
    networkSendBlocked: false,
    ...extra,
  };
}

const onlyRow = () => [...store.rows.values()][0];
const rowLeadId = () => deterministicSubmitEventId(onlyRow().pageId, TEST_SECRET);

beforeEach(() => {
  store = new FakeLeadStore();
  mailer = new FakeMailer();
  verified = [];
  submits = [];
  metaAcks = true;
  slept = [];
  gate = createGrantGate();
  clock = new Date("2026-10-08T09:00:00.000Z");
});

test("a submit records its consent state: granted, or withheld", async () => {
  await requestVerificationService(submit(true), deps());
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_GRANTED);
  store = new FakeLeadStore();
  await requestVerificationService(submit(false), deps());
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_WITHHELD);
});

test("without any consent the confirmation converts nothing and asks once", async () => {
  await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 60_000);
  const confirmed = await confirmVerificationService(mailer.sent[0].token, deps());
  assert.equal(confirmed.status, "verified");
  assert.equal(confirmed.browserLead, undefined);
  assert.equal(confirmed.measurementAsk, true);
  assert.equal(verified.length, 0);
});

test("an inbox grant sends the withheld Lead server-side, under the row's id, then marks it sent", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  const grant = await grantAttemptMeasurementService(pending.handle, { fbc: FBC }, deps());
  assert.deepEqual(grant, { ok: true }, "nothing for the browser to fire");
  assert.equal(submits.length, 1);
  assert.equal(submits[0].eventId, rowLeadId());
  assert.equal(submits[0].fbc, FBC);
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_GRANTED);
  assert.equal(onlyRow().metaFbc, FBC);

  clock = new Date(clock.getTime() + 60_000);
  const confirmed = await confirmVerificationService(mailer.sent[0].token, deps());
  assert.ok(confirmed.browserLead);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].fbc, FBC, "the stored click cookie is used in the mail app");
  assert.equal(submits.length, 1, "the Lead is not sent again");
});

test("the grant answer is identical for a real attempt, a decoy and a forged handle", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  slept = []; // the submit waits out its own floor too
  const real = await grantAttemptMeasurementService(pending.handle, { source: "hero" }, deps());
  const decoyHandle = signPollHandle(
    "aaaaaaaa-bbbb-4ccc-8ddd-00000000dead",
    clock.getTime(),
    false,
    TEST_SECRET,
  );
  const decoy = await grantAttemptMeasurementService(decoyHandle, { source: "hero" }, deps());
  const forged = await grantAttemptMeasurementService("x".repeat(40), {}, deps());
  assert.deepEqual(real, { ok: true });
  assert.deepEqual(decoy, { ok: true });
  assert.deepEqual(forged, { ok: true });
  assert.equal(slept.length, 3, "every path waits out the floor");
  assert.equal(submits.length, 1, "only the real attempt reaches Meta");
});

test("replaying the grant cannot mint extra Leads or extra writes", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  for (let i = 0; i < 10; i++) await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.equal(submits.length, 1);
  assert.equal(
    store.measurementStates.filter(([, s]) => s !== MEASUREMENT_CONSENT_WITHHELD).length,
    2,
    "lead-pending, then granted — nothing more",
  );
});

test("a Meta failure keeps the Lead pending, and the next opportunity retries it under the same id", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  metaAcks = false;
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_LEAD_PENDING);
  metaAcks = true;
  clock = new Date(clock.getTime() + 60_000);
  await confirmVerificationService(mailer.sent[0].token, deps());
  assert.equal(submits.length, 2);
  assert.equal(submits[0].eventId, submits[1].eventId, "Meta collapses the pair");
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_GRANTED);
});

test("a refusal racing the grant write wins: no Lead, and the row ends withdrawn", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  store.onStateWrite = (pageId) => {
    store.onStateWrite = undefined;
    void store.recordMeasurementWithdrawal(pageId);
  };
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.equal(submits.length, 0);
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_WITHDRAWN);
  assert.ok(onlyRow().flags.includes(FLAG_MEASUREMENT_WITHDRAWN));
});

test("a refusal landing during the click-cookie write sends nothing and leaves no cookie", async () => {
  // Confirmed lead, no consent yet: the grant would send the Lead and the
  // confirmation. The refusal lands inside the cookie write, after both sends'
  // own checks in this ordering, so sends happen first — prove the cookie is
  // cleared and nothing is sent *after* it.
  await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 60_000);
  const token = mailer.sent[0].token;
  await confirmVerificationService(token, deps());
  store.onFbcWrite = (pageId) => {
    store.onFbcWrite = undefined;
    void store.recordMeasurementWithdrawal(pageId);
  };
  await grantConfirmationMeasurementService(token, { fbc: FBC }, deps());
  assert.ok(measurementAllows(onlyRow(), false) === false, "the refusal stands");
  assert.equal(onlyRow().metaFbc, undefined, "the click cookie is not left on a refused row");
  const before = { submits: submits.length, verified: verified.length };
  await grantConfirmationMeasurementService(token, { fbc: FBC }, deps());
  await confirmVerificationService(token, deps());
  assert.deepEqual({ submits: submits.length, verified: verified.length }, before, "nothing after");
});

test("a refusal just before a send stops that send (the row is read right before it leaves)", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  const reread = store.reread.bind(store);
  store.reread = async (pageId: string) => {
    const row = await reread(pageId);
    // Every read after the grant write sees a refusal that just landed.
    if (row?.measurementConsent === MEASUREMENT_CONSENT_LEAD_PENDING) {
      await store.recordMeasurementWithdrawal(pageId);
      return reread(pageId);
    }
    return row;
  };
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.equal(submits.length, 0);
});

test("an unreadable row sends nothing (fail closed) and the Lead stays pending for later", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  const reread = store.reread.bind(store);
  let reads = 0;
  store.reread = async (pageId: string) => {
    reads += 1;
    if (reads === 3) throw new Error("timeout"); // the pre-send read
    return reread(pageId);
  };
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.equal(submits.length, 0);
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_LEAD_PENDING);
  store.reread = reread;
  clock = new Date(clock.getTime() + 60_000);
  await confirmVerificationService(mailer.sent[0].token, deps());
  assert.equal(submits.length, 1, "recovered at the confirmation");
});

test("Reject after Allow (before the confirmation): the confirmation sends nothing", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  const res = await withdrawAttemptMeasurementService(pending.handle, deps());
  assert.equal(res.recorded, true);
  clock = new Date(clock.getTime() + 60_000);
  const confirmed = await confirmVerificationService(mailer.sent[0].token, deps());
  assert.equal(confirmed.browserLead, undefined);
  assert.equal(confirmed.measurementAsk, undefined, "a refusal is not asked again");
  assert.equal(verified.length, 0);
  assert.equal(conversionBlocked([FLAG_MEASUREMENT_WITHDRAWN]), false, "not an abuse flag");
  assert.deepEqual(reviewFlags([FLAG_MEASUREMENT_WITHDRAWN]), [], "reminders ignore it");
});

test("consent at submit, then Reject: nothing converts", async () => {
  const pending = await requestVerificationService(submit(true), deps());
  await withdrawAttemptMeasurementService(pending.handle, deps());
  clock = new Date(clock.getTime() + 60_000);
  await confirmVerificationService(mailer.sent[0].token, deps());
  assert.equal(verified.length, 0);
});

test("a later Allow cannot undo a recorded refusal", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  await withdrawAttemptMeasurementService(pending.handle, deps());
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.equal(submits.length, 0);
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_WITHDRAWN);
});

test("a refusal stored only in the confirming browser is recorded before anything is sent", async () => {
  await requestVerificationService(submit(true), deps());
  clock = new Date(clock.getTime() + 60_000);
  const confirmed = await confirmVerificationService(
    mailer.sent[0].token,
    deps(),
    {},
    {
      localRefusal: true,
    },
  );
  assert.equal(confirmed.status, "verified");
  assert.equal(verified.length, 0);
  assert.ok(onlyRow().flags.includes(FLAG_MEASUREMENT_WITHDRAWN));
});

test("a failed withdrawal write is retried and reported honestly", async () => {
  const pending = await requestVerificationService(submit(true), deps());
  const original = store.recordMeasurementWithdrawal.bind(store);
  let calls = 0;
  store.recordMeasurementWithdrawal = async (pageId: string) => {
    calls += 1;
    if (calls < 2) throw new Error("notion 500");
    return original(pageId);
  };
  assert.equal((await withdrawAttemptMeasurementService(pending.handle, deps())).recorded, true);

  store = new FakeLeadStore();
  const second = await requestVerificationService(submit(true), deps());
  store.recordMeasurementWithdrawal = async () => {
    throw new Error("notion down");
  };
  assert.equal((await withdrawAttemptMeasurementService(second.handle, deps())).recorded, false);
});

test("a confirmation-page grant sends the withheld Lead and the confirmation", async () => {
  await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 60_000);
  const token = mailer.sent[0].token;
  await confirmVerificationService(token, deps());
  const grant = await grantConfirmationMeasurementService(token, { fbc: FBC }, deps());
  assert.ok(grant.browserLead, "the token holder gets the confirmation's browser half");
  assert.equal(submits.length, 1);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].fbc, FBC);
});

test("a confirmation-page refusal is recorded and no browser half comes back", async () => {
  await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 60_000);
  const token = mailer.sent[0].token;
  await confirmVerificationService(token, deps());
  await withdrawConfirmationMeasurementService(token, deps());
  const grant = await grantConfirmationMeasurementService(token, {}, deps());
  assert.deepEqual(grant, { ok: true });
  assert.equal(verified.length, 0);
});

test("the poll in the submitting tab reports the confirmation after a late grant", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  clock = new Date(clock.getTime() + 60_000);
  await confirmVerificationService(mailer.sent[0].token, deps());
  const polled = await pollVerificationService(pending.handle, deps());
  assert.equal(polled.status, "verified");
  assert.ok(polled.browserLead);
});

test("a grant after the confirmation sends the confirmation server-side", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 60_000);
  await confirmVerificationService(mailer.sent[0].token, deps());
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.equal(verified.length, 1);
  assert.equal(submits.length, 1);
});

test("a cooled resend that now carries consent sends the withheld Lead once", async () => {
  await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 61_000);
  await requestVerificationService(submit(true, { metaFbc: FBC }), deps());
  assert.equal(submits.length, 1);
  assert.equal(submits[0].eventId, rowLeadId(), "keyed on the row, not the rotated attempt");
  assert.equal(submits[0].fbc, FBC);
  clock = new Date(clock.getTime() + 61_000);
  await requestVerificationService(submit(true), deps());
  assert.equal(submits.length, 1, "already granted: not sent twice");
});

test("a refusal racing a consented resend wins", async () => {
  await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 61_000);
  store.onStateWrite = (pageId) => {
    store.onStateWrite = undefined;
    void store.recordMeasurementWithdrawal(pageId);
  };
  await requestVerificationService(submit(true), deps());
  assert.equal(submits.length, 0);
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_WITHDRAWN);
});

test("a pre-release row (empty cell) is never read as withheld on resend", async () => {
  store.seed({
    email: EMAIL,
    canonical: CANONICAL,
    status: "pending",
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-0000000000aa",
    sends: 1,
    sentAt: new Date(clock.getTime() - 3_600_000).toISOString(),
    expiresAt: new Date(clock.getTime() + 3_600_000).toISOString(),
  });
  await requestVerificationService(submit(true), deps());
  assert.equal(submits.length, 0, "its submit-time Lead already ran with consent");
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_GRANTED);
});

test("an abuse-flagged row is never granted and never converts", async () => {
  await requestVerificationService(submit(false, { flags: ["disposable"], suspect: true }), deps());
  const handle = signPollHandle(onlyRow().leadId, clock.getTime(), false, TEST_SECRET);
  await grantAttemptMeasurementService(handle, {}, deps());
  assert.equal(submits.length, 0);
  assert.equal(store.measurementStates.length, 0);
});

test("the click cookie is kept at submit only with consent", async () => {
  await requestVerificationService(submit(false, { metaFbc: FBC }), deps());
  assert.equal(store.createPendingInputs[0].metaFbc, undefined);
  store = new FakeLeadStore();
  await requestVerificationService(submit(true, { metaFbc: FBC }), deps());
  assert.equal(store.createPendingInputs[0].metaFbc, FBC);
});

test("measurement rule: any refusal > granted states > withheld > legacy signed bit", () => {
  const base = {
    pageId: "p",
    email: EMAIL,
    status: "verified" as const,
    emailVerified: true,
    refCode: "x",
    source: "hero",
    suspect: false,
    flags: [] as string[],
    phone: "",
    leadId: "l",
    metaEventId: "m",
    sends: 1,
  };
  assert.equal(measurementAllows(base, false), false);
  assert.equal(measurementAllows(base, true), true, "legacy empty cell follows the signed bit");
  assert.equal(
    measurementAllows({ ...base, measurementConsent: MEASUREMENT_CONSENT_WITHHELD }, true),
    false,
  );
  assert.equal(
    measurementAllows({ ...base, measurementConsent: MEASUREMENT_CONSENT_LEAD_PENDING }, false),
    true,
  );
  assert.equal(
    measurementAllows({ ...base, measurementConsent: MEASUREMENT_CONSENT_GRANTED }, false),
    true,
  );
  assert.equal(
    measurementAllows(
      {
        ...base,
        measurementConsent: MEASUREMENT_CONSENT_GRANTED,
        flags: [FLAG_MEASUREMENT_WITHDRAWN],
      },
      true,
    ),
    false,
    "the flag beats a granted cell a racing grant may have written",
  );
});

test("only Meta's documented click-cookie shape is stored", () => {
  assert.ok(isMetaFbc(FBC));
  assert.ok(!isMetaFbc("fb.1.123.short"));
  assert.ok(!isMetaFbc("<script>"));
  assert.ok(!isMetaFbc(undefined));
});
