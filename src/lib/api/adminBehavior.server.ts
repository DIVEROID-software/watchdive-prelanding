import { getCookie, getRequestHeader, setCookie } from "@tanstack/react-start/server";

import { ADMIN_COOKIE, adminCookieMatches, adminPasswordsMatch, adminSessionToken } from "@/lib/adminAuth";
import type { BehaviorReport, BehaviorRow } from "@/lib/adminBehaviorReport";
import { createNotionRequest } from "@/lib/verification/notionLead";

export type { BehaviorReport, BehaviorRow };

function password(): string {
  return process.env.WATCHDIVE_ADMIN_PASSWORD?.trim() ?? "";
}

export function adminIsConfigured(): boolean {
  return password().length >= 12;
}

export function adminIsSignedIn(): boolean {
  const secret = password();
  if (!adminIsConfigured()) return false;
  return adminCookieMatches(getCookie(ADMIN_COOKIE), secret);
}

export function signInAdmin(input: string): boolean {
  const secret = password();
  if (!adminIsConfigured() || !adminPasswordsMatch(input, secret)) return false;
  const secure = (getRequestHeader("x-forwarded-proto") ?? "").toLowerCase() === "https";
  setCookie(ADMIN_COOKIE, adminSessionToken(secret), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return true;
}

function richText(property: unknown): string {
  const rich = (property as { rich_text?: { plain_text?: string }[] } | undefined)?.rich_text;
  return (rich ?? [])
    .map((part) => part.plain_text ?? "")
    .join("")
    .slice(0, 500);
}

function numberValue(property: unknown): number {
  const value = (property as { number?: number | null } | undefined)?.number;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function tally(values: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const name = value.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function clickNames(value: string): string[] {
  return value
    .split(" · ")
    .map((part) => part.trim().split(" ")[0] ?? "")
    .filter((name) => /^[a-z0-9-]{1,40}$/.test(name));
}

export async function loadBehaviorReport(): Promise<BehaviorReport> {
  const empty: BehaviorReport = {
    configured: Boolean(process.env.NOTION_UX_DB_ID?.trim()),
    rows: [],
    sessions: 0,
    devices: [],
    countries: [],
    meanDuration: 0,
    meanScroll: 0,
    topClicks: [],
  };
  const databaseId = process.env.NOTION_UX_DB_ID?.trim();
  if (!databaseId) return empty;
  try {
    const page = await createNotionRequest()("POST", `databases/${databaseId}/query`, {
      page_size: 50,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    });
    const results = (page.results as Array<Record<string, unknown>> | undefined) ?? [];
    const rows: BehaviorRow[] = results.map((result) => {
      const properties = (result.properties ?? {}) as Record<string, unknown>;
      return {
        when: String(result.created_time ?? "").slice(0, 16).replace("T", " "),
        locale: richText(properties.Locale),
        device: richText(properties.Device),
        country: richText(properties.Country),
        timezone: richText(properties.Timezone),
        durationSec: numberValue(properties.Duration),
        scroll: numberValue(properties.Scroll),
        viewport: richText(properties.Viewport),
        referrer: richText(properties.Referrer),
        campaign: richText(properties.Campaign),
        sections: richText(properties.Sections),
        clicks: richText(properties.Clicks),
      };
    });
    const sessions = rows.length;
    const mean = (values: number[]) =>
      values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    return {
      configured: true,
      rows,
      sessions,
      devices: tally(rows.map((row) => row.device)),
      countries: tally(rows.map((row) => row.country)),
      meanDuration: mean(rows.map((row) => row.durationSec)),
      meanScroll: mean(rows.map((row) => row.scroll)),
      topClicks: tally(rows.flatMap((row) => clickNames(row.clicks))),
    };
  } catch {
    return empty;
  }
}
