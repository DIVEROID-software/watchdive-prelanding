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

const GRAPH_URL = "https://graph.facebook.com/v21.0";
const META_REQUEST_TIMEOUT_MS = 5_000;

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
  hasPhone: boolean;
  ip?: string;
  ua?: string;
  fbp?: string;
  fbc?: string;
}) {
  const config = metaCapiConfig();
  if (!config) {
    console.log("[meta-capi] skipped: disabled or invalid/mismatched configuration");
    return;
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const userData = {
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
        event_source_url: "https://watchdive.diveroid.com/",
        user_data: userData,
      },
      ...(args.hasPhone
        ? [
            {
              event_name: "Contact",
              event_time: eventTime,
              event_id: `${args.eventId}:phone`,
              action_source: "website",
              event_source_url: "https://watchdive.diveroid.com/",
              user_data: userData,
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
    } else {
      const json = (await res.json()) as { fbtrace_id?: string };
      console.log(
        `[meta-capi] Lead sent event_id=${args.eventId} fbtrace=${json.fbtrace_id ?? "?"}`,
      );
    }
  } catch (err) {
    console.error("Meta CAPI Lead error", err);
  }
}
