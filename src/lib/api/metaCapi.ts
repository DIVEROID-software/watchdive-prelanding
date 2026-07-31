// Meta Conversions API — server-side mirror of the browser Lead event.
// Same event_id on both sides means Meta dedupes the pair to one conversion,
// and the server leg survives ad blockers. Delivery errors never fail a signup,
// and the request timeout bounds any delay caused by a Meta outage.
//
// Server-only env (set in .env locally / Vercel project settings in prod):
//   META_PIXEL_ID              — Events Manager dataset id (same id the browser pixel uses)
//   META_CAPI_ACCESS_TOKEN     — Conversions API token (dataset settings → generate token)
//   META_CAPI_TEST_EVENT_CODE  — optional; set temporarily to see events in Test Events
//   META_CAPI_ENABLED           — must equal "true" before any event can be sent
//   VITE_META_TRACKING_ENABLED  — browser and server measurement master gate
import { createHash } from "node:crypto";

const GRAPH_URL = "https://graph.facebook.com/v21.0";
const META_REQUEST_TIMEOUT_MS = 5_000;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function metaCapiConfig(): { pixelId: string; token: string } | null {
  const capiEnabled = (process.env.META_CAPI_ENABLED ?? "").trim() === "true";
  const browserEnabled = (process.env.VITE_META_TRACKING_ENABLED ?? "").trim() === "true";
  const pixelId = (process.env.META_PIXEL_ID ?? "").trim();
  const browserPixelId = (process.env.VITE_META_PIXEL_ID ?? "").trim();
  const token = (process.env.META_CAPI_ACCESS_TOKEN ?? "").trim();

  if (
    !capiEnabled ||
    !browserEnabled ||
    !/^\d{10,20}$/.test(pixelId) ||
    pixelId !== browserPixelId ||
    !token
  ) {
    return null;
  }

  return { pixelId, token };
}

type MetaEventArgs = {
  eventId: string;
  email: string;
  phone?: string;
  ip?: string;
  ua?: string;
  fbp?: string;
  fbc?: string;
  source?: string;
};

// The address is hashed here and nowhere else in this module, so no path exists
// that sends a raw identifier to Meta.
function hashedUserData(args: MetaEventArgs, digitsOnlyPhone: string | undefined) {
  return {
    em: [sha256(args.email.trim().toLowerCase())],
    ...(digitsOnlyPhone ? { ph: [sha256(digitsOnlyPhone)] } : {}),
    ...(args.ip ? { client_ip_address: args.ip } : {}),
    ...(args.ua ? { client_user_agent: args.ua } : {}),
    ...(args.fbp ? { fbp: args.fbp } : {}),
    ...(args.fbc ? { fbc: args.fbc } : {}),
  };
}

export async function sendMetaLead(args: MetaEventArgs): Promise<boolean> {
  const config = metaCapiConfig();
  if (!config) {
    console.log("[meta-capi] skipped: disabled or invalid/mismatched configuration");
    return false;
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const digitsOnlyPhone = args.phone?.replace(/[^0-9]/g, "");
  const userData = hashedUserData(args, digitsOnlyPhone);
  const body = {
    data: [
      {
        event_name: "Lead",
        event_time: eventTime,
        event_id: args.eventId,
        action_source: "website",
        event_source_url: "https://watchdive.diveroid.com/",
        user_data: userData,
        custom_data: {
          content_name: "watchdive_email_signup",
          ...(args.source ? { content_category: args.source } : {}),
        },
      },
      ...(digitsOnlyPhone
        ? [
            {
              event_name: "Contact",
              event_time: eventTime,
              event_id: `${args.eventId}:phone`,
              action_source: "website",
              event_source_url: "https://watchdive.diveroid.com/",
              user_data: userData,
              custom_data: {
                content_name: "watchdive_phone_signup",
                ...(args.source ? { content_category: args.source } : {}),
              },
            },
          ]
        : []),
    ],
    ...(process.env.META_CAPI_TEST_EVENT_CODE
      ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE }
      : {}),
  };

  try {
    const res = await fetch(`${GRAPH_URL}/${config.pixelId}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error(`Meta CAPI Lead failed (${res.status}): ${detail.slice(0, 300)}`);
      return false;
    } else {
      const json = (await res.json()) as { events_received?: number; fbtrace_id?: string };
      const expectedEvents = digitsOnlyPhone ? 2 : 1;
      if ((json.events_received ?? 0) < expectedEvents) {
        console.error(
          `[meta-capi] incomplete acknowledgement event_id=${args.eventId} expected=${expectedEvents} received=${json.events_received ?? 0}`,
        );
        return false;
      }
      console.log(
        `[meta-capi] Lead sent event_id=${args.eventId} events=${json.events_received} fbtrace=${json.fbtrace_id ?? "?"}`,
      );
      return true;
    }
  } catch (err) {
    console.error("Meta CAPI Lead error", err);
    return false;
  }
}

/**
 * The submit-time counterpart of `sendMetaLead`, sharing its dedupe contract:
 * the browser fires `SubmitApplication` with the same `event_id`, so Meta
 * collapses the pair into one event and the server leg survives an ad blocker.
 *
 * A separate event name, not a second `Lead`. `Lead` continues to count only
 * confirmed addresses; this one exists to give delivery enough volume to
 * optimise against, and conflating the two would cost the truth metric.
 */
export async function sendMetaSubmitApplication(args: MetaEventArgs): Promise<boolean> {
  const config = metaCapiConfig();
  if (!config) {
    console.log("[meta-capi] skipped: disabled or invalid/mismatched configuration");
    return false;
  }

  // No `Contact` companion here: a phone number that has not been confirmed is
  // not an acquisition, and `Contact` already has that meaning on the Lead leg.
  const body = {
    data: [
      {
        event_name: "SubmitApplication",
        event_time: Math.floor(Date.now() / 1000),
        event_id: args.eventId,
        action_source: "website",
        event_source_url: "https://watchdive.diveroid.com/",
        user_data: hashedUserData(args, args.phone?.replace(/[^0-9]/g, "")),
        custom_data: {
          content_name: "watchdive_email_submit",
          ...(args.source ? { content_category: args.source } : {}),
        },
      },
    ],
    ...(process.env.META_CAPI_TEST_EVENT_CODE
      ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE }
      : {}),
  };

  try {
    const res = await fetch(`${GRAPH_URL}/${config.pixelId}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error(`Meta CAPI SubmitApplication failed (${res.status}): ${detail.slice(0, 300)}`);
      return false;
    }
    const json = (await res.json()) as { events_received?: number; fbtrace_id?: string };
    if ((json.events_received ?? 0) < 1) {
      console.error(
        `[meta-capi] incomplete acknowledgement event_id=${args.eventId} expected=1 received=${json.events_received ?? 0}`,
      );
      return false;
    }
    console.log(
      `[meta-capi] SubmitApplication sent event_id=${args.eventId} events=${json.events_received} fbtrace=${json.fbtrace_id ?? "?"}`,
    );
    return true;
  } catch (err) {
    console.error("Meta CAPI SubmitApplication error", err);
    return false;
  }
}
