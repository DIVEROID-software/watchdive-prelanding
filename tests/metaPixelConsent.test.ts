import assert from "node:assert/strict";
import test from "node:test";

import {
  enqueueMetaStandardEvent,
  isMetaMeasurementAllowed,
  metaEventIdForSubmissionAttempt,
} from "../src/lib/metaPixel.ts";

test("Meta measurement is denied until an explicit grant exists", () => {
  assert.equal(
    isMetaMeasurementAllowed({
      configured: true,
      consent: null,
      globalPrivacyControl: false,
    }),
    false,
  );
  assert.equal(
    isMetaMeasurementAllowed({
      configured: true,
      consent: "denied",
      globalPrivacyControl: false,
    }),
    false,
  );
});

test("Meta measurement requires configuration and continues to honor GPC", () => {
  assert.equal(
    isMetaMeasurementAllowed({
      configured: true,
      consent: "granted",
      globalPrivacyControl: false,
    }),
    true,
  );
  assert.equal(
    isMetaMeasurementAllowed({
      configured: false,
      consent: "granted",
      globalPrivacyControl: false,
    }),
    false,
  );
  assert.equal(
    isMetaMeasurementAllowed({
      configured: true,
      consent: "granted",
      globalPrivacyControl: true,
    }),
    false,
  );
});

test("a failed form submission reuses its pending Meta event id until success", () => {
  assert.equal(metaEventIdForSubmissionAttempt(undefined, false), undefined);

  const firstAttempt = metaEventIdForSubmissionAttempt(undefined, true);
  assert.ok(firstAttempt);
  assert.equal(metaEventIdForSubmissionAttempt(firstAttempt, true), firstAttempt);
});

test("Meta browser dispatch reports success only after the Pixel queue accepts the event", () => {
  const calls: unknown[][] = [];
  const accepted = enqueueMetaStandardEvent({
    fbq: (...args) => calls.push(args),
    eventName: "Lead",
    eventId: "valid-event-id",
    source: "hero",
    contentName: "watchdive_email_signup",
  });

  assert.equal(accepted, true);
  assert.deepEqual(calls, [
    [
      "track",
      "Lead",
      { content_name: "watchdive_email_signup", content_category: "hero" },
      { eventID: "valid-event-id" },
    ],
  ]);

  assert.equal(
    enqueueMetaStandardEvent({
      fbq: () => {
        throw new Error("queue unavailable");
      },
      eventName: "Lead",
      eventId: "valid-event-id",
      source: "hero",
      contentName: "watchdive_email_signup",
    }),
    false,
  );
  assert.equal(
    enqueueMetaStandardEvent({
      fbq: (...args) => calls.push(args),
      eventName: "Lead",
      eventId: "bad",
      source: "hero",
      contentName: "watchdive_email_signup",
    }),
    false,
  );
});
