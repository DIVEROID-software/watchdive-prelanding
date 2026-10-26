import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/reservation/direct")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleReservationDirect } = await import("@/lib/reservation/direct");
        return handleReservationDirect(request);
      },
      HEAD: async ({ request }) => {
        const { handleReservationDirect } = await import("@/lib/reservation/direct");
        return handleReservationDirect(request);
      },
    },
  },
});
