-- StudentOS multi-provider routing operation ledger.
-- Apply to all three StudentOS data shards only. Never apply to the Auth project.
-- The existing reserve/settle RPCs remain available for immediate feature rollback.

begin;

alter table public.ai_usage_ledger
  add column if not exists request_fingerprint text,
  add column if not exists routing_status text,
  add column if not exists routing_ordinal integer,
  add column if not exists routing_lease_expires_at timestamptz,
  add column if not exists routing_primary_provider text,
  add column if not exists routing_final_provider text,
  add column if not exists routing_attempts_json jsonb not null default '[]'::jsonb,
  add column if not exists outcome_json jsonb;

alter table public.ai_usage_ledger
  drop constraint if exists ai_usage_ledger_routing_status_check;
alter table public.ai_usage_ledger
  add constraint ai_usage_ledger_routing_status_check
  check (routing_status is null or routing_status in ('running', 'succeeded', 'failed', 'blocked'));

alter table public.ai_usage_ledger
  drop constraint if exists ai_usage_ledger_routing_ordinal_check;
alter table public.ai_usage_ledger
  add constraint ai_usage_ledger_routing_ordinal_check
  check (routing_ordinal is null or routing_ordinal > 0);

alter table public.ai_usage_ledger
  drop constraint if exists ai_usage_ledger_routing_provider_check;
alter table public.ai_usage_ledger
  add constraint ai_usage_ledger_routing_provider_check
  check (
    (routing_primary_provider is null or routing_primary_provider in ('groq', 'gemini', 'pollinations'))
    and (routing_final_provider is null or routing_final_provider in ('groq', 'gemini', 'pollinations'))
  );

create unique index if not exists ai_usage_ledger_one_running_operation_idx
  on public.ai_usage_ledger (user_id, period_key)
  where routing_status = 'running';

create index if not exists ai_usage_ledger_routing_replay_idx
  on public.ai_usage_ledger (user_id, request_id, request_fingerprint, routing_status);

