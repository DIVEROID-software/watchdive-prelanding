import type { PushRetentionRow, PushDirectory } from "./notion.server.ts";
import type { PushStatus } from "./schema.ts";

export type PushRetentionPlan = {
  ok: true;
  expire: string[];
  archive: { id: string; status: Exclude<PushStatus, "active"> }[];
};

const DAY = 86_400_000;

export function planPushRetention(
  rows: PushRetentionRow[],
  now: Date,
  retentionDays: number,
): PushRetentionPlan | { ok: false; reason: "retention_unconfigured" } {
  if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 365) {
    return { ok: false, reason: "retention_unconfigured" };
  }
  const cutoff = now.getTime() - retentionDays * DAY;
  const expire: string[] = [];
  const archive: PushRetentionPlan["archive"] = [];
  for (const row of rows) {
    if (row.status === "active") {
      const expires = row.expiresAt ? Date.parse(row.expiresAt) : Number.NaN;
      if (Number.isFinite(expires) && expires <= now.getTime()) expire.push(row.id);
      continue;
    }
    const updated = row.updatedAt ? Date.parse(row.updatedAt) : Number.NaN;
    if (!Number.isFinite(updated) || updated > cutoff) continue;
    archive.push({ id: row.id, status: row.status });
  }
  return { ok: true, expire, archive };
}

export async function applyPushRetention(
  directory: PushDirectory,
  plan: PushRetentionPlan,
): Promise<void> {
  for (const id of plan.expire) await directory.setStatus(id, "expired", false);
  for (const row of plan.archive) await directory.setStatus(row.id, row.status, true);
}
