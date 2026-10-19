import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/apple/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleAppleCallback } = await import("@/lib/socialAuth/http");
        const { createServiceDependencies } = await import("@/lib/verification/deps.server");
        return handleAppleCallback(request, {
          env: process.env,
          serviceDependencies: createServiceDependencies({
            ua: request.headers.get("user-agent") ?? undefined,
            gpc: request.headers.get("sec-gpc") === "1",
          }),
        });
      },
    },
  },
});