create or replace function public.begin_routed_ai_operation(
  p_user_id uuid,
  p_plan_tier text,
  p_period_key text,
  p_allowance integer,
  p_action_type text,
  p_credit_cost integer,
  p_request_id text,
  p_request_fingerprint text,
  p_lease_ms integer,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  allowed boolean,
  busy boolean,
  same_operation boolean,
  replay boolean,
  allowance integer,
  used integer,
  remaining integer,
  entry_id text,
  entry_status text,
  routing_status text,
  successful_count integer,
  selected_ordinal integer,
  lease_expires_at timestamptz,
  outcome jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.ai_usage_ledger%rowtype;
  v_running public.ai_usage_ledger%rowtype;
  v_used integer := 0;
  v_successful_count integer := 0;
  v_id text := gen_random_uuid()::text;
  v_lease interval;
begin
  if p_plan_tier not in ('trial', 'starter', 'essential', 'plus', 'pro') then
    raise exception 'unknown_plan_tier';
  end if;
  if p_allowance < 0
    or p_credit_cost < 0
    or coalesce(p_period_key, '') = ''
    or coalesce(p_request_id, '') = ''
    or coalesce(p_request_fingerprint, '') = ''
    or p_lease_ms < 1000
  then
    raise exception 'invalid_routed_ai_operation';
  end if;

  v_lease := make_interval(secs => least(p_lease_ms, 900000)::double precision / 1000.0);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_period_key, 0));

  update public.ai_usage_ledger ledger
  set status = case when ledger.status = 'reserved' then 'refunded' else ledger.status end,
      routing_status = 'failed',
      routing_lease_expires_at = null,
      routing_attempts_json = coalesce(ledger.routing_attempts_json, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('outcome', 'lease_expired')),
      updated_at = now()
  where ledger.user_id = p_user_id
    and ledger.period_key = p_period_key
    and ledger.routing_status = 'running'
    and ledger.routing_lease_expires_at <= now();

  select * into v_existing
  from public.ai_usage_ledger ledger
  where ledger.user_id = p_user_id and ledger.request_id = p_request_id
  limit 1;

  if v_existing.id is not null
    and coalesce(v_existing.request_fingerprint, '') <> p_request_fingerprint
  then
    raise exception 'idempotency_key_reused_with_different_request';
  end if;

  select coalesce(sum(ledger.credit_cost), 0)::integer into v_used
  from public.ai_usage_ledger ledger
  where ledger.user_id = p_user_id
    and ledger.period_key = p_period_key
    and ledger.status in ('reserved', 'charged');

  select count(*)::integer into v_successful_count
  from public.ai_usage_ledger ledger
  where ledger.user_id = p_user_id
    and ledger.period_key = p_period_key
    and ledger.status = 'charged';

  if v_existing.id is not null and v_existing.routing_status = 'succeeded' and v_existing.status = 'charged' then
    return query select true, false, true, true, p_allowance, v_used,
      greatest(p_allowance - v_used, 0), v_existing.id, v_existing.status,
      v_existing.routing_status, v_successful_count, v_existing.routing_ordinal,
      null::timestamptz, v_existing.outcome_json;
    return;
  end if;

  if v_existing.id is not null
    and v_existing.routing_status = 'failed'
    and v_existing.status = 'refunded'
    and v_existing.outcome_json is not null
  then
    return query select true, false, true, true, p_allowance, v_used,
      greatest(p_allowance - v_used, 0), v_existing.id, v_existing.status,
      v_existing.routing_status, v_successful_count, v_existing.routing_ordinal,
      null::timestamptz, v_existing.outcome_json;
    return;
  end if;

  if v_existing.id is not null and v_existing.routing_status = 'running' then
    return query select true, true, true, false, p_allowance, v_used,
      greatest(p_allowance - v_used, 0), v_existing.id, v_existing.status,
      v_existing.routing_status, v_successful_count, v_existing.routing_ordinal,
      v_existing.routing_lease_expires_at, null::jsonb;
    return;
  end if;

  if v_existing.id is not null and v_existing.status = 'blocked' then
    return query select false, false, true, true, p_allowance, v_used,
      greatest(p_allowance - v_used, 0), v_existing.id, v_existing.status,
      coalesce(v_existing.routing_status, 'blocked'), v_successful_count,
      v_existing.routing_ordinal, null::timestamptz, null::jsonb;
    return;
  end if;

  select * into v_running
  from public.ai_usage_ledger ledger
  where ledger.user_id = p_user_id
    and ledger.period_key = p_period_key
    and ledger.routing_status = 'running'
  limit 1;

  if v_running.id is not null then
    return query select false, true, false, false, p_allowance, v_used,
      greatest(p_allowance - v_used, 0), v_running.id, v_running.status,
      v_running.routing_status, v_successful_count, null::integer,
      v_running.routing_lease_expires_at, null::jsonb;
    return;
  end if;

  if p_credit_cost > greatest(p_allowance - v_used, 0) then
    if v_existing.id is null then
      insert into public.ai_usage_ledger (
        id, user_id, plan_tier, period_key, action_type, credit_cost, status,
        request_id, request_fingerprint, routing_status, metadata_json
      ) values (
        v_id, p_user_id, p_plan_tier, p_period_key, p_action_type, p_credit_cost,
        'blocked', p_request_id, p_request_fingerprint, 'blocked', coalesce(p_metadata, '{}'::jsonb)
      ) returning * into v_existing;
    else
      update public.ai_usage_ledger ledger
      set status = 'blocked', routing_status = 'blocked', updated_at = now()
      where ledger.id = v_existing.id
      returning * into v_existing;
    end if;
    return query select false, false, true, false, p_allowance, v_used,
      greatest(p_allowance - v_used, 0), v_existing.id, v_existing.status,
      v_existing.routing_status, v_successful_count, null::integer,
      null::timestamptz, null::jsonb;
    return;
  end if;

  if v_existing.id is null then
    insert into public.ai_usage_ledger (
      id, user_id, plan_tier, period_key, action_type, credit_cost, status,
      request_id, request_fingerprint, routing_status, routing_ordinal,
      routing_lease_expires_at, metadata_json, routing_attempts_json, outcome_json
    ) values (
      v_id, p_user_id, p_plan_tier, p_period_key, p_action_type, p_credit_cost,
      'reserved', p_request_id, p_request_fingerprint, 'running', v_successful_count + 1,
      now() + v_lease, coalesce(p_metadata, '{}'::jsonb), '[]'::jsonb, null
    ) returning * into v_existing;
  else
    update public.ai_usage_ledger ledger
    set plan_tier = p_plan_tier,
        action_type = p_action_type,
        credit_cost = p_credit_cost,
        status = 'reserved',
        routing_status = 'running',
        routing_ordinal = v_successful_count + 1,
        routing_lease_expires_at = now() + v_lease,
        routing_primary_provider = null,
        routing_final_provider = null,
        routing_attempts_json = '[]'::jsonb,
        outcome_json = null,
        metadata_json = coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where ledger.id = v_existing.id
    returning * into v_existing;
  end if;

  v_used := v_used + p_credit_cost;
  return query select true, false, true, false, p_allowance, v_used,
    greatest(p_allowance - v_used, 0), v_existing.id, v_existing.status,
    v_existing.routing_status, v_successful_count, v_existing.routing_ordinal,
    v_existing.routing_lease_expires_at, null::jsonb;
