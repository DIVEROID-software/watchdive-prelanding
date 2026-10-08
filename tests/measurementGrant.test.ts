// Measurement allowed or refused after the submit (2026-10-08, hardened after
// the Grok QA round). In opt-in countries the signed consent bit was almost
// always false, so neither the submit nor the confirmation reached Meta. These
// pin the late grant: the person's explicit choice, bound to their own
// attempt, beaten by any refusal — even one racing it — never replayable into
// extra Leads, indistinguishable in timing for a decoy, and never offered to
// an abusive row.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import {
  conversionBlocked,
  FLAG_MEASUREMENT_WITHDRAWN,
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_WITHDRAWN,
  reviewFlags,
} from "../src/lib/verification/contracts.ts";
import {
  confirmVerificationService,
  createGrantGate,
  effectiveMeasurement,
  grantAttemptMeasurementService,
  grantConfirmationMeasurementService,
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

beforeEach(() => {
  store = new FakeLeadStore();
  mailer = new FakeMailer();
  verified = [];
  submits = [];
  slept = [];
  gate = createGrantGate();
  clock = new Date("2026-10-08T09:00:00.000Z");
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

test("a submit with consent records the grant on the row", async () => {
  await requestVerificationService(submit(true), deps());
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_GRANTED);
});

test("an inbox grant sends the withheld Lead once, under the server's id, then the confirmation converts", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  assert.equal(pending.status, "pending");
  const grant = await grantAttemptMeasurementService(pending.handle, { fbc: FBC }, deps());
  const expectedId = deterministicSubmitEventId(onlyRow().leadId, TEST_SECRET);
  assert.deepEqual(grant.submitLead, { eventId: expectedId, source: "hero" });
  assert.equal(submits.length, 1);
  assert.equal(submits[0].eventId, expectedId);
  assert.equal(submits[0].fbc, FBC);
  assert.equal(store.measurementFbcs[0].metaFbc, FBC);

  clock = new Date(clock.getTime() + 60_000);
  const confirmed = await confirmVerificationService(mailer.sent[0].token, deps());
  assert.ok(confirmed.browserLead);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].fbc, FBC, "the stored click cookie is used in the mail app");
});

test("replaying the grant cannot mint extra Leads or extra writes", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  for (let i = 0; i < 10; i++) {
    await grantAttemptMeasurementService(pending.handle, {}, deps());
  }
  assert.equal(new Set(submits.map((x) => x.eventId)).size, 1, "one Lead id, ever (Meta dedupes)");
  assert.ok(submits.length <= 6, "the per-attempt gate caps replays");
  assert.equal(store.measurementGrants.length, 1, "one consent write");
});

test("a refusal racing the grant wins: no Lead, and the cell ends withdrawn", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  store.onGrantWrite = (pageId) => {
    store.onGrantWrite = undefined;
    void store.recordMeasurementWithdrawal(pageId);
  };
  const grant = await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.equal(grant.browserLead, undefined);
  assert.equal(submits.length, 0);
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_WITHDRAWN);
  assert.ok(onlyRow().flags.includes(FLAG_MEASUREMENT_WITHDRAWN));
});

test("a failed grant write sends nothing", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  store.failGrantWrite = true;
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.equal(submits.length, 0);
});

test("Reject after Allow, before the confirmation: the confirmation sends nothing", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  await withdrawAttemptMeasurementService(pending.handle, deps());
  clock = new Date(clock.getTime() + 60_000);
  const confirmed = await confirmVerificationService(mailer.sent[0].token, deps());
  assert.equal(confirmed.browserLead, undefined);
  assert.equal(confirmed.measurementAsk, undefined, "a refusal is not asked again");
  assert.equal(verified.length, 0);
  // Operational mail is unaffected: the withdrawal flag is not an abuse flag.
  assert.equal(conversionBlocked([FLAG_MEASUREMENT_WITHDRAWN]), false);
  assert.deepEqual(reviewFlags([FLAG_MEASUREMENT_WITHDRAWN]), []);
});

test("consent at submit, then Reject: the signed bit no longer converts", async () => {
  const pending = await requestVerificationService(submit(true), deps());
  await withdrawAttemptMeasurementService(pending.handle, deps());
  clock = new Date(clock.getTime() + 60_000);
  await confirmVerificationService(mailer.sent[0].token, deps());
  assert.equal(verified.length, 0);
});

test("a confirmation-page grant sends both the withheld Lead and the confirmation", async () => {
  await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 60_000);
  const token = mailer.sent[0].token;
  await confirmVerificationService(token, deps());
  const grant = await grantConfirmationMeasurementService(token, { fbc: FBC }, deps());
  assert.ok(grant.browserLead);
  assert.ok(grant.submitLead, "the Lead nobody sent at submit");
  assert.equal(submits.length, 1);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].fbc, FBC);
});

test("a confirmation-page refusal is recorded", async () => {
  await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 60_000);
  const token = mailer.sent[0].token;
  await confirmVerificationService(token, deps());
  await withdrawConfirmationMeasurementService(token, deps());
  assert.ok(onlyRow().flags.includes(FLAG_MEASUREMENT_WITHDRAWN));
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

test("a grant after the confirmation sends the confirmation too", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 60_000);
  await confirmVerificationService(mailer.sent[0].token, deps());
  const grant = await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.ok(grant.browserLead);
  assert.equal(verified.length, 1);
});

