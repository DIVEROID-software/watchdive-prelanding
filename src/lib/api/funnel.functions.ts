import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import {
  CLIENT_FUNNEL_EVENT_NAMES,
  CLIENT_FUNNEL_SOURCES,
  FUNNEL_EVENT_NAMES,
  FUNNEL_SCHEMA_VERSION,
  MAX_CLIENT_FUNNEL_EVENTS_PER_REQUEST,
  type FunnelAttribution,
  type FunnelEventName,
  type FunnelPropertyValue,
  type FunnelEventInput,
  type FunnelLeadOutcome,
} from "../funnel/types.ts";

const propertyValueSchema = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const clientPropertiesSchema = z
  .object({
    viewport_width: z.number().int().min(1).max(20_000).optional(),
    viewport_height: z.number().int().min(1).max(20_000).optional(),
    duplicate: z.boolean().optional(),
    error_code: z.enum(["join_waitlist_failed"]).optional(),
    autoplay: z.boolean().optional(),
    viewable: z.boolean().optional(),
  })
  .strict();

const attributionSchema = z
  .object({
    utmSource: z.string().max(300).optional(),
    utmMedium: z.string().max(300).optional(),
    utmCampaign: z.string().max(300).optional(),
    utmContent: z.string().max(300).optional(),
    utmTerm: z.string().max(300).optional(),
    metaCampaignId: z.string().max(100).optional(),
    metaAdSetId: z.string().max(100).optional(),
    metaAdId: z.string().max(100).optional(),
    metaCampaignName: z.string().max(300).optional(),
    metaAdSetName: z.string().max(300).optional(),
    metaAdName: z.string().max(300).optional(),
    publisherPlatform: z.string().max(100).optional(),
    placement: z.string().max(200).optional(),
    fbclid: z.string().max(300).optional(),
  })
  .strict();

const funnelEventSchema = z
  .object({
    eventId: z.string().uuid(),
    sessionId: z.string().uuid(),
    visitorId: z.string().uuid().optional(),
    eventName: z.enum(FUNNEL_EVENT_NAMES),
    occurredAt: z.string().datetime(),
    acquisitionPath: z.enum(["website", "instant_form"]),
    source: z.string().max(100).optional(),
    pagePath: z.string().max(500).optional(),
    referrerHost: z.string().max(300).optional(),
    attribution: attributionSchema.optional(),
    properties: z.record(z.string().max(80), propertyValueSchema).optional(),
    schemaVersion: z.literal(FUNNEL_SCHEMA_VERSION),
  })
  .strict();

const clientFunnelEventSchema = funnelEventSchema
  .extend({
    eventName: z.enum(CLIENT_FUNNEL_EVENT_NAMES),
    acquisitionPath: z.literal("website"),
    source: z.enum(CLIENT_FUNNEL_SOURCES).optional(),
    pagePath: z.literal("/").optional(),
    properties: clientPropertiesSchema.optional(),
  })
  .superRefine((event, context) => {
    const deltaMs = Math.abs(Date.now() - Date.parse(event.occurredAt));
    if (!Number.isFinite(deltaMs) || deltaMs > 10 * 60_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["occurredAt"],
        message: "Client event time must be within 10 minutes of receipt",
      });
    }
  });

const funnelEventsSchema = z.object({
  events: z.array(clientFunnelEventSchema).min(1).max(MAX_CLIENT_FUNNEL_EVENTS_PER_REQUEST),
});

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

function runtimeEnvironment(): "production" | "preview" | "development" {
  const value = process.env.VERCEL_ENV;
  if (value === "production" || value === "preview") return value;
  return "development";
}

function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

function requestCountry(): string | undefined {
  try {
    const country = getRequestHeader("x-vercel-ip-country")?.trim().toUpperCase();
    return country && /^[A-Z]{2}$/.test(country) ? country : undefined;
  } catch {
    return undefined;
  }
}

const clientEventWindows = new Map<string, { startedAt: number; count: number }>();