end;
$$;

create or replace function public.complete_routed_ai_operation(
  p_user_id uuid,
  p_request_id text,
  p_succeeded boolean,
  p_primary_provider text default null,
  p_final_provider text default null,
  p_attempts jsonb default '[]'::jsonb,
  p_outcome jsonb default null
)
returns table (
  entry_id text,
  entry_status text,
  routing_status text,
  period_key text,
  credit_cost integer,
  used integer,
  successful_count integer,
  changed boolean,
  outcome jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.ai_usage_ledger%rowtype;
  v_used integer := 0;
  v_successful_count integer := 0;
  v_changed boolean := false;
begin
  if p_primary_provider is not null and p_primary_provider not in ('groq', 'gemini', 'pollinations') then
    raise exception 'invalid_routing_primary_provider';
  end if;
  if p_final_provider is not null and p_final_provider not in ('groq', 'gemini', 'pollinations') then
    raise exception 'invalid_routing_final_provider';
  end if;
  if jsonb_typeof(coalesce(p_attempts, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_routing_attempts';
  end if;
  if p_outcome is not null and octet_length(p_outcome::text) > 131072 then
    raise exception 'routed_ai_outcome_too_large';
  end if;

  select * into v_entry
  from public.ai_usage_ledger ledger
  where ledger.user_id = p_user_id and ledger.request_id = p_request_id
  limit 1;

  if v_entry.id is null then return; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_entry.period_key, 0));

  update public.ai_usage_ledger ledger
  set status = case when p_succeeded then 'charged' else 'refunded' end,
      routing_status = case when p_succeeded then 'succeeded' else 'failed' end,
      routing_lease_expires_at = null,
      routing_primary_provider = p_primary_provider,
      routing_final_provider = case when p_succeeded then p_final_provider else null end,
      routing_attempts_json = coalesce(p_attempts, '[]'::jsonb),
      outcome_json = p_outcome,
      updated_at = now()
  where ledger.id = v_entry.id
    and ledger.status = 'reserved'
    and ledger.routing_status = 'running'
  returning * into v_entry;

  if found then
    v_changed := true;
  else
    select * into v_entry
    from public.ai_usage_ledger ledger
    where ledger.user_id = p_user_id and ledger.request_id = p_request_id
    limit 1;
  end if;

  select coalesce(sum(ledger.credit_cost), 0)::integer into v_used
  from public.ai_usage_ledger ledger
  where ledger.user_id = p_user_id
    and ledger.period_key = v_entry.period_key
    and ledger.status in ('reserved', 'charged');

  select count(*)::integer into v_successful_count
  from public.ai_usage_ledger ledger
  where ledger.user_id = p_user_id
    and ledger.period_key = v_entry.period_key
    and ledger.status = 'charged';

  return query select v_entry.id, v_entry.status, v_entry.routing_status,
    v_entry.period_key, v_entry.credit_cost, v_used, v_successful_count,
    v_changed, v_entry.outcome_json;
end;
$$;

revoke all on function public.begin_routed_ai_operation(uuid, text, text, integer, text, integer, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.complete_routed_ai_operation(uuid, text, boolean, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.begin_routed_ai_operation(uuid, text, text, integer, text, integer, text, text, integer, jsonb) to service_role;
grant execute on function public.complete_routed_ai_operation(uuid, text, boolean, text, text, jsonb, jsonb) to service_role;

commit;
