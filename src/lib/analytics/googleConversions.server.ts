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
const BLOCKED_STORE_HOSTS = [
  "google-analytics.com",
  "analytics.google.com",
  "googleadservices.com",
  "googletagmanager.com",
  "facebook.com",
  "facebook.net",
  "stripe.com",
];

/** The ledger URL must not be an analytics, ads, or payment host. */
export function forbiddenConversionStoreHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return BLOCKED_STORE_HOSTS.some((name) => host === name || host.endsWith(`.${name}`));
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
  if (!/^G-[A-Z0-9]{4,20}$/.test(measurementId) || !secret || !store) return null;
  return { measurementId, secret, ...store };
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

// Redis-compatible REST transport. SET NX is atomic across concurrent webhook
// requests and serverless instances. Nothing is provisioned by this module.
export function redisConversionStore(
  url: string,
  token: string,
  fetchImpl = fetch,
): ConversionStore {
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
  return {
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
      await command("SET", `wdconv:context:${key}`, JSON.stringify(context), "EX", CONTEXT_SECONDS);
    },
    async forget(key) {
      await command("DEL", `wdconv:context:${key}`);
    },
    async claim(key) {
      return (await command("SET", `wdconv:event:${key}`, "uncertain", "NX")) === "OK";
    },
    async status(key) {
      const status = await command("GET", `wdconv:event:${key}`);
      return status === "accepted" || status === "uncertain" ? status : null;
    },
    async finish(key, state) {
      await command("SET", `wdconv:event:${key}`, state);
    },
    async release(key) {
      await command("DEL", `wdconv:event:${key}`);
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
    ? (options.store ?? redisConversionStore(config.redisUrl, config.redisToken, fetchImpl))
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
      if (!store) return;
      if (!allowed || !validGoogleClientId(clientId)) {
        await store.forget(subject(email));
        return;
      }
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
        if (!(await store.claim(eventKey)))
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
      } catch {
        // Never blindly retry an ambiguous GA response. The claim was written
        // BEFORE dispatch and survives a crash. An operator must reconcile it.
        // Before dispatch, a failed store/consent read is safe to retry.
        if (!posted && claimed && eventKey) await store.release(eventKey).catch(() => {});
        return posted || (claimAttempted && !claimed) ? "uncertain" : "retry";
      }
    },
  };
}
