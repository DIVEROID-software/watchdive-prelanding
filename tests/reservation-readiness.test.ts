import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  checkPublicOrigin,
  evaluateReadiness,
  inspectMigrations,
  keyMode,
  main,
  parseArgs,
  parseBackendNames,
  parseContract,
  parseHandledEvents,
  PRODUCTION_ORIGIN,
  HERO_RESTORE_PARENT,
  PROTECTED_COMMIT,
  redact,
  stripeGet,
  SUCCESS_PATH,
  UNSAFE_ROLLBACK_COMMIT,
  type CodeSnapshot,
  type GitFacts,
  type LedgerReceipt,
  type ReadinessInput,
} from "../scripts/reservation-readiness.ts";

const LIVE_KEY = "sk_live_fixturekeyvalue0001";
const WEBHOOK_SECRET = "whsec_fixturekeyvalue0001";
const TOKEN_SECRET = "0123456789abcdef0123456789abcdef";
const ACCOUNT = "acct_1OfficialFixture";
const EVENTS = ["checkout.session.completed", "charge.refunded"];

const CONSTANTS = `
export const RESERVATION_FEE_CENTS = 300;
export const RESERVATION_CURRENCY = "usd";
export const LATER_PRODUCT_PRICE_CENTS = 14_900;
export const FEE_POLICY = "additional_not_credited";
export const CHECKOUT_PATH = "/api/reservation/checkout";
export const STATUS_PATH = "/api/reservation/status";
export const WEBHOOK_PATH = "/api/reservation/webhook";
export const SUCCESS_PATH = "/reservation?session_id={CHECKOUT_SESSION_ID}";
export const ENV_RESERVATION_ENABLED = "WATCHDIVE_RESERVATION_ENABLED";
export const ENV_RESERVATION_ALLOW_LIVE = "WATCHDIVE_RESERVATION_ALLOW_LIVE";
export const ENV_STRIPE_SECRET_KEY = "STRIPE_SECRET_KEY";
export const ENV_STRIPE_WEBHOOK_SECRET = "STRIPE_WEBHOOK_SECRET";
export const ENV_RESERVATION_TOKEN_SECRET = "WATCHDIVE_RESERVATION_TOKEN_SECRET";
export const ENV_PUBLIC_ORIGIN = "WATCHDIVE_PUBLIC_ORIGIN";
`;

const WEBHOOK_SOURCE = `
const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "charge.refunded",
]);
`;

function route(path: string, method: "GET" | "POST"): string {
  return `export const Route = createFileRoute("${path}")({ server: { handlers: { ${method}: async () => new Response() } } });`;
}

function contract(extra = ""): string {
  return `
\`\`\`reservation-readiness
schema_version: 1
amount_cents: 300
product_price_cents: 14900
currency: usd
checkout_mode: payment
fee_credited_to_product: false
invite_token: signed
client_email: untrusted
authoritative_paid: verified-stripe
public_origin: https://watchdive.diveroid.com
success_path: /reservation?session_id={CHECKOUT_SESSION_ID}
checkout_method: POST
checkout_path: /api/reservation/checkout
status_method: GET
status_path: /api/reservation/status
webhook_method: POST
webhook_path: /api/reservation/webhook
stripe_secret_key_env: STRIPE_SECRET_KEY
stripe_webhook_secret_env: STRIPE_WEBHOOK_SECRET
token_secret_env: WATCHDIVE_RESERVATION_TOKEN_SECRET
public_origin_env: WATCHDIVE_PUBLIC_ORIGIN
enable_flag_env: WATCHDIVE_RESERVATION_ENABLED
allow_live_env: WATCHDIVE_RESERVATION_ALLOW_LIVE
stripe_account_id: ${ACCOUNT}
webhook_events: ${EVENTS.join(",")}
ledger_mode: stripe-retrieve
${extra}
\`\`\`
`;
}

const WAITLIST_SQL = `
CREATE TABLE public.waitlist_signups (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL
);
`;

