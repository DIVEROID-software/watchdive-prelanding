-- WatchDive full-funnel measurement store.
-- Contains pseudonymous event/session identifiers and campaign attribution only.
-- Raw email and phone values remain in the CRM and are never stored here.

create table if not exists public.funnel_events (
  id uuid primary key,
  session_id uuid not null,
  visitor_id uuid,
  event_name text not null check (
    event_name in (
      'landing_view',
      'cta_view',
      'cta_click',
      'video_play',
      'video_25',
      'video_50',
      'video_75',
      'video_complete',
      'form_view',
      'form_start',
      'form_submit_attempt',
      'form_submit_success',
      'form_submit_error',
      'instant_form_webhook',
      'instant_form_crm_saved',
      'meta_browser_lead_dispatched',
      'meta_browser_contact_dispatched',
      'lead_validated',
      'lead_verified'
    )
  ),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  acquisition_path text not null check (acquisition_path in ('website', 'instant_form')),
  source text,
  page_path text,
  referrer_host text,
  country text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  meta_campaign_name text,
  meta_adset_name text,
  meta_ad_name text,
  publisher_platform text,
  placement text,
  fbclid text,
  properties jsonb not null default '{}'::jsonb,
  schema_version text not null,
  environment text not null default 'development'
    check (environment in ('production', 'preview', 'development')),
  deployment_id text,
  landing_page_version text
);

create index if not exists funnel_events_occurred_at_idx
  on public.funnel_events (occurred_at desc);
create index if not exists funnel_events_session_idx
  on public.funnel_events (session_id, occurred_at);
create index if not exists funnel_events_name_time_idx
  on public.funnel_events (event_name, occurred_at desc);
create index if not exists funnel_events_campaign_idx
  on public.funnel_events (meta_campaign_id, meta_adset_id, meta_ad_id);
create index if not exists funnel_events_environment_time_idx
  on public.funnel_events (environment, occurred_at desc);

alter table public.funnel_events
  drop constraint if exists funnel_events_event_name_check;
alter table public.funnel_events
  add constraint funnel_events_event_name_check check (
    event_name in (
      'landing_view',
      'cta_view',
      'cta_click',
      'video_play',
      'video_25',
      'video_50',
      'video_75',
      'video_complete',
      'form_view',
      'form_start',
      'form_submit_attempt',
      'form_submit_success',
      'form_submit_error',
      'instant_form_webhook',
      'instant_form_crm_saved',
      'meta_browser_lead_dispatched',
      'meta_browser_contact_dispatched',
      'lead_validated',
      'lead_verified'
    )
  );

create table if not exists public.funnel_leads (
  lead_id text primary key,
  event_id text,
  session_id uuid,
  visitor_id uuid,
  acquisition_path text not null check (acquisition_path in ('website', 'instant_form')),
  source text,
  page_path text,
  country text,
  status text not null check (status in ('new', 'duplicate', 'suspect', 'invalid')),
  valid boolean not null default false,
  verified boolean not null default false,
  has_email boolean not null default true,
  has_phone boolean not null default false,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  measurement_consent boolean not null default false,
  meta_eligible boolean not null default false,
  meta_capi_state text not null default 'skipped'
    check (meta_capi_state in ('sent', 'skipped', 'failed')),
  meta_events_received integer not null default 0,
  notion_page_id text,
  signed_up_at timestamptz not null,
  flags text[] not null default '{}',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  meta_campaign_name text,
  meta_adset_name text,
  meta_ad_name text,
  publisher_platform text,
  placement text,
  schema_version text not null,
  environment text not null default 'development'
    check (environment in ('production', 'preview', 'development')),
  deployment_id text,
  landing_page_version text,
  updated_at timestamptz not null default now()
);

create unique index if not exists funnel_leads_event_id_unique_idx
  on public.funnel_leads (event_id)
  where event_id is not null;
create index if not exists funnel_leads_signed_up_at_idx
  on public.funnel_leads (signed_up_at desc);
create index if not exists funnel_leads_path_valid_idx
  on public.funnel_leads (acquisition_path, valid, signed_up_at desc);
create index if not exists funnel_leads_environment_time_idx
  on public.funnel_leads (environment, signed_up_at desc);

create or replace function public.set_funnel_lead_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_funnel_lead_updated_at() from public, anon, authenticated;

drop trigger if exists funnel_leads_set_updated_at on public.funnel_leads;
create trigger funnel_leads_set_updated_at
before update on public.funnel_leads
for each row
execute function public.set_funnel_lead_updated_at();

create table if not exists public.meta_daily_insights (
  insight_date date not null,
  account_id text not null,
  campaign_id text not null,
  campaign_name text,
  adset_id text not null,
  adset_name text,
  ad_id text not null,
  ad_name text,
  country text not null default '',
  publisher_platform text not null default '',
  platform_position text not null default '',
  conversion_location text not null default 'unknown'
    check (conversion_location in ('website', 'instant_form', 'unknown')),
  impressions bigint not null default 0,
  reach bigint not null default 0,
  spend_eur numeric(14, 4) not null default 0,
  link_clicks bigint not null default 0,
  landing_page_views bigint not null default 0,
  website_leads bigint not null default 0,
  website_contacts bigint not null default 0,
  instant_form_leads bigint not null default 0,
  instant_form_opens bigint not null default 0,
  instant_form_starts bigint not null default 0,
  video_3s bigint not null default 0,
  video_thruplay bigint not null default 0,
  video_25 bigint not null default 0,
  video_50 bigint not null default 0,
  video_75 bigint not null default 0,
  video_95 bigint not null default 0,
  video_100 bigint not null default 0,
  raw_actions jsonb not null default '[]'::jsonb,
  sync_generation bigint not null check (sync_generation > 0),
  synced_at timestamptz not null default now(),
  primary key (
    insight_date,
    account_id,
    campaign_id,
    adset_id,
    ad_id,
    country,
    publisher_platform,
    platform_position
  )
);

alter table public.meta_daily_insights
  add column if not exists website_contacts bigint not null default 0,
  add column if not exists video_3s bigint not null default 0,
  add column if not exists video_thruplay bigint not null default 0,
  add column if not exists video_25 bigint not null default 0,
  add column if not exists video_50 bigint not null default 0,
  add column if not exists video_75 bigint not null default 0,
  add column if not exists video_95 bigint not null default 0,
  add column if not exists video_100 bigint not null default 0,
  add column if not exists sync_generation bigint;

-- Meta aggregates are reproducible, so pre-generation snapshots are removed
-- rather than guessed into the first generation during an upgrade.
delete from public.meta_daily_insights where sync_generation is null;
alter table public.meta_daily_insights
  alter column sync_generation set not null;

do $meta_daily_generation_constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.meta_daily_insights'::regclass
      and conname = 'meta_daily_insights_sync_generation_positive'
  ) then
    alter table public.meta_daily_insights
      add constraint meta_daily_insights_sync_generation_positive
      check (sync_generation > 0);
  end if;
end;
$meta_daily_generation_constraint$;

create index if not exists meta_daily_insights_date_idx
  on public.meta_daily_insights (insight_date desc);
create index if not exists meta_daily_insights_campaign_idx
  on public.meta_daily_insights (campaign_id, insight_date desc);
create index if not exists meta_daily_insights_scope_idx
  on public.meta_daily_insights (account_id, campaign_id, insight_date desc);
create index if not exists meta_daily_insights_generation_idx
  on public.meta_daily_insights (account_id, sync_generation, insight_date);

-- Reach is not additive across day/ad/country/placement rows. This table stores
-- the one no-breakdown Graph result for an exact date+campaign scope so the
-- dashboard can expose exact unique reach and frequency without overcounting.
create table if not exists public.meta_range_insights (
  range_from date not null,
  range_to date not null,
  account_id text not null,
  campaign_ids text[] not null,
  impressions bigint not null default 0 check (impressions >= 0),
  reach bigint not null default 0 check (reach >= 0),
  frequency numeric(14, 6) not null default 0 check (frequency >= 0),
  spend_eur numeric(14, 4) not null default 0 check (spend_eur >= 0),
  link_clicks bigint not null default 0 check (link_clicks >= 0),
  sync_generation bigint not null check (sync_generation > 0),
  synced_at timestamptz not null default now(),
  check (range_to >= range_from),
  check (range_to - range_from <= 89),
  check (cardinality(campaign_ids) > 0),
  primary key (range_from, range_to, account_id, campaign_ids)
);

alter table public.meta_range_insights
  add column if not exists sync_generation bigint;
delete from public.meta_range_insights where sync_generation is null;
alter table public.meta_range_insights
  alter column sync_generation set not null;

do $meta_range_generation_constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.meta_range_insights'::regclass
      and conname = 'meta_range_insights_sync_generation_positive'
  ) then
    alter table public.meta_range_insights
      add constraint meta_range_insights_sync_generation_positive
      check (sync_generation > 0);
  end if;
end;
$meta_range_generation_constraint$;

create index if not exists meta_range_insights_scope_idx
  on public.meta_range_insights (account_id, range_from, range_to);
create index if not exists meta_range_insights_generation_idx
  on public.meta_range_insights (account_id, sync_generation);

