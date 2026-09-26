import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { BehaviorReport } from "@/lib/adminBehaviorReport";

const emptyReport: BehaviorReport = {
  configured: false,
  rows: [],
  sessions: 0,
  devices: [],
  countries: [],
  meanDuration: 0,
  meanScroll: 0,
  topClicks: [],
};

export const getBehaviorReport = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { adminIsConfigured, adminIsSignedIn, loadBehaviorReport } = await import(
      "./adminBehavior.server.ts"
    );
    if (!adminIsConfigured()) return { ok: false as const, reason: "unconfigured" as const };
    if (!adminIsSignedIn()) return { ok: false as const, reason: "locked" as const };
    return { ok: true as const, report: await loadBehaviorReport() };
  } catch {
    return { ok: false as const, reason: "locked" as const, report: emptyReport };
  }
});

export const signInBehaviorAdmin = createServerFn({ method: "POST" })
  .validator(z.object({ password: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    try {
      const { adminIsConfigured, signInAdmin } = await import("./adminBehavior.server.ts");
      if (!adminIsConfigured()) return { ok: false as const, reason: "unconfigured" as const };
      if (!signInAdmin(data.password)) return { ok: false as const, reason: "rejected" as const };
      return { ok: true as const };
    } catch {
      return { ok: false as const, reason: "rejected" as const };
    }
  });
