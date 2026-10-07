// Server-only assembly of the /unsubscribe handler. Reached solely from the
// route, so the Notion key has no path into a client bundle.
import { createNotionRequest } from "../verification/notionLead.ts";
import { createNotionLaunchStore } from "./notionLaunchStore.ts";
import { handleUnsubscribe } from "./unsubscribe.ts";

export async function handleUnsubscribeRequest(request: Request, token: string): Promise<Response> {
  const databaseId = process.env.NOTION_WAITLIST_DB_ID;
  return handleUnsubscribe(request.method, token, {
    ...(databaseId ? { store: createNotionLaunchStore(createNotionRequest(), databaseId) } : {}),
  });
}
