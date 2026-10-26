// Verified-at delay, prospective start, paid state, and the live send gate.
// Fakes only. No Stripe, Resend, Notion, or customer mail.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { reservationSkipReason, selectAudience, type ReservationRow } from "../src/lib/reservation-mail/audience.ts";
import { RESERVATION_CAMPAIGN_ID } from "../src/lib/reservation-mail/campaign.ts";
import { USAGE, parseCli } from "../src/lib/reservation-mail/cli.ts";
import {
  PRODUCTION_ORIGIN,
  PRODUCTION_STRIPE_ACCOUNT,
  assertLiveCustomerSend,
  probeProductionCheckout,
} from "../src/lib/reservation-mail/liveGate.ts";
import {
  RESERVATION_LEGAL_NAME,
  RESERVATION_REGISTERED_OFFICE,
} from "../src/lib/reservation-mail/merchant.ts";
import { runReservationMail, type ReservationMessage } from "../src/lib/reservation-mail/run.ts";
import { delaySkipReason, RESERVATION_INVITE_DELAY_MS } from "../src/lib/reservation-mail/schedule.ts";
import {
  readReservationPayment,
  toReservationRow,
  type ReservationSchema,
  type ReservationStore,
} from "../src/lib/reservation-mail/store.ts";
import { TEST_ENV } from "./helpers/fakes.ts";

const NOW = new Date("2026-10-18T04:00:00.000Z");
const NOT_BEFORE = "2026-10-18T00:00:00.000Z";
const DUE = new Date(NOW.getTime() - RESERVATION_INVITE_DELAY_MS).toISOString();
const TOO_EARLY = new Date(NOW.getTime() - (RESERVATION_INVITE_DELAY_MS - 1)).toISOString();
const TOKEN = "reservation-token-secret-32bytes-min!!";
const LIVE_KEY = "sk_live_unit_test_only_not_a_real_key";
const MAIL_ENV = { ...TEST_ENV, WATCHDIVE_RESERVATION_TOKEN_SECRET: TOKEN };
const SCHEDULE = { nowMs: NOW.getTime(), notBeforeMs: Date.parse(NOT_BEFORE) };

const SCHEMA: ReservationSchema = {
  reservationMail: "ok",
  launchMail: "ok",
  missingRequired: [],
  hasBrowserLanguage: false,
  hasCountryProperty: false,
  hasSmsConsentProperty: false,
  hasPhoneProperty: false,
  verifiedAt: "ok",
  reservationPaid: "missing",
  reservationMode: "missing",
};

const passLiveGate = async () => ({ ok: true as const });

function lead(n: number): string {
  return `aaaaaaaa-bbbb-4ccc-8ddd-${n.toString(16).padStart(12, "0")}`;
}

function row(n: number, overrides: Partial<ReservationRow> = {}): ReservationRow {
  return {
    pageId: `page-${n}`,
    email: `diver-${n}@example.com`,
    leadId: lead(n),
    status: "verified",
    emailVerified: true,
    suspect: false,
    verifiedAt: DUE,
    ...overrides,
  };
}

class MemoryStore implements ReservationStore {
  rows: ReservationRow[];
  fresh = new Map<string, ReservationRow>();
  writes: string[] = [];
  failRead = false;

  constructor(rows: ReservationRow[]) {
    this.rows = rows;
  }

  async readSchema() {
    return { ...SCHEMA };
  }

  async listRows() {
    return this.rows;
  }

  async readRow(pageId: string) {
    if (this.failRead) throw new Error("notion read failed");
    return this.fresh.get(pageId) ?? this.rows.find((item) => item.pageId === pageId);
  }

  async recordReservationMail(pageId: string, value: string) {
    this.writes.push(value);
    const target = this.rows.find((item) => item.pageId === pageId);
    if (target) target.reservationMail = value;
  }
}

class Sink {
  calls: ReservationMessage[] = [];
  send = async (message: ReservationMessage) => {
    this.calls.push(message);
  };
}

async function directory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "reservation-delay-"));
}

