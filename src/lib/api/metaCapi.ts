// Meta Conversions API — server-side mirror of the browser Lead event.
// Same event_id on both sides means Meta dedupes the pair to one conversion,
// and the server leg survives ad blockers. Fire-and-forget semantics: a Meta
// outage must never fail or noticeably slow a signup.
//
// Server-only env (set in .env locally / Vercel project settings in prod):
//   META_PIXEL_ID              — Events Manager dataset id (same id the browser pixel uses)
//   META_CAPI_ACCESS_TOKEN     — Conversions API token (dataset settings → generate token)
//   META_CAPI_TEST_EVENT_CODE  — optional; set temporarily to see events in Test Events
import { createHash } from "node:crypto";

const GRAPH_URL = "https://graph.facebook.com/v21.0";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function sendMetaLead(args: {
  eventId: string;
  email: string;
  phone?: string;
  ip?: string;
  ua?: string;
  fbp?: string;
  fbc?: string;
  source?: string;
}) {
  // VITE_META_PIXEL_ID fallback: on Vercel every env var reaches process.env,
  // and both must hold the same dataset id anyway.
  const pixelId = process.env.META_PIXEL_ID ?? process.env.VITE_META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) {
    console.log("[meta-capi] skipped: missing env (pixelId or token)");
    return;
  }

  const digitsOnlyPhone = args.phone?.replace(/[^0-9]/g, "");
  const body = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        event_id: args.eventId,
        action_source: "website",
        event_source_url: "https://watchdive.diveroid.com/",
        user_data: {
          em: [sha256(args.email.trim().toLowerCase())],
          ...(digitsOnlyPhone ? { ph: [sha256(digitsOnlyPhone)] } : {}),
          ...(args.ip ? { client_ip_address: args.ip } : {}),
          ...(args.ua ? { client_user_agent: args.ua } : {}),
          ...(args.fbp ? { fbp: args.fbp } : {}),
          ...(args.fbc ? { fbc: args.fbc } : {}),
        },
        custom_data: {
          content_name: "watchdive_email_signup",
          ...(args.source ? { content_category: args.source } : {}),
        },
      },
    ],
    ...(process.env.META_CAPI_TEST_EVENT_CODE
      ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE }
      : {}),
  };

  try {
    const res = await fetch(`${GRAPH_URL}/${pixelId}/events?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
