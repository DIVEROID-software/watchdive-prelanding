import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildDashboard,
  creativeJoinKey,
  hasCompleteConversionLocationScope,
  isCampaignInScope,
  isCurrentMetaAggregate,
  mergeAggregateBreakdowns,
  resolveMetaScope,
} from "../src/lib/api/dashboard.functions.ts";
import {
  normalizedInsight,
  validatedMetaGraphVersion,
} from "../src/lib/api/metaInsights.server.ts";

test("missing aggregate storage fails closed instead of returning an empty dashboard", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    assert.deepEqual(await buildDashboard("2026-07-29", "2026-07-29"), {
      ok: false,
      reason: "aggregate_unavailable",
    });
  } finally {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});

test("Meta scope requires one valid account and at least one campaign", () => {
  assert.equal(resolveMetaScope(undefined, "120251217895480717"), null);
  assert.equal(resolveMetaScope("not-an-account", "120251217895480717"), null);
  assert.equal(resolveMetaScope("727396218766985", ""), null);

  const scope = resolveMetaScope(
    "act_727396218766985",
    "120251217895480717,120251250561470717,120251217895480717",
  );
  assert.ok(scope);
  assert.equal(scope.accountId, "727396218766985");
  assert.deepEqual(scope.campaignIds, ["120251217895480717", "120251250561470717"]);
  assert.equal(
    hasCompleteConversionLocationScope(scope, "120251217895480717", "120251250561470717"),
    true,
  );
  assert.equal(
    hasCompleteConversionLocationScope(
      scope,
      "120251217895480717,120251250561470717",
      "120251250561470717",
    ),
    false,
  );
});

test("CPL denominator accepts only campaign IDs in the exact Meta scope", () => {
  const scope = new Set(["120251217895480717"]);
  assert.equal(isCampaignInScope("120251217895480717", scope), true);
  assert.equal(isCampaignInScope("120251250561470717", scope), false);
  assert.equal(isCampaignInScope("paid_social", scope), false);
});

test("creative joins prefer stable Meta ad ID over UTM content", () => {
  assert.equal(creativeJoinKey("120251300000000001", "edited-hero-v3"), "120251300000000001");
  assert.equal(creativeJoinKey(null, "edited-hero-v3"), "edited-hero-v3");
  assert.equal(creativeJoinKey(null, null), "unknown");
});

test("Meta insight normalization persists conversion location even with zero leads", () => {
  const normalized = normalizedInsight(
    {
      account_id: "727396218766985",
      campaign_id: "120251250561470717",
      campaign_name: "Instant Form parity",
      adset_id: "120251250561470718",
      ad_id: "120251250561470719",
      date_start: "2026-07-29",
      country: "us",
      publisher_platform: "instagram",
      platform_position: "story",
      impressions: "1000",
      spend: "9.50",
      actions: [],
    },
    "2026-07-29T08:00:00.000Z",
    "instant_form",
    12,
  );

  assert.ok(normalized);
  assert.equal(normalized.conversion_location, "instant_form");
  assert.equal(normalized.spend_eur, 9.5);
  assert.equal(normalized.instant_form_leads, 0);
  assert.equal(normalized.sync_generation, 12);
});

test("Meta Graph API version is configurable but rejects unsafe values", () => {
  assert.equal(validatedMetaGraphVersion(undefined), "v21.0");
  assert.equal(validatedMetaGraphVersion(" v22.0 "), "v22.0");
  assert.throws(() => validatedMetaGraphVersion("21.0"));
  assert.throws(() => validatedMetaGraphVersion("v21.0/act_1"));
});

