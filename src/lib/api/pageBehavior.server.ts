import { getRequestHeader } from "@tanstack/react-start/server";

import { countryFromHeader, type PageBehaviorSummary } from "@/lib/pageBehaviorSummary";
import { createNotionRequest } from "@/lib/verification/notionLead";

function line(items: { id: string; dwellSec?: number; x?: number; y?: number }[], dwell: boolean) {
  return items
    .map((item) =>
      dwell ? `${item.id} ${item.dwellSec}s` : `${item.id} ${item.x},${item.y}`,
    )
    .join(" · ")
    .slice(0, 1800);
}

export async function storePageBehavior(summary: PageBehaviorSummary): Promise<{ stored: boolean }> {
  const databaseId = process.env.NOTION_UX_DB_ID?.trim();
  if (!databaseId) return { stored: false };
  const country = countryFromHeader(
    getRequestHeader("x-vercel-ip-country") ?? getRequestHeader("cf-ipcountry"),
  );
  try {
    await createNotionRequest()("POST", "pages", {
      parent: { database_id: databaseId },
      properties: {
        Name: { title: [{ text: { content: summary.sessionId } }] },
        Locale: { rich_text: [{ text: { content: summary.locale } }] },
        Device: { rich_text: [{ text: { content: summary.device } }] },
        Country: { rich_text: [{ text: { content: country } }] },
        Timezone: { rich_text: [{ text: { content: summary.timezone } }] },
        Duration: { number: summary.durationSec },
        Scroll: { number: summary.maxScroll },
        Viewport: {
          rich_text: [{ text: { content: `${summary.viewportW}x${summary.viewportH}` } }],
        },
        Referrer: { rich_text: [{ text: { content: summary.referrerHost } }] },
        Campaign: {
          rich_text: [
            {
              text: {
                content: [summary.utmSource, summary.utmMedium, summary.utmCampaign]
                  .filter(Boolean)
                  .join(" / ")
                  .slice(0, 200),
              },
            },
          ],
        },
        Sections: { rich_text: [{ text: { content: line(summary.sections, true) } }] },
        Clicks: { rich_text: [{ text: { content: line(summary.clicks, false) } }] },
      },
    });
    return { stored: true };
  } catch {
    return { stored: false };
  }
}
