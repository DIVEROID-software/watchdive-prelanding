import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import type { Locale } from "../i18n/locale.ts";
export type StoredPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime: number | null;
  locale: Locale;
  consentVersion: string;
  consentAt: string;
};
/** No customer email, lead ID or verified status is accepted or stored. */
export interface PushSubscriptionStore {
  put(id: string, subscription: StoredPushSubscription): Promise<void>;
  remove(id: string): Promise<void>;
}
/** Operator must mount a persistent encrypted volume; do not point at an ephemeral
 * serverless filesystem. No directory/file is created until an explicit request. */
export function filePushSubscriptionStore(directory: string): PushSubscriptionStore {
  if (!isAbsolute(directory)) throw new Error("Push store must be an absolute durable directory");
  const path = (id: string) => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid push key");
    return join(directory, `${id}.json`);
  };
  return {
    async put(id, subscription) {
      const target = path(id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temp = `${target}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(subscription), { mode: 0o600, flag: "wx" });
        await rename(temp, target);
      } finally {
        await unlink(temp).catch(() => undefined);
      }
    },
    async remove(id) {
      await unlink(path(id)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
  };
}
export function pushId(endpoint: string, secret: string) {
  return createHmac("sha256", secret).update(`push-id:${endpoint}`).digest("hex");
}
export function pushReceipt(id: string, secret: string) {
  return createHmac("sha256", secret).update(`push-remove:${id}`).digest("hex");
}
export function validPushReceipt(id: string, receipt: unknown, secret: string) {
  if (!/^[a-f0-9]{64}$/.test(id) || typeof receipt !== "string" || !/^[a-f0-9]{64}$/.test(receipt))
    return false;
  return timingSafeEqual(Buffer.from(receipt, "hex"), Buffer.from(pushReceipt(id, secret), "hex"));
}
