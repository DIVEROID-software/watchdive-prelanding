// Ensures the Buddy Invite columns exist on the waitlist database.
//
//   node --experimental-strip-types --env-file=.env scripts/referral-schema.ts          # plan only
//   node --experimental-strip-types --env-file=.env scripts/referral-schema.ts --apply  # add what is missing
//
// Dry run by default. --apply sends ONE PATCH holding only the missing
// columns (and, for the review select, only missing options), then re-reads
// the schema and verifies. Existing properties are never renamed, retyped or
// removed. If a name already exists with another type the run refuses and
// writes nothing. No row is read; the report holds column names only.
import { pathToFileURL } from "node:url";

import { REFERRAL_COLUMNS } from "../src/lib/referral/contract.ts";
import { createNotionRequest, NotionRequestError } from "../src/lib/verification/notionLead.ts";

const DATABASE_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export const REVIEW_OPTIONS = ["pending", "approved", "rejected"] as const;

export type ReferralColumnSpec = {
  name: string;
  type: "rich_text" | "checkbox" | "number" | "date" | "select";
  options?: readonly string[];
};

/** Only the NEW columns. `Ref code` and `Referred by` already exist and are not ours to touch. */
export const REFERRAL_COLUMN_SPECS: readonly ReferralColumnSpec[] = [
  { name: REFERRAL_COLUMNS.nickname, type: "rich_text" },
  { name: REFERRAL_COLUMNS.leaderboard, type: "checkbox" },
  { name: REFERRAL_COLUMNS.nicknameHidden, type: "checkbox" },
  { name: REFERRAL_COLUMNS.noticesOff, type: "checkbox" },
  { name: REFERRAL_COLUMNS.notifiedCount, type: "number" },
  { name: REFERRAL_COLUMNS.notifiedAt, type: "date" },
  { name: REFERRAL_COLUMNS.rewardReview, type: "select", options: REVIEW_OPTIONS },
  // Write-once (notices.ts); the exact Dive Leader light-order key.
  { name: REFERRAL_COLUMNS.leaderReachedAt, type: "date" },
];

export type ReferralSchemaDatabase = {
  properties?: Record<
    string,
    { type?: string; select?: { options?: { id?: string; name?: string }[] } }
  >;
};

export type ReferralSchemaAction =
  | { op: "add"; name: string; type: string }
  | { op: "extend_select"; name: string; add: string[] }
  | { op: "skip"; name: string };

export type ReferralSchemaPlan = {
  ok: boolean;
  conflicts: { name: string; reason: "wrong_type"; found?: string }[];
  actions: ReferralSchemaAction[];
  /** Notion PATCH body; null when nothing is missing. */
  patch: { properties: Record<string, unknown> } | null;
};

export function planReferralSchema(database: ReferralSchemaDatabase): ReferralSchemaPlan {
  const properties = database.properties ?? {};
  const plan: ReferralSchemaPlan = { ok: true, conflicts: [], actions: [], patch: null };
  const patch: Record<string, unknown> = {};
  for (const spec of REFERRAL_COLUMN_SPECS) {
    const current = properties[spec.name];
    if (!current) {
      plan.actions.push({ op: "add", name: spec.name, type: spec.type });
      patch[spec.name] =
        spec.type === "select"
          ? { select: { options: (spec.options ?? []).map((name) => ({ name })) } }
          : { [spec.type]: spec.type === "number" ? { format: "number" } : {} };
      continue;
    }
    if (current.type !== spec.type) {
      plan.conflicts.push({ name: spec.name, reason: "wrong_type", found: current.type });
      continue;
    }
    if (spec.type === "select") {
      const existing = current.select?.options ?? [];
      const have = new Set(existing.map((option) => option.name));
      const missing = (spec.options ?? []).filter((name) => !have.has(name));
      if (missing.length > 0) {
        plan.actions.push({ op: "extend_select", name: spec.name, add: missing });
        // Keep every existing option (by id) so the PATCH cannot drop one.
        patch[spec.name] = {
          select: {
            options: [
              ...existing.map((option) => (option.id ? { id: option.id } : { name: option.name })),
              ...missing.map((name) => ({ name })),
            ],
          },
        };
        continue;
      }
    }
    plan.actions.push({ op: "skip", name: spec.name });
  }
  plan.ok = plan.conflicts.length === 0;
  plan.patch = plan.ok && Object.keys(patch).length > 0 ? { properties: patch } : null;
  return plan;
}

export type ReferralSchemaReport = {
  apply: boolean;
  ok: boolean;
  applied?: boolean;
  error?: string;
  status?: number;
  plan?: Pick<ReferralSchemaPlan, "actions" | "conflicts" | "patch">;
};

export async function runReferralSchema(input: {
  args: string[];
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ exitCode: number; report: ReferralSchemaReport }> {
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
  let plan: ReferralSchemaPlan;
  try {
    plan = planReferralSchema((await request("GET", path)) as ReferralSchemaDatabase);
  } catch (error) {
    return {
      exitCode: 1,
      report: { apply, ok: false, error: "schema_read_failed", status: error instanceof NotionRequestError ? error.status : undefined },
    };
  }
  const shown = { actions: plan.actions, conflicts: plan.conflicts, patch: plan.patch };
  if (!plan.ok) return { exitCode: 2, report: { apply, ok: false, error: "schema_conflict", plan: shown } };
  if (!apply || !plan.patch) return { exitCode: 0, report: { apply, ok: true, applied: false, plan: shown } };
  try {
    await request("PATCH", path, plan.patch);
    const after = planReferralSchema((await request("GET", path)) as ReferralSchemaDatabase);
    const settled = after.ok && after.patch === null;
    return {
      exitCode: settled ? 0 : 2,
      report: { apply, ok: settled, applied: true, ...(settled ? {} : { error: "verify_failed" }), plan: shown },
    };
  } catch (error) {
    return {
      exitCode: 1,
      report: { apply, ok: false, error: "schema_write_failed", status: error instanceof NotionRequestError ? error.status : undefined, plan: shown },
    };
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  const result = await runReferralSchema({ args: process.argv.slice(2), env: process.env });
  process.stdout.write(`${JSON.stringify(result.report)}\n`);
  process.exitCode = result.exitCode;
}
