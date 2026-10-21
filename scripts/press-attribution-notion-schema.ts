// Checks, and on request adds, the two press attribution columns of the
// waitlist database (`Press event`, `Press sync`, both rich_text).
//
//   node --experimental-strip-types scripts/press-attribution-notion-schema.ts          # check only
//   node --experimental-strip-types scripts/press-attribution-notion-schema.ts --apply  # add what is missing
//
// --apply sends one PATCH holding only the missing columns, so every existing
// column and row is left as it is. It refuses when either name already exists
// with another type. No row is read; the report holds column names only.
import { pathToFileURL } from "node:url";

import { createNotionRequest, NotionRequestError } from "../src/lib/verification/notionLead.ts";
import { planPressNotionSchema, type PressSchemaDatabase, type PressSchemaPlan } from "../src/lib/press/pressNotionSchema.ts";

const DATABASE_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export type PressSchemaReport = {
  apply: boolean;
  ok: boolean;
  applied?: boolean;
  error?: string;
  status?: number;
  plan?: Pick<PressSchemaPlan, "actions" | "conflicts" | "patch">;
};

export async function runPressNotionSchema(input: {
  args: string[];
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ exitCode: number; report: PressSchemaReport }> {
  let apply = false;
  for (const arg of input.args) {
    if (arg === "--apply") apply = true;
    else if (arg !== "--dry-run") return { exitCode: 1, report: { apply, ok: false, error: "unknown_argument" } };
  }
  const databaseId = (input.env.NOTION_WAITLIST_DB_ID ?? "").trim();
  if (!(input.env.NOTION_API_KEY ?? "").trim() || !DATABASE_ID.test(databaseId)) {
    return { exitCode: 1, report: { apply, ok: false, error: "misconfigured" } };
  }
  const request = createNotionRequest(input.fetchImpl, input.env);
  const path = `databases/${encodeURIComponent(databaseId)}`;
  let plan: PressSchemaPlan;
  try {
    plan = planPressNotionSchema((await request("GET", path)) as PressSchemaDatabase);
  } catch (error) {
    return { exitCode: 1, report: { apply, ok: false, error: "schema_read_failed", status: error instanceof NotionRequestError ? error.status : undefined } };
  }
  const shown = { actions: plan.actions, conflicts: plan.conflicts, patch: plan.patch };
  if (!plan.ok) return { exitCode: 2, report: { apply, ok: false, error: "schema_conflict", plan: shown } };
  if (!apply || !plan.patch) return { exitCode: 0, report: { apply, ok: true, applied: false, plan: shown } };
  try {
    await request("PATCH", path, plan.patch);
    const after = planPressNotionSchema((await request("GET", path)) as PressSchemaDatabase);
    const settled = after.ok && after.patch === null;
    return { exitCode: settled ? 0 : 2, report: { apply, ok: settled, applied: true, ...(settled ? {} : { error: "verify_failed" }), plan: shown } };
  } catch (error) {
    return { exitCode: 1, report: { apply, ok: false, error: "schema_write_failed", status: error instanceof NotionRequestError ? error.status : undefined, plan: shown } };
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  const result = await runPressNotionSchema({ args: process.argv.slice(2), env: process.env });
  process.stdout.write(`${JSON.stringify(result.report)}\n`);
  process.exitCode = result.exitCode;
}
