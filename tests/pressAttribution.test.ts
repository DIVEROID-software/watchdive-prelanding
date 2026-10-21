// Press attribution: a press link is kept with the row, and reported to the
// press tracker only when the signup completes (email confirmed, or a social
// sign-in lead write). A form submission alone is never reported. Every
// address below is a reserved test domain.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { beforeEach, test } from "node:test";
import vm from "node:vm";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import { setCanonicalEmailShape } from "../src/lib/api/notionCanonicalEmail.ts";
import { completeSocialIdentity } from "../src/lib/socialAuth/complete.ts";
import { newSocialState, readSocialState, signSocialState } from "../src/lib/socialAuth/state.ts";
import type { CreatePendingInput } from "../src/lib/verification/contracts.ts";
import { NotionRequestError, createNotionLeadStore, toLeadRecord, type NotionRequest } from "../src/lib/verification/notionLead.ts";
import { confirmVerificationService, requestVerificationService } from "../src/lib/verification/service.ts";
import { createVerificationToken } from "../src/lib/verification/token.ts";
import {
  FIELD_PRESS_EVENT,
  FIELD_PRESS_SYNC,
  deliverPressEvent,
  parsePressOutbox,
  pressAttributionEnabled,
  pressEvent,
  pressOutboxFor,
  pressSubscriberKey,
  reportPressStage,
  sanitizePressRef,
  type PressSignupEvent,
} from "../src/lib/press/pressAttribution.server.ts";
import { replayPressOutbox } from "../src/lib/press/pressReplay.server.ts";
import { PRESS_REF_BOOTSTRAP, getPressRef } from "../src/lib/pressRef.ts";
import { planPressNotionSchema } from "../src/lib/press/pressNotionSchema.ts";
import { runPressNotionSchema } from "../scripts/press-attribution-notion-schema.ts";
import { FakeLeadStore, FakeMailer, TEST_ENV, TEST_SECRET, leadIdFactory } from "./helpers/fakes.ts";

const PRESS_SECRET = "press-tracking-test-secret-0123456789";
const PRESS_ENV = {
  PRESS_ATTRIBUTION_ENABLED: "1",
  PRESS_TRACKING_SECRET: PRESS_SECRET,
  PRESS_PORTAL_ORIGIN: "https://diveroid.ai",
};
const REF = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v";
const EMAIL = "reader@example.com";
const CANONICAL = canonicalEmail(EMAIL);

type Reported = { stage: string; row: { pageId: string; pressOutbox?: string; occurredAt: string } };

let store: FakeLeadStore;
let mailer: FakeMailer;
let reported: Reported[];
let clock: Date;

function deps(overrides: Record<string, unknown> = {}) {
  return {
    store,
    mailer,
    env: { ...TEST_ENV, ...PRESS_ENV },
    now: () => clock,
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async () => {},
    reportPress: async (stage: string, row: Reported["row"]) => {
      reported.push({ stage, row });
      return "delivered";
    },
    ...overrides,
  };
}

function submit(overrides: Record<string, unknown> = {}) {
  return {
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    flags: [] as string[],
    suspect: false,
    measurementConsent: false,
    networkSendBlocked: false,
    pressRef: REF,
    ...overrides,
  };
}

beforeEach(() => {
  store = new FakeLeadStore();
  mailer = new FakeMailer();
  reported = [];
  clock = new Date("2026-10-21T08:00:00.000Z");
  for (const [key, value] of Object.entries(PRESS_ENV)) process.env[key] = value;
});

test("press data is off unless enabled with a strong secret and an https origin", () => {
  const input = { pressRef: REF, canonical: CANONICAL, signedUpAt: clock.toISOString(), flagged: false };
  assert.equal(pressOutboxFor(input, {}), undefined);
  assert.equal(pressOutboxFor(input, { ...PRESS_ENV, PRESS_ATTRIBUTION_ENABLED: "true" }), undefined);
  assert.equal(pressOutboxFor(input, { ...PRESS_ENV, PRESS_TRACKING_SECRET: "short" }), undefined);
  assert.equal(pressOutboxFor(input, { ...PRESS_ENV, PRESS_PORTAL_ORIGIN: "http://diveroid.ai" }), undefined);
  assert.equal(pressOutboxFor(input, { ...PRESS_ENV, PRESS_PORTAL_ORIGIN: "https://diveroid.ai/api" }), undefined);
  assert.equal(pressAttributionEnabled(PRESS_ENV), true);
  assert.equal(pressOutboxFor({ ...input, pressRef: "not-a-ref" }, PRESS_ENV), undefined);
  for (const bad of [undefined, "", "x".repeat(43) + "y", "../" + REF.slice(3), 42]) assert.equal(sanitizePressRef(bad), undefined);
});

