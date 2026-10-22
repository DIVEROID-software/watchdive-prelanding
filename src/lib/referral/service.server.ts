// Buddy Invite server services: the private status page, its settings form,
// the public top-N leaderboard and the landing card's progress count.
//
// Everything this file needs from the core modules (ledger, token, nickname,
// store) arrives through `ReferralServiceDeps`, so these rules can be tested
// against fakes and the server-fn wrapper wires the real implementations. Only
// `program.ts` (numbers), `contract.ts` (types) and the pure ref-code rule
// `normalizeRefCode` (eligibility.ts) are imported directly.
//
// Privacy: every response is rebuilt field by field from an allow-list. Rows
// carry emails, canonical emails and Notion page ids, and the ledger carries
// every other referrer's code; none of that may be spread into a response,
// even if a core module later adds a field to what it returns.

import type { Locale } from "../i18n/locale.ts";
import type {
  LeaderboardSnapshot,
  LedgerResult,
  NicknameCheck,
  ReferralRow,
  ReferralSettingsInput,
  ReferralStatus,
  ReferralStore,
} from "./contract.ts";
import { normalizeRefCode } from "./eligibility.ts";
import { LEADERBOARD_CACHE_SECONDS, LEADERBOARD_SIZE } from "./program.ts";
import {
  canonicalShareCode,
  checkShareCode,
  claimDecision,
  generateShareCode,
  type ShareCodeRejectReason,
} from "./shareCode.ts";

/** The core functions this service composes (signatures from the shared brief). */
export type ReferralServiceDeps = {
  /**
   * `referralProgramEnabled(env)`. Checked first by every service: while the
   * owner has not switched the program on, nothing reads or writes Notion and
   * every surface answers as if the program did not exist.
   */
  enabled: () => boolean;
  store: ReferralStore;
  /** Status-link signing secret (`referralSecret(env)`). */
  secret: string;
  /** Public https origin used to build the owner's share link. */
  origin: string;
  now: () => Date;
  /** `referralClosesAt()`; null while the close time is not announced. */
  closesAt: () => Date | null;
  verifyStatusToken: (token: string, secret: string) => string | null | Promise<string | null>;
  computeLedger: (rows: ReferralRow[], options: { closesAt: Date | null }) => LedgerResult;
  statusFor: (
    row: ReferralRow,
    ledger: LedgerResult,
    options: { shareUrl: string; closed: boolean },
  ) => ReferralStatus;
  buildLeaderboard: (
    rows: ReferralRow[],
    ledger: LedgerResult,
    options: { size: number; now: Date; closed: boolean },
  ) => LeaderboardSnapshot;
  checkNickname: (raw: string) => NicknameCheck;
  shareUrl: (origin: string, refCode: string) => string;
  /** Process-wide state, created once by the wrapper (fresh per test). */
  leaderboardCache: LeaderboardCache;
  settingsLimiter: RateLimiter;
};

export type ReferralStatusResponse =
  { status: "ok"; referral: ReferralStatus } | { status: "invalid" } | { status: "disabled" };

export type NicknameErrorReason = Extract<NicknameCheck, { ok: false }>["reason"];

export type ReferralSettingsResponse =
  | {
      status: "ok";
      settings: { nickname: string | null; leaderboard: boolean; noticesOff: boolean };
    }
  | { status: "invalid" }
  | { status: "rejected"; reason: NicknameErrorReason }
  | { status: "rate_limited" }
  | { status: "disabled" };

export type ReferralProgressResponse = { enabled: false } | { enabled: true; credited: number };

const INVALID = Object.freeze({ status: "invalid" as const });
const DISABLED = Object.freeze({ status: "disabled" as const });

// Generous for a person editing their own nickname, far below anything that
// could exhaust the Notion integration's rate limit (3 requests/s).
export const SETTINGS_WRITES_PER_WINDOW = 10;
export const SETTINGS_WINDOW_MS = 60_000;

// Token shape gate before any HMAC work: anything far outside the shape of a
// signed status token is rejected the same way a bad signature is.
const TOKEN_MAX = 400;

function isClosed(deps: Pick<ReferralServiceDeps, "now" | "closesAt">, now = deps.now()): boolean {
  const at = deps.closesAt();
  return at !== null && now.getTime() >= at.getTime();
}

