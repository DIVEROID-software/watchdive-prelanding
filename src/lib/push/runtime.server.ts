import {
  notionPushDatabaseId,
  notionPushToken,
  pushEncryptionSecret,
  pushRemovalConfigured,
  pushStoreKind,
  type PushEnvironment,
} from "./config.ts";
import { handlePushSubscription } from "./http.server.ts";
import {
  createNotionPushStore,
  createPushNotionRequest,
  type PushDirectory,
} from "./notion.server.ts";
import { readPushPublicConfig } from "./readiness.server.ts";
import { filePushSubscriptionStore, type PushSubscriptionStore } from "./store.server.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export function openPushDirectory(
  env: PushEnvironment,
  fetchImpl: typeof fetch,
  now?: () => Date,
): PushDirectory {
  const token = notionPushToken(env);
  const databaseId = notionPushDatabaseId(env);
  const encryptionSecret = pushEncryptionSecret(env);
  if (pushStoreKind(env) !== "notion" || !token || !databaseId || !encryptionSecret) {
    throw new Error("push_directory_unconfigured");
  }
  return createNotionPushStore({
    request: createPushNotionRequest(fetchImpl, token),
    databaseId,
    encryptionSecret,
    now,
  });
}

export function openPushSubscriptionStore(
  env: PushEnvironment,
  purpose: "enroll" | "remove",
  fetchImpl: typeof fetch,
  now?: () => Date,
): PushSubscriptionStore {
  if (pushStoreKind(env) === "notion") {
    const token = notionPushToken(env);
    const databaseId = notionPushDatabaseId(env);
    const encryptionSecret = pushEncryptionSecret(env) ?? "";
    if (!token || !databaseId) throw new Error("push_directory_unconfigured");
    if (purpose === "enroll" && !pushEncryptionSecret(env))
      throw new Error("push_encryption_secret");
    return createNotionPushStore({
      request: createPushNotionRequest(fetchImpl, token),
      databaseId,
      encryptionSecret,
      now,
    });
  }
  if (env.VERCEL !== "1" && env.WATCHDIVE_PUSH_STORE_DIR?.startsWith("/")) {
    return filePushSubscriptionStore(env.WATCHDIVE_PUSH_STORE_DIR);
  }
  throw new Error("push_store_unconfigured");
}

export async function handlePushRoute(
  request: Request,
  env: PushEnvironment,
  io: { fetchImpl: typeof fetch; allowRequest: (request: Request) => boolean; now?: () => Date },
): Promise<Response> {
  if (request.method !== "POST" && request.method !== "DELETE") return json({ ok: false }, 405);
  const removalOpen = pushRemovalConfigured(env);
  const enrollmentOpen =
    request.method === "POST" ? (await readPushPublicConfig(env, io.fetchImpl)).enabled : false;
  if (request.method === "POST" ? !enrollmentOpen : !removalOpen) {
    return json({ ok: false, code: "unavailable" }, 503);
  }
  let store: PushSubscriptionStore;
  try {
    store = openPushSubscriptionStore(
      env,
      request.method === "DELETE" ? "remove" : "enroll",
      io.fetchImpl,
      io.now,
    );
  } catch {
    return json({ ok: false, code: "unavailable" }, 503);
  }
  return handlePushSubscription(request, {
    env,
    store,
    allowRequest: io.allowRequest,
    enrollmentOpen,
    removalOpen,
    now: io.now,
  });
}
