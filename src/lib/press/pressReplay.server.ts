// Sends the press reports still owed by waitlist rows (pressAttribution.server.ts).
//
//   Email verified, Press sync = held | pending | accepted  → "confirmed"
//   not verified,   Press sync = pending (social lead write) → "accepted"
//
// Rows marked Duplicate are skipped. A held row that is never verified is never
// reported: a form submission alone is not a signup.
//
// Runs on the existing reminder tick, so it needs no scheduler or secret of its
// own. Bounded by a row count and a time budget; returns counts only.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { FIELD_EMAIL_VERIFIED, FIELD_VERIFIED_AT } from "../verification/contracts.ts";
import {
  FIELD_PRESS_EVENT,
  FIELD_PRESS_SYNC,
  PRESS_SYNC_ACCEPTED,
  PRESS_SYNC_HELD,
  PRESS_SYNC_INVALID,
  PRESS_SYNC_PENDING,
  deliverPressEvent,
  nextPressSync,
  parsePressOutbox,
  pressAttributionEnabled,
  pressEvent,
  setPressSync,
  type PressEnvironment,
  type PressNotionRequest,
  type PressStage,
} from "./pressAttribution.server.ts";

export type PressReplayResult = {
  scanned: number;
  delivered: number;
  ignored: number;
  invalid: number;
  retry: number;
  skipped: boolean;
};

type Row = { id?: unknown; properties?: Record<string, unknown> };

/** Same live checkbox the social flow sets on a losing duplicate row. */
const FIELD_DUPLICATE = "Duplicate";

function readText(property: unknown): string {
  const rich = (property as { rich_text?: { plain_text?: string; text?: { content?: string } }[] } | undefined)?.rich_text;
  return Array.isArray(rich) ? rich.map((part) => part.plain_text ?? part.text?.content ?? "").join("") : "";
}

function readDate(property: unknown): string | undefined {
  const start = (property as { date?: { start?: string } } | undefined)?.date?.start;
  return start && Number.isFinite(Date.parse(start)) ? new Date(start).toISOString() : undefined;
}

function readChecked(property: unknown): boolean {
  return (property as { checkbox?: boolean } | undefined)?.checkbox === true;
}

const syncIs = (state: string) => ({ property: FIELD_PRESS_SYNC, rich_text: { equals: state } });
const verified = (value: boolean) => ({ property: FIELD_EMAIL_VERIFIED, checkbox: { equals: value } });

export async function replayPressOutbox(options: {
  request: PressNotionRequest;
  databaseId: string;
  env?: PressEnvironment;
  fetcher?: typeof fetch;
  maxRows?: number;
  budgetMs?: number;
  now?: () => number;
}): Promise<PressReplayResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? 20_000);
  const maxRows = options.maxRows ?? 100;
  const result: PressReplayResult = { scanned: 0, delivered: 0, ignored: 0, invalid: 0, retry: 0, skipped: false };
  if (!pressAttributionEnabled(env)) return { ...result, skipped: true };

  const passes: { stage: PressStage; filter: unknown }[] = [
    {
      stage: "confirmed",
      filter: { and: [{ or: [syncIs(PRESS_SYNC_HELD), syncIs(PRESS_SYNC_PENDING), syncIs(PRESS_SYNC_ACCEPTED)] }, verified(true)] },
    },
    { stage: "accepted", filter: { and: [syncIs(PRESS_SYNC_PENDING), verified(false)] } },
  ];
  for (const pass of passes) {
    let cursor: string | undefined;
    do {
      if (result.scanned >= maxRows || now() >= deadline) return result;
      const page = await options.request("POST", `databases/${options.databaseId}/query`, {
        filter: pass.filter,
        page_size: 25,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const row of (page.results as Row[] | undefined) ?? []) {
        if (result.scanned >= maxRows || now() >= deadline) return result;
        if (typeof row.id !== "string") continue;
        result.scanned += 1;
        const properties = row.properties ?? {};
        // Read here rather than filtered: the optional column may not exist.
        if (readChecked(properties[FIELD_DUPLICATE])) continue;
        const outbox = parsePressOutbox(readText(properties[FIELD_PRESS_EVENT]));
        if (!outbox) {
          if (await setPressSync(options.request, row.id, PRESS_SYNC_INVALID)) result.invalid += 1;
          continue;
        }
        if (readChecked(properties[FIELD_EMAIL_VERIFIED]) !== (pass.stage === "confirmed")) continue;
        const occurredAt = pass.stage === "accepted"
          ? outbox.signedUpAt
          : readDate(properties[FIELD_VERIFIED_AT]) ?? new Date(now()).toISOString();
        const delivery = await deliverPressEvent(pressEvent(outbox, pass.stage, occurredAt), env, options.fetcher ?? fetch);
        const next = nextPressSync(pass.stage, delivery);
        if (next) await setPressSync(options.request, row.id, next);
        result[delivery] += 1;
      }
      cursor = page.has_more === true && typeof page.next_cursor === "string" ? page.next_cursor : undefined;
    } while (cursor);
  }
  return result;
}
