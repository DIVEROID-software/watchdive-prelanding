import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import {
  GENERIC_PENDING_MESSAGE,
  VERIFICATION_TTL_MS,
} from "../src/lib/verification/contracts.ts";
import { deliverQueuedVerificationMail } from "../src/lib/verification/asyncVerificationMail.ts";
import { createVercelAfterResponse } from "../src/lib/verification/asyncVerificationMail.server.ts";
import { waitUntil } from "@vercel/functions";
import {
  createResendMailer,
  verificationBackoffMs,
  VERIFICATION_RETRY_CAP_MS,
} from "../src/lib/verification/resend.ts";
import {
  confirmVerificationService,
  requestVerificationService,
} from "../src/lib/verification/service.ts";
import { createVerificationToken } from "../src/lib/verification/token.ts";
import { FakeLeadStore, FakeMailer, leadIdFactory, TEST_ENV, TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";

const EMAIL = "diver@example.com";
const CANONICAL = canonicalEmail(EMAIL);
const LEAD_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const ENV = {
  RESEND_API_KEY: "re_test_key",
  WATCHDIVE_EMAIL_FROM: "WatchDive <hello@watchdive.example>",
  WATCHDIVE_EMAIL_REPLY_TO: "help@watchdive.example",
};

function submit(overrides: Record<string, unknown> = {}) {
  return {
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    flags: [] as string[],
    suspect: false,
    measurementConsent: true,
    networkSendBlocked: false,
    locale: "en" as const,
    ...overrides,
  };
}

function deps(store: FakeLeadStore, mailer: FakeMailer, overrides: Record<string, unknown> = {}) {
  return {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: nextLeadId,
    refCode: () => "abcd1234",
    sleep: async () => {},
    ...overrides,
  };
}

let clock = new Date("2026-07-30T09:00:00.000Z");
let nextLeadId = leadIdFactory();

test("verification backoff is bounded, exponential, and jittered", () => {
  assert.equal(verificationBackoffMs(1, 0), 200);
  assert.equal(verificationBackoffMs(2, 0), 400);
  assert.equal(verificationBackoffMs(1, 0.5), 300);
  assert.equal(verificationBackoffMs(2, 0.5), 500);
  assert.equal(verificationBackoffMs(8, 0.99), VERIFICATION_RETRY_CAP_MS);
  assert.throws(() => verificationBackoffMs(0, 0), /Invalid retry attempt/);
  assert.equal(verificationBackoffMs(1, Number.NaN), 200);
});

test("a transient verification fault waits with jitter and keeps one idempotency key", async () => {
  const sleeps: number[] = [];
  const bodies: string[] = [];
  const keys: string[] = [];
  const responses = [{ status: 503 }, { status: 429 }, { status: 200, body: { id: "msg_ok" } }];
  const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
    keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
    bodies.push(String(init.body));
    const next = responses.shift() ?? { status: 500 };
    return new Response(JSON.stringify("body" in next ? next.body : {}), { status: next.status });
  }) as typeof fetch;
  const token = createVerificationToken(LEAD_ID, clock.getTime() + VERIFICATION_TTL_MS, true, TEST_SECRET, "en");
  await createResendMailer(ENV, fetchImpl, async (ms) => void sleeps.push(ms), { random: () => 0.5 }).send({
    to: EMAIL,
    token,
    leadId: LEAD_ID,
    publicOrigin: TEST_ORIGIN,
    locale: "en",
  });
  assert.deepEqual(sleeps, [verificationBackoffMs(1, 0.5), verificationBackoffMs(2, 0.5)]);
  assert.equal(keys.length, 3);
  assert.equal(new Set(keys).size, 1);
  assert.equal(keys[0], `watchdive-verification-${LEAD_ID}`);
  assert.equal(new Set(bodies).size, 1);
});

test("welcome retries stay on the historical linear delay", async () => {
  const sleeps: number[] = [];
  const responses = [{ status: 500 }, { status: 200, body: { id: "msg_welcome" } }];
  const fetchImpl = (async () => {
    const next = responses.shift() ?? { status: 500 };
    return new Response(JSON.stringify("body" in next ? next.body : {}), { status: next.status });
  }) as typeof fetch;
  await createResendMailer(ENV, fetchImpl, async (ms) => void sleeps.push(ms), { random: () => 0.9 }).sendWelcome({
    to: EMAIL,
    refCode: "abcd1234",
    leadId: LEAD_ID,
    publicOrigin: TEST_ORIGIN,
    scheduledAt: new Date(clock.getTime() + 86_400_000).toISOString(),
    locale: "en",
  });
  assert.deepEqual(sleeps, [200]);
});

