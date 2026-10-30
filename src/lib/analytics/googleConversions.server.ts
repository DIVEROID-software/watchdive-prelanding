import { createHmac } from "node:crypto";
import { validGoogleClientId } from "./contract.ts";

type Env = Record<string, string | undefined>;
export type Delivery = "disabled" | "skipped" | "duplicate" | "accepted" | "uncertain" | "retry";
export type Context = { clientId?: string; capturedAt: number };
export type ConversionEvent = {
  name: "sign_up" | "purchase" | "refund";
  key: string;
  params: Record<string, unknown>;
};
export interface ConversionStore {
  /** Current ledger epoch, or null when the marker is absent. Never creates it. */
  epoch(): Promise<string | null>;
  context(key: string): Promise<Context | null>;
  capture(key: string, context: Context): Promise<void>;
  forget(key: string): Promise<void>;
  claim(key: string): Promise<boolean>;
  status(key: string): Promise<"accepted" | "uncertain" | null>;
  finish(key: string, status: "accepted" | "uncertain"): Promise<void>;
  release(key: string): Promise<void>;
}
const CONTEXT_SECONDS = 7 * 24 * 60 * 60;
// Claim tombstones have no expiry: replay of an old confirmation must not
// become a fresh signup. Store only an HMAC key and a delivery state.
// A wiped database would accept SET NX again. wdconv:ledger:epoch is the
// generation marker. Runtime reads it and never creates or replaces it.
export const LEDGER_EPOCH_KEY = "wdconv:ledger:epoch";
/** Public label, 16–80 characters. Not a credential. Duplicated in envPreflight.ts. */
export const LEDGER_EPOCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,79}$/;
const BLOCKED_STORE_HOSTS = [
  "google-analytics.com",
  "analytics.google.com",
  "googleadservices.com",
  "googletagmanager.com",
  "facebook.com",
  "facebook.net",
  "stripe.com",
];

/**
 * The marker was missing, pointed at another generation, or could not be read.
 * Checkout already maps any capture throw to HTTP 503 measurement_unavailable
 * and does not call Stripe. That product behavior is unchanged.
 */
export class LedgerEpochRejected extends Error {
  readonly reason: "missing" | "mismatch" | "unavailable";
  constructor(reason: "missing" | "mismatch" | "unavailable") {
    super("conversion_ledger_epoch");
    this.name = "LedgerEpochRejected";
    this.reason = reason;
  }
}

/** The ledger URL must not be an analytics, ads, or payment host. */
export function forbiddenConversionStoreHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return BLOCKED_STORE_HOSTS.some((name) => host === name || host.endsWith(`.${name}`));
}

export function readLedgerEpoch(env: Env): string | null {
  const value = (env.WATCHDIVE_CONVERSION_LEDGER_EPOCH ?? "").trim();
  return LEDGER_EPOCH_PATTERN.test(value) ? value : null;
}

export async function requireStoreEpoch(store: ConversionStore, expected: string): Promise<void> {
  let actual: string | null;
  try {
    actual = await store.epoch();
  } catch (error) {
    if (error instanceof LedgerEpochRejected) throw error;
    throw new LedgerEpochRejected("unavailable");
  }
  if (typeof actual !== "string" || actual.length === 0) throw new LedgerEpochRejected("missing");
  if (actual !== expected) throw new LedgerEpochRejected("mismatch");
}

export function readDeliveryStoreConfig(env: Env) {
  const signingSecret = env.WATCHDIVE_VERIFICATION_SECRET ?? "";
  const redisUrl = (env.WATCHDIVE_CONVERSION_REDIS_REST_URL ?? "").trim();
  const redisToken = env.WATCHDIVE_CONVERSION_REDIS_REST_TOKEN ?? "";
  if (Buffer.byteLength(signingSecret, "utf8") < 32 || !redisToken) return null;
  try {
    const url = new URL(redisUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      forbiddenConversionStoreHost(url.hostname)
    )
      return null;
  } catch {
    return null;
  }
  return { signingSecret, redisUrl: redisUrl.replace(/\/$/, ""), redisToken };
}

