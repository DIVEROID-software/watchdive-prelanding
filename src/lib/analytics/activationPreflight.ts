// Capability report and a synthetic-namespace ledger probe.
// Prints no secret, posts no GA4 or Meta event, and does not enable a flag.

import { randomBytes } from "node:crypto";
import {
  forbiddenConversionStoreHost,
  LEDGER_EPOCH_KEY,
  LEDGER_SCRIPTS,
  readConversionConfig,
  readDeliveryStoreConfig,
  readLedgerEpoch,
} from "./googleConversions.server.ts";

type Env = Record<string, string | undefined>;

function operatorEnvironment(env: Env): Env {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value?.trim().toUpperCase() === "[SENSITIVE]" ? undefined : value,
    ]),
  );
}

/** Vercel pulls can contain redaction placeholders; they are not credentials. */
export function parseConversionOperatorEnv(text: string): Env {
  const env: Env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[key] = value;
  }
  return operatorEnvironment(env);
}

export type ConversionCapability = {
  flags: {
    ga4ServerEnabled: boolean;
    ga4PublicEnabled: boolean;
    ga4FlagsPaired: boolean;
    metaPurchaseEnabled: boolean;
  };
  ga4: {
    measurementIdShapeValid: boolean;
    apiSecretPresent: boolean;
  };
  store: {
    verificationSecretPresent: boolean;
    verificationSecretMeetsMinimum: boolean;
    redisUrlPresent: boolean;
    redisUrlShapeValid: boolean;
    redisTokenPresent: boolean;
    configured: boolean;
    /** Valid public epoch is present in config. This is not the Redis value. */
    epochPresent: boolean;
  };
  readyToProbe: boolean;
  /** True only when the current env would emit. Both flags still default off. */
  senderWouldEmit: boolean;
  metaSenderWouldEmit: boolean;
};

export type StoreProbe = {
  attempted: boolean;
  namespaceSynthetic: boolean;
  productionPrefixesUsed: boolean;
  claimAtomic: boolean;
  readMatched: boolean;
  expiryFormAccepted: boolean;
  deleted: boolean;
  leftoverCleared: boolean;
  analyticsHostsContacted: false;
  error: null | "not_configured" | "namespace" | "unavailable" | "protocol" | "cleanup";
};

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;
const SYNTHETIC_NAMESPACE = /^wdconv:preflight:[a-f0-9]{16}$/;

function present(env: Env, name: string): boolean {
  return (env[name] ?? "").trim().length > 0;
}

function redisUrlShapeValid(env: Env): boolean {
  const raw = (env.WATCHDIVE_CONVERSION_REDIS_REST_URL ?? "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !forbiddenConversionStoreHost(url.hostname)
    );
  } catch {
    return false;
  }
}

export function conversionCapability(env: Env): ConversionCapability {
  env = operatorEnvironment(env);
  const ga4ServerEnabled = env.WATCHDIVE_GA4_CONVERSIONS_ENABLED === "true";
  const ga4PublicEnabled = env.VITE_GA4_SERVER_CONVERSIONS_ENABLED === "true";
  const metaPurchaseEnabled = env.WATCHDIVE_META_PURCHASE_ENABLED === "true";
  const measurementId = (env.VITE_GA_MEASUREMENT_ID ?? "").trim();
  const verificationSecret = env.WATCHDIVE_VERIFICATION_SECRET ?? "";
  const store = {
    verificationSecretPresent: verificationSecret.trim().length > 0,
    verificationSecretMeetsMinimum: Buffer.byteLength(verificationSecret, "utf8") >= 32,
    redisUrlPresent: present(env, "WATCHDIVE_CONVERSION_REDIS_REST_URL"),
    redisUrlShapeValid: redisUrlShapeValid(env),
    redisTokenPresent: present(env, "WATCHDIVE_CONVERSION_REDIS_REST_TOKEN"),
    configured: readDeliveryStoreConfig(env) !== null,
    epochPresent: readLedgerEpoch(env) !== null,
  };
  const ga4 = {
    measurementIdShapeValid: MEASUREMENT_ID.test(measurementId),
    apiSecretPresent: present(env, "GA4_API_SECRET"),
  };
  const readyToProbe = store.configured;
  return {
    flags: {
      ga4ServerEnabled,
      ga4PublicEnabled,
      ga4FlagsPaired: ga4ServerEnabled === ga4PublicEnabled,
      metaPurchaseEnabled,
    },
    ga4,
    store,
    readyToProbe,
    senderWouldEmit: readConversionConfig(env) !== null,
    metaSenderWouldEmit: metaPurchaseEnabled && store.configured && store.epochPresent,
  };
}

export type LedgerMarker = "unconfigured" | "matched" | "missing" | "mismatched" | "unavailable";

/** One read of the epoch key. Does not SET, DEL, or scan event keys. */
export async function readLedgerMarker(options: {
  env: Env;
  fetchImpl?: typeof fetch;
}): Promise<LedgerMarker> {
  const env = operatorEnvironment(options.env);
  const epoch = readLedgerEpoch(env);
  const config = readDeliveryStoreConfig(env);
  if (!epoch || !config) return "unconfigured";
  try {
    const raw = await redisCommand(config.redisUrl, config.redisToken, options.fetchImpl ?? fetch, [
      "GET",
      LEDGER_EPOCH_KEY,
    ]);
    if (raw === null || raw === undefined) return "missing";
    if (typeof raw !== "string") return "unavailable";
    return raw === epoch ? "matched" : "mismatched";
  } catch {
    return "unavailable";
  }
}

