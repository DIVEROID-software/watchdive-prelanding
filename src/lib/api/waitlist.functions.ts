import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { canonicalEmail, isDisposableEmail, isHeadlessUA, firstIp } from "./abuse.ts";
import { metaPhoneEventIdForInput, sendMetaLead } from "./metaCapi.ts";
import { recordLeadOutcome, recordServerFunnelEvent } from "./funnel.functions.ts";
import {
  CANONICAL_EMAIL_PROPERTY,
  canonicalEmailFilters,
  canonicalEmailProperties,
  withCanonicalEmailShape,
} from "./notionCanonicalEmail.ts";
import { persistNewWebsiteLeadDurably } from "./websiteLeadPersistence.ts";
import {
  FUNNEL_SCHEMA_VERSION,
  attributionCompleteness,
  type FunnelAttribution,
  type FunnelLeadOutcome,
} from "../funnel/types.ts";

// Contact details remain in Notion while pseudonymous funnel and lead-quality
// outcomes are mirrored to Supabase. Both credentials stay server-only.
// Required env vars (set in .env locally / Vercel project settings in prod):
//   NOTION_API_KEY        — internal integration token (shared with the DB)
//   NOTION_WAITLIST_DB_ID — target database id
// The database needs these properties:
//   Email (title) · Phone (rich_text) · Source (select) · Signed up (date)
//   Ref code (rich_text) · Referred by (rich_text)
//   Canonical email (email, historically rich_text)
//   Flags (multi_select) · Suspect (checkbox)
//   UTM fields · Meta IDs · Session ID · acquisition/quality status fields

const NOTION_VERSION = "2022-06-28";
const NOTION_REQUEST_TIMEOUT_MS = 8_000;

async function notionFetch(path: string, body: unknown) {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error("NOTION_API_KEY is not set");
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(NOTION_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Notion validation responses can echo submitted property values. Never
    // propagate the response body into application errors or server logs. The
    // one schema-retry signal we need is reduced to a fixed, PII-free sentinel.
    if (res.status === 400) {
      let canonicalEmailShapeMismatch = false;
      try {
        const response = (await res.json()) as { code?: unknown; message?: unknown };
        canonicalEmailShapeMismatch =
          response.code === "validation_error" &&
          typeof response.message === "string" &&
          response.message.includes(CANONICAL_EMAIL_PROPERTY);
      } catch {
        canonicalEmailShapeMismatch = false;
      }
      if (canonicalEmailShapeMismatch) {
        throw new Error(
          `Notion ${path} failed (400): validation_error ${CANONICAL_EMAIL_PROPERTY}`,
        );
      }
    }
    throw new Error(`Notion ${path} failed (${res.status})`);
  }
  return res.json();
}

