import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { savePushSubscription } from "../src/lib/push/client.ts";
test("worker accepts only approved localized launch notifications and cannot open external URLs", async () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const shown: [string, { body: string }][] = [];
  const opened: string[] = [];
  const pending: Promise<unknown>[] = [];
  vm.runInNewContext(
    readFileSync(new URL("../public/watchdive-push-sw.js", import.meta.url), "utf8"),
    {
      URL,
      self: {
        addEventListener: (name: string, callback: (event: unknown) => void) => {
          handlers[name] = callback;
        },
        registration: {
          showNotification: async (...args: [string, { body: string }]) => {
            shown.push(args);
          },
        },
        location: { origin: "https://example.com" },
        clients: {
          openWindow: async (url: string) => {
            opened.push(url);
          },
        },
      },
    },
  );
  for (const locale of SUPPORTED_LOCALES)
    handlers.push({
      data: {
        json: () => ({
          locale,
          copyVersion: "wd-push-launch-v1",
          kind: "launch",
          title: "Injected",
          url: "https://evil.test",
        }),
      },
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
  for (const input of [
    {},
    { locale: "__proto__", copyVersion: "wd-push-launch-v1", kind: "launch" },
    { locale: "en", copyVersion: "unapproved", kind: "launch" },
  ])
    handlers.push({
      data: { json: () => input },
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
  await Promise.all(pending);
  assert.equal(shown.length, 9);
  for (const notification of shown) {
    assert.equal(notification[0], "WatchDive");
    assert.equal(notification[1].body.includes("Injected"), false);
  }
  handlers.notificationclick({
    notification: { close: () => {}, data: { path: "https://evil.test" } },
    waitUntil: (p: Promise<unknown>) => pending.push(p),
  });
  await Promise.all(pending);
  assert.deepEqual(opened, ["https://example.com/"]);
});
test("browser subscription is not accepted without a durable, well-formed server receipt", async () => {
  const subscription = { toJSON: () => ({ endpoint: "mock" }) } as unknown as PushSubscription;
  const failed = (async () => new Response("{}", { status: 503 })) as typeof fetch;
  const malformed = (async () => Response.json({ ok: true })) as typeof fetch;
  await assert.rejects(() => savePushSubscription(subscription, "en", failed));
  await assert.rejects(() => savePushSubscription(subscription, "en", malformed));
  let submitted: Record<string, unknown> = {};
  const accepted = (async (_: unknown, options: RequestInit) => {
    submitted = JSON.parse(String(options.body));
    return Response.json({ ok: true, id: "a".repeat(64), receipt: "b".repeat(64) });
  }) as typeof fetch;
  assert.equal((await savePushSubscription(subscription, "ja", accepted)).id.length, 64);
  assert.equal(submitted.locale, "ja");
  assert.equal(submitted.consent, true);
  assert.equal(submitted.email, undefined);
});
