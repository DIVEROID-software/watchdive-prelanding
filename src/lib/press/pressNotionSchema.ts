// The two additive waitlist columns press attribution needs. Planning only:
// nothing here writes, and no row is ever read.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { FIELD_PRESS_EVENT, FIELD_PRESS_SYNC } from "./pressAttribution.server.ts";

export const PRESS_RICH_TEXT_FIELDS = [FIELD_PRESS_EVENT, FIELD_PRESS_SYNC] as const;

export type PressSchemaDatabase = {
  properties?: Record<string, { type?: string }>;
};

export type PressSchemaPlan = {
  ok: boolean;
  conflicts: { name: string; reason: "wrong_type" }[];
  actions: ({ op: "skip"; name: string } | { op: "add"; name: string; property: { rich_text: Record<string, never> } })[];
  /** Additions only; absent when both columns already exist as rich_text. */
  patch: { properties: Record<string, { rich_text: Record<string, never> }> } | null;
};

export function planPressNotionSchema(database: PressSchemaDatabase): PressSchemaPlan {
  const properties = database.properties ?? {};
  const plan: PressSchemaPlan = { ok: true, conflicts: [], actions: [], patch: null };
  const additions: Record<string, { rich_text: Record<string, never> }> = {};
  for (const name of PRESS_RICH_TEXT_FIELDS) {
    const current = properties[name];
    if (!current) {
      const property = { rich_text: {} as Record<string, never> };
      plan.actions.push({ op: "add", name, property });
      additions[name] = property;
    } else if (current.type !== "rich_text") {
      plan.conflicts.push({ name, reason: "wrong_type" });
    } else {
      plan.actions.push({ op: "skip", name });
    }
  }
  plan.ok = plan.conflicts.length === 0;
  plan.patch = Object.keys(additions).length > 0 ? { properties: additions } : null;
  return plan;
}
