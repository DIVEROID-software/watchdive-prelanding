// Notion access for the page-behaviour database (NOTION_UX_DB_ID).
//
// Two things this module exists for:
//
// 1. A failed write used to vanish into an empty catch, so the database could
//    stay empty for weeks with nobody able to say why. Every failure now logs
//    exactly one line: the HTTP status, Notion's error code, and Notion's
//    message with ids, quoted values and addresses removed. The env values
//    themselves never appear in it.
//
// 2. NOTION_UX_DB_ID may hold either a database id (the id in the database's
//    URL) or a data-source id ("Copy data source ID" in Notion, or the
//    `collection://` id an MCP tool shows). The rest of the site speaks
//    Notion-Version 2022-06-28, where only a database id works. So the first
//    request tries the id as a database, and on a 400/404 tries it once more
//    as a data source under the newer API version. Whichever works is
//    remembered for the life of the instance.
//
// The Notion integration is shared with the waitlist, and Notion allows about
// three requests a second per integration. After a 4xx — a configuration
// problem that will not fix itself — writes pause for a minute so a broken
// behaviour database cannot crowd out signups.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { encodeBehaviorSections } from "../conversionExperimentContract.ts";
import type { PageBehaviorSummary } from "../pageBehaviorSummary.ts";
import {
  createNotionRequest,
  NOTION_DATA_SOURCE_VERSION,
  NotionRequestError,
} from "../verification/notionLead.ts";

export type BehaviorTarget = "database" | "data_source";

/** What the browser is told. Never a status, a code, or an id. */
export type BehaviorWriteResult =
  | { stored: true }
  | { stored: false; reason: "unconfigured" | "failed" | "ignored" };

export type BehaviorEnv = { NOTION_API_KEY?: string; NOTION_UX_DB_ID?: string };

/** The privacy policy's promise: page-measurement summaries go after 12 months. */
export const BEHAVIOR_RETENTION_DAYS = 365;
/** Archives per daily run. Sequential, so about a request per Notion round trip. */
export const BEHAVIOR_PURGE_LIMIT = 50;

export type BehaviorPurgeResult = {
  status: "skipped" | "done" | "failed";
  archived: number;
};

function normalizeId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

const PAUSE_MS = 60_000;
const SESSION_PAGES_MAX = 500;

function rich(value: string) {
  const content = value.slice(0, 1900);
  return { rich_text: content ? [{ text: { content } }] : [] };
}

function line(items: { id: string; dwellSec?: number; x?: number; y?: number }[], dwell: boolean) {
  return items
    .map((item) => (dwell ? `${item.id} ${item.dwellSec}s` : `${item.id} ${item.x},${item.y}`))
    .join(" · ")
    .slice(0, 1800);
}

/**
 * `source / medium / campaign`, with `-` for a missing part so the three
 * positions always mean the same thing ("meta / - / launch", not
 * "meta / launch"). An untagged visit stays empty.
 */
export function campaignLine(
  summary: Pick<PageBehaviorSummary, "utmSource" | "utmMedium" | "utmCampaign">,
): string {
  const parts = [summary.utmSource, summary.utmMedium, summary.utmCampaign];
  if (!parts.some(Boolean)) return "";
  return parts
    .map((part) => part || "-")
    .join(" / ")
    .slice(0, 200);
}

/** Exactly the live schema: Name title; Duration, Scroll number; the rest rich_text. */
export function behaviorProperties(summary: PageBehaviorSummary, country: string) {
  return {
    Name: { title: [{ text: { content: summary.sessionId } }] },
    Locale: rich(summary.locale),
    Device: rich(summary.device),
    Country: rich(country),
    Timezone: rich(summary.timezone),
    Duration: { number: summary.durationSec },
    Scroll: { number: summary.maxScroll },
    Viewport: rich(`${summary.viewportW}x${summary.viewportH}`),
    Referrer: rich(summary.referrerHost),
    Campaign: rich(campaignLine(summary)),
    Sections: rich(
      encodeBehaviorSections(line(summary.sections, true), summary.experiment, summary.funnel),
    ),
    Clicks: rich(line(summary.clicks, false)),
  };
}

/** One attempt's outcome as log text. Notion's sanitized words, or a fixed label. */
export function describeAttempt(target: BehaviorTarget, error: unknown): string {
  const as = `as ${target}_id`;
  if (error instanceof NotionRequestError) {
    return `${as}: ${error.status} ${error.code || "no_code"}${error.detail ? ` "${error.detail}"` : ""}`;
  }
  // Any other error text could carry the request URL, and the URL carries the id.
  const timeout =
    error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  return `${as}: ${timeout ? "timeout" : "network_error"}`;
}

function isClientError(error: unknown): boolean {
  return error instanceof NotionRequestError && error.status >= 400 && error.status < 500;
}