async function notionPatch(path: string, body: unknown) {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error("NOTION_API_KEY is not set");
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${key}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(NOTION_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Notion ${path} failed (${res.status})`);
  }
  return res.json();
}

export async function markNotionLeadVerified(args: {
  notionPageId: string;
  method: "email" | "phone";
  occurredAt: string;
}): Promise<void> {
  if (!/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(args.notionPageId)) {
    throw new Error("Invalid Notion lead page id");
  }
  const occurredAt = new Date(args.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) throw new Error("Invalid verification timestamp");

  await notionPatch(`pages/${args.notionPageId}`, {
    properties: {
      ...(args.method === "email"
        ? { "Email verified": { checkbox: true } }
        : { "Phone verified": { checkbox: true } }),
      "Verification status": { select: { name: "verified" } },
      "Verified at": { date: { start: occurredAt.toISOString() } },
    },
  });
}

function newRefCode() {
  // Exactly 8 lowercase alphanumerics, e.g. "a3f9k2qp". Rejection sampling
  // avoids modulo bias while Web Crypto keeps this module browser-safe.
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  while (result.length < 8) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const byte of bytes) {
      if (byte >= 252) continue;
      result += alphabet[byte % alphabet.length];
      if (result.length === 8) break;
    }
  }
  return result;
}

// Ref codes are 8 lowercase alphanumerics. Share targets sometimes glue the
// share text onto the link, so normalize to the same shape everywhere the code
// is written or looked up — otherwise attribution silently misses.
function sanitizeRef(v: string | undefined | null) {
  return (v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
}

function textProp(value: string) {
  return { rich_text: [{ text: { content: value.slice(0, 1900) } }] };
}

const attributionValidator = z
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

// Reads request metadata (IP, UA) inside a server fn. Header access can throw if
// there is no active request context, so it always degrades to empty strings.
function requestMeta(): {
  ip: string;
  ua: string;
  country: string;
  origin: string;
  host: string;
} {
  try {
    const xff = getRequestHeader("x-forwarded-for") ?? getRequestHeader("x-real-ip");
    const ua = getRequestHeader("user-agent") ?? "";
    const country = getRequestHeader("x-vercel-ip-country")?.trim().toUpperCase() ?? "";
    const origin = getRequestHeader("origin")?.trim() ?? "";
    const host =
      getRequestHeader("host")?.trim() ??
      getRequestHeader("x-forwarded-host")?.split(",")[0]?.trim() ??
      "";
    return {
      ip: firstIp(xff),
      ua,
      country: /^[A-Z]{2}$/.test(country) ? country : "",
      origin,
      host,
    };
  } catch {
    return { ip: "", ua: "", country: "", origin: "", host: "" };
  }
}

function runtimeEnvironment(): "production" | "preview" | "development" {
  const value = process.env.VERCEL_ENV;
  if (value === "production" || value === "preview") return value;
  return "development";
}

function sourceCoverage(data: {
  sessionId?: string;
  attribution?: FunnelAttribution;
}): "complete" | "incomplete" | "unknown" {
  if (data.sessionId && attributionCompleteness(data.attribution) !== "none") return "complete";
  if (data.sessionId || attributionCompleteness(data.attribution) !== "none") return "incomplete";
  return "unknown";
}

export type InstantFormLeadInput = {
  platformLeadId: string;
  createdTime: string;
  email?: string;
  phone?: string;
  fullName?: string;
  formId?: string;
  pageId?: string;
  publisherPlatform?: "facebook" | "instagram";
  country?: string;
  campaignId?: string;
  campaignName?: string;
  adSetId?: string;
  adSetName?: string;
  adId?: string;
  adName?: string;
  campaignScopeStatus?: "verified" | "unverified";
};

export type InstantFormLeadResult = {
  ok: true;
  status: "new" | "duplicate" | "suspect" | "invalid";
  notionPageId?: string;
};

type NotionPageResult = {
  id?: string;
  properties?: Record<string, NotionPropertyResult>;
};

type NotionPropertyResult = {
  rich_text?: Array<{ plain_text?: unknown }>;
  title?: Array<{ plain_text?: unknown }>;
  email?: unknown;
  date?: { start?: unknown };
  checkbox?: unknown;
  multi_select?: Array<{ name?: unknown }>;
  select?: { name?: unknown };
};

function notionTextValue(property: NotionPropertyResult | undefined): string {
  const value =
    property?.rich_text?.[0]?.plain_text ?? property?.title?.[0]?.plain_text ?? property?.email;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function notionDateValue(property: NotionPropertyResult | undefined): string {
  const start = property?.date?.start;
  if (typeof start !== "string" || !Number.isFinite(Date.parse(start))) return "";
  return new Date(start).toISOString();
}

function instantFormAttribution(data: InstantFormLeadInput): FunnelAttribution {
  return {
    metaCampaignId: data.campaignId,
    metaAdSetId: data.adSetId,
    metaAdId: data.adId,
    metaCampaignName: data.campaignName,
    metaAdSetName: data.adSetName,
    metaAdName: data.adName,
    publisherPlatform: data.publisherPlatform ?? "meta",
    placement: "instant_form",
  };
}

function instantFormSourceCoverage(
  data: InstantFormLeadInput,
): "complete" | "incomplete" | "unknown" {
  const values = [data.platformLeadId, data.formId, data.campaignId, data.adSetId, data.adId];
  const present = values.filter(Boolean).length;
  if (present === values.length) return "complete";
  return present > 0 ? "incomplete" : "unknown";
}

function instantFormAttributionStatus(data: InstantFormLeadInput): "complete" | "partial" | "none" {
  if (data.campaignId && data.adSetId && data.adId) return "complete";
  return data.campaignId || data.adSetId || data.adId ? "partial" : "none";
}

function instantFormAttributionProperties(
  data: InstantFormLeadInput,
  mode: "create" | "enrich" = "create",
): Record<string, unknown> {
  const attributionStatus = instantFormAttributionStatus(data);
  const coverage = instantFormSourceCoverage(data);
  return {
    Source: { select: { name: "instant-form" } },
    "Lead ID": textProp(data.platformLeadId),
    "Acquisition path": { select: { name: "instant_form" } },
    ...(mode === "create" || attributionStatus === "complete"
      ? { "Attribution status": { select: { name: attributionStatus } } }
      : {}),
    ...(mode === "create" || coverage === "complete"
      ? { "Source coverage": { select: { name: coverage } } }
      : {}),
    "Meta Platform Lead ID": textProp(data.platformLeadId),
    ...(data.formId ? { "Meta Form ID": textProp(data.formId) } : {}),
    ...(data.pageId ? { "Meta Page ID": textProp(data.pageId) } : {}),
    ...(data.campaignId ? { "Meta Campaign ID": textProp(data.campaignId) } : {}),
    ...(data.adSetId ? { "Meta Ad Set ID": textProp(data.adSetId) } : {}),
    ...(data.adId ? { "Meta Ad ID": textProp(data.adId) } : {}),
    ...(mode === "create" || data.publisherPlatform
      ? { "Publisher platform": textProp(data.publisherPlatform ?? "meta") }
      : {}),
    Placement: textProp("instant_form"),
    ...(data.country ? { Country: textProp(data.country) } : {}),
  };
}

export function buildInstantFormNotionProperties(args: {
  data: InstantFormLeadInput;
  email: string;
  canonical: string;
  signedUpAt: string;
  refCode: string;
  flags: string[];
  suspect: boolean;
  duplicate: boolean;
}): Record<string, unknown> {
  const { data, email, canonical, signedUpAt, refCode, flags, suspect, duplicate } = args;
  return {
    Email: { title: [{ text: { content: email } }] },
    ...canonicalEmailProperties(canonical),
    ...(data.phone ? { Phone: textProp(data.phone) } : {}),
    ...(data.fullName ? { "Full name": textProp(data.fullName) } : {}),
    ...instantFormAttributionProperties(data),
    "Signed up": { date: { start: signedUpAt } },
    "Ref code": textProp(refCode),
    "Measurement consent": textProp("meta_instant_form_terms"),
    "Verification status": { select: { name: "pending" } },
    "Email verified": { checkbox: false },
    "Phone verified": { checkbox: false },
    "Source schema version": textProp(FUNNEL_SCHEMA_VERSION),
    "Qualification rule version": textProp("2026-07-29.v1"),
    Environment: { select: { name: runtimeEnvironment() } },
    Counted: { checkbox: !duplicate && !suspect },
    Duplicate: { checkbox: duplicate },
    "Meta eligible": { checkbox: false },
    "Meta CAPI state": { select: { name: "skipped" } },
    ...(process.env.VERCEL_DEPLOYMENT_ID
      ? { "Deployment ID": textProp(process.env.VERCEL_DEPLOYMENT_ID) }
      : {}),
    ...(process.env.VERCEL_GIT_COMMIT_SHA
      ? { "Landing page version": textProp(process.env.VERCEL_GIT_COMMIT_SHA) }
      : {}),
    ...(flags.length ? { Flags: { multi_select: flags.map((name) => ({ name })) } } : {}),
    Suspect: { checkbox: suspect },
  };
}

function buildInvalidInstantFormNotionProperties(args: {
  data: InstantFormLeadInput;
  signedUpAt: string;
  flags: string[];
}): Record<string, unknown> {
  const { data, signedUpAt, flags } = args;
  const title = data.email || `Email missing · Meta lead ${data.platformLeadId}`;
  return {
    Email: { title: [{ text: { content: title } }] },
    ...(data.phone ? { Phone: textProp(data.phone) } : {}),
    ...(data.fullName ? { "Full name": textProp(data.fullName) } : {}),
    ...instantFormAttributionProperties(data),
    "Signed up": { date: { start: signedUpAt } },
    "Measurement consent": textProp("meta_instant_form_terms"),
    "Verification status": { select: { name: "pending" } },
    "Email verified": { checkbox: false },
    "Phone verified": { checkbox: false },
    "Source schema version": textProp(FUNNEL_SCHEMA_VERSION),
    "Qualification rule version": textProp("2026-07-29.v1"),
    Environment: { select: { name: runtimeEnvironment() } },
    Counted: { checkbox: false },
    Duplicate: { checkbox: false },
    "Meta eligible": { checkbox: false },
    "Meta CAPI state": { select: { name: "skipped" } },
    ...(process.env.VERCEL_DEPLOYMENT_ID
      ? { "Deployment ID": textProp(process.env.VERCEL_DEPLOYMENT_ID) }
      : {}),
    ...(process.env.VERCEL_GIT_COMMIT_SHA
      ? { "Landing page version": textProp(process.env.VERCEL_GIT_COMMIT_SHA) }
      : {}),
    Flags: { multi_select: flags.map((name) => ({ name })) },
    Suspect: { checkbox: true },
  };
}

function canonicalMasterFilter(canonical: string, email: string): Record<string, unknown> {
  return {
    and: [
      {
        or: [...canonicalEmailFilters(canonical), { property: "Email", title: { equals: email } }],
      },
      { property: "Duplicate", checkbox: { equals: false } },
    ],
  };
}

async function persistInstantFormFunnelState(args: {
  data: InstantFormLeadInput;
  status: "new" | "duplicate" | "suspect" | "invalid";
  valid: boolean;
  signedUpAt: string;
  notionPageId?: string;
  flags?: string[];
  preserveExistingLead?: boolean;
}): Promise<void> {
  const attribution = instantFormAttribution(args.data);
  const leadStored = await recordLeadOutcome(
    {
      leadId: args.data.platformLeadId,
      acquisitionPath: "instant_form",
      source: "instant-form",
      country: args.data.country,
      status: args.status,
      valid: args.valid,
      hasEmail: z.string().email().safeParse(args.data.email).success,
      hasPhone: Boolean(
        args.data.phone &&
        args.data.phone.replace(/[^0-9]/g, "").length >= 7 &&
        args.data.phone.replace(/[^0-9]/g, "").length <= 15,
      ),
      // A native lead was intentionally submitted under Meta's form terms. It
      // stays excluded from the website CAPI mirror.
      measurementConsent: true,
      metaEligible: false,
      metaCapiState: "skipped",
      notionPageId: args.notionPageId,
      attribution,
      signedUpAt: args.signedUpAt,
      flags: args.flags ?? [],
      schemaVersion: FUNNEL_SCHEMA_VERSION,
    },
    args.preserveExistingLead ? "ignore-duplicates" : "merge-duplicates",
  );
  if (!leadStored) {
    throw new Error("Instant Form lead outcome storage is unavailable");
  }

  const validationStored = await recordServerFunnelEvent({
    idempotencyKey: `meta-leadgen:${args.data.platformLeadId}:validation`,
    eventName: "lead_validated",
    occurredAt: args.signedUpAt,
    acquisitionPath: "instant_form",
    source: "instant-form",
    attribution,
    properties: {
      valid: args.valid,
      status: args.status,
    },
  });
  if (!validationStored) {
    throw new Error("Instant Form validation event storage is unavailable");
  }

  if (args.notionPageId) {
    const crmStored = await recordServerFunnelEvent({
      idempotencyKey: `meta-leadgen:${args.data.platformLeadId}:crm`,
      eventName: "instant_form_crm_saved",
      occurredAt: args.signedUpAt,
      acquisitionPath: "instant_form",
      source: "instant-form",
      attribution,
      properties: {
        crmOutcome: args.status,
      },
    });
    if (!crmStored) {
      throw new Error("Instant Form CRM event storage is unavailable");
    }
  }
}

/**
 * Reconciles one Meta Instant Form lead into the existing Notion waitlist and
 * the pseudonymous funnel store. Native-form leads are already recorded by
 * Meta, so this path deliberately never mirrors them through CAPI.
 *
 * The platform lead id is checked first so webhook retries are idempotent.
 * Canonical email is the second key. A person who also used the website keeps
 * that original row unchanged while the native-form submission is preserved as
 * its own non-counted duplicate row with complete Meta attribution.
 */
export async function ingestInstantFormLead(
  input: InstantFormLeadInput,
): Promise<InstantFormLeadResult> {
  const dbId = process.env.NOTION_WAITLIST_DB_ID;
  if (!dbId) throw new Error("NOTION_WAITLIST_DB_ID is not set");

  const data = {
    ...input,
    platformLeadId: input.platformLeadId.trim().slice(0, 128),
    createdTime: input.createdTime.trim(),
    email: input.email?.trim().toLowerCase().slice(0, 320),
    phone: input.phone?.trim().slice(0, 80),
    fullName: input.fullName?.trim().slice(0, 300),
    publisherPlatform:
      input.publisherPlatform === "facebook" || input.publisherPlatform === "instagram"
        ? input.publisherPlatform
        : undefined,
    campaignScopeStatus:
      input.campaignScopeStatus === "verified" || input.campaignScopeStatus === "unverified"
        ? input.campaignScopeStatus
        : undefined,
    country:
      input.country && /^[A-Za-z]{2}$/.test(input.country.trim())
        ? input.country.trim().toUpperCase()
        : undefined,
  };
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(data.platformLeadId)) {
    throw new Error("Invalid Meta platform lead id");
  }

  const createdDate = new Date(data.createdTime);
  if (!Number.isFinite(createdDate.getTime())) {
    throw new Error("Invalid Meta lead created_time");
  }
  const signedUpAt = createdDate.toISOString();
  const environment = runtimeEnvironment();
  const { reserveMetaLeadIngestion, completeMetaLeadIngestion, failMetaLeadIngestion } =
    await import("./metaLeadIngestionReservation.server.ts");
  const reservationScope = {
    environment,
    platformLeadId: data.platformLeadId,
  };
  const reservation = await reserveMetaLeadIngestion(reservationScope);

  if (reservation.state === "complete") {
    // A retry can carry richer Meta attribution than the original delivery.
    // Updating the already-recorded row is safe; a completed reservation never
    // enters either Notion creation branch.
    if (reservation.notionPageId) {
      await notionPatch(`pages/${reservation.notionPageId}`, {
        properties: instantFormAttributionProperties(data, "enrich"),
      });
    }
    const completedResult: InstantFormLeadResult = {
      ok: true,
      status: reservation.outcome,
      ...(reservation.notionPageId ? { notionPageId: reservation.notionPageId } : {}),
    };
    const completedFlags: string[] = [];
    if (reservation.outcome === "invalid") completedFlags.push("invalid-email");
    if (reservation.outcome !== "invalid" && data.email && isDisposableEmail(data.email)) {
      completedFlags.push("disposable");
    }
    if (data.campaignScopeStatus === "unverified") {
      completedFlags.push("campaign-unverified");
    }
    await persistInstantFormFunnelState({
      data,
      status: reservation.outcome,
      valid: reservation.outcome === "new",
      signedUpAt,
      notionPageId: reservation.notionPageId,
      flags: completedFlags,
      preserveExistingLead: true,
    });
    return completedResult;
  }
  if (reservation.state === "in_progress") {
    // Do not acknowledge a competing delivery yet. If the current owner dies
    // before it can release the reservation, Meta must keep retrying until the
    // five-minute lease can be recovered by a new generation.
    throw new Error("Meta lead ingestion is already in progress");
  }

  let notionCreateStarted = false;
  const createInstantFormNotionPage = (body: unknown) => {
    // Once a create request is dispatched, a timeout or lost response cannot
    // prove whether Notion committed the row. Keep the lease so an immediate
    // retry cannot race the still-ambiguous write. The next generation will
    // query by Platform Lead ID before it considers another create.
    notionCreateStarted = true;
    return notionFetch("pages", body);
  };

  const completeReservationAndPersist = async (
    result: InstantFormLeadResult,
    flags: string[],
  ): Promise<InstantFormLeadResult> => {
    const completed = await completeMetaLeadIngestion({
      ...reservationScope,
      generation: reservation.generation,
      outcome: result.status,
      notionPageId: result.notionPageId,
    });
    if (!completed) {
      throw new Error("Meta lead ingestion reservation was superseded");
    }
    await persistInstantFormFunnelState({
      data,
      status: result.status,
      valid: result.status === "new",
      signedUpAt,
      notionPageId: result.notionPageId,
      flags,
    });
    return result;
  };

  try {
    const existingPlatformLead = (await notionFetch(`databases/${dbId}/query`, {
      filter: {
        and: [
          {
            property: "Meta Platform Lead ID",
            rich_text: { equals: data.platformLeadId },
          },
          {
            or: [
              {
                property: "Acquisition path",
                select: { equals: "instant_form" },
              },
              {
                property: "Source",
                select: { equals: "instant-form" },
              },
            ],
          },
        ],
      },
      page_size: 1,
    })) as { results?: NotionPageResult[] };

    if (existingPlatformLead.results?.length) {
      const page = existingPlatformLead.results[0];
      if (page.id) {
        await notionPatch(`pages/${page.id}`, {
          properties: instantFormAttributionProperties(data, "enrich"),
        });
      }
      const flags =
        page.properties?.Flags?.multi_select
          ?.map((item) => (typeof item.name === "string" ? item.name : undefined))
          .filter((name: unknown): name is string => typeof name === "string") ?? [];
      const suspect = Boolean(page.properties?.Suspect?.checkbox);
      const duplicate = page.properties?.Duplicate?.checkbox === true;
      const status = flags.includes("invalid-email")
        ? "invalid"
        : duplicate
          ? "duplicate"
          : suspect
            ? "suspect"
            : "new";
      return await completeReservationAndPersist(
        { ok: true, status, notionPageId: page.id },
        flags,
      );
    }

    const parsedEmail = z.string().email().max(320).safeParse(data.email);
    if (!parsedEmail.success) {
      const flags = ["invalid-email"];
      if (data.campaignScopeStatus === "unverified") flags.push("campaign-unverified");
      const invalidPage = (await createInstantFormNotionPage({
        parent: { database_id: dbId },
        properties: buildInvalidInstantFormNotionProperties({
          data,
          signedUpAt,
          flags,
        }),
      })) as NotionPageResult;
      if (!invalidPage.id) {
        throw new Error("Notion did not return an invalid Instant Form lead page id");
      }
      return await completeReservationAndPersist(
        { ok: true, status: "invalid", notionPageId: invalidPage.id },
        flags,
      );
    }

    const email = parsedEmail.data.toLowerCase();
    const canonical = canonicalEmail(email);

    const existingCanonical = (await withCanonicalEmailShape(() =>
      notionFetch(`databases/${dbId}/query`, {
        filter: canonicalMasterFilter(canonical, email),
        page_size: 1,
      }),
    )) as { results?: NotionPageResult[] };

    const flags: string[] = [];
    if (isDisposableEmail(email)) flags.push("disposable");
    if (data.campaignScopeStatus === "unverified") flags.push("campaign-unverified");
    const suspect = flags.length > 0;
    const existingCanonicalPage = existingCanonical.results?.[0];
    const existingMasterRefCode = sanitizeRef(
      notionTextValue(existingCanonicalPage?.properties?.["Ref code"]),
    );
    const { claimCanonicalLead } = await import("./canonicalLeadClaim.server.ts");
    const canonicalClaim = await claimCanonicalLead({
      environment,
      canonicalEmail: canonical,
      acquisitionPath: "instant_form",
      submissionId: data.platformLeadId,
      candidateRefCode: newRefCode(),
      existingMaster: Boolean(existingCanonicalPage),
      ...(existingMasterRefCode.length === 8 ? { existingMasterRefCode } : {}),
    });
    const duplicate = !canonicalClaim.owner;
    const status = duplicate ? "duplicate" : suspect ? "suspect" : "new";

    const createdPage = (await withCanonicalEmailShape(() =>
      createInstantFormNotionPage({
        parent: { database_id: dbId },
        properties: buildInstantFormNotionProperties({
          data,
          email,
          canonical,
          signedUpAt,
          refCode: canonicalClaim.refCode,
          flags,
          suspect,
          duplicate,
        }),
      }),
    )) as NotionPageResult;

    if (!createdPage.id) {
      throw new Error("Notion did not return an Instant Form lead page id");
    }

    _waitlistCountCache = null;
    return await completeReservationAndPersist(
      {
        ok: true,
        status,
        notionPageId: createdPage.id,
      },
      flags,
    );
  } catch (error) {
    if (!notionCreateStarted) {
      try {
        await failMetaLeadIngestion({
          ...reservationScope,
          generation: reservation.generation,
        });
      } catch {
        // The original error remains authoritative. A lost failure-release
        // response is recovered by the bounded lease.
        console.error("[meta-lead-ingestion] failed to release reservation");
      }
    }
    throw error;
  }
}

// Real, canonical rows only — the number the counters and social proof show.
const NOT_SUSPECT = { property: "Suspect", checkbox: { equals: false } } as const;
const NOT_DUPLICATE = { property: "Duplicate", checkbox: { equals: false } } as const;

export function countableNotionLeadFilter(
  filters: ReadonlyArray<Record<string, unknown>> = [],
): Record<string, unknown> {
  return { and: [...filters, NOT_SUSPECT, NOT_DUPLICATE] };
}

// How many people signed up through a given referral code (Referred by == code).
// Powers the "N friends joined · $N off so far" progress in the success card.
// Suspect and duplicate rows are excluded so repeat submissions cannot inflate
// a referrer's discount.
export const getReferralCount = createServerFn({ method: "POST" })
  .validator(z.object({ refCode: z.string().max(40) }))
  .handler(async ({ data }) => {
    const dbId = process.env.NOTION_WAITLIST_DB_ID;
    const code = sanitizeRef(data.refCode);
    if (!dbId || !code) return { count: 0 };
    let count = 0;
    let cursor: string | undefined = undefined;
    let hasMore = true;
    while (hasMore) {
      const res = await notionFetch(`databases/${dbId}/query`, {
        filter: countableNotionLeadFilter([
          { property: "Referred by", rich_text: { equals: code } },
        ]),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      count += res.results?.length ?? 0;
      hasMore = Boolean(res.has_more);
      cursor = res.next_cursor ?? undefined;
    }
    return { count };
  });

// Total signups — social proof ("N divers on the waitlist") and the "spots left"
// scarcity counter. Excludes suspect and duplicate rows so abuse/retries cannot
// fake urgency. Cached 10s so ad traffic doesn't hammer the Notion API.
let _waitlistCountCache: { at: number; count: number } | null = null;
export const getWaitlistCount = createServerFn({ method: "GET" }).handler(async () => {
  const dbId = process.env.NOTION_WAITLIST_DB_ID;
  if (!dbId) return { count: 0 };
  if (_waitlistCountCache && Date.now() - _waitlistCountCache.at < 10_000) {
    return { count: _waitlistCountCache.count };
  }
  let count = 0;
  let cursor: string | undefined = undefined;
  let hasMore = true;
  while (hasMore) {
    const res = await notionFetch(`databases/${dbId}/query`, {
      filter: countableNotionLeadFilter(),
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    count += res.results?.length ?? 0;
    hasMore = Boolean(res.has_more);
    cursor = res.next_cursor ?? undefined;
  }
  _waitlistCountCache = { at: Date.now(), count };
  return { count };
});

const joinWaitlistInput = z.object({
  email: z.string().email().max(320),
  phone: z.string().max(40).optional(),
  source: z.enum(["hero", "offer"]),
  referredBy: z.string().max(40).optional(),
  // Honeypot: a hidden field real users never see. Anything here = a bot.
  honeypot: z.string().max(200).optional(),
  // Meta conversion tracking: shared browser/server event id for dedup,
  // plus the pixel's _fbp/_fbc cookies for match quality.
  eventId: z
    .string()
    .regex(/^[A-Za-z0-9._:-]{8,64}$/)
    .optional(),
  measurementConsent: z.boolean().default(false),
  fbp: z.string().max(128).optional(),
  fbc: z.string().max(512).optional(),
  sessionId: z.string().uuid().optional(),
  visitorId: z.string().uuid().optional(),
  landingPath: z
    .string()
    .max(500)
    .regex(/^\/[^\s?#]*$/)
    .optional(),
  browserLanguage: z.string().max(80).optional(),
  attribution: attributionValidator.optional(),
});

export const handleJoinWaitlist = createServerOnlyFn(
  async ({ data }: { data: z.infer<typeof joinWaitlistInput> }) => {
    const dbId = process.env.NOTION_WAITLIST_DB_ID;
    if (!dbId) throw new Error("NOTION_WAITLIST_DB_ID is not set");

    const email = data.email.trim().toLowerCase();
    const canonical = canonicalEmail(email);
    const { ip, ua, country, origin, host } = requestMeta();
    const { consumeSignupRateLimit, isSignupRequestOriginAllowed } =
      await import("./signupRateLimit.server.ts");
    if (!isSignupRequestOriginAllowed({ origin, host })) {
      throw new Error("Signup request origin is not allowed");
    }
    const signupRateLimit = await consumeSignupRateLimit({ ip });
    if (!signupRateLimit.allowed) {
      throw new Error(
        signupRateLimit.reason === "limited"
          ? "Signup request rate limited"
          : "Signup abuse protection unavailable",
      );
    }
    const receivedAt = new Date().toISOString();
    const leadId =
      data.eventId ?? (data.sessionId ? `${data.sessionId}:${data.source}` : crypto.randomUUID());

    // Find the exact website touchpoint before the canonical master. This keeps
    // response-loss retries idempotent even when the original touchpoint was a
    // duplicate row, while a cross-channel master remains a distinct record.
    const existingSubmission = (await notionFetch(`databases/${dbId}/query`, {
      filter: {
        and: [
          { property: "Lead ID", rich_text: { equals: leadId } },
          {
            or: [
              { property: "Acquisition path", select: { equals: "website" } },
              { property: "Source", select: { equals: "hero" } },
              { property: "Source", select: { equals: "offer" } },
            ],
          },
        ],
      },
      page_size: 1,
    })) as { results?: NotionPageResult[] };
    const existingSubmissionPage = existingSubmission.results?.[0];
    const existingCanonical = existingSubmissionPage
      ? undefined
      : ((await withCanonicalEmailShape(() =>
          notionFetch(`databases/${dbId}/query`, {
            filter: canonicalMasterFilter(canonical, email),
            page_size: 1,
          }),
        )) as { results?: NotionPageResult[] });
    const existingPage = existingSubmissionPage ?? existingCanonical?.results?.[0];
    const existingProperties = existingPage?.properties;
    const sameSubmission = Boolean(existingSubmissionPage);
    const signedUpAt =
      (sameSubmission && notionDateValue(existingProperties?.["Signed up"])) || receivedAt;
    const storedRefCode = sanitizeRef(notionTextValue(existingProperties?.["Ref code"]));
    const { claimCanonicalLead } = await import("./canonicalLeadClaim.server.ts");
    const canonicalClaim = await claimCanonicalLead({
      environment: runtimeEnvironment(),
      canonicalEmail: canonical,
      acquisitionPath: "website",
      submissionId: leadId,
      candidateRefCode: newRefCode(),
      existingMaster: Boolean(existingPage && !sameSubmission),
      ...(storedRefCode.length === 8 ? { existingMasterRefCode: storedRefCode } : {}),
    });
    const storedDuplicate = existingProperties?.Duplicate?.checkbox === true;
    const duplicate = sameSubmission ? storedDuplicate : !canonicalClaim.owner;

    // ---- Abuse signals (flag, don't lose the lead). A same-id retry preserves
    // the original Notion classification instead of reclassifying by a later
    // request's transient user agent.
    const requestFlags: string[] = [];
    if (data.honeypot && data.honeypot.trim()) requestFlags.push("honeypot");
    if (isDisposableEmail(email)) requestFlags.push("disposable");
    if (isHeadlessUA(ua)) requestFlags.push("headless");
    const storedFlags = (existingProperties?.Flags?.multi_select ?? [])
      .map((option) => option.name)
      .filter((name): name is string => typeof name === "string" && Boolean(name));
    const flags = sameSubmission ? storedFlags : requestFlags;
    const storedSuspect = existingProperties?.Suspect?.checkbox;
    const suspect =
      sameSubmission && typeof storedSuspect === "boolean" ? storedSuspect : flags.length > 0;

    const refCode =
      sameSubmission && storedRefCode.length === 8 ? storedRefCode : canonicalClaim.refCode;
    const referredBy = sanitizeRef(data.referredBy);
    const conversionEligible =
      !duplicate && !suspect && data.measurementConsent && Boolean(data.eventId);
    const attribution = data.attribution ?? {};
    if (!conversionEligible) {
      console.log(
        `[meta-capi] skipped: ${
          duplicate
            ? "duplicate"
            : suspect
              ? `blocked(${flags.join(",")})`
              : !data.measurementConsent
                ? "no measurement consent"
                : "no eventId"
        }`,
      );
    }
    const metaLeadEventId = conversionEligible ? data.eventId : undefined;
    const metaPhoneEventId =
      conversionEligible && data.eventId
        ? metaPhoneEventIdForInput(data.eventId, data.phone)
        : undefined;
    const preliminaryOutcome: FunnelLeadOutcome = {
      leadId,
      eventId: data.eventId,
      sessionId: data.sessionId,
      visitorId: data.visitorId,
      acquisitionPath: "website",
      source: data.source,
      pagePath: data.landingPath,
      country,
      status: duplicate ? "duplicate" : suspect ? "suspect" : "new",
      valid: !duplicate && !suspect,
      hasEmail: true,
      hasPhone: Boolean(metaPhoneEventIdForInput(leadId, data.phone)),
      measurementConsent: data.measurementConsent,
      metaEligible: conversionEligible,
      metaCapiState: "skipped",
      metaEventsReceived: 0,
      notionPageId: sameSubmission ? existingPage?.id : undefined,
      attribution,
      signedUpAt,
      flags,
      schemaVersion: FUNNEL_SCHEMA_VERSION,
    };

    await persistNewWebsiteLeadDurably({
      writePreliminary: () => recordLeadOutcome(preliminaryOutcome),
      writeValidation: () =>
        recordServerFunnelEvent({
          idempotencyKey: `website:${leadId}:validation`,
          eventName: "lead_validated",
          occurredAt: signedUpAt,
          acquisitionPath: "website",
          source: data.source,
          attribution,
          properties: {
            valid: !duplicate && !suspect,
            status: duplicate ? "duplicate" : suspect ? "suspect" : "new",
          },
        }),
      writeNotionAndMeta: async () => {
        const persistedPage =
          (sameSubmission ? existingPage : undefined) ??
          ((await withCanonicalEmailShape(() =>
            notionFetch("pages", {
              parent: { database_id: dbId },
              properties: {
                Email: { title: [{ text: { content: email } }] },
                ...canonicalEmailProperties(canonical),
                ...(data.phone?.trim() ? { Phone: textProp(data.phone.trim()) } : {}),
                Source: { select: { name: data.source } },
                "Signed up": { date: { start: signedUpAt } },
                "Ref code": textProp(refCode),
                "Lead ID": textProp(leadId),
                "Acquisition path": { select: { name: "website" } },
                "Measurement consent": textProp(
                  data.measurementConsent ? "form_submit_granted" : "denied",
                ),
                "Verification status": { select: { name: "pending" } },
                "Email verified": { checkbox: false },
                "Phone verified": { checkbox: false },
                "Attribution status": { select: { name: attributionCompleteness(attribution) } },
                "Source schema version": textProp(FUNNEL_SCHEMA_VERSION),
                "Source coverage": { select: { name: sourceCoverage(data) } },
                "Qualification rule version": textProp("2026-07-29.v1"),
                Environment: { select: { name: runtimeEnvironment() } },
                Counted: { checkbox: !duplicate && !suspect },
                Duplicate: { checkbox: duplicate },
                "Meta eligible": { checkbox: conversionEligible },
                "Meta CAPI state": { select: { name: "skipped" } },
                ...(data.eventId ? { "Meta Event ID": textProp(data.eventId) } : {}),
                ...(data.sessionId ? { "Session ID": textProp(data.sessionId) } : {}),
                ...(data.visitorId ? { "Visitor ID": textProp(data.visitorId) } : {}),
                ...(data.landingPath ? { "Landing path": textProp(data.landingPath) } : {}),
                ...(data.browserLanguage
                  ? { "Browser language": textProp(data.browserLanguage) }
                  : {}),
                ...(country ? { Country: textProp(country) } : {}),
                ...(process.env.VERCEL_DEPLOYMENT_ID
                  ? { "Deployment ID": textProp(process.env.VERCEL_DEPLOYMENT_ID) }
                  : {}),
                ...(process.env.VERCEL_GIT_COMMIT_SHA
                  ? { "Landing page version": textProp(process.env.VERCEL_GIT_COMMIT_SHA) }
                  : {}),
                ...(attribution.utmSource ? { "UTM Source": textProp(attribution.utmSource) } : {}),
                ...(attribution.utmMedium ? { "UTM Medium": textProp(attribution.utmMedium) } : {}),
                ...(attribution.utmCampaign
                  ? { "UTM Campaign": textProp(attribution.utmCampaign) }
                  : {}),
                ...(attribution.utmContent
                  ? { "UTM Content": textProp(attribution.utmContent) }
                  : {}),
                ...(attribution.utmTerm ? { "UTM Term": textProp(attribution.utmTerm) } : {}),
                ...(attribution.metaCampaignId
                  ? { "Meta Campaign ID": textProp(attribution.metaCampaignId) }
                  : {}),
                ...(attribution.metaAdSetId
                  ? { "Meta Ad Set ID": textProp(attribution.metaAdSetId) }
                  : {}),
                ...(attribution.metaAdId ? { "Meta Ad ID": textProp(attribution.metaAdId) } : {}),
                ...(attribution.publisherPlatform
                  ? { "Publisher platform": textProp(attribution.publisherPlatform) }
                  : {}),
                ...(attribution.placement ? { Placement: textProp(attribution.placement) } : {}),
                ...(referredBy && referredBy !== refCode
                  ? { "Referred by": textProp(referredBy) }
                  : {}),
                ...(flags.length
                  ? { Flags: { multi_select: flags.map((name) => ({ name })) } }
                  : {}),
                Suspect: { checkbox: suspect },
              },
            }),
          )) as NotionPageResult);
        const notionPageId = persistedPage.id;
        if (!notionPageId) throw new Error("Notion waitlist page id is missing");

        let metaCapiState: "sent" | "skipped" | "failed" = "skipped";
        let metaEventsReceived = 0;
        const priorMetaCapiState = existingProperties?.["Meta CAPI state"]?.select?.name;
        // A response-loss retry does not need another CAPI send when Notion
        // already confirms the exact same event id was delivered.
        if (sameSubmission && priorMetaCapiState === "sent") {
          metaCapiState = "sent";
          metaEventsReceived = metaPhoneEventId ? 2 : 1;
        } else if (conversionEligible && data.eventId) {
          const metaResult = await sendMetaLead({
            eventId: data.eventId,
            email,
            phone: data.phone,
            ip,
            ua,
            fbp: data.fbp,
            fbc: data.fbc,
            source: data.source,
            eventSourceUrl: data.landingPath,
          });
          metaCapiState = metaResult.state;
          metaEventsReceived = metaResult.eventsReceived;
        }

        if (metaCapiState !== "skipped") {
          try {
            await notionPatch(`pages/${notionPageId}`, {
              properties: {
                "Meta CAPI state": { select: { name: metaCapiState } },
              },
            });
          } catch (error) {
            console.error("[meta-capi] could not persist delivery state", error);
          }
        }
        return { notionPageId, metaCapiState, metaEventsReceived };
      },
      writeFinal: ({ notionPageId, metaCapiState, metaEventsReceived }) =>
        recordLeadOutcome({
          ...preliminaryOutcome,
          notionPageId,
          metaCapiState,
          metaEventsReceived,
        }),
    });

    _waitlistCountCache = null;

    // Always report success (even to suspects) so the anti-abuse logic isn't
    // advertised — they just quietly don't count.
    return {
      ok: true,
      duplicate,
      refCode,
      metaEventId: metaLeadEventId,
      metaPhoneEventId,
    };
  },
);

export const joinWaitlist = createServerFn({ method: "POST" })
  .validator(joinWaitlistInput)
  .handler(handleJoinWaitlist);