test("a hung provider is aborted and does not grow past three attempts", { timeout: 2_000 }, async () => {
  let aborted = 0;
  const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
    await new Promise((_, reject) => {
      const signal = init.signal;
      if (!signal) {
        reject(new Error("missing abort"));
        return;
      }
      const fail = () => {
        aborted += 1;
        reject(signal.reason ?? new Error("aborted"));
      };
      if (signal.aborted) {
        fail();
        return;
      }
      signal.addEventListener("abort", fail, { once: true });
    });
  }) as typeof fetch;
  const token = createVerificationToken(LEAD_ID, clock.getTime() + VERIFICATION_TTL_MS, false, TEST_SECRET, "en");
  // AbortSignal.timeout does not keep the event loop alive by itself.
  const keepAlive = setInterval(() => {}, 1_000);
  const log = mock.method(console, "error", () => {});
  const started = performance.now();
  try {
    await assert.rejects(() =>
      createResendMailer(ENV, fetchImpl, async () => {}, { requestTimeoutMs: 25, random: () => 0 }).send({
        to: EMAIL,
        token,
        leadId: LEAD_ID,
        publicOrigin: TEST_ORIGIN,
        locale: "en",
      }),
    );
    const elapsed = performance.now() - started;
    assert.equal(aborted, 3);
    assert.ok(elapsed < 1_000, `provider abort loop took ${elapsed}ms`);
    const printed = JSON.stringify(log.mock.calls.map((call) => call.arguments));
    assert.equal(printed.includes(EMAIL), false);
    assert.equal(printed.includes(token), false);
    assert.equal(printed.includes("re_test_key"), false);
    assert.match(printed, /verification_mail_attempt/);
    assert.match(printed, /email_delivery_failed/);
  } finally {
    clearInterval(keepAlive);
    log.mock.restore();
  }
});

test("a delayed provider does not block the pending response", async (t) => {
  clock = new Date("2026-07-30T09:00:00.000Z");
  nextLeadId = leadIdFactory();
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = mailer.send.bind(mailer);
  mailer.send = async (input) => {
    await gate;
    await original(input);
  };
  const tasks: Promise<unknown>[] = [];
  const started = performance.now();
  const res = await requestVerificationService(
    submit(),
    deps(store, mailer, {
      scheduleAfterResponse(task: Promise<unknown>) {
        tasks.push(task);
      },
    }),
  );
  const elapsed = performance.now() - started;
  t.diagnostic(`queued response ${elapsed.toFixed(1)}ms while the provider is still held`);
  assert.equal(res.status, "pending");
  assert.equal(res.message, GENERIC_PENDING_MESSAGE);
  assert.equal("sent" in res, false);
  assert.equal("verified" in res, false);
  assert.equal(mailer.sent.length, 0);
  assert.equal(store.markSentCalls, 0);
  assert.equal(tasks.length, 1);
  assert.ok(elapsed < 200, `response waited ${elapsed.toFixed(1)}ms`);
  release();
  await tasks[0];
  assert.equal(mailer.sent.length, 1);
  assert.equal(store.markSentCalls, 1);
  const saved = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(saved?.sentAt, clock.toISOString());
  assert.equal((await confirmVerificationService(mailer.sent[0]!.token, deps(store, mailer))).status, "verified");
});

test("a second submit inside the cooldown does not schedule another mail", async () => {
  clock = new Date("2026-07-30T09:00:00.000Z");
  nextLeadId = leadIdFactory();
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const tasks: Promise<unknown>[] = [];
  const hook = (task: Promise<unknown>) => void tasks.push(task);
  const first = await requestVerificationService(submit(), deps(store, mailer, { scheduleAfterResponse: hook }));
  clock = new Date(clock.getTime() + 30_000);
  const second = await requestVerificationService(submit(), deps(store, mailer, { scheduleAfterResponse: hook }));
  await Promise.all(tasks);
  assert.equal(first.status, "pending");
  assert.equal(second.status, "pending");
  assert.equal(second.message, first.message);
  assert.equal(tasks.length, 1);
  assert.equal(mailer.sent.length, 1);
});