export function readConversionConfig(env: Env) {
  // Match the existing CAPI pattern: public build-time settings can be absent
  // from a serverless process.env, but secrets are runtime-only.
  // Both GA4 flags stay paired. A missing epoch disables the sender the same
  // way a missing secret does. A present epoch whose Redis marker is missing
  // or different fails closed later and is not treated as disabled.
  const publicEnv =
    env === process.env ? ((import.meta as unknown as { env?: Env }).env ?? {}) : {};
  if (
    env.WATCHDIVE_GA4_CONVERSIONS_ENABLED !== "true" ||
    (env.VITE_GA4_SERVER_CONVERSIONS_ENABLED ?? publicEnv.VITE_GA4_SERVER_CONVERSIONS_ENABLED) !==
      "true"
  )
    return null;
  const measurementId = (
    env.VITE_GA_MEASUREMENT_ID ??
    publicEnv.VITE_GA_MEASUREMENT_ID ??
    ""
  ).trim();
  const secret = (env.GA4_API_SECRET ?? "").trim();
  const store = readDeliveryStoreConfig(env);
  const ledgerEpoch = readLedgerEpoch(env);
  if (!/^G-[A-Z0-9]{4,20}$/.test(measurementId) || !secret || !store || !ledgerEpoch) return null;
  return { measurementId, secret, ledgerEpoch, ...store };
}

const MP_DROPPED_PARAM_KEYS = new Set(["session_id", "email", "phone", "user_id"]);

/**
 * Advertising export and web audience creation do not require session_id.
 * Session attribution does, and only when the request arrives within 24 hours
 * of the online session start. A verification is often later, so a stored
 * session id is dropped instead of attached after that window.
 * Email, phone, and user_id never belong in these params.
 * engagement_time_msec is kept only when the caller measured elapsed time.
 * A fixed placeholder is not a duration, and this sender does not claim
 * Realtime engagement or session attribution.
 */
export function measurementProtocolParams(params: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (MP_DROPPED_PARAM_KEYS.has(key)) continue;
    next[key] = value;
  }
  return next;
}

// Upstash REST scripting is supported. WATCH is not, and /pipeline is not atomic,
// so a separate GET of the epoch followed by SET NX can observe a wipe in between.
// One EVAL holds Upstash's global script lock and checks the marker in the same
// script as the write. The marker key is never the target of those writes.
// No allow-key-locking flag: the init script scans key names that are not known
// in advance, and that flag rejects dynamic keys.
export const LEDGER_SCRIPTS = {
  claim: `-- wdconv-op:claim
local marker = redis.call("GET", KEYS[1])
if marker ~= ARGV[1] then
  if marker == false then return "missing" end
  return "mismatch"
end
local set = redis.call("SET", KEYS[2], ARGV[2], "NX")
if set == false then return "held" end
return "claimed"`,
  capture: `-- wdconv-op:capture
local marker = redis.call("GET", KEYS[1])
if marker ~= ARGV[1] then
  if marker == false then return "missing" end
  return "mismatch"
end
redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
return "ok"`,
  release: `-- wdconv-op:release
local marker = redis.call("GET", KEYS[1])
if marker ~= ARGV[1] then
  if marker == false then return "missing" end
  return "mismatch"
end
redis.call("DEL", KEYS[2])
return "released"`,
  finish: `-- wdconv-op:finish
local marker = redis.call("GET", KEYS[1])
if marker ~= ARGV[1] then
  if marker == false then return "missing" end
  return "mismatch"
end
local current = redis.call("GET", KEYS[2])
if current ~= "uncertain" and current ~= "accepted" then return "absent" end
redis.call("SET", KEYS[2], ARGV[2])
return "ok"`,
  init: `-- wdconv-op:init
local marker = redis.call("GET", KEYS[1])
if marker == ARGV[1] then return "already" end
if marker ~= false then return "mismatch" end
local function occupied(pattern)
  local cursor = "0"
  repeat
    local batch = redis.call("SCAN", cursor, "MATCH", pattern, "COUNT", "200")
    cursor = tostring(batch[1])
    if batch[2] ~= nil and #batch[2] > 0 then return true end
  until cursor == "0"
  return false
end
if occupied("wdconv:event:*") or occupied("wdconv:context:*") then return "nonempty" end
local set = redis.call("SET", KEYS[1], ARGV[1], "NX")
if set == false then
  local again = redis.call("GET", KEYS[1])
  if again == ARGV[1] then return "already" end
  if again ~= false then return "mismatch" end
  return "conflict"
end
return "initialized"`,
} as const;