async function refCodeFor(token: unknown, deps: ReferralServiceDeps): Promise<string | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > TOKEN_MAX) return null;
  try {
    // The signed code goes through the same rule as every other lookup.
    return normalizeRefCode(await deps.verifyStatusToken(token, deps.secret)) || null;
  } catch {
    // A malformed token must look exactly like a forged one.
    return null;
  }
}

/** Owner-only status: the allow-listed copy of what statusFor computed. */
function publicStatus(status: ReferralStatus): ReferralStatus {
  return {
    credited: status.credited,
    highestTier: status.highestTier,
    nextTier: status.nextTier,
    remainingToNext: status.remainingToNext,
    earlyNoticeHours: status.earlyNoticeHours,
    lightEligible: status.lightEligible,
    rank: status.rank,
    nickname: status.nickname,
    leaderboard: status.leaderboard,
    nicknameHidden: status.nicknameHidden,
    noticesOff: status.noticesOff,
    shareUrl: status.shareUrl,
    closed: status.closed,
    shareCode: status.shareCode ?? null,
    shareCodeCustom: status.shareCodeCustom === true,
    shareCodeLocked: status.shareCodeLocked === true,
  };
}

function publicSnapshot(snapshot: LeaderboardSnapshot): LeaderboardSnapshot {
  return {
    entries: snapshot.entries.map((entry) => ({
      rank: entry.rank,
      nickname: entry.nickname,
      credited: entry.credited,
    })),
    asOf: snapshot.asOf,
    closed: snapshot.closed,
  };
}

/**
 * The signed status page. A token that does not verify returns `invalid`
 * before the store is touched, so a guessed link costs no Notion read and
 * cannot be told apart from a valid link whose row has since been removed.
 *
 * Answered from the shared leaderboard pass, not a fresh scan: anyone can sign
 * up, verify and hold a valid token, and one full paged read of the waitlist
 * per page load would let a single scripted link drain the Notion integration
 * quota that signups and confirmations share. The owner's own settings write
 * invalidates the pass, so their change shows at once; counts are at most
 * LEADERBOARD_CACHE_SECONDS old, the same as the public board.
 */
export async function getReferralStatusService(
  token: unknown,
  _locale: Locale,
  deps: ReferralServiceDeps,
): Promise<ReferralStatusResponse> {
  if (!deps.enabled()) return DISABLED;
  const refCode = await refCodeFor(token, deps);
  if (!refCode) return INVALID;

  // The owner's rank and count depend on every other row (self-referral,
  // duplicates, daily caps), so the whole pass is needed, not one row.
  let pass = await deps.leaderboardCache.get(deps);
  let row = ownRow(pass.rows, refCode);
  if (!row) {
    // Only a row newer than the cached pass gets here with a valid signature.
    // One filtered lookup decides whether a fresh pass is worth it, so a link
    // whose row was removed costs a single small query, never a full scan.
    if (!(await deps.store.findByRefCode(refCode))) return INVALID;
    deps.leaderboardCache.invalidate();
    pass = await deps.leaderboardCache.get(deps);
    row = ownRow(pass.rows, refCode);
    if (!row) return INVALID;
  }

  // A cached row from before this person confirmed still says unverified.
  // One filtered read picks up the checkbox; it does not scan the database.
  if (!row.emailVerified) {
    const fresh = await deps.store.findByRefCode(refCode);
    if (fresh?.emailVerified && fresh.pageId === row.pageId) {
      row.emailVerified = true;
      if (fresh.shareCode) row.shareCode = fresh.shareCode;
      row.shareCodeCustom = fresh.shareCodeCustom;
      row.shareCodeLocked = fresh.shareCodeLocked;
    }
  }
  if (row.emailVerified) await ensureShareCode(row, deps);

  const status = deps.statusFor(row, pass.ledger, {
    shareUrl: deps.shareUrl(deps.origin, refCode),
    closed: isClosed(deps),
  });
  return { status: "ok", referral: publicStatus(status) };
}

// Cells go through normalizeRefCode like every lookup, so a code stored with
// stray case or whitespace still finds its owner; on a (never expected)
// collision the lowest page id owns the code, exactly as in the ledger.
function ownRow(rows: readonly ReferralRow[], refCode: string): ReferralRow | undefined {
  let owner: ReferralRow | undefined;
  for (const candidate of rows) {
    if (normalizeRefCode(candidate.refCode) !== refCode) continue;
    if (!owner || candidate.pageId < owner.pageId) owner = candidate;
  }
  return owner;
}