test("provider failure is reported after the response and leaves the attempt unsent", async (t) => {
  clock = new Date("2026-07-30T09:00:00.000Z");
  nextLeadId = leadIdFactory();
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mailer.send = async () => {
    await gate;
    throw new Error(`Resend delivery failed for ${EMAIL} token=secret-token-value`);
  };
  const failures: unknown[] = [];
  const tasks: Promise<unknown>[] = [];
  const log = mock.method(console, "error", () => {});
  try {
    const res = await requestVerificationService(
      submit(),
      deps(store, mailer, {
        scheduleAfterResponse(task: Promise<unknown>) {
          tasks.push(task);
        },
        onDeliveryFailure: async (error: unknown) => void failures.push(error),
      }),
    );
    assert.equal(res.status, "pending");
    assert.equal(failures.length, 0);
    assert.equal(store.markSentCalls, 0);
    release();
    await tasks[0];
    assert.equal(failures.length, 1);
    assert.equal(store.markSentCalls, 0);
    const saved = await store.findByEmail(CANONICAL, EMAIL);
    assert.equal(saved?.sentAt, undefined);
    assert.ok((saved?.sends ?? 0) >= 1);
    const printed = JSON.stringify(log.mock.calls.map((call) => call.arguments));
    assert.equal(printed.includes(EMAIL), false);
    assert.equal(printed.includes("secret-token-value"), false);
    assert.match(printed, /provider_rejected/);
    t.diagnostic("terminal provider failure stayed off the response and out of the log");
  } finally {
    log.mock.restore();
  }
});

test("a rejected provider body is terminal, idempotent, and absent from the log", async () => {
  const store = new FakeLeadStore();
  const page = await store.createPending({
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    refCode: "abcd1234",
    flags: [],
    suspect: false,
    signedUpAt: clock.toISOString(),
    leadId: LEAD_ID,
    expiresAt: new Date(clock.getTime() + VERIFICATION_TTL_MS).toISOString(),
  });
  const token = createVerificationToken(LEAD_ID, clock.getTime() + VERIFICATION_TTL_MS, true, TEST_SECRET, "en");
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ message: `${EMAIL} is invalid`, token }), { status: 422 });
  }) as typeof fetch;
  const mailer = createResendMailer(ENV, fetchImpl, async () => {}, { random: () => 0 });
  const log = mock.method(console, "error", () => {});
  const failures: unknown[] = [];
  try {
    const outcome = await deliverQueuedVerificationMail({
      store,
      mailer,
      pageId: page.pageId,
      leadId: LEAD_ID,
      mail: { to: EMAIL, token, leadId: LEAD_ID, publicOrigin: TEST_ORIGIN, locale: "en" },
      now: () => clock,
      sleep: async () => {},
      random: () => 0,
      onDeliveryFailure: (error) => void failures.push(error),
    });
    assert.equal(outcome, "provider_rejected");
    assert.equal(calls, 1);
    assert.equal(failures.length, 1);
    assert.equal(store.markSentCalls, 0);
    const printed = JSON.stringify(log.mock.calls.map((call) => call.arguments));
    assert.equal(printed.includes(EMAIL), false);
    assert.equal(printed.includes(token), false);
    assert.equal(printed.includes("re_test_key"), false);
    assert.equal(printed.includes("is invalid"), false);
  } finally {
    log.mock.restore();
  }
});

