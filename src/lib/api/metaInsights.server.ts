const DEFAULT_GRAPH_VERSION = "v21.0";
const GRAPH_TIMEOUT_MS = 20_000;
const SUPABASE_RPC_TIMEOUT_MS = 10_000;
const MAX_GRAPH_PAGES = 50;
const PAGE_LIMIT = 500;
const MAX_SYNC_DAYS = 90;
const MAX_SLICE_ROWS = 10_000;
const MAX_RANGE_ROWS = 250_000;
const META_INSIGHTS_RESERVE_RPC = "reserve_meta_insights_sync_v2";
const META_INSIGHTS_FAIL_RPC = "fail_meta_insights_sync";
const META_INSIGHTS_RANGE_REPLACE_RPC = "replace_meta_insights_range";

class MetaSyncGenerationConflictError extends Error {
  constructor() {
    super("Meta Insights generation changed before commit");
    this.name = "MetaSyncGenerationConflictError";
  }
}

export type MetaConversionLocation = "website" | "instant_form" | "unknown";

type ActionValue = {
  action_type?: string;
  value?: string | number;
};

type GraphInsight = {
  account_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
  date_stop?: string;
  country?: string;
  publisher_platform?: string;
  platform_position?: string;
  impressions?: string | number;
  reach?: string | number;
  frequency?: string | number;
  spend?: string | number;
  inline_link_clicks?: string | number;
  actions?: ActionValue[];
  video_thruplay_watched_actions?: ActionValue[];
  video_p25_watched_actions?: ActionValue[];
  video_p50_watched_actions?: ActionValue[];
  video_p75_watched_actions?: ActionValue[];
  video_p95_watched_actions?: ActionValue[];
  video_p100_watched_actions?: ActionValue[];
};

type GraphPage = {
  data?: GraphInsight[];
  paging?: { next?: string };
};

export type MetaExactRangeInsight = {
  accountId: string;
  campaignIds: string[];
  from: string;
  to: string;
  impressions: number;
  reach: number;
  frequency: number;
  spendEur: number;
  linkClicks: number;
  cpm: number | null;
  linkCtr: number | null;
  linkCpc: number | null;
  generation: number;
  syncedAt: string;
};

export type SyncResult = {
  configured: boolean;
  ok: boolean;
  rows: number;
  exactRange?: MetaExactRangeInsight;
  reason?: string;
  source?: "refresh" | "cache";
  generation?: number;
};

const inFlightSyncs = new Map<string, Promise<SyncResult>>();

function cleanId(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/^act_/, "");
  return cleaned && /^\d{5,30}$/.test(cleaned) ? cleaned : undefined;
}