function runOptions(receiptDir: string, notBefore: string | null = NOT_BEFORE) {
  return {
    mode: "send" as const,
    postalAddress: RESERVATION_REGISTERED_OFFICE,
    legalName: RESERVATION_LEGAL_NAME,
    receiptDir,
    ratePerSecond: 50,
    ...(typeof notBefore === "string" ? { notBefore } : {}),
  };
}

test("office sender needs no verification key when reservation unsubscribe key is configured", async () => {
  const store = new MemoryStore([row(99)]);
  const sink = new Sink();
  const result = await runReservationMail(runOptions(await directory()), {
    store, send: sink.send, liveGate: passLiveGate, now: () => NOW,
    env: {
      WATCHDIVE_PUBLIC_ORIGIN: PRODUCTION_ORIGIN,
      WATCHDIVE_RESERVATION_TOKEN_SECRET: TOKEN,
      WATCHDIVE_RESERVATION_UNSUBSCRIBE_SECRET: "reservation-unsubscribe-independent-secret-20261019",
    },
  });
  assert.equal(result.aborted, undefined);
  assert.equal(sink.calls.length, 1);
  assert.match(sink.calls[0].headers["List-Unsubscribe"], /\/unsubscribe\/u2\./);
});

test("179999 ms is too early and 180000 ms is eligible", () => {
  const early = row(1, { verifiedAt: TOO_EARLY });
  const due = row(2, { verifiedAt: DUE });
  assert.equal(Date.parse(TOO_EARLY) - Date.parse(DUE), 1);
  assert.equal(delaySkipReason(early, SCHEDULE), "not_due");
  assert.equal(delaySkipReason(due, SCHEDULE), undefined);
  assert.equal(NOW.getTime() - Date.parse(TOO_EARLY), 179_999);
  assert.equal(NOW.getTime() - Date.parse(DUE), 180_000);
  const audience = selectAudience([early, due], { schedule: SCHEDULE });
  assert.equal(audience.recipients.length, 1);
  assert.equal(audience.recipients[0]?.row.leadId, due.leadId);
  assert.equal(audience.skipped.not_due, 1);
});

test("a missing or unusable Verified at fails closed, and Signed up is ignored", () => {
  assert.equal(delaySkipReason(row(1, { verifiedAt: undefined }), SCHEDULE), "missing_verified_at");
  assert.equal(delaySkipReason(row(1, { verifiedAt: "2026-10-18" }), SCHEDULE), "invalid_verified_at");
  assert.equal(
    delaySkipReason(row(1, { verifiedAt: "2026-10-18T03:00:00" }), SCHEDULE),
    "invalid_verified_at",
  );
  assert.equal(delaySkipReason(row(1, { verifiedAt: "not-a-date" }), SCHEDULE), "invalid_verified_at");
  const page = toReservationRow({
    id: "page-signed-up",
    properties: {
      Email: { title: [{ plain_text: "signed@example.com" }] },
      "Lead ID": { rich_text: [{ plain_text: lead(9) }] },
      "Verification status": { select: { name: "verified" } },
      "Email verified": { checkbox: true },
      "Signed up": { date: { start: "2020-01-01T00:00:00.000Z" } },
    },
  });
  assert.equal(page?.verifiedAt, undefined);
  assert.equal(delaySkipReason(page ?? row(9), SCHEDULE), "missing_verified_at");
  const dated = toReservationRow({
    id: "page-dated",
    properties: {
      Email: { title: [{ plain_text: "dated@example.com" }] },
      "Verified at": { date: { start: "2026-10-18" } },
    },
  });
  assert.equal(dated?.verifiedAt, "2026-10-18");
});

test("a historic Verified at stays out even when it is older than three minutes", () => {
  const historic = row(1, { verifiedAt: "2026-10-17T12:00:00.000Z" });
  assert.equal(delaySkipReason(historic, SCHEDULE), "before_cutoff");
  assert.equal(
    delaySkipReason(historic, { nowMs: NOW.getTime() }),
    "cutoff_unconfigured",
  );
  const exact = row(2, { verifiedAt: NOT_BEFORE });
  assert.equal(
    delaySkipReason(exact, { nowMs: Date.parse(NOT_BEFORE) + RESERVATION_INVITE_DELAY_MS, notBeforeMs: Date.parse(NOT_BEFORE) }),
    undefined,
  );
});

