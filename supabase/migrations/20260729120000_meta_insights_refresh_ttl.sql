-- Keep dashboard polling inexpensive without weakening the exact Meta scope.
-- This is deliberately versioned instead of replacing reserve_meta_insights_sync:
-- apply this migration before deploying callers of v2. Older app instances
-- keep their original reservation contract during a rolling deployment, while
-- newer instances fail closed if this migration has not been applied.
create or replace function public.reserve_meta_insights_sync_v2(
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
  v_now timestamptz;
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
  v_now := pg_catalog.clock_timestamp();

  -- Reuse only a completed generation whose exact-range marker matches every
  -- part of the requested account, campaign and date scope. Empty daily data
  -- remains valid because the exact marker is authoritative for the range.
  select s.generation, r.synced_at
  into v_generation, v_reserved_at
  from public.meta_insights_sync_state s
  join public.meta_range_insights r
    on r.account_id = s.account_id
    and r.range_from = s.range_from
    and r.range_to = s.range_to
    and r.sync_generation = s.generation
    and r.campaign_ids @> s.campaign_ids
    and r.campaign_ids <@ s.campaign_ids
    and cardinality(r.campaign_ids) = cardinality(s.campaign_ids)
  where s.account_id = p_account_id
    and s.status = 'ready'
    and s.range_from = p_from
    and s.range_to = p_to
    and s.campaign_ids @> v_campaign_ids
    and s.campaign_ids <@ v_campaign_ids
    and cardinality(s.campaign_ids) = cardinality(v_campaign_ids)
    and s.completed_at is not null
    and s.completed_at >= v_now - interval '10 minutes'
    and s.completed_at <= v_now + interval '1 minute'
    and r.synced_at >= v_now - interval '10 minutes'
    and r.synced_at <= v_now + interval '1 minute'
  limit 1;

  if found then
    return jsonb_build_object(
      'generation', v_generation,
      'reserved_at', v_reserved_at,
      'state', 'ready'
    );
  end if;

  -- A generation is account-wide, so any recent account reservation blocks a
  -- second Graph request, even when the second request asks for another range.
  -- Otherwise that request could steal the generation before the first writer
  -- commits. A bounded lease still recovers from a dead owner.
  select s.generation, s.reserved_at
  into v_generation, v_reserved_at
  from public.meta_insights_sync_state s
  where s.account_id = p_account_id
    and s.status = 'syncing'
    and s.reserved_at >= v_now - interval '5 minutes'
    and s.reserved_at <= v_now + interval '1 minute'
  limit 1;

  if found then
    return jsonb_build_object(
      'generation', v_generation,
      'reserved_at', v_reserved_at,
      'state', 'in_progress'
    );
  end if;

  v_reserved_at := v_now;
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
    'reserved_at', v_reserved_at,
    'state', 'reserved'
  );
end;
$$;

revoke all on function public.reserve_meta_insights_sync_v2(
  text,
  text[],
  date,
  date
) from public, anon, authenticated;
grant execute on function public.reserve_meta_insights_sync_v2(
  text,
  text[],
  date,
  date
) to service_role;
