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

export type MetaCapiResult = {
  state: "sent" | "skipped" | "failed";
  sent: boolean;
  expectedEvents: number;
  eventsReceived: number;
  leadEventId?: string;
  phoneEventId?: string;
};

export function metaPhoneEventIdForInput(eventId: string, phone?: string): string | undefined {
  const digits = phone?.replace(/[^0-9]/g, "") ?? "";
  return digits.length >= 7 && digits.length <= 15 ? `${eventId}:phone` : undefined;
}

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

export async function sendMetaLead(args: {
  eventId: string;
  email: string;
  phone?: string;
  ip?: string;
  ua?: string;
  fbp?: string;
  fbc?: string;
  source?: string;
  eventSourceUrl?: string;
}): Promise<MetaCapiResult> {
  const config = metaCapiConfig();
  if (!config) {
    console.log("[meta-capi] skipped: disabled or invalid/mismatched configuration");
    return {
      state: "skipped",
      sent: false,
      expectedEvents: 0,
      eventsReceived: 0,
    };
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const phoneCandidate = args.phone?.replace(/[^0-9]/g, "") ?? "";
  const phoneEventId = metaPhoneEventIdForInput(args.eventId, args.phone);
  const digitsOnlyPhone = phoneEventId ? phoneCandidate : undefined;
  const expectedEvents = digitsOnlyPhone ? 2 : 1;
  const eventSourceUrl = sanitizeMetaEventSourceUrl(args.eventSourceUrl);
  const userData = {
    em: [sha256(args.email.trim().toLowerCase())],
    ...(digitsOnlyPhone ? { ph: [sha256(digitsOnlyPhone)] } : {}),
    ...(args.ip ? { client_ip_address: args.ip } : {}),
    ...(args.ua ? { client_user_agent: args.ua } : {}),
    ...(args.fbp ? { fbp: args.fbp } : {}),
    ...(args.fbc ? { fbc: args.fbc } : {}),
  };
  const body = {
    data: [
      {
        event_name: "Lead",
        event_time: eventTime,
        event_id: args.eventId,
        action_source: "website",
        event_source_url: eventSourceUrl,
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
              event_source_url: eventSourceUrl,
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
      // A third-party error body is not required for measurement state and can
      // contain request diagnostics. Keep logs free of submitted identifiers.
      console.error(`Meta CAPI Lead failed (${res.status})`);
      return {
        state: "failed",
        sent: false,
        expectedEvents,
        eventsReceived: 0,
        leadEventId: args.eventId,
        ...(phoneEventId ? { phoneEventId } : {}),
      };
    } else {
      const json = (await res.json()) as { events_received?: number; fbtrace_id?: string };
      if ((json.events_received ?? 0) < expectedEvents) {
        console.error(
          `[meta-capi] incomplete acknowledgement event_id=${args.eventId} expected=${expectedEvents} received=${json.events_received ?? 0}`,
        );
        return {
          state: "failed",
          sent: false,
          expectedEvents,
          eventsReceived: json.events_received ?? 0,
          leadEventId: args.eventId,
          ...(phoneEventId ? { phoneEventId } : {}),
        };
      }
      console.log(
        `[meta-capi] Lead sent event_id=${args.eventId} events=${json.events_received} fbtrace=${json.fbtrace_id ?? "?"}`,
      );
      return {
        state: "sent",
        sent: true,
        expectedEvents,
        eventsReceived: json.events_received ?? 0,
        leadEventId: args.eventId,
        ...(phoneEventId ? { phoneEventId } : {}),
      };
    }
  } catch (err) {
    console.error("Meta CAPI Lead error", err);
    return {
      state: "failed",
      sent: false,
      expectedEvents,
      eventsReceived: 0,
      leadEventId: args.eventId,
      ...(phoneEventId ? { phoneEventId } : {}),
    };
  }
}

export function sanitizeMetaEventSourceUrl(value?: string): string {
  const origin = "https://watchdive.diveroid.com";
  if (!value) return `${origin}/`;
  try {
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) return `${origin}/`;
    return `${origin}${parsed.pathname || "/"}`;
  } catch {
    return `${origin}/`;
  }
}