function readyCode(overrides: Partial<CodeSnapshot> = {}): CodeSnapshot {
  return {
    constants: CONSTANTS,
    webhookSource: WEBHOOK_SOURCE,
    checkoutRoute: route("/api/reservation/checkout", "POST"),
    statusRoute: route("/api/reservation/status", "GET"),
    webhookRoute: route("/api/reservation/webhook", "POST"),
    experimentClient:
      "var v=crypto.getRandomValues(new Uint8Array(1))[0]<128?'control':'form_first';\nexport function variantFromRandomByte(byte: number) { return byte < 128 ? \"control\" : \"form_first\"; }",
    seo: `export const WATCHDIVE_PUBLIC_ORIGIN = "${PRODUCTION_ORIGIN}";`,
    migrations: [{ name: "waitlist.sql", sql: WAITLIST_SQL }],
    contractText: contract(),
    ...overrides,
  };
}

function readyEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    STRIPE_SECRET_KEY: LIVE_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    WATCHDIVE_RESERVATION_TOKEN_SECRET: TOKEN_SECRET,
    WATCHDIVE_PUBLIC_ORIGIN: PRODUCTION_ORIGIN,
    WATCHDIVE_RESERVATION_ALLOW_LIVE: "true",
    WATCHDIVE_RESERVATION_ENABLED: "false",
    ...overrides,
  };
}

const ancestor: GitFacts = {
  headCommit: "abc123",
  protectedCommitInRepo: true,
  protectedCommitIsAncestor: true,
};

function stripeFetch(options: { account?: Record<string, unknown>; endpoints?: Record<string, unknown>[] } = {}) {
  const calls: { url: string; method: string; authorization: string }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? "",
    });
    if (init?.method !== "GET") throw new Error("mutation attempted");
    const parsed = new URL(String(url));
    if (parsed.pathname === "/v1/account") {
      return new Response(
        JSON.stringify({
          id: ACCOUNT,
          charges_enabled: true,
          details_submitted: true,
          email: "secret-person@example.com",
          ...options.account,
        }),
      );
    }
    return new Response(
      JSON.stringify({
        data: options.endpoints ?? [
          {
            id: "we_fixtureendpoint1",
            url: `${PRODUCTION_ORIGIN}/api/reservation/webhook`,
            status: "enabled",
            livemode: true,
            enabled_events: EVENTS,
            secret: WEBHOOK_SECRET,
          },
        ],
        has_more: false,
      }),
    );
  };
  return { calls, fetchImpl };
}

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  const stripe = stripeFetch();
  return {
    env: readyEnv(),
    code: readyCode(),
    git: ancestor,
    networkReadonly: true,
    receipt: null,
    receiptMigrationSql: null,
    fetchImpl: stripe.fetchImpl,
    ...overrides,
  };
}

function check(report: Awaited<ReturnType<typeof evaluateReadiness>>, id: string) {
  const found = report.checks.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}

test("a complete live configuration is ready and does not reveal secrets", async () => {
  const stripe = stripeFetch();
  const report = await evaluateReadiness(input({ fetchImpl: stripe.fetchImpl }));
  assert.equal(report.verdict, "ready");
  assert.equal(report.mutations, false);
  assert.deepEqual(stripe.calls.map((call) => call.method), ["GET", "GET"]);
  assert.deepEqual(
    stripe.calls.map((call) => new URL(call.url).pathname),
    ["/v1/account", "/v1/webhook_endpoints"],
  );
  const rendered = JSON.stringify(report);
  assert.equal(rendered.includes(LIVE_KEY), false);
  assert.equal(rendered.includes(WEBHOOK_SECRET), false);
  assert.equal(rendered.includes(TOKEN_SECRET), false);
  assert.equal(rendered.includes("secret-person@example.com"), false);
  assert.equal(rendered.includes(PRODUCTION_ORIGIN), true);
});

test("network reads stay off unless the flag is set", async () => {
  let called = false;
  const report = await evaluateReadiness(
    input({
      networkReadonly: false,
      fetchImpl: async () => {
        called = true;
        throw new Error("network");
      },
    }),
  );
  assert.equal(called, false);
  assert.equal(report.verdict, "blocked");
  assert.equal(check(report, "stripe_mode").status, "skip");
  assert.equal(check(report, "stripe_account").status, "skip");
});

test("a test key or a missing key does not call Stripe", async () => {
  for (const secret of [undefined, "sk_test_fixturekeyvalue0001", "not-a-key"]) {
    let called = false;
    const report = await evaluateReadiness(
      input({
        env: readyEnv({ STRIPE_SECRET_KEY: secret }),
        fetchImpl: async () => {
          called = true;
          throw new Error("network");
        },
      }),
    );
    assert.equal(called, false);
    assert.equal(report.verdict, "blocked");
    assert.equal(JSON.stringify(report).includes("not-a-key"), false);
    assert.equal(JSON.stringify(report).includes("sk_test_fixturekeyvalue0001"), false);
  }
});

