// The poll handles this browser's signups were given, kept so that a refusal
// given later — after a reload, after "Wrong address?", from the footer's
// Cookie settings — still reaches the signup row on the server. Without that,
// the refusal lives only in this browser, and a confirmation opened in a mail
// app would still send conversions.
//
// A handle names an attempt, never a readable person (the address inside is
// sealed with a server key). Decoys are kept too: on the server they resolve
// to the same row, and keeping every kind keeps this list from saying which
// addresses were new. Expired handles are dropped; the list is capped.
//
// Kept free of path-alias imports and the DOM-only APIs beyond storage, so
// `npm test` can load it.

export const SIGNUP_HANDLES_KEY = "watchdive.signup-handles.v1";
const MAX_HANDLES = 10;
// Matches the server's WITHDRAW_HANDLE_TTL_MS: as long as a reminder link for
// the signup can still confirm it (7 days + 24 hours + 1 hour).
export const SIGNUP_HANDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000 + 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function issuedAt(handle: string): number {
  const value = Number(handle.split(".")[1]);
  return Number.isSafeInteger(value) ? value : Number.NaN;
}

function live(handles: unknown, nowMs: number): string[] {
  if (!Array.isArray(handles)) return [];
  return handles.filter(
    (handle): handle is string =>
      typeof handle === "string" &&
      handle.length >= 16 &&
      handle.length <= 900 &&
      nowMs - issuedAt(handle) <= SIGNUP_HANDLE_TTL_MS,
  );
}

export function storedSignupHandles(
  storage: StorageLike | undefined = defaultStorage(),
  nowMs = Date.now(),
): string[] {
  if (!storage) return [];
  try {
    return live(JSON.parse(storage.getItem(SIGNUP_HANDLES_KEY) ?? "[]"), nowMs);
  } catch {
    return [];
  }
}

export function rememberSignupHandle(
  handle: string,
  storage: StorageLike | undefined = defaultStorage(),
  nowMs = Date.now(),
): void {
  if (!storage || !handle || live([handle], nowMs).length === 0) return;
  const next = [handle, ...storedSignupHandles(storage, nowMs).filter((h) => h !== handle)];
  try {
    storage.setItem(SIGNUP_HANDLES_KEY, JSON.stringify(next.slice(0, MAX_HANDLES)));
  } catch {
    // Storage can be unavailable; the in-page handle still covers this tab.
  }
}
