import {
  PUSH_COPY_VERSION,
  notionEnrollmentConfigured,
  notionPushDatabaseId,
  notionPushToken,
  publicPushConfig,
  pushRemovalConfigured,
  pushSendGuard,
  pushStoreKind,
  type PushEnvironment,
  type PushPublicConfig,
} from "./config.ts";
import { createPushNotionRequest } from "./notion.server.ts";
import { pushSchemaReady } from "./schema.ts";

export type PushReadiness = {
  store: "file" | "notion" | "unconfigured";
  enrollmentConfigured: boolean;
  schemaReady: boolean;
  removalConfigured: boolean;
  sendGuard: boolean;
};

async function notionSchemaReady(env: PushEnvironment, fetchImpl: typeof fetch): Promise<boolean> {
  const token = notionPushToken(env);
  const databaseId = notionPushDatabaseId(env);
  if (!token || !databaseId) return false;
  try {
    const schema = await createPushNotionRequest(fetchImpl, token)(
      "GET",
      `databases/${encodeURIComponent(databaseId)}`,
    );
    return pushSchemaReady(schema);
  } catch {
    return false;
  }
}

export async function inspectPushReadiness(
  env: PushEnvironment,
  fetchImpl: typeof fetch,
): Promise<PushReadiness> {
  const store = pushStoreKind(env);
  const schemaReady = store === "notion" ? await notionSchemaReady(env, fetchImpl) : false;
  return {
    store,
    enrollmentConfigured:
      store === "notion" ? notionEnrollmentConfigured(env) : publicPushConfig(env).enabled,
    schemaReady,
    removalConfigured: pushRemovalConfigured(env),
    sendGuard: pushSendGuard(env),
  };
}

/** Public opt-in shape. Notion mode stays disabled until the live schema matches. */
export async function readPushPublicConfig(
  env: PushEnvironment,
  fetchImpl: typeof fetch,
): Promise<PushPublicConfig> {
  if (pushStoreKind(env) !== "notion") return publicPushConfig(env);
  const readiness = await inspectPushReadiness(env, fetchImpl);
  if (!readiness.enrollmentConfigured || !readiness.schemaReady) return { enabled: false };
  return {
    enabled: true,
    publicKey: env.WATCHDIVE_PUSH_VAPID_PUBLIC_KEY,
    copyVersion: PUSH_COPY_VERSION,
  };
}
