// Process-local rolling counters that keep one network from using the form to
// mail arbitrary addresses.
//
// This deliberately holds nothing durable. The CRM is a projection of leads,
// not a log of who connected from where — so no address, no user agent, and
// not even a digest of either is written to it. The digest exists only as a map
// key inside one server process and disappears with it.
//
// That is a weaker guarantee than a shared store would give: counters are
// per-instance and reset on redeploy. It is the right trade for this surface.
// The expensive action being defended is sending mail, the per-email cooldown
// and send ceiling in Notion already bound abuse of any single address, and
// this only has to stop one client from walking a list of other people's
// addresses.
//
// Kept free of path-alias imports so `npm test` can load it directly.

/** Window over which one network's submits are counted. */
export const NETWORK_WINDOW_MS = 60 * 60 * 1000;

/** Submits from one network before further ones are flagged for review. */
export const NETWORK_REPEAT_THRESHOLD = 4;

/** Submits from one network before it stops producing mail. */
export const NETWORK_SEND_BLOCK_THRESHOLD = 8;

/**
 * Ceiling across all networks, sized as a circuit breaker rather than a rate
 * limit. A paid burst can legitimately put hundreds of real signups through one
 * instance in an hour, and silently dropping their verification mail would cost
 * far more than the abuse this is guarding against. 500 an hour sits well above
 * any plausible campaign and still stops a runaway.
 */
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
export const GLOBAL_SEND_BLOCK_THRESHOLD = 500;

/** Bounded so a rotating attacker cannot grow the process heap. */
export const NETWORK_GATE_MAX_ENTRIES = 10_000;

export type NetworkVerdict = {
  /** Enough repeats to be worth a reviewer's attention. */
  repeat: boolean;
  /** Enough to stop producing mail for this submit. */
  blocked: boolean;
};

export type NetworkGate = {
  record(key: string | undefined): NetworkVerdict;
  readonly size: number;
};

export type NetworkGateOptions = {
  windowMs?: number;
  repeatThreshold?: number;
  blockThreshold?: number;
  globalWindowMs?: number;
  globalThreshold?: number;
  maxEntries?: number;
  now?: () => number;
};

export function createNetworkGate(options: NetworkGateOptions = {}): NetworkGate {
  const windowMs = options.windowMs ?? NETWORK_WINDOW_MS;
  const repeatThreshold = options.repeatThreshold ?? NETWORK_REPEAT_THRESHOLD;
  const blockThreshold = options.blockThreshold ?? NETWORK_SEND_BLOCK_THRESHOLD;
  const globalWindowMs = options.globalWindowMs ?? GLOBAL_WINDOW_MS;
  const globalThreshold = options.globalThreshold ?? GLOBAL_SEND_BLOCK_THRESHOLD;
  const maxEntries = options.maxEntries ?? NETWORK_GATE_MAX_ENTRIES;
  const now = options.now ?? Date.now;

  // key -> timestamps inside the window. Trimmed on read, so an idle key costs
  // nothing beyond its entry until it is evicted.
  const hits = new Map<string, number[]>();
  let globalHits: number[] = [];

  function trim(times: number[], at: number, span: number): number[] {
    const cutoff = at - span;
    let index = 0;
    while (index < times.length && times[index] <= cutoff) index++;
    return index === 0 ? times : times.slice(index);
  }

  function evictIfNeeded() {
    while (hits.size > maxEntries) {
      const oldest = hits.keys().next();
      if (oldest.done) break;
      hits.delete(oldest.value);
    }
  }

  return {
    get size() {
      return hits.size;
    },

    record(key) {
      const at = now();

      globalHits = trim(globalHits, at, globalWindowMs);
      globalHits.push(at);
      // A rotating attacker defeats any per-key counter, so the whole surface
      // has a ceiling too. Crossing it suppresses mail without rejecting leads.
      // Deliberately generous: this is the last resort, not the first.
      const globallyBlocked = globalHits.length > globalThreshold;

      // Without a client address there is nothing to group by. The submit still
      // counts globally, and the per-email cooldown still applies to it.
      if (!key) return { repeat: false, blocked: globallyBlocked };

      const previous = trim(hits.get(key) ?? [], at, windowMs);
      previous.push(at);
      // Re-inserting moves the key to the end, which is what makes eviction
      // drop the least recently seen network rather than an arbitrary one.
      hits.delete(key);
      hits.set(key, previous);
      evictIfNeeded();

      return {
        repeat: previous.length >= repeatThreshold,
        blocked: globallyBlocked || previous.length >= blockThreshold,
      };
    },
  };
}
