// Read-only reservation release check.
//
// This command never creates a charge, sends mail, applies a migration,
// writes config, deploys, or prints a secret value. Stripe is contacted
// only when --network-readonly is set, and then only with GET of the
// account and the webhook endpoint list.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const PROTECTED_COMMIT = "58b1a3ef2c766f57bbe6a65573492a4a1ce47349";
/** Parent of the hero restore. Deploying it undoes the owner's original hero imagery. */
export const HERO_RESTORE_PARENT = "83b30eafd3dd00eae9291adb46805083ad9378b3";
/** Parent of the pool-photo commit. Deploying or resetting to it drops the FAQ and the hero restore. */
export const UNSAFE_ROLLBACK_COMMIT = "5f03468dd60d2b883515ed56046808f72463bdb4";
export const PRODUCTION_ORIGIN = "https://watchdive.diveroid.com";
export const SUCCESS_PATH = "/reservation?session_id={CHECKOUT_SESSION_ID}";
export const CHECKOUT_PATH = "/api/reservation/checkout";
export const STATUS_PATH = "/api/reservation/status";
export const WEBHOOK_PATH = "/api/reservation/webhook";
export const FEE_CENTS = 300;
export const PRODUCT_PRICE_CENTS = 14_900;
export const STRIPE_API_VERSION = "2024-06-20";
export const READINESS_MUTATES = false;

const MAX_FILE_BYTES = 1_000_000;
const TOKEN_SECRET_MIN_BYTES = 32;
const SECRET_NAME = /SECRET|TOKEN|KEY|PASSWORD|SERVICE_ROLE|WEBHOOK/i;
const PLACEHOLDER = /replace|todo|changeme|example|placeholder|xxx+/i;
const ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/;
const WEBHOOK_ID = /^we_[A-Za-z0-9]+$/;
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const KNOWN_KEYS = new Set([
  "schema_version",
  "amount_cents",
  "product_price_cents",
  "currency",
  "checkout_mode",
  "fee_credited_to_product",
  "invite_token",
  "client_email",
  "authoritative_paid",
  "public_origin",
  "success_path",
  "checkout_method",
  "checkout_path",
  "status_method",
  "status_path",
  "webhook_method",
  "webhook_path",
  "stripe_secret_key_env",
  "stripe_webhook_secret_env",
  "token_secret_env",
  "public_origin_env",
  "enable_flag_env",
  "allow_live_env",
  "stripe_account_id",
  "webhook_events",
  "ledger_mode",
  "ledger_table",
  "ledger_columns",
  "database_secret_env",
  "protected_commit",
]);

const REQUIRED_KEYS = [
  "schema_version",
  "amount_cents",
  "product_price_cents",
  "currency",
  "checkout_mode",
  "fee_credited_to_product",
  "invite_token",
  "client_email",
  "authoritative_paid",
  "public_origin",
  "success_path",
  "checkout_method",
  "checkout_path",
  "status_method",
  "status_path",
  "webhook_method",
  "webhook_path",
  "stripe_secret_key_env",
  "stripe_webhook_secret_env",
  "token_secret_env",
  "public_origin_env",
  "enable_flag_env",
  "allow_live_env",
  "stripe_account_id",
  "webhook_events",
  "ledger_mode",
] as const;

export type CheckStatus = "pass" | "fail" | "skip";

export type ReadinessCheck = {
  id: string;
  status: CheckStatus;
  summary: string;
};

export type ReadinessReport = {
  verdict: "ready" | "blocked";
  target: "production";
  networkReadonly: boolean;
  headCommit: string | null;
  protectedCommit: string;
  heroRestoreParent: string;
  unsafeRollbackCommit: string;
  mutations: false;
  checks: ReadinessCheck[];
  blockedReasons: string[];
};

export type MigrationFile = { name: string; sql: string };

export type GitFacts = {
  headCommit: string | null;
  protectedCommitInRepo: boolean;
  protectedCommitIsAncestor: boolean;
};

export type LedgerReceipt = {
  schemaVersion: 1;
  migrationFile: string;
  sha256: string;
  table: string;
  attestation: "root-applied-read-only-confirmation";
  liveProbe: false;
};

export type CodeSnapshot = {
  constants: string | null;
  webhookSource: string | null;
  checkoutRoute: string | null;
  statusRoute: string | null;
  webhookRoute: string | null;
  experimentClient: string | null;
  seo: string | null;
  migrations: MigrationFile[];
  contractText: string | null;
};

export type ReadinessInput = {
  env: Record<string, string | undefined>;
  code: CodeSnapshot;
  git: GitFacts;
  networkReadonly: boolean;
  receipt: LedgerReceipt | null;
  receiptMigrationSql: string | null;
  fetchImpl?: typeof fetch;
};

type Contract = {
  schemaVersion: number;
  amountCents: number;
  productPriceCents: number;
  currency: string;
  checkoutMode: string;
  feeCredited: boolean;
  inviteToken: string;
  clientEmail: string;
  authoritativePaid: string;
  publicOrigin: string;
  successPath: string;
  checkoutMethod: string;
  checkoutPath: string;
  statusMethod: string;
  statusPath: string;
  webhookMethod: string;
  webhookPath: string;
  stripeSecretKeyEnv: string;
  stripeWebhookSecretEnv: string;
  tokenSecretEnv: string;
  publicOriginEnv: string;
  enableFlagEnv: string;
  allowLiveEnv: string;
  stripeAccountId: string;
  webhookEvents: string[];
  ledgerMode: string;
  ledgerTable: string | null;
  ledgerColumns: string[];
  databaseSecretEnv: string | null;
  protectedCommit: string | null;
};

type ParsedContract =
  | { ok: true; value: Contract }
  | { ok: false; problems: string[] };

type BackendNames = {
  stripeSecretKeyEnv: string;
  stripeWebhookSecretEnv: string;
  tokenSecretEnv: string;
  publicOriginEnv: string;
  enableFlagEnv: string;
  allowLiveEnv: string;
  feeCents: number;
  productPriceCents: number;
  currency: string;
  feePolicy: string;
  checkoutPath: string;
  statusPath: string;
  webhookPath: string;
  successPath: string;
};

type KeyMode = "live" | "test" | "unrecognized";

