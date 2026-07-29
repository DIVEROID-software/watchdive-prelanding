import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { canonicalEmail, isDisposableEmail, isHeadlessUA, firstIp } from "./abuse";
import { sendMetaLead } from "./metaCapi";
import {
  canonicalEmailFilters,
  canonicalEmailProperties,
  withCanonicalEmailShape,
} from "./notionCanonicalEmail";

// Waitlist signups are stored directly in a Notion database — no Supabase.
// Server-only: the Notion token never reaches the browser.
// Required env vars (set in .env locally / Vercel project settings in prod):
//   NOTION_API_KEY        — internal integration token (shared with the DB)
//   NOTION_WAITLIST_DB_ID — target database id
// The database needs these properties:
//   Email (title) · Phone (rich_text) · Source (select) · Signed up (date)
//   Ref code (rich_text) · Referred by (rich_text)
//   Canonical email (email, historically rich_text) · IP (rich_text)
//   User agent (rich_text)
//   Flags (multi_select) · Suspect (checkbox)

const NOTION_VERSION = "2022-06-28";

// How many signups from one IP before we treat further ones as suspect. Set
// above a typical shared household/office (a few genuine people behind one NAT).
const IP_SUSPECT_THRESHOLD = 4;

async function notionFetch(path: string, body: unknown) {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error("NOTION_API_KEY is not set");
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Notion ${path} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json();
}

function newRefCode() {
  // Exactly 8 lowercase alphanumerics, e.g. "a3f9k2qp". Extra random bytes make
  // sure we still have >= 8 usable chars after dropping base64url's - and _.
  return randomBytes(12)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 8);
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

function textProp(value: string) {
  return { rich_text: [{ text: { content: value.slice(0, 1900) } }] };
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
        filter: { and: [{ property: "Referred by", rich_text: { equals: code } }, NOT_SUSPECT] },
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
export const getWaitlistCount = createServerFn({ method: "GET" }).handler(async () => {
  const dbId = process.env.NOTION_WAITLIST_DB_ID;
  if (!dbId) return { count: 0 };
  if (_waitlistCountCache && Date.now() - _waitlistCountCache.at < 10_000) {
    return { count: _waitlistCountCache.count };
  }
  let count = 0;
  let cursor: string | undefined = undefined;
  let hasMore = true;
  while (hasMore) {
    const res = await notionFetch(`databases/${dbId}/query`, {
      filter: NOT_SUSPECT,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    count += res.results?.length ?? 0;
    hasMore = Boolean(res.has_more);
    cursor = res.next_cursor ?? undefined;
  }
  _waitlistCountCache = { at: Date.now(), count };
  return { count };
});

export const joinWaitlist = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.string().email().max(320),
      phone: z.string().max(40).optional(),
      source: z.string().max(60),
      referredBy: z.string().max(40).optional(),
      // Honeypot: a hidden field real users never see. Anything here = a bot.
      honeypot: z.string().max(200).optional(),
      // Meta conversion tracking: shared browser/server event id for dedup,
      // plus the pixel's _fbp/_fbc cookies for match quality.
      eventId: z
        .string()
        .regex(/^[A-Za-z0-9._:-]{8,64}$/)
        .optional(),
      measurementConsent: z.boolean().default(false),
      fbp: z.string().max(128).optional(),
      fbc: z.string().max(512).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const dbId = process.env.NOTION_WAITLIST_DB_ID;
    if (!dbId) throw new Error("NOTION_WAITLIST_DB_ID is not set");

    const email = data.email.trim().toLowerCase();
    const canonical = canonicalEmail(email);
    const { ip, ua } = requestMeta();

    // ---- Dedupe by canonical email (catches gmail dots/+tags), with an exact
    // fallback for any legacy rows created before Canonical email existed. Same
    // person twice is still a "success" — hand back their existing ref code so
    // the share link stays stable.
    const existing = await withCanonicalEmailShape(() =>
      notionFetch(`databases/${dbId}/query`, {
        filter: {
          or: [
            ...canonicalEmailFilters(canonical),
            { property: "Email", title: { equals: email } },
          ],
        },
        page_size: 1,
      }),
    );
    if (existing.results?.length > 0) {
      const props = existing.results[0].properties;
      const code = props["Ref code"]?.rich_text?.[0]?.plain_text ?? "";
      return { ok: true, duplicate: true, refCode: code, metaEventId: undefined };
    }

    // ---- Abuse signals (flag, don't lose the lead). Suspect rows are stored
    // for review but excluded from the public counters.
    const flags: string[] = [];
    if (data.honeypot && data.honeypot.trim()) flags.push("honeypot");
    if (isDisposableEmail(email)) flags.push("disposable");
    if (isHeadlessUA(ua)) flags.push("headless");

    if (ip) {
      const sameIp = await notionFetch(`databases/${dbId}/query`, {
        filter: { property: "IP", rich_text: { equals: ip } },
        page_size: 100,
      });
      if ((sameIp.results?.length ?? 0) >= IP_SUSPECT_THRESHOLD) flags.push("ip-repeat");
    }

    const suspect = flags.length > 0;

    const refCode = newRefCode();
    const referredBy = sanitizeRef(data.referredBy);

    await withCanonicalEmailShape(() =>
      notionFetch("pages", {
        parent: { database_id: dbId },
        properties: {
          Email: { title: [{ text: { content: email } }] },
          ...canonicalEmailProperties(canonical),
          ...(data.phone?.trim() ? { Phone: textProp(data.phone.trim()) } : {}),
          Source: { select: { name: data.source } },
          "Signed up": { date: { start: new Date().toISOString() } },
          "Ref code": textProp(refCode),
          ...(referredBy && referredBy !== refCode ? { "Referred by": textProp(referredBy) } : {}),
          ...(ip ? { IP: textProp(ip) } : {}),
          ...(ua ? { "User agent": textProp(ua) } : {}),
          ...(flags.length ? { Flags: { multi_select: flags.map((name) => ({ name })) } } : {}),
          Suspect: { checkbox: suspect },
        },
      }),
    );

    // A repeated shared IP remains a review/counter flag, but is not enough by
    // itself to discard a unique browser-confirmed conversion. Honeypots,
    // disposable addresses, and headless clients remain ineligible.
    const conversionBlocked = flags.some((flag) => flag !== "ip-repeat");
    const conversionEligible =
      !conversionBlocked && data.measurementConsent && Boolean(data.eventId);

    if (!conversionEligible) {
      console.log(
        `[meta-capi] skipped: ${
          conversionBlocked
            ? `blocked(${flags.join(",")})`
            : !data.measurementConsent
              ? "no measurement consent"
              : "no eventId"
        }`,
      );
    }
    if (conversionEligible && data.eventId) {
      await sendMetaLead({
        eventId: data.eventId,
        email,
        phone: data.phone,
        ip,
        ua,
        fbp: data.fbp,
        fbc: data.fbc,
        source: data.source,
      });
    }

    // Always report success (even to suspects) so the anti-abuse logic isn't
    // advertised — they just quietly don't count.
    return {
      ok: true,
      duplicate: false,
      refCode,
      metaEventId: conversionEligible ? data.eventId : undefined,
    };
  });
