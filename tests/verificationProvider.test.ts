import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createResendMailer,
  readResendConfig,
  ResendDeliveryError,
  senderWithDisplayName,
} from "../src/lib/verification/resend.ts";
import {
  createVerificationToken,
  networkKey,
  requirePublicOrigin,
  requireSecret,
  verificationUrl,
} from "../src/lib/verification/token.ts";
import { TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";

const ENV = {
  RESEND_API_KEY: "re_test_key",
  WATCHDIVE_EMAIL_FROM: "WatchDive <hello@watchdive.example>",
  WATCHDIVE_EMAIL_REPLY_TO: "help@watchdive.example",
};

const LEAD_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const TOKEN = createVerificationToken(
  LEAD_ID,
  Date.parse("2026-08-01T00:00:00Z"),
  true,
  TEST_SECRET,
);

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift() ?? { status: 200, body: { id: "msg_1" } };
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const noSleep = async () => {};

function mail() {
  return {
    to: "diver@example.com",
    token: TOKEN,
    leadId: LEAD_ID,
    publicOrigin: TEST_ORIGIN,
    locale: "en" as const,
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

test("the sender and key are required", () => {
  assert.throws(() => readResendConfig({ ...ENV, RESEND_API_KEY: "" }));
  assert.throws(() => readResendConfig({ ...ENV, WATCHDIVE_EMAIL_FROM: "" }));
  assert.deepEqual(readResendConfig(ENV), {
    apiKey: "re_test_key",
    from: "DIVEROID <hello@watchdive.example>",
    replyTo: ENV.WATCHDIVE_EMAIL_REPLY_TO,
  });
});

test("the inbox display name is DIVEROID; the sending address is untouched", () => {
  assert.equal(
    senderWithDisplayName("OceanWick <verify@mail.oceanwick.ai>"),
    "DIVEROID <verify@mail.oceanwick.ai>",
  );
  assert.equal(
    senderWithDisplayName("verify@mail.oceanwick.ai"),
    "DIVEROID <verify@mail.oceanwick.ai>",
  );
  assert.equal(
    senderWithDisplayName("x <verify@mail.oceanwick.ai>", 'Diveroid "Team"'),
    "Diveroid Team <verify@mail.oceanwick.ai>",
  );
  assert.equal(
    readResendConfig({ ...ENV, WATCHDIVE_EMAIL_FROM_NAME: "  " }).from,
    "DIVEROID <hello@watchdive.example>",
  );
});

test("reply-to is genuinely optional", () => {
  const config = readResendConfig({ ...ENV, WATCHDIVE_EMAIL_REPLY_TO: "" });
  assert.equal(config.replyTo, undefined);
});

test("the public origin must be a fixed bare https origin", () => {
  assert.equal(requirePublicOrigin({ WATCHDIVE_PUBLIC_ORIGIN: TEST_ORIGIN }), TEST_ORIGIN);
  for (const bad of [
    "",
    "http://watchdive.diveroid.com",
    "https://user:pw@watchdive.diveroid.com",
    "https://watchdive.diveroid.com/path",
    "https://watchdive.diveroid.com/?a=1",
    "not-a-url",
  ]) {
    assert.throws(() => requirePublicOrigin({ WATCHDIVE_PUBLIC_ORIGIN: bad }), `accepted: ${bad}`);
  }
});

test("a short signing secret is refused", () => {
  assert.throws(() => requireSecret({ WATCHDIVE_VERIFICATION_SECRET: "too-short" }));
});

test("the network key is keyed, stable, and not the address", () => {
  const a = networkKey("203.0.113.7", TEST_SECRET);
  assert.equal(a, networkKey(" 203.0.113.7 ", TEST_SECRET));
  assert.notEqual(a, networkKey("203.0.113.8", TEST_SECRET));
  // Another deployment's secret yields another key.
  assert.notEqual(a, networkKey("203.0.113.7", "another-secret-at-least-32-bytes-x"));
  assert.ok(!a!.includes("203"));
  assert.equal(networkKey("", TEST_SECRET), undefined);
});

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

test("the send carries the key, a fixed user agent, and an attempt-scoped idempotency key", async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { id: "msg_1" } }]);
  await createResendMailer(ENV, impl, noSleep).send(mail());

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer re_test_key");
  // Resend answers a missing User-Agent with 403 code 1010.
  assert.equal(headers["User-Agent"], "watchdive-prelanding/1.0");
  assert.equal(headers["Idempotency-Key"], `watchdive-verification-${LEAD_ID}`);
});

