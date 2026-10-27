import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/continuation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleSocialContinuation } = await import("@/lib/socialAuth/http");
        const { createServiceDependencies } = await import("@/lib/verification/deps.server");
        return handleSocialContinuation(request, {
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
