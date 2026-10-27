import { storedSignupHandles } from "../../lib/signupHandles.ts";
export const DEVICE_SIGNUP_KEY = "wd:acquisition-device-state:v1";
export const DEVICE_SIGNUP_EVENT = "wd:acquisition-device-state";
export type DeviceSignupStatus = "pending" | "verified" | "social" | "paid";
type Store = Pick<Storage, "getItem" | "setItem">;
let memory: DeviceSignupStatus | null = null;
function storage(): Store | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}
/** Functional device-only suppression, never authentication, verification or analytics.
 * Contains no email, model, token or payment identifiers. */
export function markDeviceSignupStatus(
  status: DeviceSignupStatus,
  store = storage(),
  now = Date.now(),
) {
  if (!["pending", "verified", "social", "paid"].includes(status)) return;
  if (memory !== "paid") memory = status;
  try {
    const prior = JSON.parse(store?.getItem(DEVICE_SIGNUP_KEY) ?? "null");
    const next = prior?.status === "paid" ? "paid" : memory;
    store?.setItem(DEVICE_SIGNUP_KEY, JSON.stringify({ status: next, at: now }));
  } catch {
    /* in-page state still suppresses */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DEVICE_SIGNUP_EVENT));
}
export function readDeviceSignupStatus(
  store = storage(),
  now = Date.now(),
): { signedUp: boolean; paid: boolean } {
  let status = memory;
  try {
    const entry = JSON.parse(store?.getItem(DEVICE_SIGNUP_KEY) ?? "null");
    if (
      ["pending", "verified", "social", "paid"].includes(entry?.status) &&
      Number.isFinite(entry.at) &&
      entry.at <= now &&
      now - entry.at < 365 * 86400_000
    )
      status = entry.status;
  } catch {
    /* no identity inferred */
  }
  return {
    signedUp: Boolean(status || storedSignupHandles(store, now).length),
    paid: status === "paid",
  };
}