test("the message links to the fragment URL and makes no unapproved claim", async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { id: "msg_1" } }]);
  await createResendMailer(ENV, impl, noSleep).send(mail());

  const body = JSON.parse(String(calls[0].init.body));
  const url = verificationUrl(TEST_ORIGIN, TOKEN);
  assert.deepEqual(body.to, ["diver@example.com"]);
  assert.ok(body.html.includes(url));
  assert.ok(body.text.includes(url));
  assert.ok(body.html.includes("Confirm my email"));

  // Price, discount and referral policy are all unconfirmed in product truth,
  // so a brand-new surface must not assert them.
  const copy = `${body.subject} ${body.text} ${body.html}`.toLowerCase();
  for (const claim of ["149", "early bird", "early-bird", "50%", "referral", "$5", "free"]) {
    assert.ok(!copy.includes(claim), `email asserted an unapproved claim: ${claim}`);
  }
});

test("the confirmation URL keeps the token out of the query string", () => {
  const url = new URL(verificationUrl(TEST_ORIGIN, TOKEN));
  assert.equal(url.search, "");
  assert.equal(url.pathname, "/verify");
  assert.equal(url.hash, `#${TOKEN}`);
  // A literal `=` in the fragment is destroyed by quoted-printable mail encoding.
  assert.ok(!url.hash.includes("="));
});

// A mail body is transferred as quoted-printable, where `=` starts an escape.
// An unescaped `=` in the link is decoded away together with the two characters
// after it, which silently truncated the token and made every confirmation link
// dead. Decoding the URL the way a mail client does must be a no-op.
test("the confirmation URL survives quoted-printable decoding", () => {
  const url = verificationUrl(TEST_ORIGIN, TOKEN);
  const decoded = url.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  assert.equal(decoded, url);
  assert.ok(!url.includes("="));
  assert.ok(url.endsWith(`#${TOKEN}`));
});

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

test("a rate limit is retried with the same key", async () => {
  const { impl, calls } = fakeFetch([
    { status: 429, body: {} },
    { status: 200, body: { id: "msg_1" } },
  ]);
  await createResendMailer(ENV, impl, noSleep).send(mail());

  assert.equal(calls.length, 2);
  const keys = calls.map((c) => (c.init.headers as Record<string, string>)["Idempotency-Key"]);
  assert.equal(keys[0], keys[1]);
});

test("a server fault is retried and then gives up", async () => {
  const { impl, calls } = fakeFetch([
    { status: 500, body: {} },
    { status: 502, body: {} },
    { status: 503, body: {} },
  ]);
  await assert.rejects(() => createResendMailer(ENV, impl, noSleep).send(mail()));
  assert.equal(calls.length, 3);
});

test("a transport fault is retried", async () => {
  let calls = 0;
  const impl = (async () => {
    calls += 1;
    if (calls === 1) throw new Error("socket hang up");
    return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
  }) as unknown as typeof fetch;

  await createResendMailer(ENV, impl, noSleep).send(mail());
  assert.equal(calls, 2);
});

test("a rejected address is not retried", async () => {
  const { impl, calls } = fakeFetch([{ status: 422, body: { name: "validation_error" } }]);
  await assert.rejects(() => createResendMailer(ENV, impl, noSleep).send(mail()));
  assert.equal(calls.length, 1);
});

test("a concurrent idempotent request is retried with the same key and payload", async () => {
  const { impl, calls } = fakeFetch([
    { status: 409, body: { name: "concurrent_idempotent_requests" } },
    { status: 200, body: { id: "msg_1" } },
  ]);
  await createResendMailer(ENV, impl, noSleep).send(mail());

  assert.equal(calls.length, 2);
  assert.equal(String(calls[0].init.body), String(calls[1].init.body));
  const keys = calls.map((c) => (c.init.headers as Record<string, string>)["Idempotency-Key"]);
  assert.equal(keys[0], keys[1]);
});

test("an invalid idempotent request is terminal", async () => {
  const { impl, calls } = fakeFetch([
    { status: 409, body: { name: "invalid_idempotent_request" } },
  ]);

  await assert.rejects(
    () => createResendMailer(ENV, impl, noSleep).send(mail()),
    (error: unknown) => error instanceof ResendDeliveryError && error.status === 409,
  );
  assert.equal(calls.length, 1);
});

