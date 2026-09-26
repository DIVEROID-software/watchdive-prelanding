import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";

import {
  deliverMetaLead,
  metaCapiConfigStatus,
  sendMetaEmailVerified,
  sendMetaLead,
} from "../src/lib/api/metaCapi.ts";
import { META_LEAD_CURRENCY, META_LEAD_VALUE } from "../src/lib/metaLeadValue.ts";

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

  const sent = await sendMetaLead({
    eventId: "wd-test-mismatch-1234",
    email: "Diver@Example.com",
  });

  assert.equal(sent, false);
  assert.equal(called, false);
});

test("the submit Lead carries hashed contact data, fbp/fbc, UTMs and the landing page", async () => {
  configureMeta();
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: "trace-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const sent = await sendMetaLead({
    eventId: "wd-test-dedup-1234",
    email: "Diver@Example.com",
    phone: "+1 (415) 555-0100",
    ip: "203.0.113.10",
    ua: "WatchDive Test",
    fbp: "fb.1.123.456",
    fbc: "fb.1.123.click",
    source: "hero",
    utm: { source: "ig", medium: "paid", campaign: "us-launch", content: "reel-1", term: "divers" },
    landingPath: "/",
  });

  assert.equal(sent, true);
  assert.equal(requestUrl, "https://graph.facebook.com/v21.0/1028181916616055/events");
  assert.equal(new Headers(requestInit?.headers).get("Authorization"), "Bearer test-token");

  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.data.length, 1, "an unconfirmed submit is one Lead, no Contact");
  const [lead] = body.data;
  assert.equal(lead.event_name, "Lead");
  assert.equal(lead.event_id, "wd-test-dedup-1234");
  assert.equal(lead.action_source, "website");
  assert.equal(lead.event_source_url, "https://watchdive.diveroid.com/");
  assert.deepEqual(lead.user_data.em, [
    createHash("sha256").update("diver@example.com").digest("hex"),
  ]);
  assert.deepEqual(lead.user_data.ph, [createHash("sha256").update("14155550100").digest("hex")]);
  assert.equal(lead.user_data.fbp, "fb.1.123.456");
  assert.equal(lead.user_data.fbc, "fb.1.123.click");
  assert.equal(lead.custom_data.utm_source, "ig");
  assert.equal(lead.custom_data.utm_medium, "paid");
  assert.equal(lead.custom_data.utm_campaign, "us-launch");
  assert.equal(lead.custom_data.utm_content, "reel-1");
  assert.equal(lead.custom_data.utm_term, "divers");
  assert.equal(lead.custom_data.value, 1);
  assert.equal(lead.custom_data.currency, "USD");
  assert.equal(lead.user_data.client_ip_address, "203.0.113.10");
  assert.equal(lead.user_data.client_user_agent, "WatchDive Test");
  assert.equal(body.test_event_code, undefined);
});

test("the confirmation click is EmailVerified (not a second Lead), plus Contact for a phone", async () => {
  configureMeta();
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return new Response(JSON.stringify({ events_received: 2, fbtrace_id: "trace-3" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const sent = await sendMetaEmailVerified({
    eventId: "wd-test-verify-1234",
    email: "diver@example.com",
    phone: "+1 (415) 555-0100",
  });

  assert.equal(sent, true);
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.data.length, 2);
  assert.equal(body.data[0].event_name, "EmailVerified");
  assert.equal(body.data[0].event_id, "wd-test-verify-1234");
  assert.equal(body.data[1].event_name, "Contact");
  assert.equal(body.data[1].event_id, "wd-test-verify-1234:phone");
  assert.equal(
    body.data.some((event: { event_name: string }) => event.event_name === "Lead"),
    false,
  );
});

test("does not report success when Meta acknowledges fewer events than sent", async () => {
  configureMeta();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ events_received: 0, fbtrace_id: "trace-2" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const sent = await sendMetaLead({
    eventId: "wd-test-ack-1234",
    email: "diver@example.com",
  });

  assert.equal(sent, false);
});

test("the Lead value/currency is one shared, well-formed pair", () => {
  assert.equal(typeof META_LEAD_VALUE, "number");
  assert.ok(META_LEAD_VALUE > 0);
  assert.match(META_LEAD_CURRENCY, /^[A-Z]{3}$/);
});

test("delivery status distinguishes disabled, sent and error without exposing values", async () => {
  configureMeta();
  delete process.env.META_CAPI_ACCESS_TOKEN;
  process.env.META_CAPI_ENABLED = "false";
  const status = metaCapiConfigStatus();
  assert.equal(status.enabled, false);
  assert.deepEqual(status.missing, ["META_CAPI_ENABLED", "META_CAPI_ACCESS_TOKEN"]);
  assert.equal(JSON.stringify(status).includes("1028181916616055"), false);
  assert.equal(await deliverMetaLead({ eventId: "wd-test-status-1", email: "a@b.co" }), "disabled");

  configureMeta();
  assert.equal(metaCapiConfigStatus().enabled, true);
  assert.equal(JSON.stringify(metaCapiConfigStatus()).includes("test-token"), false);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  assert.equal(await deliverMetaLead({ eventId: "wd-test-status-2", email: "a@b.co" }), "sent");

  globalThis.fetch = async () => new Response("{}", { status: 400 });
  assert.equal(await deliverMetaLead({ eventId: "wd-test-status-3", email: "a@b.co" }), "error");
});

test("the browser Lead carries the same value/currency as the server leg", async () => {
  const { readFile } = await import("node:fs/promises");
  const pixel = await readFile(new URL("../src/lib/metaPixel.ts", import.meta.url), "utf8");
  const lead = pixel.slice(pixel.indexOf("export function trackMetaLead"));
  const body = lead.slice(0, lead.indexOf("\n}\n"));
  assert.ok(body.includes("value: META_LEAD_VALUE"));
  assert.ok(body.includes("currency: META_LEAD_CURRENCY"));
  assert.ok(body.includes("{ eventID: eventId }"));
});
