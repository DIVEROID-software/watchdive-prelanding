import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locale";
import { onsiteReservation } from "@/lib/reservation/onsite";
import { createNotionLeadStore, createNotionRequest } from "@/lib/verification/notionLead";

// POST keeps bearer credentials out of URLs, logs, browser history and caches.
// TanStack Start supplies the same-origin server-function request boundary.
export const getOnsiteReservation = createServerFn({ method: "POST" })
  .validator(z.object({ credential: z.object({ kind: z.enum(["attempt", "confirmation"]), value: z.string().min(1).max(4096) }), locale: z.enum(SUPPORTED_LOCALES) }))
  .handler(async ({ data }) => {
    const dbId = process.env.NOTION_WAITLIST_DB_ID;
    if (!dbId) return { status: "unavailable" as const };
    return onsiteReservation(data, {
      store: createNotionLeadStore(createNotionRequest(), dbId), env: process.env,
    });
  });
