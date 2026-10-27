import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { jwtVerify, importJWK } from "jose";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import {
  publicPushConfig,
  pushRemovalConfigured,
  PUSH_COPY_VERSION,
} from "../src/lib/push/config.ts";
import {
  encryptSubscription,
  decryptSubscription,
  decryptWebPushMessage,
  encryptWebPushMessage,
  generateVapidKeys,
  vapidAuthorization,
} from "../src/lib/push/crypto.server.ts";
import { createNotionPushStore, createPushNotionRequest } from "../src/lib/push/notion.server.ts";
import { readPushPublicConfig } from "../src/lib/push/readiness.server.ts";
import { handlePushRoute } from "../src/lib/push/runtime.server.ts";
import { PUSH_SCHEMA_PLAN, PUSH_STATUSES, pushSchemaReady } from "../src/lib/push/schema.ts";
import { planPushRetention } from "../src/lib/push/retention.server.ts";
import { pushId } from "../src/lib/push/store.server.ts";
import { main } from "../scripts/push-operator.ts";
import { webPushTransport, type PushTransportRequest } from "../src/lib/push/sender.server.ts";

const DATABASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "ntn_test_push_token_dedicated";
const RECEIPT = "test-only-secret-at-least-32-characters";
const ENCRYPTION = "encryption-secret-different-32-chars";
const vapid = generateVapidKeys();

function notionEnv(overrides: Record<string, string> = {}) {
  return {
    VERCEL: "1",
    WATCHDIVE_PUSH_STORE: "notion",
    WATCHDIVE_PUSH_ENABLED: "true",
    WATCHDIVE_PUSH_COPY_APPROVED: PUSH_COPY_VERSION,
    WATCHDIVE_PUSH_VAPID_PUBLIC_KEY: vapid.publicKey,
    WATCHDIVE_PUSH_VAPID_PRIVATE_KEY: vapid.privateKey,
    WATCHDIVE_PUSH_VAPID_SUBJECT: "mailto:push@example.com",
    WATCHDIVE_PUSH_RECEIPT_SECRET: RECEIPT,
    WATCHDIVE_PUSH_ENCRYPTION_SECRET: ENCRYPTION,
    WATCHDIVE_PUSH_NOTION_TOKEN: TOKEN,
    WATCHDIVE_PUSH_NOTION_DB_ID: DATABASE_ID,
    WATCHDIVE_PUSH_SEND_ENABLED: "true",
    WATCHDIVE_PUBLIC_ORIGIN: "https://example.com",
    ...overrides,
  };
}

function browserKeys() {
  const agreement = createECDH("prime256v1");
  agreement.generateKeys();
  return {
    p256dh: agreement.getPublicKey(null, "uncompressed").toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
    privateKey: agreement.getPrivateKey(),
  };
}

function subscriptionBody(
  keys = browserKeys(),
  endpoint = "https://fcm.googleapis.com/fcm/send/mock",
) {
  return {
    subscription: {
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      expirationTime: null,
    },
    locale: "ko",
    consent: true,
    copyVersion: PUSH_COPY_VERSION,
  };
}

type StoredPage = {
  id: string;
  created_time: string;
  archived: boolean;
  properties: Record<string, unknown>;
};

function readySchema() {
  return {
    object: "database",
    archived: false,
    properties: {
      "Push id": { type: "title" },
      "Push status": {
        type: "select",
        select: { options: PUSH_STATUSES.map((name) => ({ name })) },
      },
      "Push locale": {
        type: "select",
        select: { options: SUPPORTED_LOCALES.map((name) => ({ name })) },
      },
      "Push consent version": { type: "rich_text" },
      "Push consent at": { type: "date" },
      "Push expires at": { type: "date" },
      "Push ciphertext": { type: "rich_text" },
      "Push key version": { type: "rich_text" },
      "Push campaign receipt": { type: "rich_text" },
      "Push updated at": { type: "date" },
    },
  };
}

function textContent(value: { text?: { content?: string }; plain_text?: string }) {
  return value.plain_text ?? value.text?.content ?? "";
}