test("stripeGet refuses anything except the two read endpoints", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    seen.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response("{}");
  };
  await assert.rejects(() => stripeGet("https://example.com/v1/account", LIVE_KEY, fetchImpl));
  await assert.rejects(() => stripeGet("https://api.stripe.com/v1/refunds", LIVE_KEY, fetchImpl));
  await assert.rejects(() =>
    stripeGet("https://api.stripe.com/v1/webhook_endpoints?limit=1", LIVE_KEY, fetchImpl),
  );
  assert.deepEqual(seen, []);
});

test("the wrong account, a disabled account, or a bad webhook blocks production", async () => {
  const wrongStripe = stripeFetch({ account: { id: "acct_1SomeoneElse" } });
  const wrong = await evaluateReadiness(input({ fetchImpl: wrongStripe.fetchImpl }));
  assert.equal(check(wrong, "stripe_account").status, "fail");
  assert.deepEqual(wrongStripe.calls.map((call) => new URL(call.url).pathname), ["/v1/account"]);

  const disabled = await evaluateReadiness(
    input({ fetchImpl: stripeFetch({ account: { charges_enabled: false } }).fetchImpl }),
  );
  assert.equal(check(disabled, "stripe_account").status, "fail");
  assert.match(check(disabled, "stripe_account").summary, /Diveroid business account/);

  const webhook = await evaluateReadiness(
    input({
      fetchImpl: stripeFetch({
        endpoints: [
          {
            id: "we_fixtureendpoint1",
            url: "https://watchdive.diveroid.com/api/reservation/webhook",
            status: "disabled",
            livemode: true,
            enabled_events: EVENTS,
          },
        ],
      }).fetchImpl,
    }),
  );
  assert.equal(check(webhook, "stripe_webhook").status, "fail");
});

test("missing contract, drifted names, and invented commercial terms are blocked", () => {
  assert.equal(parseContract(null).ok, false);
  assert.equal(parseContract("# no fence").ok, false);
  const credited = parseContract(contract().replace("fee_credited_to_product: false", "fee_credited_to_product: true"));
  assert.equal(credited.ok, false);
  const productCharge = parseContract(contract().replace("amount_cents: 300", "amount_cents: 14900"));
  assert.equal(productCharge.ok, false);
  const placeholder = parseContract(contract().replace(ACCOUNT, "acct_REPLACE_ME"));
  assert.equal(placeholder.ok, false);
  const renamed = parseContract(contract().replace("stripe_secret_key_env: STRIPE_SECRET_KEY", "stripe_secret_key_env: VITE_STRIPE_SECRET_KEY"));
  assert.equal(renamed.ok, false);
  const unknown = parseContract(contract("stock: 100\n"));
  assert.equal(unknown.ok, false);
});

test("origin checks accept only the bare production origin", () => {
  assert.equal(checkPublicOrigin(PRODUCTION_ORIGIN), null);
  assert.ok(checkPublicOrigin(""));
  assert.ok(checkPublicOrigin("http://watchdive.diveroid.com"));
  assert.ok(checkPublicOrigin("https://user:pass@watchdive.diveroid.com"));
  assert.ok(checkPublicOrigin("https://watchdive.diveroid.com/reservation"));
  assert.ok(checkPublicOrigin("https://example.com"));
});

test("protected commit and experiment split block an unsafe tree", async () => {
  const behind = await evaluateReadiness(
    input({
      git: { headCommit: UNSAFE_ROLLBACK_COMMIT, protectedCommitInRepo: false, protectedCommitIsAncestor: false },
      networkReadonly: false,
    }),
  );
  assert.match(check(behind, "protected_commit").summary, new RegExp(PROTECTED_COMMIT));
  assert.match(check(behind, "protected_commit").summary, new RegExp(HERO_RESTORE_PARENT));
  assert.match(check(behind, "protected_commit").summary, new RegExp(UNSAFE_ROLLBACK_COMMIT));
  const changed = await evaluateReadiness(
    input({
      code: readyCode({ experimentClient: "return byte < 1 ? \"control\" : \"form_first\";" }),
      networkReadonly: false,
    }),
  );
  assert.equal(check(changed, "experiment_split").status, "fail");
});

