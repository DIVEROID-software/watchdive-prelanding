// Server-only assembly of the daily confirmation-reminder run.
//
// Reached solely from the cron route, so the Notion, Resend, Slack and cron
// secrets have no path into a client bundle.
import { checkCronAuthorization } from "./cronAuth.ts";
import { createSlackPoster } from "./deliveryAlert.ts";
import { createNotionReminderStore, createNotionRequest } from "./notionLead.ts";
import { formatReminderSummary, runVerificationReminders } from "./reminder.ts";
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
    process.env.CRON_SECRET,
  );
  if (auth === "not_configured") {
    console.error("[watchdive] verification_reminder_refused", { reason: "cron_secret_not_set" });
    return json(503, { ok: false });
  }
  if (auth !== "authorized") return json(401, { ok: false });

  const databaseId = process.env.NOTION_WAITLIST_DB_ID;
  if (!databaseId) return json(503, { ok: false });

  let result;
  try {
    result = await runVerificationReminders({
      store: createNotionReminderStore(createNotionRequest(), databaseId),
      mailer: createResendMailer(),
    });
  } catch (error) {
    console.error("[watchdive] verification_reminder_failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return json(500, { ok: false });
  }

  // Counts only — the same object is safe for the log, Slack and the response.
  console.log("[watchdive] verification_reminder_run", result);
  const summary = formatReminderSummary(result);
  if (summary) await createSlackPoster()(summary);
  return json(200, { ok: !result.aborted, ...result });
}