test("the kept reference and the report carry no contact data", () => {
  const cell = pressOutboxFor({ pressRef: REF, canonical: CANONICAL, signedUpAt: clock.toISOString(), flagged: false }, PRESS_ENV)!;
  assert.equal(cell.includes("@"), false);
  assert.equal(cell.includes("reader"), false);
  const outbox = parsePressOutbox(cell)!;
  assert.equal(outbox.subscriberKey, createHmac("sha256", PRESS_SECRET).update(`press-subscriber:v1:${CANONICAL}`).digest("hex"));
  assert.equal(outbox.subscriberKey, pressSubscriberKey(PRESS_SECRET, CANONICAL));
  const accepted = pressEvent(outbox, "accepted", outbox.signedUpAt);
  const confirmed = pressEvent(outbox, "confirmed", "2026-10-21T09:00:00.000Z");
  assert.deepEqual(Object.keys(accepted).sort(), ["eventId", "flagged", "occurredAt", "ref", "signedUpAt", "stage", "subscriberKey", "v"]);
  assert.notEqual(accepted.eventId, confirmed.eventId);
  assert.equal(pressEvent(outbox, "accepted", "2030-01-01T00:00:00.000Z").eventId, accepted.eventId, "replays reuse the id");
  assert.equal(parsePressOutbox('{"v":1,"ref":"x"}'), undefined);
  assert.equal(parsePressOutbox("not json"), undefined);
});

