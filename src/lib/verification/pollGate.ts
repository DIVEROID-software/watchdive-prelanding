// In-process gate in front of the poll store read.
//
// A poll handle is a bearer string that lives in a tab for as long as the link
// does, so a replayed burst — a stuck client, a duplicated tab, somebody
// hammering a captured handle — is traffic we should expect. None of it may
// turn into one Notion query per request: the CRM has a rate limit, and
// exhausting it would take the signup form down with it.
//
// Two bounds, both per handle:
//   a short response cache, so a burst is answered from memory
//   a lifetime read ceiling, so one handle can never cost more than N reads
//
// The map itself is bounded and evicts oldest-first, so a flood of distinct
// handles cannot grow the heap either. This is per process and deliberately
// so — it is a shield for the store, not a correctness mechanism.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import {
  POLL_CACHE_TTL_MS,
  POLL_GATE_MAX_ENTRIES,
  POLL_MAX_STORE_READS_PER_HANDLE,
} from "./contracts.ts";

export type PollGateEntry<T> = {
  cachedAt: number;
  value: T;
  reads: number;
};

export type PollGate<T> = {
  run(handle: string, read: () => Promise<T>): Promise<T>;
  readonly size: number;
};

export type PollGateOptions = {
  cacheTtlMs?: number;
  maxReadsPerHandle?: number;
  maxEntries?: number;
  now?: () => number;
};

export function createPollGate<T>(options: PollGateOptions = {}): PollGate<T> {
  const cacheTtlMs = options.cacheTtlMs ?? POLL_CACHE_TTL_MS;
  const maxReads = options.maxReadsPerHandle ?? POLL_MAX_STORE_READS_PER_HANDLE;
  const maxEntries = options.maxEntries ?? POLL_GATE_MAX_ENTRIES;
  const now = options.now ?? Date.now;

  const entries = new Map<string, PollGateEntry<T>>();
  // One in-flight read per handle. Concurrent pollers on the same handle share
  // the answer instead of each opening their own request.
  const inFlight = new Map<string, Promise<T>>();

  function evictIfNeeded() {
    while (entries.size > maxEntries) {
      // Map iteration is insertion-ordered, so the first key is the oldest.
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }

  return {
    get size() {
      return entries.size;
    },

    async run(handle, read) {
      const existing = entries.get(handle);
      if (existing && now() - existing.cachedAt < cacheTtlMs) return existing.value;

      // Past the ceiling the handle keeps its last answer for good. A caller
      // that has already spent twenty store reads is not going to learn
      // anything new by spending a twenty-first.
      if (existing && existing.reads >= maxReads) return existing.value;

      const pending = inFlight.get(handle);
      if (pending) return pending;

      const request = read()
        .then((value) => {
          entries.delete(handle);
          entries.set(handle, {
            cachedAt: now(),
            value,
            reads: (existing?.reads ?? 0) + 1,
          });
          evictIfNeeded();
          return value;
        })
        .finally(() => {
          inFlight.delete(handle);
        });

      inFlight.set(handle, request);
      return request;
    },
  };
}
