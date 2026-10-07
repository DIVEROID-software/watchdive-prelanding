import { getRequestHeader } from "@tanstack/react-start/server";

import { createBehaviorNotion, type BehaviorWriteResult } from "@/lib/api/behaviorNotion";
import { countryFromHeader, type PageBehaviorSummary } from "@/lib/pageBehaviorSummary";

// One per instance: it remembers whether NOTION_UX_DB_ID resolved as a
// database or a data source, which session owns which row, and any pause.
const behaviorNotion = createBehaviorNotion();

export async function storePageBehavior(summary: PageBehaviorSummary): Promise<BehaviorWriteResult> {
  const country = countryFromHeader(
    getRequestHeader("x-vercel-ip-country") ?? getRequestHeader("cf-ipcountry"),
  );
  return behaviorNotion.write(summary, country);
}