test("an unreadable conflict fails closed rather than retrying", async () => {
  const { impl, calls } = fakeFetch([{ status: 409 }]);
  await assert.rejects(() => createResendMailer(ENV, impl, noSleep).send(mail()));
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Success validation
// ---------------------------------------------------------------------------

test("a 2xx without a usable message id is not an accepted send", async () => {
  for (const body of [{}, { id: 42 }, { id: "" }, { id: "has spaces" }]) {
    const { impl } = fakeFetch([{ status: 200, body }]);
    await assert.rejects(
      () => createResendMailer(ENV, impl, noSleep).send(mail()),
      `accepted a malformed success: ${JSON.stringify(body)}`,
    );
  }
});

test("an unparseable 2xx is not an accepted send", async () => {
  const impl = (async () =>
    new Response("<html>ok</html>", { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(() => createResendMailer(ENV, impl, noSleep).send(mail()));
});

test("provider errors never carry the recipient or the body", async () => {
  const { impl } = fakeFetch([
    { status: 422, body: { name: "validation_error", message: "diver@example.com is invalid" } },
  ]);

  await assert.rejects(
    () => createResendMailer(ENV, impl, noSleep).send(mail()),
    (error: unknown) => {
      const text = String(error);
      return !text.includes("diver@example.com") && !text.includes("is invalid");
    },
  );
});

// Delivery failures are deliberately hidden from signup responses, but must
// remain visible to operations without exposing the message or credentials.
test("terminal Resend failures log once after retries, without sensitive data", async (t) => {
  for (const scenario of [
    { status: 400, body: { message: "diver@example.com" }, attempts: 1, reason: "provider_rejected" },
    { status: 429, body: { message: "rate limited" }, attempts: 3, reason: "provider_rejected" },
    { status: 503, body: { message: "unavailable" }, attempts: 3, reason: "provider_rejected" },
    { status: 200, body: { unexpected: TOKEN }, attempts: 1, reason: "invalid_provider_response" },
  ]) {
    const log = t.mock.method(console, "error", () => {});
    const provider = fakeFetch(Array.from({ length: scenario.attempts }, () => scenario));
    try {
      await assert.rejects(createResendMailer(ENV, provider.impl, noSleep).send(mail()), ResendDeliveryError);
      assert.equal(provider.calls.length, scenario.attempts);
      assert.equal(log.mock.callCount(), 1);
      assert.deepEqual(log.mock.calls[0].arguments, ["[watchdive] email_delivery_failed", {
        provider: "resend", operation: "verification", status: scenario.status, reason: scenario.reason,
      }]);
      const output = JSON.stringify(log.mock.calls[0].arguments);
      for (const secret of [mail().to, TOKEN, ENV.RESEND_API_KEY, LEAD_ID]) {
        assert.ok(!output.includes(secret));
      }
    } finally {
      log.mock.restore();
    }
  }
});

test("transport failures log sanitized metadata and recovered retries do not log failure", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  let attempts = 0;
  const failedFetch = (async () => {
    attempts++;
    throw new Error(`transport failed for ${mail().to} ${TOKEN} ${ENV.RESEND_API_KEY}`);
  }) as typeof fetch;
  await assert.rejects(createResendMailer(ENV, failedFetch, noSleep).send(mail()), ResendDeliveryError);
  assert.equal(attempts, 3);
  assert.deepEqual(log.mock.calls[0].arguments, ["[watchdive] email_delivery_failed", {
    provider: "resend", operation: "verification", status: 0, reason: "transport_error",
  }]);
  const recovered = fakeFetch([{ status: 503 }, { status: 200, body: { id: "msg_recovered" } }]);
  await createResendMailer(ENV, recovered.impl, noSleep).send(mail());
  assert.equal(log.mock.callCount(), 1, "successful retries must not report terminal failures");
});

test("welcome delivery failures are logged with a distinct operation", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const provider = fakeFetch([{ status: 403 }]);
  await assert.rejects(createResendMailer(ENV, provider.impl, noSleep).sendWelcome({
    to: mail().to,
    leadId: LEAD_ID,
    refCode: "abcd1234",
    publicOrigin: TEST_ORIGIN,
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    locale: "en",
  }), ResendDeliveryError);
  assert.deepEqual(log.mock.calls[0].arguments, ["[watchdive] email_delivery_failed", {
    provider: "resend", operation: "welcome", status: 403, reason: "provider_rejected",
  }]);
});
