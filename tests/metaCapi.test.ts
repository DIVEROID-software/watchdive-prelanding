import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";

import { sanitizeMetaEventSourceUrl, sendMetaLead } from "../src/lib/api/metaCapi.ts";

const META_ENV_KEYS = [
  "META_CAPI_ENABLED",
  "VITE_META_TRACKING_ENABLED",
  "META_PIXEL_ID",
  "VITE_META_PIXEL_ID",
  "META_CAPI_ACCESS_TOKEN",
  "META_CAPI_TEST_EVENT_CODE",
] as const;

const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(META_ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of META_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureMeta() {
  process.env.META_CAPI_ENABLED = "true";
  process.env.VITE_META_TRACKING_ENABLED = "true";
  process.env.META_PIXEL_ID = "1028181916616055";
  process.env.VITE_META_PIXEL_ID = "1028181916616055";
  process.env.META_CAPI_ACCESS_TOKEN = "test-token";
  delete process.env.META_CAPI_TEST_EVENT_CODE;
}

test("fails closed when browser and server dataset ids differ", async () => {
  configureMeta();
  process.env.VITE_META_PIXEL_ID = "1024858426916004";
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("fetch should not run");
  };

  const result = await sendMetaLead({
    eventId: "wd-test-mismatch-1234",
    email: "Diver@Example.com",
  });

  assert.equal(result.sent, false);
  assert.equal(result.state, "skipped");
  assert.equal(called, false);
});

test("sends hashed lead and phone data with matching browser/server event ids", async () => {
  configureMeta();
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ events_received: 2, fbtrace_id: "trace-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await sendMetaLead({
    eventId: "wd-test-dedup-1234",
    email: "Diver@Example.com",
    phone: "+1 (415) 555-0100",
    ip: "203.0.113.10",
    ua: "WatchDive Test",
    fbp: "fb.1.123.456",
    fbc: "fb.1.123.click",
    source: "hero",
  });

  assert.equal(result.sent, true);
  assert.equal(result.state, "sent");
  assert.equal(result.phoneEventId, "wd-test-dedup-1234:phone");
  assert.equal(requestUrl, "https://graph.facebook.com/v21.0/1028181916616055/events");
  assert.equal(new Headers(requestInit?.headers).get("Authorization"), "Bearer test-token");

  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.data.length, 2);
  assert.equal(body.data[0].event_name, "Lead");
  assert.equal(body.data[0].event_id, "wd-test-dedup-1234");
  assert.equal(body.data[1].event_name, "Contact");
  assert.equal(body.data[1].event_id, "wd-test-dedup-1234:phone");
  assert.deepEqual(body.data[0].user_data.em, [
    createHash("sha256").update("diver@example.com").digest("hex"),
  ]);
  assert.deepEqual(body.data[0].user_data.ph, [
    createHash("sha256").update("14155550100").digest("hex"),
  ]);
  assert.equal(body.test_event_code, undefined);
});

test("does not report success when Meta acknowledges fewer events than sent", async () => {
  configureMeta();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ events_received: 0, fbtrace_id: "trace-2" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const result = await sendMetaLead({
    eventId: "wd-test-ack-1234",
    email: "diver@example.com",
  });

  assert.equal(result.sent, false);
  assert.equal(result.state, "failed");
});

test("uses a sanitized same-origin event source URL and ignores invalid phone input", async () => {
  configureMeta();
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: "trace-3" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await sendMetaLead({
    eventId: "wd-test-source-1234",
    email: "diver@example.com",
    phone: "call-me",
    eventSourceUrl: "https://evil.example/steal?email=diver@example.com",
  });

  assert.equal(result.sent, true);
  assert.equal(result.expectedEvents, 1);
  assert.equal(result.phoneEventId, undefined);

  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].event_source_url, "https://watchdive.diveroid.com/");
});

test("keeps only the same-origin landing path in the event source URL", () => {
  assert.equal(
    sanitizeMetaEventSourceUrl("https://watchdive.diveroid.com/offer?email=private@example.com"),
    "https://watchdive.diveroid.com/offer",
  );
  assert.equal(sanitizeMetaEventSourceUrl("/?utm_source=meta"), "https://watchdive.diveroid.com/");
});
