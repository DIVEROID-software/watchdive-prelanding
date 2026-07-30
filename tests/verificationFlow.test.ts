import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import {
  FIELD_LEAD_ID,
  GENERIC_PENDING_MESSAGE,
  VERIFICATION_MAX_SENDS,
} from "../src/lib/verification/contracts.ts";
import {
  confirmVerificationService,
  pollVerificationService,
  requestVerificationService,
} from "../src/lib/verification/service.ts";
import {
  createVerificationToken,
  deterministicMetaEventId,
} from "../src/lib/verification/token.ts";
import {
  FakeLeadStore,
  FakeMailer,
  leadIdFactory,
  TEST_ENV,
  TEST_ORIGIN,
  TEST_SECRET,
} from "./helpers/fakes.ts";

const EMAIL = "diver@example.com";
const CANONICAL = canonicalEmail(EMAIL);

let store: FakeLeadStore;
let mailer: FakeMailer;
let dispatched: { eventId: string; email: string; source: string }[];
let clock: Date;
let nextLeadId: () => string;

function deps(overrides: Record<string, unknown> = {}) {
  return {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: nextLeadId,
    refCode: () => "abcd1234",
    // The response floor is real policy but would make the suite sleep; the
    // seam keeps it observable without the wall-clock cost.
    sleep: async () => {},
    dispatchVerifiedLead: async (input: { eventId: string; email: string; source: string }) => {
      dispatched.push(input);
    },
    ...overrides,
  };
}

function submit(overrides: Record<string, unknown> = {}) {
  return {
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    flags: [] as string[],
    suspect: false,
    measurementConsent: true,
    networkSendBlocked: false,
    ...overrides,
  };
}

beforeEach(() => {
  store = new FakeLeadStore();
  mailer = new FakeMailer();
  dispatched = [];
  clock = new Date("2026-07-30T09:00:00.000Z");
  nextLeadId = leadIdFactory();
});

// ---------------------------------------------------------------------------
// New send
// ---------------------------------------------------------------------------

test("a new claim arms an attempt and sends exactly one confirmation mail", async () => {
  const res = await requestVerificationService(submit(), deps());

  assert.equal(res.status, "pending");
  assert.equal(res.message, GENERIC_PENDING_MESSAGE);
  assert.ok(res.handle);
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, EMAIL);
  assert.equal(mailer.sent[0].publicOrigin, TEST_ORIGIN);

  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.status, "pending");
  assert.equal(row?.emailVerified, false);
  assert.equal(row?.sends, 1);
  assert.equal(row?.leadId, mailer.sent[0].leadId);
  assert.equal(row?.sentAt, clock.toISOString());
  // 24 hours from the submit.
  assert.equal(row?.expiresAt, new Date(clock.getTime() + 86_400_000).toISOString());
});

test("the mailed link carries the token in the fragment and nothing in the query", () => {
  return requestVerificationService(submit(), deps()).then(() => {
    const url = new URL(mailer.lastUrl!);
    assert.equal(url.origin, TEST_ORIGIN);
    assert.equal(url.pathname, "/verify");
    assert.equal(url.search, "");
    assert.match(url.hash, /^#[0-9a-f-]{36}\./i);
    assert.ok(!url.hash.includes("="));
  });
});

test("submitting is not yet a conversion", async () => {
  await requestVerificationService(submit(), deps());
  assert.deepEqual(dispatched, []);
});

test("neither the token nor the address is persisted", async () => {
  await requestVerificationService(submit(), deps());
  const row = await store.findByEmail(CANONICAL, EMAIL);
  const token = mailer.sent[0].token;
  const persisted = JSON.stringify(row);

  assert.ok(!persisted.includes(token), "token reached the CRM row");
  assert.ok(!persisted.includes(token.split(".")[3]), "token signature reached the CRM row");
  assert.ok(!persisted.includes(EMAIL.split("@")[0]) || persisted.includes(EMAIL));
  // Only the opaque attempt id, which is a bare uuid.
  assert.match(row!.leadId, /^[0-9a-f-]{36}$/);
});

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

test("confirming the mailed token verifies the lead and converts once", async () => {
  await requestVerificationService(submit(), deps());
  const token = mailer.sent[0].token;
  clock = new Date(clock.getTime() + 120_000);

  const res = await confirmVerificationService(token, deps());

  assert.equal(res.status, "verified");
  assert.equal(res.refCode, "abcd1234");
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.status, "verified");
  assert.equal(row?.emailVerified, true);
  assert.equal(row?.verifiedAt, clock.toISOString());
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].eventId, row?.metaEventId);
});