export type LedgerInitResult =
  | "unconfigured"
  | "already"
  | "initialized"
  | "mismatch"
  | "nonempty"
  | "conflict"
  | "unavailable";

/**
 * Operator birth of an empty ledger. One EVAL. Refuses a different marker and
 * any existing event or context key. There is no repair or reset argument.
 */
export async function initializeLedgerEpoch(options: {
  env: Env;
  fetchImpl?: typeof fetch;
}): Promise<{ wrote: boolean; result: LedgerInitResult }> {
  const env = operatorEnvironment(options.env);
  const epoch = readLedgerEpoch(env);
  const config = readDeliveryStoreConfig(env);
  if (!epoch || !config) return { wrote: false, result: "unconfigured" };
  try {
    const result = await redisCommand(
      config.redisUrl,
      config.redisToken,
      options.fetchImpl ?? fetch,
      ["EVAL", LEDGER_SCRIPTS.init, 1, LEDGER_EPOCH_KEY, epoch],
    );
    if (result === "initialized") return { wrote: true, result: "initialized" };
    if (
      result === "already" ||
      result === "mismatch" ||
      result === "nonempty" ||
      result === "conflict"
    ) {
      return { wrote: false, result };
    }
    return { wrote: false, result: "unavailable" };
  } catch {
    return { wrote: false, result: "unavailable" };
  }
}

export function syntheticNamespace(): string {
  return `wdconv:preflight:${randomBytes(8).toString("hex")}`;
}

type Command = (...args: string[]) => Promise<unknown>;

async function redisCommand(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
  args: (string | number)[],
): Promise<unknown> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error("protocol");
  }
  if (target.protocol !== "https:" || forbiddenConversionStoreHost(target.hostname)) {
    throw new Error("protocol");
  }
  const response = await fetchImpl(target, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(2000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("unavailable");
  const body = (await response.json()) as { result?: unknown; error?: unknown };
  if (body.error) throw new Error("unavailable");
  return body.result;
}

/**
 * SET NX / GET / DEL against one synthetic namespace.
 * Keys are `wdconv:preflight:<run>:*`, never `wdconv:event:` or `wdconv:context:`.
 */
export async function probeConversionRest(options: {
  env: Env;
  namespace: string;
  fetchImpl?: typeof fetch;
}): Promise<StoreProbe> {
  const blank: StoreProbe = {
    attempted: false,
    namespaceSynthetic: SYNTHETIC_NAMESPACE.test(options.namespace),
    productionPrefixesUsed: false,
    claimAtomic: false,
    readMatched: false,
    expiryFormAccepted: false,
    deleted: false,
    leftoverCleared: false,
    analyticsHostsContacted: false,
    error: "not_configured",
  };
  if (!blank.namespaceSynthetic) return { ...blank, error: "namespace" };
  const config = readDeliveryStoreConfig(operatorEnvironment(options.env));
  if (!config) return blank;
  const claimKey = `${options.namespace}:claim`;
  const readKey = `${options.namespace}:read`;
  const expiryKey = `${options.namespace}:expiry`;
  const keys = [claimKey, readKey, expiryKey];
  if (keys.some((key) => key.startsWith("wdconv:event:") || key.startsWith("wdconv:context:"))) {
    return { ...blank, productionPrefixesUsed: true, error: "namespace" };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const command: Command = (...args) =>
    redisCommand(config.redisUrl, config.redisToken, fetchImpl, args);
  const report: StoreProbe = {
    ...blank,
    attempted: true,
    error: null,
  };
  try {
    const [first, second] = await Promise.all([
      command("SET", claimKey, "uncertain", "NX"),
      command("SET", claimKey, "uncertain", "NX"),
    ]);
    const wins = [first, second].filter((result) => result === "OK").length;
    report.claimAtomic = wins === 1 && [first, second].some((result) => result === null);
    const readWrite = await command("SET", readKey, "probe");
    const readBack = await command("GET", readKey);
    report.readMatched = readWrite === "OK" && readBack === "probe";
    const expiryWrite = await command("SET", expiryKey, "probe", "EX", "60");
    report.expiryFormAccepted = expiryWrite === "OK";
    const removed = await Promise.all(keys.map((key) => command("DEL", key)));
    report.deleted = removed.every((result) => typeof result === "number");
    const leftovers = await Promise.all(keys.map((key) => command("GET", key)));
    report.leftoverCleared = leftovers.every((result) => result === null);
    if (!report.leftoverCleared) report.error = "cleanup";
    else if (!report.claimAtomic || !report.readMatched || !report.deleted)
      report.error = "protocol";
    return report;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    report.error = reason === "protocol" ? "protocol" : "unavailable";
    await Promise.all(keys.map((key) => command("DEL", key).catch(() => undefined))).catch(
      () => undefined,
    );
    return report;
  }
}
