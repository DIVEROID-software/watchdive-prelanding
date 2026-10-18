import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/reservation/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleReservationStatus } = await import("@/lib/reservation/handlers");
        return handleReservationStatus(request);
      },
    },
  },
});
