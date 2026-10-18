// Idempotent Stripe webhook connection for the WatchDive reservation.
//
// Default is dry-run. --apply creates one webhook endpoint only after the
// retrieved account matches the root-verified id. This file does not create
// customers, Checkout Sessions, charges, or refunds, and it does not send mail.
// Signing secrets are written to the private env file and are never printed.

import { createHash, randomBytes } from "node:crypto";
import { closeSync, fchmodSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const OFFICIAL_ACCOUNT_ID = "acct_1Tl9bv1UxFzpSUuA";
export const WEBHOOK_URL = "https://watchdive.diveroid.com/api/reservation/webhook";
export const DEFAULT_ENV_FILE = "/Users/macm4/.config/watchdive-autopilot/reservation.env";
export const CONNECT_MUTATES_PAYMENTS = false;

const STRIPE_ORIGIN = "https://api.stripe.com";
const ACCOUNT_PATH = "/v1/account";
const WEBHOOK_PATH = "/v1/webhook_endpoints";
const ENV_MODE = 0o600;
const PAGE_LIMIT = 3;

const VALUE_KEYS = new Set(["STRIPE_SECRET_KEY"]);
const PRESENCE_KEYS = new Set([
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "WATCHDIVE_RESERVATION_TOKEN_SECRET",
  "WATCHDIVE_RESERVATION_ALLOW_LIVE",
  "WATCHDIVE_RESERVATION_ENABLED",
  "WATCHDIVE_PUBLIC_ORIGIN",
]);

export type EndpointMatch = "absent" | "exact" | "conflict";

export type EndpointView = {
  id: string;
  url: string;
  status: string;
  livemode: boolean;
  apiVersion: string | null;
  enabledEvents: string[];
};

export type EnvSnapshot = {
  path: string;
  mode: number | null;
  symlink: boolean;
  ownerOk: boolean;
  insideRepo: boolean;
  stripeKey: string | null;
  webhookSecretPresent: boolean;
  tokenSecretPresent: boolean;
  origin: string | null;
  allowLive: string | null;
  enabled: string | null;
  unrelatedNames: string[];
};

export type ConnectReport = {
  phase: "dry-run" | "apply";
  connected: false | true;
  accountId: string | null;
  chargesEnabled: boolean | null;
  payoutsEnabled: boolean | null;
  apiVersion: string | null;
  webhookUrl: string;
  events: string[];
  endpointMatch: EndpointMatch | null;
  endpointId: string | null;
  secret: "absent" | "present" | "stored" | "unavailable";
  mutations: string[];
  blockedReasons: string[];
  nextAction: string;
};

export type ConnectInput = {
  env: EnvSnapshot;
  contractText: string | null;
  webhookSource: string | null;
  constantsSource: string | null;
  apply: boolean;
  fetchImpl?: typeof fetch;
  writeSecret?: (secret: string) => "stored" | "failed";
};

type LoadedEvents =
  | { ok: true; events: string[]; apiVersion: string; contractAccount: string | null }
  | { ok: false; reason: string };

function redact(text: string, secrets: string[]): string {
  let out = text;
  const values = [...new Set(secrets.map((item) => item.trim()).filter((item) => item.length >= 8))];
  values.sort((a, b) => b.length - a.length);
  for (const secret of values) out = out.split(secret).join("[redacted]");
  out = out.replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g, "[redacted-key]");
  out = out.replace(/\bwhsec_[A-Za-z0-9]+/g, "[redacted-webhook-secret]");
  return out;
}

