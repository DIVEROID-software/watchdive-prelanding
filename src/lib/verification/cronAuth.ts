// Gate for scheduled endpoints that send mail.
//
// Vercel Cron calls the path with `Authorization: Bearer <CRON_SECRET>` when
// the project has a `CRON_SECRET` environment variable. Without that variable
// the endpoint refuses everything: an unprotected path that mails every
// pending signup is a mail cannon anyone could fire.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { createHash, timingSafeEqual } from "node:crypto";

/** A shorter secret is treated as not configured. */
export const CRON_SECRET_MIN_LENGTH = 16;

export type CronAuthResult = "authorized" | "unauthorized" | "not_configured";

export function checkCronAuthorization(
  authorizationHeader: string | null | undefined,
  secret: string | undefined,
): CronAuthResult {
  const expected = (secret ?? "").trim();
  if (expected.length < CRON_SECRET_MIN_LENGTH) return "not_configured";
  const presented = authorizationHeader ?? "";
  // Compared as fixed-length digests so neither the length nor the content of
  // the secret leaks through timing.
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(`Bearer ${expected}`).digest();
  return timingSafeEqual(a, b) ? "authorized" : "unauthorized";
}