const CHECK_ORDER = [
  "protected_commit",
  "code_constants",
  "routes",
  "experiment_split",
  "origin_source",
  "contract",
  "origin_env",
  "secret_presence",
  "secret_not_public",
  "token_secret",
  "allow_live",
  "enable_flag",
  "ledger",
  "schema_compatibility",
  "stripe_mode",
  "stripe_account",
  "stripe_webhook",
] as const;

export function redact(text: string, secrets: string[]): string {
  let out = text;
  const unique = [...new Set(secrets.map((secret) => secret.trim()).filter((secret) => secret.length >= 8))];
  unique.sort((a, b) => b.length - a.length);
  for (const secret of unique) out = out.split(secret).join("[redacted]");
  out = out.replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g, "[redacted-key]");
  out = out.replace(/\bwhsec_[A-Za-z0-9]+/g, "[redacted-webhook-secret]");
  return out;
}

function present(env: Record<string, string | undefined>, name: string): string {
  return (env[name] ?? "").trim();
}

function quotedConstant(source: string, name: string): string | null {
  const match = source.match(
    new RegExp(`export const ${name} = ["']([^"']*)["']`),
  );
  return match?.[1] ?? null;
}

function numericConstant(source: string, name: string): number | null {
  const match = source.match(new RegExp(`export const ${name} = ([0-9_]+)`));
  if (!match?.[1]) return null;
  const value = Number(match[1].replaceAll("_", ""));
  return Number.isSafeInteger(value) ? value : null;
}

export function parseBackendNames(source: string | null): BackendNames | null {
  if (!source) return null;
  const stripeSecretKeyEnv = quotedConstant(source, "ENV_STRIPE_SECRET_KEY");
  const stripeWebhookSecretEnv = quotedConstant(source, "ENV_STRIPE_WEBHOOK_SECRET");
  const tokenSecretEnv = quotedConstant(source, "ENV_RESERVATION_TOKEN_SECRET");
  const publicOriginEnv = quotedConstant(source, "ENV_PUBLIC_ORIGIN");
  const enableFlagEnv = quotedConstant(source, "ENV_RESERVATION_ENABLED");
  const allowLiveEnv = quotedConstant(source, "ENV_RESERVATION_ALLOW_LIVE");
  const feeCents = numericConstant(source, "RESERVATION_FEE_CENTS");
  const productPriceCents = numericConstant(source, "LATER_PRODUCT_PRICE_CENTS");
  const currency = quotedConstant(source, "RESERVATION_CURRENCY");
  const feePolicy = quotedConstant(source, "FEE_POLICY");
  const checkoutPath = quotedConstant(source, "CHECKOUT_PATH");
  const statusPath = quotedConstant(source, "STATUS_PATH");
  const webhookPath = quotedConstant(source, "WEBHOOK_PATH");
  const successPath = quotedConstant(source, "SUCCESS_PATH");
  if (
    !stripeSecretKeyEnv ||
    !stripeWebhookSecretEnv ||
    !tokenSecretEnv ||
    !publicOriginEnv ||
    !enableFlagEnv ||
    !allowLiveEnv ||
    feeCents === null ||
    productPriceCents === null ||
    !currency ||
    !feePolicy ||
    !checkoutPath ||
    !statusPath ||
    !webhookPath ||
    !successPath
  ) {
    return null;
  }
  return {
    stripeSecretKeyEnv,
    stripeWebhookSecretEnv,
    tokenSecretEnv,
    publicOriginEnv,
    enableFlagEnv,
    allowLiveEnv,
    feeCents,
    productPriceCents,
    currency,
    feePolicy,
    checkoutPath,
    statusPath,
    webhookPath,
    successPath,
  };
}

