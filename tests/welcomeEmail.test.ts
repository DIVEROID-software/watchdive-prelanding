// The welcome mail: one invite link, handed to the provider at confirmation
// time with a 24-hour hold, exactly once per lead.
import assert from "node:assert/strict";
import { test } from "node:test";

import { WELCOME_DELAY_MS } from "../src/lib/verification/contracts.ts";
import { referralUrl } from "../src/lib/verification/resend.ts";
import { confirmVerificationService } from "../src/lib/verification/service.ts";
import { createVerificationToken } from "../src/lib/verification/token.ts";
import { FakeLeadStore, FakeMailer, TEST_ENV, TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";

const LEAD_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const CONFIRMED_AT = new Date("2026-08-01T00:00:00.000Z");

function confirmable(overrides: Record<string, unknown> = {}) {
  const store = new FakeLeadStore();
  store.seed({
    email: "diver@example.com",
    canonical: "diver@example.com",
    status: "pending",
    refCode: "abc12345",
    leadId: LEAD_ID,
    expiresAt: new Date(CONFIRMED_AT.getTime() + 60_000).toISOString(),
    ...overrides,
  });
  const mailer = new FakeMailer();
  const token = createVerificationToken(
    LEAD_ID,
    CONFIRMED_AT.getTime() + 60_000,
    false,
    TEST_SECRET,
  );
  const deps = { store, mailer, env: TEST_ENV, now: () => CONFIRMED_AT };
  return { store, mailer, token, deps };
}

test("confirming schedules one welcome mail 24 hours out", async () => {
  const { store, mailer, token, deps } = confirmable();

  const result = await confirmVerificationService(token, deps);
  assert.equal(result.status, "verified");

  assert.equal(mailer.welcomes.length, 1);
  const welcome = mailer.welcomes[0]!;
  assert.equal(welcome.to, "diver@example.com");
  assert.equal(welcome.refCode, "abc12345");
  assert.equal(
    welcome.scheduledAt,
    new Date(CONFIRMED_AT.getTime() + WELCOME_DELAY_MS).toISOString(),
  );

  // The hand-off is recorded, so a later click does not queue a second one.
  assert.equal(store.markWelcomeCalls, 1);
});

test("a second click of the same link does not queue a second welcome mail", async () => {
  const { mailer, token, deps } = confirmable();

  await confirmVerificationService(token, deps);
  const repeat = await confirmVerificationService(token, deps);

  assert.equal(repeat.status, "already_verified");
  assert.equal(mailer.welcomes.length, 1);
});

test("a lead already carrying a welcome timestamp is never re-queued", async () => {
  const { mailer, token, deps } = confirmable({
    welcomeAt: "2026-07-31T00:00:00.000Z",
  });

  await confirmVerificationService(token, deps);

  assert.equal(mailer.welcomes.length, 0);
});

test("a failed hand-off leaves the confirmation intact and retries on the next click", async () => {
  const { store, mailer, token, deps } = confirmable();
  mailer.failWelcome = true;

  const first = await confirmVerificationService(token, deps);
  // The address is confirmed even though the welcome mail never went out.
  assert.equal(first.status, "verified");
  assert.equal(mailer.welcomes.length, 0);
  assert.equal(store.markWelcomeCalls, 0);

  mailer.failWelcome = false;
  const second = await confirmVerificationService(token, deps);
  assert.equal(second.status, "already_verified");
  assert.equal(mailer.welcomes.length, 1);
});

test("an abuse-flagged lead gets no invite link", async () => {
  const { mailer, token, deps } = confirmable({ flags: ["disposable"], suspect: true });

  await confirmVerificationService(token, deps);

  assert.equal(mailer.welcomes.length, 0);
});

// The same transfer encoding that destroyed the confirmation token eats `=`
// followed by two hex digits. A ref code is eight `[a-z0-9]` characters, so a
// `?ref=` link would arrive mangled for roughly one code in five.
test("the invite link carries the code as a path, with no `=` to lose", () => {
  const url = referralUrl(TEST_ORIGIN, "2ab45678");
  assert.equal(url, `${TEST_ORIGIN}/r/2ab45678`);
  assert.ok(!url.includes("="));

  const decoded = url.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  assert.equal(decoded, url);
});

test("the invite link refuses a code that is not eight lowercase alphanumerics", () => {
  assert.throws(() => referralUrl(TEST_ORIGIN, "short"));
  assert.throws(() => referralUrl(TEST_ORIGIN, "UPPER123"));
  assert.throws(() => referralUrl(TEST_ORIGIN, "../../etc"));
});