test("dashboard joins SQL aggregate cells without re-summing distinct-session stages", () => {
  const breakdowns = mergeAggregateBreakdowns(
    [
      {
        dimension: "campaign",
        key: "120251217895480717",
        label: "Website campaign",
        landing_sessions: "300000",
        form_views: 120000,
        form_starts: 90000,
        cta_views: 250000,
        cta_clicks: 130000,
        video_plays: 0,
        video_25: 0,
        video_50: 0,
        video_75: 0,
        video_completions: 0,
        submit_attempts: 70000,
        submit_successes: 60000,
        submit_errors: 10000,
        meta_browser_lead_dispatches: 45000,
        meta_browser_contact_dispatches: 5000,
      },
    ],
    [
      {
        dimension: "campaign",
        key: "120251217895480717",
        label: "Website campaign",
        total_leads: "60000",
        new_leads: 59000,
        duplicate_leads: 800,
        suspect_leads: 100,
        invalid_leads: 100,
        valid_leads: 58000,
        paid_valid_leads: 50000,
        paid_verified_phone_leads: 10000,
        verified_leads: 30000,
      },
    ],
    [
      {
        dimension: "campaign",
        key: "120251217895480717",
        label: "Website campaign",
        spend_eur: "10000",
        impressions: "1200000",
        link_clicks: 130000,
        landing_page_views: 300000,
        website_leads: 60000,
        website_contacts: 12000,
        instant_form_opens: 0,
        instant_form_starts: 0,
        instant_form_leads: 0,
        video_3s: 400000,
        video_thruplay: 100000,
        video_25: 300000,
        video_50: 200000,
        video_75: 150000,
        video_95: 110000,
        video_100: 90000,
      },
    ],
    true,
  );

  assert.equal(breakdowns.campaign.length, 1);
  assert.equal(breakdowns.campaign[0]?.landingSessions, 300000);
  assert.equal(breakdowns.campaign[0]?.totalLeads, 60000);
  assert.equal(breakdowns.campaign[0]?.paidAttributedValidLeads, 50000);
  assert.equal(breakdowns.campaign[0]?.spendEur, 10000);
  assert.equal(breakdowns.campaign[0]?.metaBrowserLeadDispatches, 45000);
  assert.equal(breakdowns.campaign[0]?.metaBrowserContactDispatches, 5000);
  assert.equal(breakdowns.campaign[0]?.paidAttributedVerifiedPhoneLeads, 10000);
  assert.equal(breakdowns.campaign[0]?.websiteMetaContacts, 12000);
  assert.equal(breakdowns.campaign[0]?.metaVideo3s, 400000);
  assert.equal(breakdowns.campaign[0]?.metaVideo100, 90000);
  assert.equal(breakdowns.campaign[0]?.validLeadCpl, 0.2);
  assert.equal(breakdowns.campaign[0]?.phoneLeadCpl, 1);
});

test("breakdown CPL is fail-closed for unsupported grains and cells without Meta delivery", () => {
  const breakdowns = mergeAggregateBreakdowns(
    [
      {
        dimension: "page",
        key: "unknown",
        label: "Unknown page",
        landing_sessions: 10,
      },
    ],
    [
      {
        dimension: "page",
        key: "unknown",
        label: "Unknown page",
        paid_valid_leads: 5,
        paid_verified_phone_leads: 2,
      },
      {
        dimension: "campaign",
        key: "120251217895480717",
        label: "Website campaign",
        paid_valid_leads: 5,
        paid_verified_phone_leads: 2,
      },
    ],
    [
      {
        dimension: "page",
        key: "unknown",
        label: "Unknown page",
        spend_eur: 10,
        impressions: 100,
      },
    ],
    true,
  );

  assert.equal(breakdowns.page[0]?.validLeadCpl, null);
  assert.equal(breakdowns.page[0]?.phoneLeadCpl, null);
  assert.equal(breakdowns.campaign[0]?.spendEur, 0);
  assert.equal(breakdowns.campaign[0]?.validLeadCpl, null);
  assert.equal(breakdowns.campaign[0]?.phoneLeadCpl, null);
});

