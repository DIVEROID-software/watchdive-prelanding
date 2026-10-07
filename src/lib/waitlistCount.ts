// The live count behind the public "spots left" figure, as the page reads it.
//
// The page renders the count on the server, so every HTML request (ad clicks,
// and crawlers too) would otherwise ask Notion. This reader keeps one answer
// for a short while, shares one request between concurrent callers, and turns
// any failure into `null` — "unknown" — which the page shows by hiding the
// figure. It never falls back to a number: the baseline alone is not the
// list's size, and showing it as if it were would be a false scarcity claim.
//
// Kept free of path-alias imports so `npm test` can load it directly.

/** How long a good count is reused. The page itself refreshes once a minute. */
export const COUNT_TTL_MS = 30_000;

/** How long a failure is remembered before Notion is asked again. */
export const COUNT_FAILURE_TTL_MS = 15_000;

/** How long a server render waits for the count before rendering without it. */
export const COUNT_RENDER_BUDGET_MS = 800;

export type CountReader = {
  /** The live count, or `null` when it cannot be read right now. */
  read(): Promise<number | null>;
  /**
   * The same, but gives up after `budgetMs` so a slow CRM cannot hold the page
   * back. The request keeps going and fills the cache for the next render.
   */
  readWithin(budgetMs: number): Promise<number | null>;
};

export function createCountReader(
  load: () => Promise<number>,
  options: {
    onError?: (error: unknown) => void;
    now?: () => number;
    ttlMs?: number;
    failureTtlMs?: number;
  } = {},
): CountReader {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? COUNT_TTL_MS;
  const failureTtlMs = options.failureTtlMs ?? COUNT_FAILURE_TTL_MS;
  let cached: { at: number; count: number | null } | null = null;
  let inflight: Promise<number | null> | null = null;

  function read(): Promise<number | null> {
    if (cached) {
      const age = now() - cached.at;
      if (age >= 0 && age < (cached.count === null ? failureTtlMs : ttlMs)) {
        return Promise.resolve(cached.count);
      }
    }
    inflight ??= Promise.resolve()
      .then(load)
      .then((count) => {
        if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
          throw new TypeError("waitlist count is not a non-negative integer");
        }
        return count;
      })
      .catch((error: unknown) => {
        options.onError?.(error);
        return null;
      })
      .then((count) => {
        cached = { at: now(), count };
        inflight = null;
        return count;
      });
    return inflight;
  }

  function readWithin(budgetMs: number): Promise<number | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), budgetMs);
    });
    return Promise.race([read(), timeout]).finally(() => clearTimeout(timer));
  }

  return { read, readWithin };
}
