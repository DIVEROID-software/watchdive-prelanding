import { createServerFn } from "@tanstack/react-start";

import type { BehaviorWriteResult } from "@/lib/api/behaviorNotion";
import { pageBehaviorSummarySchema } from "@/lib/pageBehaviorSummary";

export const recordPageBehavior = createServerFn({ method: "POST" })
  .validator(pageBehaviorSummarySchema)
  .handler(async ({ data }): Promise<BehaviorWriteResult> => {
    try {
      const { storePageBehavior } = await import("./pageBehavior.server.ts");
      return await storePageBehavior(data);
    } catch (error) {
      // storePageBehavior logs its own Notion failures; this is anything else.
      console.error(
        `[page-behavior] write failed — unexpected ${error instanceof Error ? error.name : "error"}`,
      );
      return { stored: false, reason: "failed" };
    }
  });
