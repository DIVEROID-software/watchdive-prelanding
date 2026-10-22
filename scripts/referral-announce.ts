// Office-only HTTP caller: no Notion, Resend or verification signing secret.
import { readFile, open, unlink } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { REFERRAL_PROGRAM_ID } from "../src/lib/referral/program.ts";

const ENDPOINT = "https://watchdive.diveroid.com/api/cron/referral-announce";
export const USAGE = `Usage: node --experimental-strip-types scripts/referral-announce.ts
  --config <private.json>      {"secret":"<reminder cron bearer secret>"}; chmod 600
  --released-at <ISO>          fixed program release instant
  --confirm ${REFERRAL_PROGRAM_ID} (required even for dry-run)
  [--dry-run]                  default; counts only
  [--apply] [--limit <1..200>]  default 20; re-run for remaining batches
  [--only <email>]             owner self-test; writes no marker; an existing marker still holds
Only the office Mac mini may run this caller. Never overlap it with a direct API call.`;

export async function main(argv: string[]): Promise<number> {
  let lock: string | undefined;
  let completed = false;
  try {
    const { values } = parseArgs({ args: argv, options: {
      config: { type: "string" }, "released-at": { type: "string" }, confirm: { type: "string" },
      limit: { type: "string" }, only: { type: "string" }, apply: { type: "boolean" },
      "dry-run": { type: "boolean" }, help: { type: "boolean" },
    } });
    if (values.help) { console.log(USAGE); return 0; }
    const limit = Number(values.limit ?? 20);
    if (!values.config || !values["released-at"] || !Number.isFinite(Date.parse(values["released-at"]))
      || values.confirm !== REFERRAL_PROGRAM_ID || !Number.isInteger(limit) || limit < 1 || limit > 200
      || (values.apply && values["dry-run"])) { console.error(USAGE); return 1; }
    const config = JSON.parse(await readFile(values.config, "utf8"));
    if (typeof config.secret !== "string" || config.secret.trim().length < 16) throw new Error("config");
    const lockPath = `${values.config}.referral-announce.lock`;
    const handle = await open(lockPath, "wx", 0o600);
    lock = lockPath;
    await handle.close();
    const response = await fetch(ENDPOINT, { method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${config.secret.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ releasedAt: values["released-at"], confirm: values.confirm,
        mode: values.apply ? "apply" : "dry-run", limit, only: values.only }),
    });
    const result = await response.json();
    // Never echo arbitrary server content, email, token or error text.
    const counts = Object.fromEntries(["rowsScanned", "eligible", "alreadySent", "heldUnresolved", "planned", "sent", "failed", "deferred", "senderPhoneMissing"]
      .filter((key) => typeof result[key] === "number").map((key) => [key, result[key]]));
    completed = true;
    console.log(JSON.stringify({ ok: response.ok && result.ok === true, ...counts }));
    return response.ok && result.ok === true && !result.failed && !result.heldUnresolved ? 0 : 2;
  } catch {
    console.error("Request failed, refused, or outcome unknown; reconcile server receipts before clearing any retained operator lock.");
    return 1;
  } finally {
    // Unknown HTTP outcome retains the lock so an operator must reconcile it.
    if (lock && completed) await unlink(lock);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
