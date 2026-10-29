export const ENTRY_DISMISSED_KEY = "wd:entry-capture-dismissed:v1";
export const ENTRY_DISMISS_MS = 7 * 86400_000;

/** Device-only display preference. This never proves signup or consent. */
export function entryDismissed(value: string | null, now = Date.now()): boolean {
  if (!value) return false;
  const at = Number(value);
  return Number.isFinite(at) && at > 0 && at <= now && now - at < ENTRY_DISMISS_MS;
}

export function entryReturnFlow(search: string, hash: string): boolean {
  const params = new URLSearchParams(search);
  return ["auth", "token", "attempt", "session_id", "reservation", "unsubscribe"].some(key => params.has(key)) ||
    /signup|verify|reserve|offer-form/.test(hash);
}
