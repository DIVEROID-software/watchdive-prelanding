// Measurement allowed after the submit (2026-10-08). In opt-in countries the
// cookie bar was almost never seen, so the signed consent bit was almost always
// false and neither the submit nor the confirmation ever reached Meta. These
// pin the late grant: it must be the person's explicit choice, bound to their
// own attempt, beaten by a withdrawal, and never offered to an abusive row.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import {
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_WITHDRAWN,
} from "../src/lib/verification/contracts.ts";
import {
  confirmVerificationService,
  effectiveMeasurement,
  grantAttemptMeasurementService,
  grantConfirmationMeasurementService,
  pollVerificationService,
  requestVerificationService,
} from "../src/lib/verification/service.ts";
import { signPollHandle } from "../src/lib/verification/token.ts";
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
let clock: Date;

function deps() {
  return {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async () => {},
    dispatchVerifiedLead: async (input: Record<string, unknown>) => {
      verified.push(input);
    },
    dispatchSubmitLead: async (input: Record<string, unknown>) => {
      submits.push(input);
    },
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

beforeEach(() => {
  store = new FakeLeadStore();
  mailer = new FakeMailer();
  verified = [];
  submits = [];
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

test("a grant on the inbox card sends the withheld Lead and makes the confirmation convert", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  assert.equal(pending.status, "pending");
  const grant = await grantAttemptMeasurementService(
    pending.handle,
    { submitEventId: "submit-event-0001", fbc: FBC },
    deps(),
  );
  assert.deepEqual(grant, { ok: true });
  assert.equal(submits.length, 1);
  assert.equal(submits[0].eventId, "submit-event-0001");
  assert.equal(submits[0].fbc, FBC);
  assert.equal(store.measurementGrants.length, 1);

  clock = new Date(clock.getTime() + 60_000);
  const confirmed = await confirmVerificationService(mailer.sent[0].token, deps());
  assert.ok(confirmed.browserLead, "the confirming browser gets its half");
  assert.equal(confirmed.measurementAsk, undefined);
  assert.equal(verified.length, 1);
  // Confirmed in a mail app with no click cookie: the stored one is used.
  assert.equal(verified[0].fbc, FBC);
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

test("a grant after the confirmation already happened sends the confirmation too", async () => {
  const pending = await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 60_000);
  await confirmVerificationService(mailer.sent[0].token, deps());
  assert.equal(verified.length, 0);
  const grant = await grantAttemptMeasurementService(pending.handle, {}, deps());
  assert.ok(grant.browserLead);
  assert.equal(verified.length, 1);
});

test("a grant on the confirmation page converts the confirmed lead", async () => {
  await requestVerificationService(submit(false), deps());
  clock = new Date(clock.getTime() + 60_000);
  const token = mailer.sent[0].token;
  await confirmVerificationService(token, deps());
  const grant = await grantConfirmationMeasurementService(token, { fbc: FBC }, deps());
  assert.ok(grant.browserLead);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].fbc, FBC);
  assert.equal(store.measurementGrants[0].metaFbc, FBC);
});

test("the confirmation-page grant does nothing for an unconfirmed lead", async () => {
  await requestVerificationService(submit(false), deps());
  const grant = await grantConfirmationMeasurementService(mailer.sent[0].token, {}, deps());
  assert.deepEqual(grant, { ok: true });
  assert.equal(verified.length, 0);
  assert.equal(store.measurementGrants.length, 0);
});

test("a withdrawal on the row beats the signed bit and any later grant", async () => {
  await requestVerificationService(submit(true), deps());
  const row = [...store.rows.values()][0];
  store.rows.set(row.pageId, { ...row, measurementConsent: MEASUREMENT_CONSENT_WITHDRAWN });
  clock = new Date(clock.getTime() + 60_000);
  const token = mailer.sent[0].token;
  const confirmed = await confirmVerificationService(token, deps());
  assert.equal(confirmed.browserLead, undefined);
  assert.equal(confirmed.measurementAsk, undefined);
  const grant = await grantConfirmationMeasurementService(token, {}, deps());
  assert.deepEqual(grant, { ok: true });
  assert.equal(verified.length, 0);
});

test("an abuse-flagged row is never asked and never converts", async () => {
  await requestVerificationService(submit(false, { flags: ["disposable"], suspect: true }), deps());
  // Suppressed submits mail nothing; seed the confirmed state directly.
  const row = [...store.rows.values()][0];
  const handle = signPollHandle(row.leadId, clock.getTime(), false, TEST_SECRET);
  const grant = await grantAttemptMeasurementService(
    handle,
    { submitEventId: "submit-event-0002" },
    deps(),
  );
  assert.deepEqual(grant, { ok: true });
  assert.equal(submits.length, 0);
  assert.equal(store.measurementGrants.length, 0);
});

test("a forged or foreign handle is answered uniformly and touches nothing", async () => {
  const forged = await grantAttemptMeasurementService("x".repeat(40), {}, deps());
  assert.deepEqual(forged, { ok: true });
  const unknown = signPollHandle(
    "aaaaaaaa-bbbb-4ccc-8ddd-00000000dead",
    clock.getTime(),
    false,
    TEST_SECRET,
  );
  assert.deepEqual(await grantAttemptMeasurementService(unknown, {}, deps()), { ok: true });
  assert.equal(store.measurementGrants.length, 0);
});

test("the click cookie is kept at submit only with consent", async () => {
  await requestVerificationService(submit(false, { metaFbc: FBC }), deps());
  assert.equal(store.createPendingInputs[0].metaFbc, undefined);
  store = new FakeLeadStore();
  await requestVerificationService(submit(true, { metaFbc: FBC }), deps());
  assert.equal(store.createPendingInputs[0].metaFbc, FBC);
});

test("effective measurement: withdrawn > granted row > signed bit", () => {
  const base = {
    pageId: "p",
    email: EMAIL,
    status: "verified" as const,
    emailVerified: true,
    refCode: "x",
    source: "hero",
    suspect: false,
    flags: [],
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
});

test("only Meta's documented click-cookie shape is stored", () => {
  assert.ok(isMetaFbc(FBC));
  assert.ok(!isMetaFbc("fb.1.123.short"));
  assert.ok(!isMetaFbc("<script>"));
  assert.ok(!isMetaFbc(undefined));
});
