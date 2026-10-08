import { getRequestHeader } from "@tanstack/react-start/server";

import { shouldDiscardBehaviorUserAgent } from "@/lib/api/behaviorAudience";
import { createBehaviorNotion, type BehaviorWriteResult } from "@/lib/api/behaviorNotion";
import { countryFromHeader, type PageBehaviorSummary } from "@/lib/pageBehaviorSummary";

// One per instance: it remembers whether NOTION_UX_DB_ID resolved as a
// database or a data source, which session owns which row, and any pause.
const behaviorNotion = createBehaviorNotion();

export async function storePageBehavior(summary: PageBehaviorSummary): Promise<BehaviorWriteResult> {
  // Read the header and drop it. An ignored client is not written and the
  // user-agent is not logged. `ignored` is terminal: the current browser
  // retries any `stored: false`, which stays bounded and still writes nothing.
  if (shouldDiscardBehaviorUserAgent(getRequestHeader("user-agent"))) {
    return { stored: false, reason: "ignored" };
  }
  const country = countryFromHeader(
    getRequestHeader("x-vercel-ip-country") ?? getRequestHeader("cf-ipcountry"),
  );
  return behaviorNotion.write(summary, country);
}
