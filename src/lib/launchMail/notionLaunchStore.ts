// The launch mail's view of the Notion waitlist database. Same access as the
// verification flow (`createNotionRequest`, NOTION_API_KEY,
// NOTION_WAITLIST_DB_ID), same exact live column names.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import {
  FIELD_EMAIL_VERIFIED,
  FIELD_LANDING_PATH,
  FIELD_LEAD_ID,
  FIELD_SUSPECT,
  FIELD_VERIFICATION_STATUS,
  STATUS_VERIFIED,
} from "../verification/contracts.ts";
import type { NotionRequest } from "../verification/notionLead.ts";
import {
  FIELD_BROWSER_LANGUAGE,
  FIELD_DUPLICATE,
  FIELD_LAUNCH_MAIL,
  type LaunchRow,
} from "./audience.ts";

/** Columns the audience filter cannot work without. */
export const REQUIRED_EXISTING_PROPERTIES = [
  "Email",
  FIELD_VERIFICATION_STATUS,
  FIELD_EMAIL_VERIFIED,
  FIELD_SUSPECT,
  FIELD_LEAD_ID,
] as const;

export type LaunchSchema = {
  /** `missing` / `wrong_type` both mean: refuse to send. */
  launchMail: "ok" | "missing" | "wrong_type";
  missingRequired: string[];
  /** Type of the optional `Duplicate` column, if the database has one. */
  duplicateType?: string;
  hasBrowserLanguage: boolean;
};

/** 100 rows per page; well above any plausible waitlist, small enough to bound a run. */
export const MAX_AUDIENCE_PAGES = 500;

export interface LaunchStore {
  readSchema(): Promise<LaunchSchema>;
  listAudienceRows(schema: LaunchSchema): Promise<LaunchRow[]>;
  recordLaunchMail(pageId: string, value: string): Promise<void>;
  reread(pageId: string): Promise<LaunchRow | undefined>;
  findByLeadId(leadId: string): Promise<LaunchRow | undefined>;
}

function plain(property: unknown): string {
  const value = property as
    | {
        type?: string;
        rich_text?: { plain_text?: string }[];
        title?: { plain_text?: string }[];
        select?: { name?: string } | null;
      }
    | undefined;
  if (!value) return "";
  if (value.title) return value.title.map((part) => part.plain_text ?? "").join("");
  if (value.rich_text) return value.rich_text.map((part) => part.plain_text ?? "").join("");
  if (value.select) return value.select.name ?? "";
  return "";
}

function bool(property: unknown): boolean | undefined {
  const value = property as { checkbox?: boolean; formula?: { boolean?: boolean } } | undefined;
  if (!value) return undefined;
  if (typeof value.checkbox === "boolean") return value.checkbox;
  if (typeof value.formula?.boolean === "boolean") return value.formula.boolean;
  return undefined;
}

export function toLaunchRow(page: Record<string, unknown>): LaunchRow | undefined {
  const pageId = typeof page.id === "string" ? page.id : "";
  if (!pageId) return undefined;
  const properties = (page.properties ?? {}) as Record<string, unknown>;
  const duplicate = bool(properties[FIELD_DUPLICATE]);
  const landingPath = plain(properties[FIELD_LANDING_PATH]);
  const browserLanguage = plain(properties[FIELD_BROWSER_LANGUAGE]);
  const launchMail = plain(properties[FIELD_LAUNCH_MAIL]);
  return {
    pageId,
    email: plain(properties.Email).trim(),
    leadId: plain(properties[FIELD_LEAD_ID]).trim(),
    status: plain(properties[FIELD_VERIFICATION_STATUS]),
    emailVerified: bool(properties[FIELD_EMAIL_VERIFIED]) ?? false,
    suspect: bool(properties[FIELD_SUSPECT]) ?? false,
    ...(duplicate === undefined ? {} : { duplicate }),
    ...(landingPath ? { landingPath } : {}),
    ...(browserLanguage ? { browserLanguage } : {}),
    ...(launchMail ? { launchMail } : {}),
  };
}

function textProp(value: string) {
  return { rich_text: [{ text: { content: value.slice(0, 1900) } }] };
}

export function createNotionLaunchStore(request: NotionRequest, databaseId: string): LaunchStore {
  return {
    async readSchema() {
      const database = await request("GET", `databases/${databaseId}`);
      const properties = (database.properties ?? {}) as Record<string, { type?: string }>;
      const launch = properties[FIELD_LAUNCH_MAIL];
      return {
        launchMail: !launch ? "missing" : launch.type === "rich_text" ? "ok" : "wrong_type",
        missingRequired: REQUIRED_EXISTING_PROPERTIES.filter((name) => !properties[name]),
        ...(properties[FIELD_DUPLICATE]
          ? { duplicateType: properties[FIELD_DUPLICATE].type ?? "unknown" }
          : {}),
        hasBrowserLanguage: Boolean(properties[FIELD_BROWSER_LANGUAGE]),
      };
    },

    async listAudienceRows(schema) {
      const filter = {
        and: [
          { property: FIELD_VERIFICATION_STATUS, select: { equals: STATUS_VERIFIED } },
          { property: FIELD_EMAIL_VERIFIED, checkbox: { equals: true } },
          { property: FIELD_SUSPECT, checkbox: { equals: false } },
          // A non-checkbox Duplicate (e.g. a formula) is still read per row.
          ...(schema.duplicateType === "checkbox"
            ? [{ property: FIELD_DUPLICATE, checkbox: { equals: false } }]
            : []),
        ],
      };
      const rows: LaunchRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; ; page++) {
        if (page >= MAX_AUDIENCE_PAGES) throw new Error("Launch audience exceeds the page cap");
        const result = await request("POST", `databases/${databaseId}/query`, {
          filter,
          // Oldest confirmations first: the earliest supporters hear first.
          sorts: [{ timestamp: "created_time", direction: "ascending" }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        for (const raw of (result.results as Record<string, unknown>[] | undefined) ?? []) {
          const row = toLaunchRow(raw);
          if (row) rows.push(row);
        }
        if (!result.has_more || typeof result.next_cursor !== "string") break;
        cursor = result.next_cursor;
      }
      return rows;
    },

    async recordLaunchMail(pageId, value) {
      if (!value.trim()) throw new Error("A launch-mail record must never clear the cell");
      await request("PATCH", `pages/${pageId}`, {
        properties: { [FIELD_LAUNCH_MAIL]: textProp(value) },
      });
    },

    async reread(pageId) {
      return toLaunchRow(await request("GET", `pages/${pageId}`));
    },

    async findByLeadId(leadId) {
      const result = await request("POST", `databases/${databaseId}/query`, {
        filter: { property: FIELD_LEAD_ID, rich_text: { equals: leadId } },
        page_size: 1,
      });
      const first = (result.results as Record<string, unknown>[] | undefined)?.[0];
      return first ? toLaunchRow(first) : undefined;
    },
  };
}
