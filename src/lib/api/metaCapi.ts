// Meta Conversions API — server-side mirror of the browser pixel events.
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
  /** First-touch campaign tags, forwarded as custom_data on the submit Lead. */
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
  /** Page the visitor landed on, e.g. `/` or `/ko`. Joined to the public origin. */
  landingPath?: string;
};

const PUBLIC_ORIGIN = "https://watchdive.diveroid.com";

function eventSourceUrl(landingPath: string | undefined): string {
  if (!landingPath || !landingPath.startsWith("/") || landingPath.startsWith("//")) {
    return `${PUBLIC_ORIGIN}/`;
  }
  return `${PUBLIC_ORIGIN}${landingPath}`;
}

function utmCustomData(utm: MetaEventArgs["utm"]): Record<string, string> {
  if (!utm) return {};
  const out: Record<string, string> = {};
  if (utm.source) out.utm_source = utm.source;
  if (utm.medium) out.utm_medium = utm.medium;
  if (utm.campaign) out.utm_campaign = utm.campaign;
  if (utm.content) out.utm_content = utm.content;
  if (utm.term) out.utm_term = utm.term;
  return out;
}

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

async function postEvents(
  config: { pixelId: string; token: string },
  label: string,
  data: Record<string, unknown>[],
): Promise<boolean> {
  const body = {
    data,
    ...(process.env.META_CAPI_TEST_EVENT_CODE
      ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE }
      : {}),
  };
  const eventId = String(data[0]?.event_id ?? "?");
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
      console.error(`Meta CAPI ${label} failed (${res.status}): ${detail.slice(0, 300)}`);
      return false;
    }
    const json = (await res.json()) as { events_received?: number; fbtrace_id?: string };
    if ((json.events_received ?? 0) < data.length) {
      console.error(
        `[meta-capi] incomplete acknowledgement event_id=${eventId} expected=${data.length} received=${json.events_received ?? 0}`,
      );
      return false;
    }
    console.log(
      `[meta-capi] ${label} sent event_id=${eventId} events=${json.events_received} fbtrace=${json.fbtrace_id ?? "?"}`,
    );
    return true;
  } catch (err) {
    console.error(`Meta CAPI ${label} error`, err);
    return false;
  }
}

/**
 * The submit-time `Lead` — the optimisation event (2026-09-26).
 *
 * Sent when the server accepts an email submit, with the same `event_id` the
 * browser pixel uses, so Meta deduplicates the pair into one conversion and the
 * server leg survives ad blockers. Carries the pixel cookies, client IP/UA and
 * the first-touch UTM tags. An unconfirmed phone number gets no `Contact`.
 */
export async function sendMetaLead(args: MetaEventArgs): Promise<boolean> {
  const config = metaCapiConfig();
  if (!config) {
    console.log("[meta-capi] skipped: disabled or invalid/mismatched configuration");
    return false;
  }

  return postEvents(config, "Lead", [
    {
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      event_id: args.eventId,
      action_source: "website",
      event_source_url: eventSourceUrl(args.landingPath),
      user_data: hashedUserData(args, args.phone?.replace(/[^0-9]/g, "")),
      custom_data: {
        content_name: "watchdive_email_signup",
        ...(args.source ? { content_category: args.source } : {}),
        ...utmCustomData(args.utm),
      },
    },
  ]);
}

/**
 * The confirmation click, mirrored from the browser `EmailVerified` custom
 * event under the deterministic verification event id. Deliberately not a
 * second `Lead`: the Lead already fired at submit. A confirmed phone number
 * adds the standard `Contact` event.
 */
export async function sendMetaEmailVerified(args: MetaEventArgs): Promise<boolean> {
  const config = metaCapiConfig();
  if (!config) {
    console.log("[meta-capi] skipped: disabled or invalid/mismatched configuration");
    return false;
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const digitsOnlyPhone = args.phone?.replace(/[^0-9]/g, "");
  const userData = hashedUserData(args, digitsOnlyPhone);
  return postEvents(config, "EmailVerified", [
    {
      event_name: "EmailVerified",
      event_time: eventTime,
      event_id: args.eventId,
      action_source: "website",
      event_source_url: `${PUBLIC_ORIGIN}/`,
      user_data: userData,
      custom_data: {
        content_name: "watchdive_email_verified",
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
            event_source_url: `${PUBLIC_ORIGIN}/`,
            user_data: userData,
            custom_data: {
              content_name: "watchdive_phone_signup",
              ...(args.source ? { content_category: args.source } : {}),
            },
          },
        ]
      : []),
  ]);
}

/**
 * The CRM leg of Meta's Conversion Leads ("qualified leads") integration.
 *
 * Where the website events mirror the browser pixel, this one reports a CRM stage
 * transition: the lead record in Notion moving to its verified stage. Meta's
 * integration contract requires `action_source: "system_generated"` and the
 * `event_source: "crm"` / `lead_event_source` custom fields, and matches the
 * person by hashed email. The event id is derived from the attempt id with a
 * distinct suffix so this event never dedupes against the website `Lead` pair —
 * they are different funnel facts, not two halves of one conversion.
 */
export async function sendMetaCrmQualifiedLead(args: MetaEventArgs): Promise<boolean> {
  const config = metaCapiConfig();
  if (!config) {
    console.log("[meta-capi] skipped: disabled or invalid/mismatched configuration");
    return false;
  }

  const digitsOnlyPhone = args.phone?.replace(/[^0-9]/g, "");
  // No browser context on purpose: a CRM stage change has no client IP, user
  // agent or click cookie of its own, and borrowing the signup's would claim a
  // provenance the event does not have.
  const body = {
    data: [
      {
        event_name: "LeadVerified",
        event_time: Math.floor(Date.now() / 1000),
        event_id: `${args.eventId}:crm`,
        action_source: "system_generated",
        user_data: {
          em: [sha256(args.email.trim().toLowerCase())],
          ...(digitsOnlyPhone ? { ph: [sha256(digitsOnlyPhone)] } : {}),
        },
        custom_data: {
          event_source: "crm",
          lead_event_source: "Notion",
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
      console.error(`Meta CAPI LeadVerified failed (${res.status}): ${detail.slice(0, 300)}`);
      return false;
    }
    const json = (await res.json()) as { events_received?: number; fbtrace_id?: string };
    if ((json.events_received ?? 0) < 1) {
      console.error(
        `[meta-capi] incomplete acknowledgement event_id=${args.eventId}:crm expected=1 received=${json.events_received ?? 0}`,
      );
      return false;
    }
    console.log(
      `[meta-capi] LeadVerified sent event_id=${args.eventId}:crm events=${json.events_received} fbtrace=${json.fbtrace_id ?? "?"}`,
    );
    return true;
  } catch (err) {
    console.error("Meta CAPI LeadVerified error", err);
    return false;
  }
}