test("two deliveries of one armed attempt share the provider idempotency key and body", async () => {
  const store = new FakeLeadStore();
  const page = await store.createPending({
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    refCode: "abcd1234",
    flags: [],
    suspect: false,
    signedUpAt: clock.toISOString(),
    leadId: LEAD_ID,
    expiresAt: new Date(clock.getTime() + VERIFICATION_TTL_MS).toISOString(),
  });
  const token = createVerificationToken(LEAD_ID, Date.parse(page.expiresAt!), true, TEST_SECRET, "en");
  const keys: string[] = [];
  const bodies: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
    keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
    bodies.push(String(init.body));
    return new Response(JSON.stringify({ id: "msg_same" }), { status: 200 });
  }) as typeof fetch;
  const mailer = createResendMailer(ENV, fetchImpl, async () => {}, { random: () => 0 });
  store.markSent = async () => {
    throw new Error("Notion request failed (502)");
  };
  const mail = { to: EMAIL, token, leadId: LEAD_ID, publicOrigin: TEST_ORIGIN, locale: "en" as const };
  const first = await deliverQueuedVerificationMail({
    store,
    mailer,
    pageId: page.pageId,
    leadId: LEAD_ID,
    mail,
    now: () => clock,
    sleep: async () => {},
  });
  const second = await deliverQueuedVerificationMail({
    store,
    mailer,
    pageId: page.pageId,
    leadId: LEAD_ID,
    mail,
    now: () => clock,
    sleep: async () => {},
  });
  assert.equal(first, "accepted_unrecorded");
  assert.equal(second, "accepted_unrecorded");
  assert.deepEqual(keys, [`watchdive-verification-${LEAD_ID}`, `watchdive-verification-${LEAD_ID}`]);
  assert.equal(bodies[0], bodies[1]);
});

test("a dropped background task leaves the attempt recoverable by a later submit", async () => {
  clock = new Date("2026-07-30T09:00:00.000Z");
  nextLeadId = leadIdFactory();
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const original = mailer.send.bind(mailer);
  mailer.send = async (input) => {
    calls += 1;
    if (calls === 1) await gate;
    await original(input);
  };
  const tasks: Promise<unknown>[] = [];
  const hook = (task: Promise<unknown>) => void tasks.push(task);
  const first = await requestVerificationService(submit(), deps(store, mailer, { scheduleAfterResponse: hook }));
  const armed = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(armed?.sentAt, undefined);
  assert.equal(mailer.sent.length, 0);
  assert.equal(first.status, "pending");

  clock = new Date(clock.getTime() + 61_000);
  const second = await requestVerificationService(submit(), deps(store, mailer, { scheduleAfterResponse: hook }));
  assert.equal(second.status, "pending");
  const current = await store.findByEmail(CANONICAL, EMAIL);
  assert.notEqual(current?.leadId, armed?.leadId);
  assert.equal(tasks.length, 2);
  // The response does not wait for the new attempt's provider call. The
  // scheduled task does, and it is the recovery for the dropped first send.
  await tasks[1];
  assert.equal(mailer.sent.filter((message) => message.leadId === current?.leadId).length, 1);
  const mailed = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(mailed?.leadId, current?.leadId);
  assert.equal(mailed?.sentAt, clock.toISOString());
  assert.equal(store.markSentCalls, 1);

  release();
  await tasks[0];
  const after = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(after?.leadId, current?.leadId);
  assert.equal(after?.sentAt, mailed?.sentAt);
  assert.equal(store.markSentCalls, 1);
  const stale = mailer.sent.find((message) => message.leadId === armed?.leadId);
  const live = mailer.sent.find((message) => message.leadId === current?.leadId);
  assert.ok(stale && live);
  assert.equal((await confirmVerificationService(stale.token, deps(store, mailer))).status, "invalid");
  assert.equal((await confirmVerificationService(live.token, deps(store, mailer))).status, "verified");
});

test("a hook that throws is awaited and still sends once", async () => {
  clock = new Date("2026-07-30T09:00:00.000Z");
  nextLeadId = leadIdFactory();
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const res = await requestVerificationService(
    submit(),
    deps(store, mailer, {
      scheduleAfterResponse() {
        throw new Error("platform rejected background work");
      },
    }),
  );
  assert.equal(res.status, "pending");
  assert.equal(mailer.sent.length, 1);
  assert.equal(store.markSentCalls, 1);
});

