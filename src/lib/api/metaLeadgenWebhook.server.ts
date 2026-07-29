import { createHmac, timingSafeEqual } from "node:crypto";

import type { FunnelAttribution, FunnelPropertyValue } from "../funnel/types";
import type { InstantFormLeadInput, InstantFormLeadResult } from "./waitlist.functions";

const WEBHOOK_PATH = "/api/meta/leadgen";
const MAX_WEBHOOK_BYTES = 1_000_000;
const MAX_LEADS_PER_DELIVERY = 50;
const GRAPH_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_GRAPH_API_VERSION = "v21.0";

type MetaLeadReference = {
  platformLeadId: string;
  createdTime?: string;
  formId?: string;
  pageId?: string;
  campaignId?: string;
  adSetId?: string;
  adId?: string;
};

type MetaGraphField = {
  name?: unknown;
  values?: unknown;
};

type MetaGraphLead = {
  id?: unknown;
  created_time?: unknown;
  field_data?: unknown;
  form_id?: unknown;
  platform?: unknown;
  campaign_id?: unknown;
  campaign_name?: unknown;
  adset_id?: unknown;
  adset_name?: unknown;
  ad_id?: unknown;
  ad_name?: unknown;
};

type MetaLeadgenWebhookDependencies = {
  fetchImpl?: typeof fetch;
  recordWebhookEvent?: (args: {
    idempotencyKey: string;
    eventName: "instant_form_webhook";
    occurredAt: string;
    acquisitionPath: "instant_form";
    source: "instant-form";
    attribution: FunnelAttribution;
    properties: Record<string, FunnelPropertyValue>;
  }) => Promise<boolean>;
  ingestLead?: (lead: InstantFormLeadInput) => Promise<InstantFormLeadResult>;
};

type MetaLeadgenScope = {
  pageId: string;
  formIds: Set<string>;
  campaignIds: Set<string>;
};

function boundedString(value: unknown, max = 300): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const cleaned = Array.from(String(value))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function isoTime(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function graphVersion(): string {
  const configured = process.env.META_GRAPH_API_VERSION?.trim();
  return configured && /^v\d+\.\d+$/.test(configured) ? configured : DEFAULT_GRAPH_API_VERSION;
}

function commaSeparatedIds(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^[A-Za-z0-9._:-]{1,128}$/.test(item)),
  );
}

function publisherPlatform(value: unknown): "facebook" | "instagram" | undefined {
  const normalized = boundedString(value, 40)?.toLowerCase();
  if (normalized === "facebook" || normalized === "fb") return "facebook";
  if (normalized === "instagram" || normalized === "ig") return "instagram";
  return undefined;
}

function configuredAdSetCountry(adSetId: string | undefined): string | undefined {
  const configured = process.env.META_ADSET_COUNTRY_MAP?.trim();
  if (!configured || !adSetId) return undefined;

  try {
    const parsed = JSON.parse(configured) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const country = (parsed as Record<string, unknown>)[adSetId];
    if (typeof country !== "string") return undefined;
    const normalized = country.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
  } catch {
    // A malformed optional mapping must not make Meta retry an otherwise
    // valid lead delivery. The dashboard will keep the country unknown.
    return undefined;
  }
}

function metaLeadgenScope(): MetaLeadgenScope | null {
  const pageId = process.env.META_PAGE_ID?.trim() ?? "";
  const formIds = commaSeparatedIds(process.env.META_LEADGEN_FORM_IDS);
  const campaignIds = commaSeparatedIds(process.env.META_LEADGEN_CAMPAIGN_IDS);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(pageId)) return null;
  // A form allowlist is mandatory because one Page can own unrelated lead
  // forms. Campaign ids are useful as an optional second gate, but some valid
  // webhook payloads omit campaign_id until the lead is fetched from Graph.
  if (!formIds.size) return null;
  return { pageId, formIds, campaignIds };
}

function referencePageAndFormAllowed(
  reference: MetaLeadReference,
  scope: MetaLeadgenScope,
): boolean {
  if (reference.pageId !== scope.pageId) return false;
  return Boolean(reference.formId && scope.formIds.has(reference.formId));
}

function graphCampaignAllowed(lead: InstantFormLeadInput, scope: MetaLeadgenScope): boolean {
  // Missing campaign data is not evidence that a Page+Form verified lead is
  // out of scope. When Graph does return a campaign, enforce the optional list.
  return !scope.campaignIds.size || !lead.campaignId || scope.campaignIds.has(lead.campaignId);
}