export function parseHandledEvents(source: string | null): string[] | null {
  if (!source) return null;
  const match = source.match(/const HANDLED_EVENTS = new Set\(\[([\s\S]*?)\]\)/);
  if (!match?.[1]) return null;
  const events = [...match[1].matchAll(/["']([a-z0-9_.]+)["']/g)].map((item) => item[1] ?? "");
  if (events.length === 0 || events.some((event) => event.length === 0)) return null;
  return events;
}

function sameSet(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function parseContract(text: string | null): ParsedContract {
  if (text === null) {
    return {
      ok: false,
      problems: ["docs/reservation-contract.md is not present, so the ledger and account id are unspecified"],
    };
  }
  const fence = [...text.matchAll(/```reservation-readiness\r?\n([\s\S]*?)```/g)];
  if (fence.length === 0) {
    return { ok: false, problems: ["docs/reservation-contract.md has no reservation-readiness block"] };
  }
  if (fence.length > 1) {
    return { ok: false, problems: ["docs/reservation-contract.md has more than one reservation-readiness block"] };
  }
  const lines = (fence[0]?.[1] ?? "").split(/\r?\n/);
  const values = new Map<string, string>();
  const problems: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const split = line.indexOf(":");
    if (split <= 0) {
      problems.push("contract block has a line without a key");
      continue;
    }
    const key = line.slice(0, split).trim();
    const value = line.slice(split + 1).trim();
    if (!KNOWN_KEYS.has(key)) {
      problems.push(`contract block has unknown key ${key}`);
      continue;
    }
    if (values.has(key)) problems.push(`contract block repeats ${key}`);
    if (!value) problems.push(`contract block has an empty ${key}`);
    values.set(key, value);
  }
  for (const key of REQUIRED_KEYS) {
    if (!values.has(key)) problems.push(`contract block is missing ${key}`);
  }
  const read = (key: string) => values.get(key) ?? "";
  const amountCents = Number(read("amount_cents"));
  const productPriceCents = Number(read("product_price_cents"));
  const schemaVersion = Number(read("schema_version"));
  const webhookEvents = read("webhook_events")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const ledgerColumns = read("ledger_columns")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const ledgerMode = read("ledger_mode");
  if (read("schema_version") && schemaVersion !== 1) problems.push("schema_version must be 1");
  if (read("amount_cents") && amountCents !== FEE_CENTS) {
    problems.push("amount_cents must be 300");
  }
  if (read("product_price_cents") && productPriceCents !== PRODUCT_PRICE_CENTS) {
    problems.push("product_price_cents must be 14900");
  }
  if (read("currency") && read("currency") !== "usd") problems.push("currency must be usd");
  if (read("checkout_mode") && read("checkout_mode") !== "payment") {
    problems.push("checkout_mode must be payment");
  }
  if (read("fee_credited_to_product") && read("fee_credited_to_product") !== "false") {
    problems.push("fee_credited_to_product must be false");
  }
  if (read("invite_token") && read("invite_token") !== "signed") problems.push("invite_token must be signed");
  if (read("client_email") && read("client_email") !== "untrusted") {
    problems.push("client_email must be untrusted");
  }
  if (read("authoritative_paid") && read("authoritative_paid") !== "verified-stripe") {
    problems.push("authoritative_paid must be verified-stripe");
  }
  if (read("public_origin") && read("public_origin") !== PRODUCTION_ORIGIN) {
    problems.push("public_origin must be https://watchdive.diveroid.com");
  }
  if (read("success_path") && read("success_path") !== SUCCESS_PATH) {
    problems.push("success_path must keep the literal {CHECKOUT_SESSION_ID} placeholder");
  }
  if (read("checkout_method") && read("checkout_method") !== "POST") problems.push("checkout_method must be POST");
  if (read("checkout_path") && read("checkout_path") !== CHECKOUT_PATH) {
    problems.push("checkout_path must be /api/reservation/checkout");
  }
  if (read("status_method") && read("status_method") !== "GET") problems.push("status_method must be GET");
  if (read("status_path") && read("status_path") !== STATUS_PATH) {
    problems.push("status_path must be /api/reservation/status");
  }
  if (read("webhook_method") && read("webhook_method") !== "POST") problems.push("webhook_method must be POST");
  if (read("webhook_path") && read("webhook_path") !== WEBHOOK_PATH) {
    problems.push("webhook_path must be /api/reservation/webhook");
  }
  for (const key of [
    "stripe_secret_key_env",
    "stripe_webhook_secret_env",
    "token_secret_env",
    "public_origin_env",
    "enable_flag_env",
    "allow_live_env",
    "database_secret_env",
  ]) {
    const name = values.get(key);
    if (!name) continue;
    if (!/^[A-Z][A-Z0-9_]+$/.test(name) || name.startsWith("VITE_")) {
      problems.push(`${key} must be a server-side environment name`);
    }
  }
  const account = read("stripe_account_id");
  if (account && (account.length < 12 || !ACCOUNT_ID.test(account) || PLACEHOLDER.test(account))) {
    problems.push("stripe_account_id must be the official acct_ id, not a placeholder");
  }
  if (read("webhook_events") && webhookEvents.length === 0) problems.push("webhook_events is empty");
  if (ledgerMode && ledgerMode !== "stripe-retrieve" && ledgerMode !== "sql") {
    problems.push("ledger_mode must be stripe-retrieve or sql");
  }
  if (ledgerMode === "sql") {
    if (!values.has("ledger_table") || !values.has("ledger_columns")) {
      problems.push("sql ledger_mode requires ledger_table and ledger_columns");
    }
    const table = read("ledger_table");
    if (table && !IDENTIFIER.test(table)) problems.push("ledger_table must be an identifier");
    if (ledgerColumns.some((column) => !IDENTIFIER.test(column))) {
      problems.push("ledger_columns must be identifiers");
    }
  }
  if (ledgerMode === "stripe-retrieve" && (values.has("ledger_table") || values.has("ledger_columns"))) {
    problems.push("stripe-retrieve ledger_mode cannot also name a SQL table");
  }
  const pinned = values.get("protected_commit");
  if (pinned && pinned !== PROTECTED_COMMIT) {
    problems.push("protected_commit does not match the hero-restore commit");
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      schemaVersion,
      amountCents,
      productPriceCents,
      currency: read("currency"),
      checkoutMode: read("checkout_mode"),
      feeCredited: false,
      inviteToken: read("invite_token"),
      clientEmail: read("client_email"),
      authoritativePaid: read("authoritative_paid"),
      publicOrigin: read("public_origin"),
      successPath: read("success_path"),
      checkoutMethod: read("checkout_method"),
      checkoutPath: read("checkout_path"),
      statusMethod: read("status_method"),
      statusPath: read("status_path"),
      webhookMethod: read("webhook_method"),
      webhookPath: read("webhook_path"),
      stripeSecretKeyEnv: read("stripe_secret_key_env"),
      stripeWebhookSecretEnv: read("stripe_webhook_secret_env"),
      tokenSecretEnv: read("token_secret_env"),
      publicOriginEnv: read("public_origin_env"),
      enableFlagEnv: read("enable_flag_env"),
      allowLiveEnv: read("allow_live_env"),
      stripeAccountId: account,
      webhookEvents,
      ledgerMode,
      ledgerTable: values.get("ledger_table") ?? null,
      ledgerColumns,
      databaseSecretEnv: values.get("database_secret_env") ?? null,
      protectedCommit: pinned ?? null,
    },
  };
}

function routeMatches(source: string | null, path: string, method: "GET" | "POST"): boolean {
  if (!source) return false;
  return source.includes(`createFileRoute("${path}")`) && new RegExp(`\\b${method}\\s*:`).test(source);
}

export function checkPublicOrigin(raw: string): string | null {
  if (!raw) return "is not set";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "is not an absolute URL";
  }
  if (parsed.protocol !== "https:") return "must use https";
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    return "must be a bare origin";
  }
  if (parsed.origin !== PRODUCTION_ORIGIN) return "must be https://watchdive.diveroid.com";
  return null;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function extractCreateBody(sql: string, table: string): string | null {
  const matcher = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\s*\\(`,
    "i",
  );
  const found = matcher.exec(sql);
  if (!found) return null;
  let depth = 1;
  let body = "";
  for (let index = found.index + found[0].length; index < sql.length && depth > 0; index += 1) {
    const char = sql[index] ?? "";
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth > 0) body += char;
  }
  return body;
}

function columnNames(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let current = "";
  const flush = () => {
    const token = current.trim().split(/\s+/)[0]?.replaceAll('"', "") ?? "";
    if (IDENTIFIER.test(token) && !/^(constraint|primary|unique|check|foreign)$/i.test(token)) {
      names.push(token.toLowerCase());
    }
    current = "";
  };
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")" && depth > 0) depth -= 1;
    if (char === "," && depth === 0) flush();
    else current += char;
  }
  flush();
  return names;
}

export function inspectMigrations(files: MigrationFile[]): {
  droppedWaitlist: boolean;
  alteredWaitlist: boolean;
  waitlistDefined: boolean;
  ledgerCreates: { name: string; columns: string[] }[];
} {
  let droppedWaitlist = false;
  let alteredWaitlist = false;
  let waitlistDefined = false;
  const ledgerCreates: { name: string; columns: string[] }[] = [];
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    if (/\bdrop\s+table\s+(if\s+exists\s+)?(public\.)?waitlist_signups\b/i.test(sql)) {
      droppedWaitlist = true;
    }
    if (/\balter\s+table\s+(only\s+)?(public\.)?waitlist_signups\s+add\s+column\b/i.test(sql)) {
      alteredWaitlist = true;
    }
    if (/\bcreate\s+table\s+(if\s+not\s+exists\s+)?(public\.)?waitlist_signups\b/i.test(sql)) {
      waitlistDefined = true;
    }
    const tables = [
      ...sql.matchAll(
        /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi,
      ),
    ].map((match) => match[1]?.toLowerCase() ?? "");
    for (const table of tables) {
      if (!table || table === "waitlist_signups") continue;
      const body = extractCreateBody(sql, table);
      if (body) ledgerCreates.push({ name: file.name, columns: columnNames(body) });
    }
  }
  return { droppedWaitlist, alteredWaitlist, waitlistDefined, ledgerCreates };
}

export function keyMode(secret: string): KeyMode {
  if (/^(?:sk|rk)_live_\S+$/.test(secret) && secret.length >= 20) return "live";
  if (/^(?:sk|rk)_test_\S+$/.test(secret) && secret.length >= 20) return "test";
  return "unrecognized";
}

type StripeError = { status: number; code: string };
type AccountView = { id: string; chargesEnabled: boolean; detailsSubmitted: boolean };
type EndpointView = { id: string; url: string; status: string; livemode: boolean; enabledEvents: string[] };

export async function stripeGet(
  url: string,
  key: string,
  fetchImpl: typeof fetch,
): Promise<{ status: number; json: unknown }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.stripe.com") {
    throw new Error("refused non-stripe host");
  }
  if (parsed.port !== "" && parsed.port !== "443") throw new Error("refused stripe port");
  if (parsed.username || parsed.password || parsed.hash) throw new Error("refused stripe url");
  if (parsed.pathname !== "/v1/account" && parsed.pathname !== "/v1/webhook_endpoints") {
    throw new Error("refused stripe path");
  }
  for (const [name, value] of parsed.searchParams) {
    const allowed =
      (name === "limit" && value === "100") ||
      (name === "starting_after" && WEBHOOK_ID.test(value));
    if (!allowed) throw new Error("refused stripe query");
  }
  const response = await fetchImpl(parsed.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": STRIPE_API_VERSION,
    },
  });
  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}

function errorCode(json: unknown, status: number): StripeError {
  const error = (json as { error?: { type?: unknown; code?: unknown } } | null)?.error;
  const type = typeof error?.type === "string" && /^[a-z0-9_]+$/i.test(error.type) ? error.type : "unknown";
  const code = typeof error?.code === "string" && /^[a-z0-9_]+$/i.test(error.code) ? error.code : "none";
  return { status, code: `${type}/${code}` };
}

function asAccount(json: unknown): AccountView | null {
  if (!json || typeof json !== "object") return null;
  const record = json as { id?: unknown; charges_enabled?: unknown; details_submitted?: unknown };
  if (typeof record.id !== "string" || !ACCOUNT_ID.test(record.id)) return null;
  if (typeof record.charges_enabled !== "boolean" || typeof record.details_submitted !== "boolean") {
    return null;
  }
  return {
    id: record.id,
    chargesEnabled: record.charges_enabled,
    detailsSubmitted: record.details_submitted,
  };
}

function asEndpoints(json: unknown): { items: EndpointView[]; hasMore: boolean; malformed: boolean } | null {
  if (!json || typeof json !== "object") return null;
  const record = json as { data?: unknown; has_more?: unknown };
  if (!Array.isArray(record.data) || typeof record.has_more !== "boolean") return null;
  const items: EndpointView[] = [];
  for (const entry of record.data) {
    if (!entry || typeof entry !== "object") return { items, hasMore: record.has_more, malformed: true };
    const endpoint = entry as {
      id?: unknown;
      url?: unknown;
      status?: unknown;
      livemode?: unknown;
      enabled_events?: unknown;
    };
    if (typeof endpoint.id !== "string" || !WEBHOOK_ID.test(endpoint.id)) {
      return { items, hasMore: record.has_more, malformed: true };
    }
    if (typeof endpoint.url !== "string" || typeof endpoint.status !== "string" || typeof endpoint.livemode !== "boolean") {
      return { items, hasMore: record.has_more, malformed: true };
    }
    if (!Array.isArray(endpoint.enabled_events) || endpoint.enabled_events.some((event) => typeof event !== "string")) {
      return { items, hasMore: record.has_more, malformed: true };
    }
    items.push({
      id: endpoint.id,
      url: endpoint.url,
      status: endpoint.status,
      livemode: endpoint.livemode,
      enabledEvents: endpoint.enabled_events.filter((event): event is string => typeof event === "string"),
    });
  }
  return { items, hasMore: record.has_more, malformed: false };
}

function eventsCover(enabled: string[], required: string[]): boolean {
  if (enabled.includes("*")) return true;
  const have = new Set(enabled);
  return required.every((event) => have.has(event));
}

function push(checks: ReadinessCheck[], id: string, status: CheckStatus, summary: string) {
  checks.push({ id, status, summary });
}

export async function evaluateReadiness(input: ReadinessInput): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const names = parseBackendNames(input.code.constants);
  const contract = parseContract(input.code.contractText);
  const handled = parseHandledEvents(input.code.webhookSource);

  if (!input.git.protectedCommitInRepo) {
    push(
      checks,
      "protected_commit",
      "fail",
      `Protected hero-restore commit ${PROTECTED_COMMIT} is not in this clone. Its parent is ${HERO_RESTORE_PARENT}. Do not deploy this tree, do not reset to ${UNSAFE_ROLLBACK_COMMIT}, and do not deploy that parent in place of the hero restore.`,
    );
  } else if (!input.git.protectedCommitIsAncestor) {
    push(
      checks,
      "protected_commit",
      "fail",
      `HEAD does not contain hero-restore commit ${PROTECTED_COMMIT}. Do not deploy, do not reset to ${UNSAFE_ROLLBACK_COMMIT}, and do not revert that commit.`,
    );
  } else {
    push(
      checks,
      "protected_commit",
      "pass",
      `HEAD contains protected hero-restore commit ${PROTECTED_COMMIT}.`,
    );
  }

  if (!names) {
    push(checks, "code_constants", "fail", "src/lib/reservation/constants.ts is missing or does not export the reservation contract constants.");
  } else if (
    names.feeCents !== FEE_CENTS ||
    names.productPriceCents !== PRODUCT_PRICE_CENTS ||
    names.currency !== "usd" ||
    names.feePolicy !== "additional_not_credited" ||
    names.checkoutPath !== CHECKOUT_PATH ||
    names.statusPath !== STATUS_PATH ||
    names.webhookPath !== WEBHOOK_PATH ||
    names.successPath !== SUCCESS_PATH
  ) {
    push(checks, "code_constants", "fail", "Backend constants do not match the approved USD 3 additional fee, USD 149 product price, or reservation routes.");
  } else {
    push(
      checks,
      "code_constants",
      "pass",
      `Backend env names are ${names.enableFlagEnv}, ${names.allowLiveEnv}, ${names.stripeSecretKeyEnv}, ${names.stripeWebhookSecretEnv}, ${names.tokenSecretEnv}, and ${names.publicOriginEnv}.`,
    );
  }

  const routesOk =
    routeMatches(input.code.checkoutRoute, CHECKOUT_PATH, "POST") &&
    routeMatches(input.code.statusRoute, STATUS_PATH, "GET") &&
    routeMatches(input.code.webhookRoute, WEBHOOK_PATH, "POST");
  push(
    checks,
    "routes",
    routesOk ? "pass" : "fail",
    routesOk
      ? "Checkout POST, status GET, and webhook POST routes are present."
      : "One of the reservation route files is missing or does not declare the required method.",
  );

  const experiment = input.code.experimentClient ?? "";
  const splitOk =
    experiment.includes('return byte < 128 ? "control" : "form_first"') &&
    experiment.includes("<128?'control':'form_first'");
  push(
    checks,
    "experiment_split",
    splitOk ? "pass" : "fail",
    splitOk
      ? "Form-first assignment is still the 50:50 byte < 128 split."
      : "Form-first 50:50 assignment marker is missing. Do not change the experiment as part of reservation.",
  );

  const seoOk = (input.code.seo ?? "").includes(
    `export const WATCHDIVE_PUBLIC_ORIGIN = "${PRODUCTION_ORIGIN}"`,
  );
  push(
    checks,
    "origin_source",
    seoOk ? "pass" : "fail",
    seoOk
      ? `Source origin constant is ${PRODUCTION_ORIGIN}.`
      : "src/lib/i18n/seo.ts does not pin https://watchdive.diveroid.com.",
  );

  if (!contract.ok) {
    push(checks, "contract", "fail", contract.problems.join(" "));
  } else if (names && (
    contract.value.stripeSecretKeyEnv !== names.stripeSecretKeyEnv ||
    contract.value.stripeWebhookSecretEnv !== names.stripeWebhookSecretEnv ||
    contract.value.tokenSecretEnv !== names.tokenSecretEnv ||
    contract.value.publicOriginEnv !== names.publicOriginEnv ||
    contract.value.enableFlagEnv !== names.enableFlagEnv ||
    contract.value.allowLiveEnv !== names.allowLiveEnv
  )) {
    push(checks, "contract", "fail", "Contract environment names do not match src/lib/reservation/constants.ts.");
  } else if (handled && !sameSet(contract.value.webhookEvents, handled)) {
    push(checks, "contract", "fail", "Contract webhook_events do not match HANDLED_EVENTS in the webhook module.");
  } else if (!handled) {
    push(checks, "contract", "fail", "Could not parse HANDLED_EVENTS, so webhook coverage is unconfirmed.");
  } else {
    push(checks, "contract", "pass", "Canonical reservation-readiness block matches the approved terms and backend names.");
  }

  const originName = contract.ok ? contract.value.publicOriginEnv : names?.publicOriginEnv ?? "WATCHDIVE_PUBLIC_ORIGIN";
  const originProblem = checkPublicOrigin(present(input.env, originName));
  push(
    checks,
    "origin_env",
    originProblem ? "fail" : "pass",
    originProblem
      ? `${originName} ${originProblem}.`
      : `${originName} is ${PRODUCTION_ORIGIN}.`,
  );

  const secretNames = contract.ok
    ? [contract.value.stripeSecretKeyEnv, contract.value.stripeWebhookSecretEnv]
    : names
      ? [names.stripeSecretKeyEnv, names.stripeWebhookSecretEnv]
      : ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"];
  const missingSecrets = secretNames.filter((name) => !present(input.env, name));
  push(
    checks,
    "secret_presence",
    missingSecrets.length === 0 ? "pass" : "fail",
    missingSecrets.length === 0
      ? "Required server secrets are present. Values are not shown."
      : `Missing ${missingSecrets.join(", ")}. Values are not shown.`,
  );

  const publicSecretNames = Object.keys(input.env).filter(
    (name) => name.startsWith("VITE_") && SECRET_NAME.test(name) && present(input.env, name),
  );
  push(
    checks,
    "secret_not_public",
    publicSecretNames.length === 0 ? "pass" : "fail",
    publicSecretNames.length === 0
      ? "No VITE_ secret is set."
      : `Refusing public env names: ${publicSecretNames.join(", ")}.`,
  );

  const tokenName = contract.ok ? contract.value.tokenSecretEnv : names?.tokenSecretEnv ?? "WATCHDIVE_RESERVATION_TOKEN_SECRET";
  const token = present(input.env, tokenName);
  const tokenBytes = Buffer.byteLength(token, "utf8");
  push(
    checks,
    "token_secret",
    token && tokenBytes >= TOKEN_SECRET_MIN_BYTES ? "pass" : "fail",
    !token
      ? `${tokenName} is not set.`
      : tokenBytes >= TOKEN_SECRET_MIN_BYTES
        ? `${tokenName} is present and long enough. The value is not shown.`
        : `${tokenName} is present but shorter than ${TOKEN_SECRET_MIN_BYTES} bytes. The value is not shown.`,
  );

  const allowName = contract.ok ? contract.value.allowLiveEnv : names?.allowLiveEnv ?? "WATCHDIVE_RESERVATION_ALLOW_LIVE";
  const allowValue = present(input.env, allowName);
  push(
    checks,
    "allow_live",
    allowValue === "true" ? "pass" : "fail",
    allowValue === "true"
      ? `${allowName} is exactly true. This flag does not take a charge by itself.`
      : `${allowName} must be exactly true before a live key can serve. It is not set to that value.`,
  );

  const enableName = contract.ok ? contract.value.enableFlagEnv : names?.enableFlagEnv ?? "WATCHDIVE_RESERVATION_ENABLED";
  const enableValue = present(input.env, enableName);
  const enableOff = enableValue === "" || enableValue === "false";
  const enableOn = enableValue === "true";
  push(
    checks,
    "enable_flag",
    enableOff || enableOn ? "pass" : "fail",
    enableOn
      ? `${enableName} is exactly true.`
      : enableOff
        ? `${enableName} is off, so checkout stays inert until root enables it.`
        : `${enableName} must be exactly true or off. Other values are not an agreed state.`,
  );

  const schema = inspectMigrations(input.code.migrations);
  if (!contract.ok) {
    push(checks, "ledger", "fail", "Durable ledger is blocked until the canonical contract specifies ledger_mode.");
  } else if (contract.value.ledgerMode === "stripe-retrieve") {
    push(
      checks,
      "ledger",
      "pass",
      "Contract selects stripe-retrieve. This command does not probe stored Checkout Sessions and does not apply a migration.",
    );
  } else {
    const table = contract.value.ledgerTable ?? "";
    const wanted = contract.value.ledgerColumns.map((column) => column.toLowerCase());
    const creates = input.code.migrations.flatMap((file) => {
      const sql = stripSqlComments(file.sql);
      const body = extractCreateBody(sql, table);
      return body ? [{ name: file.name, columns: columnNames(body) }] : [];
    });
    if (creates.length !== 1) {
      push(checks, "ledger", "fail", `Expected one CREATE TABLE for ${table}. Found ${creates.length}.`);
    } else {
      const created = creates[0];
      const have = new Set(created?.columns ?? []);
      const absent = wanted.filter((column) => !have.has(column));
      const receipt = input.receipt;
      const hash = input.receiptMigrationSql === null
        ? null
        : createHash("sha256").update(input.receiptMigrationSql).digest("hex");
      if (absent.length > 0) {
        push(checks, "ledger", "fail", `Migration ${created?.name ?? "unknown"} is missing ${absent.join(", ")}.`);
      } else if (!receipt) {
        push(checks, "ledger", "fail", "SQL matches the contract, and no root attestation receipt was provided. This command does not apply SQL.");
      } else if (
        receipt.schemaVersion !== 1 ||
        receipt.attestation !== "root-applied-read-only-confirmation" ||
        receipt.liveProbe !== false ||
        receipt.table !== table ||
        receipt.migrationFile !== created?.name ||
        receipt.sha256 !== hash
      ) {
        push(checks, "ledger", "fail", "Ledger receipt does not match this migration file. liveProbe must stay false.");
      } else {
        push(
          checks,
          "ledger",
          "pass",
          `Ledger table ${table} matches ${created?.name ?? "the migration"} by operator attestation, not by a live database probe.`,
        );
      }
    }
  }

  if (schema.droppedWaitlist || schema.alteredWaitlist || !schema.waitlistDefined) {
    const reason = schema.droppedWaitlist
      ? "A migration drops waitlist_signups."
      : schema.alteredWaitlist
        ? "A migration adds a column to waitlist_signups."
        : "Historical waitlist_signups migration is missing.";
    push(checks, "schema_compatibility", "fail", `${reason} Reservation must not rewrite that table from this command.`);
  } else if (contract.ok && contract.value.databaseSecretEnv && !present(input.env, contract.value.databaseSecretEnv)) {
    push(
      checks,
      "schema_compatibility",
      "fail",
      `${contract.value.databaseSecretEnv} is not set. The value is not shown, and this command does not create it.`,
    );
  } else {
    push(
      checks,
      "schema_compatibility",
      "pass",
      "waitlist_signups is still defined and is not dropped or extended. No service-role value was read.",
    );
  }

  const stripeSecretName = secretNames[0] ?? "STRIPE_SECRET_KEY";
  const stripeSecret = present(input.env, stripeSecretName);
  const mode = stripeSecret ? keyMode(stripeSecret) : "unrecognized";
  let account: AccountView | null = null;
  let endpoints: EndpointView[] = [];
  let stripeFailure: string | null = null;

  if (!input.networkReadonly) {
    push(checks, "stripe_mode", "skip", "Stripe mode was not checked. Pass --network-readonly for read-only GET requests.");
    push(checks, "stripe_account", "skip", "Stripe account was not read.");
    push(checks, "stripe_webhook", "skip", "Webhook configuration was not read.");
  } else if (!stripeSecret) {
    push(checks, "stripe_mode", "fail", "No Stripe secret is set, so no request was sent.");
    push(checks, "stripe_account", "fail", "Account check did not run.");
    push(checks, "stripe_webhook", "fail", "Webhook check did not run.");
  } else if (mode !== "live") {
    push(checks, "stripe_mode", "fail", "Production requires a live key. No request was sent.");
    push(checks, "stripe_account", "fail", "Account check did not run.");
    push(checks, "stripe_webhook", "fail", "Webhook check did not run.");
  } else if (!contract.ok) {
    push(checks, "stripe_mode", "pass", "Secret key mode is live. The value is not shown.");
    push(checks, "stripe_account", "fail", "Account id is not pinned in the contract, so no request was sent.");
    push(checks, "stripe_webhook", "fail", "Webhook requirements are not pinned in the contract, so no request was sent.");
  } else {
    push(checks, "stripe_mode", "pass", "Secret key mode is live. The value is not shown.");
    const fetchImpl = input.fetchImpl ?? fetch;
    try {
      const accountResponse = await stripeGet("https://api.stripe.com/v1/account", stripeSecret, fetchImpl);
      if (accountResponse.status < 200 || accountResponse.status >= 300) {
        const coded = errorCode(accountResponse.json, accountResponse.status);
        stripeFailure = `Account GET returned HTTP ${coded.status} (${coded.code}).`;
      } else {
        account = asAccount(accountResponse.json);
        if (!account) stripeFailure = "Account GET returned an unexpected shape.";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      stripeFailure = message.startsWith("refused ") ? message : "Stripe read failed before a reportable response.";
    }
    const accountReady = account !== null
      && !stripeFailure
      && account.id === contract.value.stripeAccountId
      && account.chargesEnabled
      && account.detailsSubmitted;
    if (stripeFailure || !account) {
      push(checks, "stripe_account", "fail", stripeFailure ?? "Account check failed.");
      push(checks, "stripe_webhook", "fail", "Webhook check did not finish.");
    } else if (account.id !== contract.value.stripeAccountId) {
      push(checks, "stripe_account", "fail", "Retrieved account id does not match the contract. The key value is not shown.");
      push(checks, "stripe_webhook", "fail", "Webhook check stopped because the account id did not match.");
    } else if (!account.chargesEnabled || !account.detailsSubmitted) {
      push(
        checks,
        "stripe_account",
        "fail",
        `${account.id} is not charges-enabled with details submitted. Root still has to confirm the Diveroid business account in Stripe.`,
      );
      push(checks, "stripe_webhook", "fail", "Webhook check stopped because the account is not enabled.");
    } else {
      push(
        checks,
        "stripe_account",
        "pass",
        `${account.id} matches the contract and has charges enabled with details submitted. This does not replace root's confirmation that the account is the official business account.`,
      );
    }
    if (accountReady) {
    try {
      let startingAfter: string | null = null;
      let hasMore = true;
      for (let page = 0; page < 3 && hasMore; page += 1) {
        const url = new URL("https://api.stripe.com/v1/webhook_endpoints");
        url.searchParams.set("limit", "100");
        if (startingAfter) url.searchParams.set("starting_after", startingAfter);
        const listed = await stripeGet(url.toString(), stripeSecret, fetchImpl);
        if (listed.status < 200 || listed.status >= 300) {
          const coded = errorCode(listed.json, listed.status);
          stripeFailure = `Webhook GET returned HTTP ${coded.status} (${coded.code}).`;
          break;
        }
        const parsed = asEndpoints(listed.json);
        if (!parsed || parsed.malformed) {
          stripeFailure = "Webhook GET returned an unexpected shape.";
          break;
        }
        endpoints = endpoints.concat(parsed.items);
        hasMore = parsed.hasMore;
        startingAfter = parsed.items.at(-1)?.id ?? null;
        if (hasMore && !startingAfter) {
          stripeFailure = "Webhook list did not provide a continuation id.";
          break;
        }
      }
      if (!stripeFailure && hasMore) stripeFailure = "Webhook list was truncated. No further request was sent.";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      stripeFailure = message.startsWith("refused ") ? message : "Stripe read failed before a reportable response.";
    }
      const expectedUrl = `${PRODUCTION_ORIGIN}${WEBHOOK_PATH}`;
      const matching = endpoints.filter((endpoint) => endpoint.url === expectedUrl);
      const enabled = matching.filter((endpoint) => endpoint.status === "enabled" && endpoint.livemode);
      const covered = enabled.filter((endpoint) => eventsCover(endpoint.enabledEvents, contract.value.webhookEvents));
      if (stripeFailure) {
        push(checks, "stripe_webhook", "fail", stripeFailure);
      } else if (covered.length === 0) {
        push(checks, "stripe_webhook", "fail", `No enabled live webhook is listed for ${expectedUrl} with the contract events.`);
      } else {
        push(checks, "stripe_webhook", "pass", `An enabled live webhook matches ${expectedUrl}. Endpoint secrets are not shown.`);
      }
    }
  }

  const secretValues = Object.entries(input.env)
    .filter(([name, value]) => SECRET_NAME.test(name) && !name.endsWith("_ENV") && typeof value === "string")
    .map(([, value]) => value ?? "");
  for (const check of checks) check.summary = redact(check.summary, secretValues);

  const blockedReasons = checks
    .filter((check) => check.status !== "pass")
    .map((check) => `${check.id}: ${check.summary}`);
  const ordered = CHECK_ORDER.map((id) => checks.find((check) => check.id === id)).filter(
    (check): check is ReadinessCheck => Boolean(check),
  );
  return {
    verdict: blockedReasons.length === 0 ? "ready" : "blocked",
    target: "production",
    networkReadonly: input.networkReadonly,
    headCommit: input.git.headCommit,
    protectedCommit: PROTECTED_COMMIT,
    heroRestoreParent: HERO_RESTORE_PARENT,
    unsafeRollbackCommit: UNSAFE_ROLLBACK_COMMIT,
    mutations: false,
    checks: ordered,
    blockedReasons,
  };
}

