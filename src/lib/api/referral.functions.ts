import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

// Pure helper with no secrets or Notion client of its own; safe in any bundle.
import { withRateLimitBackoff } from "@/lib/api/referralCount";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locale";
import { referralProgramEnabled } from "@/lib/referral/program";
import { createProgramStateReader } from "@/lib/referral/programState";
import type {
  MyShareCodeResponse,
  ReferralProgressResponse,
  ReferralServiceDeps,
  ReferralSettingsResponse,
  ReferralStatusResponse,
  ShareCodeClaimResponse,
} from "@/lib/referral/service.server";

// Buddy Invite server functions. The service and every module that touches
// Notion or the signing secret are imported lazily inside the handlers, the
// same way adminBehavior.functions.ts does it, so none of them has a path into
// a client bundle. Env: NOTION_API_KEY, NOTION_WAITLIST_DB_ID,
// WATCHDIVE_PUBLIC_ORIGIN, the referral signing secret read by
// `referralSecret(env)`, and optionally WATCHDIVE_REFERRAL_CLOSES_AT.

// Process-wide: one leaderboard pass and one write allowance per code for
// every request this server instance handles.
let shared: Pick<ReferralServiceDeps, "leaderboardCache" | "settingsLimiter"> | null = null;

export async function referralServiceDeps(): Promise<ReferralServiceDeps> {
  const [service, program, ledger, nickname, statusToken, store, notion, token, origin] =
    await Promise.all([
      import("@/lib/referral/service.server"),
      import("@/lib/referral/program"),
      import("@/lib/referral/ledger"),
      import("@/lib/referral/nickname"),
      import("@/lib/referral/statusToken"),
      import("@/lib/referral/store"),
      import("@/lib/verification/notionLead"),
      import("@/lib/verification/token"),
      import("@/lib/i18n/publicOrigin"),
    ]);
  const dbId = process.env.NOTION_WAITLIST_DB_ID;
  if (!dbId) throw new Error("NOTION_WAITLIST_DB_ID is not set");
  shared ??= {
    leaderboardCache: service.createLeaderboardCache(),
    settingsLimiter: service.createRateLimiter(),
  };
  let publicOrigin: string;
  try {
    publicOrigin = token.requirePublicOrigin(process.env);
  } catch {
    // Share links must still point somewhere real when a preview lacks the var.
    publicOrigin = origin.WATCHDIVE_PUBLIC_ORIGIN;
  }
  return {
    enabled: () => program.referralProgramEnabled(process.env),
    // Every leaderboard pass, status read and settings write retries a Notion
    // 429 with backoff instead of failing (a 429 is never applied, so a
    // retried write is safe).
    store: store.createNotionReferralStore(
      withRateLimitBackoff(notion.createNotionRequest()),
      dbId,
    ),
    secret: statusToken.referralSecret(process.env),
    origin: publicOrigin,
    now: () => new Date(),
    closesAt: () => program.referralClosesAt(process.env),
    verifyStatusToken: statusToken.verifyStatusToken,
    computeLedger: ledger.computeLedger,
    statusFor: ledger.statusFor,
    buildLeaderboard: ledger.buildLeaderboard,
    checkNickname: nickname.checkNickname,
    shareUrl: statusToken.shareUrl,
    ...shared,
  };
}

async function failSafely(scope: string, error: unknown): Promise<Error> {
  const { sanitizeServerError } = await import("@/lib/verification/deps.server");
  return sanitizeServerError(scope, error);
}

/**
 * The owner's switch (WATCHDIVE_REFERRAL_PROGRAM_ENABLED=1, server env). Read
 * per request so flipping it needs no rebuild; the rules page and the landing
 * card ask here before showing anything Buddy Invite.
 */
const getReferralProgramStateRpc = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ enabled: boolean }> => ({ enabled: referralProgramEnabled(process.env) }),
);

const readProgramState = createProgramStateReader(() => getReferralProgramStateRpc());
export function getReferralProgramState(): Promise<{ enabled: boolean }> {
  return readProgramState(typeof window === "undefined");
}

// Signed tokens are short; the bound only stops oversized junk early.
const tokenSchema = z.string().min(1).max(400);