-- One account-wide monotonic generation serializes paid snapshots across
-- server replicas. A reservation is committed before Graph is called. Any
-- process crash therefore leaves status=syncing, which makes paid aggregates
-- fail closed until a later refresh reserves and commits a newer generation.
create table if not exists public.meta_insights_sync_state (
  account_id text primary key
    check (account_id ~ '^[0-9]{5,30}$'),
  generation bigint not null
    check (generation > 0),
  status text not null
    check (status in ('syncing', 'ready', 'failed')),
  range_from date not null,
  range_to date not null,
  campaign_ids text[] not null,
  reserved_at timestamptz not null,
  completed_at timestamptz,
  check (range_to >= range_from),
  check (range_to - range_from <= 89),
  check (cardinality(campaign_ids) > 0)
);

-- Public waitlist submissions are limited by a rotating keyed HMAC. The raw
-- client address is never sent to or stored by Supabase. A fixed-window row is
-- intentionally small and short-lived; callers can only use the atomic RPC.
create table if not exists public.signup_rate_limit_buckets (
  bucket_hash text primary key
    check (bucket_hash ~ '^[0-9a-f]{64}$'),
  environment text not null
    check (environment in ('production', 'preview', 'development')),
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  attempts integer not null default 1
    check (attempts > 0),
  updated_at timestamptz not null default now(),
  check (expires_at > window_started_at),
  check (expires_at <= window_started_at + interval '2 hours')
);

create index if not exists signup_rate_limit_buckets_expires_at_idx
  on public.signup_rate_limit_buckets (expires_at);

alter table public.funnel_events enable row level security;
alter table public.funnel_leads enable row level security;
alter table public.meta_daily_insights enable row level security;
alter table public.meta_range_insights enable row level security;
alter table public.meta_insights_sync_state enable row level security;
alter table public.signup_rate_limit_buckets enable row level security;

-- No anonymous/authenticated policies are created. The production server uses
-- the service-role key; browsers cannot read or write these operational tables.

create or replace view public.funnel_daily_summary
with (security_invoker = true) as
with event_rollup as (
  select
    (occurred_at at time zone 'Asia/Seoul')::date as report_date,
    environment,
    acquisition_path,
    coalesce(source, '') as source,
    coalesce(publisher_platform, '') as publisher_platform,
    coalesce(placement, '') as placement,
    coalesce(meta_campaign_id, '') as meta_campaign_id,
    coalesce(meta_adset_id, '') as meta_adset_id,
    coalesce(meta_ad_id, '') as meta_ad_id,
    count(distinct session_id) filter (where event_name = 'landing_view') as landing_sessions,
    count(distinct session_id) filter (where event_name = 'cta_view') as cta_view_sessions,
    count(distinct session_id) filter (where event_name = 'cta_click') as cta_click_sessions,
    count(distinct session_id) filter (where event_name = 'video_play') as video_play_sessions,
    count(distinct session_id) filter (where event_name = 'form_view') as form_view_sessions,
    count(distinct session_id) filter (where event_name = 'form_start') as form_start_sessions,
    count(distinct session_id) filter (where event_name = 'form_submit_attempt') as submit_sessions,
    count(distinct session_id) filter (where event_name = 'form_submit_success') as submit_success_sessions,
    count(distinct session_id) filter (where event_name = 'form_submit_error') as submit_error_sessions,
    count(*) filter (where event_name = 'instant_form_webhook') as instant_form_webhooks,
    count(*) filter (where event_name = 'instant_form_crm_saved') as instant_form_crm_saves
  from public.funnel_events
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9
),
lead_rollup as (
  select
    (signed_up_at at time zone 'Asia/Seoul')::date as report_date,
    environment,
    acquisition_path,
    coalesce(source, '') as source,
    coalesce(publisher_platform, '') as publisher_platform,
    coalesce(placement, '') as placement,
    coalesce(meta_campaign_id, '') as meta_campaign_id,
    coalesce(meta_adset_id, '') as meta_adset_id,
    coalesce(meta_ad_id, '') as meta_ad_id,
    count(*) filter (where status = 'new') as new_leads,
    count(*) filter (where status = 'duplicate') as duplicate_leads,
    count(*) filter (where status = 'suspect') as suspect_leads,
    count(*) filter (where valid) as valid_leads,
    count(*) filter (where valid and has_phone) as phone_leads,
    count(*) filter (where email_verified) as email_verified_leads,
    count(*) filter (where phone_verified) as phone_verified_leads,
    count(*) filter (where valid and verified) as verified_leads
  from public.funnel_leads
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9
),
dimension_keys as (
  select
    report_date,
    environment,
    acquisition_path,
    source,
    publisher_platform,
    placement,
    meta_campaign_id,
    meta_adset_id,
    meta_ad_id
  from event_rollup
  union
  select
    report_date,
    environment,
    acquisition_path,
    source,
    publisher_platform,
    placement,
    meta_campaign_id,
    meta_adset_id,
    meta_ad_id
  from lead_rollup
)
select
  k.*,
  coalesce(e.landing_sessions, 0) as landing_sessions,
  coalesce(e.cta_view_sessions, 0) as cta_view_sessions,
  coalesce(e.cta_click_sessions, 0) as cta_click_sessions,
  coalesce(e.video_play_sessions, 0) as video_play_sessions,
  coalesce(e.form_view_sessions, 0) as form_view_sessions,
  coalesce(e.form_start_sessions, 0) as form_start_sessions,
  coalesce(e.submit_sessions, 0) as submit_sessions,
  coalesce(e.submit_success_sessions, 0) as submit_success_sessions,
  coalesce(e.submit_error_sessions, 0) as submit_error_sessions,
  coalesce(e.instant_form_webhooks, 0) as instant_form_webhooks,
  coalesce(e.instant_form_crm_saves, 0) as instant_form_crm_saves,
  coalesce(l.new_leads, 0) as new_leads,
  coalesce(l.duplicate_leads, 0) as duplicate_leads,
  coalesce(l.suspect_leads, 0) as suspect_leads,
  coalesce(l.valid_leads, 0) as valid_leads,
  coalesce(l.phone_leads, 0) as phone_leads,
  coalesce(l.email_verified_leads, 0) as email_verified_leads,
  coalesce(l.phone_verified_leads, 0) as phone_verified_leads,
  coalesce(l.verified_leads, 0) as verified_leads
from dimension_keys k
left join event_rollup e using (
  report_date,
  environment,
  acquisition_path,
  source,
  publisher_platform,
  placement,
  meta_campaign_id,
  meta_adset_id,
  meta_ad_id
)
left join lead_rollup l using (
  report_date,
  environment,
  acquisition_path,
  source,
  publisher_platform,
  placement,
  meta_campaign_id,
  meta_adset_id,
  meta_ad_id
);

revoke all on public.funnel_events from anon, authenticated;
revoke all on public.funnel_leads from anon, authenticated;
revoke all on public.meta_daily_insights from anon, authenticated;
revoke all on public.meta_range_insights from anon, authenticated;
revoke all on public.meta_insights_sync_state from anon, authenticated;
revoke all on public.signup_rate_limit_buckets from anon, authenticated;
revoke all on public.funnel_daily_summary from anon, authenticated;
grant select, insert, update, delete on public.funnel_events to service_role;
grant select, insert, update, delete on public.funnel_leads to service_role;
grant select, insert, update, delete on public.meta_daily_insights to service_role;
grant select, insert, update, delete on public.meta_range_insights to service_role;
grant select, insert, update on public.meta_insights_sync_state to service_role;
grant select, insert, update, delete on public.signup_rate_limit_buckets to service_role;
grant select on public.funnel_daily_summary to service_role;

create or replace view public.funnel_event_daily_metrics
with (security_invoker = true) as
select
  (occurred_at at time zone 'Asia/Seoul')::date as report_date,
  environment,
  acquisition_path,
  coalesce(source, '') as source,
  coalesce(page_path, '') as page_path,
  coalesce(country, '') as country,
  coalesce(publisher_platform, '') as publisher_platform,
  coalesce(placement, '') as placement,
  coalesce(meta_campaign_id, '') as meta_campaign_id,
  coalesce(meta_adset_id, '') as meta_adset_id,
  coalesce(meta_ad_id, '') as meta_ad_id,
  coalesce(meta_campaign_name, '') as meta_campaign_name,
  coalesce(meta_adset_name, '') as meta_adset_name,
  coalesce(meta_ad_name, '') as meta_ad_name,
  event_name,
  count(distinct session_id) as unique_sessions,
  count(*) as event_count,
  max(received_at) as latest_received_at
from public.funnel_events
group by
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15;

create or replace view public.funnel_lead_daily_metrics
with (security_invoker = true) as
select
  (signed_up_at at time zone 'Asia/Seoul')::date as report_date,
  environment,
  acquisition_path,
  coalesce(source, '') as source,
  coalesce(page_path, '') as page_path,
  coalesce(country, '') as country,
  coalesce(publisher_platform, '') as publisher_platform,
  coalesce(placement, '') as placement,
  coalesce(meta_campaign_id, '') as meta_campaign_id,
  coalesce(meta_adset_id, '') as meta_adset_id,
  coalesce(meta_ad_id, '') as meta_ad_id,
  coalesce(meta_campaign_name, '') as meta_campaign_name,
  coalesce(meta_adset_name, '') as meta_adset_name,
  coalesce(meta_ad_name, '') as meta_ad_name,
  status,
  valid,
  verified,
  has_email,
  has_phone,
  email_verified,
  phone_verified,
  measurement_consent,
  meta_eligible,
  meta_capi_state,
  count(*) as lead_count,
  sum(meta_events_received) as meta_events_received,
  max(updated_at) as latest_updated_at
