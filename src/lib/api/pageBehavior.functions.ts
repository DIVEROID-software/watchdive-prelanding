import { createServerFn } from "@tanstack/react-start";

import { pageBehaviorSummarySchema } from "@/lib/pageBehaviorSummary";

export const recordPageBehavior = createServerFn({ method: "POST" })
  .validator(pageBehaviorSummarySchema)
  .handler(async ({ data }) => {
    try {
      const { storePageBehavior } = await import("./pageBehavior.server.ts");
      return await storePageBehavior(data);
    } catch {
      return { stored: false };
    }
  });