export function createBehaviorNotion(
  options: {
    fetchImpl?: typeof fetch;
    env?: BehaviorEnv;
    now?: () => number;
    log?: (line: string) => void;
  } = {},
) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((text: string) => console.error(text));
  const fetchImpl = options.fetchImpl ?? fetch;

  let resolved: BehaviorTarget | null = null;
  let pausedUntil = 0;
  let unconfiguredLogged = false;
  // sessionId -> Notion page, so a session's later summaries update its row
  // instead of adding one. Per instance only; a cold instance starts a new row.
  const sessionPages = new Map<string, string>();

  function config(): { id: string; key: string } | null {
    const id = env.NOTION_UX_DB_ID?.trim() ?? "";
    const key = env.NOTION_API_KEY?.trim() ?? "";
    return id && key ? { id, key } : null;
  }

  function requestFor(target: BehaviorTarget) {
    return createNotionRequest(
      fetchImpl,
      env,
      target === "database" ? undefined : NOTION_DATA_SOURCE_VERSION,
    );
  }

  /**
   * Runs `attempt` against the resolved target, or tries database then data
   * source while unresolved. On failure, logs one line and returns why.
   */
  async function run<T>(
    op: "write" | "read" | "retention",
    attempt: (target: BehaviorTarget) => Promise<T>,
  ): Promise<{ value: T } | { failure: "unconfigured" | "failed" }> {
    if (!config()) {
      if (!unconfiguredLogged) {
        unconfiguredLogged = true;
        log(`[page-behavior] ${op} skipped: NOTION_UX_DB_ID or NOTION_API_KEY is not set`);
      }
      return { failure: "unconfigured" };
    }
    if (now() < pausedUntil) return { failure: "failed" };

    const targets: BehaviorTarget[] = resolved ? [resolved] : ["database", "data_source"];
    const attempts: string[] = [];
    let last: unknown;
    for (const target of targets) {
      try {
        const value = await attempt(target);
        resolved = target;
        return { value };
      } catch (error) {
        last = error;
        attempts.push(describeAttempt(target, error));
        const retryable =
          error instanceof NotionRequestError && (error.status === 400 || error.status === 404);
        if (!retryable) break;
      }
    }
    if (isClientError(last)) pausedUntil = now() + PAUSE_MS;
    log(`[page-behavior] ${op} failed — ${attempts.join("; ")}`);
    return { failure: "failed" };
  }

  async function queryDetailed(body: Record<string, unknown>) {
    const outcome = await run("read", (target) =>
      requestFor(target)(
        "POST",
        target === "database"
          ? `databases/${config()!.id}/query`
          : `data_sources/${config()!.id}/query`,
        body,
      ),
    );
    return "failure" in outcome
      ? { ok: false as const, reason: outcome.failure }
      : { ok: true as const, page: outcome.value };
  }

  return {
    async write(summary: PageBehaviorSummary, country: string): Promise<BehaviorWriteResult> {
      const properties = behaviorProperties(summary, country);
      const known = sessionPages.get(summary.sessionId);
      if (known && resolved && now() >= pausedUntil) {
        try {
          await requestFor(resolved)("PATCH", `pages/${known}`, { properties });
          return { stored: true };
        } catch {
          // The row is gone or unreachable: fall through and start a new one.
          sessionPages.delete(summary.sessionId);
        }
      }
      const outcome = await run("write", (target) =>
        requestFor(target)("POST", "pages", {
          parent:
            target === "database"
              ? { database_id: config()!.id }
              : { type: "data_source_id", data_source_id: config()!.id },
          properties,
        }),
      );
      if ("failure" in outcome) return { stored: false, reason: outcome.failure };
      const pageId = typeof outcome.value.id === "string" ? outcome.value.id : "";
      if (pageId) {
        if (sessionPages.size >= SESSION_PAGES_MAX) {
          const oldest = sessionPages.keys().next().value;
          if (oldest !== undefined) sessionPages.delete(oldest);
        }
        sessionPages.set(summary.sessionId, pageId);
      }
      return { stored: true };
    },

    /**
     * Moves summaries created more than BEHAVIOR_RETENTION_DAYS ago to the
     * Notion trash, oldest first, at most `limit` per call. Only ever the
     * NOTION_UX_DB_ID database: an id in `protectedIds` (the caller passes the
     * waitlist's) is refused.
     * Unset config is a silent skip; a failure logs one line and stops.
     */
    async purgeExpired(
      options: { limit?: number; protectedIds?: (string | undefined)[] } = {},
    ): Promise<BehaviorPurgeResult> {
      const limit = options.limit ?? BEHAVIOR_PURGE_LIMIT;
      const target = config();
      if (!target) return { status: "skipped", archived: 0 };
      const own = normalizeId(target.id);
      if ((options.protectedIds ?? []).some((id) => id?.trim() && normalizeId(id.trim()) === own)) {
        log("[page-behavior] retention refused: NOTION_UX_DB_ID is the waitlist database");
        return { status: "failed", archived: 0 };
      }
      const before = new Date(now() - BEHAVIOR_RETENTION_DAYS * 86_400_000).toISOString();
      const page = await run("retention", (kind) =>
        requestFor(kind)(
          "POST",
          kind === "database" ? `databases/${target.id}/query` : `data_sources/${target.id}/query`,
          {
            filter: { timestamp: "created_time", created_time: { before } },
            sorts: [{ timestamp: "created_time", direction: "ascending" }],
            page_size: Math.min(Math.max(limit, 1), 100),
          },
        ),
      );
      if ("failure" in page) return { status: "failed", archived: 0 };
      const kind = resolved ?? "database";
      const ids = ((page.value.results as Record<string, unknown>[] | undefined) ?? [])
        .map((row) => (typeof row.id === "string" ? row.id : ""))
        .filter(Boolean)
        .slice(0, limit);
      let archived = 0;
      for (const id of ids) {
        try {
          // 2022-06-28 calls it `archived`; 2025-09-03 renamed it `in_trash`.
          await requestFor(kind)(
            "PATCH",
            `pages/${id}`,
            kind === "database" ? { archived: true } : { in_trash: true },
          );
          archived += 1;
        } catch (error) {
          if (isClientError(error)) pausedUntil = now() + PAUSE_MS;
          log(
            `[page-behavior] retention failed after ${archived} archived — ${describeAttempt(kind, error)}`,
          );
          return { status: "failed", archived };
        }
      }
      return { status: "done", archived };
    },

    query(body: Record<string, unknown>) {
      return queryDetailed(body).then((detailed) => (detailed.ok ? detailed.page : null));
    },

    queryDetailed,
  };
}