test("placement keeps Website and Instant Form spend in separate path-prefixed cells", () => {
  const breakdowns = mergeAggregateBreakdowns(
    [
      {
        dimension: "placement",
        key: "website|instagram/reels",
        label: "Website · Instagram / Reels",
        landing_sessions: 50,
      },
    ],
    [
      {
        dimension: "placement",
        key: "website|instagram/reels",
        label: "Website · Instagram / Reels",
        paid_valid_leads: 5,
        paid_verified_phone_leads: 2,
      },
    ],
    [
      {
        dimension: "placement",
        key: "website|instagram/reels",
        label: "Website · Instagram / Reels",
        spend_eur: 10,
        impressions: 1_000,
      },
      {
        dimension: "placement",
        key: "instant_form|instagram/reels",
        label: "Instant Form · Instagram / Reels",
        spend_eur: 4,
        impressions: 500,
        instant_form_leads: 3,
      },
    ],
    true,
  );

  const website = breakdowns.placement.find((row) => row.key === "website|instagram/reels");
  const instantForm = breakdowns.placement.find(
    (row) => row.key === "instant_form|instagram/reels",
  );
  assert.equal(website?.validLeadCpl, 2);
  assert.equal(website?.phoneLeadCpl, 5);
  assert.equal(instantForm?.spendEur, 4);
  assert.equal(instantForm?.instantFormMetaLeads, 3);
  assert.equal(instantForm?.paidAttributedValidLeads, 0);
  assert.equal(instantForm?.validLeadCpl, null);
  assert.equal(instantForm?.phoneLeadCpl, null);
});

test("current Meta aggregate accepts an authoritative empty generation only when ready and exact", () => {
  const ready = {
    expected_generation: 21,
    current_generation: 21,
    status: "ready" as const,
    ready_for_expected_scope: true,
    exact_marker_current: true,
  };
  assert.equal(isCurrentMetaAggregate(ready, 21), true);
  assert.equal(isCurrentMetaAggregate({ ...ready, status: "syncing" }, 21), false);
  assert.equal(isCurrentMetaAggregate({ ...ready, status: "failed" }, 21), false);
  assert.equal(isCurrentMetaAggregate({ ...ready, current_generation: 22 }, 21), false);
  assert.equal(isCurrentMetaAggregate({ ...ready, exact_marker_current: false }, 21), false);
  assert.equal(isCurrentMetaAggregate(ready, undefined), false);
});