test("decoy and real handles both wait out the response floor", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  slept = [];
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  const decoy = signPollHandle(
    "aaaaaaaa-bbbb-4ccc-8ddd-00000000dead",
    clock.getTime(),
    false,
    TEST_SECRET,
  );
  await grantAttemptMeasurementService(decoy, {}, deps());
  await grantAttemptMeasurementService("x".repeat(40), {}, deps());
  assert.equal(slept.length, 3, "every path sleeps to the floor (the fake clock never advances)");
});

test("an abuse-flagged row is never granted and never converts", async () => {
  await requestVerificationService(submit(false, { flags: ["disposable"], suspect: true }), deps());
  const handle = signPollHandle(onlyRow().leadId, clock.getTime(), false, TEST_SECRET);
  await grantAttemptMeasurementService(handle, {}, deps());
  assert.equal(submits.length, 0);
  assert.equal(store.measurementGrants.length, 0);
});

test("the click cookie is kept at submit only with consent", async () => {
  await requestVerificationService(submit(false, { metaFbc: FBC }), deps());
  assert.equal(store.createPendingInputs[0].metaFbc, undefined);
  store = new FakeLeadStore();
  await requestVerificationService(submit(true, { metaFbc: FBC }), deps());
  assert.equal(store.createPendingInputs[0].metaFbc, FBC);
});

test("effective measurement: any refusal > granted row > signed bit", () => {
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
  assert.equal(effectiveMeasurement(base, false), false);
  assert.equal(effectiveMeasurement(base, true), true);
  assert.equal(
    effectiveMeasurement({ ...base, measurementConsent: MEASUREMENT_CONSENT_GRANTED }, false),
    true,
  );
  assert.equal(
    effectiveMeasurement({ ...base, measurementConsent: MEASUREMENT_CONSENT_WITHDRAWN }, true),
    false,
  );
  assert.equal(
    effectiveMeasurement(
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

test("the grant body is the same for a real attempt and a decoy (no existence oracle)", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  const real = await grantAttemptMeasurementService(pending.handle, { source: "hero" }, deps());
  const decoyHandle = signPollHandle(
    "aaaaaaaa-bbbb-4ccc-8ddd-00000000dead",
    clock.getTime(),
    false,
    TEST_SECRET,
  );
  const decoy = await grantAttemptMeasurementService(decoyHandle, { source: "hero" }, deps());
  assert.deepEqual(Object.keys(real).sort(), Object.keys(decoy).sort());
  assert.equal(real.submitLead?.source, "hero");
  assert.equal(
    decoy.submitLead?.source,
    "hero",
    "the label is the caller's form, never the stored source",
  );
  assert.equal(submits.length, 1, "only the real attempt reaches Meta");
});

test("a refusal landing just before dispatch stops the conversion", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  const reread = store.reread.bind(store);
  let reads = 0;
  store.reread = async (pageId: string) => {
    reads += 1;
    // applyGrant reads twice; the third read is the one right before dispatch.
    if (reads === 3) await store.recordMeasurementWithdrawal(pageId);
    return reread(pageId);
  };
  await grantAttemptMeasurementService(pending.handle, { fbc: FBC }, deps());
  assert.equal(submits.length, 0);
  assert.equal(store.measurementFbcs.length, 0, "no click cookie written onto a refused row");
});

test("a grant whose confirming read fails still sends the Lead, and a retry recovers it", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  const reread = store.reread.bind(store);
  let reads = 0;
  store.reread = async (pageId: string) => {
    reads += 1;
    if (reads === 2) throw new Error("timeout");
    return reread(pageId);
  };
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.equal(submits.length, 1, "the write landed, so the Lead goes out");
  store.reread = reread;
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.equal(new Set(submits.map((x) => x.eventId)).size, 1, "a retry re-sends the same id");
});

test("a failed withdrawal write is retried and reported honestly", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  await grantAttemptMeasurementService(pending.handle, {}, deps());
  const original = store.recordMeasurementWithdrawal.bind(store);
  let calls = 0;
  store.recordMeasurementWithdrawal = async (pageId: string) => {
    calls += 1;
    if (calls < 2) throw new Error("notion 500");
    return original(pageId);
  };
  const res = await withdrawAttemptMeasurementService(pending.handle, deps());
  assert.equal(res.recorded, true);
  store.recordMeasurementWithdrawal = async () => {
    throw new Error("notion down");
  };
  gate = createGrantGate();
  store = Object.assign(store, {});
  const row = onlyRow();
  store.rows.set(row.pageId, {
    ...row,
    flags: [],
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
  });
  const failed = await withdrawAttemptMeasurementService(pending.handle, deps());
  assert.equal(failed.recorded, false, "the client keeps retrying instead of trusting it");
});

test("a cooled resend that now carries consent records the grant and sends the withheld Lead once", async () => {
  await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 61_000);
  await requestVerificationService(submit(true), deps());
  assert.equal(onlyRow().measurementConsent, MEASUREMENT_CONSENT_GRANTED);
  assert.equal(submits.length, 1);
  assert.equal(submits[0].eventId, deterministicSubmitEventId(onlyRow().leadId, TEST_SECRET));
  clock = new Date(clock.getTime() + 61_000);
  await requestVerificationService(submit(true), deps());
  assert.equal(submits.length, 1, "a row already granted is not counted twice");
});
