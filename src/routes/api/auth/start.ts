import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleSocialStart } = await import("@/lib/socialAuth/http");
        const { createServiceDependencies } = await import("@/lib/verification/deps.server");
        const { waitlistSignupOpen } = await import("@/lib/api/waitlist.functions");
        const closed = !(await waitlistSignupOpen().catch(() => false));
        return handleSocialStart(request, {
          env: process.env,
          serviceDependencies: createServiceDependencies({
            ua: request.headers.get("user-agent") ?? undefined,
            gpc: request.headers.get("sec-gpc") === "1",
          }),
          isClosed: async () => closed,
        });
      },
    },
  },
});