test("an unreadable row is retried and then left unsent", async () => {
  const store = new FakeLeadStore();
  const page = await store.createPending({
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    refCode: "abcd1234",
    flags: [],
    suspect: false,
    signedUpAt: clock.toISOString(),
    leadId: LEAD_ID,
    expiresAt: new Date(clock.getTime() + VERIFICATION_TTL_MS).toISOString(),
  });
  let reads = 0;
  store.reread = async () => {
    reads += 1;
    throw new Error(`notion down for ${EMAIL}`);
  };
  const mailer = new FakeMailer();
  const sleeps: number[] = [];
  const log = mock.method(console, "error", () => {});
  try {
    const outcome = await deliverQueuedVerificationMail({
      store,
      mailer,
      pageId: page.pageId,
      leadId: LEAD_ID,
      mail: {
        to: EMAIL,
        token: "not-logged",
        leadId: LEAD_ID,
        publicOrigin: TEST_ORIGIN,
        locale: "en",
      },
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0,
    });
    assert.equal(outcome, "unreadable");
    assert.equal(reads, 3);
    assert.deepEqual(sleeps, [verificationBackoffMs(1, 0), verificationBackoffMs(2, 0)]);
    assert.equal(mailer.sent.length, 0);
    const printed = JSON.stringify(log.mock.calls.map((call) => call.arguments));
    assert.equal(printed.includes(EMAIL), false);
    assert.equal(printed.includes("not-logged"), false);
  } finally {
    log.mock.restore();
  }
});

test("a superseded attempt is not mailed and does not stamp the new attempt", async () => {
  const store = new FakeLeadStore();
  const page = await store.createPending({
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    refCode: "abcd1234",
    flags: [],
    suspect: false,
    signedUpAt: clock.toISOString(),
    leadId: LEAD_ID,
    expiresAt: new Date(clock.getTime() + VERIFICATION_TTL_MS).toISOString(),
  });
  await store.startAttempt(page.pageId, {
    leadId: "bbbbbbbb-cccc-4ddd-8eee-000000000002",
    expiresAt: new Date(clock.getTime() + VERIFICATION_TTL_MS).toISOString(),
    sends: 2,
  });
  const mailer = new FakeMailer();
  const outcome = await deliverQueuedVerificationMail({
    store,
    mailer,
    pageId: page.pageId,
    leadId: LEAD_ID,
    mail: {
      to: EMAIL,
      token: createVerificationToken(LEAD_ID, clock.getTime() + VERIFICATION_TTL_MS, true, TEST_SECRET),
      leadId: LEAD_ID,
      publicOrigin: TEST_ORIGIN,
      locale: "en",
    },
    sleep: async () => {},
    log: () => {},
  });
  assert.equal(outcome, "superseded");
  assert.equal(mailer.sent.length, 0);
  assert.equal(store.markSentCalls, 0);
});

test("abuse flags suppress the queued send and a shared-network flag does not", async () => {
  const store = new FakeLeadStore();
  const abusive = await store.createPending({
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    refCode: "abcd1234",
    flags: ["honeypot"],
    suspect: true,
    signedUpAt: clock.toISOString(),
    leadId: LEAD_ID,
    expiresAt: new Date(clock.getTime() + VERIFICATION_TTL_MS).toISOString(),
  });
  const abusiveMailer = new FakeMailer();
  const suppressed = await deliverQueuedVerificationMail({
    store,
    mailer: abusiveMailer,
    pageId: abusive.pageId,
    leadId: LEAD_ID,
    mail: {
      to: EMAIL,
      token: createVerificationToken(LEAD_ID, clock.getTime() + VERIFICATION_TTL_MS, true, TEST_SECRET, "en"),
      leadId: LEAD_ID,
      publicOrigin: TEST_ORIGIN,
      locale: "en",
    },
    sleep: async () => {},
    log: () => {},
  });
  assert.equal(suppressed, "suppressed");
  assert.equal(abusiveMailer.sent.length, 0);

  const shared = new FakeLeadStore();
  const page = await shared.createPending({
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    refCode: "abcd1234",
    flags: ["ip-repeat"],
    suspect: true,
    signedUpAt: clock.toISOString(),
    leadId: LEAD_ID,
    expiresAt: new Date(clock.getTime() + VERIFICATION_TTL_MS).toISOString(),
  });
  const mailer = new FakeMailer();
  const outcome = await deliverQueuedVerificationMail({
    store: shared,
    mailer,
    pageId: page.pageId,
    leadId: LEAD_ID,
    mail: {
      to: EMAIL,
      token: createVerificationToken(LEAD_ID, clock.getTime() + VERIFICATION_TTL_MS, false, TEST_SECRET, "en"),
      leadId: LEAD_ID,
      publicOrigin: TEST_ORIGIN,
      locale: "en",
    },
    now: () => clock,
    sleep: async () => {},
    log: () => {},
  });
  assert.equal(outcome, "accepted");
  assert.equal(mailer.sent.length, 1);
  assert.equal(shared.markSentCalls, 1);
});

