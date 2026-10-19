// Office Mac mini 24-hour reminder endpoint. Separate path prevents a new
// dry-run caller from reaching the old six-hour implementation during rollout.
//
// Protected by WATCHDIVE_REMINDER_CRON_SECRET: without it set in the project, every call is
// refused. The handler is loaded lazily so nothing server-only can reach a
// client bundle through the route tree.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/verification-reminder-v2")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleVerificationReminderCron } =
          await import("@/lib/verification/reminderCron.server");
        return handleVerificationReminderCron(request);
      },
    },
  },
});