function configuredCampaignIds(): string[] {
  return [
    ...new Set(
      (process.env.META_CAMPAIGN_IDS ?? "")
        .split(",")
        .map((value) => cleanId(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function configuredIdSet(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((value) => cleanId(value))
      .filter((value): value is string => Boolean(value)),
  );
}

function configuredCampaignLocations(campaignIds: string[]): {
  locations: Map<string, MetaConversionLocation>;
  complete: boolean;
} {
  const websiteIds = configuredIdSet("META_WEBSITE_CAMPAIGN_IDS");
  const instantFormIds = configuredIdSet("META_INSTANT_FORM_CAMPAIGN_IDS");
  const locations = new Map<string, MetaConversionLocation>();
  let complete = campaignIds.length > 0;

  for (const campaignId of campaignIds) {
    const website = websiteIds.has(campaignId);
    const instantForm = instantFormIds.has(campaignId);
    const location: MetaConversionLocation =
      website === instantForm ? "unknown" : website ? "website" : "instant_form";
    locations.set(campaignId, location);
    if (location === "unknown") complete = false;
  }

  return { locations, complete };
}

export function validatedMetaGraphVersion(configured?: string): string {
  const version = configured?.trim() || DEFAULT_GRAPH_VERSION;
  if (!/^v(?:[1-9]\d?)\.\d+$/.test(version)) {
    throw new Error("META_GRAPH_API_VERSION must look like v21.0");
  }
  return version;
}

function accessToken(): string | undefined {
  return (
    process.env.META_MARKETING_ACCESS_TOKEN?.trim() ||
    process.env.META_ADS_ACCESS_TOKEN?.trim() ||
    process.env.META_GRAPH_ACCESS_TOKEN?.trim() ||
    undefined
  );
}

function numeric(value: string | number | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function bounded(value: string | undefined, max = 300): string {
  return Array.from(value ?? "")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, max);
}

function preferredAction(actions: ActionValue[] | undefined, names: string[]): number {
  if (!Array.isArray(actions)) return 0;
  for (const name of names) {
    const matching = actions
      .filter((action) => action.action_type === name)
      .reduce((sum, action) => sum + numeric(action.value), 0);
    if (matching > 0) return matching;
  }
  return 0;
}

function summedActionField(actions: ActionValue[] | undefined): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, action) => sum + numeric(action.value), 0);
}

export function normalizedInsight(
  row: GraphInsight,
  syncedAt: string,
  conversionLocation: MetaConversionLocation,
  syncGeneration: number,
): Record<string, unknown> | null {
  const accountId = cleanId(row.account_id);
  const campaignId = cleanId(row.campaign_id);
  const adSetId = cleanId(row.adset_id);
  const adId = cleanId(row.ad_id);
  const insightDate = row.date_start;
  if (
    !accountId ||
    !campaignId ||
    !adSetId ||
    !adId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(insightDate ?? "")
  ) {
    return null;
  }

  const actions = Array.isArray(row.actions) ? row.actions : [];
  return {
    insight_date: insightDate,
    account_id: accountId,
    campaign_id: campaignId,
    campaign_name: bounded(row.campaign_name) || null,
    adset_id: adSetId,
    adset_name: bounded(row.adset_name) || null,
    ad_id: adId,
    ad_name: bounded(row.ad_name) || null,
    country: bounded(row.country, 8).toUpperCase(),
    publisher_platform: bounded(row.publisher_platform, 40).toLowerCase(),
    platform_position: bounded(row.platform_position, 80).toLowerCase(),
    conversion_location: conversionLocation,
    impressions: Math.round(numeric(row.impressions)),
    reach: Math.round(numeric(row.reach)),
    spend_eur: numeric(row.spend),
    link_clicks: Math.round(numeric(row.inline_link_clicks)),
    landing_page_views: Math.round(
      preferredAction(actions, ["landing_page_view", "offsite_conversion.landing_page_view"]),
    ),
    website_leads: Math.round(
      preferredAction(actions, ["offsite_conversion.fb_pixel_lead", "offsite_conversion.lead"]),
    ),
    website_contacts: Math.round(
      preferredAction(actions, [
        "offsite_conversion.fb_pixel_contact",
        "offsite_conversion.contact",
      ]),
    ),
    instant_form_leads: Math.round(
      preferredAction(actions, [
        "onsite_conversion.lead_grouped",
        "leadgen_grouped",
        "leadgen.other",
      ]),
    ),
    instant_form_opens: Math.round(
      preferredAction(actions, [
        "onsite_conversion.lead_form_view",
        "leadgen_view",
        "leadgen.view",
      ]),
    ),
    instant_form_starts: Math.round(
      preferredAction(actions, [
        "onsite_conversion.lead_form_start",
        "leadgen_start",
        "leadgen.start",
      ]),
    ),
    video_3s: Math.round(preferredAction(actions, ["video_view"])),
    video_thruplay: Math.round(summedActionField(row.video_thruplay_watched_actions)),
    video_25: Math.round(summedActionField(row.video_p25_watched_actions)),
    video_50: Math.round(summedActionField(row.video_p50_watched_actions)),
    video_75: Math.round(summedActionField(row.video_p75_watched_actions)),
    video_95: Math.round(summedActionField(row.video_p95_watched_actions)),
    video_100: Math.round(summedActionField(row.video_p100_watched_actions)),
    raw_actions: actions
      .filter(
        (action): action is Required<ActionValue> =>
          typeof action.action_type === "string" &&
          (typeof action.value === "string" || typeof action.value === "number"),
      )
      .slice(0, 100)
      .map((action) => ({
        action_type: bounded(action.action_type, 120),
        value: numeric(action.value),
      })),
    sync_generation: syncGeneration,
    synced_at: syncedAt,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphFetch(url: URL, token: string): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
    lastStatus = response.status;
    if (response.ok) return response;
    if (response.status !== 429 && response.status < 500) break;
    if (attempt < 3) await sleep(1_000 * 2 ** attempt);
  }
  throw new Error(`Meta Insights request failed (${lastStatus || "network"})`);
}

async function assertEuroAccount(
  accountId: string,
  token: string,
  graphVersion: string,
): Promise<void> {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}`);
  url.searchParams.set("fields", "currency,timezone_name");
  const response = await graphFetch(url, token);
  const account = (await response.json()) as { currency?: string };
  if (account.currency !== "EUR") {
    throw new Error(`Meta ad account currency is ${account.currency ?? "unknown"}, expected EUR`);
  }
}

async function fetchInsights(
  accountId: string,
  campaignIds: string[],
  token: string,
  from: string,
  to: string,
  graphVersion: string,
): Promise<GraphInsight[]> {
  const first = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  first.searchParams.set(
    "fields",
    [
      "account_id",
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name",
      "ad_id",
      "ad_name",
      "date_start",
      "impressions",
      "reach",
      "spend",
      "inline_link_clicks",
      "actions",
      "video_thruplay_watched_actions",
      "video_p25_watched_actions",
      "video_p50_watched_actions",
      "video_p75_watched_actions",
      "video_p95_watched_actions",
      "video_p100_watched_actions",
    ].join(","),
  );
  first.searchParams.set("level", "ad");
  first.searchParams.set("time_increment", "1");
  first.searchParams.set("time_range", JSON.stringify({ since: from, until: to }));
  first.searchParams.set(
    "filtering",
    JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]),
  );
  first.searchParams.set("breakdowns", "country,publisher_platform,platform_position");
  first.searchParams.set("action_breakdowns", "action_type");
  first.searchParams.set("limit", String(PAGE_LIMIT));

  const rows: GraphInsight[] = [];
  let next: URL | undefined = first;
  for (let page = 0; next && page < MAX_GRAPH_PAGES; page += 1) {
    const response = await graphFetch(next, token);
    const payload = (await response.json()) as GraphPage;
    if (!Array.isArray(payload.data)) throw new Error("Meta Insights returned invalid data");
    rows.push(...payload.data);
    const nextUrl = payload.paging?.next;
    if (nextUrl) {
      const parsedNext = new URL(nextUrl);
      if (parsedNext.protocol !== "https:" || parsedNext.hostname !== "graph.facebook.com") {
        throw new Error("Meta Insights returned an unsafe paging URL");
      }
      parsedNext.searchParams.delete("access_token");
      parsedNext.searchParams.delete("appsecret_proof");
      next = parsedNext;
    } else {
      next = undefined;
    }
    if (next) await sleep(1_000);
  }
  if (next) throw new Error("Meta Insights pagination exceeded the safety limit");
  return rows;
}

function exactMetric(value: string | number | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Meta exact-range ${name} is invalid`);
  }
  return parsed;
}