test("the Meta event id is derived from the attempt, not the moment", async () => {
  await requestVerificationService(submit(), deps());
  const { token, leadId } = mailer.sent[0];
  const expected = deterministicMetaEventId(leadId, TEST_SECRET);

  await confirmVerificationService(token, deps());
  const row = await store.findByEmail(CANONICAL, EMAIL);

  assert.equal(row?.metaEventId, expected);
  assert.match(expected, /^[a-f0-9]{64}$/);
});

test("a second click on the same link re-states the same conversion, never a new one", async () => {
  await requestVerificationService(submit(), deps());
  const token = mailer.sent[0].token;
  const shared = deterministicMetaEventId(mailer.sent[0].leadId, TEST_SECRET);
  await confirmVerificationService(token, deps());

  clock = new Date(clock.getTime() + 5000);
  const second = await confirmVerificationService(token, deps());

  assert.equal(second.status, "already_verified");
  assert.equal(second.refCode, "abcd1234");
  // The row transitions once.
  assert.equal(store.markVerifiedCalls, 1);
  // The conversion is retried, because the first dispatch may have been the one
  // that failed. Every emission carries the attempt's id, so Meta sees one
  // conversion no matter how many times the link is opened.
  assert.ok(dispatched.length >= 1);
  for (const sent of dispatched) assert.equal(sent.eventId, shared);
  assert.equal(second.browserLead?.eventId, shared);
});

test("a repeated confirmation with consent denied still dispatches nothing", async () => {
  await requestVerificationService(submit({ measurementConsent: false }), deps());
  const token = mailer.sent[0].token;
  await confirmVerificationService(token, deps());
  clock = new Date(clock.getTime() + 5000);
  const second = await confirmVerificationService(token, deps());

  assert.equal(second.status, "already_verified");
  assert.deepEqual(dispatched, []);
  assert.equal(second.browserLead, undefined);
});

test("a repeated confirmation of a flagged lead dispatches nothing", async () => {
  // Reach the verified state without going through the suppressed submit path.
  store.seed({
    email: EMAIL,
    canonical: CANONICAL,
    status: "verified",
    emailVerified: true,
    flags: ["disposable"],
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-0000000000ab",
    verifiedAt: clock.toISOString(),
  });
  const token = createVerificationToken(
    "aaaaaaaa-bbbb-4ccc-8ddd-0000000000ab",
    clock.getTime() + 86_400_000,
    true,
    TEST_SECRET,
  );

  const res = await confirmVerificationService(token, deps());
  assert.equal(res.status, "already_verified");
  assert.deepEqual(dispatched, []);
});

test("concurrent confirmations emit one and the same event id, so Meta dedupes", async () => {
  await requestVerificationService(submit(), deps());
  const token = mailer.sent[0].token;
  const shared = deterministicMetaEventId(mailer.sent[0].leadId, TEST_SECRET);

  // Notion has no compare-and-set, so both racers really can reach dispatch.
  // What makes that safe is that neither can compute a different id.
  const [a, b] = await Promise.all([
    confirmVerificationService(token, deps()),
    confirmVerificationService(token, deps()),
  ]);

  assert.ok([a.status, b.status].every((s) => s === "verified" || s === "already_verified"));
  assert.equal(a.browserLead?.eventId, shared);
  assert.equal(b.browserLead?.eventId, shared);
  for (const sent of dispatched) assert.equal(sent.eventId, shared);
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.metaEventId, shared);
});

