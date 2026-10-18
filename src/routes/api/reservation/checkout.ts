import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/reservation/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleReservationCheckout } = await import("@/lib/reservation/handlers");
        return handleReservationCheckout(request);
      },
    },
  },
});
