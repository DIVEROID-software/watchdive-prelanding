import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import { GENERIC_PENDING_MESSAGE } from "../src/lib/verification/contracts.ts";
import {
  createDeliveryAlerter,
  createSlackPoster,
  DELIVERY_ALERT_WINDOW_MS,
} from "../src/lib/verification/deliveryAlert.ts";
import { ResendDeliveryError } from "../src/lib/verification/resend.ts";
import { requestVerificationService } from "../src/lib/verification/service.ts";
import { FakeLeadStore, FakeMailer, leadIdFactory, TEST_ENV } from "./helpers/fakes.ts";

const EMAIL = "private.person@example.com";

function collector() {
  const posts: string[] = [];
  return { posts, post: async (text: string) => void posts.push(text) };
}

test("an outage produces one alert per window, not one per visitor", async () => {
  let now = Date.parse("2026-10-06T10:00:00Z");
  const { posts, post } = collector();
  const alerter = createDeliveryAlerter({ post, now: () => now });

  for (let i = 0; i < 50; i++) {
    await alerter.record(new ResendDeliveryError("Resend delivery failed (503)", 503));
    now += 1000;
  }
  assert.equal(posts.length, 1);
  assert.match(posts[0], /1 failure /);

  // The next window's alert carries everything the first one held back.
  now = Date.parse("2026-10-06T10:00:00Z") + DELIVERY_ALERT_WINDOW_MS + 1;
  await alerter.record(new ResendDeliveryError("Resend delivery failed (503)", 503));
  assert.equal(posts.length, 2);
  assert.match(posts[1], /50 failures/);
  assert.match(posts[1], /provider_rejected \(HTTP 503\) x50/);
});

test("the alert carries no personal data, whatever the error says", async () => {
  const { posts, post } = collector();
  const alerter = createDeliveryAlerter({ post });
  // An unexpected error whose message carries an address, a name and an IP.
  await alerter.record(new Error(`could not mail ${EMAIL} (Jane Diver) from 203.0.113.7`));

  const text = posts[0];
  assert.ok(!text.includes(EMAIL));
  assert.ok(!text.includes("private.person"));
  assert.ok(!text.includes("Jane"));
  assert.ok(!text.includes("203.0.113.7"));
  assert.ok(!text.includes("@"));
  assert.match(text, /unexpected_error x1/);
  assert.match(text, /\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
});

test("a failed confirmation send raises the alert and the visitor's answer is unchanged", async () => {
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  mailer.fail = true;
  const failures: unknown[] = [];
  const res = await requestVerificationService(
    {
      email: EMAIL,
      canonical: canonicalEmail(EMAIL),
      source: "hero",
      flags: [],
      suspect: false,
      measurementConsent: true,
      networkSendBlocked: false,
    },
    {
      store,
      mailer,
      env: TEST_ENV,
      leadId: leadIdFactory(),
      sleep: async () => {},
      onDeliveryFailure: async (error: unknown) => void failures.push(error),
    },
  );
  assert.equal(res.status, "pending");
  assert.equal(res.message, GENERIC_PENDING_MESSAGE);
  assert.equal(failures.length, 1);
});

test("an alerting failure never breaks the submit", async () => {
  const mailer = new FakeMailer();
  mailer.fail = true;
  const res = await requestVerificationService(
    {
      email: EMAIL,
      canonical: canonicalEmail(EMAIL),
      source: "hero",
      flags: [],
      suspect: false,
      measurementConsent: false,
      networkSendBlocked: false,
    },
    {
      store: new FakeLeadStore(),
      mailer,
      env: TEST_ENV,
      leadId: leadIdFactory(),
      sleep: async () => {},
      onDeliveryFailure: async () => {
        throw new Error("slack down");
      },
    },
  );
  assert.equal(res.status, "pending");
});

test("a successful send raises no alert", async () => {
  const failures: unknown[] = [];
  await requestVerificationService(
    {
      email: EMAIL,
      canonical: canonicalEmail(EMAIL),
      source: "hero",
      flags: [],
      suspect: false,
      measurementConsent: true,
      networkSendBlocked: false,
    },
    {
      store: new FakeLeadStore(),
      mailer: new FakeMailer(),
      env: TEST_ENV,
      leadId: leadIdFactory(),
      sleep: async () => {},
      onDeliveryFailure: async (error: unknown) => void failures.push(error),
    },
  );
  assert.equal(failures.length, 0);
});

test("the Slack poster sends only channel and text, and never logs the token", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), { status: 200 });
  }) as unknown as typeof fetch;
  const log = mock.method(console, "error", () => {});
  try {
    await createSlackPoster(
      { SLACK_BOT_TOKEN: "xoxb-test-token", SLACK_SIGNUP_CHANNEL_ID: "C0TEST" },
      fetchImpl,
    )("hello");
    assert.equal(calls[0].url, "https://slack.com/api/chat.postMessage");
    assert.deepEqual(Object.keys(JSON.parse(String(calls[0].init.body))).sort(), [
      "channel",
      "text",
      "unfurl_links",
      "unfurl_media",
    ]);
    const logged = JSON.stringify(log.mock.calls.map((c) => c.arguments));
    assert.ok(logged.includes("channel_not_found"));
    assert.ok(!logged.includes("xoxb-test-token"));
    assert.ok(!logged.includes("C0TEST"));
  } finally {
    log.mock.restore();
  }
});

test("an unconfigured Slack poster makes no request", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch;
  const log = mock.method(console, "error", () => {});
  try {
    await createSlackPoster({}, fetchImpl)("hello");
  } finally {
    log.mock.restore();
  }
  assert.equal(called, false);
});
