import assert from "node:assert/strict";
import { test } from "node:test";

import {
  browserWatchDiveMeasurementGateOpen,
  clearWatchDiveMeasurementContext,
  getPendingWatchDiveBrowserEvents,
  getOrCreateWatchDiveMeasurementContext,
  getWatchDiveBrowserEventDeliveryState,
  isWatchDiveBrowserEventCurrentPending,
  launchOsBrowserMeasurementGateAllowed,
  launchOsMeasurementLocaleAllowed,
  markWatchDiveBrowserEventAccepted,
  parseWatchDiveAttribution,
  recordWatchDiveBrowserEvent,
} from "../src/lib/funnelContext.ts";
import { createBoundedBrowserEventDrainer } from "../src/lib/browserEventDelivery.ts";
import {
  grantedOptionalMeasurementConsent,
  isOptionalMeasurementConsentRecord,
} from "../src/lib/measurementConsentContract.ts";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function fill(byte: number) {
  return (bytes: Uint8Array) => bytes.fill(byte);
}

test("LaunchOS consent evidence accepts only the exact explicit grant contract", () => {
  assert.equal(isOptionalMeasurementConsentRecord(grantedOptionalMeasurementConsent()), true);
  assert.equal(
    isOptionalMeasurementConsentRecord({
      purpose: "advertising_measurement",
      state: "granted",
      version: "WD-AD-MEASUREMENT-CONSENT-V1",
      inferred: true,
    }),
    false,
  );
});

test("stable Meta attribution is all-or-nothing and never accepts names", () => {
  assert.deepEqual(
    parseWatchDiveAttribution("?campaign_id=1001&adset_id=2002&ad_id=3003&utm_campaign=Summer"),
    {
      campaignId: "1001",
      adsetId: "2002",
      targetId: "2002",
      adId: "3003",
      contentId: "3003",
    },
  );
  assert.deepEqual(parseWatchDiveAttribution("?campaign_id=1001&adset_id=Summer&ad_id=3003"), {});
  assert.deepEqual(parseWatchDiveAttribution("?campaign_id=1001&ad_id=3003"), {});
  assert.deepEqual(
    parseWatchDiveAttribution("?campaign_id=1001&campaign_id=9999&adset_id=2002&ad_id=3003"),
    {},
  );
});

test("one session freezes first-touch IDs and records each stage placement once", () => {
  const session = storage();
  const consent = grantedOptionalMeasurementConsent();
  const first = getOrCreateWatchDiveMeasurementContext({
    search: "?campaign_id=1001&adset_id=2002&ad_id=3003",
    storage: session,
    consent,
    fillRandom: fill(1),
  });
  const later = getOrCreateWatchDiveMeasurementContext({
    search: "?campaign_id=999&adset_id=888&ad_id=777",
    storage: session,
    consent,
    fillRandom: fill(2),
  });
  assert.deepEqual(later, first);

  const a = recordWatchDiveBrowserEvent("cta_viewed", "hero", {
    storage: session,
    consent,
    fillRandom: fill(3),
    now: () => new Date("2026-08-02T00:00:00.000Z"),
  });
  const retry = recordWatchDiveBrowserEvent("cta_viewed", "hero", {
    storage: session,
    consent,
    fillRandom: fill(4),
    now: () => new Date("2026-08-02T01:00:00.000Z"),
  });
  const offer = recordWatchDiveBrowserEvent("cta_viewed", "offer", {
    storage: session,
    consent,
    fillRandom: fill(5),
  });

  assert.equal(a.event.eventId, retry.event.eventId);
  assert.equal(a.event.occurredAt, retry.event.occurredAt);
  assert.notEqual(a.event.eventId, offer.event.eventId);
  assert.match(a.measurementContext.funnelInstanceId, /^fi_v1_[A-Za-z0-9_-]{32}$/);
  assert.match(a.event.eventId, /^loe_v1_[A-Za-z0-9_-]{32}$/);
});

test("invalid stage placement and missing consent fail closed", () => {
  assert.throws(
    () =>
      recordWatchDiveBrowserEvent("landing_viewed", "hero", {
        storage: storage(),
        consent: grantedOptionalMeasurementConsent(),
      }),
    /placement is invalid/,
  );
  assert.throws(
    () => getOrCreateWatchDiveMeasurementContext({ storage: storage() }),
    /consent is required/,
  );
});