export function renderReport(report: ReadinessReport, asJson: boolean): string {
  if (asJson) return `${JSON.stringify(report, null, 2)}\n`;
  const lines = [
    `reservation-readiness: ${report.verdict.toUpperCase()}`,
    `target: ${report.target}`,
    `network: ${report.networkReadonly ? "read-only" : "off"}`,
    `mutations: none`,
    `head: ${report.headCommit ?? "unknown"}`,
    `protected: ${report.protectedCommit}`,
    `hero parent: ${report.heroRestoreParent}`,
    `unsafe rollback: ${report.unsafeRollbackCommit}`,
    "",
    ...report.checks.map((check) => `[${check.status}] ${check.id} — ${check.summary}`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export type CliOptions = {
  help: boolean;
  json: boolean;
  networkReadonly: boolean;
  repo: string;
  contract: string | null;
  migrations: string | null;
  receipt: string | null;
};

export function parseArgs(argv: string[], cwd: string): CliOptions | { error: string } {
  const options: CliOptions = {
    help: false,
    json: false,
    networkReadonly: false,
    repo: cwd,
    contract: null,
    migrations: null,
    receipt: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--network-readonly") options.networkReadonly = true;
    else if (arg === "--target") {
      if (next !== "production") return { error: "Only --target production is approved. No staging origin is approved." };
      index += 1;
    } else if (arg === "--repo" || arg === "--contract" || arg === "--migrations" || arg === "--ledger-receipt") {
      if (!next || next.startsWith("--")) return { error: `${arg} needs a path.` };
      if (arg === "--repo") options.repo = resolve(cwd, next);
      if (arg === "--contract") options.contract = resolve(cwd, next);
      if (arg === "--migrations") options.migrations = resolve(cwd, next);
      if (arg === "--ledger-receipt") options.receipt = resolve(cwd, next);
      index += 1;
    } else {
      return { error: `Unknown argument ${arg}. This command has no apply, send, or deploy flag.` };
    }
  }
  return options;
}

const HELP = `reservation-readiness

Read-only production gate for the WatchDive USD 3 reservation.
Does not charge, refund, send mail, migrate, deploy, change ads, or print secrets.

  node --experimental-strip-types scripts/reservation-readiness.ts [--json]
      [--network-readonly] [--target production]
      [--contract <file>] [--migrations <dir>] [--ledger-receipt <file>]

Stripe GET /v1/account and GET /v1/webhook_endpoints run only with
--network-readonly, and only for a live key after the contract pins acct_.
Exit 0 is ready. Exit 2 is blocked. Exit 1 is a usage error.
`;

function inside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function readText(path: string, root: string): string | null {
  const full = resolve(path);
  if (!inside(root, full)) return null;
  const base = full.split(sep).at(-1) ?? "";
  if (base.startsWith(".env") || base === "id_rsa" || base.endsWith(".pem")) return null;
  let info;
  try {
    info = statSync(full);
  } catch {
    return null;
  }
  if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
  return readFileSync(full, "utf8");
}

function readMigrations(dir: string, root: string): MigrationFile[] {
  const full = resolve(dir);
  if (!inside(root, full)) return [];
  let names: string[] = [];
  try {
    names = readdirSync(full).filter((name) => name.endsWith(".sql")).sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const sql = readText(resolve(full, name), root);
    return sql === null ? [] : [{ name, sql }];
  });
}

function gitFacts(repo: string): GitFacts {
  const run = (args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch {
      return null;
    }
  };
  const head = run(["rev-parse", "HEAD"]);
  const present = run(["cat-file", "-e", `${PROTECTED_COMMIT}^{commit}`]) !== null;
  let ancestor = false;
  if (present) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", PROTECTED_COMMIT, "HEAD"], {
        cwd: repo,
        timeout: 5000,
        stdio: ["ignore", "ignore", "ignore"],
      });
      ancestor = true;
    } catch {
      ancestor = false;
    }
  }
  return {
    headCommit: head,
    protectedCommitInRepo: present,
    protectedCommitIsAncestor: ancestor,
  };
}

