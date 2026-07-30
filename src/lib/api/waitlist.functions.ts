import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { canonicalEmail, isDisposableEmail, isHeadlessUA, firstIp } from "./abuse";
import { createServiceDependencies, sanitizeServerError } from "@/lib/verification/deps.server";
import { COUNTABLE_STATUS_FILTER, createNotionRequest } from "@/lib/verification/notionLead";
import { WAITLIST_CLOSED_MESSAGE } from "@/lib/verification/contracts";
import { waitlistClosed } from "@/lib/waitlistProgress";
import { createNetworkGate } from "@/lib/verification/networkGate";
import { networkKey, requireSecret } from "@/lib/verification/token";
import {
  confirmVerificationService,
  pollVerificationService,
  requestVerificationService,
} from "@/lib/verification/service";

// Waitlist signups are stored directly in a Notion database — no Supabase.
// Server-only: the Notion, Resend and signing secrets never reach the browser.
//
// Submitting the form does not join the waitlist. It arms a verification
// attempt and sends one transactional confirmation mail; the lead only counts,
// earns a referral link, or produces a conversion once the link is confirmed.
//
// Required env vars (set in .env locally / Vercel project settings in prod):
//   NOTION_API_KEY        — internal integration token (shared with the DB)
//   NOTION_WAITLIST_DB_ID — target database id
//   RESEND_API_KEY        — transactional sending key
//   WATCHDIVE_EMAIL_FROM  — verified sender address
//   WATCHDIVE_EMAIL_REPLY_TO      — optional reply-to
//   WATCHDIVE_PUBLIC_ORIGIN       — fixed https origin used to build the link
//   WATCHDIVE_VERIFICATION_SECRET — >= 32 bytes; signs tokens and handles
// The database needs these properties:
//   Email (title) · Phone (rich_text) · Source (select) · Signed up (date)
//   Ref code (rich_text) · Referred by (rich_text)
//   Canonical email (email, historically rich_text)
//   Flags (multi_select) · Suspect (checkbox)
// The legacy IP and User agent columns are deliberately not part of this flow:
// they are neither read nor written, not even as a digest.
//   Verification status (select) · Verification sent (date)
//   Verification expires (date) · Email verified (checkbox)
//   Verified at (date) · Verification sends (number)
//   Lead ID (rich_text) · Meta Event ID (rich_text)

// Repeat-submit counters for one server process. The keyed digest of a client
// address is used as a map key here and nowhere else — it is never written to
// Notion, never logged, and never leaves memory.
const networkGate = createNetworkGate();

type NotionQueryPage = {
  results?: unknown[];
  has_more?: boolean;
  next_cursor?: string | null;
};

async function notionFetch(path: string, body: unknown): Promise<NotionQueryPage> {
  // Reuse the verification store's bounded, redacted Notion client. In
  // particular, response bodies can echo rejected property values and must
  // never be surfaced by the public count endpoints.
  return (await createNotionRequest()("POST", path, body)) as NotionQueryPage;
}