test("dashboard migration provides an exact service-role-only aggregate RPC", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260729090000_funnel_measurement.sql", import.meta.url),
    "utf8",
  ).toLowerCase();
  const dashboardSource = readFileSync(
    new URL("../src/lib/api/dashboard.functions.ts", import.meta.url),
    "utf8",
  );

  assert.match(migration, /get_funnel_dashboard_aggregate_v1/);
  assert.match(migration, /count\(distinct session_id\)/);
  assert.match(migration, /grouping sets/);
  assert.match(migration, /scoped_event_totals as/);
  assert.match(migration, /scoped_lead_totals as/);
  assert.match(migration, /website_video_completions/);
  assert.match(migration, /p_website_campaign_ids text\[\]/);
  assert.match(migration, /p_instant_form_campaign_ids text\[\]/);
  assert.match(
    migration,
    /e\.acquisition_path = 'website'[\s\S]*e\.paid_campaign_id = any\(coalesce\(p_website_campaign_ids/,
  );
  assert.match(
    migration,
    /e\.acquisition_path = 'instant_form'[\s\S]*e\.paid_campaign_id = any\(coalesce\(p_instant_form_campaign_ids/,
  );
  assert.match(
    migration,
    /l\.acquisition_path = 'website'[\s\S]*l\.paid_campaign_id = any\(coalesce\(p_website_campaign_ids/,
  );
  assert.match(
    migration,
    /l\.acquisition_path = 'instant_form'[\s\S]*l\.paid_campaign_id = any\(coalesce\(p_instant_form_campaign_ids/,
  );
  assert.match(migration, /path_campaign_mismatch_sessions/);
  assert.match(migration, /path_campaign_mismatch_leads/);
  assert.match(migration, /count\(\*\) filter \(where valid and verified\) as verified_leads/);
  assert.match(migration, /meta_browser_lead_dispatched/);
  assert.match(migration, /meta_browser_lead_dispatches/);
  assert.match(migration, /meta_browser_contact_dispatched/);
  assert.match(migration, /meta_browser_contact_dispatches/);
  assert.match(migration, /paid_verified_phone_leads/);
  assert.match(migration, /website_contacts/);
  assert.match(migration, /video_3s/);
  assert.match(migration, /video_thruplay/);
  assert.match(migration, /when grouping\(placement_key\) = 0 then 'placement'/);
  assert.match(migration, /'website\|' \|\| placement_parts\.platform_key/);
  assert.match(
    migration,
    /m\.conversion_location[\s\S]*\|\| '\|'[\s\S]*placement_parts\.platform_key/,
  );
  assert.match(migration, /revoke all on function public\.get_funnel_dashboard_aggregate_v1/);
  assert.match(migration, /grant execute on function public\.get_funnel_dashboard_aggregate_v1/);
  assert.doesNotMatch(dashboardSource, /MAX_EVENT_ROWS|MAX_LEAD_ROWS|MAX_META_ROWS/);
  assert.doesNotMatch(dashboardSource, /rest\/v1\/funnel_(?:events|leads)\?/);
  assert.match(dashboardSource, /aggregate\.scoped_event_totals/);
  assert.match(dashboardSource, /aggregate\.scoped_lead_totals/);
  assert.match(dashboardSource, /p_website_campaign_ids/);
  assert.match(dashboardSource, /p_instant_form_campaign_ids/);
  assert.match(dashboardSource, /path_campaign_scope_mismatch/);
  assert.match(dashboardSource, /scopedEventTotals\.website_video_completions/);
  assert.match(dashboardSource, /scopedStageCount\(scopedEventTotals\.website_landing_sessions\)/);
  assert.match(dashboardSource, /scopedStageCount\(scopedLeadTotals\.instant_form_valid_leads\)/);
  assert.match(dashboardSource, /"placement"/);
});

test("Meta exact-range reach is isolated from non-additive daily rows", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260729090000_funnel_measurement.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

  assert.match(migration, /create table if not exists public\.meta_range_insights/);
  assert.match(migration, /create or replace function public\.replace_meta_insights_range/);
  assert.match(migration, /r\.campaign_ids @> coalesce\(p_campaign_ids/);
  assert.match(migration, /r\.campaign_ids <@ coalesce\(p_campaign_ids/);
  assert.match(migration, /\(select reach from meta_range\) as exact_reach/);
  assert.doesNotMatch(migration, /sum\(reach\).*exact_reach/);
});

test("partial Meta mutation helpers are not defined or granted", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260729090000_funnel_measurement.sql", import.meta.url),
    "utf8",
  ).toLowerCase();
  const metaSource = readFileSync(
    new URL("../src/lib/api/metaInsights.server.ts", import.meta.url),
    "utf8",
  );
  const completeRangeFunction = migration.indexOf(
    "create or replace function public.replace_meta_insights_range",
  );

  assert.ok(completeRangeFunction >= 0);
  assert.doesNotMatch(migration, /replace_meta_daily_insights_slice/);
  assert.doesNotMatch(migration, /upsert_meta_range_insight/);
  assert.doesNotMatch(metaSource, /replace_meta_daily_insights_slice/);
  assert.doesNotMatch(metaSource, /upsert_meta_range_insight/);
});

test("Meta range replacement validates then commits daily and exact rows in one service RPC", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260729090000_funnel_measurement.sql", import.meta.url),
    "utf8",
  ).toLowerCase();
  const functionStart = migration.indexOf(
    "create or replace function public.replace_meta_insights_range",
  );
  const functionEnd = migration.indexOf(
    "revoke all on function public.replace_meta_insights_range",
    functionStart,
  );
  const functionSql = migration.slice(functionStart, functionEnd);
  const validation = functionSql.indexOf("failed range scope or value validation");
  const emptyExactGuard = functionSql.indexOf(
    "empty meta daily range conflicts with nonzero exact-range metrics",
  );
  const accountLock = functionSql.indexOf("pg_advisory_xact_lock");
  const staleGuard = functionSql.indexOf(
    "stale meta insight range cannot overwrite a newer snapshot",
  );
  const deletion = functionSql.indexOf("delete from public.meta_daily_insights");
  const insertion = functionSql.indexOf("insert into public.meta_daily_insights");
  const exactUpsert = functionSql.indexOf("insert into public.meta_range_insights");
  const readyUpdate = functionSql.indexOf("status = 'ready'");

  assert.ok(functionStart >= 0);
  assert.ok(functionEnd > functionStart);
  assert.ok(validation >= 0);
  assert.ok(emptyExactGuard >= 0);
  assert.ok(accountLock > validation);
  assert.ok(accountLock > emptyExactGuard);
  assert.ok(staleGuard > accountLock);
  assert.ok(deletion > staleGuard);
  assert.ok(insertion > deletion);
  assert.ok(exactUpsert > insertion);
  assert.ok(readyUpdate > exactUpsert);
  assert.match(functionSql, /jsonb_array_length\(p_rows\) > 250000/);
  assert.match(
    functionSql,
    /jsonb_array_length\(p_rows\) = 0[\s\S]*p_exact_impressions <> 0[\s\S]*p_exact_spend_eur <> 0/,
  );
  assert.match(functionSql, /having count\(\*\) > 10000/);
  assert.match(functionSql, /s\.generation = p_generation[\s\S]*s\.status = 'syncing'/);
  assert.match(functionSql, /parsed\.sync_generation is distinct from p_generation/);
  assert.match(functionSql, /parsed\.synced_at is distinct from v_reserved_at/);
  assert.match(functionSql, /sync_generation = excluded\.sync_generation/);
  assert.match(functionSql, /campaign_id = any\(v_campaign_ids\)/);
  assert.match(functionSql, /insight_date between p_from and p_to/);
  assert.match(
    functionSql,
    /current_range\.range_from <= p_to[\s\S]*current_range\.range_to >= p_from[\s\S]*current_range\.campaign_ids && v_campaign_ids/,
  );
  assert.doesNotMatch(
    functionSql,
    /current_range\.range_from = p_from[\s\S]*current_range\.range_to = p_to/,
  );
  assert.match(
    migration,
    /revoke all on function public\.replace_meta_insights_range[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.replace_meta_insights_range[\s\S]*to service_role/,
  );
});

test("database generation state makes Meta refreshes cross-replica and fail-closed", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260729090000_funnel_measurement.sql", import.meta.url),
    "utf8",
  ).toLowerCase();
  const throttleMigration = readFileSync(
    new URL("../supabase/migrations/20260729120000_meta_insights_refresh_ttl.sql", import.meta.url),
    "utf8",
  ).toLowerCase();
  const metaSource = readFileSync(
    new URL("../src/lib/api/metaInsights.server.ts", import.meta.url),
    "utf8",
  );
  const dashboardSource = readFileSync(
    new URL("../src/lib/api/dashboard.functions.ts", import.meta.url),
    "utf8",
  );
  const dashboardRouteSource = readFileSync(
    new URL("../src/routes/ops.funnel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(migration, /create table if not exists public\.meta_insights_sync_state/);
  assert.match(
    migration,
    /status text not null[\s\S]{0,80}check \(status in \('syncing', 'ready', 'failed'\)\)/,
  );
  assert.match(migration, /alter table public\.meta_insights_sync_state enable row level security/);
  assert.match(
    migration,
    /revoke all on public\.meta_insights_sync_state from anon, authenticated/,
  );
  assert.match(
    migration,
    /grant select, insert, update on public\.meta_insights_sync_state to service_role/,
  );
  assert.match(migration, /create or replace function public\.reserve_meta_insights_sync/);
  assert.match(
    migration,
    /generation = public\.meta_insights_sync_state\.generation \+ 1[\s\S]*status = 'syncing'/,
  );
  assert.match(migration, /create or replace function public\.fail_meta_insights_sync/);
  assert.match(
    migration,
    /where account_id = p_account_id[\s\S]*generation = p_generation[\s\S]*status = 'syncing'/,
  );
  assert.match(migration, /meta_daily_insights[\s\S]*sync_generation bigint not null/);
  assert.match(migration, /meta_range_insights[\s\S]*sync_generation bigint not null/);
  assert.match(migration, /p_expected_meta_generation bigint/);
  assert.match(migration, /s\.status = 'ready'[\s\S]*s\.generation = p_expected_meta_generation/);
  assert.match(migration, /m\.sync_generation = p_expected_meta_generation/);
  assert.match(migration, /r\.sync_generation = p_expected_meta_generation/);
  assert.match(migration, /exists \(select 1 from meta_range\) as exact_marker_current/);
  assert.match(
    migration,
    /coalesce\(max\(synced_at\), \(select synced_at from meta_range\)\) as latest_meta_sync/,
  );
  assert.match(throttleMigration, /pg_advisory_xact_lock/);
  assert.match(
    throttleMigration,
    /create or replace function public\.reserve_meta_insights_sync_v2/,
  );
  assert.doesNotMatch(
    throttleMigration,
    /create or replace function public\.reserve_meta_insights_sync\(/,
  );
  assert.match(throttleMigration, /s\.status = 'ready'/);
  assert.match(throttleMigration, /s\.completed_at >= v_now - interval '10 minutes'/);
  assert.match(throttleMigration, /r\.synced_at >= v_now - interval '10 minutes'/);
  assert.match(throttleMigration, /r\.sync_generation = s\.generation/);
  assert.match(throttleMigration, /s\.range_from = p_from[\s\S]*s\.range_to = p_to/);
  assert.match(
    throttleMigration,
    /s\.campaign_ids @> v_campaign_ids[\s\S]*s\.campaign_ids <@ v_campaign_ids[\s\S]*cardinality\(s\.campaign_ids\) = cardinality\(v_campaign_ids\)/,
  );
  assert.match(throttleMigration, /'state', 'ready'/);
  assert.match(throttleMigration, /s\.status = 'syncing'/);
  assert.match(throttleMigration, /s\.reserved_at >= v_now - interval '5 minutes'/);
  assert.match(throttleMigration, /'state', 'in_progress'/);
  assert.match(throttleMigration, /'state', 'reserved'/);
  const inProgressGuard =
    throttleMigration.match(
      /-- a generation is account-wide[\s\S]*?select s\.generation, s\.reserved_at([\s\S]*?)if found then/,
    )?.[1] ?? "";
  assert.match(inProgressGuard, /s\.account_id = p_account_id/);
  assert.doesNotMatch(inProgressGuard, /s\.range_from|s\.range_to|s\.campaign_ids|v_campaign_ids/);
  assert.ok(
    throttleMigration.indexOf("pg_advisory_xact_lock") <
      throttleMigration.indexOf("s.status = 'ready'"),
  );

  const reserveCall = metaSource.indexOf("reservation = await reserveMetaInsightsSync");
  const firstGraphCall = metaSource.indexOf("await assertEuroAccount", reserveCall);
  assert.ok(reserveCall >= 0);
  assert.ok(firstGraphCall > reserveCall);
  assert.match(metaSource, /reservation\.state === "ready"/);
  assert.match(metaSource, /reserve_meta_insights_sync_v2/);
  assert.doesNotMatch(metaSource, /"reserve_meta_insights_sync"/);
  assert.match(metaSource, /source: "cache"/);
  assert.match(metaSource, /reservation\.state === "in_progress"/);
  assert.match(metaSource, /reason: "sync_in_progress"/);
  assert.match(metaSource, /const SUPABASE_RPC_TIMEOUT_MS = 10_000/);
  assert.equal(
    (metaSource.match(/signal: AbortSignal\.timeout\(SUPABASE_RPC_TIMEOUT_MS\)/g) ?? []).length,
    3,
  );
  assert.match(metaSource, /p_generation: snapshot\.generation/);
  assert.match(metaSource, /await failMetaInsightsSync\(accountId, reservation\.generation\)/);

  assert.match(dashboardSource, /p_expected_meta_generation/);
  assert.match(dashboardSource, /const DASHBOARD_RPC_TIMEOUT_MS = 10_000/);
  assert.match(dashboardSource, /signal: AbortSignal\.timeout\(DASHBOARD_RPC_TIMEOUT_MS\)/);
  assert.match(dashboardSource, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(
    dashboardSource,
    /insightSync\.reason === "generation_conflict"[\s\S]*insightSync\.reason === "sync_in_progress"[\s\S]*attempt === 0[\s\S]*await delay\(1_000\);[\s\S]*continue;/,
  );
  assert.match(dashboardSource, /await delay\(1_000\)/);
  assert.match(dashboardSource, /isCurrentMetaAggregate\(aggregate\.meta_sync/);
  assert.doesNotMatch(
    dashboardSource,
    /metaRows > 0[\s\S]{0,120}isCurrentMetaAggregate|isCurrentMetaAggregate[\s\S]{0,120}metaRows > 0/,
  );
  assert.match(dashboardRouteSource, /dashboard\.integrations\.meta === "ready"/);
  assert.doesNotMatch(dashboardRouteSource, /metaRowsRead > 0/);
  assert.match(dashboardRouteSource, /화면·1P 수신/);
  assert.match(dashboardRouteSource, /Meta 집계/);
  assert.match(dashboardRouteSource, /dashboard\.integrations\.metaLastSyncedAt/);
  assert.match(dashboardRouteSource, /hasAutomaticRefreshError/);
  assert.match(
    dashboardRouteSource,
    /autoRefreshEnabled && tabVisible && !hasAutomaticRefreshError/,
  );
  assert.match(dashboardRouteSource, /wdops-live-dot\.is-error/);
  assert.match(
    dashboardRouteSource,
    /if \(!result\.ok\) \{[\s\S]*if \(!automatic\) \{[\s\S]*setDashboard\(null\)/,
  );
});

test("dashboard refreshes first-party aggregates and refuses stale paid metrics", () => {
  const dashboardSource = readFileSync(
    new URL("../src/lib/api/dashboard.functions.ts", import.meta.url),
    "utf8",
  );
  const syncCall = dashboardSource.indexOf(
    "insightSync = await metaInsights.syncMetaInsights(from, to)",
  );
  const failureCheck = dashboardSource.indexOf("if (!insightSync.ok)", syncCall);
  const failureReturn = dashboardSource.indexOf(
    'return { ok: false, reason: "meta_sync_failed" }',
    failureCheck,
  );

  assert.ok(syncCall >= 0);
  assert.ok(failureCheck > syncCall);
  assert.ok(failureReturn > failureCheck);
  assert.doesNotMatch(dashboardSource, /dashboardCache|CACHE_TTL_MS/);
  assert.match(dashboardSource, /aggregate = await readDashboardAggregate/);
  assert.match(dashboardSource, /if \(!tokenMatches\(data\.token\)\)/);
  assert.doesNotMatch(dashboardSource, /isMetaSyncGenerationCurrent/);
  assert.match(dashboardSource, /isCurrentMetaAggregate/);
  assert.match(
    dashboardSource,
    /metaTokenAvailable &&[\s\S]*insightSync\.ok &&[\s\S]*metaScopeAvailable &&[\s\S]*isCurrentMetaAggregate/,
  );
  assert.match(dashboardSource, /instant_form_microevent_mapping_unverified/);
  assert.match(
    dashboardSource,
    /instantFormMetaLeads > 0 &&[\s\S]*instantFormOpens === 0 \|\| instantFormStarts === 0/,
  );

  const metaSource = readFileSync(
    new URL("../src/lib/api/metaInsights.server.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(metaSource, /successfulSyncCache|cachedSuccessfulSync|cacheSuccessfulSync/);
  assert.match(metaSource, /const inFlightSyncs = new Map/);
  assert.doesNotMatch(metaSource, /syncStartedAt/);
  assert.match(metaSource, /reserveMetaInsightsSync/);
});
