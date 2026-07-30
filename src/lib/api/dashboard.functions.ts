import { createHash, timingSafeEqual } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DASHBOARD_RPC_TIMEOUT_MS = 10_000;
const DIMENSIONS = [
  "path",
  "source",
  "page",
  "channel",
  "placement",
  "country",
  "campaign",
  "adSet",
  "ad",
  "creative",
] as const;
type Dimension = (typeof DIMENSIONS)[number];

const CPL_COMPARABLE_DIMENSIONS = new Set<Dimension>([
  "path",
  "channel",
  "placement",
  "country",
  "campaign",
  "adSet",
  "ad",
  "creative",
]);

type StorageState = "ready" | "unconfigured" | "error";
type MetaState = "ready" | "unconfigured" | "configured_no_data" | "stale";
type HealthSeverity = "good" | "warning" | "critical" | "info";

const dashboardRequestSchema = z
  .object({
    token: z.string().min(1).max(512),
    from: z.string().regex(DATE_PATTERN),
    to: z.string().regex(DATE_PATTERN),
  })
  .superRefine((value, context) => {
    const from = Date.parse(`${value.from}T00:00:00+09:00`);
    const to = Date.parse(`${value.to}T00:00:00+09:00`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date range" });
      return;
    }
    if ((to - from) / 86_400_000 > 89) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dashboard range cannot exceed 90 days",
      });
    }
  });

const aggregateMetricSchema = z
  .object({
    dimension: z.enum(DIMENSIONS),
    key: z.string(),
    label: z.string(),
  })
  .passthrough();

const metaAggregateSyncSchema = z
  .object({
    expected_generation: z.number().int().positive().nullable(),
    current_generation: z.number().int().positive().nullable(),
    status: z.enum(["syncing", "ready", "failed"]).nullable(),
    ready_for_expected_scope: z.boolean(),
    exact_marker_current: z.boolean(),
  })
  .strict();

const dashboardAggregateSchema = z
  .object({
    event_totals: z.record(z.string(), z.unknown()),
    scoped_event_totals: z.record(z.string(), z.unknown()),
    lead_totals: z.record(z.string(), z.unknown()),
    scoped_lead_totals: z.record(z.string(), z.unknown()),
    meta_sync: metaAggregateSyncSchema,
    meta_totals: z.record(z.string(), z.unknown()),
    event_metrics: z.array(aggregateMetricSchema),
    lead_metrics: z.array(aggregateMetricSchema),
    meta_metrics: z.array(aggregateMetricSchema),
    schema_versions: z.array(z.string()),
  })
  .strict();

export type AggregateMetric = z.infer<typeof aggregateMetricSchema>;
type DashboardAggregate = z.infer<typeof dashboardAggregateSchema>;

export type DashboardHealthItem = {
  code: string;
  severity: HealthSeverity;
  title: string;
  detail: string;
};

export type DashboardStage = {
  key: string;
  label: string;
  count: number | null;
  rateFromPrevious: number | null;
  rateFromFirst: number | null;
};

export type DashboardBreakdownRow = {
  key: string;
  label: string;
  landingSessions: number;
  formViews: number;
  formStarts: number;
  ctaViews: number;
  ctaClicks: number;
  videoPlays: number;
  video25: number;
  video50: number;
  video75: number;
  videoCompletions: number;
  submitAttempts: number;
  submitSuccesses: number;
  submitErrors: number;
  metaBrowserLeadDispatches: number;
  metaBrowserContactDispatches: number;
  newLeads: number;
  duplicateLeads: number;
  suspectLeads: number;
  invalidLeads: number;
  validLeads: number;
  paidAttributedValidLeads: number;
  paidAttributedVerifiedPhoneLeads: number;
  verifiedLeads: number;
  totalLeads: number;
  leadsWithEmail: number;
  leadsWithPhone: number;
  emailVerifiedLeads: number;
  phoneVerifiedLeads: number;
  measurementConsentedLeads: number;
  capiEligibleLeads: number;
  capiSentLeads: number;
  capiFailedLeads: number;
  capiSkippedLeads: number;
  metaEventsReceived: number;
  spendEur: number;
  impressions: number;
  reach: null;
  linkClicks: number;
  landingPageViews: number;
  websiteMetaLeads: number;
  websiteMetaContacts: number;
  instantFormOpens: number;
  instantFormStarts: number;
  instantFormMetaLeads: number;
  metaVideo3s: number;
  metaVideoThruplay: number;
  metaVideo25: number;
  metaVideo50: number;
  metaVideo75: number;
  metaVideo95: number;
  metaVideo100: number;
  validLeadCpl: number | null;
  phoneLeadCpl: number | null;
};

export type DashboardPayload = {
  ok: true;
  generatedAt: string;
  range: {
    from: string;
    to: string;
    timezone: "Asia/Seoul";
  };
  integrations: {
    storage: StorageState;
    meta: MetaState;
    metaTokenConfigured: boolean;
    metaScopeConfigured: boolean;
    leadStatusWebhookConfigured: boolean;
    metaLastSyncedAt: string | null;
  };
  coverage: {
    eventRowsRead: number;
    leadRowsRead: number;
    metaRowsRead: number;
    eventRowsTruncated: boolean;
    leadRowsTruncated: boolean;
    metaRowsTruncated: boolean;
    latestEventAt: string | null;
    latestLeadAt: string | null;
    attributedLandingRate: number | null;
    attributedLeadRate: number | null;
    exactMetaRangeAvailable: boolean;
    exactMetaRangeSyncedAt: string | null;
    schemaVersions: string[];
  };
  totals: {
    spendEur: number;
    impressions: number;
    reach: number | null;
    frequency: number | null;
    cpmEur: number | null;
    linkCtr: number | null;
    linkCpcEur: number | null;
    linkClicks: number;
    landingPageViews: number;
    websiteMetaLeads: number;
    websiteMetaContacts: number;
    instantFormMetaLeads: number;
    validLeads: number;
    verifiedLeads: number;
    duplicateLeads: number;
    suspectLeads: number;
    invalidLeads: number;
    paidAttributedValidLeads: number;
    paidAttributedVerifiedPhoneLeads: number;
    ctaViews: number;
    ctaClicks: number;
    videoPlays: number;
    video25: number;
    video50: number;
    video75: number;
    videoCompletions: number;
    submitSuccesses: number;
    submitErrors: number;
    metaBrowserLeadDispatches: number;
    metaBrowserContactDispatches: number;
    totalLeads: number;
    leadsWithEmail: number;
    leadsWithPhone: number;
    emailVerifiedLeads: number;
    phoneVerifiedLeads: number;
    measurementConsentedLeads: number;
    capiEligibleLeads: number;
    capiSentLeads: number;
    capiFailedLeads: number;
    capiSkippedLeads: number;
    metaEventsReceived: number;
    metaVideo3s: number;
    metaVideoThruplay: number;
    metaVideo25: number;
    metaVideo50: number;
    metaVideo75: number;
    metaVideo95: number;
    metaVideo100: number;
    validLeadCpl: number | null;
    phoneLeadCpl: number | null;
  };
  funnels: {
    website: DashboardStage[];
    instantForm: DashboardStage[];
  };
  breakdowns: Record<Dimension, DashboardBreakdownRow[]>;
  health: DashboardHealthItem[];
};