function sameSet(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function keyMode(secret: string): "live" | "test" | "unrecognized" {
  if (/^(?:sk|rk)_live_\S+$/.test(secret) && secret.length >= 20) return "live";
  if (/^(?:sk|rk)_test_\S+$/.test(secret) && secret.length >= 20) return "test";
  return "unrecognized";
}

export function parseApiVersion(source: string | null): string | null {
  if (!source) return null;
  const match = source.match(/export const STRIPE_API_VERSION = ["']([^"']+)["']/);
  const version = match?.[1] ?? "";
  return /^\d{4}-\d{2}-\d{2}(?:\.[a-z0-9]+)?$/.test(version) ? version : null;
}

export function parseContractConnection(text: string | null): { events: string[]; account: string | null } | null {
  if (!text) return null;
  const fence = text.match(/```reservation-readiness\r?\n([\s\S]*?)```/);
  if (!fence?.[1]) return null;
  let events: string[] | null = null;
  let account: string | null = null;
  for (const raw of fence[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("webhook_events:")) {
      events = line.slice("webhook_events:".length).split(",").map((item) => item.trim()).filter(Boolean);
    }
    if (line.startsWith("stripe_account_id:")) account = line.slice("stripe_account_id:".length).trim();
  }
  if (!events || events.length === 0) return null;
  return { events, account };
}

export function parseHandledEvents(source: string | null): string[] | null {
  if (!source) return null;
  const match = source.match(/const HANDLED_EVENTS = new Set\(\[([\s\S]*?)\]\)/);
  if (!match?.[1]) return null;
  const events = [...match[1].matchAll(/["']([a-z0-9_.]+)["']/g)].map((item) => item[1] ?? "");
  return events.length > 0 && events.every(Boolean) ? events : null;
}

function loadEvents(input: ConnectInput): LoadedEvents {
  const contract = parseContractConnection(input.contractText);
  const handled = parseHandledEvents(input.webhookSource);
  const apiVersion = parseApiVersion(input.constantsSource);
  if (!contract) return { ok: false, reason: "Canonical contract block has no webhook_events." };
  if (!handled) return { ok: false, reason: "HANDLED_EVENTS could not be read from the webhook module." };
  if (!sameSet(contract.events, handled)) {
    return { ok: false, reason: "Contract webhook_events and HANDLED_EVENTS differ. No endpoint change was sent." };
  }
  if (!apiVersion) return { ok: false, reason: "STRIPE_API_VERSION could not be read from backend constants." };
  return { ok: true, events: contract.events, apiVersion, contractAccount: contract.account };
}

function assignmentName(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const eq = body.indexOf("=");
  if (eq <= 0) return null;
  const name = body.slice(0, eq).trim();
  return /^[A-Z][A-Z0-9_]+$/.test(name) ? name : null;
}

function assignmentValue(line: string): string {
  const trimmed = line.trim();
  const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const eq = body.indexOf("=");
  let value = body.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

export function snapshotEnv(path: string, repo: string, uid: number): EnvSnapshot {
  const full = resolve(path);
  const rel = relative(repo, full);
  const insideRepo = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  const empty: EnvSnapshot = {
    path: full,
    mode: null,
    symlink: false,
    ownerOk: false,
    insideRepo,
    stripeKey: null,
    webhookSecretPresent: false,
    tokenSecretPresent: false,
    origin: null,
    allowLive: null,
    enabled: null,
    unrelatedNames: [],
  };
  let info;
  try {
    info = lstatSync(full);
  } catch {
    return empty;
  }
  if (info.isSymbolicLink()) return { ...empty, symlink: true };
  let file;
  try {
    file = statSync(full);
  } catch {
    return empty;
  }
  const mode = file.mode & 0o777;
  const ownerOk = file.uid === uid;
  const base = { ...empty, mode, ownerOk };
  if (!file.isFile() || mode !== ENV_MODE || !ownerOk || insideRepo) return base;
  const text = readFileSync(full, "utf8");
  let stripeKey: string | null = null;
  let webhookSecretPresent = false;
  let tokenSecretPresent = false;
  let origin: string | null = null;
  let allowLive: string | null = null;
  let enabled: string | null = null;
  const unrelatedNames: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const name = assignmentName(line);
    if (!name) continue;
    if (!PRESENCE_KEYS.has(name)) {
      unrelatedNames.push(name);
      continue;
    }
    const value = assignmentValue(line);
    if (name === "STRIPE_SECRET_KEY" && value) stripeKey = value;
    if (name === "STRIPE_WEBHOOK_SECRET" && value) webhookSecretPresent = true;
    if (name === "WATCHDIVE_RESERVATION_TOKEN_SECRET" && value) tokenSecretPresent = true;
    if (name === "WATCHDIVE_PUBLIC_ORIGIN") origin = value;
    if (name === "WATCHDIVE_RESERVATION_ALLOW_LIVE") allowLive = value;
    if (name === "WATCHDIVE_RESERVATION_ENABLED") enabled = value;
  }
  return {
    ...base,
    stripeKey,
    webhookSecretPresent,
    tokenSecretPresent,
    origin,
    allowLive,
    enabled,
    unrelatedNames,
  };
}

export function renderEnvWithWebhookSecret(raw: string, secret: string): string {
  if (!/^whsec_\S+$/.test(secret)) throw new Error("refusing to store an unrecognized webhook secret");
  const normalized = raw.length === 0 || raw.endsWith("\n") ? raw : `${raw}\n`;
  const lines = normalized.split("\n");
  let seen = false;
  const next = lines.map((line) => {
    if (assignmentName(line) !== "STRIPE_WEBHOOK_SECRET") return line;
    seen = true;
    if (assignmentValue(line)) throw new Error("webhook secret already present");
    return `STRIPE_WEBHOOK_SECRET=${secret}`;
  });
  if (!seen) {
    const trailer = next[next.length - 1] === "" ? next.pop() : undefined;
    next.push(`STRIPE_WEBHOOK_SECRET=${secret}`);
    if (trailer !== undefined) next.push(trailer);
  }
  const body = next.join("\n");
  return body.endsWith("\n") ? body : `${body}\n`;
}

export function writeEnvSecret(path: string, secret: string): "stored" {
  const full = resolve(path);
  const raw = readFileSync(full, "utf8");
  const rendered = renderEnvWithWebhookSecret(raw, secret);
  const tmp = `${full}.tmp-${randomBytes(6).toString("hex")}`;
  let fd: number | null = null;
  try {
    fd = openSync(tmp, "wx", ENV_MODE);
    fchmodSync(fd, ENV_MODE);
    writeSync(fd, rendered);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmp, full);
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // The descriptor is already closed.
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      // The temp file is already gone.
    }
    throw error;
  }
  const written = statSync(full);
  if ((written.mode & 0o777) !== ENV_MODE) throw new Error("env file mode was not 0600 after write");
  return "stored";
}

type StripeResult = { status: number; json: unknown };

export async function stripeRequest(
  method: "GET" | "POST",
  url: string,
  key: string,
  apiVersion: string,
  fetchImpl: typeof fetch,
  body?: URLSearchParams,
  idempotencyKey?: string,
): Promise<StripeResult> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.stripe.com") throw new Error("refused non-stripe host");
  if (parsed.pathname !== ACCOUNT_PATH && parsed.pathname !== WEBHOOK_PATH) throw new Error("refused stripe path");
  if (method === "POST" && parsed.pathname !== WEBHOOK_PATH) throw new Error("refused stripe path");
  if (method === "GET" && parsed.pathname === WEBHOOK_PATH) {
    for (const [name, value] of parsed.searchParams) {
      const allowed = (name === "limit" && value === "100") || (name === "starting_after" && /^we_[A-Za-z0-9]+$/.test(value));
      if (!allowed) throw new Error("refused stripe query");
    }
  }
  if (method === "GET" && parsed.pathname === ACCOUNT_PATH && parsed.search) throw new Error("refused stripe query");
  const headers = new Headers({
    Authorization: `Bearer ${key}`,
    "Stripe-Version": apiVersion,
  });
  if (method === "POST") headers.set("content-type", "application/x-www-form-urlencoded");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const response = await fetchImpl(parsed.toString(), {
    method,
    headers,
    body: method === "POST" ? body?.toString() : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
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
  if (json && typeof json === "object" && "secret" in json) {
    // Callers that need the secret must read it before this clone is stringified.
  }
  return { status: response.status, json };
}

function errorCode(json: unknown, status: number): string {
  const error = (json as { error?: { type?: unknown; code?: unknown } } | null)?.error;
  const type = typeof error?.type === "string" && /^[a-z0-9_]+$/i.test(error.type) ? error.type : "unknown";
  const code = typeof error?.code === "string" && /^[a-z0-9_]+$/i.test(error.code) ? error.code : "none";
  return `HTTP ${status} (${type}/${code})`;
}

function asAccount(json: unknown): { id: string; chargesEnabled: boolean; payoutsEnabled: boolean } | null {
  if (!json || typeof json !== "object") return null;
  const record = json as { id?: unknown; charges_enabled?: unknown; payouts_enabled?: unknown };
  if (typeof record.id !== "string" || !/^acct_[A-Za-z0-9]+$/.test(record.id)) return null;
  if (typeof record.charges_enabled !== "boolean" || typeof record.payouts_enabled !== "boolean") return null;
  return { id: record.id, chargesEnabled: record.charges_enabled, payoutsEnabled: record.payouts_enabled };
}

function asEndpoint(entry: unknown): EndpointView | null {
  if (!entry || typeof entry !== "object") return null;
  const endpoint = entry as {
    id?: unknown;
    url?: unknown;
    status?: unknown;
    livemode?: unknown;
    api_version?: unknown;
    enabled_events?: unknown;
  };
  if (typeof endpoint.id !== "string" || !/^we_[A-Za-z0-9]+$/.test(endpoint.id)) return null;
  if (typeof endpoint.url !== "string" || typeof endpoint.status !== "string" || typeof endpoint.livemode !== "boolean") {
    return null;
  }
  if (!Array.isArray(endpoint.enabled_events) || endpoint.enabled_events.some((event) => typeof event !== "string")) {
    return null;
  }
  const apiVersion = endpoint.api_version == null ? null : endpoint.api_version;
  if (apiVersion !== null && typeof apiVersion !== "string") return null;
  return {
    id: endpoint.id,
    url: endpoint.url,
    status: endpoint.status,
    livemode: endpoint.livemode,
    apiVersion,
    enabledEvents: endpoint.enabled_events.filter((event): event is string => typeof event === "string"),
  };
}

function classify(endpoints: EndpointView[], events: string[], apiVersion: string): { match: EndpointMatch; id: string | null; reason: string } {
  const sameUrl = endpoints.filter((endpoint) => endpoint.url === WEBHOOK_URL);
  if (sameUrl.length === 0) return { match: "absent", id: null, reason: "No webhook is listed for the canonical URL." };
  if (sameUrl.length > 1) {
    return { match: "conflict", id: sameUrl[0]?.id ?? null, reason: "More than one webhook uses the canonical URL. No duplicate was created." };
  }
  const endpoint = sameUrl[0];
  if (!endpoint) return { match: "conflict", id: null, reason: "Webhook list was inconsistent." };
  const exact = endpoint.status === "enabled"
    && endpoint.livemode
    && endpoint.apiVersion === apiVersion
    && sameSet(endpoint.enabledEvents, events);
  if (exact) return { match: "exact", id: endpoint.id, reason: `Reusing ${endpoint.id}. Its signing secret is not returned by a read.` };
  const differences: string[] = [];
  if (endpoint.status !== "enabled") differences.push("status");
  if (!endpoint.livemode) differences.push("livemode");
  if (endpoint.apiVersion !== apiVersion) differences.push("api_version");
  if (!sameSet(endpoint.enabledEvents, events)) differences.push("events");
  return {
    match: "conflict",
    id: endpoint.id,
    reason: `${endpoint.id} does not match the contract (${differences.join(", ")}). It was not modified and no duplicate was created.`,
  };
}

async function listEndpoints(
  key: string,
  apiVersion: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; endpoints: EndpointView[] } | { ok: false; reason: string }> {
  const endpoints: EndpointView[] = [];
  let startingAfter: string | null = null;
  let hasMore = true;
  for (let page = 0; page < PAGE_LIMIT && hasMore; page += 1) {
    const url = new URL(`${STRIPE_ORIGIN}${WEBHOOK_PATH}`);
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);
    const listed = await stripeRequest("GET", url.toString(), key, apiVersion, fetchImpl);
    if (listed.status < 200 || listed.status >= 300) {
      return { ok: false, reason: `Webhook GET returned ${errorCode(listed.json, listed.status)}.` };
    }
    const record = listed.json as { data?: unknown; has_more?: unknown } | null;
    if (!record || !Array.isArray(record.data) || typeof record.has_more !== "boolean") {
      return { ok: false, reason: "Webhook GET returned an unexpected shape." };
    }
    for (const entry of record.data) {
      const endpoint = asEndpoint(entry);
      if (!endpoint) return { ok: false, reason: "Webhook GET returned an unexpected endpoint." };
      endpoints.push(endpoint);
    }
    hasMore = record.has_more;
    startingAfter = endpoints.at(-1)?.id ?? null;
    if (hasMore && !startingAfter) return { ok: false, reason: "Webhook list did not provide a continuation id." };
  }
  if (hasMore) return { ok: false, reason: "Webhook list was truncated. No further request was sent." };
  return { ok: true, endpoints };
}

function blocked(partial: Omit<ConnectReport, "connected" | "blockedReasons" | "nextAction"> & { reasons: string[]; next: string }): ConnectReport {
  return {
    ...partial,
    connected: false,
    blockedReasons: partial.reasons,
    nextAction: partial.next,
  };
}

export async function connectReservation(input: ConnectInput): Promise<ConnectReport> {
  const secrets = [input.env.stripeKey ?? ""];
  const base = {
    phase: input.apply ? "apply" : "dry-run",
    accountId: null,
    chargesEnabled: null,
    payoutsEnabled: null,
    apiVersion: null,
    webhookUrl: WEBHOOK_URL,
    events: [] as string[],
    endpointMatch: null,
    endpointId: null,
    secret: input.env.webhookSecretPresent ? "present" : "absent",
    mutations: [] as string[],
  } as const;
  const fail = (reason: string, next: string, extra: Partial<ConnectReport> = {}): ConnectReport => {
    const report = blocked({ ...base, ...extra, reasons: [reason], next });
    report.blockedReasons = report.blockedReasons.map((item) => redact(item, secrets));
    report.nextAction = redact(report.nextAction, secrets);
    return report;
  };

  if (input.env.insideRepo) return fail("The env file is inside the repository. Refusing to read or write it.", "Move it to the private config path.");
  if (input.env.symlink) return fail("The env file is a symlink. Refusing to read it.", "Replace it with a regular 0600 file.");
  if (input.env.mode === null) return fail("The private env file is absent.", "Root creates it at mode 0600. This command does not invent keys.");
  if (input.env.mode !== ENV_MODE) return fail("The env file mode is not 0600. Its contents were not read.", "chmod 0600, then rerun the dry-run.");
  if (!input.env.ownerOk) return fail("The env file owner does not match this user. Its contents were not read.", "Root runs the command as the file owner.");
  if (!input.env.stripeKey) {
    return fail(
      "STRIPE_SECRET_KEY is not in the private env file. No Stripe request was sent.",
      "Root installs the approved live key, then reruns the dry-run. Restricted-key approval was still pending when this tool was reviewed.",
    );
  }
  const mode = keyMode(input.env.stripeKey);
  if (mode !== "live") return fail("The Stripe key is not a live key. No request was sent.", "Use the live key for the root-verified account.");
  const loaded = loadEvents(input);
  if (!loaded.ok) return fail(loaded.reason, "Align the contract block and HANDLED_EVENTS, then rerun.");
  if (loaded.contractAccount && loaded.contractAccount !== OFFICIAL_ACCOUNT_ID && !/replace|todo|changeme|placeholder/i.test(loaded.contractAccount)) {
    return fail("The contract account id does not match the root-verified account. No request was sent.", "The backend contract task must pin the same account before apply.");
  }
  if (input.env.webhookSecretPresent && input.apply) {
    // A stored secret is kept. Apply may still be a read-only reuse after the account pin.
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  let account: { id: string; chargesEnabled: boolean; payoutsEnabled: boolean };
  try {
    const response = await stripeRequest("GET", `${STRIPE_ORIGIN}${ACCOUNT_PATH}`, input.env.stripeKey, loaded.apiVersion, fetchImpl);
    if (response.status < 200 || response.status >= 300) {
      return fail(`Account GET returned ${errorCode(response.json, response.status)}.`, "Fix the key permission and rerun the dry-run. No webhook was written.", {
        apiVersion: loaded.apiVersion,
        events: loaded.events,
      });
    }
    const parsed = asAccount(response.json);
    if (!parsed) return fail("Account GET did not include id, charges_enabled, and payouts_enabled.", "No webhook was written.", { apiVersion: loaded.apiVersion, events: loaded.events });
    account = parsed;
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("refused ") ? error.message : "Account read failed.";
    return fail(message, "No webhook was written.", { apiVersion: loaded.apiVersion, events: loaded.events });
  }

  const accountFields = {
    accountId: account.id,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
    apiVersion: loaded.apiVersion,
    events: loaded.events,
  };
  if (account.id !== OFFICIAL_ACCOUNT_ID) {
    return fail(`Retrieved account does not match the root-verified pin. No webhook request was sent.`, "Stop. Do not point this repo at a different Stripe account.", accountFields);
  }
  if (!account.chargesEnabled) {
    return fail("charges_enabled is false. No webhook was written.", "Root confirms the live account before apply.", accountFields);
  }

  let endpoints: EndpointView[] = [];
  try {
    const listed = await listEndpoints(input.env.stripeKey, loaded.apiVersion, fetchImpl);
    if (!listed.ok) return fail(listed.reason, "No webhook was written.", accountFields);
    endpoints = listed.endpoints;
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("refused ") ? error.message : "Webhook read failed.";
    return fail(message, "No webhook was written.", accountFields);
  }

  const classified = classify(endpoints, loaded.events, loaded.apiVersion);
  const secretState = input.env.webhookSecretPresent ? "present" : classified.match === "exact" ? "unavailable" : "absent";
  if (classified.match === "conflict") {
    return fail(classified.reason, "Root resolves the existing endpoint. This command will not rotate its secret or add a second endpoint.", {
      ...accountFields,
      endpointMatch: "conflict",
      endpointId: classified.id,
      secret: secretState,
    });
  }
  if (classified.match === "exact") {
    const next = !input.env.webhookSecretPresent
      ? `The endpoint matches, but Stripe does not return an existing signing secret. Paste that endpoint's secret into ${DEFAULT_ENV_FILE} as STRIPE_WEBHOOK_SECRET. Do not roll the endpoint.`
      : input.apply
        ? "The endpoint matches and the saved signing secret was not rotated. This apply did not create or change an endpoint."
        : "The endpoint matches. The saved signing secret was not rotated. connected stays false until root runs --apply and the readback still matches.";
    return {
      phase: input.apply ? "apply" : "dry-run",
      connected: input.apply && input.env.webhookSecretPresent,
      accountId: account.id,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      apiVersion: loaded.apiVersion,
      webhookUrl: WEBHOOK_URL,
      events: loaded.events,
      endpointMatch: "exact",
      endpointId: classified.id,
      secret: secretState,
      mutations: [],
      blockedReasons: input.apply && input.env.webhookSecretPresent ? [] : input.apply ? ["Existing endpoint secret is unavailable. Nothing was rotated."] : [],
      nextAction: next,
    };
  }

  if (input.env.webhookSecretPresent) {
    return fail(
      "A signing secret is already stored, but no matching endpoint exists. Refusing to create another or rotate the stored secret.",
      "Root confirms whether that secret belongs to an endpoint before any create.",
      { ...accountFields, endpointMatch: "absent", secret: "present" },
    );
  }
  if (!input.apply) {
    return {
      phase: "dry-run",
      connected: false,
      ...accountFields,
      endpointMatch: "absent",
      endpointId: null,
      secret: "absent",
      mutations: [],
      blockedReasons: [],
      nextAction: "Dry-run only. Root reviews this output and may rerun with --apply. This process did not create an endpoint.",
    };
  }

  const form = new URLSearchParams();
  form.set("url", WEBHOOK_URL);
  form.set("api_version", loaded.apiVersion);
  form.set("description", "WatchDive reservation webhook");
  loaded.events.forEach((event, index) => form.append(`enabled_events[${index}]`, event));
  const idempotency = `wdres_wh_v1_${createHash("sha256").update([OFFICIAL_ACCOUNT_ID, WEBHOOK_URL, loaded.apiVersion, ...loaded.events].join("\n")).digest("hex").slice(0, 24)}`;
  let created: EndpointView;
  let createdSecret = "";
  try {
    const response = await stripeRequest("POST", `${STRIPE_ORIGIN}${WEBHOOK_PATH}`, input.env.stripeKey, loaded.apiVersion, fetchImpl, form, idempotency);
    if (response.status < 200 || response.status >= 300) {
      return fail(`Webhook POST returned ${errorCode(response.json, response.status)}.`, "No secret was stored.", { ...accountFields, endpointMatch: "absent", mutations: [`POST ${WEBHOOK_PATH}`] });
    }
    const parsedEndpoint = asEndpoint(response.json);
    const secret = response.json && typeof response.json === "object" ? (response.json as { secret?: unknown }).secret : undefined;
    if (!parsedEndpoint) return fail("Webhook POST returned an unexpected endpoint.", "The response secret was not printed and was not stored.", { ...accountFields, mutations: [`POST ${WEBHOOK_PATH}`] });
    created = parsedEndpoint;
    if (typeof secret !== "string") return fail("Webhook POST did not return a signing secret. Nothing was written to the env file.", "Do not roll an existing endpoint. Inspect this new endpoint in the Dashboard.", { ...accountFields, endpointMatch: "conflict", endpointId: created.id, secret: "unavailable", mutations: [`POST ${WEBHOOK_PATH}`] });
    createdSecret = secret;
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("refused ") ? error.message : "Webhook create failed.";
    return fail(message, "No secret was stored.", { ...accountFields, endpointMatch: "absent" });
  }

  secrets.push(createdSecret);
  const writer = input.writeSecret ?? ((secret: string) => writeEnvSecret(input.env.path, secret));
  let stored: "stored" | "failed" = "failed";
  try {
    stored = writer(createdSecret);
  } catch {
    stored = "failed";
  }
  createdSecret = "";
  if (stored !== "stored") {
    return fail(
      `Endpoint ${created.id} was created, but the signing secret could not be stored and was not printed.`,
      `Delete ${created.id} in the Dashboard and rerun --apply. Do not add a second endpoint beside it.`,
      { ...accountFields, endpointMatch: "conflict", endpointId: created.id, secret: "unavailable", mutations: [`POST ${WEBHOOK_PATH}`] },
    );
  }

  let endpointMatch: EndpointMatch = "conflict";
  let connected = false;
  try {
    const listed = await listEndpoints(input.env.stripeKey, loaded.apiVersion, fetchImpl);
    if (listed.ok) {
      const confirmed = classify(listed.endpoints, loaded.events, loaded.apiVersion);
      endpointMatch = confirmed.match;
      connected = confirmed.match === "exact" && confirmed.id === created.id;
    }
  } catch {
    connected = false;
  }
  return {
    phase: "apply",
    connected,
    ...accountFields,
    endpointMatch,
    endpointId: created.id,
    secret: "stored",
    mutations: [`POST ${WEBHOOK_PATH}`],
    blockedReasons: connected ? [] : ["Readback did not show exactly one matching endpoint."],
    nextAction: connected
      ? "Readback matched. The signing secret is in the private env file and was not printed. A dry-run is not connected."
      : "Do not create another endpoint until the readback is understood.",
  };
}

export function renderReport(report: ConnectReport, asJson: boolean): string {
  if (asJson) return `${JSON.stringify(report, null, 2)}\n`;
  const headline = report.connected ? "CONNECTED" : report.blockedReasons.length ? "BLOCKED" : report.phase === "dry-run" ? "DRY-RUN" : "NOT-CONNECTED";
  return [
    `reservation-connect: ${headline}`,
    `phase: ${report.phase}`,
    `connected: ${report.connected}`,
    `account: ${report.accountId ?? "unread"}`,
    `charges_enabled: ${report.chargesEnabled === null ? "unread" : report.chargesEnabled}`,
    `payouts_enabled: ${report.payoutsEnabled === null ? "unread" : report.payoutsEnabled}`,
    `api_version: ${report.apiVersion ?? "unread"}`,
    `endpoint: ${report.endpointMatch ?? "unread"} ${report.endpointId ?? ""}`.trim(),
    `secret: ${report.secret}`,
    `mutations: ${report.mutations.length ? report.mutations.join(", ") : "none"}`,
    ...report.blockedReasons.map((reason) => `blocked: ${reason}`),
    `next: ${report.nextAction}`,
    "",
  ].join("\n");
}

export type CliOptions = { help: boolean; json: boolean; apply: boolean; envFile: string; repo: string };

export function parseArgs(argv: string[], cwd: string): CliOptions | { error: string } {
  const options: CliOptions = { help: false, json: false, apply: false, envFile: DEFAULT_ENV_FILE, repo: cwd };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--env-file" || arg === "--repo") {
      if (!next || next.startsWith("--")) return { error: `${arg} needs a path.` };
      if (arg === "--env-file") options.envFile = resolve(cwd, next);
      if (arg === "--repo") options.repo = resolve(cwd, next);
      index += 1;
    } else return { error: `Unknown argument ${arg}. There is no charge, refund, mail, or deploy flag.` };
  }
  return options;
}

const HELP = `reservation-connect

Dry-run by default. --apply creates the canonical reservation webhook only
when the live account is ${OFFICIAL_ACCOUNT_ID} and no matching endpoint exists.
It never prints secret values.

  node --experimental-strip-types scripts/reservation-connect.ts [--json] [--apply]
      [--env-file <0600 private file>] [--repo <implementation>]

Exit 0 is a safe dry-run or a root apply whose readback matched.
Exit 2 is blocked. Exit 1 is usage.
`;

export async function main(
  argv: string[],
  io: { cwd?: string; stdout?: (chunk: string) => void; stderr?: (chunk: string) => void; fetchImpl?: typeof fetch; uid?: number } = {},
): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const parsed = parseArgs(argv, cwd);
  const stdout = io.stdout ?? ((chunk: string) => process.stdout.write(chunk));
  const stderr = io.stderr ?? ((chunk: string) => process.stderr.write(chunk));
  if ("error" in parsed) {
    stderr(`${parsed.error}\n${HELP}`);
    return 1;
  }
  if (parsed.help) {
    stdout(HELP);
    return 0;
  }
  const repo = parsed.repo;
  const read = (rel: string) => {
    try {
      return readFileSync(resolve(repo, rel), "utf8");
    } catch {
      return null;
    }
  };
  const report = await connectReservation({
    env: snapshotEnv(parsed.envFile, repo, io.uid ?? (typeof process.getuid === "function" ? process.getuid() : -1)),
    contractText: read("docs/reservation-contract.md"),
    webhookSource: read("src/lib/reservation/webhook.ts"),
    constantsSource: read("src/lib/reservation/constants.ts"),
    apply: parsed.apply,
    fetchImpl: io.fetchImpl,
  });
  stdout(renderReport(report, parsed.json));
  if (report.blockedReasons.length > 0 && !report.connected) return 2;
  return report.phase === "dry-run" || report.connected ? 0 : 2;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (invokedDirectly) process.exitCode = await main(process.argv.slice(2));
