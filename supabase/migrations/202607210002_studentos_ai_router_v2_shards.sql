-- StudentOS Provider Router V2 routing-ledger compatibility.
-- Apply identically to data Projects 2, 3, and 4 only. Never apply to Project 1 AUTH.

begin;

alter table public.ai_usage_ledger
  drop constraint if exists ai_usage_ledger_routing_provider_check;
alter table public.ai_usage_ledger
  add constraint ai_usage_ledger_routing_provider_check
  check (
    (routing_primary_provider is null or routing_primary_provider in ('groq', 'gemini', 'nvidia', 'pollinations'))
    and (routing_final_provider is null or routing_final_provider in ('groq', 'gemini', 'nvidia', 'pollinations'))
  );

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
  if p_primary_provider is not null and p_primary_provider not in ('groq', 'gemini', 'nvidia', 'pollinations') then
    raise exception 'invalid_routing_primary_provider';
  end if;
  if p_final_provider is not null and p_final_provider not in ('groq', 'gemini', 'nvidia', 'pollinations') then
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

revoke all on function public.complete_routed_ai_operation(uuid, text, boolean, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.complete_routed_ai_operation(uuid, text, boolean, text, text, jsonb, jsonb) to service_role;

commit;
