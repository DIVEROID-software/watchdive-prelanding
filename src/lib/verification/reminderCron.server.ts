// Server-only assembly of the office Mac mini confirmation-reminder tick.
//
// Reached solely from the cron route, so the Notion, Resend, Slack and cron
// secrets have no path into a client bundle.
import { createBehaviorNotion } from "../api/behaviorNotion.ts";
import { checkCronAuthorization } from "./cronAuth.ts";
import { createNotionReminderStore, createNotionRequest } from "./notionLead.ts";
import { replayPressOutbox } from "../press/pressReplay.server.ts";
import { runVerificationReminders } from "./reminder.ts";
import { createResendMailer } from "./resend.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function handleVerificationReminderCron(request: Request): Promise<Response> {
  const auth = checkCronAuthorization(
    request.headers.get("authorization"),
    process.env.WATCHDIVE_REMINDER_CRON_SECRET,
  );
  if (auth === "not_configured") {
    console.error("[watchdive] verification_reminder_refused", { reason: "cron_secret_not_set" });
    return json(503, { ok: false });
  }
  if (auth !== "authorized") return json(401, { ok: false });

  const params = new URL(request.url).searchParams;
  const dryRun = params.get("mode") === "dry-run";
  const maintenance = !dryRun && params.get("maintenance") === "1";
  const databaseId = process.env.NOTION_WAITLIST_DB_ID;
  if (!databaseId) return json(503, { ok: false });

  let result;
  try {
    result = await runVerificationReminders({
      store: createNotionReminderStore(createNotionRequest(), databaseId),
      mailer: createResendMailer(),
      dryRun,
      skipUnsentSweep: !maintenance,
    });
  } catch (error) {
    console.error("[watchdive] verification_reminder_failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return json(500, { ok: false });
  }

  // Counts only — the same object is safe for the log, Slack and the response.
  console.log("[watchdive] verification_reminder_run", result);
  if (!dryRun) await replayPressAttribution(databaseId);
  if (maintenance) await purgeExpiredBehavior();
  return json(200, { ok: !result.aborted, policy: "wd-verification-reminder-24h-v1", ...result });
}

/**
 * Press attribution replay rides the same tick. It is off unless
 * PRESS_ATTRIBUTION_ENABLED=1, bounded in rows and time, and can never change
 * the reminder result: anything thrown is reduced to one line.
 */
export async function replayPressAttribution(
  databaseId: string,
  replay: typeof replayPressOutbox = replayPressOutbox,
  log: (line: string) => void = (line) => console.log(line),
): Promise<void> {
  try {
    const outcome = await replay({ request: createNotionRequest(), databaseId, maxRows: 60, budgetMs: 15_000 });
    if (!outcome.skipped) log(`[press-attribution] replay ${JSON.stringify(outcome)}`);
  } catch (error) {
    log(`[press-attribution] replay failed — unexpected ${error instanceof Error ? error.name : "error"}`);
  }
}

/**
 * Page-behaviour retention runs only on the office tick marked maintenance.
 * It runs once daily after the reminder pass and can never change that
 * result: failures are logged inside purgeExpired, and anything thrown here
 * is reduced to one line.
 */
export async function purgeExpiredBehavior(
  store: Pick<ReturnType<typeof createBehaviorNotion>, "purgeExpired"> = createBehaviorNotion(),
  log: (line: string) => void = (line) => console.log(line),
): Promise<void> {
  try {
    const outcome = await store.purgeExpired({
      protectedIds: [process.env.NOTION_WAITLIST_DB_ID],
    });
    if (outcome.archived > 0) log(`[page-behavior] retention archived ${outcome.archived}`);
  } catch (error) {
    log(
      `[page-behavior] retention failed — unexpected ${error instanceof Error ? error.name : "error"}`,
    );
  }
}