function derivedRate(numerator: number, denominator: number, multiplier = 1): number | null {
  return denominator > 0 ? (numerator / denominator) * multiplier : null;
}

async function fetchExactRangeInsight(
  accountId: string,
  campaignIds: string[],
  token: string,
  from: string,
  to: string,
  graphVersion: string,
  syncedAt: string,
  generation: number,
): Promise<MetaExactRangeInsight> {
  const endpoint = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  endpoint.searchParams.set(
    "fields",
    [
      "account_id",
      "date_start",
      "date_stop",
      "impressions",
      "reach",
      "frequency",
      "spend",
      "inline_link_clicks",
    ].join(","),
  );
  endpoint.searchParams.set("level", "account");
  endpoint.searchParams.set("time_range", JSON.stringify({ since: from, until: to }));
  endpoint.searchParams.set(
    "filtering",
    JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]),
  );
  endpoint.searchParams.set("limit", "2");

  const response = await graphFetch(endpoint, token);
  const payload = (await response.json()) as GraphPage;
  if (!Array.isArray(payload.data)) {
    throw new Error("Meta exact-range Insights returned invalid data");
  }
  if (payload.paging?.next || payload.data.length > 1) {
    throw new Error("Meta exact-range Insights returned multiple aggregate rows");
  }

  const canonicalCampaignIds = [...new Set(campaignIds)].sort();
  const row = payload.data[0];
  if (!row) {
    return {
      accountId,
      campaignIds: canonicalCampaignIds,
      from,
      to,
      impressions: 0,
      reach: 0,
      frequency: 0,
      spendEur: 0,
      linkClicks: 0,
      cpm: null,
      linkCtr: null,
      linkCpc: null,
      generation,
      syncedAt,
    };
  }

  if (cleanId(row.account_id) !== accountId || row.date_start !== from || row.date_stop !== to) {
    throw new Error("Meta exact-range Insights returned a row outside the requested scope");
  }

  const impressions = Math.round(exactMetric(row.impressions, "impressions"));
  const reach = Math.round(exactMetric(row.reach, "reach"));
  const frequency = exactMetric(row.frequency, "frequency");
  const spendEur = exactMetric(row.spend, "spend");
  const linkClicks = Math.round(exactMetric(row.inline_link_clicks, "inline_link_clicks"));
  return {
    accountId,
    campaignIds: canonicalCampaignIds,
    from,
    to,
    impressions,
    reach,
    frequency,
    spendEur,
    linkClicks,
    cpm: derivedRate(spendEur, impressions, 1_000),
    linkCtr: derivedRate(linkClicks, impressions, 100),
    linkCpc: derivedRate(spendEur, linkClicks),
    generation,
    syncedAt,
  };
}

