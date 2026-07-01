-- StudentOS Task 3.3: durable, race-safe weekly AI allowance tracking.
-- Apply to all three StudentOS data shards only. Do not apply to the Auth project.

create table if not exists public.ai_usage_ledger (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  plan_tier text not null check (plan_tier in ('trial', 'starter', 'essential', 'plus', 'pro')),
  period_key text not null,
  action_type text not null,
  credit_cost integer not null default 0 check (credit_cost >= 0),
  status text not null check (status in ('reserved', 'charged', 'refunded', 'blocked')),
  request_id text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create index if not exists ai_usage_ledger_user_period_idx
  on public.ai_usage_ledger (user_id, period_key, status, created_at);

alter table public.ai_usage_ledger enable row level security;

drop policy if exists ai_usage_ledger_own on public.ai_usage_ledger;
create policy ai_usage_ledger_own on public.ai_usage_ledger
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.reserve_ai_weekly_allowance(
  p_user_id uuid,
  p_plan_tier text,
  p_period_key text,
  p_allowance integer,
  p_action_type text,
  p_credit_cost integer,
  p_request_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  allowed boolean,
  allowance integer,
  used integer,
  remaining integer,
  entry_id text,
  entry_status text
)
language plpgsql
as $$
declare
  v_existing public.ai_usage_ledger%rowtype;
  v_used integer := 0;
  v_id text := gen_random_uuid()::text;
begin
  if p_plan_tier not in ('trial', 'starter', 'essential', 'plus', 'pro') then
    raise exception 'unknown_plan_tier';
  end if;
  if p_allowance < 0 or p_credit_cost < 0 or coalesce(p_period_key, '') = '' or coalesce(p_request_id, '') = '' then
    raise exception 'invalid_ai_allowance_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_period_key, 0));

  select * into v_existing
  from public.ai_usage_ledger ledger
  where ledger.user_id = p_user_id and ledger.request_id = p_request_id
  limit 1;

  select coalesce(sum(ledger.credit_cost), 0)::integer into v_used
  from public.ai_usage_ledger ledger
  where ledger.user_id = p_user_id
    and ledger.period_key = p_period_key
    and ledger.status in ('reserved', 'charged');

  if v_existing.id is not null then
    return query select
      v_existing.status in ('reserved', 'charged'),
      p_allowance,
      v_used,
      greatest(p_allowance - v_used, 0),
      v_existing.id,
      v_existing.status;
    return;
  end if;

  if p_credit_cost > greatest(p_allowance - v_used, 0) then
    insert into public.ai_usage_ledger (
      id, user_id, plan_tier, period_key, action_type, credit_cost, status, request_id, metadata_json
    ) values (
      v_id, p_user_id, p_plan_tier, p_period_key, p_action_type, p_credit_cost, 'blocked', p_request_id, coalesce(p_metadata, '{}'::jsonb)
    );
    return query select false, p_allowance, v_used, greatest(p_allowance - v_used, 0), v_id, 'blocked'::text;
    return;
  end if;

  insert into public.ai_usage_ledger (
    id, user_id, plan_tier, period_key, action_type, credit_cost, status, request_id, metadata_json
  ) values (
    v_id, p_user_id, p_plan_tier, p_period_key, p_action_type, p_credit_cost, 'reserved', p_request_id, coalesce(p_metadata, '{}'::jsonb)
  );
  v_used := v_used + p_credit_cost;
  return query select true, p_allowance, v_used, greatest(p_allowance - v_used, 0), v_id, 'reserved'::text;
end;
$$;

create or replace function public.settle_ai_weekly_allowance(
  p_user_id uuid,
  p_request_id text,
  p_status text
)
returns table (
  entry_id text,
  entry_status text,
  period_key text,
  credit_cost integer,
  used integer
)
language plpgsql
as $$
declare
  v_entry public.ai_usage_ledger%rowtype;
  v_used integer := 0;
begin
  if p_status not in ('charged', 'refunded') then
    raise exception 'invalid_ai_allowance_settlement';
  end if;

  select * into v_entry
  from public.ai_usage_ledger ledger
  where ledger.user_id = p_user_id and ledger.request_id = p_request_id
  limit 1;

  if v_entry.id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_entry.period_key, 0));
  update public.ai_usage_ledger ledger
  set status = case when ledger.status = 'reserved' then p_status else ledger.status end,
      updated_at = now()
  where ledger.id = v_entry.id
  returning * into v_entry;

  select coalesce(sum(ledger.credit_cost), 0)::integer into v_used
  from public.ai_usage_ledger ledger
  where ledger.user_id = p_user_id
    and ledger.period_key = v_entry.period_key
    and ledger.status in ('reserved', 'charged');

  return query select v_entry.id, v_entry.status, v_entry.period_key, v_entry.credit_cost, v_used;
end;
$$;