test("browser measurement gate requires feature, locale and an explicit current grant", () => {
  const consent = grantedOptionalMeasurementConsent();
  assert.equal(launchOsMeasurementLocaleAllowed("/"), true);
  assert.equal(launchOsMeasurementLocaleAllowed("/ko"), true);
  assert.equal(launchOsMeasurementLocaleAllowed("/ko/"), true);
  assert.equal(launchOsMeasurementLocaleAllowed("/ja"), false);
  assert.equal(
    launchOsBrowserMeasurementGateAllowed({ pathname: "/", enabled: true, consent }),
    true,
  );
  assert.equal(
    launchOsBrowserMeasurementGateAllowed({ pathname: "/", enabled: false, consent }),
    false,
  );
  assert.equal(
    launchOsBrowserMeasurementGateAllowed({ pathname: "/ja", enabled: true, consent }),
    false,
  );
  assert.equal(launchOsBrowserMeasurementGateAllowed({ pathname: "/", enabled: true }), false);
  // SSR has no browser grant/GPC surface and therefore fails closed.
  assert.equal(browserWatchDiveMeasurementGateOpen(), false);
});

test("failed delivery stays pending and a retry reuses the exact event identity", async () => {
  const session = storage();
  const consent = grantedOptionalMeasurementConsent();
  const first = recordWatchDiveBrowserEvent("cta_viewed", "hero", {
    storage: session,
    consent,
    fillRandom: fill(7),
    now: () => new Date("2026-08-02T02:03:04.000Z"),
  });
  const relayed: Array<{ eventId: string; occurredAt: string }> = [];
  let accepted = false;
  const queue = createBoundedBrowserEventDrainer({
    listPending: () => getPendingWatchDiveBrowserEvents({ storage: session, consent }),
    eventId: (item) => item.event.eventId,
    isCurrentPending: (item) =>
      isWatchDiveBrowserEventCurrentPending(
        item.event.eventId,
        item.measurementContext.funnelInstanceId,
        { storage: session, consent },
      ),
    relay: async (item) => {
      relayed.push({ eventId: item.event.eventId, occurredAt: item.event.occurredAt });
      return { status: accepted ? "accepted" : "failed" };
    },
    markAccepted: (eventId) => {
      return markWatchDiveBrowserEventAccepted(eventId, { storage: session, consent });
    },
  });

  assert.deepEqual(await queue.drain(), { attempted: 1, accepted: 0, pending: 1 });
  assert.equal(
    getWatchDiveBrowserEventDeliveryState(first.event.eventId, { storage: session }),
    "pending",
  );
  const retryCapture = recordWatchDiveBrowserEvent("cta_viewed", "hero", {
    storage: session,
    consent,
    fillRandom: fill(8),
    now: () => new Date("2026-08-02T09:09:09.000Z"),
  });
  assert.equal(retryCapture.event.eventId, first.event.eventId);
  assert.equal(retryCapture.event.occurredAt, first.event.occurredAt);

  accepted = true;
  assert.deepEqual(await queue.drain(), { attempted: 1, accepted: 1, pending: 0 });
  assert.deepEqual(relayed, [
    { eventId: first.event.eventId, occurredAt: first.event.occurredAt },
    { eventId: first.event.eventId, occurredAt: first.event.occurredAt },
  ]);
  assert.equal(
    getWatchDiveBrowserEventDeliveryState(first.event.eventId, { storage: session }),
    "accepted",
  );
  assert.equal(getPendingWatchDiveBrowserEvents({ storage: session, consent }).length, 0);
});

test("disabled and timed-out relays never acknowledge a pending event", async () => {
  const consent = grantedOptionalMeasurementConsent();
  for (const mode of ["disabled", "timeout"] as const) {
    const session = storage();
    const captured = recordWatchDiveBrowserEvent("form_started", "offer", {
      storage: session,
      consent,
      fillRandom: fill(mode === "disabled" ? 9 : 10),
    });
    const queue = createBoundedBrowserEventDrainer(
      {
        listPending: () => getPendingWatchDiveBrowserEvents({ storage: session, consent }),
        eventId: (item) => item.event.eventId,
        isCurrentPending: (item) =>
          isWatchDiveBrowserEventCurrentPending(
            item.event.eventId,
            item.measurementContext.funnelInstanceId,
            { storage: session, consent },
          ),
        relay: async () =>
          mode === "disabled"
            ? { status: "disabled" }
            : await new Promise<{ status: string }>(() => undefined),
        markAccepted: (eventId) => {
          return markWatchDiveBrowserEventAccepted(eventId, { storage: session, consent });
        },
      },
      { timeoutMs: 5 },
    );

    assert.deepEqual(await queue.drain(), { attempted: 1, accepted: 0, pending: 1 });
    assert.equal(
      getWatchDiveBrowserEventDeliveryState(captured.event.eventId, { storage: session }),
      "pending",
    );
  }
});

