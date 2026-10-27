import { reservationCanonicalEmail } from "../reservation/emailIdentity.ts";
import { selectAudience, type ReservationRow } from "../reservation-mail/audience.ts";
import type { NotionRequest } from "../verification/notionLead.ts";
import { createNotionReservationStore, FIELD_RESERVATION_MAIL, type ReservationStore } from "../reservation-mail/store.ts";
import { DRIP_FIELD, DRIP_STAGES, dripHold, type DripStage, type DripHistory } from "./policy.ts";

function text(prop: any): string {
  return Array.isArray(prop?.rich_text) ? prop.rich_text.map((part: any) => part.plain_text ?? part.text?.content ?? "").join("") : "";
}
function cell(value: string) { return { type: "rich_text", rich_text: [{ plain_text: value, text: { content: value } }] }; }

/** Adapts a dedicated stage column into the existing proven mail engine.
 * D0 keeps the exact old column and receipt ledger. No new provider is used. */
export function createDripStore(request: NotionRequest, databaseId: string, stage: DripStage, now: () => Date = () => new Date()): ReservationStore & { recheckInbox(row: ReservationRow): Promise<boolean> } {
  function transform(page: any): any {
    if (!page?.properties) return page;
    const properties = { ...page.properties };
    const history = Object.fromEntries(DRIP_STAGES.map(key => [key, text(properties[DRIP_FIELD[key]])])) as DripHistory;
    properties[FIELD_RESERVATION_MAIL] = properties[DRIP_FIELD[stage]] ?? cell("");
    // Global history holds include opt-out in the legacy D0 column. Never
    // overwrite or clear real markers; only this in-memory eligibility view.
    if (dripHold(stage, history, now().getTime())) properties[FIELD_RESERVATION_MAIL] = cell("drip history hold");
    return { ...page, properties };
  }
  const adapter: NotionRequest = async (method, path, body) => {
    if (method === "PATCH" && path.startsWith("pages/")) {
      const input = body as { properties?: Record<string, unknown> };
      if (Object.keys(input?.properties ?? {}).length !== 1 || !(FIELD_RESERVATION_MAIL in (input?.properties ?? {}))) throw new Error("Unexpected drip write");
      return request(method, path, { properties: { [DRIP_FIELD[stage]]: input.properties![FIELD_RESERVATION_MAIL] } });
    }
    const response = await request(method, path, body);
    if (method === "GET" && path.startsWith("databases/")) {
      const properties = { ...response.properties as Record<string, unknown> };
      const missing = DRIP_STAGES.some(key => (properties[DRIP_FIELD[key]] as any)?.type !== "rich_text");
      if (missing) delete properties[FIELD_RESERVATION_MAIL];
      else properties[FIELD_RESERVATION_MAIL] = properties[DRIP_FIELD[stage]];
      return { ...response, properties };
    }
    if (Array.isArray(response.results)) return { ...response, results: response.results.map(transform) };
    return transform(response);
  };
  const base = createNotionReservationStore(adapter, databaseId);
  let knownAliases = new Map<string, string[]>();
  return {
    ...base,
    async listRows(schema) {
      const rows = await base.listRows(schema);
      knownAliases = new Map();
      for (const row of rows) {
        const key = reservationCanonicalEmail(row.email);
        const ids = knownAliases.get(key) ?? [];
        ids.push(row.pageId);
        knownAliases.set(key, ids);
      }
      return rows;
    },
    async recheckInbox(row) {
      const key = reservationCanonicalEmail(row.email);
      const ids = knownAliases.get(key);
      if (!ids?.includes(row.pageId)) return false;
      const fresh = await Promise.all(ids.map(id => base.readRow(id)));
      if (fresh.some(item => !item || reservationCanonicalEmail(item.email) !== key)) return false;
      // Refresh every known alias before each provider call, not only the
      // selected row. No cross-provider transaction is implied.
      return selectAudience(fresh as ReservationRow[]).recipients.length > 0;
    },
  };
}
