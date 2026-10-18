import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  connectReservation,
  DEFAULT_ENV_FILE,
  keyMode,
  main,
  OFFICIAL_ACCOUNT_ID,
  parseArgs,
  parseContractConnection,
  parseHandledEvents,
  renderEnvWithWebhookSecret,
  snapshotEnv,
  stripeRequest,
  WEBHOOK_URL,
  writeEnvSecret,
  type EnvSnapshot,
} from "../scripts/reservation-connect.ts";

const LIVE_KEY = "sk_live_fixturekeyvalue0001";
const WEBHOOK_SECRET = "whsec_fixturekeyvalue0001";
const TOKEN_SECRET = "tokensecretvalue_SHOULD_NOT_LEAK_0123456789";
const EVENTS = ["checkout.session.completed", "charge.refunded"];
const API_VERSION = "2024-06-20";

const CONSTANTS = `export const STRIPE_API_VERSION = "${API_VERSION}";\n`;
const WEBHOOK_SOURCE = `const HANDLED_EVENTS = new Set([\n  "checkout.session.completed",\n  "charge.refunded",\n]);\n`;

function contract(account = "acct_REPLACE_AFTER_LOGIN"): string {
  return "```reservation-readiness\nwebhook_events: checkout.session.completed,charge.refunded\nstripe_account_id: " + account + "\n```\n";
}

function env(overrides: Partial<EnvSnapshot> = {}): EnvSnapshot {
  return {
    path: "/private/reservation.env",
    mode: 0o600,
    symlink: false,
    ownerOk: true,
    insideRepo: false,
    stripeKey: LIVE_KEY,
    webhookSecretPresent: false,
    tokenSecretPresent: true,
    origin: "https://watchdive.diveroid.com",
    allowLive: "true",
    enabled: "false",
    unrelatedNames: [],
    ...overrides,
  };
}

function endpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: "we_fixtureendpoint1",
    url: WEBHOOK_URL,
    status: "enabled",
    livemode: true,
    api_version: API_VERSION,
    enabled_events: EVENTS,
    secret: WEBHOOK_SECRET,
    ...overrides,
  };
}

function fakeFetch(options: { account?: Record<string, unknown>; endpoints?: Record<string, unknown>[]; onPost?: () => Record<string, unknown> } = {}) {
  const calls: { method: string; pathname: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url));
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ method: init?.method ?? "GET", pathname: parsed.pathname, body });
    if (parsed.pathname !== "/v1/account" && parsed.pathname !== "/v1/webhook_endpoints") {
      throw new Error("unexpected path");
    }
    if (parsed.pathname === "/v1/account") {
      return Response.json({
        id: OFFICIAL_ACCOUNT_ID,
        charges_enabled: true,
        payouts_enabled: true,
        email: "secret-person@example.com",
        ...options.account,
      });
    }
    if (init?.method === "POST") {
      return Response.json(options.onPost ? options.onPost() : endpoint());
    }
    return Response.json({ data: options.endpoints ?? [], has_more: false });
  };
  return { calls, fetchImpl };
}

function input(overrides: Partial<Parameters<typeof connectReservation>[0]> = {}) {
  const stripe = fakeFetch();
  return {
    stripe,
    args: {
      env: env(),
      contractText: contract(),
      webhookSource: WEBHOOK_SOURCE,
      constantsSource: CONSTANTS,
      apply: false,
      fetchImpl: stripe.fetchImpl,
      ...overrides,
    },
  };
}

function rendered(report: unknown, secrets: string[]): string {
  const text = JSON.stringify(report);
  for (const secret of secrets) assert.equal(text.includes(secret), false, "report leaked a secret");
  assert.equal(text.includes("secret-person@example.com"), false);
  return text;
}

test("missing credentials do not call Stripe and do not echo the token", async () => {
  let called = false;
  const report = await connectReservation({
    ...input().args,
    env: env({ stripeKey: null }),
    fetchImpl: async () => {
      called = true;
      throw new Error("network");
    },
  });
  assert.equal(called, false);
  assert.equal(report.connected, false);
  assert.equal(report.blockedReasons.length > 0, true);
  rendered(report, [TOKEN_SECRET, LIVE_KEY]);
});

test("a test key and a wrong account send no webhook mutation", async () => {
  const testKey = fakeFetch();
  const refused = await connectReservation({
    ...input().args,
    env: env({ stripeKey: "sk_test_fixturekeyvalue0001" }),
    fetchImpl: testKey.fetchImpl,
  });
  assert.equal(testKey.calls.length, 0);
  assert.equal(refused.connected, false);

  const wrong = fakeFetch({ account: { id: "acct_1SomeoneElse" } });
  const report = await connectReservation({ ...input().args, apply: true, fetchImpl: wrong.fetchImpl });
  assert.deepEqual(wrong.calls.map((call) => call.pathname), ["/v1/account"]);
  assert.equal(report.accountId, "acct_1SomeoneElse");
  assert.equal(report.chargesEnabled, true);
  assert.equal(report.payoutsEnabled, true);
  assert.equal(report.connected, false);
  rendered(report, [LIVE_KEY]);

  const disabled = fakeFetch({ account: { charges_enabled: false, payouts_enabled: false } });
  const held = await connectReservation({ ...input().args, apply: true, fetchImpl: disabled.fetchImpl });
  assert.deepEqual(disabled.calls.map((call) => call.pathname), ["/v1/account"]);
  assert.equal(held.chargesEnabled, false);
  assert.equal(held.payoutsEnabled, false);
  assert.equal(held.connected, false);
  assert.equal(disabled.calls.some((call) => call.method === "POST"), false);
});