// ---------------------------------------------------------------------------
// Resend and invalidation
// ---------------------------------------------------------------------------

test("a resend after the cooldown mints a new attempt and kills the old link", async () => {
  await requestVerificationService(submit(), deps());
  const first = mailer.sent[0];

  clock = new Date(clock.getTime() + 61_000);
  await requestVerificationService(submit(), deps());
  const second = mailer.sent[1];

  assert.notEqual(second.leadId, first.leadId);
  assert.notEqual(second.token, first.token);
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.leadId, second.leadId);
  assert.equal(row?.sends, 2);

  // The superseded link names an attempt id no row carries any more.
  assert.deepEqual(await confirmVerificationService(first.token, deps()), {
    ok: true,
    status: "invalid",
  });
  // The current one still works.
  assert.equal((await confirmVerificationService(second.token, deps())).status, "verified");
});

test("a repeat claim inside the cooldown sends nothing and says the same thing", async () => {
  await requestVerificationService(submit(), deps());
  clock = new Date(clock.getTime() + 30_000);
  const res = await requestVerificationService(submit(), deps());

  assert.equal(res.message, GENERIC_PENDING_MESSAGE);
  assert.equal(mailer.sent.length, 1);
});

test("the send ceiling stops an address being used to mail-bomb somebody", async () => {
  for (let i = 0; i < VERIFICATION_MAX_SENDS + 3; i++) {
    await requestVerificationService(submit(), deps());
    clock = new Date(clock.getTime() + 61_000);
  }
  assert.equal(mailer.sent.length, VERIFICATION_MAX_SENDS);
});

test("the idempotency key follows the attempt, so a resend is a new key", async () => {
  await requestVerificationService(submit(), deps());
  clock = new Date(clock.getTime() + 61_000);
  await requestVerificationService(submit(), deps());

  assert.notEqual(mailer.sent[0].leadId, mailer.sent[1].leadId);
});

// ---------------------------------------------------------------------------
// Expiry and tampering
// ---------------------------------------------------------------------------

test("a link past its 24 hours is refused", async () => {
  await requestVerificationService(submit(), deps());
  const token = mailer.sent[0].token;

  clock = new Date(clock.getTime() + 86_400_000 + 1000);
  assert.deepEqual(await confirmVerificationService(token, deps()), {
    ok: true,
    status: "invalid",
  });
});

test("Notion remains the authority on the attempt window", async () => {
  await requestVerificationService(submit(), deps());
  const token = mailer.sent[0].token;

  // The signed expiry is still in the future, but the row says the attempt is
  // over — for instance because an operator shortened it.
  const row = await store.findByEmail(CANONICAL, EMAIL);
  store.rows.set(row!.pageId, { ...row!, expiresAt: "2026-07-30T09:00:30.000Z" });
  clock = new Date(clock.getTime() + 60_000);

  assert.deepEqual(await confirmVerificationService(token, deps()), {
    ok: true,
    status: "expired",
  });
  assert.equal(store.markVerifiedCalls, 0);
});

test("a tampered token is refused without touching the store", async () => {
  await requestVerificationService(submit(), deps());
  const [leadId, exp, mac] = mailer.sent[0].token.split(".");

  const forgeries = [
    `${leadId}.${exp}.${"A".repeat(mac.length)}`, // forged signature
    `${leadId}.${Number(exp) + 86_400}.${mac}`, // extended expiry
    `aaaaaaaa-bbbb-4ccc-8ddd-000000000099.${exp}.${mac}`, // swapped attempt
    "not-a-token",
    "",
  ];

  for (const forged of forgeries) {
    assert.deepEqual(
      await confirmVerificationService(forged, deps()),
      { ok: true, status: "invalid" },
      `accepted a forged token: ${forged}`,
    );
  }
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.emailVerified, false);
  assert.equal(store.markVerifiedCalls, 0);
});