type MetaInsightSlice = {
  accountId: string;
  campaignId: string;
  insightDate: string;
  rows: Array<Record<string, unknown>>;
};

export type MetaInsightRangeSnapshot = {
  accountId: string;
  campaignIds: string[];
  from: string;
  to: string;
  rows: Array<Record<string, unknown>>;
  exactRange: MetaExactRangeInsight;
  generation: number;
};

export type MetaSyncReservation = {
  generation: number;
  reservedAt: string;
  state: "reserved" | "ready" | "in_progress";
};

function supabaseConfig(): { url: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error("Supabase is not configured");
  return { url, serviceRoleKey };
}

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid insight date");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid insight date");
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}`);
  }
}

export function enumerateInsightDates(from: string, to: string): string[] {
  assertIsoDate(from);
  assertIsoDate(to);
  const first = new Date(`${from}T00:00:00.000Z`);
  const last = new Date(`${to}T00:00:00.000Z`);
  if (first > last) throw new Error("Invalid insight date range");

  const dates: string[] = [];
  for (let cursor = first.getTime(); cursor <= last.getTime(); cursor += 24 * 60 * 60 * 1000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    if (dates.length > MAX_SYNC_DAYS) throw new Error("Meta Insights date range is too large");
  }
  return dates;
}

function sliceRowKey(row: Record<string, unknown>): string {
  return [
    row.insight_date,
    row.account_id,
    row.campaign_id,
    row.adset_id,
    row.ad_id,
    row.country,
    row.publisher_platform,
    row.platform_position,
  ].join("\u001f");
}

function validateMetaInsightSlice(slice: MetaInsightSlice): void {
  const accountId = cleanId(slice.accountId);
  const campaignId = cleanId(slice.campaignId);
  assertIsoDate(slice.insightDate);
  if (!accountId || accountId !== slice.accountId) throw new Error("Invalid insight account");
  if (!campaignId || campaignId !== slice.campaignId) throw new Error("Invalid insight campaign");
  if (slice.rows.length > MAX_SLICE_ROWS) throw new Error("Meta Insights slice is too large");

  const rowKeys = new Set<string>();
  for (const row of slice.rows) {
    if (
      row.account_id !== accountId ||
      row.campaign_id !== campaignId ||
      row.insight_date !== slice.insightDate
    ) {
      throw new Error("Meta Insights row is outside its replacement slice");
    }
    const key = sliceRowKey(row);
    if (rowKeys.has(key)) throw new Error("Meta Insights slice contains duplicate rows");
    rowKeys.add(key);
  }
}

function validateMetaExactRangeInsight(insight: MetaExactRangeInsight): void {
  const accountId = cleanId(insight.accountId);
  if (!accountId || accountId !== insight.accountId) {
    throw new Error("Invalid exact-range insight account");
  }
  const campaignIds = insight.campaignIds.map((value) => cleanId(value));
  if (
    campaignIds.length === 0 ||
    campaignIds.some((value, index) => !value || value !== insight.campaignIds[index]) ||
    campaignIds.length !== new Set(campaignIds).size
  ) {
    throw new Error("Invalid exact-range insight campaign scope");
  }
  enumerateInsightDates(insight.from, insight.to);
  const nonNegativeValues = [
    insight.impressions,
    insight.reach,
    insight.frequency,
    insight.spendEur,
    insight.linkClicks,
  ];
  if (nonNegativeValues.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Invalid exact-range insight metric");
  }
  if (
    !Number.isSafeInteger(insight.impressions) ||
    !Number.isSafeInteger(insight.reach) ||
    !Number.isSafeInteger(insight.linkClicks)
  ) {
    throw new Error("Invalid exact-range insight count");
  }
  if (!Number.isFinite(Date.parse(insight.syncedAt))) {
    throw new Error("Invalid exact-range insight sync time");
  }
  assertPositiveSafeInteger(insight.generation, "exact-range insight generation");
}

function validateMetaInsightRangeSnapshot(snapshot: MetaInsightRangeSnapshot): void {
  const accountId = cleanId(snapshot.accountId);
  if (!accountId || accountId !== snapshot.accountId) {
    throw new Error("Invalid Meta insight range account");
  }
  const campaignIds = snapshot.campaignIds.map((value) => cleanId(value));
  const canonicalCampaignIds = [...snapshot.campaignIds].sort();
  if (
    campaignIds.length === 0 ||
    campaignIds.some((value, index) => !value || value !== snapshot.campaignIds[index]) ||
    campaignIds.length !== new Set(campaignIds).size
  ) {
    throw new Error("Invalid Meta insight range campaign scope");
  }
  if (snapshot.rows.length > MAX_RANGE_ROWS) {
    throw new Error("Meta Insights range is too large");
  }
  assertPositiveSafeInteger(snapshot.generation, "Meta insight range generation");

  const dates = enumerateInsightDates(snapshot.from, snapshot.to);
  const campaignSet = new Set(snapshot.campaignIds);
  const dateSet = new Set(dates);
  const slices = new Map<string, MetaInsightSlice>();
  for (const campaignId of snapshot.campaignIds) {
    for (const insightDate of dates) {
      slices.set(`${campaignId}:${insightDate}`, {
        accountId,
        campaignId,
        insightDate,
        rows: [],
      });
    }
  }
  for (const row of snapshot.rows) {
    const campaignId = typeof row.campaign_id === "string" ? row.campaign_id : "";
    const insightDate = typeof row.insight_date === "string" ? row.insight_date : "";
    if (row.account_id !== accountId || !campaignSet.has(campaignId) || !dateSet.has(insightDate)) {
      throw new Error("Meta Insights row is outside its replacement range");
    }
    if (
      row.sync_generation !== snapshot.generation ||
      row.synced_at !== snapshot.exactRange.syncedAt
    ) {
      throw new Error("Meta Insights row does not match its reserved generation");
    }
    slices.get(`${campaignId}:${insightDate}`)?.rows.push(row);
  }
  for (const slice of slices.values()) validateMetaInsightSlice(slice);

  validateMetaExactRangeInsight(snapshot.exactRange);
  if (
    snapshot.rows.length === 0 &&
    [
      snapshot.exactRange.impressions,
      snapshot.exactRange.reach,
      snapshot.exactRange.frequency,
      snapshot.exactRange.spendEur,
      snapshot.exactRange.linkClicks,
    ].some((value) => value !== 0)
  ) {
    throw new Error("Empty Meta daily range conflicts with nonzero exact-range metrics");
  }
  const canonicalExactCampaignIds = [...snapshot.exactRange.campaignIds].sort();
  if (
    snapshot.exactRange.accountId !== accountId ||
    snapshot.exactRange.from !== snapshot.from ||
    snapshot.exactRange.to !== snapshot.to ||
    snapshot.exactRange.generation !== snapshot.generation ||
    canonicalExactCampaignIds.length !== canonicalCampaignIds.length ||
    canonicalExactCampaignIds.some(
      (campaignId, index) => campaignId !== canonicalCampaignIds[index],
    )
  ) {
    throw new Error("Meta exact-range insight does not match its daily replacement scope");
  }
}

export async function reserveMetaInsightsSync(
  accountId: string,
  campaignIds: string[],
  from: string,
  to: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaSyncReservation> {
  const canonicalAccountId = cleanId(accountId);
  const canonicalCampaignIds = [...new Set(campaignIds.map((value) => cleanId(value)))].sort();
  enumerateInsightDates(from, to);
  if (!canonicalAccountId || canonicalAccountId !== accountId) {
    throw new Error("Invalid Meta insight reservation account");
  }
  if (
    canonicalCampaignIds.length === 0 ||
    canonicalCampaignIds.some((value) => !value) ||
    canonicalCampaignIds.length !== campaignIds.length
  ) {
    throw new Error("Invalid Meta insight reservation campaigns");
  }

  const config = supabaseConfig();
  const endpoint = new URL(`${config.url}/rest/v1/rpc/${META_INSIGHTS_RESERVE_RPC}`);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_account_id: accountId,
      p_campaign_ids: canonicalCampaignIds,
      p_from: from,
      p_to: to,
    }),
    signal: AbortSignal.timeout(SUPABASE_RPC_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Meta Insights generation reservation failed (${response.status})`);
  }

  const value = (await response.json()) as {
    generation?: unknown;
    reserved_at?: unknown;
    state?: unknown;
    reused?: unknown;
  };
  const generation = Number(value.generation);
  const reservedAt = typeof value.reserved_at === "string" ? value.reserved_at : "";
  const state =
    value.state === "ready" || value.state === "in_progress" || value.state === "reserved"
      ? value.state
      : value.reused === true
        ? "ready"
        : "reserved";
  assertPositiveSafeInteger(generation, "Meta insight reservation generation");
  if (!Number.isFinite(Date.parse(reservedAt))) {
    throw new Error("Invalid Meta insight reservation time");
  }
  return { generation, reservedAt, state };
}