from public.funnel_leads
group by
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24;

revoke all on public.funnel_event_daily_metrics from anon, authenticated;
revoke all on public.funnel_lead_daily_metrics from anon, authenticated;
grant select on public.funnel_event_daily_metrics to service_role;
grant select on public.funnel_lead_daily_metrics to service_role;

-- Reserve a database-issued generation before any external Graph request.
-- Account-wide serialization is intentionally conservative: a concurrent or
-- crashed refresh cannot leave another replica believing an older paid
-- snapshot is current.
create or replace function public.reserve_meta_insights_sync(
  p_account_id text,
  p_campaign_ids text[],
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_campaign_ids text[];
  v_generation bigint;
  v_reserved_at timestamptz;
begin
  if p_account_id is null or p_account_id !~ '^[0-9]{5,30}$' then
    raise exception 'invalid Meta account scope' using errcode = '22023';
  end if;
  if p_campaign_ids is null or cardinality(p_campaign_ids) = 0 then
    raise exception 'Meta campaign scope cannot be empty' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_campaign_ids) as ids(campaign_id)
    where ids.campaign_id is null or ids.campaign_id !~ '^[0-9]{5,30}$'
  ) then
    raise exception 'invalid Meta campaign scope' using errcode = '22023';
  end if;
  if p_from is null
    or p_to is null
    or p_to < p_from
    or p_to - p_from > 89
  then
    raise exception 'invalid Meta insight range dates' using errcode = '22023';
  end if;

  select array_agg(distinct campaign_id order by campaign_id)
  into v_campaign_ids
  from unnest(p_campaign_ids) as ids(campaign_id);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('watchdive:meta-insights:' || p_account_id, 0)
  );
  v_reserved_at := pg_catalog.clock_timestamp();

  insert into public.meta_insights_sync_state (
    account_id,
    generation,
    status,
    range_from,
    range_to,
    campaign_ids,
    reserved_at,
    completed_at
  )
  values (
    p_account_id,
    1,
    'syncing',
    p_from,
    p_to,
    v_campaign_ids,
    v_reserved_at,
    null
  )
  on conflict (account_id)
  do update set
    generation = public.meta_insights_sync_state.generation + 1,
    status = 'syncing',
    range_from = excluded.range_from,
    range_to = excluded.range_to,
    campaign_ids = excluded.campaign_ids,
    reserved_at = excluded.reserved_at,
    completed_at = null
  returning generation into v_generation;

  return jsonb_build_object(
    'generation', v_generation,
    'reserved_at', v_reserved_at
  );
end;
$$;

-- A handled failure advances no generation; it marks only the still-current
-- reservation. A late failure cannot downgrade a newer or already-ready sync.
create or replace function public.fail_meta_insights_sync(
  p_account_id text,
  p_generation bigint
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_changed integer := 0;
begin
  if p_account_id is null or p_account_id !~ '^[0-9]{5,30}$' then
    raise exception 'invalid Meta account scope' using errcode = '22023';
  end if;
  if p_generation is null or p_generation <= 0 then
    raise exception 'invalid Meta sync generation' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('watchdive:meta-insights:' || p_account_id, 0)
  );

  update public.meta_insights_sync_state
  set
    status = 'failed',
    completed_at = pg_catalog.clock_timestamp()
  where account_id = p_account_id
    and generation = p_generation
    and status = 'syncing';

  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;

revoke all on function public.reserve_meta_insights_sync(
  text,
  text[],
  date,
  date
) from public, anon, authenticated;
grant execute on function public.reserve_meta_insights_sync(
  text,
  text[],
  date,
  date
) to service_role;

revoke all on function public.fail_meta_insights_sync(
  text,
  bigint
) from public, anon, authenticated;
grant execute on function public.fail_meta_insights_sync(
  text,
  bigint
) to service_role;

