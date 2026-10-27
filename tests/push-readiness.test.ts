import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicPushConfig, PUSH_COPY_VERSION } from "../src/lib/push/config.ts";
import {
  handlePushSubscription,
  validatePushSubscription,
  createPushRateGate,
} from "../src/lib/push/http.server.ts";
import {
  filePushSubscriptionStore,
  pushId,
  validPushReceipt,
} from "../src/lib/push/store.server.ts";
import { canOfferPush, decodeVapidPublicKey } from "../src/lib/push/client.ts";
import { PUSH_COPY } from "../src/lib/push/copy.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
const key = Buffer.from([4, ...Array(64).fill(1)]).toString("base64url");
const env = {
  WATCHDIVE_PUSH_ENABLED: "true",
  WATCHDIVE_PUSH_COPY_APPROVED: PUSH_COPY_VERSION,
  WATCHDIVE_PUSH_VAPID_PUBLIC_KEY: key,
  WATCHDIVE_PUSH_VAPID_PRIVATE_KEY: "a".repeat(43),
  WATCHDIVE_PUSH_VAPID_SUBJECT: "mailto:push@example.com",
  WATCHDIVE_PUSH_STORE_DIR: "/mock/durable",
  WATCHDIVE_PUSH_RECEIPT_SECRET: "test-only-secret-at-least-32-characters",
  WATCHDIVE_PUBLIC_ORIGIN: "https://example.com",
};
const payload = {
  subscription: {
    endpoint: "https://fcm.googleapis.com/fcm/send/mock",
    keys: { p256dh: key, auth: "a".repeat(22) },
    expirationTime: null,
  },
  locale: "ko",
  consent: true,
  copyVersion: PUSH_COPY_VERSION,
};
function request(body: unknown = payload, options: { method?: string; origin?: string } = {}) {
  return new Request("https://example.com/api/push/subscription", {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      origin: options.origin ?? "https://example.com",
    },
    body: JSON.stringify(body),
  });
}
test("push stays disabled with any missing required credential/approval/storage; public shape reveals no secrets", () => {
  assert.equal(publicPushConfig({}).enabled, false);
  assert.equal(publicPushConfig({ ...env, VERCEL: "1" }).enabled, false);
  assert.equal(publicPushConfig(env).enabled, true);
  for (const field of Object.keys(env))
    assert.equal(publicPushConfig({ ...env, [field]: "" }).enabled, false, field);
  assert.deepEqual(Object.keys(publicPushConfig(env)).sort(), [
    "copyVersion",
    "enabled",
    "publicKey",
  ]);
  assert.equal(canOfferPush(publicPushConfig(env), false), false);
  assert.equal(decodeVapidPublicKey(key).length, 65);
  assert.throws(() => decodeVapidPublicKey("x".repeat(87)));
});
test("subscription validation requires explicit consent, exact locale/copy, safe endpoint and valid keys", () => {
  assert.ok(validatePushSubscription(payload));
  for (const bad of [
    { ...payload, consent: false },
    { ...payload, locale: "xx" },
    { ...payload, copyVersion: "unapproved" },
    { ...payload, subscription: { ...payload.subscription, endpoint: "http://127.0.0.1/" } },
    {
      ...payload,
      subscription: { ...payload.subscription, endpoint: "https://fcm.googleapis.com.evil.test/" },
    },
    { ...payload, subscription: { ...payload.subscription, keys: {} } },
  ])
    assert.equal(validatePushSubscription(bad), null);
});
test("only durable success returns enabled receipt; failures stay generic; no profile attributes stored", async () => {
  let stored: Record<string, unknown> = {};
  const deps = {
    env,
    store: {
      put: async (
        _: string,
        s: import("../src/lib/push/store.server.ts").StoredPushSubscription,
      ) => {
        stored = { ...s };
      },
      remove: async () => {},
    },
    allowRequest: () => true,
  };
  const response = await handlePushSubscription(request(), deps);
  const receipt = await response.json();
  assert.equal(response.status, 200);
  assert.equal(receipt.ok, true);
  assert.ok(validPushReceipt(receipt.id, receipt.receipt, env.WATCHDIVE_PUSH_RECEIPT_SECRET));
  assert.equal(stored.locale, "ko");
  assert.equal(stored.email, undefined);
  assert.equal(stored.verified, undefined);
  assert.equal(
    (
      await handlePushSubscription(request(), {
        ...deps,
        store: {
          ...deps.store,
          put: async () => {
            throw new Error("secret customer record");
          },
        },
      })
    ).status,
    503,
  );
  assert.equal((await handlePushSubscription(request(), { ...deps, env: {} })).status, 503);
  assert.equal(
    (await handlePushSubscription(request(payload, { origin: "https://evil.test" }), deps)).status,
    403,
  );
  assert.equal(
    (await handlePushSubscription(request(), { ...deps, allowRequest: () => false })).status,
    429,
  );
  assert.equal(
    (
      await handlePushSubscription(
        request({ id: receipt.id, receipt: "a".repeat(64) }, { method: "DELETE" }),
        deps,
      )
    ).status,
    403,
  );
  assert.equal(
    (await handlePushSubscription(request(receipt, { method: "DELETE" }), deps)).status,
    200,
  );
});
test("file adapter writes private durable rows and deletes idempotently, rejects path traversal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "watchdive-push-test-"));
  try {
    const store = filePushSubscriptionStore(directory);
    const id = pushId("https://fcm.googleapis.com/mock", env.WATCHDIVE_PUSH_RECEIPT_SECRET);
    await store.put(id, {
      ...validatePushSubscription(payload)!.subscription,
      consentAt: "2026-10-26T00:00:00Z",
    });
    assert.equal((await readdir(directory)).length, 1);
    assert.equal((await stat(join(directory, `${id}.json`))).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(join(directory, `${id}.json`), "utf8")).locale, "ko");
    await assert.rejects(() => store.remove("../bad"));
    await store.remove(id);
    await store.remove(id);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("rate gate bounds repeated requests and expires buckets; all nine opt-in locales exist", () => {
  let now = 0;
  const gate = createPushRateGate(() => now);
  for (let i = 0; i < 5; i++) assert.equal(gate("mock"), true);
  assert.equal(gate("mock"), false);
  now = 61000;
  assert.equal(gate("mock"), true);
  for (const locale of SUPPORTED_LOCALES)
    for (const value of Object.values(PUSH_COPY[locale])) assert.ok(value.length > 0);
});
test("revocation still works after new subscriptions are disabled; oversized requests do not persist", async () => {
  let writes = 0;
  let removals = 0;
  const deps = {
    env,
    store: {
      put: async () => {
        writes++;
      },
      remove: async () => {
        removals++;
      },
    },
    allowRequest: () => true,
  };
  const saved = await (await handlePushSubscription(request(), deps)).json();
  const disabled = {
    ...deps,
    env: { ...env, WATCHDIVE_PUSH_ENABLED: "false", WATCHDIVE_PUSH_COPY_APPROVED: "" },
  };
  assert.equal(
    (await handlePushSubscription(request(saved, { method: "DELETE" }), disabled)).status,
    200,
  );
  assert.equal(removals, 1);
  assert.equal((await handlePushSubscription(request(), disabled)).status, 503);
  assert.equal(
    (await handlePushSubscription(request({ data: "x".repeat(9000) }), deps)).status,
    413,
  );
  assert.equal(writes, 1);
});
