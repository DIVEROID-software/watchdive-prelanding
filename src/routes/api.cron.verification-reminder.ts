// Daily confirmation reminder, called by Vercel Cron (see vercel.json).
//
// Protected by CRON_SECRET: without it set in the project, every call is
// refused. The handler is loaded lazily so nothing server-only can reach a
// client bundle through the route tree.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/verification-reminder")({
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