// Ref codes are 8 lowercase alphanumerics. Share targets sometimes glue the
// share text onto the link, so normalize to the same shape everywhere the code
// is written or looked up — otherwise attribution silently misses.
function sanitizeRef(v: string | undefined | null) {
  return (v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
}

// Reads request metadata (IP, UA) inside a server fn. Header access can throw if
// there is no active request context, so it always degrades to empty strings.
function requestMeta(): { ip: string; ua: string } {
  try {
    const xff = getRequestHeader("x-forwarded-for") ?? getRequestHeader("x-real-ip");
    const ua = getRequestHeader("user-agent") ?? "";
    return { ip: firstIp(xff), ua };
  } catch {
    return { ip: "", ua: "" };
  }
}

// Real (non-suspect) rows only — the number the counters and social proof show.
const NOT_SUSPECT = { property: "Suspect", checkbox: { equals: false } } as const;

// An unconfirmed address is not on the waitlist yet. Public numbers see
// confirmed rows plus legacy single opt-in rows, never pending or unsubscribed.
const COUNTABLE = { and: [NOT_SUSPECT, COUNTABLE_STATUS_FILTER] } as const;

// How many people signed up through a given referral code (Referred by == code).
// Powers the "N friends joined · $N off so far" progress in the success card.
// Suspect rows are excluded so a farmer can't inflate their own discount.
export const getReferralCount = createServerFn({ method: "POST" })
  .validator(z.object({ refCode: z.string().max(40) }))
  .handler(async ({ data }) => {
    const dbId = process.env.NOTION_WAITLIST_DB_ID;
    const code = sanitizeRef(data.refCode);
    if (!dbId || !code) return { count: 0 };
    let count = 0;
    let cursor: string | undefined = undefined;
    let hasMore = true;
    while (hasMore) {
      const res = await notionFetch(`databases/${dbId}/query`, {
        filter: {
          and: [{ property: "Referred by", rich_text: { equals: code } }, ...COUNTABLE.and],
        },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      count += res.results?.length ?? 0;
      hasMore = Boolean(res.has_more);
      cursor = res.next_cursor ?? undefined;
    }
    return { count };
  });

// Total signups — social proof ("N divers on the waitlist") and the "spots left"
// scarcity counter. Excludes suspect rows so abuse can't fake urgency. Cached
// 10s so ad traffic doesn't hammer the Notion API (rate limits).
let _waitlistCountCache: { at: number; count: number } | null = null;

// One counter, shared by the bar the visitor reads and the gate the submit
// passes through, so the drawn number and the enforced cap cannot disagree.
async function countableRows(dbId: string): Promise<number> {
  if (_waitlistCountCache && Date.now() - _waitlistCountCache.at < 10_000) {
    return _waitlistCountCache.count;
  }
  let count = 0;
  let cursor: string | undefined = undefined;
  let hasMore = true;
  while (hasMore) {
    const res = await notionFetch(`databases/${dbId}/query`, {
      filter: COUNTABLE,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    count += res.results?.length ?? 0;
    hasMore = Boolean(res.has_more);
    cursor = res.next_cursor ?? undefined;
  }
  _waitlistCountCache = { at: Date.now(), count };
  return count;
}

export const getWaitlistCount = createServerFn({ method: "GET" }).handler(async () => {
  const dbId = process.env.NOTION_WAITLIST_DB_ID;
  if (!dbId) return { count: 0 };
  return { count: await countableRows(dbId) };
});

// Submitting arms a verification attempt and sends one transactional mail. The
// response is identical for a new address, one already pending, one already
// confirmed, and a provider failure, so the form is not an existence oracle.
export const joinWaitlist = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.string().email().max(320),
      phone: z.string().max(40).optional(),
      // The two form placements that exist. An open string would let a caller
      // invent Source values and pollute the CRM's select options.
      source: z.enum(["hero", "offer"]),
      referredBy: z.string().max(40).optional(),
      // Honeypot: a hidden field real users never see. Anything here = a bot.
      honeypot: z.string().max(200).optional(),
      // The browser's measurement choice, captured now and carried signed
      // through the token so the confirming browser cannot widen it.
      measurementConsent: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const dbId = process.env.NOTION_WAITLIST_DB_ID;
    if (!dbId) throw new Error("NOTION_WAITLIST_DB_ID is not set");

    // The page advertises a cap, so the cap has to bind. Checked before any row
    // is written or any mail is produced.
    if (waitlistClosed(await countableRows(dbId))) {
      return { ok: true, status: "closed", message: WAITLIST_CLOSED_MESSAGE } as const;
    }

    const email = data.email.trim().toLowerCase();
    const canonical = canonicalEmail(email);
    const { ip, ua } = requestMeta();

    // The network address and user agent are read, used, and dropped inside
    // this handler. Neither reaches Notion, and neither is logged. Only a keyed
    // network digest survives in process memory; the user agent becomes a flag.
    const verdict = networkGate.record(networkKey(ip, requireSecret(process.env)));

    // ---- Abuse signals (flag, don't lose the lead). Suspect rows are stored
    // for review but excluded from the public counters.
    const flags: string[] = [];
    if (data.honeypot && data.honeypot.trim()) flags.push("honeypot");
    if (isDisposableEmail(email)) flags.push("disposable");
    if (isHeadlessUA(ua)) flags.push("headless");
    // Kept as a review flag only. A shared office is not grounds to drop a real
    // lead — the counters already exclude suspect rows.
    if (verdict.repeat) flags.push("ip-repeat");

    try {
      return await requestVerificationService(
        {
          email,
          canonical,
          ...(data.phone?.trim() ? { phone: data.phone.trim() } : {}),
          source: data.source,
          ...(sanitizeRef(data.referredBy) ? { referredBy: sanitizeRef(data.referredBy) } : {}),
          flags,
          suspect: flags.length > 0,
          measurementConsent: data.measurementConsent,
          networkSendBlocked: verdict.blocked,
        },
        createServiceDependencies(),
      );
    } catch (error) {
      throw sanitizeServerError("verification-request", error);
    }
  });

// The confirmation POST. The token reaches the server only here — it travelled
// in the mail link's fragment, which the browser never sends on a navigation,
// and the page hands it over from memory on a same-origin request the CSRF
// middleware has already validated.
export const confirmVerification = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(16).max(400) }))
  .handler(async ({ data }) => {
    try {
      return await confirmVerificationService(data.token, createServiceDependencies());
    } catch (error) {
      throw sanitizeServerError("verification-confirm", error);
    }
  });

// The original tab waits here. The handle names an attempt, never a person.
export const pollVerification = createServerFn({ method: "POST" })
  .validator(z.object({ handle: z.string().min(16).max(400) }))
  .handler(async ({ data }) => {
    try {
      return await pollVerificationService(data.handle, createServiceDependencies());
    } catch (error) {
      throw sanitizeServerError("verification-poll", error);
    }
  });
