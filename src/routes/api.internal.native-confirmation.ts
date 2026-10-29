import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/internal/native-confirmation")({
  server: { handlers: { POST: async ({ request }) => {
    const { handleNativeConfirmation } = await import("@/lib/instantForm/relay/server");
    return handleNativeConfirmation(request);
  } } },
});