test("delivery signs the exact body and maps every answer", async () => {
  const event = pressEvent(parsePressOutbox(pressOutboxFor({ pressRef: REF, canonical: CANONICAL, signedUpAt: clock.toISOString(), flagged: false }, PRESS_ENV))!, "confirmed", clock.toISOString());
  const answers: [number, unknown, string][] = [
    [200, { ok: true, outcome: "created" }, "delivered"],
    [200, { ok: true, outcome: "duplicate" }, "delivered"],
    [200, { ok: true, outcome: "ignored", reason: "inactive" }, "ignored"],
    [400, { error: "invalid" }, "invalid"],
    [401, { error: "unauthorized" }, "retry"],
    [409, { error: "conflict" }, "retry"],
    [503, { error: "unavailable" }, "retry"],
    [200, { ok: false }, "retry"],
  ];
  for (const [status, body, expected] of answers) {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetcher = (async (url: URL, init: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    assert.equal(await deliverPressEvent(event, PRESS_ENV, fetcher), expected, `${status} ${JSON.stringify(body)}`);
    assert.equal(seen!.url, "https://diveroid.ai/api/press/signup");
    const headers = seen!.init.headers as Record<string, string>;
    const expectedSignature = createHmac("sha256", PRESS_SECRET).update(`${headers["X-Press-Timestamp"]}.${seen!.init.body}`).digest("hex");
    assert.equal(headers["X-Press-Signature"], expectedSignature);
    assert.equal(seen!.init.redirect, "error");
  }
  const offline = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
  assert.equal(await deliverPressEvent(event, PRESS_ENV, offline), "retry");
  let called = false;
  const never = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  assert.equal(await deliverPressEvent(event, { ...PRESS_ENV, PRESS_PORTAL_ORIGIN: "https://diveroid.ai/x?y" }, never), "retry");
  assert.equal(called, false);
});

test("a form submission keeps the reference on the row and reports nothing", async () => {
  const res = await requestVerificationService(submit(), deps());
  assert.equal(res.status, "pending");
  assert.equal(mailer.sent.length, 1, "the signup flow itself is unchanged");
  const input = store.createPendingInputs[0] as CreatePendingInput;
  assert.equal(input.pressSync, "held");
  const outbox = parsePressOutbox(input.pressOutbox)!;
  assert.equal(outbox.ref, REF);
  assert.equal(outbox.flagged, false);
  assert.equal(reported.length, 0, "a submit is not a signup");

  // A resubmit of the same address is a resend: no second row, nothing reported.
  clock = new Date(clock.getTime() + 10 * 60_000);
  await requestVerificationService(submit(), deps());
  assert.equal(store.createPendingInputs.length, 1);
  assert.equal(reported.length, 0);

  // A suppressed submit keeps a flagged reference and is never mailed or reported.
  store = new FakeLeadStore();
  mailer = new FakeMailer();
  await requestVerificationService(submit({ flags: ["honeypot"], suspect: true }), deps());
  assert.equal(mailer.sent.length, 0);
  assert.equal(parsePressOutbox((store.createPendingInputs[0] as CreatePendingInput).pressOutbox)!.flagged, true);
  assert.equal(reported.length, 0);

  // No press link, or attribution off: nothing kept.
  store = new FakeLeadStore();
  await requestVerificationService(submit({ pressRef: undefined }), deps());
  assert.equal((store.createPendingInputs[0] as CreatePendingInput).pressOutbox, undefined);
  store = new FakeLeadStore();
  await requestVerificationService(submit(), deps({ env: TEST_ENV }));
  assert.equal((store.createPendingInputs[0] as CreatePendingInput).pressOutbox, undefined);
});

test("the first email confirmation reports a confirmed signup once", async () => {
  await requestVerificationService(submit(), deps());
  const row = (await store.findByEmail(CANONICAL, EMAIL))!;
  const token = createVerificationToken(row.leadId, clock.getTime() + 86_400_000, false, TEST_SECRET, "en");
  clock = new Date(clock.getTime() + 60_000);
  const confirmed = await confirmVerificationService(token, deps());
  assert.equal(confirmed.status, "verified");
  assert.deepEqual(reported.map((r) => r.stage), ["confirmed"]);
  assert.equal(reported[0].row.pageId, row.pageId);
  assert.equal(reported[0].row.occurredAt, clock.toISOString());
  assert.equal(parsePressOutbox(reported[0].row.pressOutbox)!.ref, REF);

  const again = await confirmVerificationService(token, deps());
  assert.equal(again.status, "already_verified");
  assert.equal(reported.length, 1, "a second click is not a second signup");
});

test("a confirmation is not reported for a settled or a press-less row, nor can a reporter break it", async () => {
  await requestVerificationService(submit(), deps());
  const row = (await store.findByEmail(CANONICAL, EMAIL))!;
  store.seed({ ...row, canonical: CANONICAL, pressSync: "ignored" });
  const token = createVerificationToken(row.leadId, clock.getTime() + 86_400_000, false, TEST_SECRET, "en");
  assert.equal((await confirmVerificationService(token, deps())).status, "verified");
  assert.equal(reported.length, 0, "an ignored link stays ignored");

  store = new FakeLeadStore();
  await requestVerificationService(submit({ pressRef: undefined }), deps());
  const plain = (await store.findByEmail(CANONICAL, EMAIL))!;
  await confirmVerificationService(createVerificationToken(plain.leadId, clock.getTime() + 86_400_000, false, TEST_SECRET, "en"), deps());
  assert.equal(reported.length, 0);

  store = new FakeLeadStore();
  await requestVerificationService(submit(), deps());
  const failing = (await store.findByEmail(CANONICAL, EMAIL))!;
  const result = await confirmVerificationService(
    createVerificationToken(failing.leadId, clock.getTime() + 86_400_000, false, TEST_SECRET, "en"),
    deps({ reportPress: async () => { throw new Error("tracker down"); } }),
  );
  assert.equal(result.status, "verified", "the confirmation itself never depends on the tracker");
});

function socialBound(provider: "google" | "apple", withPress = true) {
  return newSocialState(
    {
      provider,
      source: "hero",
      locale: "en",
      origin: "https://watchdive.diveroid.com",
      attribution: {},
      measurementConsent: false,
      country: { trustedVercel: false, header: null },
      ...(withPress ? { pressRef: REF } : {}),
    },
    clock.getTime(),
  );
}

test("social sign-in: a verified lead write is confirmed, an unverified one accepted", async () => {
  const gmail = await completeSocialIdentity({
    provider: "google",
    claims: { sub: "google-sub-0001", email: "press.fixture.0001@gmail.com", email_verified: true },
    bound: socialBound("google"),
    dependencies: deps(),
    now: clock,
    relayReady: true,
    blocked: false,
  });
  assert.equal(gmail, "confirmed");
  assert.deepEqual(reported.map((r) => r.stage), ["confirmed"]);
  const created = store.createPendingInputs[0] as CreatePendingInput;
  assert.equal(created.pressSync, "pending");
  assert.equal(parsePressOutbox(created.pressOutbox)!.ref, REF);

  reported = [];
  const relay = await completeSocialIdentity({
    provider: "apple",
    claims: { sub: "apple-sub-0001", email: "x1y2z3@privaterelay.appleid.com", email_verified: true, is_private_email: true },
    bound: socialBound("apple"),
    dependencies: deps(),
    now: clock,
    relayReady: false,
    blocked: false,
  });
  assert.equal(relay, "pending");
  assert.deepEqual(reported.map((r) => r.stage), ["accepted"], "lead written, address not verified");

  reported = [];
  const external = await completeSocialIdentity({
    provider: "google",
    claims: { sub: "google-sub-0002", email: "press.fixture.0002@example.org", email_verified: true },
    bound: socialBound("google"),
    dependencies: deps(),
    now: clock,
    relayReady: true,
    blocked: false,
  });
  assert.equal(external, "check-email");
  assert.equal(reported.length, 0, "an external address waits for its mailed link");
  const held = store.createPendingInputs[store.createPendingInputs.length - 1] as CreatePendingInput;
  assert.equal(held.pressSync, "held");

  reported = [];
  await completeSocialIdentity({
    provider: "google",
    claims: { sub: "google-sub-0003", email: "press.fixture.0003@gmail.com", email_verified: true },
    bound: socialBound("google", false),
    dependencies: deps(),
    now: clock,
    relayReady: true,
    blocked: false,
  });
  assert.equal(reported.length, 0, "no press link, nothing to report");
});

test("the signed OAuth state carries the reference and rejects a malformed one", () => {
  const secret = "social-auth-secret-must-be-32-bytes";
  const env = { WATCHDIVE_PUBLIC_ORIGIN: "https://watchdive.diveroid.com" };
  const state = socialBound("google");
  const read = readSocialState(signSocialState(state, secret), secret, env as never, clock.getTime());
  assert.equal(read?.pressRef, REF);
  const forged = readSocialState(signSocialState({ ...state, pressRef: "bad" }, secret), secret, env as never, clock.getTime());
  assert.equal(forged, undefined);
});

test("the Notion row stores both press cells and falls back when the columns are missing", async () => {
  setCanonicalEmailShape("email");
  const cell = pressOutboxFor({ pressRef: REF, canonical: CANONICAL, signedUpAt: clock.toISOString(), flagged: false }, PRESS_ENV)!;
  const input: CreatePendingInput = {
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    refCode: "abcd1234",
    flags: [],
    suspect: false,
    signedUpAt: clock.toISOString(),
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
    expiresAt: new Date(clock.getTime() + 86_400_000).toISOString(),
    pressOutbox: cell,
  };
  const writes: Record<string, unknown>[] = [];
  const page = (properties: Record<string, unknown>) => ({ id: "11111111-2222-4333-8444-555555555555", properties });
  const accepting: NotionRequest = async (_method, _path, body) => {
    const properties = (body as { properties: Record<string, unknown> }).properties;
    writes.push(properties);
    return page(properties);
  };
  await createNotionLeadStore(accepting, "db").createPending(input);
  await createNotionLeadStore(accepting, "db").createPending({ ...input, pressSync: "pending" });
  const written = writes as Record<string, { rich_text: { text: { content: string } }[] }>[];
  assert.equal(written[0][FIELD_PRESS_EVENT].rich_text[0].text.content, cell);
  assert.equal(written[0][FIELD_PRESS_SYNC].rich_text[0].text.content, "held", "held by default");
  assert.equal(written[1][FIELD_PRESS_SYNC].rich_text[0].text.content, "pending");

  const roundTrip = toLeadRecord({
    id: "11111111-2222-4333-8444-555555555555",
    properties: {
      [FIELD_PRESS_EVENT]: { rich_text: [{ plain_text: cell }] },
      [FIELD_PRESS_SYNC]: { rich_text: [{ plain_text: "accepted" }] },
    },
  })!;
  assert.equal(roundTrip.pressOutbox, cell);
  assert.equal(roundTrip.pressSync, "accepted");

  const tries: Record<string, unknown>[] = [];
  const missingColumns: NotionRequest = async (_method, _path, body) => {
    const properties = (body as { properties: Record<string, unknown> }).properties;
    tries.push(properties);
    if (FIELD_PRESS_EVENT in properties) {
      throw new NotionRequestError(400, JSON.stringify({ code: "validation_error", message: `${FIELD_PRESS_EVENT} is not a property that exists.` }));
    }
    return page(properties);
  };
  const saved = await createNotionLeadStore(missingColumns, "db").createPending(input);
  assert.equal(tries.length, 2, "retried once without the press cells");
  assert.equal(FIELD_PRESS_EVENT in tries[1], false);
  assert.equal(FIELD_PRESS_SYNC in tries[1], false);
  assert.equal(saved.pageId, "11111111-2222-4333-8444-555555555555", "the signup is kept");
});

test("live report marks Press sync from the tracker's answer", async () => {
  const cell = pressOutboxFor({ pressRef: REF, canonical: CANONICAL, signedUpAt: clock.toISOString(), flagged: false }, PRESS_ENV)!;
  const patches: { path: string; state: string }[] = [];
  const notion: NotionRequest = async (_method, path, body) => {
    const state = (body as { properties: Record<string, { rich_text: { text: { content: string } }[] }> }).properties[FIELD_PRESS_SYNC].rich_text[0].text.content;
    patches.push({ path, state });
    return {};
  };
  const answer = (outcome: unknown, status = 200) => (async () => new Response(JSON.stringify(outcome), { status })) as unknown as typeof fetch;
  assert.equal(await reportPressStage("accepted", { pageId: "p1", pressOutbox: cell, occurredAt: clock.toISOString() }, notion, PRESS_ENV, answer({ ok: true, outcome: "created" })), "delivered");
  assert.equal(await reportPressStage("confirmed", { pageId: "p1", pressOutbox: cell, occurredAt: clock.toISOString() }, notion, PRESS_ENV, answer({ ok: true, outcome: "created" })), "delivered");
  assert.equal(await reportPressStage("confirmed", { pageId: "p2", pressOutbox: cell, occurredAt: clock.toISOString() }, notion, PRESS_ENV, answer({ ok: true, outcome: "ignored" })), "ignored");
  assert.equal(await reportPressStage("confirmed", { pageId: "p3", pressOutbox: cell, occurredAt: clock.toISOString() }, notion, PRESS_ENV, answer({ error: "unavailable" }, 503)), "retry");
  assert.deepEqual(patches, [
    { path: "pages/p1", state: "accepted" },
    { path: "pages/p1", state: "confirmed" },
    { path: "pages/p2", state: "ignored" },
  ]);
});

test("replay sends only what completed signups still owe", async () => {
  const cell = (email: string) => pressOutboxFor({ pressRef: REF, canonical: canonicalEmail(email), signedUpAt: "2026-10-21T08:00:00.000Z", flagged: false }, PRESS_ENV)!;
  const rows = [
    { id: "held-verified", sync: "held", verified: true, cell: cell("a@example.com"), verifiedAt: "2026-10-21T09:30:00.000Z" },
    { id: "held-unverified", sync: "held", verified: false, cell: cell("b@example.com") },
    { id: "social-pending", sync: "pending", verified: false, cell: cell("c@example.com") },
    { id: "social-duplicate", sync: "pending", verified: false, cell: cell("d@example.com"), duplicate: true },
    { id: "accepted-verified", sync: "accepted", verified: true, cell: cell("e@example.com"), verifiedAt: "2026-10-21T10:00:00.000Z" },
    { id: "corrupt", sync: "held", verified: true, cell: "corrupt" },
  ] as { id: string; sync: string; verified: boolean; cell: string; verifiedAt?: string; duplicate?: boolean }[];
  const matches = (filter: unknown, row: (typeof rows)[number]): boolean => {
    const node = filter as { and?: unknown[]; or?: unknown[]; property?: string; rich_text?: { equals: string }; checkbox?: { equals: boolean } };
    if (node.and) return node.and.every((part) => matches(part, row));
    if (node.or) return node.or.some((part) => matches(part, row));
    if (node.property === FIELD_PRESS_SYNC) return row.sync === node.rich_text!.equals;
    if (node.property === "Email verified") return row.verified === node.checkbox!.equals;
    throw new Error(`unexpected filter on ${node.property}`);
  };
  const notion: NotionRequest = async (method, path, body) => {
    if (method === "PATCH") {
      const id = path.replace("pages/", "");
      rows.find((row) => row.id === id)!.sync = (body as { properties: Record<string, { rich_text: { text: { content: string } }[] }> }).properties[FIELD_PRESS_SYNC].rich_text[0].text.content;
      return {};
    }
    const results = rows.filter((row) => matches((body as { filter: unknown }).filter, row)).map((row) => ({
      id: row.id,
      properties: {
        [FIELD_PRESS_EVENT]: { rich_text: [{ plain_text: row.cell }] },
        [FIELD_PRESS_SYNC]: { rich_text: [{ plain_text: row.sync }] },
        "Email verified": { checkbox: row.verified },
        ...(row.duplicate ? { Duplicate: { checkbox: true } } : {}),
        ...(row.verifiedAt ? { "Verified at": { date: { start: row.verifiedAt } } } : {}),
      },
    }));
    return { results, has_more: false };
  };
  const sent: PressSignupEvent[] = [];
  const fetcher = (async (_url: URL, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ ok: true, outcome: "created" }), { status: 200 });
  }) as unknown as typeof fetch;

  assert.equal((await replayPressOutbox({ request: notion, databaseId: "db", env: {}, fetcher })).skipped, true);
  assert.equal(sent.length, 0);

  const result = await replayPressOutbox({ request: notion, databaseId: "db", env: PRESS_ENV, fetcher });
  assert.deepEqual(result, { scanned: 5, delivered: 3, ignored: 0, invalid: 1, retry: 0, skipped: false }, "the duplicate is read and skipped");
  assert.deepEqual(sent.map((event) => [event.stage, event.occurredAt]).sort(), [
    ["accepted", "2026-10-21T08:00:00.000Z"],
    ["confirmed", "2026-10-21T09:30:00.000Z"],
    ["confirmed", "2026-10-21T10:00:00.000Z"],
  ]);
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.id, row.sync])), {
    "held-verified": "confirmed",
    "held-unverified": "held",
    "social-pending": "accepted",
    "social-duplicate": "pending",
    "accepted-verified": "confirmed",
    corrupt: "invalid",
  });
  assert.equal((await replayPressOutbox({ request: notion, databaseId: "db", env: PRESS_ENV, fetcher, maxRows: 0 })).scanned, 0);
});

