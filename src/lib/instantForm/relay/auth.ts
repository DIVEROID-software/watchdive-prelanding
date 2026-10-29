import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { MAX_SKEW_FUTURE_MS, MAX_SKEW_PAST_MS } from "./constants.ts";

const DOMAIN = "watchdive-instant-form-confirmation-v1";
const NONCE = /^[A-Za-z0-9_-]{22,64}$/;
const HEADER = /^v1\.(\d{1,11})\.([A-Za-z0-9_-]{22,64})\.([A-Za-z0-9_-]{43})$/;

export type NonceStore = {
  seen(nonce: string, nowMs: number): boolean;
  remember(nonce: string, expiresAtMs: number, nowMs: number): void;
};

export function memoryNonces(): NonceStore {
  const rows = new Map<string, number>();
  return {
    seen(nonce, nowMs) {
      const expires = rows.get(nonce);
      if (expires == null) return false;
      if (expires <= nowMs) {
        rows.delete(nonce);
        return false;
      }
      return true;
    },
    remember(nonce, expiresAtMs, nowMs) {
      if (rows.size > 5000) {
        for (const [key, until] of rows) if (until <= nowMs) rows.delete(key);
        if (rows.size > 5000) {
          const first = rows.keys().next().value;
          if (first) rows.delete(first);
        }
      }
      rows.set(nonce, expiresAtMs);
    },
  };
}

export function confirmationCanonical(timestampSec: number, nonce: string, rawBody: string): string {
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  return `${DOMAIN}\n${timestampSec}\n${nonce}\n${bodyHash}`;
}

export function signConfirmation(
  secret: string,
  rawBody: string,
  timestampSec: number,
  nonce: string,
): string {
  const mac = createHmac("sha256", secret)
    .update(confirmationCanonical(timestampSec, nonce, rawBody))
    .digest("base64url");
  return `v1.${timestampSec}.${nonce}.${mac}`;
}

function same(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export function secretsAreDistinct(confirmationSecret: string, verificationSecret: string): boolean {
  return !same(confirmationSecret, verificationSecret);
}

export type AuthFailure = "unauthorized" | "replayed" | "stale";

export function authenticateConfirmation(
  header: string | null | undefined,
  rawBody: string,
  secret: string,
  nowMs: number,
  nonces: NonceStore,
): { ok: true } | { ok: false; error: AuthFailure } {
  const match = HEADER.exec(header ?? "");
  if (!match) return { ok: false, error: "unauthorized" };
  const timestampSec = Number(match[1]);
  const nonce = match[2] ?? "";
  const presented = match[3] ?? "";
  if (!Number.isSafeInteger(timestampSec) || !NONCE.test(nonce)) {
    return { ok: false, error: "unauthorized" };
  }
  const atMs = timestampSec * 1000;
  if (atMs < nowMs - MAX_SKEW_PAST_MS || atMs > nowMs + MAX_SKEW_FUTURE_MS) {
    return { ok: false, error: "stale" };
  }
  const expected = createHmac("sha256", secret)
    .update(confirmationCanonical(timestampSec, nonce, rawBody))
    .digest("base64url");
  if (!same(presented, expected)) return { ok: false, error: "unauthorized" };
  if (nonces.seen(nonce, nowMs)) return { ok: false, error: "replayed" };
  try { nonces.remember(nonce, atMs + MAX_SKEW_PAST_MS, nowMs); }
  catch { return { ok: false, error: "replayed" }; }
  return { ok: true };
}
