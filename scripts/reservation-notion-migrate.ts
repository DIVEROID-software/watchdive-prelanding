// Adds the reservation columns to the existing signup database.
// Default is a dry run. --apply writes the schema only, never a page.
// Root runs this. It refuses to apply unless --database-id matches
// NOTION_WAITLIST_DB_ID. The report has no API key and no row contents.
import { pathToFileURL } from "node:url";

import { createNotionRequest, NotionRequestError } from "../src/lib/verification/notionLead.ts";
import {
  NOTION_DATABASE_ID,
  planReservationNotionSchema,
  type NotionDatabaseSchema,
  type SchemaPlan,
} from "../src/lib/reservation/notionSchema.ts";

export type MigrationReport = {
  apply: boolean;
  ok: boolean;
  error?: string;
  status?: number;
  actions?: SchemaPlan["actions"];
  conflicts?: SchemaPlan["conflicts"];
  wouldWrite?: boolean;
  applied?: boolean;
};

export function parseMigrateArgs(argv: string[]): { apply: boolean; databaseId: string | null } | { error: string } {
  let apply = false;
  let databaseId: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      apply = false;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--database-id") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) return { error: "missing_database_id" };
      databaseId = value;
      index += 1;
      continue;
    }
    return { error: "unknown_argument" };
  }
  return { apply, databaseId };
}

function publicReport(report: MigrationReport): MigrationReport {
  return report;
}

export async function runReservationNotionMigration(input: {
  args: string[];
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ exitCode: number; report: MigrationReport }> {
  const parsed = parseMigrateArgs(input.args);
  if ("error" in parsed) return { exitCode: 1, report: { apply: false, ok: false, error: parsed.error } };

  const databaseId = (input.env.NOTION_WAITLIST_DB_ID ?? "").trim();
  const key = (input.env.NOTION_API_KEY ?? "").trim();
  if (!key || !NOTION_DATABASE_ID.test(databaseId)) {
    return { exitCode: 1, report: { apply: parsed.apply, ok: false, error: "misconfigured" } };
  }
  if (parsed.apply && parsed.databaseId !== databaseId) {
    return { exitCode: 1, report: { apply: true, ok: false, error: "database_id_mismatch" } };
  }

  const request = createNotionRequest(input.fetchImpl, input.env);
  let database: NotionDatabaseSchema;
  try {
    database = (await request("GET", `databases/${encodeURIComponent(databaseId)}`)) as NotionDatabaseSchema;
  } catch (error) {
    const status = error instanceof NotionRequestError ? error.status : undefined;
    return { exitCode: 1, report: { apply: parsed.apply, ok: false, error: "schema_read_failed", status } };
  }

  const plan = planReservationNotionSchema(database);
  if (plan.conflicts.length > 0) {
    return {
      exitCode: 2,
      report: {
        apply: parsed.apply,
        ok: false,
        error: "schema_conflict",
        actions: plan.actions,
        conflicts: plan.conflicts,
        wouldWrite: false,
        applied: false,
      },
    };
  }

  if (!parsed.apply || !plan.patch) {
    return {
      exitCode: 0,
      report: publicReport({
        apply: parsed.apply,
        ok: true,
        actions: plan.actions,
        conflicts: [],
        wouldWrite: plan.patch !== null,
        applied: false,
      }),
    };
  }

  try {
    await request("PATCH", `databases/${encodeURIComponent(databaseId)}`, { properties: plan.patch });
  } catch (error) {
    const status = error instanceof NotionRequestError ? error.status : undefined;
    return { exitCode: 1, report: { apply: true, ok: false, error: "schema_write_failed", status, applied: false } };
  }
  return {
    exitCode: 0,
    report: {
      apply: true,
      ok: true,
      actions: plan.actions,
      conflicts: [],
      wouldWrite: true,
      applied: true,
    },
  };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const result = await runReservationNotionMigration({ args: process.argv.slice(2), env: process.env });
  console.log(JSON.stringify(result.report));
  process.exit(result.exitCode);
}
