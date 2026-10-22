// Resolves `/r/<code>` once Buddy Invite is on. The invite link stays primary:
// an existing 8-character ref code wins, and a memorable share code redirects
// to `/?ref=<owner ref code>`. The response never names the owner.
//
// Lookups are capped per IP so a caption or a boat network cannot walk the
// code space. A limited, missing or failed lookup answers the same way an
// unknown code does. An 8-character value still keeps `?ref=` in that case,
// so a link keeps working when Notion is down.
import { normalizeRefCode } from "./eligibility.ts";
import { createRateLimiter, type RateLimiter } from "./service.server.ts";
import {
  canonicalShareCode,
  decideShareLinkTarget,
  legacyShareLocation,
  sanitizeRefCode,
} from "./shareCode.ts";

/** Public lookups, link and signup share one budget: 40 per 10 minutes per IP. */
export const SHARE_LOOKUP_LIMIT = 40;
export const SHARE_LOOKUP_WINDOW_MS = 10 * 60 * 1000;

export type ShareLookupStore = {
  findByRefCode(refCode: string): Promise<{ pageId: string } | undefined>;
  findByShareCode(code: string): Promise<{ refCode: string } | undefined>;
};

const linkLimiter = createRateLimiter(SHARE_LOOKUP_LIMIT, SHARE_LOOKUP_WINDOW_MS);
const signupLimiter = createRateLimiter(SHARE_LOOKUP_LIMIT, SHARE_LOOKUP_WINDOW_MS);

/** The `/r/` limiter. Tests inject their own instead of this process-wide one. */
export function shareLinkLimiter(): RateLimiter {
  return linkLimiter;
}

/** Signup code lookups. Separate window from `/r/`, same budget. */
export function signupShareLimiter(): RateLimiter {
  return signupLimiter;
}

export function clientIpFromRequest(request: Request): string {
  const raw = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "";
  const ip = raw.split(",")[0]?.trim() ?? "";
  return ip || "unknown";
}

async function defaultStore(): Promise<ShareLookupStore | null> {
  const dbId = process.env.NOTION_WAITLIST_DB_ID;
  if (!process.env.NOTION_API_KEY || !dbId) return null;
  const [storeMod, notion] = await Promise.all([
    import("./store.ts"),
    import("../verification/notionLead.ts"),
  ]);
  return storeMod.createNotionReferralStore(notion.createNotionRequest(), dbId);
}

/**
 * Location for one `/r/<raw>` request. `enabled: false` never reads Notion
 * and matches the pre-share-code redirect. Callers still set the no-store
 * and noindex headers themselves.
 */
export async function resolveShareLinkLocation(input: {
  request: Request;
  home: string;
  raw: string | undefined;
  enabled: boolean;
  limiter?: RateLimiter;
  nowMs?: number;
  /** `null` skips Notion (misconfigured). Omit to build the real store. */
  store?: ShareLookupStore | null;
}): Promise<string> {
  if (!input.enabled) return legacyShareLocation(input.home, input.raw);
  const limiter = input.limiter ?? linkLimiter;
  const nowMs = input.nowMs ?? Date.now();
  // One token before any read. Limited and unknown look the same to the visitor.
  if (!limiter.take(clientIpFromRequest(input.request), nowMs)) {
    return legacyShareLocation(input.home, input.raw);
  }
  try {
    const store = input.store !== undefined ? input.store : await defaultStore();
    if (!store) return legacyShareLocation(input.home, input.raw);
    const ref = sanitizeRefCode(input.raw);
    const refOwnerFound = Boolean(ref && (await store.findByRefCode(ref)));
    let shareOwnerRef: string | undefined;
    if (!refOwnerFound) {
      const code = canonicalShareCode(input.raw);
      if (code) {
        const owner = await store.findByShareCode(code);
        shareOwnerRef = owner ? normalizeRefCode(owner.refCode) || undefined : undefined;
      }
    }
    return decideShareLinkTarget({
      home: input.home,
      raw: input.raw,
      enabled: true,
      refOwnerFound,
      shareOwnerRef,
    });
  } catch {
    return legacyShareLocation(input.home, input.raw);
  }
}
