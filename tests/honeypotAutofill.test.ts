// Browser autofill of a hidden name=company field was stored as a honeypot and
// the verification message was dropped. These tests are the regression for that
// path. They use fakes only: no network, no customer row, no live mail.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import {
  MEASUREMENT_CONSENT_WITHHELD,
  VERIFICATION_TTL_MS,
  conversionBlocked,
  verificationSendBlocked,
} from "../src/lib/verification/contracts.ts";
import {
  confirmVerificationService,
  requestVerificationService,
} from "../src/lib/verification/service.ts";
import { parseVerificationToken } from "../src/lib/verification/token.ts";
import { FakeLeadStore, FakeMailer, TEST_ENV, TEST_SECRET, leadIdFactory } from "./helpers/fakes.ts";

const EMAIL = "diver@example.com";
const CANONICAL = canonicalEmail(EMAIL);

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("signup and return traps are not organization autofill fields", () => {
  const signup = read("src/routes/index.tsx");
  const reservation = read("src/components/reservation/ReturnLinkForm.tsx");
  const brutal = read("src/styles-brutal.css");
  for (const source of [signup, reservation]) {
    assert.equal(source.includes('name="company"'), false);
    assert.ok(source.includes('name="wd_hp"'));
    assert.ok(source.includes('autoComplete="off"'));
    assert.ok(source.includes('data-1p-ignore="true"'));
    assert.ok(source.includes('data-lpignore="true"'));
    assert.ok(source.includes('data-bwignore="true"'));
  }
  assert.ok(brutal.includes(':not([name="wd_hp"])'));
  assert.equal(brutal.includes('name="company"'), false);
  // The reservation POST keeps the old JSON key so a cached client still parses.
  const client = read("src/components/reservation/returnClient.ts");
  assert.ok(client.includes("company: input.honeypot"));
});

test("a honeypot flag alone does not block verification mail and still blocks a conversion", () => {
  assert.equal(verificationSendBlocked(["honeypot"]), false);
  assert.equal(verificationSendBlocked(["honeypot", "ip-repeat"]), false);
  assert.equal(verificationSendBlocked(["disposable"]), true);
  assert.equal(verificationSendBlocked(["headless"]), true);
  assert.equal(verificationSendBlocked(["honeypot", "disposable"]), true);
  assert.equal(conversionBlocked(["honeypot"]), true);
});

function harness() {
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const dispatched: { eventId: string }[] = [];
  const clock = new Date("2026-10-31T05:29:00.000Z");
  const deps = {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async () => {},
    dispatchVerifiedLead: async (input: { eventId: string }) => {
      dispatched.push(input);
    },
  };
  return { store, mailer, dispatched, clock, deps };
}

function submit(overrides: Record<string, unknown> = {}) {
  return {
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero" as const,
    flags: [] as string[],
    suspect: false,
    measurementConsent: true,
    networkSendBlocked: false,
    ...overrides,
  };
}

test("a new honeypot-only signup is mailed, stays unverified, and converts nothing", async () => {
  const { store, mailer, dispatched, clock, deps } = harness();
  const res = await requestVerificationService(
    submit({ flags: ["honeypot"], suspect: true }),
    deps,
  );

  assert.equal(res.status, "pending");
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, EMAIL);
  assert.equal(mailer.welcomes.length, 0);
  assert.equal(dispatched.length, 0);
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.status, "pending");
  assert.equal(row?.emailVerified, false);
  assert.equal(row?.suspect, true);
  assert.deepEqual(row?.flags, ["honeypot"]);
  assert.equal(store.createPendingInputs[0].measurementState, MEASUREMENT_CONSENT_WITHHELD);
  const parsed = parseVerificationToken(mailer.sent[0].token, TEST_SECRET, clock.getTime());
  assert.equal(parsed?.measurementConsent, false);

  const confirmed = await confirmVerificationService(mailer.sent[0].token, deps);
  assert.equal(confirmed.status, "verified");
  assert.equal(confirmed.registration, undefined);
  assert.equal(mailer.welcomes.length, 0);
  assert.equal(dispatched.length, 0);
  const after = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(after?.emailVerified, true);
  assert.equal(after?.suspect, true);
  assert.deepEqual(after?.flags, ["honeypot"]);
});

test("disposable, headless, and a honeypot plus either of them still mail nobody", async () => {
  for (const flags of [["disposable"], ["headless"], ["honeypot", "disposable"], ["honeypot", "headless"]]) {
    const { store, mailer, deps } = harness();
    await requestVerificationService(submit({ flags, suspect: true }), deps);
    assert.equal(mailer.sent.length, 0, flags.join("+"));
    const row = await store.findByEmail(CANONICAL, EMAIL);
    assert.equal(row?.status, "pending");
    assert.equal(row?.emailVerified, false);
    assert.equal(row?.suspect, true);
  }
});

test("a honeypot replay does not replace a live confirmation link", async () => {
  const { store, mailer, deps } = harness();
  await requestVerificationService(submit(), deps);
  const live = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(mailer.sent.length, 1);
  const attempts = store.startAttemptCalls;
  await requestVerificationService(submit({ flags: ["honeypot"], suspect: true }), deps);
  const after = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(after?.leadId, live?.leadId);
  assert.equal(after?.sentAt, live?.sentAt);
  assert.equal(after?.sends, live?.sends);
  assert.equal(store.startAttemptCalls, attempts);
  assert.equal(mailer.sent.length, 1);
});

test("a later clean submit can mail an existing honeypot row without clearing the flag", async () => {
  const box = harness();
  const started = box.clock.getTime() - 120_000;
  box.store.seed({
    email: EMAIL,
    canonical: CANONICAL,
    flags: ["honeypot"],
    suspect: true,
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-0000000000aa",
    sends: 1,
    expiresAt: new Date(started + VERIFICATION_TTL_MS).toISOString(),
    signedUpAt: new Date(started).toISOString(),
  });
  await requestVerificationService(submit(), box.deps);
  assert.equal(box.mailer.sent.length, 1);
  assert.equal(box.mailer.welcomes.length, 0);
  const row = await box.store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.suspect, true);
  assert.deepEqual(row?.flags, ["honeypot"]);
  assert.equal(row?.emailVerified, false);
  assert.equal(box.store.startAttemptCalls, 1);
});

test("a network block still sends no verification mail", async () => {
  const { mailer, deps } = harness();
  await requestVerificationService(submit({ networkSendBlocked: true }), deps);
  assert.equal(mailer.sent.length, 0);
});