type NotionWrite = {
  title?: { text?: { content?: string }; plain_text?: string }[];
  rich_text?: { text?: { content?: string }; plain_text?: string }[];
  select?: { name?: string };
  date?: { start?: string } | null;
};

function materialize(properties: Record<string, NotionWrite>) {
  const stored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(properties)) {
    if (value?.title)
      stored[name] = { title: value.title.map((item) => ({ plain_text: textContent(item) })) };
    else if (value?.rich_text) {
      stored[name] = {
        rich_text: value.rich_text.map((item) => ({ plain_text: textContent(item) })),
      };
    } else if (value?.select) stored[name] = { select: value.select };
    else if (value && "date" in value) stored[name] = { date: value.date };
  }
  return stored;
}

function plain(page: StoredPage, name: string) {
  const property = page.properties[name] as {
    title?: { plain_text: string }[];
    rich_text?: { plain_text: string }[];
  };
  const items = property?.title ?? property?.rich_text ?? [];
  return items.map((item) => item.plain_text).join("");
}

function createFakeNotion(options: { truncate?: boolean; schema?: unknown } = {}) {
  const pages: StoredPage[] = [];
  const calls: {
    method: string;
    url: string;
    body?: Record<string, unknown>;
    authorization?: string;
  }[] = [];
  let clock = Date.parse("2026-10-26T00:00:00.000Z");
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body
      ? (JSON.parse(String(init.body)) as {
          properties?: Record<string, NotionWrite>;
          archived?: boolean;
          filter?: { property?: string; title?: { equals?: string }; select?: { equals?: string } };
        })
      : undefined;
    const authorization = new Headers(init?.headers).get("authorization") ?? undefined;
    calls.push({ method: init?.method ?? "GET", url, body, authorization });
    assert.equal(authorization, `Bearer ${TOKEN}`);
    assert.equal(String(url).startsWith("https://api.notion.com/v1/"), true);
    if (url.endsWith(`/databases/${DATABASE_ID}`) && init?.method === "GET") {
      return Response.json(options.schema ?? readySchema());
    }
    if (url.endsWith("/pages") && init?.method === "POST") {
      const page: StoredPage = {
        id: crypto.randomUUID(),
        created_time: new Date(clock).toISOString(),
        archived: false,
        properties: materialize(body?.properties ?? {}),
      };
      clock += 1000;
      pages.push(page);
      return Response.json(page);
    }
    if (url.includes("/pages/") && init?.method === "PATCH") {
      const id = url.split("/pages/")[1];
      const page = pages.find((item) => item.id === id);
      if (!page) return new Response("missing", { status: 404 });
      page.properties = { ...page.properties, ...materialize(body?.properties ?? {}) };
      if (body?.archived === true) page.archived = true;
      return Response.json(page);
    }
    if (url.endsWith("/query") && init?.method === "POST") {
      if (options.truncate)
        return Response.json({ results: [], has_more: true, next_cursor: crypto.randomUUID() });
      const visible = pages.filter((page) => !page.archived);
      const filter = body?.filter;
      const results = visible.filter((page) => {
        if (!filter) return true;
        if (filter.property === "Push id") return plain(page, "Push id") === filter.title?.equals;
        if (filter.property === "Push status") {
          const status = page.properties["Push status"] as
            { select?: { name?: string } } | undefined;
          return status?.select?.name === filter.select?.equals;
        }
        return false;
      });
      return Response.json({ results, has_more: false, next_cursor: null });
    }
    return new Response("unexpected", { status: 500 });
  };
  return { fetchImpl, pages, calls };
}

function request(body: unknown, method = "POST") {
  return new Request("https://example.com/api/push/subscription", {
    method,
    headers: { "Content-Type": "application/json", origin: "https://example.com" },
    body: JSON.stringify(body),
  });
}