test("conflicts and duplicates are reported and not rewritten", async () => {
  const conflict = fakeFetch({
    endpoints: [endpoint({ enabled_events: ["checkout.session.completed"], api_version: "2023-10-16" })],
  });
  const conflicted = await connectReservation({ ...input().args, apply: true, fetchImpl: conflict.fetchImpl });
  assert.equal(conflicted.endpointMatch, "conflict");
  assert.equal(conflict.calls.some((call) => call.method === "POST"), false);

  const duplicate = fakeFetch({ endpoints: [endpoint(), endpoint({ id: "we_fixtureendpoint2" })] });
  const duplicated = await connectReservation({ ...input().args, apply: true, fetchImpl: duplicate.fetchImpl });
  assert.equal(duplicated.endpointMatch, "conflict");
  assert.equal(duplicate.calls.some((call) => call.method === "POST"), false);
});

test("an existing endpoint is reused and its secret is not rotated", async () => {
  const stripe = fakeFetch({ endpoints: [endpoint({ secret: undefined })] });
  const report = await connectReservation({
    ...input().args,
    apply: true,
    env: env({ webhookSecretPresent: false }),
    fetchImpl: stripe.fetchImpl,
  });
  assert.equal(report.endpointMatch, "exact");
  assert.equal(report.secret, "unavailable");
  assert.equal(report.connected, false);
  assert.equal(report.mutations.length, 0);
  assert.match(report.nextAction, /Do not roll the endpoint/);
  rendered(report, [WEBHOOK_SECRET, LIVE_KEY]);
});

