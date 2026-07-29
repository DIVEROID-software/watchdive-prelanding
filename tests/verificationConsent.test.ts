// Measurement consent is captured in the submitting browser and carried signed
// from there. Operational verification must not depend on it; advertising
// measurement must.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import {
  confirmVerificationService,
  pollVerificationService,
  requestVerificationService,
} from "../src/lib/verification/service.ts";
import {
  createVerificationToken,
  parseVerificationToken,
  signPollHandle,
  verifyPollHandle,
} from "../src/lib/verification/token.ts";
import {
  FakeLeadStore,
  FakeMailer,
  leadIdFactory,
  TEST_ENV,
  TEST_SECRET,
} from "./helpers/fakes.ts";

const EMAIL = "diver@example.com";
const CANONICAL = canonicalEmail(EMAIL);
const LEAD_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";

let store: FakeLeadStore;
let mailer: FakeMailer;
let dispatched: unknown[];
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
    dispatchVerifiedLead: async (input: unknown) => {
      dispatched.push(input);
    },
  };
}

function submit(measurementConsent: boolean) {
  return {
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    flags: [] as string[],
    suspect: false,
    measurementConsent,
    networkSendBlocked: false,
  };
}

beforeEach(() => {
  store = new FakeLeadStore();
  mailer = new FakeMailer();
  dispatched = [];
  clock = new Date("2026-07-30T09:00:00.000Z");
});

test("a granted choice mails, verifies, and converts", async () => {
  const res = await requestVerificationService(submit(true), deps());
  assert.equal(mailer.sent.length, 1);

  clock = new Date(clock.getTime() + 120_000);
  const confirmed = await confirmVerificationService(mailer.sent[0].token, deps());

  assert.equal(confirmed.status, "verified");
  assert.ok(confirmed.browserLead);
  assert.equal(dispatched.length, 1);

  const polled = await pollVerificationService(res.handle, deps());
  assert.equal(polled.status, "verified");
  assert.ok(polled.browserLead);
});

test("a denied choice still mails and still verifies, but never measures", async () => {
  const res = await requestVerificationService(submit(false), deps());
  // Verification is operational, not advertising: the mail must still go.
  assert.equal(mailer.sent.length, 1);

  clock = new Date(clock.getTime() + 120_000);
  const confirmed = await confirmVerificationService(mailer.sent[0].token, deps());

  assert.equal(confirmed.status, "verified");
  assert.equal(confirmed.browserLead, undefined);
  assert.deepEqual(dispatched, []);

  // And the row is genuinely confirmed, not held back.
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.emailVerified, true);
  assert.equal(row?.status, "verified");

  const polled = await pollVerificationService(res.handle, deps());
  assert.equal(polled.status, "verified");
  assert.equal(polled.browserLead, undefined);
});

test("the confirming browser cannot widen a denial", async () => {
  await requestVerificationService(submit(false), deps());
  const denied = mailer.sent[0].token;

  // Flip the consent segment by hand, exactly as a tampering client would.
  const parts = denied.split(".");
  assert.equal(parts[2], "0");
  const forged = `${parts[0]}.${parts[1]}.1.${parts[3]}`;

  assert.equal(parseVerificationToken(forged, TEST_SECRET, clock.getTime()), undefined);
  clock = new Date(clock.getTime() + 120_000);
  assert.deepEqual(await confirmVerificationService(forged, deps()), {
    ok: true,
    status: "invalid",
  });
  assert.deepEqual(dispatched, []);
});

test("a forged consent bit on a poll handle is refused", async () => {
  const handle = signPollHandle(LEAD_ID, clock.getTime(), false, TEST_SECRET);
  const parts = handle.split(".");
  const forged = `${parts[0]}.${parts[1]}.1.${parts[3]}`;

  assert.equal(verifyPollHandle(forged, TEST_SECRET, clock.getTime(), 86_400_000), undefined);
});

test("the signed bit round-trips both ways", () => {
  for (const consent of [true, false]) {
    const token = createVerificationToken(
      LEAD_ID,
      clock.getTime() + 86_400_000,
      consent,
      TEST_SECRET,
    );
    assert.equal(
      parseVerificationToken(token, TEST_SECRET, clock.getTime())?.measurementConsent,
      consent,
    );

    const handle = signPollHandle(LEAD_ID, clock.getTime(), consent, TEST_SECRET);
    assert.equal(
      verifyPollHandle(handle, TEST_SECRET, clock.getTime(), 86_400_000)?.measurementConsent,
      consent,
    );
  }
});

test("the consent bit is the only thing carried, and it is not an identifier", () => {
  const token = createVerificationToken(LEAD_ID, clock.getTime() + 86_400_000, true, TEST_SECRET);
  const parts = token.split(".");

  assert.equal(parts.length, 4);
  assert.equal(parts[0], LEAD_ID);
  assert.match(parts[1], /^\d+$/);
  assert.equal(parts[2], "1");
  assert.ok(!token.includes("diver"));
  assert.ok(!token.includes("example.com"));
});