export const getReferralStatus = createServerFn({ method: "POST" })
  .validator(z.object({ token: tokenSchema, locale: z.enum(SUPPORTED_LOCALES).default("en") }))
  .handler(async ({ data }): Promise<ReferralStatusResponse> => {
    // Before the deps are built: an unconfigured secret must not turn "off" into an error.
    if (!referralProgramEnabled(process.env)) return { status: "disabled" };
    try {
      const { getReferralStatusService } = await import("@/lib/referral/service.server");
      return await getReferralStatusService(data.token, data.locale, await referralServiceDeps());
    } catch (error) {
      throw await failSafely("referral-status", error);
    }
  });

export const updateReferralSettings = createServerFn({ method: "POST" })
  .validator(
    // Unknown keys (nicknameHidden included) are stripped by zod and, beyond
    // that, never read by the service.
    z.object({
      token: tokenSchema,
      nickname: z.string().max(200).nullable(),
      leaderboard: z.boolean(),
      noticesOff: z.boolean(),
    }),
  )
  .handler(async ({ data }): Promise<ReferralSettingsResponse> => {
    if (!referralProgramEnabled(process.env)) return { status: "disabled" };
    try {
      const { updateReferralSettingsService } = await import("@/lib/referral/service.server");
      return await updateReferralSettingsService(
        data.token,
        { nickname: data.nickname, leaderboard: data.leaderboard, noticesOff: data.noticesOff },
        await referralServiceDeps(),
      );
    } catch (error) {
      throw await failSafely("referral-settings", error);
    }
  });

// Same normalization as the share link and `Referred by` writes.
function sanitizeRef(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
}

export const getReferralProgress = createServerFn({ method: "POST" })
  .validator(z.object({ refCode: z.string().max(40) }))
  .handler(async ({ data }): Promise<ReferralProgressResponse> => {
    if (!referralProgramEnabled(process.env)) return { enabled: false };
    try {
      const { getReferralProgressService } = await import("@/lib/referral/service.server");
      return await getReferralProgressService(
        sanitizeRef(data.refCode),
        await referralServiceDeps(),
      );
    } catch (error) {
      throw await failSafely("referral-progress", error);
    }
  });

// The verified card asks for its code here, not on the progress read, so a
// progress response stays `{ enabled, credited }`.
export const getMyShareCode = createServerFn({ method: "POST" })
  .validator(z.object({ refCode: z.string().max(40) }))
  .handler(async ({ data }): Promise<MyShareCodeResponse> => {
    if (!referralProgramEnabled(process.env)) return { enabled: false };
    try {
      const { shareLinkLimiter } = await import("@/lib/referral/shareLink.server");
      const ip = (getRequestHeader("x-forwarded-for") ?? getRequestHeader("x-real-ip") ?? "")
        .split(",")[0]?.trim() || "unknown";
      if (!shareLinkLimiter().take(ip, Date.now())) return { enabled: true, code: null };
      const { getMyShareCodeService } = await import("@/lib/referral/service.server");
      return await getMyShareCodeService(sanitizeRef(data.refCode), await referralServiceDeps());
    } catch {
      // A missing column or a Notion outage leaves the card up, without a code.
      return { enabled: true, code: null };
    }
  });

export const claimShareCode = createServerFn({ method: "POST" })
  .validator(z.object({ token: tokenSchema, code: z.string().max(80) }))
  .handler(async ({ data }): Promise<ShareCodeClaimResponse> => {
    if (!referralProgramEnabled(process.env)) return { status: "disabled" };
    try {
      const { claimShareCodeService } = await import("@/lib/referral/service.server");
      return await claimShareCodeService(data.token, data.code, await referralServiceDeps());
    } catch (error) {
      throw await failSafely("referral-share-code", error);
    }
  });

/** Route loader for /buddy and /$locale/buddy: 404 unless WATCHDIVE_REFERRAL_PROGRAM_ENABLED=1. */
export async function requireReferralProgram(): Promise<void> {
  let enabled = false;
  try {
    enabled = (await getReferralProgramState()).enabled;
  } catch {
    enabled = false;
  }
  if (!enabled) throw notFound();
}

// The status link carries its signed token in the URL fragment, which no
// Referer ever includes; no-referrer and noindex stay as defence in depth.
export const BUDDY_PAGE_META = [
  { name: "referrer", content: "no-referrer" },
  { name: "robots", content: "noindex, nofollow, noarchive" },
] as const;
