import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/maya-report")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/lib/reporting/mayaReport.server")).handleMayaReport(request),
      POST: async ({ request }) =>
        (await import("@/lib/reporting/mayaReport.server")).handleMayaReport(request),
    },
  },
});
