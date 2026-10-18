// Notion view of the waitlist for the reservation invitation. Same access as
// verification (`createNotionRequest`). Phone and SMS consent are not read.
// `Signup country` is read only as a language hint. A missing column is safe.
// This store never creates that column and never backfills a blank cell.
// The legacy `Country` select is not a signup country and is not read.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { matchLocale } from "../i18n/locale.ts";
import {
  FIELD_EMAIL_VERIFIED,
  FIELD_LANDING_PATH,
  FIELD_LEAD_ID,
  FIELD_SIGNUP_COUNTRY,
  FIELD_SUSPECT,
  FIELD_VERIFICATION_STATUS,
} from "../verification/contracts.ts";
import type { NotionRequest } from "../verification/notionLead.ts";
import {
  FIELD_BROWSER_LANGUAGE,
  FIELD_DUPLICATE,
  FIELD_LAUNCH_MAIL,
} from "../launchMail/audience.ts";
import type { ReservationRow } from "./audience.ts";

export const FIELD_RESERVATION_MAIL = "Reservation mail";
/** Optional. The mail worker does not create this column. */
export const FIELD_SIGNUP_LOCALE = "Signup locale";

export const REQUIRED_EXISTING_PROPERTIES = [
  "Email",
  FIELD_VERIFICATION_STATUS,
  FIELD_EMAIL_VERIFIED,
  FIELD_SUSPECT,
  FIELD_LEAD_ID,
] as const;

export const MAX_AUDIENCE_PAGES = 500;

export type ReservationSchema = {
  reservationMail: "ok" | "missing" | "wrong_type";
  launchMail: "ok" | "missing" | "wrong_type";
  missingRequired: string[];
  duplicateType?: string;
  hasBrowserLanguage: boolean;
  /** `Signup country` rich text is present. Cell values are a language hint only. */
  hasCountryProperty: boolean;
  /** Present or not. Cell values are never read. */
  hasSmsConsentProperty: boolean;
  /** Present or not. Cell values are never read. */
  hasPhoneProperty: boolean;
};

export interface ReservationStore {
  readSchema(): Promise<ReservationSchema>;
  listRows(schema: ReservationSchema): Promise<ReservationRow[]>;
  recordReservationMail(pageId: string, value: string): Promise<void>;
}

function plain(property: unknown): string {
  const value = property as
    | {
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

export function toReservationRow(page: Record<string, unknown>): ReservationRow | undefined {
  const pageId = typeof page.id === "string" ? page.id : "";
  if (!pageId) return undefined;
  const properties = (page.properties ?? {}) as Record<string, unknown>;
  const duplicate = bool(properties[FIELD_DUPLICATE]);
  const landingPath = plain(properties[FIELD_LANDING_PATH]);
  const browserLanguage = plain(properties[FIELD_BROWSER_LANGUAGE]);
  const launchMail = plain(properties[FIELD_LAUNCH_MAIL]);
  const reservationMail = plain(properties[FIELD_RESERVATION_MAIL]);
  const explicitLocale = matchLocale(plain(properties[FIELD_SIGNUP_LOCALE]));
  const signupCountry = savedCountry(plain(properties[FIELD_SIGNUP_COUNTRY]));
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
    ...(explicitLocale ? { locale: explicitLocale } : {}),
    ...(signupCountry ? { signupCountry } : {}),
    ...(launchMail ? { launchMail } : {}),
    ...(reservationMail ? { reservationMail } : {}),
  };
}

/** A stored country cell, or nothing. Free text is dropped so it cannot ride along. */
function savedCountry(value: string): string | undefined {
  const code = value.trim().toUpperCase();
  if (code === "UNKNOWN") return "unknown";
  if (/^[A-Z]{2}$/.test(code)) return code;
  return undefined;
}

function textProp(value: string) {
  return { rich_text: [{ text: { content: value.slice(0, 1900) } }] };
}

function propertyState(
  properties: Record<string, { type?: string }>,
  name: string,
): "ok" | "missing" | "wrong_type" {
  const property = properties[name];
  if (!property) return "missing";
  return property.type === "rich_text" ? "ok" : "wrong_type";
}

export function createNotionReservationStore(
  request: NotionRequest,
  databaseId: string,
): ReservationStore {
  return {
    async readSchema() {
      const database = await request("GET", `databases/${databaseId}`);
      const properties = (database.properties ?? {}) as Record<string, { type?: string }>;
      return {
        reservationMail: propertyState(properties, FIELD_RESERVATION_MAIL),
        launchMail: propertyState(properties, FIELD_LAUNCH_MAIL),
        missingRequired: REQUIRED_EXISTING_PROPERTIES.filter((name) => !properties[name]),
        ...(properties[FIELD_DUPLICATE]
          ? { duplicateType: properties[FIELD_DUPLICATE].type ?? "unknown" }
          : {}),
        hasBrowserLanguage: Boolean(properties[FIELD_BROWSER_LANGUAGE]),
        hasCountryProperty: properties[FIELD_SIGNUP_COUNTRY]?.type === "rich_text",
        hasSmsConsentProperty: Boolean(properties["SMS consent"]),
        hasPhoneProperty: Boolean(properties.Phone),
      };
    },

    async listRows() {
      const rows: ReservationRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; ; page++) {
        if (page >= MAX_AUDIENCE_PAGES)
          throw new Error("Reservation audience exceeds the page cap");
        const result = await request("POST", `databases/${databaseId}/query`, {
          // No status filter: suppressed and unsubscribed rows must be visible
          // so a second row of the same address cannot slip through.
          sorts: [{ timestamp: "created_time", direction: "ascending" }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        for (const raw of (result.results as Record<string, unknown>[] | undefined) ?? []) {
          const row = toReservationRow(raw);
          if (row) rows.push(row);
        }
        if (!result.has_more || typeof result.next_cursor !== "string") break;
        cursor = result.next_cursor;
      }
      return rows;
    },

    async recordReservationMail(pageId, value) {
      if (!value.trim()) throw new Error("A reservation-mail record must never clear the cell");
      await request("PATCH", `pages/${pageId}`, {
        properties: { [FIELD_RESERVATION_MAIL]: textProp(value) },
      });
    },
  };
}
