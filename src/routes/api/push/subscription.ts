import { createFileRoute } from "@tanstack/react-router";
import { createHmac } from "node:crypto";
import { createPushRateGate } from "@/lib/push/http.server";

const gate = createPushRateGate();
export const Route = createFileRoute("/api/push/subscription")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      DELETE: ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request) {
  const { handlePushRoute } = await import("@/lib/push/runtime.server");
  const secret = process.env.WATCHDIVE_PUSH_RECEIPT_SECRET ?? "";
  return handlePushRoute(request, process.env, {
    fetchImpl: fetch,
    allowRequest: () =>
      gate(
        createHmac("sha256", secret)
          .update(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown")
          .digest("hex"),
      ),
  });
}