async function failMetaInsightsSync(
  accountId: string,
  generation: number,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  assertPositiveSafeInteger(generation, "Meta insight failure generation");
  const config = supabaseConfig();
  const endpoint = new URL(`${config.url}/rest/v1/rpc/${META_INSIGHTS_FAIL_RPC}`);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_account_id: accountId,
      p_generation: generation,
    }),
    signal: AbortSignal.timeout(SUPABASE_RPC_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Meta Insights failure marker failed (${response.status})`);
  }
}

export async function replaceMetaInsightsRange(
  snapshot: MetaInsightRangeSnapshot,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  validateMetaInsightRangeSnapshot(snapshot);
  const config = supabaseConfig();
  const endpoint = new URL(`${config.url}/rest/v1/rpc/${META_INSIGHTS_RANGE_REPLACE_RPC}`);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_account_id: snapshot.accountId,
      p_campaign_ids: [...snapshot.campaignIds].sort(),
      p_from: snapshot.from,
      p_to: snapshot.to,
      p_rows: snapshot.rows,
      p_exact_impressions: snapshot.exactRange.impressions,
      p_exact_reach: snapshot.exactRange.reach,
      p_exact_frequency: snapshot.exactRange.frequency,
      p_exact_spend_eur: snapshot.exactRange.spendEur,
      p_exact_link_clicks: snapshot.exactRange.linkClicks,
      p_generation: snapshot.generation,
    }),
    signal: AbortSignal.timeout(SUPABASE_RPC_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text();
    if (
      response.status === 409 ||
      /(?:"code"\s*:\s*"40001"|current reservation|stale meta insight range|reservation changed before commit)/i.test(
        detail,
      )
    ) {
      throw new MetaSyncGenerationConflictError();
    }
    throw new Error(`Meta Insights range replacement failed (${response.status})`);
  }
}

export async function syncMetaInsights(from: string, to: string): Promise<SyncResult> {
  const token = accessToken();
  const accountId = cleanId(process.env.META_AD_ACCOUNT_ID);
  const campaignIds = configuredCampaignIds();
  const campaignLocations = configuredCampaignLocations(campaignIds);
  if (!token || !accountId || !campaignIds.length || !campaignLocations.complete) {
    return { configured: false, ok: false, rows: 0, reason: "missing_configuration" };
  }

  let graphVersion: string;
  try {
    graphVersion = validatedMetaGraphVersion(process.env.META_GRAPH_API_VERSION);
  } catch {
    return { configured: false, ok: false, rows: 0, reason: "invalid_graph_version" };
  }

  const locationKey = campaignIds
    .map((campaignId) => `${campaignId}:${campaignLocations.locations.get(campaignId)}`)
    .join(",");
  const key = `${from}:${to}:${accountId}:${graphVersion}:${locationKey}`;
  const existingSync = inFlightSyncs.get(key);
  if (existingSync) return existingSync;

  const syncOperation = (async (): Promise<SyncResult> => {
    let reservation: MetaSyncReservation | undefined;
    try {
      const dates = enumerateInsightDates(from, to);
      reservation = await reserveMetaInsightsSync(accountId, campaignIds, from, to);
      if (reservation.state === "ready") {
        return {
          configured: true,
          ok: true,
          rows: 0,
          source: "cache",
          generation: reservation.generation,
        };
      }
      if (reservation.state === "in_progress") {
        return {
          configured: true,
          ok: false,
          rows: 0,
          reason: "sync_in_progress",
          generation: reservation.generation,
        };
      }
      await assertEuroAccount(accountId, token, graphVersion);
      const rawRows = await fetchInsights(accountId, campaignIds, token, from, to, graphVersion);
      const exactRange = await fetchExactRangeInsight(
        accountId,
        campaignIds,
        token,
        from,
        to,
        graphVersion,
        reservation.reservedAt,
        reservation.generation,
      );
      const dateSet = new Set(dates);
      const campaignSet = new Set(campaignIds);
      const normalizedRows: Array<Record<string, unknown>> = [];
      for (const row of rawRows) {
        const rowCampaignId = cleanId(row.campaign_id);
        const rowAccountId = cleanId(row.account_id);
        const rowDate = row.date_start;
        if (
          !rowCampaignId ||
          !campaignSet.has(rowCampaignId) ||
          rowAccountId !== accountId ||
          !rowDate ||
          !dateSet.has(rowDate)
        ) {
          throw new Error("Meta Insights returned a row outside the requested scope");
        }
        const normalized = normalizedInsight(
          row,
          reservation.reservedAt,
          campaignLocations.locations.get(rowCampaignId) ?? "unknown",
          reservation.generation,
        );
        if (!normalized) throw new Error("Meta Insights returned an invalid row");
        normalizedRows.push(normalized);
      }

      // One Postgres function validates and replaces every requested
      // account+campaign+date slice, then upserts the exact-range
      // reach/frequency row in the same transaction.
      await replaceMetaInsightsRange({
        accountId,
        campaignIds,
        from,
        to,
        rows: normalizedRows,
        exactRange,
        generation: reservation.generation,
      });

      return {
        configured: true,
        ok: true,
        rows: normalizedRows.length,
        exactRange,
        source: "refresh",
        generation: reservation.generation,
      };
    } catch (error) {
      const generationConflict = error instanceof MetaSyncGenerationConflictError;
      if (reservation && !generationConflict) {
        try {
          await failMetaInsightsSync(accountId, reservation.generation);
        } catch (failureMarkerError) {
          console.error(
            "[meta-insights] failure marker failed",
            failureMarkerError instanceof Error
              ? failureMarkerError.message.slice(0, 200)
              : "UnknownError",
          );
        }
      }
      console.error(
        "[meta-insights] sync failed",
        error instanceof Error ? error.message.slice(0, 200) : "UnknownError",
      );
      return {
        configured: true,
        ok: false,
        rows: 0,
        reason: generationConflict ? "generation_conflict" : "sync_failed",
      };
    }
  })();

  inFlightSyncs.set(key, syncOperation);
  try {
    return await syncOperation;
  } finally {
    if (inFlightSyncs.get(key) === syncOperation) {
      inFlightSyncs.delete(key);
    }
  }
}