test("a token signed with another secret is refused", async () => {
  await requestVerificationService(submit(), deps());
  const token = mailer.sent[0].token;

  const otherEnv = { ...TEST_ENV, WATCHDIVE_VERIFICATION_SECRET: "another-secret-at-least-32-b!!" };
  await assert.rejects(() => confirmVerificationService(token, deps({ env: otherEnv })));
});

// ---------------------------------------------------------------------------
// Enumeration safety
// ---------------------------------------------------------------------------

test("an already-confirmed address gets the same response and no new mail", async () => {
  store.seed({
    email: EMAIL,
    canonical: CANONICAL,
    status: "verified",
    emailVerified: true,
    verifiedAt: "2026-07-01T00:00:00.000Z",
  });

  const res = await requestVerificationService(submit(), deps());

  assert.equal(res.status, "pending");
  assert.equal(res.message, GENERIC_PENDING_MESSAGE);
  assert.ok(res.handle);
  assert.equal(mailer.sent.length, 0);
});

test("an unsubscribed address is not re-solicited and is not revealed", async () => {
  store.seed({ email: EMAIL, canonical: CANONICAL, status: "unsubscribed" });

  const res = await requestVerificationService(submit(), deps());
  assert.equal(res.message, GENERIC_PENDING_MESSAGE);
  assert.equal(mailer.sent.length, 0);
});

test("a legacy single opt-in row is left alone", async () => {
  store.seed({ email: EMAIL, canonical: CANONICAL, status: "legacy" });

  const res = await requestVerificationService(submit(), deps());
  assert.equal(res.message, GENERIC_PENDING_MESSAGE);
  assert.equal(mailer.sent.length, 0);
});

test("every skipped path still returns a well-formed handle that reads pending", async () => {
  store.seed({
    email: EMAIL,
    canonical: CANONICAL,
    status: "verified",
    emailVerified: true,
    verifiedAt: "2026-07-01T00:00:00.000Z",
  });

  const res = await requestVerificationService(submit(), deps());
  assert.deepEqual(await pollVerificationService(res.handle, deps()), {
    ok: true,
    status: "pending",
  });
});

test("gmail dots and +tags resolve to one lead", async () => {
  await requestVerificationService(
    submit({ email: "a.b+ks@gmail.com", canonical: canonicalEmail("a.b+ks@gmail.com") }),
    deps(),
  );
  clock = new Date(clock.getTime() + 61_000);
  await requestVerificationService(
    submit({ email: "ab@gmail.com", canonical: canonicalEmail("ab@gmail.com") }),
    deps(),
  );

  assert.equal(store.rows.size, 1);
});

// ---------------------------------------------------------------------------
// Provider failure
// ---------------------------------------------------------------------------

test("a provider failure says nothing and leaves the attempt armed", async () => {
  mailer.fail = true;
  const res = await requestVerificationService(submit(), deps());

  assert.equal(res.status, "pending");
  assert.equal(res.message, GENERIC_PENDING_MESSAGE);

  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.status, "pending");
  assert.equal(row?.sends, 1);
  assert.equal(row?.sentAt, undefined);

  // The cooldown still applies. `Verification sent` is missing either because
  // nothing was sent or because a send succeeded and the write that records it
  // did not — and those are indistinguishable from here, so the fail-safe
  // reading wins. Cost is a delayed resend, never a duplicate message.
  mailer.fail = false;
  clock = new Date(clock.getTime() + 1000);
  await requestVerificationService(submit(), deps());
  assert.equal(mailer.sent.length, 0);

  clock = new Date(clock.getTime() + 61_000);
  await requestVerificationService(submit(), deps());
  assert.equal(mailer.sent.length, 1);
});

test("a send recorded nowhere still cools down, so no second message goes out", async () => {
  // The exact shape of a successful send whose markSent write then failed.
  const armed = store.seed({
    email: EMAIL,
    canonical: CANONICAL,
    status: "pending",
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-0000000000ff",
    expiresAt: new Date(clock.getTime() + 86_400_000).toISOString(),
    sends: 1,
  });
  assert.equal(armed.sentAt, undefined);

  clock = new Date(clock.getTime() + 30_000);
  await requestVerificationService(submit(), deps());
  assert.equal(mailer.sent.length, 0);
});

