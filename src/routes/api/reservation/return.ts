import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/reservation/return")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleReservationReturn } = await import("@/lib/reservation/returnHandler");
        const { productionReservationReturn } = await import("@/lib/reservation/returnProduction");
        return handleReservationReturn(request, productionReservationReturn(process.env));
      },
    },
  },
});