function browser(href: string, stored?: string) {
  const items = new Map<string, string>(stored ? [["wd_press_ref", stored]] : []);
  const replaced: string[] = [];
  const window: Record<string, unknown> = {};
  const context = vm.createContext({
    URL,
    JSON,
    Date,
    window,
    location: { href },
    history: { state: null, replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url) },
    localStorage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value) },
  });
  vm.runInContext(PRESS_REF_BOOTSTRAP, context);
  return { items, replaced, window };
}

test("the head bootstrap keeps press_ref and removes it before analytics read the URL", () => {
  const arrived = browser(`https://watchdive.diveroid.com/ko?utm_source=press&utm_medium=article&press_ref=${REF}#offer`);
  assert.deepEqual(arrived.replaced, ["/ko?utm_source=press&utm_medium=article#offer"], "only press_ref leaves the URL");
  assert.equal(JSON.parse(arrived.items.get("wd_press_ref")!).ref, REF);
  assert.equal(arrived.window.__wdPressRef, REF);

  const malformed = browser("https://watchdive.diveroid.com/?press_ref=<script>");
  assert.deepEqual(malformed.replaced, ["/"]);
  assert.equal(malformed.items.size, 0);

  const untouched = browser("https://watchdive.diveroid.com/?utm_source=meta");
  assert.deepEqual(untouched.replaced, [], "no press_ref, no history change");

  const earlier = JSON.stringify({ ref: "Z".repeat(43), at: Date.now() - 60_000 });
  const second = browser(`https://watchdive.diveroid.com/?press_ref=${REF}`, earlier);
  assert.equal(second.items.get("wd_press_ref"), earlier, "first touch within seven days wins");
});