test("a failed send still counts against the ceiling", async () => {
  mailer.fail = true;
  for (let i = 0; i < VERIFICATION_MAX_SENDS + 2; i++) {
    await requestVerificationService(submit(), deps());
    clock = new Date(clock.getTime() + 61_000);
  }
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.sends, VERIFICATION_MAX_SENDS);
});

// ---------------------------------------------------------------------------
// Poll
// ---------------------------------------------------------------------------

test("the original tab reads pending until the link is confirmed", async () => {
  const res = await requestVerificationService(submit(), deps());
  assert.deepEqual(await pollVerificationService(res.handle, deps()), {
    ok: true,
    status: "pending",
  });

  clock = new Date(clock.getTime() + 120_000);
  await confirmVerificationService(mailer.sent[0].token, deps());

  const polled = await pollVerificationService(res.handle, deps());
  assert.equal(polled.status, "verified");
  assert.equal(polled.refCode, "abcd1234");
  assert.equal(
    polled.browserLead?.eventId,
    deterministicMetaEventId(mailer.sent[0].leadId, TEST_SECRET),
  );
});

test("a poll handle carries no address", async () => {
  const res = await requestVerificationService(submit(), deps());
  assert.ok(!res.handle.includes("diver"));
  assert.ok(!res.handle.includes("example.com"));
  for (const part of res.handle.split(".")) {
    const decoded = Buffer.from(part, "base64url").toString("utf8").toLowerCase();
    assert.ok(!decoded.includes("diver@"), `handle segment leaked an address: ${part}`);
  }
});

test("a tampered or aged handle is refused", async () => {
  const res = await requestVerificationService(submit(), deps());
  const parts = res.handle.split(".");

  assert.deepEqual(
    await pollVerificationService(`${parts[0]}.${parts[1]}.${"A".repeat(parts[2].length)}`, deps()),
    { ok: true, status: "expired" },
  );

  clock = new Date(clock.getTime() + 86_400_000 + 1000);
  assert.deepEqual(await pollVerificationService(res.handle, deps()), {
    ok: true,
    status: "expired",
  });
});

// ---------------------------------------------------------------------------
// Conversion eligibility
// ---------------------------------------------------------------------------

test("an abusive claim is recorded for review but mails nobody", async () => {
  for (const flag of ["honeypot", "disposable", "headless"]) {
    store = new FakeLeadStore();
    mailer = new FakeMailer();
    nextLeadId = leadIdFactory();

    const res = await requestVerificationService(submit({ flags: [flag], suspect: true }), deps());

    // Somebody else's address must never receive mail because a bot typed it.
    assert.equal(mailer.sent.length, 0, `${flag} still produced a message`);
    assert.equal(res.message, GENERIC_PENDING_MESSAGE);
    assert.ok(res.handle);

    // The row still exists for review, unconfirmable because no link was made.
    const row = await store.findByEmail(CANONICAL, EMAIL);
    assert.equal(row?.status, "pending");
    assert.equal(row?.suspect, true);
    assert.deepEqual(await pollVerificationService(res.handle, deps()), {
      ok: true,
      status: "pending",
    });
  }
});

test("a network far past the shared-office threshold stops producing mail", async () => {
  const res = await requestVerificationService(submit({ networkSendBlocked: true }), deps());

  assert.equal(mailer.sent.length, 0);
  assert.equal(res.message, GENERIC_PENDING_MESSAGE);
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.status, "pending");
});

test("a shared-network flag alone still mails and still converts", async () => {
  await requestVerificationService(submit({ flags: ["ip-repeat"], suspect: true }), deps());
  assert.equal(mailer.sent.length, 1);
  clock = new Date(clock.getTime() + 120_000);

  await confirmVerificationService(mailer.sent[0].token, deps());
  assert.equal(dispatched.length, 1);
});

test("the exact live Lead ID column is the one that names an attempt", () => {
  assert.equal(FIELD_LEAD_ID, "Lead ID");
});
