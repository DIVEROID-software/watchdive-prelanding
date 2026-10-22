// Referral count helpers. The production OFF path uses the legacy filtered
// query below; whole-database tally/cache helpers are not used on that path.
// ON uses the shared referral ledger (waitlist.functions.ts).
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { NotionRequest } from "../verification/notionLead.ts";

export const REFERRAL_COUNT_CACHE_MS = 60_000;
export const REF_CODE_PATTERN = /^[a-z0-9]{8}$/;

/** Waits before retry n (0-based): 400 ms, 800 ms, 1.6 s. About 2.8 s in total, well inside a function's time. */
export const NOTION_BACKOFF_MS = [400, 800, 1600] as const;

type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Notion answered 429 (NotionRequestError keeps the HTTP status, never the body). */
export function isNotionRateLimited(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { status?: unknown }).status === 429
  );
}

/**
 * Retries a Notion call that was rate-limited. A 429 means Notion did not
 * apply the request, so retrying a write is safe too. Other errors are
 * thrown at once: a 4xx will not get better, and timeouts already waited.
 * A little jitter keeps several instances from retrying in lockstep.
 */
export async function withNotionBackoff<T>(
  call: () => Promise<T>,
  options: { delays?: readonly number[]; sleep?: Sleep; random?: () => number } = {},
): Promise<T> {
  const delays = options.delays ?? NOTION_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (!isNotionRateLimited(error) || attempt >= delays.length) throw error;
      await sleep(Math.round(delays[attempt] * (0.8 + 0.4 * random())));
    }
  }
}

/** A NotionRequest whose 429s are retried with backoff. */
export function withRateLimitBackoff(
  request: NotionRequest,
  options?: Parameters<typeof withNotionBackoff>[1],
): NotionRequest {
  return (method, path, body) => withNotionBackoff(() => request(method, path, body), options);
}

export type ReferralTally = ReadonlyMap<string, number>;

export type ReferralCountCache = {
  /** Count for one code from the current tally; refreshes it when stale. */
  count(code: string): Promise<number>;
};

/**
 * One tally serves every code for `ttlMs`. Readers that arrive while a
 * refresh runs share it. A failed refresh is not cached: the last good tally
 * is served if there is one (stale by at most a few minutes beats a broken
 * card), otherwise the error propagates and the card shows nothing.
 */
export function createReferralCountCache(
  load: () => Promise<ReferralTally>,
  options: { ttlMs?: number; now?: () => number } = {},
): ReferralCountCache {
  const ttlMs = options.ttlMs ?? REFERRAL_COUNT_CACHE_MS;
  const now = options.now ?? Date.now;
  let cached: { at: number; tally: ReferralTally } | null = null;
  let inflight: Promise<ReferralTally> | null = null;

  async function tally(): Promise<ReferralTally> {
    if (cached && now() - cached.at < ttlMs) return cached.tally;
    inflight ??= load()
      .then((fresh) => {
        cached = { at: now(), tally: fresh };
        return fresh;
      })
      .finally(() => {
        inflight = null;
      });
    try {
      return await inflight;
    } catch (error) {
      if (cached) return cached.tally;
      throw error;
    }
  }

  return {
    async count(code) {
      if (!REF_CODE_PATTERN.test(code)) return 0;
      return (await tally()).get(code) ?? 0;
    },
  };
}

type QueryPage = { results?: unknown[]; has_more?: boolean; next_cursor?: string | null };

function referredByOf(page: unknown): string {
  const property = (page as { properties?: Record<string, unknown> } | undefined)?.properties?.[
    "Referred by"
  ] as { rich_text?: { plain_text?: string }[] } | undefined;
  return (property?.rich_text ?? []).map((part) => part.plain_text ?? "").join("");
}

/**
 * Tally per `Referred by` value of the rows `filter` selects. The caller passes
 * the public counters' filter (not Suspect; verified or legacy status) plus
 * "Referred by is not empty", so a code gets exactly the number the old
 * per-code `equals` query returned.
 */
export async function loadReferralTally(
  request: NotionRequest,
  databaseId: string,
  filter: unknown,
): Promise<Map<string, number>> {
  const tally = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = (await request("POST", `databases/${databaseId}/query`, {
      filter,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })) as QueryPage;
    for (const result of page.results ?? []) {
      const code = referredByOf(result);
      if (REF_CODE_PATTERN.test(code)) tally.set(code, (tally.get(code) ?? 0) + 1);
    }
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return tally;
}

/** Preserve the pre-program query, pagination and fresh count while OFF. */
export async function loadLegacyReferralCount(
  request: (path: string, body: unknown) => Promise<QueryPage>,
  databaseId: string,
  code: string,
  countable: readonly unknown[],
): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const page = await request(`databases/${databaseId}/query`, {
      filter: { and: [{ property: "Referred by", rich_text: { equals: code } }, ...countable] },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    count += page.results?.length ?? 0;
    hasMore = Boolean(page.has_more);
    cursor = page.next_cursor ?? undefined;
  }
  return count;
}
