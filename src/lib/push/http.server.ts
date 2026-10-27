import { isLocale } from "../i18n/locale.ts";
import {
  publicPushConfig,
  pushRemovalConfigured,
  PUSH_COPY_VERSION,
  type PushEnvironment,
} from "./config.ts";
import {
  pushId,
  pushReceipt,
  validPushReceipt,
  type PushSubscriptionStore,
  type StoredPushSubscription,
} from "./store.server.ts";
const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export function validatePushSubscription(
  value: unknown,
): { subscription: Omit<StoredPushSubscription, "consentAt"> } | null {
  if (!value || typeof value !== "object") return null;
  const input = asRecord(value);
  const s = asRecord(input.subscription);
  const keys = asRecord(s.keys);
  if (
    input.consent !== true ||
    input.copyVersion !== PUSH_COPY_VERSION ||
    !isLocale(input.locale) ||
    !s ||
    typeof s.endpoint !== "string" ||
    s.endpoint.length > 2048
  )
    return null;
  if (typeof s.endpoint !== "string" || !allowedPushEndpoint(s.endpoint)) return null;
  if (
    typeof keys.p256dh !== "string" ||
    typeof keys.auth !== "string" ||
    !/^B[A-Za-z0-9_-]{86}$/.test(keys.p256dh) ||
    !/^[A-Za-z0-9_-]{22}$/.test(keys.auth)
  )
    return null;
  if (
    s.expirationTime != null &&
    (typeof s.expirationTime !== "number" ||
      !Number.isFinite(s.expirationTime) ||
      s.expirationTime <= Date.now())
  )
    return null;
  return {
    subscription: {
      endpoint: s.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      expirationTime: s.expirationTime ?? null,
      locale: input.locale,
      consentVersion: PUSH_COPY_VERSION,
    },
  };
}
export function allowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    const allowed =
      url.hostname === "fcm.googleapis.com" ||
      url.hostname.endsWith(".push.services.mozilla.com") ||
      url.hostname === "updates.push.services.mozilla.com" ||
      url.hostname === "web.push.apple.com" ||
      url.hostname.endsWith(".notify.windows.com");
    return url.protocol === "https:" && !url.port && !url.username && !url.password && allowed;
  } catch {
    return false;
  }
}
export type PushHandlerDependencies = {
  env: PushEnvironment;
  store: PushSubscriptionStore;
  allowRequest: (request: Request) => boolean;
  now?: () => Date;
  /** Notion readiness is decided by the caller. File mode keeps the sync config gate. */
  enrollmentOpen?: boolean;
  removalOpen?: boolean;
};
export async function handlePushSubscription(
  request: Request,
  dependencies: PushHandlerDependencies,
) {
  const { env, store } = dependencies;
  if (!["POST", "DELETE"].includes(request.method)) return json({ ok: false }, 405);
  const enrollmentOpen = dependencies.enrollmentOpen ?? publicPushConfig(env).enabled;
  const removalOpen = dependencies.removalOpen ?? pushRemovalConfigured(env);
  if (request.method === "POST" ? !enrollmentOpen : !removalOpen)
    return json({ ok: false, code: "unavailable" }, 503);
  if (
    request.headers.get("origin") !== env.WATCHDIVE_PUBLIC_ORIGIN ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return json({ ok: false }, 403);
  if (!dependencies.allowRequest(request)) return json({ ok: false }, 429);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ ok: false }, 415);
  let input: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ ok: false }, 400);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 8192) {
        await reader.cancel();
        return json({ ok: false }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    input = asRecord(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return json({ ok: false }, 400);
  }
  const secret = env.WATCHDIVE_PUSH_RECEIPT_SECRET!;
  try {
    if (request.method === "DELETE") {
      if (
        !input ||
        typeof input.id !== "string" ||
        !validPushReceipt(input.id, input.receipt, secret)
      )
        return json({ ok: false }, 403);
      await store.remove(input.id);
      return json({ ok: true });
    }
    const checked = validatePushSubscription(input);
    if (!checked) return json({ ok: false }, 400);
    const id = pushId(checked.subscription.endpoint, secret);
    await store.put(id, {
      ...checked.subscription,
      consentAt: (dependencies.now?.() ?? new Date()).toISOString(),
    });
    return json({ ok: true, id, receipt: pushReceipt(id, secret) });
  } catch {
    return json({ ok: false, code: "unavailable" }, 503);
  }
}
/** Bounded per-instance protective throttle; production edge rate limiting remains
 * required. Digest network keys; never persist/log addresses or subscription rows. */
export function createPushRateGate(now = Date.now) {
  const buckets = new Map<string, { at: number; count: number }>();
  return (key: string) => {
    const time = now();
    for (const [id, value] of buckets) if (time - value.at > 60_000) buckets.delete(id);
    const previous = buckets.get(key);
    if (!previous && buckets.size >= 1000) return false;
    const bucket = previous ?? { at: time, count: 0 };
    bucket.count++;
    buckets.set(key, bucket);
    return bucket.count <= 5;
  };
}
