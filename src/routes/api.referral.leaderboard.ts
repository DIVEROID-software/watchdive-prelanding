// Public Buddy Invite top-N board. Both the service and the Notion wiring are
// loaded lazily so the integration token has no path into a client bundle.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/referral/leaderboard")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [{ leaderboardResponse }, { referralServiceDeps }, { referralProgramEnabled }] =
            await Promise.all([
              import("@/lib/referral/service.server"),
              import("@/lib/api/referral.functions"),
              import("@/lib/referral/program"),
            ]);
          return await leaderboardResponse(
            referralProgramEnabled(process.env),
            referralServiceDeps,
          );
        } catch {
          return new Response(JSON.stringify({ error: "unavailable" }), {
            status: 503,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            },
          });
        }
      },
    },
  },
});
