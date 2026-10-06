// One-click unsubscribe from the launch mails (List-Unsubscribe target).
//
// GET shows a confirm button; POST records the opt-out. The handler is loaded
// lazily so nothing server-only can reach a client bundle through the route
// tree.
import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request, token: string): Promise<Response> {
  const { handleUnsubscribeRequest } = await import("@/lib/launchMail/unsubscribe.server");
  return handleUnsubscribeRequest(request, token);
}

export const Route = createFileRoute("/unsubscribe/$token")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params.token),
      POST: ({ request, params }) => handle(request, params.token),
    },
  },
});