test("rfc 8291 appendix vector matches the encrypted example byte for byte", () => {
  const body = encryptWebPushMessage(Buffer.from("When I grow up, I want to be a watermelon"), {
    uaPublicKey: Buffer.from(
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      "base64url",
    ),
    authSecret: Buffer.from("BTBZMqHH6r4Tts7J_aSIgg", "base64url"),
    asPublicKey: Buffer.from(
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
      "base64url",
    ),
    asPrivateKey: Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"),
    salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"),
  });
  const expected = Buffer.from(
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    "base64url",
  );
  assert.equal(Buffer.compare(body, expected), 0);
  const opened = decryptWebPushMessage(
    expected,
    Buffer.from("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94", "base64url"),
    Buffer.from("BTBZMqHH6r4Tts7J_aSIgg", "base64url"),
  );
  assert.equal(opened.toString("utf8"), "When I grow up, I want to be a watermelon");
});

test("vapid authorization is an ES256 jwt for the push-service origin and carries no extra claims", async () => {
  const keys = generateVapidKeys();
  assert.match(keys.publicKey, /^B[A-Za-z0-9_-]{86}$/);
  const header = await vapidAuthorization({
    audience: "https://fcm.googleapis.com",
    subject: "mailto:push@example.com",
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    expiration: 1_900_000_000,
  });
  const token = header.slice("vapid t=".length, header.indexOf(", k="));
  assert.equal(header.endsWith(`, k=${keys.publicKey}`), true);
  const publicBytes = Buffer.from(keys.publicKey, "base64url");
  const verified = await jwtVerify(
    token,
    await importJWK(
      {
        kty: "EC",
        crv: "P-256",
        x: publicBytes.subarray(1, 33).toString("base64url"),
        y: publicBytes.subarray(33).toString("base64url"),
      },
      "ES256",
    ),
    { audience: "https://fcm.googleapis.com" },
  );
  assert.deepEqual(verified.payload, {
    aud: "https://fcm.googleapis.com",
    exp: 1_900_000_000,
    sub: "mailto:push@example.com",
  });
  assert.equal(header.includes("Crypto-Key"), false);
});

test("notion readiness fails closed without the live schema and file mode stays off on vercel", async () => {
  const fileEnv = {
    WATCHDIVE_PUSH_ENABLED: "true",
    WATCHDIVE_PUSH_COPY_APPROVED: PUSH_COPY_VERSION,
    WATCHDIVE_PUSH_VAPID_PUBLIC_KEY: vapid.publicKey,
    WATCHDIVE_PUSH_VAPID_PRIVATE_KEY: vapid.privateKey,
    WATCHDIVE_PUSH_VAPID_SUBJECT: "mailto:push@example.com",
    WATCHDIVE_PUSH_STORE_DIR: "/mock/durable",
    WATCHDIVE_PUSH_RECEIPT_SECRET: RECEIPT,
    WATCHDIVE_PUBLIC_ORIGIN: "https://example.com",
  };
  assert.equal(
    (
      await readPushPublicConfig(fileEnv, async () => {
        throw new Error("unused");
      })
    ).enabled,
    true,
  );
  assert.equal(publicPushConfig({ ...fileEnv, VERCEL: "1" }).enabled, false);
  assert.equal(pushRemovalConfigured({ ...fileEnv, VERCEL: "1" }), false);
  assert.equal(
    (
      await readPushPublicConfig(notionEnv(), async () => {
        throw new Error("down");
      })
    ).enabled,
    false,
  );
  assert.equal(publicPushConfig(notionEnv()).enabled, false);
  const missing = structuredClone(readySchema());
  delete missing.properties["Push ciphertext"];
  assert.equal(pushSchemaReady(missing), false);
  assert.equal(pushSchemaReady(readySchema()), true);
  assert.equal(PUSH_SCHEMA_PLAN.apply, false);
  assert.equal(PUSH_SCHEMA_PLAN.migratesSchema, false);
  const fake = createFakeNotion();
  const ready = await readPushPublicConfig(notionEnv(), fake.fetchImpl);
  assert.equal(ready.enabled, true);
  assert.equal(ready.copyVersion, PUSH_COPY_VERSION);
  assert.equal(
    (await readPushPublicConfig(notionEnv({ NOTION_WAITLIST_DB_ID: DATABASE_ID }), fake.fetchImpl))
      .enabled,
    false,
  );
  assert.equal(
    (await readPushPublicConfig(notionEnv({ NOTION_API_KEY: TOKEN }), fake.fetchImpl)).enabled,
    false,
  );
  assert.equal(
    (
      await readPushPublicConfig(
        notionEnv({ WATCHDIVE_PUSH_ENCRYPTION_SECRET: RECEIPT }),
        fake.fetchImpl,
      )
    ).enabled,
    false,
  );
  assert.deepEqual(
    Object.keys(PUSH_SCHEMA_PLAN.properties).sort(),
    [
      "Push campaign receipt",
      "Push ciphertext",
      "Push consent at",
      "Push consent version",
      "Push expires at",
      "Push id",
      "Push key version",
      "Push locale",
      "Push status",
      "Push updated at",
    ].sort(),
  );
});

