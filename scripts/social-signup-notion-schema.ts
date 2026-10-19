// Dry-run planner for the additive social signup columns.
// --apply is refused. This process never PATCHes Notion and never reads rows.
import { pathToFileURL } from "node:url";

import { createNotionRequest, NotionRequestError } from "../src/lib/verification/notionLead.ts";
import {
  planSocialSignupNotionSchema,
  type SocialSchemaDatabase,
  type SocialSchemaPlan,
} from "../src/lib/socialAuth/notionSchema.ts";

const DATABASE_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export type SocialSchemaReport = {
  apply: false;
  ok: boolean;
  error?: string;
  status?: number;
  plan?: Pick<SocialSchemaPlan, "actions" | "conflicts" | "patch">;
};

export function parseSocialSchemaArgs(argv: string[]): { error?: string } {
  for (const arg of argv) {
    if (arg === "--apply") return { error: "refused_apply" };
    if (arg === "--dry-run") continue;
    return { error: "unknown_argument" };
  }
  return {};
}

export async function runSocialSignupNotionSchema(input: {
  args: string[];
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ exitCode: number; report: SocialSchemaReport }> {
  const parsed = parseSocialSchemaArgs(input.args);
  if (parsed.error === "refused_apply") {
    return { exitCode: 2, report: { apply: false, ok: false, error: "refused_apply" } };
  }
  if (parsed.error) return { exitCode: 1, report: { apply: false, ok: false, error: parsed.error } };

  const databaseId = (input.env.NOTION_WAITLIST_DB_ID ?? "").trim();
  const key = (input.env.NOTION_API_KEY ?? "").trim();
  if (!key || !DATABASE_ID.test(databaseId)) {
    return { exitCode: 1, report: { apply: false, ok: false, error: "misconfigured" } };
  }

  const request = createNotionRequest(input.fetchImpl, input.env);
  let database: SocialSchemaDatabase;
  try {
    database = (await request("GET", `databases/${encodeURIComponent(databaseId)}`)) as SocialSchemaDatabase;
  } catch (error) {
    const status = error instanceof NotionRequestError ? error.status : undefined;
    return { exitCode: 1, report: { apply: false, ok: false, error: "schema_read_failed", status } };
  }

  const plan = planSocialSignupNotionSchema(database);
  return {
    exitCode: plan.ok ? 0 : 2,
    report: {
      apply: false,
      ok: plan.ok,
      ...(plan.ok ? {} : { error: "schema_conflict" }),
      plan: { actions: plan.actions, conflicts: plan.conflicts, patch: plan.patch },
    },
  };
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  const result = await runSocialSignupNotionSchema({ args: process.argv.slice(2), env: process.env });
  process.stdout.write(`${JSON.stringify(result.report)}\n`);
  process.exitCode = result.exitCode;
}