test("dry-run does not create, and apply stores a new secret without printing it", async () => {
  const dry = fakeFetch();
  const planned = await connectReservation({ ...input().args, fetchImpl: dry.fetchImpl });
  assert.equal(planned.phase, "dry-run");
  assert.equal(planned.connected, false);
  assert.equal(planned.endpointMatch, "absent");
  assert.equal(dry.calls.some((call) => call.method === "POST"), false);
  assert.equal(planned.chargesEnabled, true);
  assert.equal(planned.payoutsEnabled, true);

  const dir = mkdtempSync(join(tmpdir(), "reservation-connect-"));
  const file = join(dir, "reservation.env");
  writeFileSync(file, `WATCHDIVE_RESERVATION_TOKEN_SECRET=${TOKEN_SECRET}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  let stored = "";
  const applyFetch = fakeFetch({
    onPost: () => endpoint(),
    endpoints: [],
  });
  let posts = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    if (init?.method === "POST") {
      posts += 1;
      const body = String(init.body);
      assert.equal(String(url).includes("/v1/webhook_endpoints"), true);
      assert.equal(String(url).includes("/v1/customers"), false);
      assert.equal(String(url).includes("/v1/refunds"), false);
      assert.equal(String(url).includes("/v1/checkout"), false);
      assert.equal(body.includes("/v1/customers"), false);
      assert.equal(body.includes("/v1/refunds"), false);
      assert.equal(body.includes("/v1/checkout"), false);
      assert.equal(body.includes(`api_version=${API_VERSION}`), true);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Stripe-Version"), API_VERSION);
      assert.match(headers.get("Idempotency-Key") ?? "", /^wdres_wh_v1_[a-f0-9]{24}$/);
      for (const event of EVENTS) assert.equal(body.includes(event), true);
      return Response.json({ ...endpoint(), enabled_events: EVENTS });
    }
    if (posts > 0) return Response.json({ data: [endpoint({ secret: undefined })], has_more: false });
    return applyFetch.fetchImpl(url, init);
  };
  const report = await connectReservation({
    ...input().args,
    apply: true,
    env: env({ path: file }),
    fetchImpl,
    writeSecret: (secret) => {
      stored = secret;
      writeEnvSecret(file, secret);
      return "stored";
    },
  });
  assert.equal(report.connected, true);
  assert.equal(report.secret, "stored");
  assert.deepEqual(report.mutations, ["POST /v1/webhook_endpoints"]);
  const saved = readFileSync(file, "utf8");
  assert.equal(saved.includes(TOKEN_SECRET), true);
  assert.equal(saved.includes(WEBHOOK_SECRET), true);
  rendered(report, [WEBHOOK_SECRET, TOKEN_SECRET, LIVE_KEY, stored]);
  assert.equal(stored, WEBHOOK_SECRET);
});

test("event mismatch and a foreign contract account do not call Stripe", async () => {
  let called = false;
  const mismatched = await connectReservation({
    ...input().args,
    webhookSource: `const HANDLED_EVENTS = new Set(["charge.refunded"]);\n`,
    fetchImpl: async () => {
      called = true;
      throw new Error("network");
    },
  });
  assert.equal(called, false);
  assert.match(mismatched.blockedReasons[0] ?? "", /differ/);

  const foreign = await connectReservation({
    ...input().args,
    contractText: contract("acct_1OtherAccount"),
    fetchImpl: async () => {
      called = true;
      throw new Error("network");
    },
  });
  assert.equal(called, false);
  assert.match(foreign.blockedReasons[0] ?? "", /does not match/);
});

test("stripeRequest refuses payment resources", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error("network");
  };
  await assert.rejects(() => stripeRequest("POST", "https://api.stripe.com/v1/refunds", LIVE_KEY, API_VERSION, fetchImpl));
  await assert.rejects(() => stripeRequest("GET", "https://api.stripe.com/v1/customers", LIVE_KEY, API_VERSION, fetchImpl));
  await assert.rejects(() => stripeRequest("POST", "https://api.stripe.com/v1/checkout/sessions", LIVE_KEY, API_VERSION, fetchImpl));
  assert.equal(called, false);
  assert.equal(keyMode(LIVE_KEY), "live");
});

test("private env updates preserve the token line and reject loose modes", () => {
  const dir = mkdtempSync(join(tmpdir(), "reservation-connect-env-"));
  const file = join(dir, "reservation.env");
  writeFileSync(file, `# keep\nWATCHDIVE_RESERVATION_TOKEN_SECRET=${TOKEN_SECRET}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  writeEnvSecret(file, WEBHOOK_SECRET);
  const saved = readFileSync(file, "utf8");
  assert.equal(saved.includes(TOKEN_SECRET), true);
  assert.equal(saved.includes(`STRIPE_WEBHOOK_SECRET=${WEBHOOK_SECRET}`), true);
  assert.equal(renderEnvWithWebhookSecret("TOKEN=abc\n", WEBHOOK_SECRET).includes("TOKEN=abc"), true);
  assert.throws(() => renderEnvWithWebhookSecret(`STRIPE_WEBHOOK_SECRET=${WEBHOOK_SECRET}\n`, "whsec_anotherfixturevalue1"));
  chmodSync(file, 0o644);
  const loose = snapshotEnv(file, dir, typeof process.getuid === "function" ? process.getuid() : -1);
  assert.equal(loose.stripeKey, null);
  assert.notEqual(loose.mode, 0o600);
  const inside = snapshotEnv(file, dir, typeof process.getuid === "function" ? process.getuid() : -1);
  assert.equal(inside.insideRepo, true);
});

test("the contract event list and HANDLED_EVENTS must match before any Stripe call", async () => {
  const repo = join(import.meta.dirname, "..");
  const contractText = readFileSync(join(repo, "docs/reservation-contract.md"), "utf8");
  const webhookSource = readFileSync(join(repo, "src/lib/reservation/webhook.ts"), "utf8");
  const constantsSource = readFileSync(join(repo, "src/lib/reservation/constants.ts"), "utf8");
  const contract = parseContractConnection(contractText);
  const handled = parseHandledEvents(webhookSource);
  assert.ok(contract);
  assert.ok(handled);
  const same = [...new Set(contract.events)].sort().join() === [...new Set(handled)].sort().join();
  let called = false;
  const report = await connectReservation({
    ...input().args,
    contractText,
    webhookSource,
    constantsSource,
    apply: true,
    fetchImpl: async () => {
      called = true;
      throw new Error("network");
    },
  });
  assert.equal(report.connected, false);
  if (!same) {
    assert.equal(called, false);
    assert.match(report.blockedReasons.join(" "), /differ/);
  } else {
    assert.equal(called, true);
  }
});

test("a private token-only fixture blocks connection without disclosing secrets", async () => {
  const repo = join(import.meta.dirname, "..");
  let stdout = "";
  const fixtureDir = mkdtempSync(join(tmpdir(), "wd-connect-private-"));
  const fixtureEnv = join(fixtureDir, "reservation.env");
  writeFileSync(fixtureEnv, `WATCHDIVE_RESERVATION_TOKEN_SECRET=${TOKEN_SECRET}\n`, { mode: 0o600 });
  const code = await main(["--json", "--repo", repo, "--env-file", fixtureEnv], {
    cwd: repo,
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: () => {},
    fetchImpl: async () => {
      throw new Error("live network is not allowed in this test");
    },
  });
  assert.equal(code, 2);
  const report = JSON.parse(stdout) as { connected: boolean; blockedReasons: string[] };
  assert.equal(report.connected, false);
  assert.equal(stdout.includes(TOKEN_SECRET), false);
  assert.equal(stdout.includes("whsec_"), false);
  assert.equal(stdout.includes("sk_live_"), false);
  assert.match(report.blockedReasons.join(" "), /STRIPE_SECRET_KEY/);
  assert.equal(parseArgs(["--charge"], repo) && "error" in parseArgs(["--charge"], repo), true);
  assert.equal(DEFAULT_ENV_FILE.endsWith("reservation.env"), true);
});
