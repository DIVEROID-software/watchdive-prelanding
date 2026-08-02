export type BrowserEventRelayResult = { status?: unknown };

export type BrowserEventDrainSummary = {
  attempted: number;
  accepted: number;
  pending: number;
};

type BrowserEventDeliveryDependencies<Item> = {
  listPending: () => readonly Item[];
  eventId: (item: Item) => string;
  isCurrentPending: (item: Item) => boolean;
  relay: (item: Item) => Promise<BrowserEventRelayResult>;
  markAccepted: (eventId: string) => boolean;
};

type BrowserEventDeliveryOptions = {
  maxEventsPerDrain?: number;
  timeoutMs?: number;
};

const DEFAULT_MAX_EVENTS_PER_DRAIN = 8;
const DEFAULT_TIMEOUT_MS = 6_000;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value as number)));
}

async function relayWithTimeout<Item>(
  item: Item,
  relay: BrowserEventDeliveryDependencies<Item>["relay"],
  timeoutMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      relay(item).catch(() => ({ status: "failed" })),
      new Promise<BrowserEventRelayResult>((resolve) => {
        timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A page-memory drain coordinator for the durable session queue.
 *
 * Calls made while a drain is active share the same promise, so online,
 * visibility and user-action triggers cannot send the same event concurrently.
 * One coalesced follow-up pass may pick up events recorded during the active
 * drain, but an event that failed is attempted at most once per drain call.
 */
export function createBoundedBrowserEventDrainer<Item>(
  dependencies: BrowserEventDeliveryDependencies<Item>,
  options: BrowserEventDeliveryOptions = {},
) {
  const maxEventsPerDrain = boundedInteger(
    options.maxEventsPerDrain,
    DEFAULT_MAX_EVENTS_PER_DRAIN,
    1,
    32,
  );
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 30_000);
  let active: Promise<BrowserEventDrainSummary> | null = null;
  let followUpRequested = false;

  const drain = () => {
    if (active) {
      followUpRequested = true;
      return active;
    }

    const attemptedIds = new Set<string>();
    const run = async (): Promise<BrowserEventDrainSummary> => {
      let attempted = 0;
      let accepted = 0;

      do {
        followUpRequested = false;
        let pending: readonly Item[] = [];
        try {
          pending = dependencies.listPending();
        } catch {
          // Consent, locale, feature gating or restricted storage keeps the
          // queue unavailable. The landing experience remains fail-open.
        }

        const batch = pending
          .filter((item) => !attemptedIds.has(dependencies.eventId(item)))
          .slice(0, maxEventsPerDrain - attempted);

        for (const item of batch) {
          const id = dependencies.eventId(item);
          // The pending batch is only a snapshot. Consent, locale eligibility,
          // or the underlying funnel generation can change while an earlier
          // relay is in flight. Revalidate immediately before starting every
          // network request so a cleared generation cannot leak the rest of an
          // already-snapshotted batch.
          try {
            if (!dependencies.isCurrentPending(item)) break;
          } catch {
            break;
          }
          attemptedIds.add(id);
          attempted += 1;
          const result = await relayWithTimeout(item, dependencies.relay, timeoutMs);
          if (result.status !== "accepted") continue;
          try {
            if (dependencies.markAccepted(id)) accepted += 1;
          } catch {
            // A concurrent consent withdrawal wins. The queue has already been
            // cleared and must not be recreated merely to record an ACK.
          }
        }
      } while (followUpRequested && attempted < maxEventsPerDrain);

      return { attempted, accepted, pending: attempted - accepted };
    };

    const current = run().finally(() => {
      if (active === current) active = null;
      followUpRequested = false;
    });
    active = current;
    return current;
  };

  return Object.freeze({ drain });
}
