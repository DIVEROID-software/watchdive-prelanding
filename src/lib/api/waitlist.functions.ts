import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { canonicalEmail, isDisposableEmail, isHeadlessUA, firstIp } from "./abuse";
import { sendMetaSubmitApplication } from "./metaCapi";
import {
  ATTRIBUTION_VALUE_MAX,
  FBCLID_MAX,
  sanitizeAttribution,
  toLeadAttribution,
} from "@/lib/attribution";
import { createServiceDependencies, sanitizeServerError } from "@/lib/verification/deps.server";
import { COUNTABLE_STATUS_FILTER, createNotionRequest } from "@/lib/verification/notionLead";
import { conversionBlocked, WAITLIST_CLOSED_MESSAGE } from "@/lib/verification/contracts";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locale";
import { waitlistClosed } from "@/lib/waitlistProgress";
import { createNetworkGate } from "@/lib/verification/networkGate";
import { networkKey, requireSecret } from "@/lib/verification/token";
import {
  confirmVerificationService,
  pollVerificationService,
  requestVerificationService,
} from "@/lib/verification/service";
import { launchOsWaitlistMeasurementSchema } from "./launchOsRelay";
import { bindCurrentRequestLaunchOsMeasurementContext } from "./launchOsRelay.server";

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
//   UTM Source · UTM Medium · UTM Campaign · UTM Content · UTM Term (rich_text)
//   Landing path (rich_text)

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

// Comfortably past `fb.1.<13-digit time>.<click id>`, which is the longest
// shape either cookie takes.
const META_COOKIE_MAX = FBCLID_MAX + 32;

// Pixel cookie values are forwarded to Meta verbatim, so they are held to the
// characters their documented `fb.1.<time>.<id>` shape uses.
function sanitizeMetaCookie(value: string | undefined | null): string {
  return (value ?? "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, META_COOKIE_MAX);
}

// Reads request metadata (IP, UA) inside a server fn. Header access can throw if
// there is no active request context, so it always degrades to empty strings.
function requestMeta(): { ip: string; ua: string; gpc: boolean } {
  try {
    const xff = getRequestHeader("x-forwarded-for") ?? getRequestHeader("x-real-ip");
    const ua = getRequestHeader("user-agent") ?? "";
    const secGpc = getRequestHeader("sec-gpc") ?? "";
    return { ip: firstIp(xff), ua, gpc: secGpc.trim() === "1" };
  } catch {
    return { ip: "", ua: "", gpc: false };
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
      // Optional and strict. Invalid/version-skewed telemetry is discarded so
      // it can never reject an otherwise valid operational signup.
      launchOsMeasurement: launchOsWaitlistMeasurementSchema,
      // Email and confirmation-page language. It is signed into the
      // verification token rather than added to the CRM schema. Defaulting to
      // English keeps older clients and already-open tabs compatible.
      locale: z.enum(SUPPORTED_LOCALES).default("en"),
      // The first touch this browser recorded. Every field is attacker-supplied
      // and ends up in a CRM cell, so the length ceiling here is only the outer
      // bound — the values are re-sanitised below rather than trusted as sent.
      attribution: z
        .object({
          utmSource: z.string().max(ATTRIBUTION_VALUE_MAX).optional(),
          utmMedium: z.string().max(ATTRIBUTION_VALUE_MAX).optional(),
          utmCampaign: z.string().max(ATTRIBUTION_VALUE_MAX).optional(),
          utmContent: z.string().max(ATTRIBUTION_VALUE_MAX).optional(),
          utmTerm: z.string().max(ATTRIBUTION_VALUE_MAX).optional(),
          landingPath: z.string().max(ATTRIBUTION_VALUE_MAX).optional(),
          fbclid: z.string().max(FBCLID_MAX).optional(),
          capturedAt: z.number().int().positive().optional(),
        })
        .optional(),
      // Present only when the browser fired its own SubmitApplication, so the
      // two legs carry one id and Meta counts one event.
      submitEventId: z
        .string()
        .regex(/^[A-Za-z0-9._:-]{8,64}$/)
        .optional(),
      // Pixel cookies, forwarded so the server leg matches as well as the
      // browser one. Never stored — they go to Meta and nowhere else.
      fbp: z.string().max(META_COOKIE_MAX).optional(),
      fbc: z.string().max(META_COOKIE_MAX).optional(),
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
    const { ip, ua, gpc } = requestMeta();
    // The server signal is authoritative. A forged client boolean cannot
    // override Global Privacy Control seen on the actual request.
    const measurementConsent = data.measurementConsent && !gpc;
    // LaunchOS authority is independent of whether Meta Pixel happens to be
    // configured. It requires the exact versioned grant, its short-lived
    // HttpOnly server binding, and no Sec-GPC override on this request.
    const launchOsMeasurement =
      !gpc && data.launchOsMeasurement
        ? bindCurrentRequestLaunchOsMeasurementContext(data.launchOsMeasurement)
        : undefined;

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

    // Re-derived from the payload rather than taken from it: the client-side
    // capture applies the same bounds, but nothing stops a caller posting
    // straight to this function with whatever it likes.
    const attribution = sanitizeAttribution(data.attribution);

    let result;
    try {
      result = await requestVerificationService(
        {
          email,
          canonical,
          ...(data.phone?.trim() ? { phone: data.phone.trim() } : {}),
          source: data.source,
          ...(sanitizeRef(data.referredBy) ? { referredBy: sanitizeRef(data.referredBy) } : {}),
          attribution: toLeadAttribution(attribution),
          flags,
          suspect: flags.length > 0,
          measurementConsent,
          ...(launchOsMeasurement ? { launchOsMeasurement } : {}),
          locale: data.locale,
          networkSendBlocked: verdict.blocked,
        },
        createServiceDependencies(),
      );
    } catch (error) {
      throw sanitizeServerError("verification-request", error);
    }

    // The optimisation event's server leg. Sent for every accepted submit that
    // carries consent and no abuse signal — a brand-new address, one already
    // pending, one already confirmed alike — so the latency it adds cannot say
    // which of those happened. That uniformity is the property the response
    // floor inside the service exists to protect, and this must not undo it.
    if (data.submitEventId && measurementConsent && !conversionBlocked(flags)) {
      const fbp = sanitizeMetaCookie(data.fbp);
      // The pixel derives `_fbc` from an `fbclid` landing, but only if it ran at
      // all. When an ad blocker stopped it, the click id kept from that same
      // landing rebuilds the value in Meta's documented shape — which is the
      // difference between a matched click and an unattributed one.
      const fbc =
        sanitizeMetaCookie(data.fbc) ||
        (attribution.fbclid && attribution.capturedAt
          ? `fb.1.${attribution.capturedAt}.${attribution.fbclid}`
          : "");

      await sendMetaSubmitApplication({
        eventId: data.submitEventId,
        email,
        ...(data.phone?.trim() ? { phone: data.phone.trim() } : {}),
        ...(ip ? { ip } : {}),
        ...(ua ? { ua } : {}),
        ...(fbp ? { fbp } : {}),
        ...(fbc ? { fbc } : {}),
        source: data.source,
      });
    }

    return result;
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
