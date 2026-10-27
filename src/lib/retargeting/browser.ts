// Browser half. Call this only with the payload the server returned in JSON.
// Do not read the URL, the success screen, or a Notion checkbox here.
// This file does not import node:crypto. Client code imports this file, not capi.ts.

import {
  trackGoogleDurableSignup,
  trackGoogleReservationPurchase,
  type GoogleTagConfig,
} from "../googleTag.ts";
import { measurementPermitted, trackMetaRetargetingEvent } from "../metaPixel.ts";
import type { BrowserRetargetingEvent } from "./events.ts";
import { retargetingEventIsFresh } from "./freshness.ts";
import { paramsAreMeasurementSafe } from "./privacy.ts";

export type BrowserTrackResult = {
  pixel: boolean;
  googleAds: boolean;
  ga4Purchase: boolean;
  reason: "fired" | "no_payload" | "consent" | "unsafe" | "stale" | "pixel_off";
};

export type BrowserSinks = {
  consentGranted?: boolean;
  pixel?: (event: BrowserRetargetingEvent) => boolean;
  signupConversion?: (eventId: string) => boolean;
  purchase?: (eventId: string) => { ads: boolean; ga4: boolean };
};

function safeParams(event: BrowserRetargetingEvent): Record<string, unknown> {
  return {
    content_name: event.contentName,
    value: event.value,
    currency: event.currency,
    ...(event.signupLocale ? { signup_locale: event.signupLocale } : {}),
    ...(event.source ? { content_category: event.source } : {}),
  };
}

export function trackRetargetingBrowser(
  event: BrowserRetargetingEvent | null | undefined,
  sinks?: BrowserSinks,
  googleConfig?: GoogleTagConfig,
): BrowserTrackResult {
  if (!event) return { pixel: false, googleAds: false, ga4Purchase: false, reason: "no_payload" };
  const consent = sinks?.consentGranted ?? measurementPermitted();
  if (!consent) return { pixel: false, googleAds: false, ga4Purchase: false, reason: "consent" };
  // A tab left open past 48 hours must not stamp a new conversion on Allow.
  if (!retargetingEventIsFresh(event.eventTime, Math.floor(Date.now() / 1000))) {
    return { pixel: false, googleAds: false, ga4Purchase: false, reason: "stale" };
  }
  const params = safeParams(event);
  if (!paramsAreMeasurementSafe({ ...params, eventId: event.eventId })) {
    return { pixel: false, googleAds: false, ga4Purchase: false, reason: "unsafe" };
  }

  // Meta deduplicates a shared event_id only for about 48 hours after the first
  // receipt, and a server event is not dropped merely because the same id
  // arrives from the browser later. When the durable sender owns Purchase,
  // the pixel must not fire at all. Google Ads and GA4 keep their own guards.
  const serverOwnsMetaPurchase =
    event.eventName === "Purchase" && event.metaDelivery === "server";
  const pixel = serverOwnsMetaPurchase
    ? false
    : sinks?.pixel
    ? sinks.pixel(event)
    : trackMetaRetargetingEvent(event.eventName, event.eventId, {
        content_name: event.contentName,
        value: event.value,
        currency: event.currency,
        ...(event.signupLocale ? { signup_locale: event.signupLocale } : {}),
        ...(event.source ? { content_category: event.source } : {}),
      });

  let googleAds = false;
  let ga4Purchase = false;
  const useLiveGoogle = !sinks;
  // The signup label is verified email, not the raw form Lead. Lead stays Meta CAPI.
  if (event.eventName === "CompleteRegistration") {
    if (sinks?.signupConversion) googleAds = sinks.signupConversion(event.eventId);
    else if (useLiveGoogle) googleAds = trackGoogleDurableSignup(event.eventId, googleConfig);
  } else if (event.eventName === "Purchase") {
    const purchase = sinks?.purchase
      ? sinks.purchase(event.eventId)
      : useLiveGoogle
        ? trackGoogleReservationPurchase(event.eventId, googleConfig)
        : { ads: false, ga4: false };
    googleAds = purchase.ads;
    ga4Purchase = purchase.ga4;
  }

  if (!pixel && !googleAds && !ga4Purchase) {
    return { pixel: false, googleAds: false, ga4Purchase: false, reason: "pixel_off" };
  }
  return { pixel, googleAds, ga4Purchase, reason: "fired" };
}
