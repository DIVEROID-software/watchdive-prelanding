// When this browser already holds a verified social continuation, open the
// existing onsite reservation path. That credential is stronger than typing
// an email, and it does not send mail. A fresh ad browser has no grant and
// falls through to the email form.
import type { Locale } from "../../lib/i18n/locale.ts";

export type ResumeCredential = { kind: "confirmation"; value: string };

export async function resumeVerifiedReservation(input: {
  locale: Locale;
  exchange: () => Promise<unknown>;
  openReservation: (
    credential: ResumeCredential,
    locale: Locale,
  ) => Promise<{ status?: unknown; href?: unknown }>;
}): Promise<string | null> {
  let payload: unknown;
  try {
    payload = await input.exchange();
  } catch {
    return null;
  }
  const credential = readContinuationCredential(payload);
  if (!credential) return null;
  let result: { status?: unknown; href?: unknown };
  try {
    result = await input.openReservation(credential, input.locale);
  } catch {
    return null;
  }
  if (result.status !== "ready") return null;
  return safeReservationHref(result.href);
}

export function readContinuationCredential(body: unknown): ResumeCredential | null {
  if (!body || typeof body !== "object") return null;
  const row = body as { status?: unknown; credential?: { kind?: unknown; value?: unknown } };
  const value = row.credential?.value;
  if (row.status !== "ready" || row.credential?.kind !== "confirmation" || typeof value !== "string") {
    return null;
  }
  if (value.length < 20 || value.length > 2000 || /[\s@]/.test(value)) return null;
  return { kind: "confirmation", value };
}

/** Same-origin relative reservation link with the invite only in the fragment. */
export function safeReservationHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 20 || value.length > 5000) return null;
  if (!value.startsWith("/reservation?") || value.includes("://") || value.includes("\\") || value.includes("@")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value, "https://watchdive.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://watchdive.invalid" || url.pathname !== "/reservation") return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "lang") return null;
  if (url.searchParams.has("invite") || url.searchParams.has("inviteToken") || url.searchParams.has("token")) {
    return null;
  }
  if (!url.hash.startsWith("#invite=")) return null;
  const token = decodeURIComponent(url.hash.slice("#invite=".length));
  if (token.length < 20 || token.includes("@") || url.search.includes(token)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
