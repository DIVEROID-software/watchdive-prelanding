import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/push/config")({
  server: {
    handlers: {
      GET: async () => {
        const { readPushPublicConfig } = await import("@/lib/push/readiness.server");
        return Response.json(await readPushPublicConfig(process.env, fetch), {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