test("notion adapter upserts encrypted rows, deletes without enrollment, and keeps no email", async () => {
  const fake = createFakeNotion();
  const env = notionEnv({ WATCHDIVE_PUSH_ENABLED: "false", WATCHDIVE_PUSH_COPY_APPROVED: "" });
  const keys = browserKeys();
  const body = subscriptionBody(keys);
  const denied = await handlePushRoute(request(body), env, {
    fetchImpl: fake.fetchImpl,
    allowRequest: () => true,
  });
  assert.equal(denied.status, 503);
  assert.equal(fake.pages.length, 0);
  const enrolled = notionEnv();
  const saved = await handlePushRoute(request(body), enrolled, {
    fetchImpl: fake.fetchImpl,
    allowRequest: () => true,
    now: () => new Date("2026-10-26T03:00:00.000Z"),
  });
  const receipt = await saved.json();
  assert.equal(saved.status, 200);
  assert.equal(fake.pages.filter((page) => !page.archived).length, 1);
  const page = fake.pages[0]!;
  const serialized = JSON.stringify(page);
  assert.equal(serialized.includes("fcm.googleapis.com"), false);
  assert.equal(serialized.includes(keys.auth), false);
  assert.equal(serialized.includes("email"), false);
  const id = pushId(body.subscription.endpoint, RECEIPT);
  assert.equal(plain(page, "Push id"), id);
  assert.deepEqual(decryptSubscription(ENCRYPTION, id, plain(page, "Push ciphertext")), {
    endpoint: body.subscription.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    expirationTime: null,
  });
  assert.throws(() =>
    decryptSubscription(ENCRYPTION, "f".repeat(64), plain(page, "Push ciphertext")),
  );
  const again = await handlePushRoute(request(body), enrolled, {
    fetchImpl: fake.fetchImpl,
    allowRequest: () => true,
    now: () => new Date("2026-10-26T04:00:00.000Z"),
  });
  assert.equal(again.status, 200);
  assert.equal(fake.pages.filter((page) => !page.archived).length, 1);
  const removed = await handlePushRoute(
    request({ id: receipt.id, receipt: receipt.receipt }, "DELETE"),
    env,
    {
      fetchImpl: fake.fetchImpl,
      allowRequest: () => true,
    },
  );
  assert.equal(removed.status, 200);
  assert.equal(fake.pages.filter((page) => !page.archived).length, 0);
  const repeat = await handlePushRoute(
    request({ id: receipt.id, receipt: receipt.receipt }, "DELETE"),
    env,
    {
      fetchImpl: fake.fetchImpl,
      allowRequest: () => true,
    },
  );
  assert.equal(repeat.status, 200);
  assert.equal(
    fake.calls.some((call) => call.method === "PATCH" && call.url.includes("/databases/")),
    false,
  );
});

