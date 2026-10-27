export const PUSH_COPY_VERSION = "wd-push-launch-v1";
export type PushPublicConfig = {
  enabled: boolean;
  publicKey?: string;
  copyVersion?: typeof PUSH_COPY_VERSION;
};
const DATABASE_ID =
  /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type PushEnvironment = {
  VERCEL?: string;
  NOTION_API_KEY?: string;
  NOTION_WAITLIST_DB_ID?: string;
  WATCHDIVE_PUSH_ENABLED?: string;
  WATCHDIVE_PUSH_VAPID_PUBLIC_KEY?: string;
  WATCHDIVE_PUSH_VAPID_PRIVATE_KEY?: string;
  WATCHDIVE_PUSH_VAPID_SUBJECT?: string;
  WATCHDIVE_PUSH_COPY_APPROVED?: string;
  WATCHDIVE_PUSH_STORE?: string;
  WATCHDIVE_PUSH_STORE_DIR?: string;
  WATCHDIVE_PUSH_RECEIPT_SECRET?: string;
  WATCHDIVE_PUSH_ENCRYPTION_SECRET?: string;
  WATCHDIVE_PUSH_NOTION_TOKEN?: string;
  WATCHDIVE_PUSH_NOTION_DB_ID?: string;
  WATCHDIVE_PUSH_SEND_ENABLED?: string;
  WATCHDIVE_PUSH_RETENTION_DAYS?: string;
  WATCHDIVE_PUBLIC_ORIGIN?: string;
};
function sameDatabase(left: string, right: string) {
  return left.replace(/-/g, "").toLowerCase() === right.replace(/-/g, "").toLowerCase();
}
export function pushOriginReady(env: PushEnvironment): boolean {
  try {
    const origin = new URL(env.WATCHDIVE_PUBLIC_ORIGIN ?? "");
    return origin.protocol === "https:" && origin.origin === env.WATCHDIVE_PUBLIC_ORIGIN;
  } catch {
    return false;
  }
}
export function pushStoreKind(env: PushEnvironment): "file" | "notion" | "unconfigured" {
  if (env.WATCHDIVE_PUSH_STORE === "notion") return "notion";
  if (env.WATCHDIVE_PUSH_STORE === "file" || env.WATCHDIVE_PUSH_STORE_DIR?.startsWith("/"))
    return "file";
  return "unconfigured";
}
export function notionPushDatabaseId(env: PushEnvironment): string | null {
  const id = env.WATCHDIVE_PUSH_NOTION_DB_ID?.trim() ?? "";
  if (!DATABASE_ID.test(id)) return null;
  const waitlist = env.NOTION_WAITLIST_DB_ID?.trim() ?? "";
  if (waitlist && sameDatabase(waitlist, id)) return null;
  return id;
}
/** Dedicated integration token. The CRM token is refused so this store cannot read leads. */
export function notionPushToken(env: PushEnvironment): string | null {
  const token = env.WATCHDIVE_PUSH_NOTION_TOKEN?.trim() ?? "";
  if (token.length < 20) return null;
  const crm = env.NOTION_API_KEY?.trim() ?? "";
  if (crm && token === crm) return null;
  return token;
}
export function pushEncryptionSecret(env: PushEnvironment): string | null {
  const secret = env.WATCHDIVE_PUSH_ENCRYPTION_SECRET ?? "";
  if (secret.length < 32 || secret === env.WATCHDIVE_PUSH_RECEIPT_SECRET) return null;
  return secret;
}
export function vapidMaterialReady(env: PushEnvironment): boolean {
  return (
    /^B[A-Za-z0-9_-]{86}$/.test(env.WATCHDIVE_PUSH_VAPID_PUBLIC_KEY ?? "") &&
    /^[A-Za-z0-9_-]{43}$/.test(env.WATCHDIVE_PUSH_VAPID_PRIVATE_KEY ?? "") &&
    /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(env.WATCHDIVE_PUSH_VAPID_SUBJECT ?? "")
  );
}
/** Sync Notion settings. Schema is a separate live check and is not implied here. */
export function notionPushConfigured(env: PushEnvironment): boolean {
  return Boolean(
    pushStoreKind(env) === "notion" &&
    notionPushToken(env) &&
    notionPushDatabaseId(env) &&
    (env.WATCHDIVE_PUSH_RECEIPT_SECRET?.length ?? 0) >= 32 &&
    pushOriginReady(env),
  );
}
export function notionEnrollmentConfigured(env: PushEnvironment): boolean {
  return (
    notionPushConfigured(env) &&
    env.WATCHDIVE_PUSH_ENABLED === "true" &&
    env.WATCHDIVE_PUSH_COPY_APPROVED === PUSH_COPY_VERSION &&
    vapidMaterialReady(env) &&
    Boolean(pushEncryptionSecret(env))
  );
}
export function pushRetentionDays(env: PushEnvironment): number | null {
  const raw = env.WATCHDIVE_PUSH_RETENTION_DAYS ?? "";
  if (!/^[0-9]+$/.test(raw)) return null;
  const days = Number(raw);
  return days >= 7 && days <= 365 ? days : null;
}
export function pushSendGuard(env: PushEnvironment): boolean {
  return env.WATCHDIVE_PUSH_SEND_ENABLED === "true" && notionEnrollmentConfigured(env);
}
export function pushRemovalConfigured(env: PushEnvironment): boolean {
  if (!pushOriginReady(env) || (env.WATCHDIVE_PUSH_RECEIPT_SECRET?.length ?? 0) < 32) return false;
  if (pushStoreKind(env) === "notion") return notionPushConfigured(env);
  // Ephemeral serverless disk cannot prove that a deletion reached durable storage.
  return env.VERCEL !== "1" && Boolean(env.WATCHDIVE_PUSH_STORE_DIR?.startsWith("/"));
}
export function publicPushConfig(env: PushEnvironment): PushPublicConfig {
  const publicKey = env.WATCHDIVE_PUSH_VAPID_PUBLIC_KEY ?? "";
  const privateKey = env.WATCHDIVE_PUSH_VAPID_PRIVATE_KEY ?? "";
  let validOrigin = false;
  try {
    const u = new URL(env.WATCHDIVE_PUBLIC_ORIGIN ?? "");
    validOrigin = u.protocol === "https:" && u.origin === env.WATCHDIVE_PUBLIC_ORIGIN;
  } catch {
    /* disabled */
  }
  const enabled =
    env.VERCEL !== "1" && // File-backed adapter is not durable on serverless Vercel.
    env.WATCHDIVE_PUSH_ENABLED === "true" &&
    env.WATCHDIVE_PUSH_COPY_APPROVED === PUSH_COPY_VERSION &&
    /^B[A-Za-z0-9_-]{86}$/.test(publicKey) &&
    /^[A-Za-z0-9_-]{43}$/.test(privateKey) &&
    /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(env.WATCHDIVE_PUSH_VAPID_SUBJECT ?? "") &&
    Boolean(env.WATCHDIVE_PUSH_STORE_DIR?.startsWith("/")) &&
    (env.WATCHDIVE_PUSH_RECEIPT_SECRET?.length ?? 0) >= 32 &&
    validOrigin;
  return enabled
    ? { enabled: true, publicKey, copyVersion: PUSH_COPY_VERSION }
    : { enabled: false };
}