test("live paid suppresses the inbox and test paid does not", () => {
  const live = row(1, { email: "a.b.c@gmail.com", payment: "live" });
  const alias = row(2, { email: "abc@googlemail.com", payment: "absent" });
  const held = selectAudience([live, alias], { schedule: SCHEDULE });
  assert.equal(held.recipients.length, 0);
  assert.equal(held.skipped.paid_live, 1);
  assert.equal(held.skipped.paid_live_address, 1);

  const testPaid = row(3, { email: "a.b.c@gmail.com", payment: "test" });
  const other = row(4, { email: "abc@googlemail.com" });
  const allowed = selectAudience([testPaid, other], { schedule: SCHEDULE });
  assert.equal(allowed.recipients.length, 1);
  assert.equal(allowed.skipped.paid_live, undefined);

  assert.equal(reservationSkipReason(row(5, { payment: "unreadable" })), "paid_unreadable");
  const unreadable = row(7, { email: "diver@example.com", payment: "unreadable" });
  const readable = row(8, { email: "diver@example.com", payment: "absent" });
  const notPoisoned = selectAudience([unreadable, readable], { schedule: SCHEDULE });
  assert.equal(notPoisoned.recipients.length, 1);
  assert.equal(notPoisoned.recipients[0]?.row.leadId, readable.leadId);
  assert.equal(notPoisoned.skipped.paid_unreadable, 1);
  assert.equal(reservationSkipReason(row(6, { status: "suppressed" })), "suppressed");
  assert.equal(
    readReservationPayment({
      "Reservation paid": { checkbox: true },
      "Reservation mode": { select: { name: "test" } },
      "Reservation status": { select: { name: "paid" } },
    }),
    "test",
  );
  assert.equal(
    readReservationPayment({
      "Reservation paid": { checkbox: true },
      "Reservation mode": { select: { name: "live" } },
    }),
    "live",
  );
  assert.equal(
    readReservationPayment({
      "Reservation paid": { checkbox: false },
      "Reservation mode": { select: { name: "live" } },
    }),
    "unpaid",
  );
  assert.equal(
    readReservationPayment({
      "Reservation paid": { checkbox: true },
    }),
    "unreadable",
  );
  assert.equal(readReservationPayment({}), "absent");
  assert.equal(
    readReservationPayment({
      "Reservation paid": { rich_text: [{ plain_text: "true" }] },
    }),
    "unreadable",
  );
});

async function sendOne(
  person: ReservationRow,
  fresh?: ReservationRow,
  notBefore: string | null = NOT_BEFORE,
) {
  const dir = await directory();
  const store = new MemoryStore([person]);
  if (fresh) store.fresh.set(person.pageId, fresh);
  const sink = new Sink();
  const result = await runReservationMail(runOptions(dir, notBefore), {
    store,
    send: sink.send,
    env: MAIL_ENV,
    now: () => NOW,
    sleep: async () => undefined,
    liveGate: passLiveGate,
    signInvite: () => "signed-invite-token-ok",
  });
  return { dir, store, sink, result };
}

test("a send at 180000 ms is delivered once, and 179999 ms is not", async () => {
  const due = await sendOne(row(1, { verifiedAt: DUE }));
  assert.equal(due.result.sent, 1);
  assert.equal(due.sink.calls.length, 1);
  const again = await runReservationMail(runOptions(due.dir), {
    store: due.store,
    send: due.sink.send,
    env: MAIL_ENV,
    now: () => NOW,
    sleep: async () => undefined,
    liveGate: passLiveGate,
    signInvite: () => "signed-invite-token-ok",
  });
  assert.equal(again.sent, 0);
  assert.equal(due.sink.calls.length, 1);
  assert.equal(again.skipped.already_sent, 1);

  const early = await sendOne(row(2, { verifiedAt: TOO_EARLY }));
  assert.equal(early.result.sent, 0);
  assert.equal(early.sink.calls.length, 0);
  assert.equal(early.result.skipped.not_due, 1);
  const earlyLedger = await readFile(join(early.dir, `${RESERVATION_CAMPAIGN_ID}.jsonl`), "utf8").catch(
    () => "",
  );
  assert.equal(earlyLedger.includes("\"state\""), false);
});