/**
 * Nickname, leaderboard opt-in and friend-joined mails. `nicknameHidden` is
 * deliberately not an input: only ops can hide or un-hide a nickname.
 */
export async function updateReferralSettingsService(
  token: unknown,
  input: { nickname?: string | null; leaderboard?: boolean; noticesOff?: boolean },
  deps: ReferralServiceDeps,
): Promise<ReferralSettingsResponse> {
  if (!deps.enabled()) return DISABLED;
  const refCode = await refCodeFor(token, deps);
  if (!refCode) return INVALID;

  // Keyed by the verified code, not the raw token, so re-encoding one link
  // cannot buy a fresh allowance. Counted before validation: a script cycling
  // rejected nicknames is still a script.
  if (!deps.settingsLimiter.take(refCode, deps.now().getTime())) {
    return { status: "rate_limited" };
  }

  let nickname: string | null = null;
  const raw = typeof input.nickname === "string" ? input.nickname : "";
  if (raw.trim()) {
    const check = deps.checkNickname(raw);
    if (!check.ok) return { status: "rejected", reason: check.reason };
    nickname = check.value;
  }

  const row = await deps.store.findByRefCode(refCode);
  if (!row) return INVALID;

  // Built explicitly so no caller-supplied key (nicknameHidden, refCode,
  // pageId…) can ride along into the store write.
  const settings: ReferralSettingsInput = {
    nickname,
    leaderboard: input.leaderboard === true,
    noticesOff: input.noticesOff === true,
  };
  // An ops hide lifts only for a genuinely different name. Compared folded, so
  // a case, width or separator variant of the hidden name is the same name.
  // And only against a name still on the row: after "clear" the hidden value
  // is gone, so "clear, then type the hidden name again" must not lift it;
  // that person stays hidden until ops look again.
  const liftHide =
    row.nicknameHidden &&
    Boolean(nickname) &&
    Boolean(row.nickname) &&
    foldNickname(row.nickname ?? "") !== foldNickname(nickname ?? "");
  await deps.store.writeSettings(row.pageId, {
    ...settings,
    ...(liftHide ? { clearHidden: true } : {}),
  });
  // The public board may now show a different name; the next reader rebuilds it.
  deps.leaderboardCache.invalidate();
  return { status: "ok", settings: { ...settings } };
}

/** Same folding the nickname check uses for its reserved-word match. */
function foldNickname(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s._\-()+/]/gu, "");
}

type LeaderboardPass = {
  snapshot: LeaderboardSnapshot;
  /** Server-only: credited count per code, for the landing card progress. */
  credited: Map<string, number>;
  /** Server-only (emails, page ids): the rows and ledger the status page reads. */
  rows: readonly ReferralRow[];
  ledger: LedgerResult;
};

export type LeaderboardCache = {
  get(deps: ReferralServiceDeps): Promise<LeaderboardPass>;
  invalidate(): void;
};

/**
 * One Notion pass serves every reader for LEADERBOARD_CACHE_SECONDS, and
 * readers arriving while a pass is running wait for that same pass instead of
 * starting their own (the landing page is hit by ad bursts). A failed pass is
 * not cached, so the next reader retries.
 */
