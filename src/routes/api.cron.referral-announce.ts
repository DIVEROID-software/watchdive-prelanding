import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/referral-announce")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleReferralAnnounce } = await import("@/lib/referral/announce.server");
        return handleReferralAnnounce(request);
      },
    },
  },
});