test("consent cleanup removes pending and accepted browser delivery state", () => {
  const session = storage();
  const consent = grantedOptionalMeasurementConsent();
  const pending = recordWatchDiveBrowserEvent("landing_viewed", "page", {
    storage: session,
    consent,
    fillRandom: fill(11),
  });
  const accepted = recordWatchDiveBrowserEvent("submit_attempted", "offer", {
    storage: session,
    consent,
    fillRandom: fill(12),
  });
  markWatchDiveBrowserEventAccepted(accepted.event.eventId, { storage: session, consent });
  assert.equal(
    getWatchDiveBrowserEventDeliveryState(pending.event.eventId, { storage: session }),
    "pending",
  );
  assert.equal(
    getWatchDiveBrowserEventDeliveryState(accepted.event.eventId, { storage: session }),
    "accepted",
  );

  clearWatchDiveMeasurementContext(session);
  assert.equal(
    markWatchDiveBrowserEventAccepted(pending.event.eventId, { storage: session, consent }),
    false,
  );
  assert.equal(
    getWatchDiveBrowserEventDeliveryState(pending.event.eventId, { storage: session }),
    undefined,
  );
  assert.equal(
    getWatchDiveBrowserEventDeliveryState(accepted.event.eventId, { storage: session }),
    undefined,
  );
});

test("concurrent drain triggers share one relay and one acknowledgement", async () => {
  const session = storage();
  const consent = grantedOptionalMeasurementConsent();
  const captured = recordWatchDiveBrowserEvent("submit_attempted", "hero", {
    storage: session,
    consent,
    fillRandom: fill(13),
  });
  let relayCalls = 0;
  let acceptedWrites = 0;
  let release: ((value: { status: string }) => void) | undefined;
  const queue = createBoundedBrowserEventDrainer({
    listPending: () => getPendingWatchDiveBrowserEvents({ storage: session, consent }),
    eventId: (item) => item.event.eventId,
    isCurrentPending: (item) =>
      isWatchDiveBrowserEventCurrentPending(
        item.event.eventId,
        item.measurementContext.funnelInstanceId,
        { storage: session, consent },
      ),
    relay: async () => {
      relayCalls += 1;
      return await new Promise<{ status: string }>((resolve) => {
        release = resolve;
      });
    },
    markAccepted: (eventId) => {
      acceptedWrites += 1;
      return markWatchDiveBrowserEventAccepted(eventId, { storage: session, consent });
    },
  });

  const first = queue.drain();
  const concurrent = queue.drain();
  assert.equal(first, concurrent);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(relayCalls, 1);
  release?.({ status: "accepted" });
  await Promise.all([first, concurrent]);

  assert.equal(relayCalls, 1);
  assert.equal(acceptedWrites, 1);
  assert.equal(
    getWatchDiveBrowserEventDeliveryState(captured.event.eventId, { storage: session }),
    "accepted",
  );
});

test("consent clear during an in-flight relay prevents the rest of the captured batch", async () => {
  const session = storage();
  const consent = grantedOptionalMeasurementConsent();
  const first = recordWatchDiveBrowserEvent("cta_viewed", "hero", {
    storage: session,
    consent,
    fillRandom: fill(14),
  });
  recordWatchDiveBrowserEvent("form_started", "hero", {
    storage: session,
    consent,
    fillRandom: fill(15),
  });
  let relayCalls = 0;
  let release: ((value: { status: string }) => void) | undefined;
  const queue = createBoundedBrowserEventDrainer({
    listPending: () => getPendingWatchDiveBrowserEvents({ storage: session, consent }),
    eventId: (item) => item.event.eventId,
    isCurrentPending: (item) =>
      isWatchDiveBrowserEventCurrentPending(
        item.event.eventId,
        item.measurementContext.funnelInstanceId,
        { storage: session, consent },
      ),
    relay: async () => {
      relayCalls += 1;
      if (relayCalls === 1) {
        return await new Promise<{ status: string }>((resolve) => {
          release = resolve;
        });
      }
      return { status: "accepted" };
    },
    markAccepted: (eventId) =>
      markWatchDiveBrowserEventAccepted(eventId, { storage: session, consent }),
  });

  const draining = queue.drain();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(relayCalls, 1);
  clearWatchDiveMeasurementContext(session);
  release?.({ status: "accepted" });

  assert.deepEqual(await draining, { attempted: 1, accepted: 0, pending: 1 });
  assert.equal(relayCalls, 1);
  assert.equal(
    getWatchDiveBrowserEventDeliveryState(first.event.eventId, { storage: session }),
    undefined,
  );
});