function clientEventRateAllowed(eventCount: number): boolean {
  let key = "unknown";
  try {
    key =
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ||
      getRequestHeader("x-real-ip")?.trim() ||
      "unknown";
  } catch {
    // Tests and non-request contexts share the conservative unknown bucket.
  }

  const now = Date.now();
  const current = clientEventWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    clientEventWindows.set(key, { startedAt: now, count: eventCount });
  } else {
    current.count += eventCount;
    if (current.count > 120) return false;
  }

  if (clientEventWindows.size > 1_000) {
    for (const [candidate, window] of clientEventWindows) {
      if (now - window.startedAt >= 60_000) clientEventWindows.delete(candidate);
      if (clientEventWindows.size <= 900) break;
    }
  }
  return true;
}

async function postgrestInsert(
  table: "funnel_events" | "funnel_leads",
  rows: Array<Record<string, unknown>>,
  resolution: "ignore-duplicates" | "merge-duplicates" = "ignore-duplicates",
): Promise<boolean> {
  const config = getSupabaseConfig();
  if (!config) {
    console.warn(`[funnel] storage skipped (${table}): Supabase env is not configured`);
    return false;
  }

  try {
    const response = await fetch(`${config.url}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: `resolution=${resolution},return=minimal`,
      },
      body: JSON.stringify(rows),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(
        `[funnel] ${table} insert failed (${response.status}): ${detail.slice(0, 300)}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[funnel] ${table} insert error`, error);
    return false;
  }
}

function eventRow(event: FunnelEventInput, country?: string): Record<string, unknown> {
  const attribution = event.attribution ?? {};
  return {
    id: event.eventId,
    session_id: event.sessionId,
    visitor_id: event.visitorId ?? null,
    event_name: event.eventName,
    occurred_at: event.occurredAt,
    acquisition_path: event.acquisitionPath,
    source: event.source ?? null,
    page_path: event.pagePath ?? null,
    referrer_host: event.referrerHost ?? null,
    country: country ?? null,
    utm_source: attribution.utmSource ?? null,
    utm_medium: attribution.utmMedium ?? null,
    utm_campaign: attribution.utmCampaign ?? null,
    utm_content: attribution.utmContent ?? null,
    utm_term: attribution.utmTerm ?? null,
    meta_campaign_id: attribution.metaCampaignId ?? null,
    meta_adset_id: attribution.metaAdSetId ?? null,
    meta_ad_id: attribution.metaAdId ?? null,
    meta_campaign_name: attribution.metaCampaignName ?? null,
    meta_adset_name: attribution.metaAdSetName ?? null,
    meta_ad_name: attribution.metaAdName ?? null,
    publisher_platform: attribution.publisherPlatform ?? null,
    placement: attribution.placement ?? null,
    fbclid: attribution.fbclid ?? null,
    properties: event.properties ?? {},
    schema_version: event.schemaVersion,
    environment: runtimeEnvironment(),
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    landing_page_version: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  };
}

export const recordFunnelEvents = createServerFn({ method: "POST" })
  .validator(funnelEventsSchema)
  .handler(async ({ data }) => {
    if (!clientEventRateAllowed(data.events.length)) {
      return { ok: false, configured: Boolean(getSupabaseConfig()), accepted: 0 };
    }
    const country = requestCountry();
    const inserted = await postgrestInsert(
      "funnel_events",
      data.events.map((event) => eventRow(event, country)),
    );
    return { ok: inserted, configured: Boolean(getSupabaseConfig()), accepted: data.events.length };
  });

export async function recordLeadOutcome(outcome: FunnelLeadOutcome): Promise<boolean> {
  const attribution = outcome.attribution ?? {};
  return postgrestInsert(
    "funnel_leads",
    [
      {
        lead_id: outcome.leadId,
        event_id: outcome.eventId ?? null,
        session_id: outcome.sessionId ?? null,
        visitor_id: outcome.visitorId ?? null,
        acquisition_path: outcome.acquisitionPath,
        source: outcome.source ?? null,
        page_path: outcome.pagePath ?? null,
        country: outcome.country ?? null,
        status: outcome.status,
        valid: outcome.valid,
        has_email: outcome.hasEmail ?? true,
        has_phone: outcome.hasPhone ?? false,
        // Verification is monotonic. Omit unknown fields from an upsert so a
        // webhook/response-loss retry cannot turn an already-true value false.
        // New rows receive the table defaults.
        ...(outcome.verified === true ? { verified: true } : {}),
        ...(outcome.emailVerified === true ? { email_verified: true } : {}),
        ...(outcome.phoneVerified === true ? { phone_verified: true } : {}),
        measurement_consent: outcome.measurementConsent ?? false,
        meta_eligible: outcome.metaEligible ?? false,
        meta_capi_state: outcome.metaCapiState ?? "skipped",
        meta_events_received: outcome.metaEventsReceived ?? 0,
        notion_page_id: outcome.notionPageId ?? null,
        signed_up_at: outcome.signedUpAt,
        flags: outcome.flags ?? [],
        utm_source: attribution.utmSource ?? null,
        utm_medium: attribution.utmMedium ?? null,
        utm_campaign: attribution.utmCampaign ?? null,
        utm_content: attribution.utmContent ?? null,
        utm_term: attribution.utmTerm ?? null,
        meta_campaign_id: attribution.metaCampaignId ?? null,
        meta_adset_id: attribution.metaAdSetId ?? null,
        meta_ad_id: attribution.metaAdId ?? null,
        meta_campaign_name: attribution.metaCampaignName ?? null,
        meta_adset_name: attribution.metaAdSetName ?? null,
        meta_ad_name: attribution.metaAdName ?? null,
        publisher_platform: attribution.publisherPlatform ?? null,
        placement: attribution.placement ?? null,
        schema_version: outcome.schemaVersion,
        environment: runtimeEnvironment(),
        deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? null,
        landing_page_version: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      },
    ],
    "merge-duplicates",
  );
}

export type LeadVerificationMethod = "email" | "phone";

export type LeadVerificationContext = {
  leadId: string;
  acquisitionPath: "website" | "instant_form";
  source?: string;
  notionPageId?: string;
  signedUpAt: string;
  attribution: FunnelAttribution;
};

type StoredLeadContextRow = {
  lead_id?: unknown;
  acquisition_path?: unknown;
  source?: unknown;
  notion_page_id?: unknown;
  signed_up_at?: unknown;
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  utm_content?: unknown;
  utm_term?: unknown;
  meta_campaign_id?: unknown;
  meta_adset_id?: unknown;
  meta_ad_id?: unknown;
  meta_campaign_name?: unknown;
  meta_adset_name?: unknown;
  meta_ad_name?: unknown;
  publisher_platform?: unknown;
  placement?: unknown;
};

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function storedLeadContext(row: StoredLeadContextRow): LeadVerificationContext | null {
  const leadId = optionalText(row.lead_id);
  const acquisitionPath = row.acquisition_path;
  const signedUpAt = optionalText(row.signed_up_at);
  if (
    !leadId ||
    (acquisitionPath !== "website" && acquisitionPath !== "instant_form") ||
    !signedUpAt
  ) {
    return null;
  }
  return {
    leadId,
    acquisitionPath,
    source: optionalText(row.source),
    notionPageId: optionalText(row.notion_page_id),
    signedUpAt,
    attribution: {
      utmSource: optionalText(row.utm_source),
      utmMedium: optionalText(row.utm_medium),
      utmCampaign: optionalText(row.utm_campaign),
      utmContent: optionalText(row.utm_content),
      utmTerm: optionalText(row.utm_term),
      metaCampaignId: optionalText(row.meta_campaign_id),
      metaAdSetId: optionalText(row.meta_adset_id),
      metaAdId: optionalText(row.meta_ad_id),
      metaCampaignName: optionalText(row.meta_campaign_name),
      metaAdSetName: optionalText(row.meta_adset_name),
      metaAdName: optionalText(row.meta_ad_name),
      publisherPlatform: optionalText(row.publisher_platform),
      placement: optionalText(row.placement),
    },
  };
}

/**
 * Reads only the PII-free context required to reconcile a verification result.
 * The actual verified flag is committed separately, after the CRM and
 * idempotent audit event have completed.
 */
export async function readLeadVerificationContext(args: {
  leadId: string;
}): Promise<{ ok: boolean; found: boolean; context?: LeadVerificationContext }> {
  const config = getSupabaseConfig();
  if (!config) return { ok: false, found: false };

  const endpoint = new URL(`${config.url}/rest/v1/funnel_leads`);
  endpoint.searchParams.set("lead_id", `eq.${args.leadId}`);
  endpoint.searchParams.set("environment", `eq.${runtimeEnvironment()}`);
  endpoint.searchParams.set("valid", "eq.true");
  endpoint.searchParams.set(
    "select",
    [
      "lead_id",
      "acquisition_path",
      "source",
      "notion_page_id",
      "signed_up_at",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "meta_campaign_id",
      "meta_adset_id",
      "meta_ad_id",
      "meta_campaign_name",
      "meta_adset_name",
      "meta_ad_name",
      "publisher_platform",
      "placement",
    ].join(","),
  );

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
    });
    if (!response.ok) {
      console.error(`[funnel] lead verification context read failed (${response.status})`);
      return { ok: false, found: false };
    }
    const rows = (await response.json()) as StoredLeadContextRow[];
    if (!rows.length) return { ok: true, found: false };
    const context = storedLeadContext(rows[0] ?? {});
    return context ? { ok: true, found: true, context } : { ok: false, found: true };
  } catch (error) {
    console.error("[funnel] lead verification context read error", error);
    return { ok: false, found: false };
  }
}

/**
 * Final monotonic commit for a verified lead. Call only after the CRM and
 * lead_verified audit event are durable.
 */
export async function commitLeadVerified(args: {
  leadId: string;
  method: LeadVerificationMethod;
  occurredAt: string;
}): Promise<{ ok: boolean; found: boolean }> {
  const config = getSupabaseConfig();
  if (!config) return { ok: false, found: false };

  const endpoint = new URL(`${config.url}/rest/v1/funnel_leads`);
  endpoint.searchParams.set("lead_id", `eq.${args.leadId}`);
  endpoint.searchParams.set("environment", `eq.${runtimeEnvironment()}`);
  endpoint.searchParams.set("valid", "eq.true");
  endpoint.searchParams.set("select", "lead_id");

  try {
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        verified: true,
        ...(args.method === "email" ? { email_verified: true } : { phone_verified: true }),
        updated_at: args.occurredAt,
      }),
    });
    if (!response.ok) {
      console.error(`[funnel] lead verification commit failed (${response.status})`);
      return { ok: false, found: false };
    }
    const rows = (await response.json()) as StoredLeadContextRow[];
    return { ok: true, found: rows.length > 0 };
  } catch (error) {
    console.error("[funnel] lead verification commit error", error);
    return { ok: false, found: false };
  }
}

async function deterministicUuid(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

export async function recordServerFunnelEvent(args: {
  idempotencyKey: string;
  eventName: FunnelEventName;
  occurredAt: string;
  acquisitionPath: "website" | "instant_form";
  source?: string;
  attribution?: FunnelAttribution;
  properties?: Record<string, FunnelPropertyValue>;
}): Promise<boolean> {
  const eventId = await deterministicUuid(`${args.idempotencyKey}:${args.eventName}`);
  const sessionId = await deterministicUuid(`session:${args.idempotencyKey}`);
  return postgrestInsert("funnel_events", [
    eventRow({
      eventId,
      sessionId,
      eventName: args.eventName,
      occurredAt: args.occurredAt,
      acquisitionPath: args.acquisitionPath,
      source: args.source,
      attribution: args.attribution,
      properties: args.properties,
      schemaVersion: FUNNEL_SCHEMA_VERSION,
    }),
  ]);
}
