import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/reservation/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleReservationWebhook } = await import("@/lib/reservation/handlers");
        return handleReservationWebhook(request);
      },
    },
  },
});