function markerRejection(result: unknown): LedgerEpochRejected | null {
  if (result === "missing" || result === "mismatch") return new LedgerEpochRejected(result);
  return null;
}

// Redis-compatible REST transport. SET NX is atomic across concurrent webhook
// requests and serverless instances. Nothing is provisioned by this module.
export function redisConversionStore(
  url: string,
  token: string,
  fetchImpl = fetch,
  epoch = "",
): ConversionStore {
  const boundEpoch = readLedgerEpoch({ WATCHDIVE_CONVERSION_LEDGER_EPOCH: epoch });
  const command = async (...args: (string | number)[]): Promise<unknown> => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("conversion_store_unavailable");
    const body = (await response.json()) as { result?: unknown; error?: unknown };
    if (body.error) throw new Error("conversion_store_unavailable");
    return body.result;
  };
  const guarded = async (
    script: string,
    keys: string[],
    args: string[],
  ): Promise<unknown> => {
    if (!boundEpoch) throw new LedgerEpochRejected("missing");
    return command("EVAL", script, keys.length, ...keys, ...args);
  };
  return {
    async epoch() {
      if (!boundEpoch) throw new LedgerEpochRejected("missing");
      const raw = await command("GET", LEDGER_EPOCH_KEY);
      return typeof raw === "string" && raw.length > 0 ? raw : null;
    },
    async context(key) {
      const raw = await command("GET", `wdconv:context:${key}`);
      if (typeof raw !== "string") return null;
      const value = JSON.parse(raw) as Context;
      return (value.clientId === undefined || validGoogleClientId(value.clientId)) &&
        Number.isFinite(value.capturedAt)
        ? value
        : null;
    },
    async capture(key, context) {
      const result = await guarded(
        LEDGER_SCRIPTS.capture,
        [LEDGER_EPOCH_KEY, `wdconv:context:${key}`],
        [boundEpoch ?? "", JSON.stringify(context), String(CONTEXT_SECONDS)],
      );
      const rejected = markerRejection(result);
      if (rejected) throw rejected;
      if (result !== "ok") throw new Error("conversion_store_unavailable");
    },
    async forget(key) {
      // Withdrawal deletes the context even when the epoch is missing.
      // Event tombstones are not deleted here.
      await command("DEL", `wdconv:context:${key}`);
    },
    async claim(key) {
      const result = await guarded(
        LEDGER_SCRIPTS.claim,
        [LEDGER_EPOCH_KEY, `wdconv:event:${key}`],
        [boundEpoch ?? "", "uncertain"],
      );
      if (result === "claimed") return true;
      if (result === "held") return false;
      const rejected = markerRejection(result);
      if (rejected) throw rejected;
      throw new Error("conversion_store_unavailable");
    },
    async status(key) {
      const status = await command("GET", `wdconv:event:${key}`);
      return status === "accepted" || status === "uncertain" ? status : null;
    },
    async finish(key, state) {
      const result = await guarded(
        LEDGER_SCRIPTS.finish,
        [LEDGER_EPOCH_KEY, `wdconv:event:${key}`],
        [boundEpoch ?? "", state],
      );
      const rejected = markerRejection(result);
      if (rejected) throw rejected;
      if (result !== "ok") throw new Error("conversion_store_unavailable");
    },
    async release(key) {
      const result = await guarded(
        LEDGER_SCRIPTS.release,
        [LEDGER_EPOCH_KEY, `wdconv:event:${key}`],
        [boundEpoch ?? ""],
      );
      const rejected = markerRejection(result);
      if (rejected) throw rejected;
      if (result !== "released") throw new Error("conversion_store_unavailable");
    },
  };
}

