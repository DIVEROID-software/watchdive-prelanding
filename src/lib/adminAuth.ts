import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "wd_admin";

export function adminSessionToken(secret: string): string {
  return createHmac("sha256", secret).update("watchdive-admin-v1").digest("base64url");
}

export function adminPasswordsMatch(input: string, expected: string): boolean {
  const left = Buffer.from(input);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function adminCookieMatches(cookie: string | undefined, secret: string): boolean {
  if (!cookie || !secret) return false;
  const expected = adminSessionToken(secret);
  const left = Buffer.from(cookie);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
