import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/conversion-health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleConversionHealth } = await import("@/lib/analytics/conversionHealth.server");
        return handleConversionHealth(request);
      },
      POST: async ({ request }) => {
        const { handleConversionHealth } = await import("@/lib/analytics/conversionHealth.server");
        return handleConversionHealth(request);
      },
    },
  },
});