-- Exact, bounded dashboard aggregate. Raw event/lead rows never leave Postgres:
-- GROUPING SETS computes all supported breakdowns in one scan per source while
-- count(distinct session_id) preserves range-level unique-session semantics.
create or replace function public.get_funnel_dashboard_aggregate_v1(
  p_start timestamptz,
  p_end_exclusive timestamptz,
  p_from date,
  p_to date,
  p_environment text,
  p_account_id text,
  p_expected_meta_generation bigint,
  p_campaign_ids text[],
  p_website_campaign_ids text[],
  p_instant_form_campaign_ids text[]
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with
events_base as materialized (
  select
    e.*,
    lower(
      regexp_replace(
        coalesce(
          nullif(btrim(e.publisher_platform), ''),
          nullif(btrim(e.utm_source), ''),
          ''
        ),
        '[[:space:]-]+',
        '_',
        'g'
      )
    ) as channel_raw,
    lower(
      regexp_replace(
        coalesce(nullif(btrim(e.placement), ''), 'unknown'),
        '[[:space:]-]+',
        '_',
        'g'
      )
    ) as placement_raw,
    coalesce(
      nullif(btrim(e.meta_campaign_id), ''),
      case
        when btrim(coalesce(e.utm_campaign, '')) ~ '^[0-9]{5,30}$'
          then btrim(e.utm_campaign)
        else null
      end
    ) as paid_campaign_id
  from public.funnel_events e
  where e.environment = p_environment
    and e.occurred_at >= p_start
    and e.occurred_at < p_end_exclusive
    and p_end_exclusive > p_start
    and p_end_exclusive - p_start <= interval '90 days'
),
events as materialized (
  select
    e.*,
    (
      e.paid_campaign_id is not null
      and e.paid_campaign_id = any(coalesce(p_campaign_ids, '{}'::text[]))
    ) as paid_in_union_scope,
    (
      e.paid_campaign_id is not null
      and e.paid_campaign_id = any(coalesce(p_campaign_ids, '{}'::text[]))
      and (
        (
          e.acquisition_path = 'website'
          and e.paid_campaign_id = any(coalesce(p_website_campaign_ids, '{}'::text[]))
        )
        or (
          e.acquisition_path = 'instant_form'
          and e.paid_campaign_id = any(coalesce(p_instant_form_campaign_ids, '{}'::text[]))
        )
      )
    ) as paid_in_scope,
    e.acquisition_path as path_key,
    case
      when e.acquisition_path = 'instant_form' then 'Instant Form'
      else 'Website'
    end as path_label,
    coalesce(nullif(btrim(e.source), ''), 'unknown') as source_key,
    coalesce(nullif(btrim(e.source), ''), 'Unknown source') as source_label,
    coalesce(nullif(btrim(e.page_path), ''), 'unknown') as page_key,
    coalesce(nullif(btrim(e.page_path), ''), 'Unknown page') as page_label,
    case e.channel_raw
      when '' then 'direct_unknown'
      when 'fb' then 'facebook'
      when 'ig' then 'instagram'
      when 'an' then 'audience_network'
      when 'msg' then 'messenger'
      else e.channel_raw
    end as channel_key,
    case e.channel_raw
      when '' then 'Direct / unknown'
      when 'fb' then 'facebook'
      when 'ig' then 'instagram'
      when 'an' then 'audience_network'
      when 'msg' then 'messenger'
      else e.channel_raw
    end as channel_label,
    case
      when e.acquisition_path = 'website'
        then 'website|' || placement_parts.platform_key || '/' || placement_parts.position_key
      else null
    end as placement_key,
    case
      when e.acquisition_path = 'website'
        then 'Website · '
          || initcap(replace(placement_parts.platform_key, '_', ' '))
          || ' / '
          || case placement_parts.position_key
            when 'reels' then 'Reels'
            when 'stories' then 'Stories'
            when 'feed' then 'Feed'
            else initcap(replace(placement_parts.position_key, '_', ' '))
          end
      else null
    end as placement_label,
    coalesce(nullif(btrim(e.country), ''), 'unknown') as country_key,
    coalesce(nullif(btrim(e.country), ''), 'Unknown country') as country_label,
    coalesce(
      nullif(btrim(e.meta_campaign_id), ''),
      nullif(btrim(e.utm_campaign), ''),
      'unknown'
    ) as campaign_key,
    coalesce(
      nullif(btrim(e.meta_campaign_name), ''),
      nullif(btrim(e.utm_campaign), ''),
      nullif(btrim(e.meta_campaign_id), ''),
      'Unknown campaign'
    ) as campaign_label,
    coalesce(nullif(btrim(e.meta_adset_id), ''), 'unknown') as adset_key,
    coalesce(
      nullif(btrim(e.meta_adset_name), ''),
      nullif(btrim(e.meta_adset_id), ''),
      'Unknown ad set'
    ) as adset_label,
    coalesce(nullif(btrim(e.meta_ad_id), ''), 'unknown') as ad_key,
    coalesce(
      nullif(btrim(e.meta_ad_name), ''),
      nullif(btrim(e.meta_ad_id), ''),
      'Unknown ad'
    ) as ad_label,
    coalesce(
      nullif(btrim(e.meta_ad_id), ''),
      nullif(btrim(e.utm_content), ''),
      'unknown'
    ) as creative_key,
    coalesce(
      nullif(btrim(e.utm_content), ''),
      nullif(btrim(e.meta_ad_name), ''),
      nullif(btrim(e.meta_ad_id), ''),
      'Unknown creative'
    ) as creative_label
  from events_base e
  cross join lateral (
    select
      case
        when e.placement_raw like 'instagram_%' then 'instagram'
        when e.placement_raw like 'facebook_%' then 'facebook'
        else case e.channel_raw
          when '' then 'direct_unknown'
          when 'fb' then 'facebook'
          when 'ig' then 'instagram'
          when 'an' then 'audience_network'
          when 'msg' then 'messenger'
          else e.channel_raw
        end
      end as platform_key,
      case
        when e.placement_raw in (
          'reel',
          'reels',
          'instagram_reels',
          'facebook_reels'
        ) then 'reels'
        when e.placement_raw in (
          'story',
          'stories',
          'instagram_story',
          'instagram_stories',
          'facebook_story',
          'facebook_stories'
        ) then 'stories'
        when e.placement_raw in (
          'feed',
          'instagram_feed',
          'facebook_feed',
          'mobile_feed',
          'desktop_feed'
        ) or e.placement_raw like '%_feed' then 'feed'
        else regexp_replace(e.placement_raw, '^(instagram|facebook)_', '')
      end as position_key
  ) placement_parts
),
event_metrics as (
  select
    case
      when grouping(path_key) = 0 then 'path'
      when grouping(source_key) = 0 then 'source'
      when grouping(page_key) = 0 then 'page'
      when grouping(channel_key) = 0 then 'channel'
      when grouping(placement_key) = 0 then 'placement'
      when grouping(country_key) = 0 then 'country'
      when grouping(campaign_key) = 0 then 'campaign'
      when grouping(adset_key) = 0 then 'adSet'
      when grouping(ad_key) = 0 then 'ad'
      else 'creative'
    end as dimension,
    case
      when grouping(path_key) = 0 then path_key
      when grouping(source_key) = 0 then source_key
      when grouping(page_key) = 0 then page_key
      when grouping(channel_key) = 0 then channel_key
      when grouping(placement_key) = 0 then placement_key
      when grouping(country_key) = 0 then country_key
      when grouping(campaign_key) = 0 then campaign_key
      when grouping(adset_key) = 0 then adset_key
      when grouping(ad_key) = 0 then ad_key
      else creative_key
    end as key,
    case
      when grouping(path_key) = 0 then max(path_label)
      when grouping(source_key) = 0 then max(source_label)
      when grouping(page_key) = 0 then max(page_label)
      when grouping(channel_key) = 0 then max(channel_label)
      when grouping(placement_key) = 0 then max(placement_label)
      when grouping(country_key) = 0 then max(country_label)
      when grouping(campaign_key) = 0 then max(campaign_label)
      when grouping(adset_key) = 0 then max(adset_label)
      when grouping(ad_key) = 0 then max(ad_label)
      else max(creative_label)
    end as label,
    count(distinct session_id) filter (where event_name = 'landing_view') as landing_sessions,
    count(distinct session_id) filter (where event_name = 'form_view') as form_views,
    count(distinct session_id) filter (where event_name = 'form_start') as form_starts,
    count(distinct session_id) filter (where event_name = 'cta_view') as cta_views,
    count(distinct session_id) filter (where event_name = 'cta_click') as cta_clicks,
    count(distinct session_id) filter (where event_name = 'video_play') as video_plays,
    count(distinct session_id) filter (where event_name = 'video_25') as video_25,
    count(distinct session_id) filter (where event_name = 'video_50') as video_50,
    count(distinct session_id) filter (where event_name = 'video_75') as video_75,
    count(distinct session_id) filter (where event_name = 'video_complete') as video_completions,
    count(distinct session_id) filter (where event_name = 'form_submit_attempt') as submit_attempts,
    count(distinct session_id) filter (where event_name = 'form_submit_success') as submit_successes,
    count(distinct session_id) filter (where event_name = 'form_submit_error') as submit_errors,
    count(distinct session_id) filter (where event_name = 'instant_form_webhook') as instant_form_webhooks,
    count(distinct session_id) filter (where event_name = 'instant_form_crm_saved') as instant_form_crm_saves,
    count(distinct session_id) filter (
      where event_name = 'meta_browser_lead_dispatched'
    ) as meta_browser_lead_dispatches,
    count(distinct session_id) filter (
      where event_name = 'meta_browser_contact_dispatched'
    ) as meta_browser_contact_dispatches
  from events
  group by grouping sets (
    (path_key),
    (source_key),
    (page_key),
    (channel_key),
    (placement_key),
    (country_key),
    (campaign_key),
    (adset_key),
    (ad_key),
    (creative_key)
  )
  having grouping(placement_key) = 1 or placement_key is not null
),
event_totals as (
  select
    count(*) as event_rows,
    max(occurred_at) as latest_event_at,
    count(*) filter (where event_name = 'landing_view') as landing_rows,
    count(*) filter (
      where event_name = 'landing_view'
        and coalesce(
          nullif(btrim(publisher_platform), ''),
          nullif(btrim(utm_source), ''),
          nullif(btrim(utm_medium), ''),
          nullif(btrim(utm_campaign), ''),
          nullif(btrim(meta_campaign_id), ''),
          nullif(btrim(meta_adset_id), ''),
          nullif(btrim(meta_ad_id), '')
        ) is not null
    ) as attributed_landing_rows
  from events
),
scoped_event_totals as (
  select
    count(distinct session_id) filter (
      where paid_in_union_scope and not paid_in_scope
    ) as path_campaign_mismatch_sessions,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'landing_view'
    ) as website_landing_sessions,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'cta_view'
    ) as website_cta_views,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'cta_click'
    ) as website_cta_clicks,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'video_play'
    ) as website_video_plays,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'video_25'
    ) as website_video_25,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'video_50'
    ) as website_video_50,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'video_75'
    ) as website_video_75,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'video_complete'
    ) as website_video_completions,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'form_view'
    ) as website_form_views,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'form_start'
    ) as website_form_starts,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'form_submit_attempt'
    ) as website_submit_attempts,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'form_submit_success'
    ) as website_submit_successes,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'form_submit_error'
    ) as website_submit_errors,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'meta_browser_lead_dispatched'
    ) as website_browser_lead_dispatches,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and event_name = 'meta_browser_contact_dispatched'
    ) as website_browser_contact_dispatches,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'instant_form'
        and event_name = 'instant_form_webhook'
    ) as instant_form_webhooks,
    count(distinct session_id) filter (
      where paid_in_scope
        and acquisition_path = 'instant_form'
        and event_name = 'instant_form_crm_saved'
    ) as instant_form_crm_saves
  from events
),
leads_base as materialized (
  select
    l.*,
    lower(
      regexp_replace(
        coalesce(
          nullif(btrim(l.publisher_platform), ''),
          nullif(btrim(l.utm_source), ''),
          ''
        ),
        '[[:space:]-]+',
        '_',
        'g'
      )
    ) as channel_raw,
    lower(
      regexp_replace(
        coalesce(nullif(btrim(l.placement), ''), 'unknown'),
        '[[:space:]-]+',
        '_',
        'g'
      )
    ) as placement_raw,
    coalesce(
      nullif(btrim(l.meta_campaign_id), ''),
      case
        when btrim(coalesce(l.utm_campaign, '')) ~ '^[0-9]{5,30}$'
          then btrim(l.utm_campaign)
        else null
      end
    ) as paid_campaign_id,
    (
      coalesce(
        nullif(btrim(l.meta_campaign_id), ''),
        nullif(btrim(l.meta_adset_id), ''),
        nullif(btrim(l.meta_ad_id), '')
      ) is not null
      or lower(
        regexp_replace(coalesce(l.utm_medium, ''), '[[:space:]-]+', '_', 'g')
      ) in ('paid', 'paid_social', 'paidsocial', 'cpc', 'ppc', 'display')
    ) as has_paid_signal
  from public.funnel_leads l
  where l.environment = p_environment
    and l.signed_up_at >= p_start
    and l.signed_up_at < p_end_exclusive
    and p_end_exclusive > p_start
    and p_end_exclusive - p_start <= interval '90 days'
),
leads as materialized (
  select
    l.*,
    l.acquisition_path as path_key,
    case
      when l.acquisition_path = 'instant_form' then 'Instant Form'
      else 'Website'
    end as path_label,
    coalesce(nullif(btrim(l.source), ''), 'unknown') as source_key,
    coalesce(nullif(btrim(l.source), ''), 'Unknown source') as source_label,
    coalesce(nullif(btrim(l.page_path), ''), 'unknown') as page_key,
    coalesce(nullif(btrim(l.page_path), ''), 'Unknown page') as page_label,
    case l.channel_raw
      when '' then 'direct_unknown'
      when 'fb' then 'facebook'
      when 'ig' then 'instagram'
      when 'an' then 'audience_network'
      when 'msg' then 'messenger'
      else l.channel_raw
    end as channel_key,
    case l.channel_raw
      when '' then 'Direct / unknown'
      when 'fb' then 'facebook'
      when 'ig' then 'instagram'
      when 'an' then 'audience_network'
      when 'msg' then 'messenger'
      else l.channel_raw
    end as channel_label,
    case
      when l.acquisition_path = 'website'
        then 'website|' || placement_parts.platform_key || '/' || placement_parts.position_key
      else null
    end as placement_key,
    case
      when l.acquisition_path = 'website'
        then 'Website · '
          || initcap(replace(placement_parts.platform_key, '_', ' '))
          || ' / '
          || case placement_parts.position_key
            when 'reels' then 'Reels'
            when 'stories' then 'Stories'
            when 'feed' then 'Feed'
            else initcap(replace(placement_parts.position_key, '_', ' '))
          end
      else null
    end as placement_label,
    coalesce(nullif(btrim(l.country), ''), 'unknown') as country_key,
    coalesce(nullif(btrim(l.country), ''), 'Unknown country') as country_label,
    coalesce(
      nullif(btrim(l.meta_campaign_id), ''),
      nullif(btrim(l.utm_campaign), ''),
      'unknown'
    ) as campaign_key,
    coalesce(
      nullif(btrim(l.meta_campaign_name), ''),
      nullif(btrim(l.utm_campaign), ''),
      nullif(btrim(l.meta_campaign_id), ''),
      'Unknown campaign'
    ) as campaign_label,
    coalesce(nullif(btrim(l.meta_adset_id), ''), 'unknown') as adset_key,
    coalesce(
      nullif(btrim(l.meta_adset_name), ''),
      nullif(btrim(l.meta_adset_id), ''),
      'Unknown ad set'
    ) as adset_label,
    coalesce(nullif(btrim(l.meta_ad_id), ''), 'unknown') as ad_key,
    coalesce(
      nullif(btrim(l.meta_ad_name), ''),
      nullif(btrim(l.meta_ad_id), ''),
      'Unknown ad'
    ) as ad_label,
    coalesce(
      nullif(btrim(l.meta_ad_id), ''),
      nullif(btrim(l.utm_content), ''),
      'unknown'
    ) as creative_key,
    coalesce(
      nullif(btrim(l.utm_content), ''),
      nullif(btrim(l.meta_ad_name), ''),
      nullif(btrim(l.meta_ad_id), ''),
      'Unknown creative'
    ) as creative_label,
    (
      l.paid_campaign_id is not null
      and l.paid_campaign_id = any(coalesce(p_campaign_ids, '{}'::text[]))
    ) as paid_in_union_scope,
    (
      l.paid_campaign_id is not null
      and l.paid_campaign_id = any(coalesce(p_campaign_ids, '{}'::text[]))
      and (
        (
          l.acquisition_path = 'website'
          and l.paid_campaign_id = any(coalesce(p_website_campaign_ids, '{}'::text[]))
        )
        or (
          l.acquisition_path = 'instant_form'
          and l.paid_campaign_id = any(coalesce(p_instant_form_campaign_ids, '{}'::text[]))
        )
      )
    ) as paid_in_scope
  from leads_base l
  cross join lateral (
    select
      case
        when l.placement_raw like 'instagram_%' then 'instagram'
        when l.placement_raw like 'facebook_%' then 'facebook'
        else case l.channel_raw
          when '' then 'direct_unknown'
          when 'fb' then 'facebook'
          when 'ig' then 'instagram'
          when 'an' then 'audience_network'
          when 'msg' then 'messenger'
          else l.channel_raw
        end
      end as platform_key,
      case
        when l.placement_raw in (
          'reel',
          'reels',
          'instagram_reels',
          'facebook_reels'
        ) then 'reels'
        when l.placement_raw in (
          'story',
          'stories',
          'instagram_story',
          'instagram_stories',
          'facebook_story',
          'facebook_stories'
        ) then 'stories'
        when l.placement_raw in (
          'feed',
          'instagram_feed',
          'facebook_feed',
          'mobile_feed',
          'desktop_feed'
        ) or l.placement_raw like '%_feed' then 'feed'
        else regexp_replace(l.placement_raw, '^(instagram|facebook)_', '')
      end as position_key
  ) placement_parts
),
lead_metrics as (
  select
    case
      when grouping(path_key) = 0 then 'path'
      when grouping(source_key) = 0 then 'source'
      when grouping(page_key) = 0 then 'page'
      when grouping(channel_key) = 0 then 'channel'
      when grouping(placement_key) = 0 then 'placement'
      when grouping(country_key) = 0 then 'country'
      when grouping(campaign_key) = 0 then 'campaign'
      when grouping(adset_key) = 0 then 'adSet'
      when grouping(ad_key) = 0 then 'ad'
      else 'creative'
    end as dimension,
    case
      when grouping(path_key) = 0 then path_key
      when grouping(source_key) = 0 then source_key
      when grouping(page_key) = 0 then page_key
      when grouping(channel_key) = 0 then channel_key
      when grouping(placement_key) = 0 then placement_key
      when grouping(country_key) = 0 then country_key
      when grouping(campaign_key) = 0 then campaign_key
      when grouping(adset_key) = 0 then adset_key
      when grouping(ad_key) = 0 then ad_key
      else creative_key
    end as key,
    case
      when grouping(path_key) = 0 then max(path_label)
      when grouping(source_key) = 0 then max(source_label)
      when grouping(page_key) = 0 then max(page_label)
      when grouping(channel_key) = 0 then max(channel_label)
      when grouping(placement_key) = 0 then max(placement_label)
      when grouping(country_key) = 0 then max(country_label)
      when grouping(campaign_key) = 0 then max(campaign_label)
      when grouping(adset_key) = 0 then max(adset_label)
      when grouping(ad_key) = 0 then max(ad_label)
      else max(creative_label)
    end as label,
    count(*) as total_leads,
    count(*) filter (where status = 'new') as new_leads,
    count(*) filter (where status = 'duplicate') as duplicate_leads,
    count(*) filter (where status = 'suspect') as suspect_leads,
    count(*) filter (where status = 'invalid') as invalid_leads,
    count(*) filter (where valid) as valid_leads,
    count(*) filter (where valid and paid_in_scope) as paid_valid_leads,
    count(*) filter (
      where valid and phone_verified and paid_in_scope
    ) as paid_verified_phone_leads,
    count(*) filter (where valid and verified) as verified_leads,
    count(*) filter (where has_email) as leads_with_email,
    count(*) filter (where has_phone) as leads_with_phone,
    count(*) filter (where email_verified) as email_verified_leads,
    count(*) filter (where phone_verified) as phone_verified_leads,
    count(*) filter (where measurement_consent) as measurement_consented_leads,
    count(*) filter (where meta_eligible) as capi_eligible_leads,
    count(*) filter (where meta_eligible and meta_capi_state = 'sent') as capi_sent_leads,
    count(*) filter (where meta_eligible and meta_capi_state = 'failed') as capi_failed_leads,
    count(*) filter (where meta_eligible and meta_capi_state = 'skipped') as capi_skipped_leads,
    coalesce(sum(meta_events_received) filter (where meta_eligible), 0) as meta_events_received
  from leads
  group by grouping sets (
    (path_key),
    (source_key),
    (page_key),
    (channel_key),
    (placement_key),
    (country_key),
    (campaign_key),
    (adset_key),
    (ad_key),
    (creative_key)
  )
  having grouping(placement_key) = 1 or placement_key is not null
),
lead_totals as (
  select
    count(*) as lead_rows,
    max(signed_up_at) as latest_lead_at,
    count(*) filter (
      where coalesce(
        nullif(btrim(publisher_platform), ''),
        nullif(btrim(utm_source), ''),
        nullif(btrim(utm_medium), ''),
        nullif(btrim(utm_campaign), ''),
        nullif(btrim(meta_campaign_id), ''),
        nullif(btrim(meta_adset_id), ''),
        nullif(btrim(meta_ad_id), '')
      ) is not null
    ) as attributed_lead_rows,
    count(*) filter (where status = 'new') as new_leads,
    count(*) filter (where status = 'duplicate') as duplicate_leads,
    count(*) filter (where status = 'suspect') as suspect_leads,
    count(*) filter (where status = 'invalid') as invalid_leads,
    count(*) filter (where valid) as valid_leads,
    count(*) filter (where valid and paid_in_scope) as paid_valid_leads,
    count(*) filter (
      where valid and phone_verified and paid_in_scope
    ) as paid_verified_phone_leads,
    count(*) filter (
      where valid and has_paid_signal and not paid_in_union_scope
    ) as unscoped_paid_valid_leads,
    count(*) filter (where valid and verified) as verified_leads,
    count(*) filter (where has_email) as leads_with_email,
    count(*) filter (where has_phone) as leads_with_phone,
    count(*) filter (where email_verified) as email_verified_leads,
    count(*) filter (where phone_verified) as phone_verified_leads,
    count(*) filter (where measurement_consent) as measurement_consented_leads,
    count(*) filter (where meta_eligible) as capi_eligible_leads,
    count(*) filter (where meta_eligible and meta_capi_state = 'sent') as capi_sent_leads,
    count(*) filter (where meta_eligible and meta_capi_state = 'failed') as capi_failed_leads,
    count(*) filter (where meta_eligible and meta_capi_state = 'skipped') as capi_skipped_leads,
    coalesce(sum(meta_events_received) filter (where meta_eligible), 0) as meta_events_received
  from leads
),
scoped_lead_totals as (
  select
    count(*) filter (
      where paid_in_union_scope and not paid_in_scope
    ) as path_campaign_mismatch_leads,
    count(*) filter (
      where valid and paid_in_union_scope and not paid_in_scope
    ) as path_campaign_mismatch_valid_leads,
    count(*) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and valid
    ) as website_valid_leads,
    count(*) filter (
      where paid_in_scope
        and acquisition_path = 'website'
        and valid
        and verified
    ) as website_verified_leads,
    count(*) filter (
      where paid_in_scope
        and acquisition_path = 'instant_form'
        and valid
    ) as instant_form_valid_leads,
    count(*) filter (
      where paid_in_scope
        and acquisition_path = 'instant_form'
        and valid
        and verified
    ) as instant_form_verified_leads
  from leads
),
meta_sync_state as materialized (
  select
    s.*,
    (
      s.status = 'ready'
      and s.generation = p_expected_meta_generation
      and s.range_from = p_from
      and s.range_to = p_to
      and s.campaign_ids @> coalesce(p_campaign_ids, '{}'::text[])
      and s.campaign_ids <@ coalesce(p_campaign_ids, '{}'::text[])
      and cardinality(s.campaign_ids) = cardinality(coalesce(p_campaign_ids, '{}'::text[]))
    ) as ready_for_expected_scope
  from public.meta_insights_sync_state s
  where s.account_id = p_account_id
  limit 1
),
meta_range as materialized (
  select r.*
  from public.meta_range_insights r
  where r.range_from = p_from
    and r.range_to = p_to
    and r.account_id = p_account_id
    and r.campaign_ids @> coalesce(p_campaign_ids, '{}'::text[])
    and r.campaign_ids <@ coalesce(p_campaign_ids, '{}'::text[])
    and cardinality(r.campaign_ids) = cardinality(coalesce(p_campaign_ids, '{}'::text[]))
    and r.sync_generation = p_expected_meta_generation
    and exists (
      select 1
      from meta_sync_state s
      where s.ready_for_expected_scope
    )
    and p_to >= p_from
    and p_to - p_from <= 89
  limit 1
),
meta_sync_guard as materialized (
  select
    p_expected_meta_generation as expected_generation,
    (select generation from meta_sync_state) as current_generation,
    (select status from meta_sync_state) as status,
    coalesce(
      (select ready_for_expected_scope from meta_sync_state),
      false
    ) as ready_for_expected_scope,
    exists (select 1 from meta_range) as exact_marker_current
),
meta_base as materialized (
  select
    m.*,
    lower(
      regexp_replace(
        coalesce(nullif(btrim(m.publisher_platform), ''), ''),
        '[[:space:]-]+',
        '_',
        'g'
      )
    ) as channel_raw,
    lower(
      regexp_replace(
        coalesce(nullif(btrim(m.platform_position), ''), 'unknown'),
        '[[:space:]-]+',
        '_',
        'g'
      )
    ) as placement_raw
  from public.meta_daily_insights m
  where m.insight_date >= p_from
    and m.insight_date <= p_to
    and m.account_id = p_account_id
    and m.campaign_id = any(coalesce(p_campaign_ids, '{}'::text[]))
    and m.sync_generation = p_expected_meta_generation
    and exists (
      select 1
      from meta_sync_state s
      where s.ready_for_expected_scope
    )
    and p_to >= p_from
    and p_to - p_from <= 89
),
meta as materialized (
  select
    m.*,
    case m.conversion_location
      when 'website' then 'website'
      when 'instant_form' then 'instant_form'
      else 'meta_unknown'
    end as path_key,
    case m.conversion_location
      when 'website' then 'Website'
      when 'instant_form' then 'Instant Form'
      else 'Meta / unknown conversion location'
    end as path_label,
    'meta:' || coalesce(nullif(btrim(m.publisher_platform), ''), 'meta') as source_key,
    'Meta · ' || coalesce(nullif(btrim(m.publisher_platform), ''), 'meta') as source_label,
    'unknown'::text as page_key,
    'Unknown page'::text as page_label,
    case m.channel_raw
      when '' then 'meta_unknown'
      when 'fb' then 'facebook'
      when 'ig' then 'instagram'
      when 'an' then 'audience_network'
      when 'msg' then 'messenger'
      else m.channel_raw
    end as channel_key,
    case m.channel_raw
      when '' then 'Meta / unknown'
      when 'fb' then 'facebook'
      when 'ig' then 'instagram'
      when 'an' then 'audience_network'
      when 'msg' then 'messenger'
      else m.channel_raw
    end as channel_label,
    m.conversion_location
      || '|'
      || placement_parts.platform_key
      || '/'
      || placement_parts.position_key
      as placement_key,
    case m.conversion_location
      when 'website' then 'Website'
      when 'instant_form' then 'Instant Form'
      else 'Meta / unknown conversion location'
    end
      || ' · '
      || initcap(replace(placement_parts.platform_key, '_', ' '))
      || ' / '
      || case placement_parts.position_key
        when 'reels' then 'Reels'
        when 'stories' then 'Stories'
        when 'feed' then 'Feed'
        else initcap(replace(placement_parts.position_key, '_', ' '))
      end
      as placement_label,
    coalesce(nullif(btrim(m.country), ''), 'unknown') as country_key,
    coalesce(nullif(btrim(m.country), ''), 'Unknown country') as country_label,
    m.campaign_id as campaign_key,
    coalesce(nullif(btrim(m.campaign_name), ''), m.campaign_id) as campaign_label,
    m.adset_id as adset_key,
    coalesce(nullif(btrim(m.adset_name), ''), m.adset_id) as adset_label,
    m.ad_id as ad_key,
    coalesce(nullif(btrim(m.ad_name), ''), m.ad_id) as ad_label,
    m.ad_id as creative_key,
    coalesce(nullif(btrim(m.ad_name), ''), m.ad_id) as creative_label
  from meta_base m
  cross join lateral (
    select
      case m.channel_raw
        when '' then 'meta_unknown'
        when 'fb' then 'facebook'
        when 'ig' then 'instagram'
        when 'an' then 'audience_network'
        when 'msg' then 'messenger'
        else m.channel_raw
      end as platform_key,
      case
        when m.placement_raw in (
          'reel',
          'reels',
          'instagram_reels',
          'facebook_reels'
        ) then 'reels'
        when m.placement_raw in (
          'story',
          'stories',
          'instagram_story',
          'instagram_stories',
          'facebook_story',
          'facebook_stories'
        ) then 'stories'
        when m.placement_raw in (
          'feed',
          'instagram_feed',
          'facebook_feed',
          'mobile_feed',
          'desktop_feed'
        ) or m.placement_raw like '%_feed' then 'feed'
        else regexp_replace(m.placement_raw, '^(instagram|facebook)_', '')
      end as position_key
  ) placement_parts
),
meta_metrics as (
  select
    case
      when grouping(path_key) = 0 then 'path'
      when grouping(source_key) = 0 then 'source'
      when grouping(page_key) = 0 then 'page'
      when grouping(channel_key) = 0 then 'channel'
      when grouping(placement_key) = 0 then 'placement'
      when grouping(country_key) = 0 then 'country'
      when grouping(campaign_key) = 0 then 'campaign'
      when grouping(adset_key) = 0 then 'adSet'
      when grouping(ad_key) = 0 then 'ad'
      else 'creative'
    end as dimension,
    case
      when grouping(path_key) = 0 then path_key
      when grouping(source_key) = 0 then source_key
      when grouping(page_key) = 0 then page_key
      when grouping(channel_key) = 0 then channel_key
      when grouping(placement_key) = 0 then placement_key
      when grouping(country_key) = 0 then country_key
      when grouping(campaign_key) = 0 then campaign_key
      when grouping(adset_key) = 0 then adset_key
      when grouping(ad_key) = 0 then ad_key
      else creative_key
    end as key,
    case
      when grouping(path_key) = 0 then max(path_label)
      when grouping(source_key) = 0 then max(source_label)
      when grouping(page_key) = 0 then max(page_label)
      when grouping(channel_key) = 0 then max(channel_label)
      when grouping(placement_key) = 0 then max(placement_label)
      when grouping(country_key) = 0 then max(country_label)
      when grouping(campaign_key) = 0 then max(campaign_label)
      when grouping(adset_key) = 0 then max(adset_label)
      when grouping(ad_key) = 0 then max(ad_label)
      else max(creative_label)
    end as label,
    coalesce(sum(spend_eur), 0) as spend_eur,
    coalesce(sum(impressions), 0) as impressions,
    coalesce(sum(link_clicks), 0) as link_clicks,
    coalesce(sum(landing_page_views), 0) as landing_page_views,
    coalesce(sum(website_leads), 0) as website_leads,
    coalesce(sum(website_contacts), 0) as website_contacts,
    coalesce(sum(instant_form_opens), 0) as instant_form_opens,
    coalesce(sum(instant_form_starts), 0) as instant_form_starts,
    coalesce(sum(instant_form_leads), 0) as instant_form_leads,
    coalesce(sum(video_3s), 0) as video_3s,
    coalesce(sum(video_thruplay), 0) as video_thruplay,
    coalesce(sum(video_25), 0) as video_25,
    coalesce(sum(video_50), 0) as video_50,
    coalesce(sum(video_75), 0) as video_75,
    coalesce(sum(video_95), 0) as video_95,
    coalesce(sum(video_100), 0) as video_100
  from meta
  group by grouping sets (
    (path_key),
    (source_key),
    (page_key),
    (channel_key),
    (placement_key),
    (country_key),
    (campaign_key),
    (adset_key),
    (ad_key),
    (creative_key)
  )
  having grouping(placement_key) = 1 or placement_key is not null
),
meta_totals as (
  select
    count(*) as meta_rows,
    coalesce(max(synced_at), (select synced_at from meta_range)) as latest_meta_sync,
    coalesce(sum(spend_eur), 0) as spend_eur,
    coalesce(sum(impressions), 0) as impressions,
    coalesce(sum(link_clicks), 0) as link_clicks,
    coalesce(sum(landing_page_views), 0) as landing_page_views,
    coalesce(sum(website_leads), 0) as website_leads,
    coalesce(sum(website_contacts), 0) as website_contacts,
    coalesce(sum(instant_form_opens), 0) as instant_form_opens,
    coalesce(sum(instant_form_starts), 0) as instant_form_starts,
    coalesce(sum(instant_form_leads), 0) as instant_form_leads,
    coalesce(sum(video_3s), 0) as video_3s,
    coalesce(sum(video_thruplay), 0) as video_thruplay,
    coalesce(sum(video_25), 0) as video_25,
    coalesce(sum(video_50), 0) as video_50,
    coalesce(sum(video_75), 0) as video_75,
    coalesce(sum(video_95), 0) as video_95,
    coalesce(sum(video_100), 0) as video_100,
    coalesce(sum(spend_eur) filter (where conversion_location = 'unknown'), 0)
      as unknown_conversion_spend,
    (select reach from meta_range) as exact_reach,
    (select frequency from meta_range) as exact_frequency,
    (select synced_at from meta_range) as exact_range_synced_at
  from meta
),
schema_versions as (
  select coalesce(jsonb_agg(version order by version), '[]'::jsonb) as value
  from (
    select schema_version as version from events
    union
    select schema_version as version from leads
  ) versions
)
select jsonb_build_object(
  'event_totals', (select to_jsonb(event_totals) from event_totals),
  'scoped_event_totals', (select to_jsonb(scoped_event_totals) from scoped_event_totals),
  'lead_totals', (select to_jsonb(lead_totals) from lead_totals),
  'scoped_lead_totals', (select to_jsonb(scoped_lead_totals) from scoped_lead_totals),
  'meta_sync', (select to_jsonb(meta_sync_guard) from meta_sync_guard),
  'meta_totals', (select to_jsonb(meta_totals) from meta_totals),
  'event_metrics', coalesce(
    (select jsonb_agg(to_jsonb(event_metrics) order by dimension, key) from event_metrics),
    '[]'::jsonb
  ),
  'lead_metrics', coalesce(
    (select jsonb_agg(to_jsonb(lead_metrics) order by dimension, key) from lead_metrics),
    '[]'::jsonb
  ),
  'meta_metrics', coalesce(
    (select jsonb_agg(to_jsonb(meta_metrics) order by dimension, key) from meta_metrics),
    '[]'::jsonb
  ),
  'schema_versions', (select value from schema_versions)
);
$$;

