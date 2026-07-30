-- A short lease makes Meta Instant Form CRM creation single-owner across
-- concurrent server replicas. This table stores operational identifiers and
-- outcome state only; submitted form fields are never persisted here.
create table if not exists public.meta_lead_ingestion_state (
  environment text not null
    check (environment in ('production', 'preview', 'development')),
  platform_lead_id text not null
    check (platform_lead_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  generation bigint not null
    check (generation > 0),
  status text not null
    check (status in ('processing', 'complete', 'failed')),
  outcome text
    check (outcome in ('new', 'duplicate', 'suspect', 'invalid')),
  notion_page_id text
    check (
      notion_page_id is null
      or notion_page_id ~ '^[A-Za-z0-9-]{1,128}$'
    ),
  reserved_at timestamptz not null,
  completed_at timestamptz,
  primary key (environment, platform_lead_id),
  check (
    (
      status = 'complete'
      and outcome is not null
      and completed_at is not null
    )
    or (
      status <> 'complete'
      and outcome is null
      and notion_page_id is null
      and completed_at is null
    )
  )
);

alter table public.meta_lead_ingestion_state enable row level security;
revoke all on public.meta_lead_ingestion_state from public, anon, authenticated;
grant select, insert, update on public.meta_lead_ingestion_state to service_role;

create or replace function public.reserve_meta_lead_ingestion_v1(
  p_environment text,
  p_platform_lead_id text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_generation bigint;
  v_status text;
  v_outcome text;
  v_notion_page_id text;
  v_reserved_at timestamptz;
  v_now timestamptz;
begin
  if p_environment is null
    or p_environment not in ('production', 'preview', 'development')
  then
    raise exception 'invalid Meta lead ingestion environment' using errcode = '22023';
  end if;
  if p_platform_lead_id is null
    or p_platform_lead_id !~ '^[A-Za-z0-9._:-]{1,128}$'
  then
    raise exception 'invalid Meta platform lead id' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'watchdive:meta-lead-ingestion:' || p_environment || ':' || p_platform_lead_id,
      0
    )
  );
  v_now := pg_catalog.clock_timestamp();

  select
    generation,
    status,
    outcome,
    notion_page_id,
    reserved_at
  into
    v_generation,
    v_status,
    v_outcome,
    v_notion_page_id,
    v_reserved_at
  from public.meta_lead_ingestion_state
  where environment = p_environment
    and platform_lead_id = p_platform_lead_id;

  if found and v_status = 'complete' then
    return jsonb_build_object(
      'state', 'complete',
      'generation', v_generation,
      'outcome', v_outcome,
      'notion_page_id', v_notion_page_id
    );
  end if;

  if found
    and v_status = 'processing'
    and v_reserved_at >= v_now - interval '5 minutes'
    and v_reserved_at <= v_now + interval '1 minute'
  then
    return jsonb_build_object(
      'state', 'in_progress',
      'generation', v_generation
    );
  end if;

  insert into public.meta_lead_ingestion_state (
    environment,
    platform_lead_id,
    generation,
    status,
    outcome,
    notion_page_id,
    reserved_at,
    completed_at
  )
  values (
    p_environment,
    p_platform_lead_id,
    1,
    'processing',
    null,
    null,
    v_now,
    null
  )
  on conflict (environment, platform_lead_id)
  do update set
    generation = public.meta_lead_ingestion_state.generation + 1,
    status = 'processing',
    outcome = null,
    notion_page_id = null,
    reserved_at = excluded.reserved_at,
    completed_at = null
  returning generation into v_generation;

  return jsonb_build_object(
    'state', 'reserved',
    'generation', v_generation
  );
end;
$$;

