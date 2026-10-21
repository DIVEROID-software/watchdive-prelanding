// Buddy Invite's view of the waitlist database, over the Notion API.
//
// Reads reuse the verification flow's row parser (`toLeadRecord`), so status,
// the verified checkbox, `Verified at`, Suspect, Duplicate, Flags and Signup
// locale mean exactly what they mean everywhere else. The program's own
// columns (contract.ts REFERRAL_COLUMNS) are created by ops later; until then
// they are simply absent from each page and parse as defaults, and every
// query filters on existing columns only, so reading never depends on them.
//
// Writes are narrow PATCHes that name only the program's own columns: a
// settings save can never touch status, attribution, consent or dates.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { canonicalEmail } from "../api/abuse.ts";
import { CANONICAL_EMAIL_PROPERTY } from "../api/notionCanonicalEmail.ts";
import { toLeadRecord, type NotionRequest } from "../verification/notionLead.ts";
import { REFERRAL_COLUMNS, type ReferralRow, type ReferralStore } from "./contract.ts";

/** 100 rows a page; a runaway cursor stops here rather than looping forever. */
const MAX_PAGES = 500;
const REF_CODE = /^[a-z0-9]{8}$/;

type Properties = Record<string, unknown>;

function readText(property: unknown): string {
  const rich = (property as { rich_text?: { plain_text?: string }[] } | undefined)?.rich_text;
  return (rich ?? []).map((part) => part.plain_text ?? "").join("");
}

function readCheckbox(property: unknown): boolean {
  return Boolean((property as { checkbox?: boolean } | undefined)?.checkbox);
}

function readNumber(property: unknown): number {
  const value = (property as { number?: number | null } | undefined)?.number;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readDate(property: unknown): string | undefined {
  return (property as { date?: { start?: string } | null } | undefined)?.date?.start ?? undefined;
}

/** The live column has been both email and rich_text; read either. */
function readCanonicalEmail(property: unknown): string {
  const value = property as { email?: unknown } | undefined;
  if (typeof value?.email === "string") return value.email.trim().toLowerCase();
  return readText(property).trim().toLowerCase();
}

function readReview(property: unknown): ReferralRow["rewardReview"] {
  const name = (property as { select?: { name?: string } | null } | undefined)?.select?.name;
  return name === "pending" || name === "approved" || name === "rejected" ? name : undefined;
}

/** One Notion page as a ReferralRow, or undefined when it is not a page. */
export function toReferralRow(page: Record<string, unknown>): ReferralRow | undefined {
  const lead = toLeadRecord(page);
  if (!lead) return undefined;
  const properties = (page.properties ?? {}) as Properties;
  const referredBy = readText(properties[REFERRAL_COLUMNS.referredBy]).trim().toLowerCase();
  const nickname = readText(properties[REFERRAL_COLUMNS.nickname]);
  const notifiedAt = readDate(properties[REFERRAL_COLUMNS.notifiedAt]);
  const rewardReview = readReview(properties[REFERRAL_COLUMNS.rewardReview]);
  // Rows older than the canonical column fall back to the same canonicalizer
  // the signup form uses, so self-referral and duplicate checks still hold.
  const stored = readCanonicalEmail(properties[CANONICAL_EMAIL_PROPERTY]);
  return {
    pageId: lead.pageId,
    refCode: lead.refCode.trim().toLowerCase(),
    ...(referredBy ? { referredBy } : {}),
    canonicalEmail: stored || (lead.email ? canonicalEmail(lead.email) : ""),
    status: lead.status,
    emailVerified: lead.emailVerified,
    ...(lead.verifiedAt ? { verifiedAt: lead.verifiedAt } : {}),
    suspect: lead.suspect,
    duplicate: Boolean(lead.duplicate),
    flags: lead.flags,
    ...(nickname ? { nickname } : {}),
    leaderboard: readCheckbox(properties[REFERRAL_COLUMNS.leaderboard]),
    nicknameHidden: readCheckbox(properties[REFERRAL_COLUMNS.nicknameHidden]),
    noticesOff: readCheckbox(properties[REFERRAL_COLUMNS.noticesOff]),
    notifiedCount: readNumber(properties[REFERRAL_COLUMNS.notifiedCount]),
    ...(notifiedAt ? { notifiedAt } : {}),
    ...(rewardReview ? { rewardReview } : {}),
    ...(lead.signupLocale ? { signupLocale: lead.signupLocale } : {}),
    email: lead.email,
  };
}

/** Rows that take part: anyone with a code to share or a code they came in on. */
export const PROGRAM_ROWS_FILTER = {
  or: [
    { property: REFERRAL_COLUMNS.refCode, rich_text: { is_not_empty: true } },
    { property: REFERRAL_COLUMNS.referredBy, rich_text: { is_not_empty: true } },
  ],
} as const;

export function createNotionReferralStore(
  request: NotionRequest,
  databaseId: string,
): ReferralStore {
  return {
    async listProgramRows() {
      const rows: ReferralRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) throw new Error("Referral rows exceed the page cap");
        const result = await request("POST", `databases/${databaseId}/query`, {
          filter: PROGRAM_ROWS_FILTER,
          // Stable order across pages; the ledger sorts on its own anyway.
          sorts: [{ timestamp: "created_time", direction: "ascending" }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        for (const raw of (result.results as Record<string, unknown>[] | undefined) ?? []) {
          const row = toReferralRow(raw);
          if (row) rows.push(row);
        }
        if (!result.has_more || typeof result.next_cursor !== "string") break;
        cursor = result.next_cursor;
      }
      return rows;
    },

    async findByRefCode(refCode) {
      const code = refCode.trim().toLowerCase();
      if (!REF_CODE.test(code)) return undefined;
      const result = await request("POST", `databases/${databaseId}/query`, {
        filter: { property: REFERRAL_COLUMNS.refCode, rich_text: { equals: code } },
        // Codes are unique by construction; on a (never expected) collision
        // the oldest row answers, and the ledger refuses to credit a second
        // row for the same code either way.
        sorts: [{ timestamp: "created_time", direction: "ascending" }],
        page_size: 1,
      });
      const first = (result.results as Record<string, unknown>[] | undefined)?.[0];
      const row = first ? toReferralRow(first) : undefined;
      return row && row.refCode === code ? row : undefined;
    },

    async writeSettings(pageId, input) {
      const nickname = input.nickname ?? "";
      await request("PATCH", `pages/${pageId}`, {
        properties: {
          [REFERRAL_COLUMNS.nickname]: {
            rich_text: nickname ? [{ text: { content: nickname.slice(0, 200) } }] : [],
          },
          [REFERRAL_COLUMNS.leaderboard]: { checkbox: input.leaderboard },
          [REFERRAL_COLUMNS.noticesOff]: { checkbox: input.noticesOff },
          ...(input.clearHidden ? { [REFERRAL_COLUMNS.nicknameHidden]: { checkbox: false } } : {}),
        },
      });
    },

    async markNotified(pageId, input) {
      if (!Number.isSafeInteger(input.count) || input.count < 0) {
        throw new Error("A notified count must be a non-negative integer");
      }
      await request("PATCH", `pages/${pageId}`, {
        properties: {
          [REFERRAL_COLUMNS.notifiedCount]: { number: input.count },
          [REFERRAL_COLUMNS.notifiedAt]: { date: { start: input.at } },
        },
      });
    },
  };
}
