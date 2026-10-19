import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/providers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleSocialProviders } = await import("@/lib/socialAuth/http");
        return handleSocialProviders(request, { env: process.env });
      },
    },
  },
});
