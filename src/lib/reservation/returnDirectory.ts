// Reads signup rows for the return form. It does not create a row, and it
// does not write Lead ID, Verified at, payment, or mail markers.
import { canonicalEmailFilters, withCanonicalEmailShape } from "../api/notionCanonicalEmail.ts";
import { canonicalEmail } from "../api/abuse.ts";
import { toReservationRow } from "../reservation-mail/store.ts";
import { RESERVATION_NOTION } from "./notionSchema.ts";
import { readReservationNotionView } from "./notionMirror.ts";
import type { NotionRequest } from "../verification/notionLead.ts";
import { reservationCanonicalEmail } from "./emailIdentity.ts";
import type { ReturnAccount } from "./returnEligibility.ts";

const FLAGS = "Flags";

export function toReturnAccount(page: Record<string, unknown>): ReturnAccount | undefined {
  const row = toReservationRow(page);
  if (!row) return undefined;
  const properties = (page.properties ?? {}) as Record<string, unknown>;
  const mirror = readReservationNotionView(page as { properties?: Record<string, unknown> }, "live");
  const disputeName = selectName(properties[RESERVATION_NOTION.dispute]);
  return {
    leadId: row.leadId,
    email: row.email,
    status: row.status,
    emailVerified: row.emailVerified,
    suspect: row.suspect,
    duplicate: row.duplicate === true,
    flags: readFlags(properties[FLAGS]),
    ...(row.launchMail ? { launchMail: row.launchMail } : {}),
    ...(row.reservationMail ? { reservationMail: row.reservationMail } : {}),
    ...(row.landingPath ? { landingPath: row.landingPath } : {}),
    ...(row.browserLanguage ? { browserLanguage: row.browserLanguage } : {}),
    ...(row.locale ? { locale: row.locale } : {}),
    ...(row.signupCountry ? { signupCountry: row.signupCountry } : {}),
    ...(row.verifiedAt ? { verifiedAt: row.verifiedAt } : {}),
    payment: row.payment ?? "absent",
    mirrorStatus: mirror.status,
    refundedCents: mirror.refundedCents,
    refundPendingCents: mirror.refundPendingCents,
    dispute: disputeName,
  };
}

export function createReservationReturnDirectory(
  request: NotionRequest,
  databaseId: string,
): { list(email: string): Promise<ReturnAccount[]> } {
  return {
    async list(email: string) {
      const id = databaseId.trim();
      if (!id) return [];
      const reservationKey = reservationCanonicalEmail(email);
      const abuseKey = canonicalEmail(email);
      const rows: ReturnAccount[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 3; page += 1) {
        const result = await withCanonicalEmailShape(() =>
          request("POST", `databases/${id}/query`, {
            filter: {
              or: [
                ...canonicalEmailFilters(reservationKey),
                ...(abuseKey === reservationKey ? [] : canonicalEmailFilters(abuseKey)),
                { property: "Email", title: { equals: email } },
              ],
            },
            page_size: 25,
            ...(cursor ? { start_cursor: cursor } : {}),
          }),
        );
        const results = Array.isArray(result.results) ? result.results : [];
        for (const raw of results) {
          if (!raw || typeof raw !== "object") continue;
          const account = toReturnAccount(raw as Record<string, unknown>);
          if (account) rows.push(account);
        }
        if (result.has_more !== true || typeof result.next_cursor !== "string") return rows;
        cursor = result.next_cursor;
      }
      throw new Error("return_lookup_truncated");
    },
  };
}

function readFlags(property: unknown): string[] {
  const options = (property as { multi_select?: { name?: string }[] } | undefined)?.multi_select;
  if (!Array.isArray(options)) return [];
  return options.map((option) => option.name ?? "").filter((name) => name.length > 0);
}

function selectName(property: unknown): string | null {
  if (property === undefined || property === null || typeof property !== "object") return null;
  const select = (property as { select?: unknown }).select;
  if (select === null || select === undefined) return null;
  if (typeof select !== "object") return null;
  const name = (select as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name : null;
}
