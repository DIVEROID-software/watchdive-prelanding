import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/verification-recovery-20261102")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleVerificationServiceRecovery } = await import(
          "@/lib/verification/recovery20261102.server"
        );
        return handleVerificationServiceRecovery(request);
      },
    },
  },
});