test("getPressRef falls back to the page global when storage is blocked", () => {
  const globals = globalThis as Record<string, unknown>;
  const saved = { window: globals.window, localStorage: globals.localStorage };
  try {
    globals.window = { location: { search: "" }, __wdPressRef: REF };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    assert.equal(getPressRef(), REF);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: saved.localStorage });
    globals.window = saved.window;
  }
});

test("Notion columns: check by default, add only what is missing, refuse a wrong type", async () => {
  const both = { properties: { "Press event": { rich_text: {} }, "Press sync": { rich_text: {} } } };
  assert.deepEqual(planPressNotionSchema({ properties: { Email: { type: "title" } } }).patch, both);
  assert.deepEqual(Object.keys(planPressNotionSchema({ properties: { "Press event": { type: "rich_text" } } }).patch!.properties), ["Press sync"]);
  assert.equal(planPressNotionSchema({ properties: { "Press event": { type: "rich_text" }, "Press sync": { type: "rich_text" } } }).patch, null);
  assert.equal(planPressNotionSchema({ properties: { "Press sync": { type: "select" } } }).ok, false);

  let schema: Record<string, { type: string }> = { Email: { type: "title" }, Phone: { type: "rich_text" } };
  const calls: { method: string; url: string; body?: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ method: String(init.method), url: String(url), body: init.body as string | undefined });
    if (init.method === "PATCH") {
      for (const [name, value] of Object.entries((JSON.parse(String(init.body)) as { properties: Record<string, object> }).properties)) {
        schema[name] = { type: Object.keys(value)[0] };
      }
      return new Response("{}", { status: 200 });
    }
    return new Response(JSON.stringify({ properties: schema }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = { NOTION_API_KEY: "test-key", NOTION_WAITLIST_DB_ID: "0123456789abcdef0123456789abcdef" };

  const check = await runPressNotionSchema({ args: [], env, fetchImpl });
  assert.equal(check.exitCode, 0);
  assert.equal(check.report.applied, false);
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0, "a check never writes");

  const applied = await runPressNotionSchema({ args: ["--apply"], env, fetchImpl });
  assert.equal(applied.exitCode, 0);
  assert.equal(applied.report.applied, true);
  const patch = calls.find((call) => call.method === "PATCH")!;
  assert.deepEqual(JSON.parse(patch.body!), both, "one PATCH with the additions only");
  assert.ok(patch.url.endsWith("/databases/0123456789abcdef0123456789abcdef"));
  assert.deepEqual(schema.Phone, { type: "rich_text" }, "existing columns untouched");

  const again = await runPressNotionSchema({ args: ["--apply"], env, fetchImpl });
  assert.equal(again.report.applied, false, "nothing left to add");

  schema = { "Press sync": { type: "select" } };
  const refused = await runPressNotionSchema({ args: ["--apply"], env, fetchImpl });
  assert.equal(refused.exitCode, 2);
  assert.equal(refused.report.error, "schema_conflict");
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1, "no write on a conflict");
  assert.equal((await runPressNotionSchema({ args: ["--force"], env, fetchImpl })).report.error, "unknown_argument");
  assert.equal((await runPressNotionSchema({ args: [], env: {}, fetchImpl })).report.error, "misconfigured");
});
