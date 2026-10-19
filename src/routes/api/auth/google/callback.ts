import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGoogleCallback } = await import("@/lib/socialAuth/http");
        const { createServiceDependencies } = await import("@/lib/verification/deps.server");
        return handleGoogleCallback(request, {
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