test("sender dry-run does not write or post, and a real send is at-most-once with cleanup", async () => {
  const fake = createFakeNotion();
  const env = notionEnv();
  const keys = browserKeys();
  const endpoint = "https://fcm.googleapis.com/fcm/send/campaign";
  assert.equal(
    (
      await handlePushRoute(request(subscriptionBody(keys, endpoint)), env, {
        fetchImpl: fake.fetchImpl,
        allowRequest: () => true,
      })
    ).status,
    200,
  );
  const store = createNotionPushStore({
    request: createPushNotionRequest(fake.fetchImpl, TOKEN),
    databaseId: DATABASE_ID,
    encryptionSecret: ENCRYPTION,
    now: () => new Date("2026-10-26T05:00:00.000Z"),
  });
  const posts: PushTransportRequest[] = [];
  const transport = async (request: PushTransportRequest) => {
    posts.push(request);
    return { status: 201 };
  };
  const { runPushCampaign } = await import("../src/lib/push/sender.server.ts");
  const before = fake.calls.filter((call) => call.method === "PATCH").length;
  const dry = await runPushCampaign({
    mode: "dry-run",
    directory: store,
    transport,
    env,
    now: new Date("2026-10-26T05:00:00.000Z"),
  });
  assert.equal(dry.eligible, 1);
  assert.equal(dry.attempted, 0);
  assert.equal(dry.exactlyOnce, false);
  assert.equal(posts.length, 0);
  assert.equal(fake.calls.filter((call) => call.method === "PATCH").length, before);
  const sent = await runPushCampaign({
    mode: "send",
    directory: store,
    transport,
    env,
    now: new Date("2026-10-26T05:00:00.000Z"),
  });
  assert.equal(sent.attempted, 1);
  assert.equal(posts.length, 1);
  const message = posts[0]!;
  assert.equal(message.url, endpoint);
  assert.equal(message.headers["Content-Encoding"], "aes128gcm");
  assert.equal(message.headers.TTL, "86400");
  assert.equal(message.headers.Topic, "watchdive-launch");
  assert.equal(message.headers.Urgency, "normal");
  assert.equal(Buffer.from(message.body).toString("utf8").includes("launch"), false);
  assert.equal(message.headers.Authorization?.startsWith("vapid t="), true);
  const repeat = await runPushCampaign({
    mode: "send",
    directory: store,
    transport,
    env,
    now: new Date("2026-10-26T06:00:00.000Z"),
  });
  assert.equal(repeat.skipped, 1);
  assert.equal(posts.length, 1);
  const listed = await store.listActive();
  assert.equal(listed.subscriptions[0]?.receipt.includes("|accepted|"), true);

  const gone = createFakeNotion();
  const goneKeys = browserKeys();
  await handlePushRoute(
    request(subscriptionBody(goneKeys, "https://updates.push.services.mozilla.com/wpush/v2/mock")),
    env,
    {
      fetchImpl: gone.fetchImpl,
      allowRequest: () => true,
    },
  );
  const goneStore = createNotionPushStore({
    request: createPushNotionRequest(gone.fetchImpl, TOKEN),
    databaseId: DATABASE_ID,
    encryptionSecret: ENCRYPTION,
  });
  let goneCalls = 0;
  await runPushCampaign({
    mode: "send",
    directory: goneStore,
    transport: async () => {
      goneCalls++;
      return { status: 410 };
    },
    env,
    now: new Date("2026-10-26T05:00:00.000Z"),
  });
  assert.equal(goneCalls, 1);
  assert.equal((await goneStore.listActive()).subscriptions.length, 0);
  assert.equal(
    gone.pages.every((page) => page.archived),
    true,
  );

  const unauthorized = createFakeNotion();
  await handlePushRoute(
    request(subscriptionBody(browserKeys(), "https://fcm.googleapis.com/fcm/send/one")),
    env,
    {
      fetchImpl: unauthorized.fetchImpl,
      allowRequest: () => true,
    },
  );
  await handlePushRoute(
    request(subscriptionBody(browserKeys(), "https://fcm.googleapis.com/fcm/send/two")),
    env,
    {
      fetchImpl: unauthorized.fetchImpl,
      allowRequest: () => true,
    },
  );
  const unauthorizedStore = createNotionPushStore({
    request: createPushNotionRequest(unauthorized.fetchImpl, TOKEN),
    databaseId: DATABASE_ID,
    encryptionSecret: ENCRYPTION,
  });
  let unauthorizedCalls = 0;
  const stopped = await runPushCampaign({
    mode: "send",
    directory: unauthorizedStore,
    transport: async () => {
      unauthorizedCalls++;
      return { status: 401 };
    },
    env,
    now: new Date("2026-10-26T05:00:00.000Z"),
  });
  assert.equal(stopped.aborted, "push_unauthorized");
  assert.equal(unauthorizedCalls, 1);
  assert.equal(
    (await unauthorizedStore.listActive()).subscriptions.every((row) => row.receipt === ""),
    true,
  );
});