export function createGoogleConversions(
  options: {
    env?: Env;
    fetchImpl?: typeof fetch;
    store?: ConversionStore;
    now?: () => number;
  } = {},
) {
  const config = readConversionConfig(options.env ?? process.env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const store = config
    ? (options.store ??
      redisConversionStore(config.redisUrl, config.redisToken, fetchImpl, config.ledgerEpoch))
    : null;
  const now = options.now ?? Date.now;
  const key = (kind: string, value: string) =>
    createHmac("sha256", config!.signingSecret)
      .update(`ga4:v1:${config!.measurementId}:${kind}:${value}`)
      .digest("hex");
  // Called only for an actual signup row or authenticated checkout identity.
  const subject = (email: string) => key("subject", email.trim().toLowerCase());
  return {
    enabled: Boolean(config),
    async capture(
      email: string,
      clientId: unknown,
      allowed: boolean,
      options?: { keepExisting?: boolean },
    ): Promise<void> {
      if (!store || !config) return;
      if (!allowed || !validGoogleClientId(clientId)) {
        await store.forget(subject(email));
        return;
      }
      // A bad epoch must throw. Reservation checkout turns that into HTTP 503
      // before Stripe. A disabled sender (no epoch configured) returns above
      // and does not make checkout wait on Redis.
      await requireStoreEpoch(store, config.ledgerEpoch);
      // A confirmation opened on another device must not replace the client id
      // captured with the landing visit. That id is the one in the visitor audience.
      if (options?.keepExisting) {
        const existing = await store.context(subject(email));
        if (
          existing &&
          validGoogleClientId(existing.clientId) &&
          now() >= existing.capturedAt &&
          now() - existing.capturedAt <= CONTEXT_SECONDS * 1000
        ) {
          return;
        }
      }
      await store.capture(subject(email), { clientId, capturedAt: now() });
    },
    async forget(email: string): Promise<void> {
      if (store) await store.forget(subject(email));
    },
    /** Ledger state for one event key. Null when this sender is off or no claim exists. */
    async recorded(
      name: ConversionEvent["name"],
      eventKey: string,
    ): Promise<"accepted" | "uncertain" | null> {
      if (!store || !config) return null;
      return store.status(key(name, eventKey));
    },
    async send(
      email: string,
      event: ConversionEvent,
      allowed: () => Promise<boolean>,
    ): Promise<Delivery> {
      if (!store || !config) return "disabled";
      let eventKey: string | undefined;
      let posted = false;
      let claimed = false;
      let claimAttempted = false;
      try {
        if (!(await allowed())) {
          await store.forget(subject(email));
          return "skipped";
        }
        await requireStoreEpoch(store, config.ledgerEpoch);
        const context = await store.context(subject(email));
        if (
          !context ||
          !validGoogleClientId(context.clientId) ||
          now() < context.capturedAt ||
          now() - context.capturedAt > CONTEXT_SECONDS * 1000
        )
          return "skipped";
        eventKey = key(event.name, event.key);
        claimAttempted = true;
        let claimedNow = false;
        try {
          claimedNow = await store.claim(eventKey);
        } catch (error) {
          // A definite epoch rejection wrote nothing. A transport error may have.
          if (error instanceof LedgerEpochRejected) claimAttempted = false;
          throw error;
        }
        if (!claimedNow)
          return (await store.status(eventKey)) === "accepted" ? "duplicate" : "uncertain";
        claimed = true;
        // A refusal that landed during context/claim reads wins. No browser
        // session or original tab is required at this point.
        if (!(await allowed())) {
          await store.forget(subject(email));
          await store.release(eventKey);
          return "skipped";
        }
        const current = await store.context(subject(email));
        if (!current || current.clientId !== context.clientId) {
          await store.release(eventKey);
          return "skipped";
        }
        // Last ledger read before the network send. A marker that vanished
        // after the claim must not post. The tombstone stays: releasing it
        // would let a later init accept the same event.
        await requireStoreEpoch(store, config.ledgerEpoch);
        const endpoint = new URL("https://www.google-analytics.com/mp/collect");
        endpoint.searchParams.set("measurement_id", config.measurementId);
        endpoint.searchParams.set("api_secret", config.secret);
        posted = true;
        const response = await fetchImpl(endpoint, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(3000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: context.clientId,
            consent: { ad_user_data: "GRANTED", ad_personalization: "GRANTED" },
            events: [{ name: event.name, params: measurementProtocolParams(event.params) }],
          }),
        });
        // MP HTTP success is transport acceptance, not proof it appeared in GA.
        const status = response.ok ? "accepted" : "uncertain";
        await store.finish(eventKey, status);
        return status;
      } catch (error) {
        if (error instanceof LedgerEpochRejected) return claimed ? "uncertain" : "retry";
        // Never blindly retry an ambiguous GA response. The claim was written
        // BEFORE dispatch and survives a crash. An operator must reconcile it.
        // Before dispatch, a failed store/consent read is safe to retry.
        if (!posted && claimed && eventKey) await store.release(eventKey).catch(() => {});
        return posted || (claimAttempted && !claimed) ? "uncertain" : "retry";
      }
    },
  };
}
