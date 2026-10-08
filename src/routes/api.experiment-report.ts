// Read-only experiment aggregates. The handler is loaded lazily so the report
// token and Notion credentials have no path into a client bundle.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/experiment-report")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleExperimentReport } = await import("@/lib/experimentReport.ts");
        return handleExperimentReport(request);
      },
    },
  },
});
