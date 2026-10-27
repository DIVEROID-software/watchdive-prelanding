import { PUSH_COPY_VERSION, type PushPublicConfig } from "./config.ts";
import type { Locale } from "../i18n/locale.ts";
export const PUSH_RECEIPT_KEY = "wd:push:receipt:v1";
export function canOfferPush(config: PushPublicConfig, supported: boolean) {
  return (
    supported &&
    config.enabled === true &&
    config.copyVersion === PUSH_COPY_VERSION &&
    Boolean(config.publicKey)
  );
}
export function decodeVapidPublicKey(key: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{87}$/.test(key)) throw new Error("Invalid VAPID public key");
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=");
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("Invalid VAPID public key");
  return bytes;
}
export async function savePushSubscription(
  subscription: PushSubscription,
  locale: Locale,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("/api/push/subscription", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      locale,
      consent: true,
      copyVersion: PUSH_COPY_VERSION,
    }),
  });
  if (!response.ok) throw new Error("Push storage unavailable");
  const receipt = await response.json();
  if (!receipt.ok || !/^[a-f0-9]{64}$/.test(receipt.id) || !/^[a-f0-9]{64}$/.test(receipt.receipt))
    throw new Error("Invalid push receipt");
  return { id: receipt.id as string, receipt: receipt.receipt as string };
}
