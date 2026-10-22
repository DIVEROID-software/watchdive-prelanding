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
import {
  REFERRAL_COLUMNS,
  type ReferralRow,
  type ReferralStore,
  type ShareCodeWrite,
} from "./contract.ts";
import { normalizeRefCode } from "./eligibility.ts";

/** 100 rows a page; a runaway cursor stops here rather than looping forever. */
const MAX_PAGES = 500;

/**
 * How long a schema read that found every program column is trusted. The
 * notice pass rides a 5-minute tick, so this is about one schema GET per
 * process per few ticks. A read that found columns missing is not cached:
 * once ops add them, the next tick sees it.
 */
export const SCHEMA_CACHE_MS = 10 * 60 * 1000;
const schemaOk = new Map<string, number>();

/** Test hook: forget every cached schema read. */
export function resetReferralSchemaCache(): void {
  schemaOk.clear();
}

type Properties = Record<string, unknown>;

type RichPart = {
  plain_text?: string;
  annotations?: { code?: boolean; italic?: boolean };
};

function readText(property: unknown): string {
  const rich = (property as { rich_text?: RichPart[] } | undefined)?.rich_text;
  return (rich ?? []).map((part) => part.plain_text ?? "").join("");
}

/**
 * Share-code cell. `code` (the Notion "code" style) means the person claimed
 * it. `italic` means a signup was attributed through it. Both flags are
 * absent on an auto-assigned code. An italic toggle in the Notion UI is a
 * lock change; ops reset is clearing the cell.
 */
function readShareCode(property: unknown): { text: string; custom: boolean; locked: boolean } {
  const rich = (property as { rich_text?: RichPart[] } | undefined)?.rich_text ?? [];
  const text = rich
    .map((part) => part.plain_text ?? "")
    .join("")
    .trim()
    .toUpperCase();
  return {
    text,
    custom: rich.some((part) => part.annotations?.code === true),
    locked: rich.some((part) => part.annotations?.italic === true),
  };
}

function shareCodeRichText(input: ShareCodeWrite): { rich_text: unknown[] } {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return { rich_text: [] };
  // Auto codes omit annotations so both flags stay false. A claim or a lock
  // writes the standard Notion annotation keys explicitly.
  const marked = input.custom || input.locked;
  return {
    rich_text: [
      {
        type: "text",
        text: { content: code },
        ...(marked
          ? {
              annotations: {
                bold: false,
                italic: input.locked,
                strikethrough: false,
                underline: false,
                code: input.custom,
                color: "default",
              },
            }
          : {}),
      },
    ],
  };
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
  const leaderReachedAt = readDate(properties[REFERRAL_COLUMNS.leaderReachedAt]);
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
    ...(leaderReachedAt ? { leaderReachedAt } : {}),
    ...(lead.signupLocale ? { signupLocale: lead.signupLocale } : {}),
    ...(lead.leadId ? { leadId: lead.leadId } : {}),
    ...(lead.signupCountry ? { signupCountry: lead.signupCountry } : {}),
    // Opt-out markers, so an unsubscribe from any mail also stops Buddy Invite
    // mail to that address (notices.ts `optedOutAddresses`).
    ...(lead.launchMail ? { launchMail: lead.launchMail } : {}),
    ...(lead.reservationMail ? { reservationMail: lead.reservationMail } : {}),
    email: lead.email,
    // Only when the cell is a real code. A missing column and an empty cell
    // both leave the keys off, so older rows compare equal to today's parser.
    ...(() => {
      if (!(REFERRAL_COLUMNS.shareCode in properties)) return {};
      const share = readShareCode(properties[REFERRAL_COLUMNS.shareCode]);
      if (!/^[A-Z0-9]{4,12}$/.test(share.text)) return {};
      return {
        shareCode: share.text,
        ...(share.custom ? { shareCodeCustom: true } : {}),
        ...(share.locked ? { shareCodeLocked: true } : {}),
      };
    })(),
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
  options: { clock?: () => number } = {},
): ReferralStore {
  const clock = options.clock ?? Date.now;
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
      const code = normalizeRefCode(refCode);
      if (!code) return undefined;
      const result = await request("POST", `databases/${databaseId}/query`, {
        filter: { property: REFERRAL_COLUMNS.refCode, rich_text: { equals: code } },
        // Codes are unique by construction. On a (never expected) collision the
        // lowest page id answers — the same row the ledger and status page pick.
        page_size: 10,
      });
      const rows = ((result.results as Record<string, unknown>[] | undefined) ?? [])
        .map((raw) => toReferralRow(raw))
        .filter((row): row is NonNullable<typeof row> => Boolean(row && row.refCode === code))
        .sort((a, b) => (a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0));
      return rows[0];
    },

    async findByShareCode(shareCode) {
      const code = shareCode.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(code)) return undefined;
      // A bounded first page is not a uniqueness check: a concurrent winner
      // can be on any page. Resolve the complete set with one stable rule.
      const rows: ReferralRow[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) throw new Error("Share-code rows exceed the page cap");
        const result = await request("POST", `databases/${databaseId}/query`, {
          filter: { property: REFERRAL_COLUMNS.shareCode, rich_text: { equals: code } },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        for (const raw of (result.results as Record<string, unknown>[] | undefined) ?? []) {
          const row = toReferralRow(raw);
          if (row?.shareCode === code) rows.push(row);
        }
        if (!result.has_more) break;
        if (typeof result.next_cursor !== "string" || seen.has(result.next_cursor)) {
          throw new Error("Incomplete share-code lookup");
        }
        cursor = result.next_cursor;
        seen.add(cursor);
      }
      rows.sort((a, b) => a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0);
      return rows[0];
    },

    async writeShareCode(pageId, input) {
      await request("PATCH", `pages/${pageId}`, {
        properties: {
          [REFERRAL_COLUMNS.shareCode]: shareCodeRichText(input),
        },
      });
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
      if (
        input.leaderReachedAt !== undefined &&
        !Number.isFinite(Date.parse(input.leaderReachedAt))
      ) {
        throw new Error("A leader instant must be a valid date");
      }
      await request("PATCH", `pages/${pageId}`, {
        properties: {
          [REFERRAL_COLUMNS.notifiedCount]: { number: input.count },
          [REFERRAL_COLUMNS.notifiedAt]: { date: { start: input.at } },
          // Write-once by the caller's contract: only named when the row's
          // cell was empty in the pass that sent the first Dive Leader notice.
          ...(input.clearLeaderReachedAt
            ? { [REFERRAL_COLUMNS.leaderReachedAt]: { date: null } }
            : input.leaderReachedAt
            ? { [REFERRAL_COLUMNS.leaderReachedAt]: { date: { start: input.leaderReachedAt } } }
            : {}),
        },
      });
    },

    async missingColumns() {
      const cachedAt = schemaOk.get(databaseId);
      if (cachedAt !== undefined && clock() - cachedAt < SCHEMA_CACHE_MS) return [];
      // One database GET returns the property map (names and types), no rows.
      const database = await request("GET", `databases/${databaseId}`);
      const present = new Set(Object.keys((database.properties ?? {}) as Properties));
      const missing = Object.values(REFERRAL_COLUMNS).filter((name) => !present.has(name));
      if (missing.length === 0) schemaOk.set(databaseId, clock());
      else schemaOk.delete(databaseId);
      return missing;
    },
  };
}