async function readRequestBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function webhookJsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function verifyMetaWebhookSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  const signature = signatureHeader?.trim().toLowerCase() ?? "";
  if (!/^sha256=[0-9a-f]{64}$/.test(signature) || !appSecret) return false;

  const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function extractMetaLeadReferences(payload: unknown): MetaLeadReference[] {
  if (!payload || typeof payload !== "object") return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  const references: MetaLeadReference[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const pageId = boundedString((entry as { id?: unknown }).id, 128);
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const changeRecord = change as { field?: unknown; value?: unknown };
      if (changeRecord.field !== "leadgen" || !changeRecord.value) continue;
      if (typeof changeRecord.value !== "object") continue;

      const value = changeRecord.value as Record<string, unknown>;
      const platformLeadId = boundedString(value.leadgen_id, 128);
      if (!platformLeadId || !/^[A-Za-z0-9._:-]{1,128}$/.test(platformLeadId)) {
        throw new Error("Malformed Meta leadgen change");
      }
      if (seen.has(platformLeadId)) continue;
      seen.add(platformLeadId);

      references.push({
        platformLeadId,
        createdTime: isoTime(value.created_time),
        formId: boundedString(value.form_id, 128),
        pageId: boundedString(value.page_id, 128) ?? pageId,
        campaignId: boundedString(value.campaign_id, 128),
        adSetId: boundedString(value.adset_id, 128) ?? boundedString(value.adgroup_id, 128),
        adId: boundedString(value.ad_id, 128),
      });
    }
  }

  return references;
}

function graphFieldMap(fieldData: unknown): Map<string, string> {
  const values = new Map<string, string>();
  if (!Array.isArray(fieldData)) return values;

  for (const rawField of fieldData as MetaGraphField[]) {
    const name = boundedString(rawField?.name, 100)?.toLowerCase();
    if (!name || !Array.isArray(rawField?.values)) continue;
    const value = boundedString(rawField.values.find((candidate) => typeof candidate === "string"));
    if (value) values.set(name, value);
  }
  return values;
}

export function normalizeMetaGraphLead(
  lead: MetaGraphLead,
  fallback: MetaLeadReference,
): InstantFormLeadInput {
  const id = boundedString(lead.id, 128) ?? fallback.platformLeadId;
  if (id !== fallback.platformLeadId) {
    throw new Error("Meta Graph returned a mismatched lead id");
  }

  const fields = graphFieldMap(lead.field_data);
  const firstName = fields.get("first_name");
  const lastName = fields.get("last_name");
  const composedName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const createdTime = isoTime(lead.created_time) ?? fallback.createdTime;
  if (!createdTime) {
    throw new Error("Meta lead has no valid created_time");
  }
  const adSetId = boundedString(lead.adset_id, 128) ?? fallback.adSetId;

  return {
    platformLeadId: id,
    createdTime,
    email: fields.get("email"),
    phone: fields.get("phone_number") ?? fields.get("phone"),
    fullName: fields.get("full_name") ?? (composedName || undefined),
    formId: boundedString(lead.form_id, 128) ?? fallback.formId,
    pageId: fallback.pageId,
    publisherPlatform: publisherPlatform(lead.platform),
    country: configuredAdSetCountry(adSetId),
    campaignId: boundedString(lead.campaign_id, 128) ?? fallback.campaignId,
    campaignName: boundedString(lead.campaign_name),
    adSetId,
    adSetName: boundedString(lead.adset_name),
    adId: boundedString(lead.ad_id, 128) ?? fallback.adId,
    adName: boundedString(lead.ad_name),
  };
}