test("public secret names and a short invite secret are blocked without echoing them", async () => {
  const report = await evaluateReadiness(
    input({
      env: readyEnv({
        VITE_STRIPE_SECRET_KEY: "pk_live_browsersecretvalue1",
        WATCHDIVE_RESERVATION_TOKEN_SECRET: "too-short",
      }),
      networkReadonly: false,
    }),
  );
  assert.equal(check(report, "secret_not_public").status, "fail");
  assert.equal(check(report, "token_secret").status, "fail");
  const rendered = JSON.stringify(report);
  assert.equal(rendered.includes("pk_live_browsersecretvalue1"), false);
  assert.equal(rendered.includes("too-short"), false);
});

test("enable flag accepts only exact true or off, and live opt-in is required", async () => {
  const off = await evaluateReadiness(input({ networkReadonly: false, env: readyEnv({ WATCHDIVE_RESERVATION_ENABLED: "" }) }));
  assert.equal(check(off, "enable_flag").status, "pass");
  const weird = await evaluateReadiness(input({ networkReadonly: false, env: readyEnv({ WATCHDIVE_RESERVATION_ENABLED: "yes" }) }));
  assert.equal(check(weird, "enable_flag").status, "fail");
  const noLive = await evaluateReadiness(input({ networkReadonly: false, env: readyEnv({ WATCHDIVE_RESERVATION_ALLOW_LIVE: "false" }) }));
  assert.equal(check(noLive, "allow_live").status, "fail");
});

test("sql ledger readiness is file comparison plus an attestation, never a live probe", async () => {
  const sql = "CREATE TABLE reservation_payments (id uuid, checkout_session_id text, event_id text);";
  const hashed = createHash("sha256").update(sql).digest("hex");
  const text = contract(`ledger_mode: sql\nledger_table: reservation_payments\nledger_columns: id,checkout_session_id,event_id\n`).replace(
    "ledger_mode: stripe-retrieve\n",
    "",
  );
  const code = readyCode({
    contractText: text,
    migrations: [
      { name: "waitlist.sql", sql: WAITLIST_SQL },
      { name: "20261018_reservation_payments.sql", sql },
    ],
  });
  const missing = await evaluateReadiness(input({ code, networkReadonly: false }));
  assert.equal(check(missing, "ledger").status, "fail");
  const receipt: LedgerReceipt = {
    schemaVersion: 1,
    migrationFile: "20261018_reservation_payments.sql",
    sha256: hashed,
    table: "reservation_payments",
    attestation: "root-applied-read-only-confirmation",
    liveProbe: false,
  };
  const attested = await evaluateReadiness(
    input({ code, networkReadonly: false, receipt, receiptMigrationSql: sql }),
  );
  assert.equal(check(attested, "ledger").status, "pass");
  assert.match(check(attested, "ledger").summary, /not by a live database probe/);
  const commented = sql.replace("event_id text", "/* event_id text */ note text");
  const hidden = await evaluateReadiness(
    input({
      code: readyCode({
        contractText: text,
        migrations: [
          { name: "waitlist.sql", sql: WAITLIST_SQL },
          { name: "20261018_reservation_payments.sql", sql: commented },
        ],
      }),
      networkReadonly: false,
      receipt: { ...receipt, sha256: createHash("sha256").update(commented).digest("hex") },
      receiptMigrationSql: commented,
    }),
  );
  assert.equal(check(hidden, "ledger").status, "fail");
});

test("schema compatibility rejects a waitlist drop or a new waitlist column", () => {
  const dropped = inspectMigrations([{ name: "drop.sql", sql: "DROP TABLE public.waitlist_signups;" }]);
  assert.equal(dropped.droppedWaitlist, true);
  const altered = inspectMigrations([
    { name: "waitlist.sql", sql: `${WAITLIST_SQL}\nALTER TABLE public.waitlist_signups ADD COLUMN paid boolean;` },
  ]);
  assert.equal(altered.alteredWaitlist, true);
});