test("a revoke after the directory listing cancels the push before the network call", async () => {
  const { runPushCampaign } = await import("../src/lib/push/sender.server.ts");
  const env = notionEnv();
  const keys = browserKeys();
  const inner = createNotionPushStore({
    request: createPushNotionRequest(createFakeNotion().fetchImpl, TOKEN),
    databaseId: DATABASE_ID,
    encryptionSecret: ENCRYPTION,
  });
  const endpoint = "https://fcm.googleapis.com/fcm/send/revoke-after-list";
  const id = pushId(endpoint, RECEIPT);
  await inner.put(id, {
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    expirationTime: null,
    locale: "en",
    consentVersion: PUSH_COPY_VERSION,
    consentAt: "2026-10-26T00:00:00.000Z",
  });
  let calls = 0;
  const report = await runPushCampaign({
    mode: "send",
    directory: {
      ...inner,
      async setReceipt(subscriptionId, receipt) {
        await inner.setReceipt(subscriptionId, receipt);
        if (receipt.includes("|pending|")) await inner.setStatus(subscriptionId, "revoked", false);
      },
    },
    transport: async () => {
      calls++;
      return { status: 201 };
    },
    env,
    now: new Date("2026-10-26T05:00:00.000Z"),
  });
  assert.equal(calls, 0);
  assert.equal(report.attempted, 0);
  assert.equal(report.withheld, 1);
  assert.equal(report.exactlyOnce, false);
  assert.equal(await inner.getReceipt(id), "");
  assert.equal((await inner.listActive()).subscriptions.length, 0);
});