create or replace function public.complete_meta_lead_ingestion_v1(
  p_environment text,
  p_platform_lead_id text,
  p_generation bigint,
  p_outcome text,
  p_notion_page_id text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_changed integer := 0;
  v_already_complete boolean := false;
begin
  if p_environment is null
    or p_environment not in ('production', 'preview', 'development')
  then
    raise exception 'invalid Meta lead ingestion environment' using errcode = '22023';
  end if;
  if p_platform_lead_id is null
    or p_platform_lead_id !~ '^[A-Za-z0-9._:-]{1,128}$'
  then
    raise exception 'invalid Meta platform lead id' using errcode = '22023';
  end if;
  if p_generation is null or p_generation <= 0 then
    raise exception 'invalid Meta lead ingestion generation' using errcode = '22023';
  end if;
  if p_outcome is null
    or p_outcome not in ('new', 'duplicate', 'suspect', 'invalid')
  then
    raise exception 'invalid Meta lead ingestion outcome' using errcode = '22023';
  end if;
  if p_notion_page_id is not null
    and p_notion_page_id !~ '^[A-Za-z0-9-]{1,128}$'
  then
    raise exception 'invalid Notion page id' using errcode = '22023';
  end if;
  if p_outcome = 'invalid' and p_notion_page_id is not null then
    raise exception 'invalid leads cannot reference a CRM row' using errcode = '22023';
  end if;
  if p_outcome <> 'invalid' and p_notion_page_id is null then
    raise exception 'completed CRM lead requires a page id' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'watchdive:meta-lead-ingestion:' || p_environment || ':' || p_platform_lead_id,
      0
    )
  );

  update public.meta_lead_ingestion_state
  set
    status = 'complete',
    outcome = p_outcome,
    notion_page_id = p_notion_page_id,
    completed_at = pg_catalog.clock_timestamp()
  where environment = p_environment
    and platform_lead_id = p_platform_lead_id
    and generation = p_generation
    and status = 'processing';

  get diagnostics v_changed = row_count;
  if v_changed = 1 then
    return true;
  end if;

  select true
  into v_already_complete
  from public.meta_lead_ingestion_state
  where environment = p_environment
    and platform_lead_id = p_platform_lead_id
    and generation = p_generation
    and status = 'complete'
    and outcome = p_outcome
    and notion_page_id is not distinct from p_notion_page_id;

  return coalesce(v_already_complete, false);
end;
$$;

create or replace function public.fail_meta_lead_ingestion_v1(
  p_environment text,
  p_platform_lead_id text,
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
  v_already_failed boolean := false;
begin
  if p_environment is null
    or p_environment not in ('production', 'preview', 'development')
  then
    raise exception 'invalid Meta lead ingestion environment' using errcode = '22023';
  end if;
  if p_platform_lead_id is null
    or p_platform_lead_id !~ '^[A-Za-z0-9._:-]{1,128}$'
  then
    raise exception 'invalid Meta platform lead id' using errcode = '22023';
  end if;
  if p_generation is null or p_generation <= 0 then
    raise exception 'invalid Meta lead ingestion generation' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'watchdive:meta-lead-ingestion:' || p_environment || ':' || p_platform_lead_id,
      0
    )
  );

  update public.meta_lead_ingestion_state
  set status = 'failed'
  where environment = p_environment
    and platform_lead_id = p_platform_lead_id
    and generation = p_generation
    and status = 'processing';

  get diagnostics v_changed = row_count;
  if v_changed = 1 then
    return true;
  end if;

  select true
  into v_already_failed
  from public.meta_lead_ingestion_state
  where environment = p_environment
    and platform_lead_id = p_platform_lead_id
    and generation = p_generation
    and status = 'failed';

  return coalesce(v_already_failed, false);
end;
$$;

revoke all on function public.reserve_meta_lead_ingestion_v1(
  text,
  text
) from public, anon, authenticated;
grant execute on function public.reserve_meta_lead_ingestion_v1(
  text,
  text
) to service_role;

revoke all on function public.complete_meta_lead_ingestion_v1(
  text,
  text,
  bigint,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.complete_meta_lead_ingestion_v1(
  text,
  text,
  bigint,
  text,
  text
) to service_role;

revoke all on function public.fail_meta_lead_ingestion_v1(
  text,
  text,
  bigint
) from public, anon, authenticated;
grant execute on function public.fail_meta_lead_ingestion_v1(
  text,
  text,
  bigint
) to service_role;