test("missing timestamp, historic cutoff, and suppression do not send", async () => {
  const missing = await sendOne(row(1, { verifiedAt: undefined }));
  assert.equal(missing.result.sent, 0);
  assert.equal(missing.result.skipped.missing_verified_at, 1);

  const historic = await sendOne(row(2, { verifiedAt: "2026-10-17T00:00:00.000Z" }));
  assert.equal(historic.result.sent, 0);
  assert.equal(historic.result.skipped.before_cutoff, 1);

  const suppressed = await sendOne(row(3, { status: "suppressed" }));
  assert.equal(suppressed.result.sent, 0);
  assert.equal(suppressed.result.skipped.suppressed, 1);

  const open = row(4);
  const closed = { ...open, status: "suppressed" };
  const raced = await sendOne(open, closed);
  assert.equal(raced.result.sent, 0);
  assert.equal(raced.sink.calls.length, 0);
  assert.equal(raced.result.recheckSkipped, 1);
  assert.equal(raced.store.writes.length, 0);
});

test("send-time live paid is held and send-time test paid is delivered", async () => {
  const person = row(1, { payment: "absent" });
  const live = await sendOne(person, { ...person, payment: "live" });
  assert.equal(live.result.sent, 0);
  assert.equal(live.sink.calls.length, 0);
  assert.equal(live.result.recheckSkipped, 1);

  const testPaid = await sendOne(row(2), { ...row(2), payment: "test" });
  assert.equal(testPaid.result.sent, 1);
  assert.equal(testPaid.sink.calls.length, 1);

  const planned = await sendOne(row(3, { payment: "live" }));
  assert.equal(planned.result.sent, 0);
  assert.equal(planned.result.skipped.paid_live, 1);
});

test("a send without the prospective start refuses and does not probe", async () => {
  let probed = false;
  const dir = await directory();
  const result = await runReservationMail(runOptions(dir, null), {
    store: new MemoryStore([row(1)]),
    send: async () => {
      throw new Error("should not send");
    },
    env: MAIL_ENV,
    now: () => NOW,
    sleep: async () => undefined,
    liveGate: async () => {
      probed = true;
      return { ok: true };
    },
    signInvite: () => "signed-invite-token-ok",
  });
  assert.equal(probed, false);
  assert.equal(result.aborted, "prospective_start_missing");
  assert.equal(result.sent, 0);
});

test("the live gate refuses test keys, QA origins, and a failed probe", async () => {
  const token = TOKEN;
  const base = {
    WATCHDIVE_RESERVATION_ENABLED: "true",
    WATCHDIVE_RESERVATION_ALLOW_LIVE: "true",
    WATCHDIVE_RESERVATION_TOKEN_SECRET: token,
    WATCHDIVE_PUBLIC_ORIGIN: PRODUCTION_ORIGIN,
    STRIPE_SECRET_KEY: LIVE_KEY,
  };
  let calls = 0;
  const probe = async () => {
    calls += 1;
    return {
      ok: true as const,
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_probe",
      accountId: PRODUCTION_STRIPE_ACCOUNT,
    };
  };
  const ready = await assertLiveCustomerSend(base, probe);
  assert.equal(ready.ok, true);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(ready).includes("sk_"), false);

  calls = 0;
  const testKey = await assertLiveCustomerSend(
    { ...base, STRIPE_SECRET_KEY: "sk_test_unit_test_only_not_a_real_key" },
    probe,
  );
  assert.equal(testKey.ok, false);
  assert.equal(calls, 0);

  const disabled = await assertLiveCustomerSend(
    { ...base, WATCHDIVE_RESERVATION_ENABLED: "false" },
    probe,
  );
  assert.equal(disabled.ok, false);
  assert.equal(calls, 0);

  for (const origin of [
    "https://localhost",
    "https://127.0.0.1",
    "https://watchdive-preview.vercel.app",
    "https://preview.watchdive.diveroid.com",
    "https://qa.watchdive.diveroid.com",
    "http://watchdive.diveroid.com",
  ]) {
    const refused = await assertLiveCustomerSend(
      { ...base, WATCHDIVE_PUBLIC_ORIGIN: origin },
      probe,
    );
    assert.equal(refused.ok, false, origin);
  }
  assert.equal(calls, 0);

  const badHost = await assertLiveCustomerSend(base, async () => ({
    ok: true,
    checkoutUrl: "https://checkout.stripe.com.evil.example/pay",
    accountId: PRODUCTION_STRIPE_ACCOUNT,
  }));
  assert.equal(badHost.ok, false);
  const qaLink = await assertLiveCustomerSend(base, async () => ({
    ok: true,
    checkoutUrl: "https://qa.example.com/checkout",
    accountId: PRODUCTION_STRIPE_ACCOUNT,
  }));
  assert.equal(qaLink.ok, false);
  const down = await assertLiveCustomerSend(base, async () => ({ ok: false, reason: "stripe_account_unreachable" }));
  assert.equal(down.ok, false);
  if (!down.ok) assert.equal(down.problem.includes(LIVE_KEY), false);
});