test("backend constants and the rollout example stay on the implemented names", () => {
  const repo = fileUrl("..");
  const constants = readFileSync(join(repo, "src/lib/reservation/constants.ts"), "utf8");
  const names = parseBackendNames(constants);
  assert.equal(names?.stripeSecretKeyEnv, "STRIPE_SECRET_KEY");
  assert.equal(names?.stripeWebhookSecretEnv, "STRIPE_WEBHOOK_SECRET");
  assert.equal(names?.tokenSecretEnv, "WATCHDIVE_RESERVATION_TOKEN_SECRET");
  assert.equal(names?.publicOriginEnv, "WATCHDIVE_PUBLIC_ORIGIN");
  assert.equal(names?.enableFlagEnv, "WATCHDIVE_RESERVATION_ENABLED");
  assert.equal(names?.allowLiveEnv, "WATCHDIVE_RESERVATION_ALLOW_LIVE");
  assert.equal(names?.feeCents, 300);
  assert.equal(names?.productPriceCents, 14900);
  assert.equal(names?.successPath, SUCCESS_PATH);
  const webhook = readFileSync(join(repo, "src/lib/reservation/webhook.ts"), "utf8");
  const handled = parseHandledEvents(webhook);
  assert.ok(handled?.includes("checkout.session.completed"));
  const contractText = readFileSync(join(repo, "docs/reservation-contract.md"), "utf8");
  const contractListed = contractText.match(/webhook_events: ([^\n]+)/)?.[1]?.split(",").map((item) => item.trim());
  const rollout = readFileSync(join(repo, "docs/reservation-rollout.md"), "utf8");
  const listed = rollout.match(/webhook_events: ([^\n]+)/)?.[1]?.split(",").map((item) => item.trim());
  assert.deepEqual(listed, contractListed);
  assert.equal(rollout.includes("stripe_account_id: acct_1Tl9bv1UxFzpSUuA"), true);
  assert.equal(rollout.includes(PROTECTED_COMMIT), true);
  assert.equal(rollout.includes(HERO_RESTORE_PARENT), true);
  assert.equal(rollout.includes("Restore original hero imagery at owner request"), true);
  assert.equal(rollout.includes("keep the pool-photo commit's versions"), false);
  assert.equal((rollout.match(/^webhook_events: /gm) ?? []).length, 1);
});

test("the command usage surface has no mutation flag", () => {
  assert.equal("error" in parseArgs(["--apply"], "/tmp"), true);
  assert.equal("error" in parseArgs(["--target", "staging"], "/tmp"), true);
  const parsed = parseArgs(["--target", "production", "--network-readonly", "--json"], "/tmp");
  assert.equal("error" in parsed, false);
  if (!("error" in parsed)) {
    assert.equal(parsed.networkReadonly, true);
    assert.equal(parsed.json, true);
  }
  assert.equal(keyMode(LIVE_KEY), "live");
  assert.equal(keyMode("sk_test_fixturekeyvalue0001"), "test");
  assert.equal(redact(`key ${LIVE_KEY}`, [LIVE_KEY]).includes(LIVE_KEY), false);
});

test("running against this clone with an empty environment is blocked", async () => {
  const root = fileUrl("..");
  let stdout = "";
  const code = await main(["--json"], {
    cwd: root,
    env: {},
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: () => {},
    fetchImpl: async () => {
      throw new Error("network should not be used");
    },
  });
  assert.equal(code, 2);
  const report = JSON.parse(stdout) as { verdict: string; mutations: boolean; checks: { status: string }[] };
  assert.equal(report.verdict, "blocked");
  assert.equal(report.mutations, false);
  assert.equal(stdout.includes(LIVE_KEY), false);
  assert.equal(stdout.includes("whsec_"), false);
  assert.equal(report.checks.some((item) => item.status !== "pass"), true);
});

test("help and a bad receipt do not print secret-shaped config", async () => {
  let help = "";
  assert.equal(await main(["--help"], { cwd: fileUrl(".."), env: { STRIPE_SECRET_KEY: LIVE_KEY }, stdout: (chunk) => { help += chunk; } }), 0);
  assert.match(help, /Does not charge/);
  assert.equal(help.includes(LIVE_KEY), false);
  const dir = mkdtempSync(join(tmpdir(), "reservation-readiness-"));
  const receipt = join(dir, "receipt.json");
  writeFileSync(receipt, JSON.stringify({ liveProbe: true, secret: LIVE_KEY }));
  let stderr = "";
  const code = await main(["--ledger-receipt", receipt], {
    cwd: fileUrl(".."),
    env: {},
    stderr: (chunk) => {
      stderr += chunk;
    },
    stdout: () => {},
  });
  assert.equal(code, 1);
  assert.equal(stderr.includes(LIVE_KEY), false);
  mkdirSync(join(dir, "nested"), { recursive: true });
});

function fileUrl(relative: string): string {
  return join(import.meta.dirname, relative);
}