async function fetchMetaGraphLead(
  reference: MetaLeadReference,
  pageAccessToken: string,
  fetchImpl: typeof fetch,
): Promise<InstantFormLeadInput> {
  const endpoint = new URL(
    `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(reference.platformLeadId)}`,
  );
  endpoint.searchParams.set(
    "fields",
    [
      "id",
      "created_time",
      "field_data",
      "form_id",
      "platform",
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name",
      "ad_id",
      "ad_name",
    ].join(","),
  );

  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${pageAccessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(GRAPH_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    // The response body can include submitted form values. Do not log or
    // propagate it.
    throw new Error(`Meta Graph lead fetch failed with status ${response.status}`);
  }

  const json = (await response.json()) as MetaGraphLead;
  return normalizeMetaGraphLead(json, reference);
}

async function defaultRecordWebhookEvent(
  args: Parameters<NonNullable<MetaLeadgenWebhookDependencies["recordWebhookEvent"]>>[0],
): Promise<boolean> {
  const { recordServerFunnelEvent } = await import("./funnel.functions");
  return recordServerFunnelEvent(args);
}

async function defaultIngestLead(lead: InstantFormLeadInput): Promise<InstantFormLeadResult> {
  const { ingestInstantFormLead } = await import("./waitlist.functions");
  return ingestInstantFormLead(lead);
}

/**
 * Handles only /api/meta/leadgen and returns null for every other route so the
 * TanStack server entry can continue normally.
 */
export async function handleMetaLeadgenWebhook(
  request: Request,
  dependencies: MetaLeadgenWebhookDependencies = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== WEBHOOK_PATH) return null;

  if (request.method === "GET") {
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
    if (!verifyToken) {
      return webhookJsonResponse(503, { error: "webhook_not_configured" });
    }

    const mode = url.searchParams.get("hub.mode");
    const suppliedToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || suppliedToken !== verifyToken || challenge === null) {
      return webhookJsonResponse(403, { error: "verification_failed" });
    }
    return new Response(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (request.method !== "POST") {
    return webhookJsonResponse(405, { error: "method_not_allowed" });
  }

  const appSecret = process.env.META_APP_SECRET?.trim();
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN?.trim();
  const scope = metaLeadgenScope();
  if (!appSecret || !pageAccessToken || !scope) {
    return webhookJsonResponse(503, { error: "webhook_not_configured" });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return webhookJsonResponse(413, { error: "payload_too_large" });
  }

  const rawBody = await readRequestBodyWithLimit(request, MAX_WEBHOOK_BYTES);
  if (!rawBody) {
    return webhookJsonResponse(413, { error: "payload_too_large" });
  }
  if (!verifyMetaWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return webhookJsonResponse(403, { error: "invalid_signature" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return webhookJsonResponse(400, { error: "invalid_json" });
  }

  let references: MetaLeadReference[];
  try {
    references = extractMetaLeadReferences(payload);
  } catch {
    return webhookJsonResponse(400, { error: "invalid_leadgen_payload" });
  }
  if (!references.length) {
    return webhookJsonResponse(200, { received: 0 });
  }
  if (references.length > MAX_LEADS_PER_DELIVERY) {
    return webhookJsonResponse(413, { error: "too_many_leads" });
  }

  const allowedReferences = references.filter((reference) =>
    referencePageAndFormAllowed(reference, scope),
  );
  if (!allowedReferences.length) {
    return webhookJsonResponse(200, { received: 0, ignored: references.length });
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const recordWebhookEvent = dependencies.recordWebhookEvent ?? defaultRecordWebhookEvent;
  const ingestLead = dependencies.ingestLead ?? defaultIngestLead;
  let received = 0;
  let ignored = references.length - allowedReferences.length;

  try {
    for (const reference of allowedReferences) {
      const lead = await fetchMetaGraphLead(reference, pageAccessToken, fetchImpl);
      if (!graphCampaignAllowed(lead, scope)) {
        ignored += 1;
        continue;
      }
      const attribution = {
        metaCampaignId: lead.campaignId,
        metaAdSetId: lead.adSetId,
        metaAdId: lead.adId,
        metaCampaignName: lead.campaignName,
        metaAdSetName: lead.adSetName,
        metaAdName: lead.adName,
        publisherPlatform: lead.publisherPlatform ?? "meta",
        placement: "instant_form",
      };
      const webhookStored = await recordWebhookEvent({
        idempotencyKey: `meta-leadgen:${lead.platformLeadId}:webhook`,
        eventName: "instant_form_webhook",
        occurredAt: lead.createdTime,
        acquisitionPath: "instant_form",
        source: "instant-form",
        attribution,
        properties: {
          metaFormId: lead.formId ?? null,
          metaPageId: lead.pageId ?? null,
        },
      });
      if (!webhookStored) {
        throw new Error("Instant Form webhook event storage is unavailable");
      }

      const result = await ingestLead(lead);
      if (!result.ok) {
        throw new Error("Instant Form CRM ingestion did not complete");
      }
      received += 1;
    }
  } catch (error) {
    // Never log the Graph payload, form fields, token, or an exception message
    // that may have been produced by a third-party response.
    console.error(
      "[meta-leadgen] processing failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return webhookJsonResponse(500, { error: "processing_failed" });
  }

  return webhookJsonResponse(200, {
    received,
    ...(ignored ? { ignored } : {}),
  });
}