revoke all on function public.get_funnel_dashboard_aggregate_v1(
  timestamptz,
  timestamptz,
  date,
  date,
  text,
  text,
  bigint,
  text[],
  text[],
  text[]
) from public, anon, authenticated;
grant execute on function public.get_funnel_dashboard_aggregate_v1(
  timestamptz,
  timestamptz,
  date,
  date,
  text,
  text,
  bigint,
  text[],
  text[],
  text[]
) to service_role;

-- Replaces one complete requested account+campaign+date range and its
-- no-breakdown aggregate in a single PostgREST RPC transaction. Every row is
-- validated before the range delete, so a malformed row cannot leave a mixed
-- snapshot. An empty p_rows array intentionally clears the exact daily range.
create or replace function public.replace_meta_insights_range(
  p_account_id text,
  p_campaign_ids text[],
  p_from date,
  p_to date,
  p_rows jsonb,
  p_exact_impressions bigint,
  p_exact_reach bigint,
  p_exact_frequency numeric,
  p_exact_spend_eur numeric,
  p_exact_link_clicks bigint,
  p_generation bigint
)
returns integer
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_campaign_ids text[];
  v_inserted integer := 0;
  v_state_changed integer := 0;
  v_reserved_at timestamptz;
begin
  if p_account_id is null or p_account_id !~ '^[0-9]{5,30}$' then
    raise exception 'invalid Meta account scope' using errcode = '22023';
  end if;
  if p_campaign_ids is null or cardinality(p_campaign_ids) = 0 then
    raise exception 'Meta campaign scope cannot be empty' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_campaign_ids) as ids(campaign_id)
    where ids.campaign_id is null or ids.campaign_id !~ '^[0-9]{5,30}$'
  ) then
    raise exception 'invalid Meta campaign scope' using errcode = '22023';
  end if;
  if p_from is null
    or p_to is null
    or p_to < p_from
    or p_to - p_from > 89
  then
    raise exception 'invalid Meta insight range dates' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Meta insight rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 250000 then
    raise exception 'Meta insight range exceeds 250000 rows' using errcode = '22023';
  end if;
  if p_exact_impressions is null
    or p_exact_impressions < 0
    or p_exact_reach is null
    or p_exact_reach < 0
    or p_exact_frequency is null
    or p_exact_frequency < 0
    or p_exact_spend_eur is null
    or p_exact_spend_eur < 0
    or p_exact_link_clicks is null
    or p_exact_link_clicks < 0
    or p_generation is null
    or p_generation <= 0
  then
    raise exception 'invalid Meta exact-range values' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0
    and (
      p_exact_impressions <> 0
      or p_exact_reach <> 0
      or p_exact_frequency <> 0
      or p_exact_spend_eur <> 0
      or p_exact_link_clicks <> 0
    )
  then
    -- All daily additive counters (LPV, lead/contact, Instant Form and
    -- video metrics included) are necessarily zero when the complete daily
    -- rowset is empty. A nonzero exact marker would make those zeroes look
    -- authoritative while retaining spend or delivery from another result.
    raise exception 'empty Meta daily range conflicts with nonzero exact-range metrics'
      using errcode = '22023';
  end if;

  select array_agg(distinct campaign_id order by campaign_id)
  into v_campaign_ids
  from unnest(p_campaign_ids) as ids(campaign_id);

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item(value)
    where jsonb_typeof(item.value) <> 'object'
  ) then
    raise exception 'every Meta insight row must be an object' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item(value)
    cross join lateral jsonb_object_keys(item.value) as field(name)
    where field.name not in (
      'insight_date',
      'account_id',
      'campaign_id',
      'campaign_name',
      'adset_id',
      'adset_name',
      'ad_id',
      'ad_name',
      'country',
      'publisher_platform',
      'platform_position',
      'conversion_location',
      'impressions',
      'reach',
      'spend_eur',
      'link_clicks',
      'landing_page_views',
      'website_leads',
      'website_contacts',
      'instant_form_leads',
      'instant_form_opens',
      'instant_form_starts',
      'video_3s',
      'video_thruplay',
      'video_25',
      'video_50',
      'video_75',
      'video_95',
      'video_100',
      'raw_actions',
      'sync_generation',
      'synced_at'
    )
  ) then
    raise exception 'Meta insight row contains an unsupported field' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_populate_recordset(null::public.meta_daily_insights, p_rows) as parsed
    where parsed.account_id is distinct from p_account_id
      or parsed.campaign_id is null
      or parsed.campaign_id <> all(v_campaign_ids)
      or parsed.insight_date is null
      or parsed.insight_date < p_from
      or parsed.insight_date > p_to
      or parsed.adset_id is null
      or btrim(parsed.adset_id) = ''
      or parsed.ad_id is null
      or btrim(parsed.ad_id) = ''
      or parsed.country is null
      or parsed.publisher_platform is null
      or parsed.platform_position is null
      or parsed.conversion_location is null
      or parsed.conversion_location not in ('website', 'instant_form', 'unknown')
      or parsed.impressions is null
      or parsed.impressions < 0
      or parsed.reach is null
      or parsed.reach < 0
      or parsed.spend_eur is null
      or parsed.spend_eur < 0
      or parsed.link_clicks is null
      or parsed.link_clicks < 0
      or parsed.landing_page_views is null
      or parsed.landing_page_views < 0
      or parsed.website_leads is null
      or parsed.website_leads < 0
      or parsed.website_contacts is null
      or parsed.website_contacts < 0
      or parsed.instant_form_leads is null
      or parsed.instant_form_leads < 0
      or parsed.instant_form_opens is null
      or parsed.instant_form_opens < 0
      or parsed.instant_form_starts is null
      or parsed.instant_form_starts < 0
      or parsed.video_3s is null
      or parsed.video_3s < 0
      or parsed.video_thruplay is null
      or parsed.video_thruplay < 0
      or parsed.video_25 is null
      or parsed.video_25 < 0
      or parsed.video_50 is null
      or parsed.video_50 < 0
      or parsed.video_75 is null
      or parsed.video_75 < 0
      or parsed.video_95 is null
      or parsed.video_95 < 0
      or parsed.video_100 is null
      or parsed.video_100 < 0
      or parsed.raw_actions is null
      or jsonb_typeof(parsed.raw_actions) <> 'array'
      or parsed.sync_generation is distinct from p_generation
      or parsed.synced_at is null
  ) then
    raise exception 'Meta insight row failed range scope or value validation'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_populate_recordset(null::public.meta_daily_insights, p_rows) as parsed
    group by parsed.account_id, parsed.campaign_id, parsed.insight_date
    having count(*) > 10000
  ) then
    raise exception 'Meta insight range contains a slice over 10000 rows'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_populate_recordset(null::public.meta_daily_insights, p_rows) as parsed
    group by
      parsed.insight_date,
      parsed.account_id,
      parsed.campaign_id,
      parsed.adset_id,
      parsed.ad_id,
      parsed.country,
      parsed.publisher_platform,
      parsed.platform_position
    having count(*) > 1
  ) then
    raise exception 'Meta insight range contains duplicate rows' using errcode = '22023';
  end if;

  -- Serialize every range mutation for the same account. Without this lock,
  -- overlapping refreshes can both delete an old snapshot and then merge
  -- disjoint newly inserted breakdown rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('watchdive:meta-insights:' || p_account_id, 0)
  );

  select s.reserved_at
  into v_reserved_at
  from public.meta_insights_sync_state s
  where s.account_id = p_account_id
    and s.generation = p_generation
    and s.status = 'syncing'
    and s.range_from = p_from
    and s.range_to = p_to
    and s.campaign_ids @> v_campaign_ids
    and s.campaign_ids <@ v_campaign_ids
    and cardinality(s.campaign_ids) = cardinality(v_campaign_ids);

  if not found then
    raise exception 'Meta sync generation is not the current reservation'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_populate_recordset(null::public.meta_daily_insights, p_rows) as parsed
    where parsed.synced_at is distinct from v_reserved_at
  ) then
    raise exception 'Meta insight rows do not match the reserved sync time'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.meta_daily_insights current_row
    where current_row.account_id = p_account_id
      and current_row.campaign_id = any(v_campaign_ids)
      and current_row.insight_date between p_from and p_to
      and current_row.sync_generation > p_generation
  ) or exists (
    select 1
    from public.meta_range_insights current_range
    where current_range.account_id = p_account_id
      and current_range.range_from <= p_to
      and current_range.range_to >= p_from
      and current_range.campaign_ids && v_campaign_ids
      and current_range.sync_generation > p_generation
  ) then
    raise exception 'stale Meta insight range cannot overwrite a newer snapshot'
      using errcode = '40001';
  end if;

  delete from public.meta_daily_insights
  where account_id = p_account_id
    and campaign_id = any(v_campaign_ids)
    and insight_date between p_from and p_to;

  insert into public.meta_daily_insights (
    insight_date,
    account_id,
    campaign_id,
    campaign_name,
    adset_id,
    adset_name,
    ad_id,
    ad_name,
    country,
    publisher_platform,
    platform_position,
    conversion_location,
    impressions,
    reach,
    spend_eur,
    link_clicks,
    landing_page_views,
    website_leads,
    website_contacts,
    instant_form_leads,
    instant_form_opens,
    instant_form_starts,
    video_3s,
    video_thruplay,
    video_25,
    video_50,
    video_75,
    video_95,
    video_100,
    raw_actions,
    sync_generation,
    synced_at
  )
  select
    parsed.insight_date,
    parsed.account_id,
    parsed.campaign_id,
    parsed.campaign_name,
    parsed.adset_id,
    parsed.adset_name,
    parsed.ad_id,
    parsed.ad_name,
    parsed.country,
    parsed.publisher_platform,
    parsed.platform_position,
    parsed.conversion_location,
    parsed.impressions,
    parsed.reach,
    parsed.spend_eur,
    parsed.link_clicks,
    parsed.landing_page_views,
    parsed.website_leads,
    parsed.website_contacts,
    parsed.instant_form_leads,
    parsed.instant_form_opens,
    parsed.instant_form_starts,
    parsed.video_3s,
    parsed.video_thruplay,
    parsed.video_25,
    parsed.video_50,
    parsed.video_75,
    parsed.video_95,
    parsed.video_100,
    parsed.raw_actions,
    parsed.sync_generation,
    parsed.synced_at
  from jsonb_populate_recordset(null::public.meta_daily_insights, p_rows) as parsed;

  get diagnostics v_inserted = row_count;

  insert into public.meta_range_insights (
    range_from,
    range_to,
    account_id,
    campaign_ids,
    impressions,
    reach,
    frequency,
    spend_eur,
    link_clicks,
    sync_generation,
    synced_at
  )
  values (
    p_from,
    p_to,
    p_account_id,
    v_campaign_ids,
    p_exact_impressions,
    p_exact_reach,
    p_exact_frequency,
    p_exact_spend_eur,
    p_exact_link_clicks,
    p_generation,
    v_reserved_at
  )
  on conflict (range_from, range_to, account_id, campaign_ids)
  do update set
    impressions = excluded.impressions,
    reach = excluded.reach,
    frequency = excluded.frequency,
    spend_eur = excluded.spend_eur,
    link_clicks = excluded.link_clicks,
    sync_generation = excluded.sync_generation,
    synced_at = excluded.synced_at;

  update public.meta_insights_sync_state
  set
    status = 'ready',
    completed_at = pg_catalog.clock_timestamp()
  where account_id = p_account_id
    and generation = p_generation
    and status = 'syncing';

  get diagnostics v_state_changed = row_count;
  if v_state_changed <> 1 then
    raise exception 'Meta sync reservation changed before commit'
      using errcode = '40001';
  end if;

  return v_inserted;
