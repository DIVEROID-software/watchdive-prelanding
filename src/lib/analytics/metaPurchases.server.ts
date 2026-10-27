import { createHmac } from "node:crypto";
import { createMetaPurchaseSender } from "../api/metaCapi.ts";
import { retargetingEventId } from "../retargeting/eventId.ts";
import {
  readDeliveryStoreConfig,
  redisConversionStore,
  type ConversionStore,
  type Delivery,
} from "./googleConversions.server.ts";

/** Independent of GA4 credentials and cookies; consent + durable ledger required. */
export function createMetaPurchases(
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    store?: ConversionStore;
    now?: () => number;
  } = {},
) {
  const env = options.env ?? process.env;
  const config = readDeliveryStoreConfig(env);
  const sender = createMetaPurchaseSender(env, options.fetchImpl);
  const store =
    config && sender
      ? (options.store ??
        redisConversionStore(config.redisUrl, config.redisToken, options.fetchImpl))
      : null;
  const now = options.now ?? Date.now;
  const key = (kind: string, value: string) =>
    createHmac("sha256", config!.signingSecret)
      .update(`meta-purchase:v1:${sender!.pixelId}:${kind}:${value}`)
      .digest("hex");
  const subject = (email: string) => key("subject", email.trim().toLowerCase());
  return {
    enabled: Boolean(store),
    async capture(email: string, allowed: boolean) {
      if (!store) return;
      if (!allowed) {
        await store.forget(subject(email));
        return;
      }
      // Permission snapshot only; no raw address or GA ID is stored for Meta.
      await store.capture(subject(email), { capturedAt: now() });
    },
    async forget(email: string) {
      if (store) await store.forget(subject(email));
    },
    async send(
      email: string,
      sessionId: string,
      occurredAt: number | null,
      allowed: () => Promise<boolean>,
    ): Promise<Delivery> {
      if (!store || !sender) return "disabled";
      if (
        occurredAt === null ||
        !Number.isSafeInteger(occurredAt) ||
        occurredAt <= 0 ||
        occurredAt * 1000 > now() ||
        now() - occurredAt * 1000 > 7 * 86400000
      )
        return "skipped";
      // Same id as the legacy 48-hour browser proof. That match is not what
      // prevents a second Purchase once this 7-day sender is enabled: the
      // browser pixel is suppressed. Meta drops a repeated id only for about
      // 48 hours after the first receipt.
      const sharedEventId = retargetingEventId(
        "purchase",
        sessionId,
        config!.signingSecret.trim(),
      );
      if (!sharedEventId) return "skipped";
      let eventKey: string | undefined;
      let claimAttempted = false;
      let claimed = false;
      let posted = false;
      try {
        if (!(await allowed())) {
          await store.forget(subject(email));
          return "skipped";
        }
        const context = await store.context(subject(email));
        if (!context || context.capturedAt > now() || now() - context.capturedAt > 7 * 86400000)
          return "skipped";
        eventKey = key("Purchase", sessionId);
        claimAttempted = true;
        if (!(await store.claim(eventKey)))
          return (await store.status(eventKey)) === "accepted" ? "duplicate" : "uncertain";
        claimed = true;
        if (!(await allowed())) {
          await store.forget(subject(email));
          await store.release(eventKey);
          return "skipped";
        }
        if (!(await store.context(subject(email)))) {
          await store.release(eventKey);
          return "skipped";
        }
        posted = true;
        const receipt = await sender.send({
          email,
          eventId: sharedEventId,
          sessionId,
          occurredAt,
        });
        if (receipt === "retry") {
          await store.release(eventKey);
          return "retry";
        }
        await store.finish(eventKey, receipt);
        return receipt;
      } catch {
        if (!posted && claimed && eventKey) await store.release(eventKey).catch(() => {});
        return posted || (claimAttempted && !claimed) ? "uncertain" : "retry";
      }
    },
  };
}