export function createLeaderboardCache(ttlMs = LEADERBOARD_CACHE_SECONDS * 1000): LeaderboardCache {
  let cached: { at: number; pass: LeaderboardPass } | null = null;
  let inflight: Promise<LeaderboardPass> | null = null;
  let generation = 0;

  return {
    async get(deps) {
      const nowMs = deps.now().getTime();
      if (cached && nowMs - cached.at < ttlMs) return cached.pass;
      if (inflight) return inflight;
      const started = generation;
      inflight = (async () => {
        const rows = await deps.store.listProgramRows();
        const now = deps.now();
        const ledger = deps.computeLedger(rows, { closesAt: deps.closesAt() });
        const snapshot = publicSnapshot(
          deps.buildLeaderboard(rows, ledger, {
            size: LEADERBOARD_SIZE,
            now,
            closed: isClosed(deps, now),
          }),
        );
        const credited = new Map<string, number>();
        for (const [code, standing] of ledger.standings) credited.set(code, standing.credited);
        const pass = { snapshot, credited, rows, ledger };
        // A settings write during this pass may not be reflected in it, so it
        // is served to the readers already waiting but not kept.
        if (started === generation) cached = { at: now.getTime(), pass };
        return pass;
      })().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    invalidate() {
      generation += 1;
      cached = null;
    },
  };
}

/** Callers check `deps.enabled()` first (the route answers 404 when off). */
export async function getLeaderboardService(
  deps: ReferralServiceDeps,
): Promise<LeaderboardSnapshot> {
  if (!deps.enabled()) throw new Error("Buddy Invite is not enabled");
  const { snapshot } = await deps.leaderboardCache.get(deps);
  return publicSnapshot(snapshot);
}

/**
 * Credited friends for one share code (landing success card). Answered from
 * the cached leaderboard pass, so it is at most LEADERBOARD_CACHE_SECONDS old
 * and costs no Notion read per visitor. An unknown code reads as 0, the same
 * as a known code with no friends. `enabled: false` tells the landing card
 * to keep its pre-program behaviour.
 */
export async function getReferralProgressService(
  refCode: string,
  deps: ReferralServiceDeps,
): Promise<ReferralProgressResponse> {
  if (!deps.enabled()) return { enabled: false };
  const code = normalizeRefCode(refCode);
  if (!code) return { enabled: true, credited: 0 };
  const { credited } = await deps.leaderboardCache.get(deps);
  return { enabled: true, credited: credited.get(code) ?? 0 };
}

export type MyShareCodeResponse = { enabled: false } | { enabled: true; code: string | null };

export type ShareCodeClaimResponse =
  | { status: "ok"; code: string; custom: boolean }
  | { status: "invalid" }
  | { status: "disabled" }
  | { status: "rate_limited" }
  | { status: "rejected"; reason: ShareCodeRejectReason | "failed" };

/** What a signup lookup may hand back. Never includes an email or a nickname. */
export type ShareCodeResolution = {
  refCode: string;
  pageId: string;
  code: string;
  custom: boolean;
  locked: boolean;
};

const ASSIGN_ATTEMPTS = 6;
const assignLimiters = new WeakMap<ReferralServiceDeps, RateLimiter>();

function assignLimiterFor(deps: ReferralServiceDeps): RateLimiter {
  let limiter = assignLimiters.get(deps);
  if (!limiter) {
    // Separate from the nickname limiter: assigning a code must not eat the
    // allowance a person uses to save their leaderboard name.
    limiter = createRateLimiter(8, SETTINGS_WINDOW_MS);
    assignLimiters.set(deps, limiter);
  }
  return limiter;
}

/**
 * Gives a verified person an unambiguous 6-character code the first time a
 * surface asks. Writes, then reads back: the lowest page id owns a code, so
 * a lost race restores the previous cell and tries another code. The cached
 * row is updated in place so the next status read inside the leaderboard TTL
 * does not assign a second code or scan Notion again. A failure leaves the
 * page usable with no code.
 */
export async function ensureShareCode(
  row: ReferralRow,
  deps: ReferralServiceDeps,
  generate: () => string = generateShareCode,
): Promise<string | null> {
  if (!row.emailVerified) return null;
  const current = canonicalShareCode(row.shareCode);
  if (current) {
    row.shareCode = current;
    return current;
  }
  if (!assignLimiterFor(deps).take(normalizeRefCode(row.refCode) || row.pageId, deps.now().getTime())) {
    return null;
  }
  // A cached status pass may predate a successful claim on another surface.
  // Re-read before writing so a sequential stale read cannot erase that claim.
  try {
    const fresh = await deps.store.findByRefCode(row.refCode);
    if (!fresh?.emailVerified || fresh.pageId !== row.pageId) return null;
    const assigned = canonicalShareCode(fresh.shareCode);
    if (assigned) {
      row.shareCode = assigned;
      row.shareCodeCustom = fresh.shareCodeCustom;
      row.shareCodeLocked = fresh.shareCodeLocked;
      return assigned;
    }
  } catch {
    return null;
  }
  const previous = {
    code: row.shareCode ?? "",
    custom: row.shareCodeCustom === true,
    locked: row.shareCodeLocked === true,
  };
  for (let attempt = 0; attempt < ASSIGN_ATTEMPTS; attempt += 1) {
    let code: string;
    try {
      code = generate();
    } catch {
      return null;
    }
    if (!canonicalShareCode(code)) continue;
    try {
      const existing = await deps.store.findByShareCode(code);
      if (existing && existing.pageId !== row.pageId) continue;
      await deps.store.writeShareCode(row.pageId, { code, custom: false, locked: false });
      const owner = await deps.store.findByShareCode(code);
      if (!owner || owner.pageId !== row.pageId) {
        await deps.store.writeShareCode(row.pageId, previous).catch(() => undefined);
        continue;
      }
    } catch {
      return null;
    }
    row.shareCode = code;
    row.shareCodeCustom = false;
    row.shareCodeLocked = false;
    return code;
  }
  return null;
}

/**
 * One custom code, from the status page. The same code is a no-op even when
 * the row is locked. A different code is refused once the person has claimed
 * one, or once a signup was attributed through it. An 8-character code that
 * is already someone else's ref code is taken, so a link to that person keeps
 * working. Losing the read-after-write race restores the previous cell and
 * reports taken — it does not invent a different code.
 */
export async function claimShareCodeService(
  token: unknown,
  raw: unknown,
  deps: ReferralServiceDeps,
): Promise<ShareCodeClaimResponse> {
  if (!deps.enabled()) return DISABLED;
  const refCode = await refCodeFor(token, deps);
  if (!refCode) return INVALID;
  if (!deps.settingsLimiter.take(`claim:${refCode}`, deps.now().getTime())) {
    return { status: "rate_limited" };
  }
  const row = await deps.store.findByRefCode(refCode);
  if (!row?.emailVerified) return INVALID;

  const submitted = canonicalShareCode(typeof raw === "string" ? raw : "");
  const owned = canonicalShareCode(row.shareCode);
  if (submitted && owned && submitted === owned) {
    return { status: "ok", code: owned, custom: row.shareCodeCustom === true };
  }
  const decision = claimDecision(row);
  if (decision !== "ok") return { status: "rejected", reason: decision };

  // The annotation is only a best-effort early lock. A fresh ledger also
  // prevents editing after credit if that annotation was lost or never saved.
  // Attribution retains refCode, so this conservatively includes link credits.
  try {
    const rows = await deps.store.listProgramRows();
    const ledger = deps.computeLedger(rows, { closesAt: deps.closesAt() });
    if ((ledger.standings.get(refCode)?.credited ?? 0) > 0) {
      return { status: "rejected", reason: "locked" };
    }
  } catch {
    return { status: "rejected", reason: "failed" };
  }

  const check = checkShareCode(typeof raw === "string" ? raw : "");
  if (!check.ok) return { status: "rejected", reason: check.reason };
  const code = check.value;

  try {
    if (code.length === 8) {
      const refOwner = await deps.store.findByRefCode(code.toLowerCase());
      if (refOwner && refOwner.pageId !== row.pageId) return { status: "rejected", reason: "taken" };
    }
    const taken = await deps.store.findByShareCode(code);
    if (taken && taken.pageId !== row.pageId) return { status: "rejected", reason: "taken" };
    const previous = {
      code: row.shareCode ?? "",
      custom: row.shareCodeCustom === true,
      locked: row.shareCodeLocked === true,
    };
    await deps.store.writeShareCode(row.pageId, {
      code,
      custom: true,
      locked: previous.locked,
    });
    const owner = await deps.store.findByShareCode(code);
    if (!owner || owner.pageId !== row.pageId) {
      await deps.store.writeShareCode(row.pageId, previous).catch(() => undefined);
      return { status: "rejected", reason: "taken" };
    }
  } catch {
    return { status: "rejected", reason: "failed" };
  }
  deps.leaderboardCache.invalidate();
  return { status: "ok", code, custom: true };
}

/**
 * The landing card's code. Separate from progress so a progress read stays a
 * count. Notion trouble answers `{ enabled: true, code: null }` rather than
 * breaking the card. The code is not a nickname and not an email.
 */
export async function getMyShareCodeService(
  refCode: string,
  deps: ReferralServiceDeps,
): Promise<MyShareCodeResponse> {
  if (!deps.enabled()) return { enabled: false };
  const code = normalizeRefCode(refCode);
  if (!code) return { enabled: true, code: null };
  try {
    const pass = await deps.leaderboardCache.get(deps);
    let row = ownRow(pass.rows, code);
    if (!row || !row.emailVerified) {
      const fresh = await deps.store.findByRefCode(code);
      if (!fresh) return { enabled: true, code: null };
      if (row && row.pageId === fresh.pageId) {
        row.emailVerified = fresh.emailVerified;
        if (fresh.shareCode) row.shareCode = fresh.shareCode;
        row.shareCodeCustom = fresh.shareCodeCustom;
        row.shareCodeLocked = fresh.shareCodeLocked;
      } else {
        row = fresh;
      }
    }
    if (!row.emailVerified) return { enabled: true, code: null };
    return { enabled: true, code: await ensureShareCode(row, deps) };
  } catch {
    return { enabled: true, code: null };
  }
}

/**
 * Signup lookup. Returns the owner's ref code so `Referred by` stays an
 * 8-character code, plus the page id the caller needs to lock the cell.
 * Rate-limit and Notion failure are indistinguishable from an unknown code
 * (`null` vs `"limited"` only so the caller can skip a lock). No email, no
 * nickname.
 */
export async function resolveShareCodeForSignup(
  raw: string,
  deps: ReferralServiceDeps,
  limiter: RateLimiter,
  ip: string,
): Promise<ShareCodeResolution | "limited" | null> {
  if (!deps.enabled()) return null;
  if (!limiter.take(ip || "unknown", deps.now().getTime())) return "limited";
  const code = canonicalShareCode(raw);
  if (!code) return null;
  try {
    const owner = await deps.store.findByShareCode(code);
    const refCode = owner ? normalizeRefCode(owner.refCode) : "";
    if (!owner || !refCode) return null;
    return {
      refCode,
      pageId: owner.pageId,
      code: canonicalShareCode(owner.shareCode) ?? code,
      custom: owner.shareCodeCustom === true,
      locked: owner.shareCodeLocked === true,
    };
  } catch {
    return null;
  }
}

/** Best-effort freeze after a signup stored this code's ref. Never throws. */
export async function lockShareCodeAfterCredit(
  owner: { pageId: string; code: string; custom: boolean },
  deps: ReferralServiceDeps,
): Promise<void> {
  const code = canonicalShareCode(owner.code);
  if (!code) return;
  try {
    const fresh = await deps.store.findByShareCode(code);
    if (!fresh || fresh.pageId !== owner.pageId) return;
    await deps.store.writeShareCode(owner.pageId, {
      code, custom: fresh.shareCodeCustom === true, locked: true,
    });
    deps.leaderboardCache.invalidate();
  } catch {
    // The signup already succeeded. A later signup through the same code
    // tries the lock again.
  }
}

export type RateLimiter = { take(key: string, nowMs: number): boolean };

/** Fixed-window counter per key, bounded so a flood of keys cannot grow it forever. */
export function createRateLimiter(
  limit = SETTINGS_WRITES_PER_WINDOW,
  windowMs = SETTINGS_WINDOW_MS,
  maxKeys = 5_000,
): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take(key, nowMs) {
      const current = windows.get(key);
      if (!current || nowMs - current.start >= windowMs) {
        if (windows.size >= maxKeys) {
          for (const [k, w] of windows) if (nowMs - w.start >= windowMs) windows.delete(k);
          // Still full of live windows: drop the oldest rather than refuse a new person.
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value as string);
        }
        windows.set(key, { start: nowMs, count: 1 });
        return true;
      }
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    },
  };
}

export const LEADERBOARD_CACHE_CONTROL = `public, s-maxage=${LEADERBOARD_CACHE_SECONDS}, stale-while-revalidate=${LEADERBOARD_CACHE_SECONDS * 2}`;

/**
 * GET /api/referral/leaderboard. The body is public by design (opted-in
 * nicknames and counts only), so the CDN may share it. A failure is a bare
 * 503 that is never cached: no Notion detail, no stack, no partial board.
 */
export async function leaderboardResponse(
  enabled: boolean,
  loadDeps: () => Promise<ReferralServiceDeps>,
): Promise<Response> {
  // Checked before the Notion wiring is even built, and never cached, so the
  // switch takes effect on the next request rather than after a CDN lifetime.
  if (!enabled) {
    return new Response(JSON.stringify({ enabled: false }), {
      status: 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  }
  try {
    const snapshot = await getLeaderboardService(await loadDeps());
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": LEADERBOARD_CACHE_CONTROL,
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error(
      `[referral-leaderboard] failed (${error instanceof Error ? error.name : "unknown"})`,
    );
    return new Response(JSON.stringify({ error: "unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