test("the read-only probe GETs the account and the Checkout host and does not create a session", async () => {
  const calls: { method: string; url: string; authorized: boolean }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? "GET",
      url: String(url),
      authorized: headers.has("Authorization"),
    });
    if (String(url).endsWith("/v1/account")) {
      return new Response(
        JSON.stringify({
          id: PRODUCTION_STRIPE_ACCOUNT,
          charges_enabled: true,
          details_submitted: true,
        }),
        { status: 200 },
      );
    }
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  const result = await probeProductionCheckout({ secretKey: LIVE_KEY, origin: PRODUCTION_ORIGIN }, fetchImpl);
  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.method, call.url, call.authorized]),
    [
      ["GET", "https://api.stripe.com/v1/account", true],
      ["GET", "https://checkout.stripe.com/", false],
    ],
  );
  assert.equal(calls.some((call) => call.url.includes("/v1/checkout/sessions")), false);
  assert.equal(JSON.stringify(result).includes(LIVE_KEY), false);

  const mismatchCalls: string[] = [];
  const mismatchFetch = (async (url: string | URL) => {
    mismatchCalls.push(String(url));
    return new Response(JSON.stringify({ id: "acct_other", charges_enabled: true, details_submitted: true }), {
      status: 200,
    });
  }) as typeof fetch;
  const mismatch = await probeProductionCheckout(
    { secretKey: LIVE_KEY, origin: PRODUCTION_ORIGIN },
    mismatchFetch,
  );
  assert.equal(mismatch.ok, false);
  assert.deepEqual(mismatchCalls, ["https://api.stripe.com/v1/account"]);
  assert.equal(JSON.stringify(mismatch).includes(LIVE_KEY), false);
});

test("CLI help no longer claims Stripe is unread, and a bad prospective start is refused", () => {
  assert.equal(USAGE.includes("are not read"), false);
  assert.match(USAGE, /WATCHDIVE_RESERVATION_ENABLED/);
  assert.match(USAGE, /Verified at/);
  assert.match(USAGE, /issueReservationInvite/);
  assert.match(USAGE, /signed invite query parameter/);
  assert.match(USAGE, /redact invite query values from access logs/);
  const bad = parseCli(["--not-before", "2026-10-18"]);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error.includes("2026-10-18"), false);
  const good = parseCli(["--not-before", NOT_BEFORE]);
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.options.notBefore, NOT_BEFORE);
  const fromEnv = parseCli([], { WATCHDIVE_RESERVATION_MAIL_NOT_BEFORE: NOT_BEFORE });
  assert.equal(fromEnv.ok && fromEnv.options.notBefore, NOT_BEFORE);
});


test("a reservation paid before verification stays excluded after verification becomes due", async () => {
  const pending = row(44, { status: "pending", emailVerified: false, payment: "live" });
  assert.equal(reservationSkipReason(pending), "paid_live");
  const verified = { ...pending, status: "verified", emailVerified: true, verifiedAt: DUE };
  const audience = selectAudience([verified], { schedule: SCHEDULE });
  assert.equal(audience.recipients.length, 0);
  assert.equal(audience.skipped.paid_live, 1);
  const send = await sendOne(verified);
  assert.equal(send.result.sent, 0);
  assert.equal(send.sink.calls.length, 0);
});