test("expired, foreign, contested, truncated and unapproved sends do not post", async () => {
  const { runPushCampaign } = await import("../src/lib/push/sender.server.ts");
  const env = notionEnv();
  const expired = createFakeNotion();
  const keys = browserKeys();
  const expiredStore = createNotionPushStore({
    request: createPushNotionRequest(expired.fetchImpl, TOKEN),
    databaseId: DATABASE_ID,
    encryptionSecret: ENCRYPTION,
  });
  await expiredStore.put(pushId("https://fcm.googleapis.com/fcm/send/expired", RECEIPT), {
    endpoint: "https://fcm.googleapis.com/fcm/send/expired",
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    expirationTime: Date.parse("2020-01-01T00:00:00.000Z"),
    locale: "en",
    consentVersion: PUSH_COPY_VERSION,
    consentAt: "2026-10-26T00:00:00.000Z",
  });
  let calls = 0;
  const expiredReport = await runPushCampaign({
    mode: "send",
    directory: expiredStore,
    transport: async () => {
      calls++;
      return { status: 201 };
    },
    env,
    now: new Date("2026-10-26T05:00:00.000Z"),
  });
  assert.equal(expiredReport.expired, 1);
  assert.equal(calls, 0);
  assert.equal((await expiredStore.listActive()).subscriptions.length, 0);

  const foreign = createFakeNotion();
  const foreignStore = createNotionPushStore({
    request: createPushNotionRequest(foreign.fetchImpl, TOKEN),
    databaseId: DATABASE_ID,
    encryptionSecret: ENCRYPTION,
  });
  const id = pushId("https://evil.example/push", RECEIPT);
  await foreignStore.put(id, {
    endpoint: "https://evil.example/push",
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    expirationTime: null,
    locale: "en",
    consentVersion: PUSH_COPY_VERSION,
    consentAt: "2026-10-26T00:00:00.000Z",
  });
  const foreignReport = await runPushCampaign({
    mode: "send",
    directory: foreignStore,
    transport: async () => {
      calls++;
      return { status: 201 };
    },
    env,
    now: new Date("2026-10-26T05:00:00.000Z"),
  });
  assert.equal(foreignReport.rejectedEndpoint, 1);
  assert.equal(calls, 0);

  const contestedFake = createFakeNotion();
  await handlePushRoute(request(subscriptionBody(browserKeys())), env, {
    fetchImpl: contestedFake.fetchImpl,
    allowRequest: () => true,
  });
  const inner = createNotionPushStore({
    request: createPushNotionRequest(contestedFake.fetchImpl, TOKEN),
    databaseId: DATABASE_ID,
    encryptionSecret: ENCRYPTION,
  });
  const contested = {
    ...inner,
    async getReceipt(receiptId: string) {
      const value = await inner.getReceipt(receiptId);
      return value.includes("|pending|") ? `${value}other` : value;
    },
  };
  const contestedReport = await runPushCampaign({
    mode: "send",
    directory: contested,
    transport: async () => {
      calls++;
      return { status: 201 };
    },
    env,
    now: new Date("2026-10-26T05:00:00.000Z"),
  });
  assert.equal(contestedReport.contested, 1);
  assert.equal(calls, 0);

  const truncated = createFakeNotion({ truncate: true });
  const truncatedStore = createNotionPushStore({
    request: createPushNotionRequest(truncated.fetchImpl, TOKEN),
    databaseId: DATABASE_ID,
    encryptionSecret: ENCRYPTION,
  });
  const truncatedReport = await runPushCampaign({
    mode: "send",
    directory: truncatedStore,
    transport: async () => {
      calls++;
      return { status: 201 };
    },
    env,
    now: new Date("2026-10-26T05:00:00.000Z"),
  });
  assert.equal(truncatedReport.aborted, "directory_truncated");
  assert.equal(calls, 0);
  assert.equal(truncated.calls.filter((call) => call.url.endsWith("/query")).length, 20);

  const refused = await runPushCampaign({
    mode: "send",
    directory: expiredStore,
    transport: async () => {
      calls++;
      return { status: 201 };
    },
    env: { ...env, WATCHDIVE_PUSH_SEND_ENABLED: "false" },
    now: new Date("2026-10-26T05:00:00.000Z"),
  });
  assert.equal(refused.aborted, "send_not_confirmed");
  assert.equal(calls, 0);
});

test("retention apply archives only aged terminal rows and dry-run writes nothing", async () => {
  const now = new Date("2026-10-26T00:00:00.000Z");
  const old = "2026-01-01T00:00:00.000Z";
  const rows = [
    {
      id: "a".repeat(64),
      status: "active" as const,
      expiresAt: "2026-10-01T00:00:00.000Z",
      updatedAt: old,
    },
    { id: "b".repeat(64), status: "active" as const, expiresAt: null, updatedAt: old },
    { id: "c".repeat(64), status: "gone" as const, expiresAt: null, updatedAt: old },
    {
      id: "d".repeat(64),
      status: "expired" as const,
      expiresAt: null,
      updatedAt: now.toISOString(),
    },
  ];
  const plan = planPushRetention(rows, now, 30);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.expire, ["a".repeat(64)]);
  assert.deepEqual(
    plan.archive.map((row) => row.id),
    ["c".repeat(64)],
  );
  const fake = createFakeNotion();
  const env = notionEnv({ WATCHDIVE_PUSH_RETENTION_DAYS: "30" });
  const lines: string[] = [];
  assert.equal(
    await main(["retain"], env, {
      fetchImpl: fake.fetchImpl,
      print: (line) => lines.push(line),
      now,
    }),
    0,
  );
  assert.equal(lines.join("").includes('applied":false'), true);
  assert.equal(
    fake.calls.some((call) => call.method === "PATCH"),
    false,
  );
  const store = createNotionPushStore({
    request: createPushNotionRequest(fake.fetchImpl, TOKEN),
    databaseId: DATABASE_ID,
    encryptionSecret: ENCRYPTION,
    now: () => now,
  });
  await store.put("c".repeat(64), {
    endpoint: "https://fcm.googleapis.com/fcm/send/old",
    keys: { p256dh: browserKeys().p256dh, auth: browserKeys().auth },
    expirationTime: null,
    locale: "en",
    consentVersion: PUSH_COPY_VERSION,
    consentAt: old,
  });
  const page = fake.pages.find((item) => plain(item, "Push id") === "c".repeat(64))!;
  page.properties["Push status"] = { select: { name: "gone" } };
  page.properties["Push updated at"] = { date: { start: old } };
  lines.length = 0;
  assert.equal(
    await main(["retain", "--apply"], env, {
      fetchImpl: fake.fetchImpl,
      print: (line) => lines.push(line),
      now,
    }),
    0,
  );
  assert.equal(page.archived, true);
  assert.equal(lines.join("").includes(TOKEN), false);
  assert.equal(lines.join("").includes("fcm.googleapis.com"), false);
});

