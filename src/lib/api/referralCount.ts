// The landing success card's "N friends joined" count (`getReferralCount`).
//
// The endpoint is public and unauthenticated, and it used to run a full,
// paginated, uncached Notion query per request, so random codes at a few
// requests per second could exhaust the integration's rate limit (about
// 3 requests/s, https://developers.notion.com/reference/request-limits) and
// make signups fail. Now:
//   - anything that is not an 8-char `[a-z0-9]` code is answered 0 without
//     touching Notion;
//   - with Buddy Invite off, ONE pass tallies `Referred by` over every
//     countable row and serves every code for REFERRAL_COUNT_CACHE_MS. Random
//     codes therefore cost nothing extra, and the number is the same raw
//     count as before (countable rows whose `Referred by` equals the code);
//   - with Buddy Invite on, the caller serves the ledger's credited count from
//     the shared leaderboard pass instead (waitlist.functions.ts);
//   - a Notion 429 is retried with backoff, and a failed refresh keeps
//     serving the last good tally rather than failing every card.
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
 * Tally of countable rows per `Referred by` value. `countableFilter` is the
 * public counters' filter (not Suspect; verified or legacy status), so a code
 * gets exactly the number the old per-code `equals` query returned.
 */
export async function loadReferralTally(
  request: NotionRequest,
  databaseId: string,
  countableFilter: readonly unknown[],
): Promise<Map<string, number>> {
  const tally = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = (await request("POST", `databases/${databaseId}/query`, {
      filter: {
        and: [{ property: "Referred by", rich_text: { is_not_empty: true } }, ...countableFilter],
      },
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