end;
$$;

revoke all on function public.replace_meta_insights_range(
  text,
  text[],
  date,
  date,
  jsonb,
  bigint,
  bigint,
  numeric,
  numeric,
  bigint,
  bigint
) from public, anon, authenticated;
grant execute on function public.replace_meta_insights_range(
  text,
  text[],
  date,
  date,
  jsonb,
  bigint,
  bigint,
  numeric,
  numeric,
  bigint,
  bigint
) to service_role;

-- Atomically consumes one attempt from a fixed-window signup bucket. An
-- INSERT ... ON CONFLICT with a guarded UPDATE makes the threshold safe under
-- concurrent serverless requests; no read-then-write race can exceed p_limit.
create or replace function public.consume_signup_rate_limit_v1(
  p_bucket_hash text,
  p_environment text,
  p_window_started_at timestamptz,
  p_expires_at timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_consumed boolean := false;
begin
  if p_bucket_hash is null or p_bucket_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid signup rate-limit bucket'
      using errcode = '22023';
  end if;
  if p_environment is null
    or p_environment not in ('production', 'preview', 'development') then
    raise exception 'invalid signup rate-limit environment'
      using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 10 or p_limit > 1000 then
    raise exception 'invalid signup rate-limit threshold'
      using errcode = '22023';
  end if;
  if p_window_started_at is null
    or p_expires_at is null
    or p_expires_at <= p_window_started_at
    or p_expires_at > p_window_started_at + interval '2 hours'
    or p_window_started_at < now() - interval '2 hours'
    or p_window_started_at > now() + interval '5 minutes'
    or p_expires_at < now() - interval '5 minutes' then
    raise exception 'invalid signup rate-limit window'
      using errcode = '22023';
  end if;

  insert into public.signup_rate_limit_buckets (
    bucket_hash,
    environment,
    window_started_at,
    expires_at,
    attempts,
    updated_at
  )
  values (
    p_bucket_hash,
    p_environment,
    p_window_started_at,
    p_expires_at,
    1,
    now()
  )
  on conflict (bucket_hash) do update
  set
    attempts = public.signup_rate_limit_buckets.attempts + 1,
    updated_at = now()
  where public.signup_rate_limit_buckets.environment = excluded.environment
    and public.signup_rate_limit_buckets.window_started_at = excluded.window_started_at
    and public.signup_rate_limit_buckets.expires_at = excluded.expires_at
    and public.signup_rate_limit_buckets.attempts < p_limit
  returning true into v_consumed;

  -- Keep cleanup bounded so abuse protection cannot turn into an unbounded
  -- table scan. The indexed expiry predicate makes this cheap at normal scale.
  delete from public.signup_rate_limit_buckets
  where bucket_hash in (
    select stale.bucket_hash
    from public.signup_rate_limit_buckets as stale
    where stale.expires_at < now() - interval '1 day'
    order by stale.expires_at
    limit 100
  );

  return coalesce(v_consumed, false);
end;
$$;

revoke all on function public.consume_signup_rate_limit_v1(
  text,
  text,
  timestamptz,
  timestamptz,
  integer
) from public, anon, authenticated;
grant execute on function public.consume_signup_rate_limit_v1(
  text,
  text,
  timestamptz,
  timestamptz,
  integer
) to service_role;