function readReceipt(path: string, repo: string, migrationsDir: string): { receipt: LedgerReceipt | null; sql: string | null; error: string | null } {
  const text = readText(path, dirname(path));
  if (text === null) return { receipt: null, sql: null, error: "ledger receipt could not be read" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { receipt: null, sql: null, error: "ledger receipt is not JSON" };
  }
  if (!parsed || typeof parsed !== "object") return { receipt: null, sql: null, error: "ledger receipt is not an object" };
  const record = parsed as Partial<LedgerReceipt>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.migrationFile !== "string" ||
    typeof record.sha256 !== "string" ||
    typeof record.table !== "string" ||
    record.attestation !== "root-applied-read-only-confirmation" ||
    record.liveProbe !== false
  ) {
    return { receipt: null, sql: null, error: "ledger receipt fields are invalid" };
  }
  if (!/^[a-zA-Z0-9._-]+\.sql$/.test(record.migrationFile)) {
    return { receipt: null, sql: null, error: "ledger receipt names an unexpected migration file" };
  }
  const sql = readText(resolve(migrationsDir, record.migrationFile), repo);
  return {
    receipt: record as LedgerReceipt,
    sql,
    error: sql === null ? "ledger receipt migration file is not in the migrations directory" : null,
  };
}

export async function main(
  argv: string[],
  io: { cwd?: string; env?: Record<string, string | undefined>; stdout?: (chunk: string) => void; stderr?: (chunk: string) => void; fetchImpl?: typeof fetch } = {},
): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const parsed = parseArgs(argv, cwd);
  const stderr = io.stderr ?? ((chunk: string) => process.stderr.write(chunk));
  const stdout = io.stdout ?? ((chunk: string) => process.stdout.write(chunk));
  if ("error" in parsed) {
    stderr(`${parsed.error}\n${HELP}`);
    return 1;
  }
  if (parsed.help) {
    stdout(HELP);
    return 0;
  }
  const repo = parsed.repo;
  const contractPath = parsed.contract ?? resolve(repo, "docs/reservation-contract.md");
  const migrationsDir = parsed.migrations ?? resolve(repo, "supabase/migrations");
  let receipt: LedgerReceipt | null = null;
  let receiptSql: string | null = null;
  if (parsed.receipt) {
    const loaded = readReceipt(parsed.receipt, repo, migrationsDir);
    if (loaded.error) {
      stderr(`${loaded.error}\n`);
      return 1;
    }
    receipt = loaded.receipt;
    receiptSql = loaded.sql;
  }
  const code: CodeSnapshot = {
    constants: readText(resolve(repo, "src/lib/reservation/constants.ts"), repo),
    webhookSource: readText(resolve(repo, "src/lib/reservation/webhook.ts"), repo),
    checkoutRoute: readText(resolve(repo, "src/routes/api/reservation/checkout.ts"), repo),
    statusRoute: readText(resolve(repo, "src/routes/api/reservation/status.ts"), repo),
    webhookRoute: readText(resolve(repo, "src/routes/api/reservation/webhook.ts"), repo),
    experimentClient: readText(resolve(repo, "src/lib/conversionExperimentClient.ts"), repo),
    seo: readText(resolve(repo, "src/lib/i18n/seo.ts"), repo),
    migrations: readMigrations(migrationsDir, repo),
    contractText: readText(contractPath, repo),
  };
  const report = await evaluateReadiness({
    env: io.env ?? process.env,
    code,
    git: gitFacts(repo),
    networkReadonly: parsed.networkReadonly,
    receipt,
    receiptMigrationSql: receiptSql,
    fetchImpl: io.fetchImpl,
  });
  stdout(renderReport(report, parsed.json));
  return report.verdict === "ready" ? 0 : 2;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