test("operator command defaults to no network and refuses schema mutation or an unconfirmed send", async () => {
  const fake = createFakeNotion();
  const env = notionEnv();
  const keys = browserKeys();
  await handlePushRoute(request(subscriptionBody(keys)), env, {
    fetchImpl: fake.fetchImpl,
    allowRequest: () => true,
  });
  const lines: string[] = [];
  const print = (line: string) => lines.push(line);
  assert.equal(await main([], env, { fetchImpl: fake.fetchImpl, print }), 0);
  assert.equal(
    await main(["send"], env, {
      fetchImpl: fake.fetchImpl,
      print,
      now: new Date("2026-10-26T05:00:00.000Z"),
    }),
    0,
  );
  assert.equal(lines.at(-1)?.includes('"mode":"dry-run"'), true);
  assert.equal(lines.at(-1)?.includes('"attempted":0'), true);
  assert.equal(lines.join("").includes(keys.p256dh), false);
  assert.equal(lines.join("").includes(TOKEN), false);
  assert.equal(await main(["send", "--send"], env, { fetchImpl: fake.fetchImpl, print }), 2);
  assert.equal(await main(["--apply-schema"], env, { fetchImpl: fake.fetchImpl, print }), 2);
  const posts: string[] = [];
  assert.equal(
    await main(["send", "--send", "--confirm-campaign", PUSH_COPY_VERSION], env, {
      fetchImpl: fake.fetchImpl,
      print,
      now: new Date("2026-10-26T05:00:00.000Z"),
      transport: async (message) => {
        posts.push(message.url);
        return { status: 201 };
      },
    }),
    0,
  );
  assert.deepEqual(posts, ["https://fcm.googleapis.com/fcm/send/mock"]);
  const broken = createFakeNotion({ schema: { object: "database", properties: {} } });
  assert.equal(await main(["send"], notionEnv(), { fetchImpl: broken.fetchImpl, print }), 2);
  assert.equal(
    broken.calls.every((call) => call.method === "GET"),
    true,
  );
  const configRoute = readFileSync(
    new URL("../src/routes/api/push/config.ts", import.meta.url),
    "utf8",
  );
  const subscriptionRoute = readFileSync(
    new URL("../src/routes/api/push/subscription.ts", import.meta.url),
    "utf8",
  );
  assert.equal(configRoute.includes("readPushPublicConfig"), true);
  assert.equal(subscriptionRoute.includes("handlePushRoute"), true);
});

test("web push transport copies a byte view into an ArrayBuffer before fetch", async () => {
  const backing = new Uint8Array([9, 1, 2, 3, 4, 8]);
  const view = backing.subarray(1, 5);
  let seen: BodyInit | null | undefined;
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    seen = init?.body ?? null;
    return new Response(null, { status: 201 });
  };
  try {
    const result = await webPushTransport({
      url: "https://fcm.googleapis.com/fcm/send/independent-qa",
      method: "POST",
      headers: { "content-encoding": "aes128gcm" },
      body: view,
    });
    assert.equal(result.status, 201);
    assert.ok(seen instanceof ArrayBuffer);
    assert.deepEqual(Array.from(new Uint8Array(seen)), [1, 2, 3, 4]);
    view[0] = 7;
    assert.equal(new Uint8Array(seen)[0], 1);
  } finally {
    globalThis.fetch = previous;
  }
});