export type DashboardResponse =
  | DashboardPayload
  | {
      ok: false;
      reason:
        | "unauthorized"
        | "dashboard_token_unconfigured"
        | "invalid_request"
        | "aggregate_unavailable"
        | "meta_sync_failed";
    };

export type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

export type MetaScope = {
  accountId: string;
  campaignIds: string[];
  campaignIdSet: Set<string>;
};

function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

function cleanMetaId(value: string | null | undefined): string | null {
  const cleaned = value?.trim().replace(/^act_/, "");
  return cleaned && /^\d{5,30}$/.test(cleaned) ? cleaned : null;
}

export function resolveMetaScope(
  accountValue: string | undefined,
  campaignValue: string | undefined,
): MetaScope | null {
  const accountId = cleanMetaId(accountValue);
  const campaignIds = [
    ...new Set(
      (campaignValue ?? "")
        .split(",")
        .map((value) => cleanMetaId(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (!accountId || campaignIds.length === 0) return null;
  return { accountId, campaignIds, campaignIdSet: new Set(campaignIds) };
}

function metaIdSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((candidate) => cleanMetaId(candidate))
      .filter((candidate): candidate is string => Boolean(candidate)),
  );
}

export function hasCompleteConversionLocationScope(
  scope: MetaScope | null,
  websiteCampaigns: string | undefined,
  instantFormCampaigns: string | undefined,
): boolean {
  if (!scope) return false;
  const websiteIds = metaIdSet(websiteCampaigns);
  const instantFormIds = metaIdSet(instantFormCampaigns);
  return scope.campaignIds.every(
    (campaignId) => websiteIds.has(campaignId) !== instantFormIds.has(campaignId),
  );
}

function configuredMetaScope(): MetaScope | null {
  return resolveMetaScope(process.env.META_AD_ACCOUNT_ID, process.env.META_CAMPAIGN_IDS);
}

function metaTokenConfigured(): boolean {
  return Boolean(
    process.env.META_MARKETING_ACCESS_TOKEN?.trim() ||
    process.env.META_ADS_ACCESS_TOKEN?.trim() ||
    process.env.META_GRAPH_ACCESS_TOKEN?.trim(),
  );
}

function tokenMatches(candidate: string): boolean {
  const expected = process.env.FUNNEL_DASHBOARD_TOKEN?.trim();
  if (!expected) return false;
  const candidateHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function isoBoundaries(from: string, to: string): { start: string; endExclusive: string } {
  const startMs = Date.parse(`${from}T00:00:00+09:00`);
  const endMs = Date.parse(`${to}T00:00:00+09:00`) + 86_400_000;
  return {
    start: new Date(startMs).toISOString(),
    endExclusive: new Date(endMs).toISOString(),
  };
}

export function isCampaignInScope(
  campaignId: string | null | undefined,
  campaignIds: ReadonlySet<string>,
): boolean {
  const normalized = cleanMetaId(campaignId);
  return normalized !== null && campaignIds.has(normalized);
}

export function creativeJoinKey(
  metaAdId: string | null | undefined,
  utmContent: string | null | undefined,
): string {
  return metaAdId?.trim() || utmContent?.trim() || "unknown";
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function stages(
  values: Array<{ key: string; label: string; count: number | null }>,
): DashboardStage[] {
  const first = values[0]?.count ?? null;
  return values.map((value, index) => ({
    ...value,
    rateFromPrevious: index === 0 ? null : rate(value.count, values[index - 1]?.count ?? null),
    rateFromFirst: index === 0 ? (first === null ? null : 100) : rate(value.count, first),
  }));
}

function preferLabel(current: string, candidate: string): string {
  const currentUnknown = /unknown|meta \/ unknown/i.test(current);
  const candidateUnknown = /unknown|meta \/ unknown/i.test(candidate);
  return currentUnknown && !candidateUnknown ? candidate : current;
}

function emptyBreakdownRow(key: string, label: string): DashboardBreakdownRow {
  return {
    key,
    label,
    landingSessions: 0,
    formViews: 0,
    formStarts: 0,
    ctaViews: 0,
    ctaClicks: 0,
    videoPlays: 0,
    video25: 0,
    video50: 0,
    video75: 0,
    videoCompletions: 0,
    submitAttempts: 0,
    submitSuccesses: 0,
    submitErrors: 0,
    metaBrowserLeadDispatches: 0,
    metaBrowserContactDispatches: 0,
    newLeads: 0,
    duplicateLeads: 0,
    suspectLeads: 0,
    invalidLeads: 0,
    validLeads: 0,
    paidAttributedValidLeads: 0,
    paidAttributedVerifiedPhoneLeads: 0,
    verifiedLeads: 0,
    totalLeads: 0,
    leadsWithEmail: 0,
    leadsWithPhone: 0,
    emailVerifiedLeads: 0,
    phoneVerifiedLeads: 0,
    measurementConsentedLeads: 0,
    capiEligibleLeads: 0,
    capiSentLeads: 0,
    capiFailedLeads: 0,
    capiSkippedLeads: 0,
    metaEventsReceived: 0,
    spendEur: 0,
    impressions: 0,
    reach: null,
    linkClicks: 0,
    landingPageViews: 0,
    websiteMetaLeads: 0,
    websiteMetaContacts: 0,
    instantFormOpens: 0,
    instantFormStarts: 0,
    instantFormMetaLeads: 0,
    metaVideo3s: 0,
    metaVideoThruplay: 0,
    metaVideo25: 0,
    metaVideo50: 0,
    metaVideo75: 0,
    metaVideo95: 0,
    metaVideo100: 0,
    validLeadCpl: null,
    phoneLeadCpl: null,
  };
}

function metricKey(metric: AggregateMetric): string {
  return `${metric.dimension}\u001f${metric.key}`;
}

function emptyBreakdowns(): DashboardPayload["breakdowns"] {
  return {
    path: [],
    source: [],
    page: [],
    channel: [],
    placement: [],
    country: [],
    campaign: [],
    adSet: [],
    ad: [],
    creative: [],
  };
}

/**
 * Joins already-aggregated SQL rows. It never sums across dimensions: each
 * dimension/key cell is independently calculated by Postgres.
 */
export function mergeAggregateBreakdowns(
  eventMetrics: AggregateMetric[],
  leadMetrics: AggregateMetric[],
  metaMetrics: AggregateMetric[],
  paidDataAvailable: boolean,
): DashboardPayload["breakdowns"] {
  const merged = new Map<string, { dimension: Dimension; row: DashboardBreakdownRow }>();
  const metaDeliveryCells = new Set<string>();
  const get = (metric: AggregateMetric) => {
    const joinedKey = metricKey(metric);
    const existing = merged.get(joinedKey);
    if (existing) {
      existing.row.label = preferLabel(existing.row.label, metric.label);
      return existing.row;
    }
    const row = emptyBreakdownRow(metric.key, metric.label);
    merged.set(joinedKey, { dimension: metric.dimension, row });
    return row;
  };

  for (const metric of eventMetrics) {
    const row = get(metric);
    row.landingSessions = numeric(metric.landing_sessions);
    row.formViews = numeric(metric.form_views);
    row.formStarts = numeric(metric.form_starts);
    row.ctaViews = numeric(metric.cta_views);
    row.ctaClicks = numeric(metric.cta_clicks);
    row.videoPlays = numeric(metric.video_plays);
    row.video25 = numeric(metric.video_25);
    row.video50 = numeric(metric.video_50);
    row.video75 = numeric(metric.video_75);
    row.videoCompletions = numeric(metric.video_completions);
    row.submitAttempts = numeric(metric.submit_attempts);
    row.submitSuccesses = numeric(metric.submit_successes);
    row.submitErrors = numeric(metric.submit_errors);
    row.metaBrowserLeadDispatches = numeric(metric.meta_browser_lead_dispatches);
    row.metaBrowserContactDispatches = numeric(metric.meta_browser_contact_dispatches);
  }

  for (const metric of leadMetrics) {
    const row = get(metric);
    row.newLeads = numeric(metric.new_leads);
    row.duplicateLeads = numeric(metric.duplicate_leads);
    row.suspectLeads = numeric(metric.suspect_leads);
    row.invalidLeads = numeric(metric.invalid_leads);
    row.validLeads = numeric(metric.valid_leads);
    row.paidAttributedValidLeads = numeric(metric.paid_valid_leads);
    row.paidAttributedVerifiedPhoneLeads = numeric(metric.paid_verified_phone_leads);
    row.verifiedLeads = numeric(metric.verified_leads);
    row.totalLeads = numeric(metric.total_leads);
    row.leadsWithEmail = numeric(metric.leads_with_email);
    row.leadsWithPhone = numeric(metric.leads_with_phone);
    row.emailVerifiedLeads = numeric(metric.email_verified_leads);
    row.phoneVerifiedLeads = numeric(metric.phone_verified_leads);
    row.measurementConsentedLeads = numeric(metric.measurement_consented_leads);
    row.capiEligibleLeads = numeric(metric.capi_eligible_leads);
    row.capiSentLeads = numeric(metric.capi_sent_leads);
    row.capiFailedLeads = numeric(metric.capi_failed_leads);
    row.capiSkippedLeads = numeric(metric.capi_skipped_leads);
    row.metaEventsReceived = numeric(metric.meta_events_received);
  }

  for (const metric of metaMetrics) {
    const row = get(metric);
    row.spendEur = numeric(metric.spend_eur);
    row.impressions = numeric(metric.impressions);
    row.linkClicks = numeric(metric.link_clicks);
    row.landingPageViews = numeric(metric.landing_page_views);
    row.websiteMetaLeads = numeric(metric.website_leads);
    row.websiteMetaContacts = numeric(metric.website_contacts);
    row.instantFormOpens = numeric(metric.instant_form_opens);
    row.instantFormStarts = numeric(metric.instant_form_starts);
    row.instantFormMetaLeads = numeric(metric.instant_form_leads);
    row.metaVideo3s = numeric(metric.video_3s);
    row.metaVideoThruplay = numeric(metric.video_thruplay);
    row.metaVideo25 = numeric(metric.video_25);
    row.metaVideo50 = numeric(metric.video_50);
    row.metaVideo75 = numeric(metric.video_75);
    row.metaVideo95 = numeric(metric.video_95);
    row.metaVideo100 = numeric(metric.video_100);
    if (row.impressions > 0 || row.spendEur > 0) {
      metaDeliveryCells.add(metricKey(metric));
    }
  }

  const output = emptyBreakdowns();
  for (const value of merged.values()) {
    const { row } = value;
    row.spendEur = Number(row.spendEur.toFixed(4));
    const comparablePaidCell =
      CPL_COMPARABLE_DIMENSIONS.has(value.dimension) &&
      metaDeliveryCells.has(`${value.dimension}\u001f${row.key}`);
    row.validLeadCpl =
      paidDataAvailable && comparablePaidCell && row.paidAttributedValidLeads > 0
        ? Number((row.spendEur / row.paidAttributedValidLeads).toFixed(4))
        : null;
    row.phoneLeadCpl =
      paidDataAvailable && comparablePaidCell && row.paidAttributedVerifiedPhoneLeads > 0
        ? Number((row.spendEur / row.paidAttributedVerifiedPhoneLeads).toFixed(4))
        : null;
    output[value.dimension].push(row);
  }
  for (const dimension of DIMENSIONS) {
    output[dimension].sort(
      (a, b) =>
        b.validLeads - a.validLeads ||
        b.spendEur - a.spendEur ||
        b.landingSessions - a.landingSessions ||
        a.label.localeCompare(b.label),
    );
    output[dimension] = output[dimension].slice(0, 100);
  }
  return output;
}

function pathMetric(metrics: AggregateMetric[], key: string): AggregateMetric | undefined {
  return metrics.find((metric) => metric.dimension === "path" && metric.key === key);
}

async function readDashboardAggregate(
  config: SupabaseConfig,
  from: string,
  to: string,
  metaScope: MetaScope | null,
  metaScopeAvailable: boolean,
  expectedMetaGeneration: number | null,
  websiteCampaignIds: string[],
  instantFormCampaignIds: string[],
): Promise<DashboardAggregate> {
  const boundaries = isoBoundaries(from, to);
  const response = await fetch(`${config.url}/rest/v1/rpc/get_funnel_dashboard_aggregate_v1`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_start: boundaries.start,
      p_end_exclusive: boundaries.endExclusive,
      p_from: from,
      p_to: to,
      p_environment: "production",
      p_account_id: metaScopeAvailable ? metaScope?.accountId : null,
      p_expected_meta_generation: metaScopeAvailable ? expectedMetaGeneration : null,
      p_campaign_ids: metaScopeAvailable ? metaScope?.campaignIds : [],
      p_website_campaign_ids: metaScopeAvailable ? websiteCampaignIds : [],
      p_instant_form_campaign_ids: metaScopeAvailable ? instantFormCampaignIds : [],
    }),
    signal: AbortSignal.timeout(DASHBOARD_RPC_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error(
      `[dashboard] aggregate query failed (${response.status}): ${detail.slice(0, 300)}`,
    );
    throw new Error("aggregate_query_failed");
  }

  const value: unknown = await response.json();
  const unwrapped = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const parsed = dashboardAggregateSchema.safeParse(unwrapped);
  if (!parsed.success) {
    console.error(`[dashboard] aggregate response invalid: ${parsed.error.message.slice(0, 500)}`);
    throw new Error("aggregate_response_invalid");
  }
  return parsed.data;
}

function metaIntegrationState(
  configured: boolean,
  latestSync: string | null,
  exactMarkerCurrent: boolean,
): MetaState {
  if (!configured) return "unconfigured";
  if (!exactMarkerCurrent || !latestSync) return "configured_no_data";
  return Date.now() - Date.parse(latestSync) > 36 * 60 * 60 * 1_000 ? "stale" : "ready";
}

export function isCurrentMetaAggregate(
  sync: z.infer<typeof metaAggregateSyncSchema>,
  expectedGeneration: number | undefined,
): boolean {
  return (
    expectedGeneration !== undefined &&
    sync.expected_generation === expectedGeneration &&
    sync.current_generation === expectedGeneration &&
    sync.status === "ready" &&
    sync.ready_for_expected_scope &&
    sync.exact_marker_current
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyPayload(
  from: string,
  to: string,
  metaTokenAvailable: boolean,
  metaScopeAvailable: boolean,
): DashboardPayload {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    range: { from, to, timezone: "Asia/Seoul" },
    integrations: {
      storage: "unconfigured",
      meta: metaTokenAvailable && metaScopeAvailable ? "configured_no_data" : "unconfigured",
      metaTokenConfigured: metaTokenAvailable,
      metaScopeConfigured: metaScopeAvailable,
      leadStatusWebhookConfigured: Boolean(process.env.LEAD_STATUS_WEBHOOK_SECRET?.trim()),
      metaLastSyncedAt: null,
    },
    coverage: {
      eventRowsRead: 0,
      leadRowsRead: 0,
      metaRowsRead: 0,
      eventRowsTruncated: false,
      leadRowsTruncated: false,
      metaRowsTruncated: false,
      latestEventAt: null,
      latestLeadAt: null,
      attributedLandingRate: null,
      attributedLeadRate: null,
      exactMetaRangeAvailable: false,
      exactMetaRangeSyncedAt: null,
      schemaVersions: [],
    },
    totals: {
      spendEur: 0,
      impressions: 0,
      reach: null,
      frequency: null,
      cpmEur: null,
      linkCtr: null,
      linkCpcEur: null,
      linkClicks: 0,
      landingPageViews: 0,
      websiteMetaLeads: 0,
      websiteMetaContacts: 0,
      instantFormMetaLeads: 0,
      validLeads: 0,
      verifiedLeads: 0,
      duplicateLeads: 0,
      suspectLeads: 0,
      invalidLeads: 0,
      paidAttributedValidLeads: 0,
      paidAttributedVerifiedPhoneLeads: 0,
      ctaViews: 0,
      ctaClicks: 0,
      videoPlays: 0,
      video25: 0,
      video50: 0,
      video75: 0,
      videoCompletions: 0,
      submitSuccesses: 0,
      submitErrors: 0,
      metaBrowserLeadDispatches: 0,
      metaBrowserContactDispatches: 0,
      totalLeads: 0,
      leadsWithEmail: 0,
      leadsWithPhone: 0,
      emailVerifiedLeads: 0,
      phoneVerifiedLeads: 0,
      measurementConsentedLeads: 0,
      capiEligibleLeads: 0,
      capiSentLeads: 0,
      capiFailedLeads: 0,
      capiSkippedLeads: 0,
      metaEventsReceived: 0,
      metaVideo3s: 0,
      metaVideoThruplay: 0,
      metaVideo25: 0,
      metaVideo50: 0,
      metaVideo75: 0,
      metaVideo95: 0,
      metaVideo100: 0,
      validLeadCpl: null,
      phoneLeadCpl: null,
    },
    funnels: {
      website: stages([
        { key: "link_click", label: "Meta link click", count: null },
        { key: "meta_lpv", label: "Meta landing-page view", count: null },
        { key: "landing", label: "First-party landing session", count: null },
        { key: "cta_view", label: "CTA viewed", count: null },
        { key: "cta_click", label: "CTA clicked", count: null },
        { key: "form_view", label: "Form viewed", count: null },
        { key: "form_start", label: "Form started", count: null },
        { key: "submit", label: "Submit attempted", count: null },
        { key: "success", label: "Submit succeeded", count: null },
        { key: "valid", label: "Valid lead", count: null },
        { key: "verified", label: "Verified lead", count: null },
      ]),
      instantForm: stages([
        { key: "open", label: "Instant Form opened", count: null },
        { key: "start", label: "Instant Form started", count: null },
        { key: "submit", label: "Instant Form submitted", count: null },
        { key: "webhook", label: "Webhook received", count: null },
        { key: "crm", label: "CRM saved", count: null },
        { key: "valid", label: "Valid lead", count: null },
        { key: "verified", label: "Verified lead", count: null },
      ]),
    },
    breakdowns: emptyBreakdowns(),
    health: [
      {
        code: "storage_unconfigured",
        severity: "critical",
        title: "Funnel storage is not configured",
        detail:
          "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. No metric is inferred while storage is unavailable.",
      },
      ...(metaTokenAvailable
        ? []
        : [
            {
              code: "meta_token_unconfigured",
              severity: "warning" as const,
              title: "Meta Insights sync is not configured",
              detail:
                "Set META_MARKETING_ACCESS_TOKEN (or META_ADS_ACCESS_TOKEN / META_GRAPH_ACCESS_TOKEN) before treating paid-media metrics as available.",
            },
          ]),
      ...(!metaScopeAvailable
        ? [
            {
              code: "meta_scope_unconfigured",
              severity: "critical" as const,
              title: "Meta account and campaign scope is not configured",
              detail:
                "Set valid META_AD_ACCOUNT_ID and META_CAMPAIGN_IDS values, then place every campaign in exactly one conversion-location allowlist. Paid-media totals and CPL remain unavailable until the numerator and denominator share one exact scope.",
            },
          ]
        : []),
    ],
  };
}

function storageErrorPayload(
  from: string,
  to: string,
  metaTokenAvailable: boolean,
  metaScopeAvailable: boolean,
): DashboardPayload {
  const payload = emptyPayload(from, to, metaTokenAvailable, metaScopeAvailable);
  payload.integrations.storage = "error";
  payload.health[0] = {
    code: "storage_aggregate_failed",
    severity: "critical",
    title: "Exact funnel aggregate query failed",
    detail:
      "No partial metrics are shown. Apply the funnel measurement migration, verify the service-role credential, and check server logs.",
  };
  return payload;
}

export async function buildDashboard(from: string, to: string): Promise<DashboardResponse> {
  const metaTokenAvailable = metaTokenConfigured();
  const metaScope = configuredMetaScope();
  const websiteCampaignIds = [...metaIdSet(process.env.META_WEBSITE_CAMPAIGN_IDS)].sort();
  const instantFormCampaignIds = [...metaIdSet(process.env.META_INSTANT_FORM_CAMPAIGN_IDS)].sort();
  const metaScopeAvailable = hasCompleteConversionLocationScope(
    metaScope,
    process.env.META_WEBSITE_CAMPAIGN_IDS,
    process.env.META_INSTANT_FORM_CAMPAIGN_IDS,
  );
  const config = getSupabaseConfig();
  if (!config) return { ok: false, reason: "aggregate_unavailable" };

  let insightSync: {
    configured: boolean;
    ok: boolean;
    rows: number;
    reason?: string;
    source?: "refresh" | "cache";
    generation?: number;
  } = { configured: false, ok: false, rows: 0, reason: "token_unconfigured" };
  let aggregate: DashboardAggregate | undefined;
  if (metaTokenAvailable) {
    const metaInsights = await import("./metaInsights.server");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      insightSync = await metaInsights.syncMetaInsights(from, to);
      if (!insightSync.ok) {
        // A syncing/failed DB generation prevents every server replica from
        // treating an older paid snapshot as current.
        if (
          (insightSync.reason === "generation_conflict" ||
            insightSync.reason === "sync_in_progress") &&
          attempt === 0
        ) {
          // A second replica reserved a newer generation before this replica
          // could commit, or is already refreshing the same exact scope.
          // Retry once; hard Graph/storage failures remain terminal.
          await delay(1_000);
          continue;
        }
        return { ok: false, reason: "meta_sync_failed" };
      }

      try {
        aggregate = await readDashboardAggregate(
          config,
          from,
          to,
          metaScope,
          metaScopeAvailable,
          insightSync.generation ?? null,
          websiteCampaignIds,
          instantFormCampaignIds,
        );
      } catch {
        return storageErrorPayload(from, to, metaTokenAvailable, metaScopeAvailable);
      }

      if (isCurrentMetaAggregate(aggregate.meta_sync, insightSync.generation)) break;
      aggregate = undefined;
      if (attempt === 0) {
        // A second replica may reserve a newer generation between replace and
        // aggregate. Retry the entire bounded refresh once, then fail closed.
        await delay(1_000);
      }
    }
    if (!aggregate) {
      return { ok: false, reason: "meta_sync_failed" };
    }
  }

  if (!aggregate) {
    try {
      aggregate = await readDashboardAggregate(
        config,
        from,
        to,
        metaScope,
        metaScopeAvailable,
        null,
        websiteCampaignIds,
        instantFormCampaignIds,
      );
    } catch {
      return storageErrorPayload(from, to, metaTokenAvailable, metaScopeAvailable);
    }
  }

  const eventTotals = aggregate.event_totals;
  const scopedEventTotals = aggregate.scoped_event_totals;
  const leadTotals = aggregate.lead_totals;
  const scopedLeadTotals = aggregate.scoped_lead_totals;
  const metaTotals = aggregate.meta_totals;
  const eventRows = numeric(eventTotals.event_rows);
  const leadRows = numeric(leadTotals.lead_rows);
  const metaRows = numeric(metaTotals.meta_rows);
  const paidDataAvailable =
    metaTokenAvailable &&
    insightSync.ok &&
    metaScopeAvailable &&
    isCurrentMetaAggregate(aggregate.meta_sync, insightSync.generation);
  const paidMetric = (value: unknown): number => (paidDataAvailable ? numeric(value) : 0);
  const latestEventAt = timestamp(eventTotals.latest_event_at);
  const latestLeadAt = timestamp(leadTotals.latest_lead_at);
  const latestMetaSync = paidDataAvailable ? timestamp(metaTotals.latest_meta_sync) : null;
  const exactMetaRangeSyncedAt = paidDataAvailable
    ? timestamp(metaTotals.exact_range_synced_at)
    : null;
  const exactMetaRangeAvailable = paidDataAvailable && exactMetaRangeSyncedAt !== null;
  const exactReach = exactMetaRangeAvailable ? optionalNumeric(metaTotals.exact_reach) : null;
  const exactFrequency = exactMetaRangeAvailable
    ? optionalNumeric(metaTotals.exact_frequency)
    : null;
  const totalSpend = paidMetric(metaTotals.spend_eur);
  const totalImpressions = paidMetric(metaTotals.impressions);
  const totalLinkClicks = paidMetric(metaTotals.link_clicks);
  const paidAttributedValidLeads = numeric(leadTotals.paid_valid_leads);
  const paidAttributedVerifiedPhoneLeads = numeric(leadTotals.paid_verified_phone_leads);
  const landingRows = numeric(eventTotals.landing_rows);
  const attributedLandingRows = numeric(eventTotals.attributed_landing_rows);
  const attributedLeadRows = numeric(leadTotals.attributed_lead_rows);
  const attributedLandingRate =
    landingRows > 0 ? Number(((attributedLandingRows / landingRows) * 100).toFixed(2)) : null;
  const attributedLeadRate =
    leadRows > 0 ? Number(((attributedLeadRows / leadRows) * 100).toFixed(2)) : null;

  const websiteMeta = pathMetric(aggregate.meta_metrics, "website");
  const instantMeta = pathMetric(aggregate.meta_metrics, "instant_form");
  const scopedStageCount = (value: unknown): number | null =>
    metaScopeAvailable ? numeric(value) : null;

  const websiteFunnel = stages([
    {
      key: "link_click",
      label: "Meta link click",
      count: paidDataAvailable ? numeric(websiteMeta?.link_clicks) : null,
    },
    {
      key: "meta_lpv",
      label: "Meta landing-page view",
      count: paidDataAvailable ? numeric(websiteMeta?.landing_page_views) : null,
    },
    {
      key: "landing",
      label: "First-party landing session",
      count: scopedStageCount(scopedEventTotals.website_landing_sessions),
    },
    {
      key: "cta_view",
      label: "CTA viewed",
      count: scopedStageCount(scopedEventTotals.website_cta_views),
    },
    {
      key: "cta_click",
      label: "CTA clicked",
      count: scopedStageCount(scopedEventTotals.website_cta_clicks),
    },
    {
      key: "form_view",
      label: "Form viewed",
      count: scopedStageCount(scopedEventTotals.website_form_views),
    },
    {
      key: "form_start",
      label: "Form started",
      count: scopedStageCount(scopedEventTotals.website_form_starts),
    },
    {
      key: "submit",
      label: "Submit attempted",
      count: scopedStageCount(scopedEventTotals.website_submit_attempts),
    },
    {
      key: "success",
      label: "Submit succeeded",
      count: scopedStageCount(scopedEventTotals.website_submit_successes),
    },
    {
      key: "valid",
      label: "Valid lead",
      count: scopedStageCount(scopedLeadTotals.website_valid_leads),
    },
    {
      key: "verified",
      label: "Verified lead",
      count: scopedStageCount(scopedLeadTotals.website_verified_leads),
    },
  ]);
  const instantFunnel = stages([
    {
      key: "open",
      label: "Instant Form opened",
      count: paidDataAvailable ? numeric(instantMeta?.instant_form_opens) : null,
    },
    {
      key: "start",
      label: "Instant Form started",
      count: paidDataAvailable ? numeric(instantMeta?.instant_form_starts) : null,
    },
    {
      key: "submit",
      label: "Instant Form submitted",
      count: paidDataAvailable ? numeric(instantMeta?.instant_form_leads) : null,
    },
    {
      key: "webhook",
      label: "Webhook received",
      count: scopedStageCount(scopedEventTotals.instant_form_webhooks),
    },
    {
      key: "crm",
      label: "CRM saved",
      count: scopedStageCount(scopedEventTotals.instant_form_crm_saves),
    },
    {
      key: "valid",
      label: "Valid lead",
      count: scopedStageCount(scopedLeadTotals.instant_form_valid_leads),
    },
    {
      key: "verified",
      label: "Verified lead",
      count: scopedStageCount(scopedLeadTotals.instant_form_verified_leads),
    },
  ]);

  const metaConfigured = metaTokenAvailable && metaScopeAvailable;
  const metaState = metaIntegrationState(
    metaConfigured,
    latestMetaSync,
    aggregate.meta_sync.exact_marker_current,
  );
  const leadStatusWebhookConfigured = Boolean(process.env.LEAD_STATUS_WEBHOOK_SECRET?.trim());
  const health: DashboardHealthItem[] = [];

  if (!metaScopeAvailable) {
    health.push({
      code: "meta_scope_unconfigured",
      severity: "critical",
      title: "Meta account and campaign scope is incomplete",
      detail:
        "Paid-media totals and CPL are fail-closed until the account, campaigns, and exactly-one conversion-location mapping define one reporting scope.",
    });
  }
  const pathCampaignMismatchSessions = numeric(scopedEventTotals.path_campaign_mismatch_sessions);
  const pathCampaignMismatchLeads = numeric(scopedLeadTotals.path_campaign_mismatch_leads);
  const pathCampaignMismatchValidLeads = numeric(
    scopedLeadTotals.path_campaign_mismatch_valid_leads,
  );
  if (pathCampaignMismatchSessions > 0 || pathCampaignMismatchLeads > 0) {
    health.push({
      code: "path_campaign_scope_mismatch",
      severity: "warning",
      title: "Some paid attribution conflicts with the conversion location",
      detail: `${pathCampaignMismatchSessions} sessions and ${pathCampaignMismatchLeads} leads use a campaign assigned to the other path; ${pathCampaignMismatchValidLeads} of those leads are valid. They are excluded from scoped funnels and CPL.`,
    });
  }
  health.push(
    leadStatusWebhookConfigured
      ? {
          code: "lead_status_webhook_configured",
          severity: "good",
          title: "Lead verification status webhook is configured",
          detail:
            "Email/phone verification outcomes can update stored lead quality. Provider freshness still requires monitoring.",
        }
      : {
          code: "lead_status_webhook_unconfigured",
          severity: "warning",
          title: "Lead verification status webhook is not configured",
          detail: "LEAD_STATUS_WEBHOOK_SECRET is missing. Verified rates may remain zero or stale.",
        },
  );

  if (metaTokenAvailable && !insightSync.configured) {
    health.push({
      code: "meta_sync_configuration_missing",
      severity: "critical",
      title: "Meta Insights sync configuration is incomplete",
      detail:
        "Set the account, campaign, website-campaign, and Instant Form campaign scope in addition to the token.",
    });
  } else if (insightSync.configured && !insightSync.ok) {
    health.push({
      code: "meta_sync_failed",
      severity: "critical",
      title: "Meta Insights sync failed",
      detail:
        "Previously committed rows were retained atomically. Check token permissions, account currency, scope, migration, and server logs.",
    });
  } else if (metaState === "unconfigured") {
    health.push({
      code: "meta_token_unconfigured",
      severity: "warning",
      title: "Meta Insights sync is not configured",
      detail:
        "Set a Meta Marketing API token. Paid-media fields remain unavailable rather than being estimated.",
    });
  } else if (metaState === "configured_no_data") {
    health.push({
      code: "meta_no_rows",
      severity: "warning",
      title: "Meta is configured, but no scoped insight rows were found",
      detail: "Verify the selected date range and atomic insight sync.",
    });
  } else if (metaState === "stale") {
    health.push({
      code: "meta_stale",
      severity: "warning",
      title: "Meta Insights data is stale",
      detail: `The newest stored sync is ${latestMetaSync ?? "unknown"}.`,
    });
  } else {
    health.push({
      code: "meta_ready",
      severity: "good",
      title: "Meta Insights data is available",
      detail: `Newest stored sync: ${latestMetaSync}.`,
    });
  }

  health.push(
    {
      code: "sql_exact_aggregate",
      severity: "good",
      title: "Exact SQL aggregation is active",
      detail:
        "Raw event and lead rows stay in Postgres. Range-level distinct sessions and all breakdown cells are calculated without client row caps.",
    },
    {
      code: "production_environment_filter",
      severity: "good",
      title: "Production events are isolated",
      detail: "Preview and development rows are excluded.",
    },
  );
  if (metaRows > 0 && !exactMetaRangeAvailable) {
    health.push({
      code: "meta_exact_range_missing",
      severity: "warning",
      title: "Exact-range Meta reach is not available",
      detail:
        "Daily/ad/country/placement reach is never summed. Run the no-breakdown exact-range sync before using reach or frequency.",
    });
  } else if (exactMetaRangeAvailable) {
    health.push({
      code: "meta_exact_range_ready",
      severity: "good",
      title: "Exact-range Meta reach and frequency are available",
      detail: `Unique reach comes from the no-breakdown account+campaign query synced at ${exactMetaRangeSyncedAt}.`,
    });
  } else {
    health.push({
      code: "reach_non_additive",
      severity: "info",
      title: "Reach is unavailable without an exact-range result",
      detail:
        "Daily, ad, country, publisher, and placement reach is never summed because it would double-count people.",
    });
  }

  const unknownConversionSpend = paidMetric(metaTotals.unknown_conversion_spend);
  if (unknownConversionSpend > 0) {
    health.push({
      code: "meta_conversion_location_unknown",
      severity: "critical",
      title: "Some Meta spend has no conversion-location mapping",
      detail: `€${unknownConversionSpend.toFixed(
        2,
      )} cannot be assigned to Website or Instant Form. Fix the campaign allowlists and resync.`,
    });
  }
  const unscopedPaidValidLeads = numeric(leadTotals.unscoped_paid_valid_leads);
  if (unscopedPaidValidLeads > 0) {
    health.push({
      code: "paid_leads_outside_meta_scope",
      severity: "warning",
      title: "Some paid-looking valid leads are outside the Meta scope",
      detail: `${unscopedPaidValidLeads} valid leads are intentionally excluded from the scoped CPL denominator.`,
    });
  }
  if (eventRows === 0) {
    health.push({
      code: "no_funnel_events",
      severity: "warning",
      title: "No funnel events in this range",
      detail: "Check deployment version, consent eligibility, and event ingestion.",
    });
  }
  if (attributedLandingRate !== null && attributedLandingRate < 80) {
    health.push({
      code: "landing_attribution_low",
      severity: "warning",
      title: "Landing attribution coverage is below 80%",
      detail: `${attributedLandingRate}% of landing-view rows contain a channel or campaign signal.`,
    });
  }
  if (attributedLeadRate !== null && attributedLeadRate < 80) {
    health.push({
      code: "lead_attribution_low",
      severity: "warning",
      title: "Lead attribution coverage is below 80%",
      detail: `${attributedLeadRate}% of lead rows contain a channel or campaign signal.`,
    });
  }

  const instantFormMetaLeads = paidMetric(metaTotals.instant_form_leads);
  const instantFormOpens = paidMetric(metaTotals.instant_form_opens);
  const instantFormStarts = paidMetric(metaTotals.instant_form_starts);
  const instantCrmSaved = numeric(scopedEventTotals.instant_form_crm_saves);
  if (
    paidDataAvailable &&
    instantFormMetaLeads > 0 &&
    (instantFormOpens === 0 || instantFormStarts === 0)
  ) {
    health.push({
      code: "instant_form_microevent_mapping_unverified",
      severity: "warning",
      title: "Instant Form open/start mapping is not yet verified",
      detail: `Meta reports ${instantFormMetaLeads} leads, but ${instantFormOpens} opens and ${instantFormStarts} starts. Action types vary by account, so do not interpret zero as a real drop-off until raw_actions are validated against live delivery.`,
    });
  }
  if (paidDataAvailable && instantFormMetaLeads !== instantCrmSaved) {
    health.push({
      code: "instant_form_reconciliation_gap",
      severity: "warning",
      title: "Instant Form leads and CRM saves do not reconcile",
      detail: `Meta reports ${instantFormMetaLeads}; the event store reports ${instantCrmSaved} CRM saves.`,
    });
  }

  const capiEligible = numeric(leadTotals.capi_eligible_leads);
  const capiSent = numeric(leadTotals.capi_sent_leads);
  const capiFailed = numeric(leadTotals.capi_failed_leads);
  const capiSkipped = numeric(leadTotals.capi_skipped_leads);
  const metaEventsReceived = numeric(leadTotals.meta_events_received);
  if (capiFailed > 0 || capiSkipped > 0) {
    health.push({
      code: "capi_delivery_gap",
      severity: "warning",
      title: "Some CAPI-eligible leads were not accepted",
      detail: `${capiSent}/${capiEligible} eligible leads are sent; ${capiFailed} failed and ${capiSkipped} were skipped.`,
    });
  } else if (capiEligible > 0 && capiSent === capiEligible) {
    health.push({
      code: "capi_delivery_recorded",
      severity: "good",
      title: "CAPI-eligible lead delivery is recorded",
      detail: `${capiSent}/${capiEligible} eligible leads are sent, with ${metaEventsReceived} Meta events accepted.`,
    });
  } else {
    health.push({
      code: "capi_no_eligible_leads",
      severity: "info",
      title: "No CAPI-eligible leads in this range",
      detail: "No server-side delivery ratio is calculated.",
    });
  }

  const submitAttempts = numeric(scopedEventTotals.website_submit_attempts);
  const submitSuccesses = numeric(scopedEventTotals.website_submit_successes);
  const metaBrowserLeadDispatches = numeric(scopedEventTotals.website_browser_lead_dispatches);
  const metaBrowserContactDispatches = numeric(
    scopedEventTotals.website_browser_contact_dispatches,
  );
  if (submitAttempts > submitSuccesses) {
    health.push({
      code: "website_submit_gap",
      severity: "warning",
      title: "Some website submits did not succeed",
      detail: `${submitAttempts} submit sessions produced ${submitSuccesses} success sessions.`,
    });
  }
  health.push({
    code: "browser_lead_dispatch_coverage",
    severity: metaBrowserLeadDispatches > 0 ? "good" : "info",
    title: "Browser Lead dispatch is tracked separately",
    detail: `${metaBrowserLeadDispatches} consent-eligible browser Lead events were enqueued. This confirms fbq dispatch only; Events Manager remains the source for receipt and browser/server deduplication.`,
  });
  health.push({
    code: "browser_contact_dispatch_coverage",
    severity: metaBrowserContactDispatches > 0 ? "good" : "info",
    title: "Browser Contact dispatch is tracked separately",
    detail: `${metaBrowserContactDispatches} consent-eligible browser Contact events were enqueued for phone submissions. Meta Contact reporting is a reference signal; verified phone records remain the CPL denominator.`,
  });
  if (aggregate.schema_versions.length > 1) {
    health.push({
      code: "mixed_schema_versions",
      severity: "info",
      title: "Multiple measurement schema versions are present",
      detail: aggregate.schema_versions.join(", "),
    });
  }
  if (health.every((item) => item.severity !== "critical" && item.severity !== "warning")) {
    health.push({
      code: "funnel_checks_clear",
      severity: "good",
      title: "Core funnel checks are clear",
      detail: "No reconciliation, coverage, freshness, or ingestion warning was detected.",
    });
  }

  const payload: DashboardPayload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    range: { from, to, timezone: "Asia/Seoul" },
    integrations: {
      storage: "ready",
      meta: metaState,
      metaTokenConfigured: metaTokenAvailable,
      metaScopeConfigured: metaScopeAvailable,
      leadStatusWebhookConfigured,
      metaLastSyncedAt: latestMetaSync,
    },
    coverage: {
      eventRowsRead: eventRows,
      leadRowsRead: leadRows,
      metaRowsRead: paidDataAvailable ? metaRows : 0,
      eventRowsTruncated: false,
      leadRowsTruncated: false,
      metaRowsTruncated: false,
      latestEventAt,
      latestLeadAt,
      attributedLandingRate,
      attributedLeadRate,
      exactMetaRangeAvailable,
      exactMetaRangeSyncedAt,
      schemaVersions: aggregate.schema_versions,
    },
    totals: {
      spendEur: Number(totalSpend.toFixed(4)),
      impressions: totalImpressions,
      reach: exactReach,
      frequency: exactFrequency,
      cpmEur:
        totalImpressions > 0 ? Number(((totalSpend / totalImpressions) * 1_000).toFixed(4)) : null,
      linkCtr:
        totalImpressions > 0
          ? Number(((totalLinkClicks / totalImpressions) * 100).toFixed(4))
          : null,
      linkCpcEur: totalLinkClicks > 0 ? Number((totalSpend / totalLinkClicks).toFixed(4)) : null,
      linkClicks: totalLinkClicks,
      landingPageViews: paidMetric(metaTotals.landing_page_views),
      websiteMetaLeads: paidMetric(metaTotals.website_leads),
      websiteMetaContacts: paidMetric(metaTotals.website_contacts),
      instantFormMetaLeads,
      validLeads: numeric(leadTotals.valid_leads),
      verifiedLeads: numeric(leadTotals.verified_leads),
      duplicateLeads: numeric(leadTotals.duplicate_leads),
      suspectLeads: numeric(leadTotals.suspect_leads),
      invalidLeads: numeric(leadTotals.invalid_leads),
      paidAttributedValidLeads,
      paidAttributedVerifiedPhoneLeads,
      ctaViews: numeric(scopedEventTotals.website_cta_views),
      ctaClicks: numeric(scopedEventTotals.website_cta_clicks),
      videoPlays: numeric(scopedEventTotals.website_video_plays),
      video25: numeric(scopedEventTotals.website_video_25),
      video50: numeric(scopedEventTotals.website_video_50),
      video75: numeric(scopedEventTotals.website_video_75),
      videoCompletions: numeric(scopedEventTotals.website_video_completions),
      submitSuccesses,
      submitErrors: numeric(scopedEventTotals.website_submit_errors),
      metaBrowserLeadDispatches,
      metaBrowserContactDispatches,
      totalLeads: numeric(leadTotals.lead_rows),
      leadsWithEmail: numeric(leadTotals.leads_with_email),
      leadsWithPhone: numeric(leadTotals.leads_with_phone),
      emailVerifiedLeads: numeric(leadTotals.email_verified_leads),
      phoneVerifiedLeads: numeric(leadTotals.phone_verified_leads),
      measurementConsentedLeads: numeric(leadTotals.measurement_consented_leads),
      capiEligibleLeads: capiEligible,
      capiSentLeads: capiSent,
      capiFailedLeads: capiFailed,
      capiSkippedLeads: capiSkipped,
      metaEventsReceived,
      metaVideo3s: paidMetric(metaTotals.video_3s),
      metaVideoThruplay: paidMetric(metaTotals.video_thruplay),
      metaVideo25: paidMetric(metaTotals.video_25),
      metaVideo50: paidMetric(metaTotals.video_50),
      metaVideo75: paidMetric(metaTotals.video_75),
      metaVideo95: paidMetric(metaTotals.video_95),
      metaVideo100: paidMetric(metaTotals.video_100),
      validLeadCpl:
        paidDataAvailable && paidAttributedValidLeads > 0
          ? Number((totalSpend / paidAttributedValidLeads).toFixed(4))
          : null,
      phoneLeadCpl:
        paidDataAvailable && paidAttributedVerifiedPhoneLeads > 0
          ? Number((totalSpend / paidAttributedVerifiedPhoneLeads).toFixed(4))
          : null,
    },
    funnels: { website: websiteFunnel, instantForm: instantFunnel },
    breakdowns: mergeAggregateBreakdowns(
      aggregate.event_metrics,
      aggregate.lead_metrics,
      paidDataAvailable ? aggregate.meta_metrics : [],
      paidDataAvailable,
    ),
    health,
  };
  return payload;
}

export const loadFunnelDashboard = createServerFn({ method: "POST" })
  .validator(dashboardRequestSchema)
  .handler(async ({ data }): Promise<DashboardResponse> => {
    const expectedToken = process.env.FUNNEL_DASHBOARD_TOKEN?.trim();
    if (!expectedToken) return { ok: false, reason: "dashboard_token_unconfigured" };
    if (!tokenMatches(data.token)) return { ok: false, reason: "unauthorized" };
    return buildDashboard(data.from, data.to);
  });