const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

test("waitUntil without a request context is a no-op, so the signup awaits the send", async () => {
  clock = new Date("2026-07-30T09:00:00.000Z");
  nextLeadId = leadIdFactory();
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const previous = (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT];
  delete (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT];
  try {
    assert.equal(waitUntil(Promise.resolve("held-or-not")), undefined);
    assert.throws(
      () => createVercelAfterResponse()(Promise.resolve()),
      /verification_after_response_unavailable/,
    );
    const res = await requestVerificationService(
      submit(),
      deps(store, mailer, { scheduleAfterResponse: createVercelAfterResponse() }),
    );
    assert.equal(res.status, "pending");
    assert.equal(mailer.sent.length, 1);
    assert.equal(store.markSentCalls, 1);
  } finally {
    if (previous === undefined) delete (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT];
    else (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = previous;
  }
});

test("a Vercel request context registers the send before the response returns", async (t) => {
  clock = new Date("2026-07-30T09:00:00.000Z");
  nextLeadId = leadIdFactory();
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = mailer.send.bind(mailer);
  mailer.send = async (input) => {
    await gate;
    await original(input);
  };
  const held: Promise<unknown>[] = [];
  const previous = (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT];
  (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = {
    get: () => ({
      waitUntil(task: Promise<unknown>) {
        held.push(task);
      },
    }),
  };
  try {
    const started = performance.now();
    const res = await requestVerificationService(
      submit(),
      deps(store, mailer, { scheduleAfterResponse: createVercelAfterResponse() }),
    );
    const elapsed = performance.now() - started;
    t.diagnostic(`context-held response ${elapsed.toFixed(1)}ms`);
    assert.equal(res.status, "pending");
    assert.equal(held.length, 1);
    assert.equal(mailer.sent.length, 0);
    assert.ok(elapsed < 200, `response waited ${elapsed.toFixed(1)}ms`);
    release();
    await held[0];
    assert.equal(mailer.sent.length, 1);
    assert.equal(store.markSentCalls, 1);
  } finally {
    if (previous === undefined) delete (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT];
    else (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = previous;
  }
});

test("owned sources keep the send behind the response hook and off the follow-up job", () => {
  const root = new URL("../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");
  const service = read("src/lib/verification/service.ts");
  const deps = read("src/lib/verification/deps.server.ts");
  const waitlist = read("src/lib/api/waitlist.functions.ts");
  const mail = read("src/lib/verification/asyncVerificationMail.ts");
  const server = read("src/lib/verification/asyncVerificationMail.server.ts");
  const resend = read("src/lib/verification/resend.ts");
  assert.equal(service.includes("settleVerificationMail"), true);
  assert.equal(service.includes("deliverQueuedVerificationMail"), true);
  assert.equal(service.includes("proposedDispatchFingerprint"), false);
  assert.equal(service.includes("assessUnsentAttempt"), false);
  assert.equal(deps.includes("createVercelAfterResponse"), true);
  assert.equal(deps.includes("createRequire"), false);
  assert.match(deps, /google\.enabled \? \{ captureGoogleContext: google\.capture \} : \{\}/);
  assert.match(deps, /google\.forget\(email\)/);
  assert.equal(waitlist.includes("requestVerificationService"), true);
  assert.equal(waitlist.includes('status: "sent"'), false);
  assert.equal(mail.includes("reminder.ts"), false);
  assert.equal(mail.includes("proposedDispatchFingerprint"), false);
  assert.equal(mail.includes("assessUnsentAttempt"), false);
  assert.equal(server.includes('from "@vercel/functions"'), true);
  assert.equal(server.includes("createRequire"), false);
  assert.equal(server.includes("getDeadline"), false);
  assert.equal(server.includes("@vercel/request-context"), true);
  assert.equal(resend.includes("verification_mail_attempt"), true);
  for (const source of [mail, server, service, deps, waitlist, resend]) {
    for (const line of source.split("\n")) {
      if (!line.includes("console.")) continue;
      for (const forbidden of ["email", "token", "ip", "ua", "network"]) {
        assert.equal(
          new RegExp(`console\\.[a-z]+\\([^)]*\\b${forbidden}\\b`).test(line),
          false,
          line.trim(),
        );
      }
    }
  }
});
