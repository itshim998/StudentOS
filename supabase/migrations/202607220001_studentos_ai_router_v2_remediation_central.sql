-- StudentOS Provider Router V2 remediation: CAS health ownership, conclusive
-- schema capabilities, and isolated database concurrency-test support.
-- Apply to Project 1 (AUTH/shared) only. Never apply this migration to data shards.

begin;

alter table public.ai_router_slots
  add column if not exists health_version bigint not null default 0,
  add column if not exists claim_token text,
  add column if not exists claim_operation_id text,
  add column if not exists claim_lease_expires_at timestamptz;

alter table public.ai_router_global_state
  add column if not exists pollinations_probe_token text,
  add column if not exists pollinations_version bigint not null default 0;

-- Router V2 must be disabled while this additive migration is applied. Any
-- abandoned pre-CAS half-open ownership is conservatively returned to cooling.
update public.ai_router_slots
set health_state = 'cooling',
    cooldown_until = greatest(coalesce(cooldown_until, now()), now()),
    half_open_operation_id = null,
    half_open_lease_expires_at = null,
    claim_token = null,
    claim_operation_id = null,
    claim_lease_expires_at = null,
    health_version = health_version + 1,
    updated_at = now()
where health_state = 'half_open';

create table if not exists public.ai_router_observability_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('stale_slot_result', 'stale_pollinations_transition')),
  operation_correlation_hash text not null check (char_length(operation_correlation_hash) = 32),
  provider_code text check (provider_code is null or provider_code in ('groq', 'gemini', 'nvidia', 'pollinations')),
  slot_number integer,
  attempt_outcome text,
  applied boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ai_router_observability_events_created_idx
  on public.ai_router_observability_events (created_at desc);

alter table public.ai_router_observability_events enable row level security;
revoke all privileges on table public.ai_router_observability_events from public, anon, authenticated;
grant all privileges on table public.ai_router_observability_events to service_role;

drop function if exists public.claim_ai_router_slot(text, text, integer, text, integer);
create function public.claim_ai_router_slot(
  p_operation_id text,
  p_provider_code text,
  p_slot_number integer,
  p_credential_fingerprint text,
  p_half_open_lease_ms integer
)
returns table (
  eligible boolean,
  provider_code text,
  slot_number integer,
  health_state text,
  cooldown_until timestamptz,
  failure_count integer,
  skip_reason text,
  claim_token text,
  claim_lease_expires_at timestamptz,
  health_version bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.ai_router_slots%rowtype;
  v_lease interval;
  v_token text;
begin
  if not exists (
    select 1 from public.ai_router_operation_claims
    where operation_id = p_operation_id and completed_at is null and lease_expires_at > now()
  ) then raise exception 'ai_router_operation_lease_missing'; end if;
  if coalesce(p_credential_fingerprint, '') = '' or char_length(p_credential_fingerprint) > 128
    or p_half_open_lease_ms < 1000 or p_half_open_lease_ms > 300000
  then raise exception 'invalid_ai_router_slot_claim'; end if;
  v_lease := make_interval(secs => p_half_open_lease_ms::double precision / 1000.0);
  perform pg_advisory_xact_lock(hashtextextended('studentos:ai-router-v2:slot:' || p_provider_code || ':' || p_slot_number, 0));

  insert into public.ai_router_slots (provider_code, slot_number, credential_fingerprint)
  values (p_provider_code, p_slot_number, p_credential_fingerprint)
  on conflict (provider_code, slot_number) do nothing;
  select * into v_slot from public.ai_router_slots
  where ai_router_slots.provider_code = p_provider_code and ai_router_slots.slot_number = p_slot_number
  for update;

  if v_slot.credential_fingerprint is distinct from p_credential_fingerprint then
    update public.ai_router_slots set
      credential_fingerprint = p_credential_fingerprint,
      health_state = 'healthy', cooldown_until = null, failure_count = 0,
      half_open_operation_id = null, half_open_lease_expires_at = null,
      claim_token = null, claim_operation_id = null, claim_lease_expires_at = null,
      health_version = health_version + 1,
      last_status_class = 'configuration_changed', updated_at = now()
    where ai_router_slots.provider_code = p_provider_code and ai_router_slots.slot_number = p_slot_number
    returning * into v_slot;
  end if;

  if v_slot.health_state = 'disabled' then
    return query select false, p_provider_code, p_slot_number, v_slot.health_state,
      v_slot.cooldown_until, v_slot.failure_count, 'disabled'::text, null::text, null::timestamptz, v_slot.health_version;
    return;
  end if;
  if v_slot.health_state = 'cooling' and v_slot.cooldown_until > now() then
    return query select false, p_provider_code, p_slot_number, v_slot.health_state,
      v_slot.cooldown_until, v_slot.failure_count, 'cooling'::text, null::text, null::timestamptz, v_slot.health_version;
    return;
  end if;
  if v_slot.health_state = 'cooling' then
    update public.ai_router_slots set health_state = 'half_open', updated_at = now()
    where ai_router_slots.provider_code = p_provider_code and ai_router_slots.slot_number = p_slot_number
    returning * into v_slot;
  end if;
  if v_slot.health_state = 'half_open'
    and v_slot.claim_lease_expires_at > now()
    and v_slot.claim_operation_id is distinct from p_operation_id
  then
    return query select false, p_provider_code, p_slot_number, v_slot.health_state,
      v_slot.cooldown_until, v_slot.failure_count, 'half_open_lease_held'::text, null::text, null::timestamptz, v_slot.health_version;
    return;
  end if;

  v_token := md5(random()::text || clock_timestamp()::text || p_operation_id || p_provider_code || p_slot_number::text);
  update public.ai_router_slots set
    claim_token = v_token,
    claim_operation_id = p_operation_id,
    claim_lease_expires_at = now() + v_lease,
    half_open_operation_id = case when health_state = 'half_open' then p_operation_id else null end,
    half_open_lease_expires_at = case when health_state = 'half_open' then now() + v_lease else null end,
    health_version = health_version + 1,
    updated_at = now()
  where ai_router_slots.provider_code = p_provider_code and ai_router_slots.slot_number = p_slot_number
  returning * into v_slot;

  return query select true, p_provider_code, p_slot_number, v_slot.health_state,
    v_slot.cooldown_until, v_slot.failure_count, null::text, v_slot.claim_token,
    v_slot.claim_lease_expires_at, v_slot.health_version;
end;
$$;

drop function if exists public.record_ai_router_success(text, text, integer);
create function public.record_ai_router_success(
  p_operation_id text,
  p_provider_code text,
  p_slot_number integer,
  p_claim_token text
)
returns table (applied boolean, stale boolean, health_version bigint)
language plpgsql
security definer
set search_path = public
as $$
declare v_version bigint;
begin
  update public.ai_router_slots set
    health_state = 'healthy', cooldown_until = null, failure_count = 0,
    half_open_operation_id = null, half_open_lease_expires_at = null,
    claim_token = null, claim_operation_id = null, claim_lease_expires_at = null,
    health_version = ai_router_slots.health_version + 1,
    last_status_class = 'success', last_success_at = now(), updated_at = now()
  where provider_code = p_provider_code and slot_number = p_slot_number
    and claim_operation_id = p_operation_id and claim_token = p_claim_token
    and claim_lease_expires_at > now()
  returning ai_router_slots.health_version into v_version;
  if found then return query select true, false, v_version; return; end if;
  insert into public.ai_router_observability_events (
    event_type, operation_correlation_hash, provider_code, slot_number, attempt_outcome
  ) values ('stale_slot_result', md5(coalesce(p_operation_id, '')), p_provider_code, p_slot_number, 'success');
  select s.health_version into v_version from public.ai_router_slots s
  where s.provider_code = p_provider_code and s.slot_number = p_slot_number;
  return query select false, true, coalesce(v_version, 0);
end;
$$;

drop function if exists public.record_ai_router_failure(text, text, integer, text, integer, boolean);
create function public.record_ai_router_failure(
  p_operation_id text,
  p_provider_code text,
  p_slot_number integer,
  p_claim_token text,
  p_status_class text,
  p_cooldown_ms integer,
  p_disable boolean
)
returns table (applied boolean, stale boolean, health_version bigint)
language plpgsql
security definer
set search_path = public
as $$
declare v_version bigint;
begin
  if p_cooldown_ms < 0 or p_cooldown_ms > 3600000 then raise exception 'invalid_ai_router_cooldown'; end if;
  update public.ai_router_slots set
    health_state = case when p_disable then 'disabled' else 'cooling' end,
    cooldown_until = case when p_disable then null else now() + make_interval(secs => p_cooldown_ms::double precision / 1000.0) end,
    failure_count = ai_router_slots.failure_count + 1,
    half_open_operation_id = null, half_open_lease_expires_at = null,
    claim_token = null, claim_operation_id = null, claim_lease_expires_at = null,
    health_version = ai_router_slots.health_version + 1,
    last_status_class = left(coalesce(p_status_class, 'request_failed'), 80),
    last_failure_at = now(), updated_at = now()
  where provider_code = p_provider_code and slot_number = p_slot_number
    and claim_operation_id = p_operation_id and claim_token = p_claim_token
    and claim_lease_expires_at > now()
  returning ai_router_slots.health_version into v_version;
  if found then return query select true, false, v_version; return; end if;
  insert into public.ai_router_observability_events (
    event_type, operation_correlation_hash, provider_code, slot_number, attempt_outcome
  ) values ('stale_slot_result', md5(coalesce(p_operation_id, '')), p_provider_code, p_slot_number, left(coalesce(p_status_class, 'request_failed'), 80));
  select s.health_version into v_version from public.ai_router_slots s
  where s.provider_code = p_provider_code and s.slot_number = p_slot_number;
  return query select false, true, coalesce(v_version, 0);
end;
$$;

create or replace function public.reset_ai_router_slot(p_provider_code text, p_slot_number integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_router_slots set
    health_state = 'healthy', cooldown_until = null, failure_count = 0,
    half_open_operation_id = null, half_open_lease_expires_at = null,
    claim_token = null, claim_operation_id = null, claim_lease_expires_at = null,
    health_version = health_version + 1,
    last_status_class = 'operator_reset', updated_at = now()
  where provider_code = p_provider_code and slot_number = p_slot_number;
  if not found then raise exception 'ai_router_slot_not_found'; end if;
end;
$$;

drop function if exists public.claim_ai_router_pollinations_probe(text, integer);
create function public.claim_ai_router_pollinations_probe(p_operation_id text, p_probe_interval_ms integer)
returns table (
  fallback_active boolean,
  probe_claimed boolean,
  fallback_active_until timestamptz,
  next_probe_at timestamptz,
  probe_token text,
  state_version bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.ai_router_global_state%rowtype;
  v_token text;
begin
  if p_probe_interval_ms < 1000 or p_probe_interval_ms > 3600000 then raise exception 'invalid_ai_router_probe_interval'; end if;
  if not exists (
    select 1 from public.ai_router_operation_claims
    where operation_id = p_operation_id and completed_at is null and lease_expires_at > now()
  ) then raise exception 'ai_router_operation_lease_missing'; end if;
  perform pg_advisory_xact_lock(hashtextextended('studentos:ai-router-v2:pollinations', 0));
  select * into v_state from public.ai_router_global_state where singleton = true for update;
  if v_state.pollinations_active_until is null or v_state.pollinations_active_until <= now() then
    if v_state.pollinations_active_until is not null
      or v_state.pollinations_next_probe_at is not null
      or v_state.pollinations_probe_operation_id is not null
      or v_state.pollinations_probe_token is not null
    then
      update public.ai_router_global_state set
        pollinations_active_until = null, pollinations_next_probe_at = null,
        pollinations_probe_operation_id = null, pollinations_probe_lease_expires_at = null,
        pollinations_probe_token = null,
        pollinations_version = pollinations_version + 1,
        version = version + 1, updated_at = now()
      where singleton = true returning * into v_state;
    end if;
    return query select false, true, null::timestamptz, null::timestamptz, null::text, v_state.pollinations_version;
    return;
  end if;
  if v_state.pollinations_next_probe_at > now() then
    return query select true, false, v_state.pollinations_active_until, v_state.pollinations_next_probe_at, null::text, v_state.pollinations_version;
    return;
  end if;
  if v_state.pollinations_probe_lease_expires_at > now()
    and v_state.pollinations_probe_operation_id is distinct from p_operation_id
  then
    return query select true, false, v_state.pollinations_active_until, v_state.pollinations_next_probe_at, null::text, v_state.pollinations_version;
    return;
  end if;
  v_token := md5(random()::text || clock_timestamp()::text || p_operation_id || ':pollinations');
  update public.ai_router_global_state set
    pollinations_probe_operation_id = p_operation_id,
    pollinations_probe_lease_expires_at = now() + interval '60 seconds',
    pollinations_probe_token = v_token,
    pollinations_next_probe_at = now() + make_interval(secs => p_probe_interval_ms::double precision / 1000.0),
    pollinations_version = pollinations_version + 1,
    version = version + 1, updated_at = now()
  where singleton = true returning * into v_state;
  return query select true, true, v_state.pollinations_active_until, v_state.pollinations_next_probe_at,
    v_state.pollinations_probe_token, v_state.pollinations_version;
end;
$$;

drop function if exists public.enter_ai_router_pollinations_mode(text, integer, integer);
create function public.enter_ai_router_pollinations_mode(
  p_operation_id text,
  p_fallback_max_ms integer,
  p_probe_interval_ms integer,
  p_expected_state_version bigint
)
returns table (applied boolean, stale boolean, state_version bigint)
language plpgsql
security definer
set search_path = public
as $$
declare v_version bigint;
begin
  if p_fallback_max_ms < 1000 or p_fallback_max_ms > 3600000
    or p_probe_interval_ms < 1000 or p_probe_interval_ms > p_fallback_max_ms
  then raise exception 'invalid_pollinations_fallback_window'; end if;
  if not exists (
    select 1 from public.ai_router_operation_claims
    where operation_id = p_operation_id and completed_at is null and lease_expires_at > now()
  ) then return query select false, true, 0::bigint; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('studentos:ai-router-v2:pollinations', 0));
  update public.ai_router_global_state set
    pollinations_active_until = now() + make_interval(secs => p_fallback_max_ms::double precision / 1000.0),
    pollinations_next_probe_at = now() + make_interval(secs => p_probe_interval_ms::double precision / 1000.0),
    pollinations_probe_operation_id = null,
    pollinations_probe_lease_expires_at = null,
    pollinations_probe_token = null,
    pollinations_version = pollinations_version + 1,
    version = version + 1, updated_at = now()
  where singleton = true and pollinations_version = p_expected_state_version
    and (pollinations_active_until is null or pollinations_active_until <= now())
  returning pollinations_version into v_version;
  if found then return query select true, false, v_version; return; end if;
  insert into public.ai_router_observability_events (event_type, operation_correlation_hash, attempt_outcome)
  values ('stale_pollinations_transition', md5(coalesce(p_operation_id, '')), 'enter');
  select pollinations_version into v_version from public.ai_router_global_state where singleton = true;
  return query select false, true, coalesce(v_version, 0);
end;
$$;

drop function if exists public.leave_ai_router_pollinations_mode(text);
create function public.leave_ai_router_pollinations_mode(p_operation_id text, p_probe_token text)
returns table (applied boolean, stale boolean, state_version bigint)
language plpgsql
security definer
set search_path = public
as $$
declare v_version bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('studentos:ai-router-v2:pollinations', 0));
  update public.ai_router_global_state set
    pollinations_active_until = null, pollinations_next_probe_at = null,
    pollinations_probe_operation_id = null, pollinations_probe_lease_expires_at = null,
    pollinations_probe_token = null,
    pollinations_version = pollinations_version + 1,
    version = version + 1, updated_at = now()
  where singleton = true
    and pollinations_active_until > now()
    and pollinations_probe_operation_id = p_operation_id
    and pollinations_probe_token = p_probe_token
    and pollinations_probe_lease_expires_at > now()
  returning pollinations_version into v_version;
  if found then return query select true, false, v_version; return; end if;
  insert into public.ai_router_observability_events (event_type, operation_correlation_hash, attempt_outcome)
  values ('stale_pollinations_transition', md5(coalesce(p_operation_id, '')), 'leave');
  select pollinations_version into v_version from public.ai_router_global_state where singleton = true;
  return query select false, true, coalesce(v_version, 0);
end;
$$;

create or replace function public.complete_ai_router_operation(p_operation_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_router_operation_claims set completed_at = coalesce(completed_at, now()), updated_at = now()
  where operation_id = p_operation_id;
  update public.ai_router_slots set
    half_open_operation_id = null,
    half_open_lease_expires_at = null,
    claim_token = null,
    claim_operation_id = null,
    claim_lease_expires_at = null,
    health_version = health_version + 1,
    health_state = case when health_state = 'half_open' then 'cooling' else health_state end,
    cooldown_until = case when health_state = 'half_open' then greatest(coalesce(cooldown_until, now()), now()) else cooldown_until end,
    updated_at = now()
  where claim_operation_id = p_operation_id;
  update public.ai_router_global_state set
    pollinations_probe_operation_id = null,
    pollinations_probe_lease_expires_at = null,
    pollinations_probe_token = null,
    pollinations_version = pollinations_version + 1,
    version = version + 1,
    updated_at = now()
  where singleton = true and pollinations_probe_operation_id = p_operation_id;
end;
$$;

-- Isolated test state exercises database locks and CAS without touching the
-- production cursor or provider health rows.
create table if not exists public.ai_router_v2_test_runs (
  run_id text primary key check (run_id like 'studentos-router-v2-live-%'),
  primary_cursor bigint not null default 0,
  expires_at timestamptz not null default now() + interval '30 minutes'
);
create table if not exists public.ai_router_v2_test_operations (
  run_id text not null references public.ai_router_v2_test_runs(run_id) on delete cascade,
  operation_id text not null,
  primary_ordinal bigint not null,
  primary_slot_ordinal integer not null,
  completed_at timestamptz,
  primary key (run_id, operation_id),
  unique (run_id, primary_ordinal)
);
create table if not exists public.ai_router_v2_test_slots (
  run_id text not null references public.ai_router_v2_test_runs(run_id) on delete cascade,
  provider_code text not null,
  slot_number integer not null,
  health_state text not null default 'healthy',
  cooldown_until timestamptz,
  failure_count integer not null default 0,
  claim_token text,
  claim_operation_id text,
  claim_lease_expires_at timestamptz,
  health_version bigint not null default 0,
  primary key (run_id, provider_code, slot_number)
);

alter table public.ai_router_v2_test_runs enable row level security;
alter table public.ai_router_v2_test_operations enable row level security;
alter table public.ai_router_v2_test_slots enable row level security;
revoke all privileges on table public.ai_router_v2_test_runs from public, anon, authenticated;
revoke all privileges on table public.ai_router_v2_test_operations from public, anon, authenticated;
revoke all privileges on table public.ai_router_v2_test_slots from public, anon, authenticated;
grant all privileges on table public.ai_router_v2_test_runs to service_role;
grant all privileges on table public.ai_router_v2_test_operations to service_role;
grant all privileges on table public.ai_router_v2_test_slots to service_role;

create or replace function public.claim_ai_router_v2_test_primary(p_run_id text, p_operation_id text)
returns table (primary_ordinal bigint, primary_slot_ordinal integer, replay boolean)
language plpgsql security definer set search_path = public
as $$
declare v_ordinal bigint; v_existing public.ai_router_v2_test_operations%rowtype;
begin
  if p_run_id not like 'studentos-router-v2-live-%' or p_operation_id not like 'studentos-router-v2-live-%'
  then raise exception 'invalid_ai_router_test_identifier'; end if;
  perform pg_advisory_xact_lock(hashtextextended('studentos:ai-router-v2:test:' || p_run_id, 0));
  delete from public.ai_router_v2_test_runs where expires_at < now();
  insert into public.ai_router_v2_test_runs (run_id) values (p_run_id) on conflict (run_id) do nothing;
  select * into v_existing from public.ai_router_v2_test_operations
  where run_id = p_run_id and operation_id = p_operation_id;
  if v_existing.operation_id is not null then
    return query select v_existing.primary_ordinal, v_existing.primary_slot_ordinal, true; return;
  end if;
  update public.ai_router_v2_test_runs set primary_cursor = primary_cursor + 1
  where run_id = p_run_id returning ai_router_v2_test_runs.primary_cursor into v_ordinal;
  insert into public.ai_router_v2_test_operations (run_id, operation_id, primary_ordinal, primary_slot_ordinal)
  values (p_run_id, p_operation_id, v_ordinal, ((v_ordinal - 1) % 11 + 1)::integer);
  return query select v_ordinal, ((v_ordinal - 1) % 11 + 1)::integer, false;
end;
$$;

create or replace function public.prepare_ai_router_v2_test_slot(
  p_run_id text, p_provider_code text, p_slot_number integer, p_health_state text, p_cooldown_until timestamptz
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_run_id not like 'studentos-router-v2-live-%' or p_health_state not in ('healthy', 'cooling')
  then raise exception 'invalid_ai_router_test_slot'; end if;
  insert into public.ai_router_v2_test_slots (run_id, provider_code, slot_number, health_state, cooldown_until)
  values (p_run_id, p_provider_code, p_slot_number, p_health_state, p_cooldown_until)
  on conflict (run_id, provider_code, slot_number) do update set
    health_state = excluded.health_state, cooldown_until = excluded.cooldown_until,
    failure_count = 0, claim_token = null, claim_operation_id = null,
    claim_lease_expires_at = null, health_version = ai_router_v2_test_slots.health_version + 1;
end;
$$;

create or replace function public.claim_ai_router_v2_test_slot(
  p_run_id text, p_operation_id text, p_provider_code text, p_slot_number integer,
  p_lease_ms integer, p_observed_at timestamptz
)
returns table (eligible boolean, claim_token text, health_state text, health_version bigint)
language plpgsql security definer set search_path = public
as $$
declare v_slot public.ai_router_v2_test_slots%rowtype; v_token text;
begin
  if not exists (select 1 from public.ai_router_v2_test_operations where run_id = p_run_id and operation_id = p_operation_id and completed_at is null)
  then raise exception 'ai_router_test_operation_missing'; end if;
  perform pg_advisory_xact_lock(hashtextextended('studentos:ai-router-v2:test-slot:' || p_run_id || ':' || p_provider_code || ':' || p_slot_number, 0));
  select * into v_slot from public.ai_router_v2_test_slots
  where run_id = p_run_id and provider_code = p_provider_code and slot_number = p_slot_number for update;
  if v_slot.run_id is null then raise exception 'ai_router_test_slot_missing'; end if;
  if v_slot.health_state = 'cooling' and v_slot.cooldown_until > p_observed_at then
    return query select false, null::text, v_slot.health_state, v_slot.health_version; return;
  end if;
  if v_slot.health_state = 'cooling' then v_slot.health_state := 'half_open'; end if;
  if v_slot.health_state = 'half_open' and v_slot.claim_lease_expires_at > p_observed_at
    and v_slot.claim_operation_id is distinct from p_operation_id
  then return query select false, null::text, v_slot.health_state, v_slot.health_version; return; end if;
  v_token := md5(random()::text || clock_timestamp()::text || p_operation_id);
  update public.ai_router_v2_test_slots set
    health_state = v_slot.health_state, claim_token = v_token, claim_operation_id = p_operation_id,
    claim_lease_expires_at = p_observed_at + make_interval(secs => p_lease_ms::double precision / 1000.0),
    health_version = ai_router_v2_test_slots.health_version + 1
  where run_id = p_run_id and provider_code = p_provider_code and slot_number = p_slot_number
  returning * into v_slot;
  return query select true, v_slot.claim_token, v_slot.health_state, v_slot.health_version;
end;
$$;

create or replace function public.record_ai_router_v2_test_result(
  p_run_id text, p_operation_id text, p_provider_code text, p_slot_number integer,
  p_claim_token text, p_succeeded boolean, p_cooldown_ms integer, p_observed_at timestamptz
)
returns table (applied boolean, health_state text, health_version bigint)
language plpgsql security definer set search_path = public
as $$
declare v_slot public.ai_router_v2_test_slots%rowtype;
begin
  update public.ai_router_v2_test_slots set
    health_state = case when p_succeeded then 'healthy' else 'cooling' end,
    cooldown_until = case when p_succeeded then null else p_observed_at + make_interval(secs => p_cooldown_ms::double precision / 1000.0) end,
    failure_count = case when p_succeeded then 0 else failure_count + 1 end,
    claim_token = null, claim_operation_id = null, claim_lease_expires_at = null,
    health_version = ai_router_v2_test_slots.health_version + 1
  where run_id = p_run_id and provider_code = p_provider_code and slot_number = p_slot_number
    and claim_operation_id = p_operation_id and claim_token = p_claim_token
    and claim_lease_expires_at > p_observed_at
  returning * into v_slot;
  if found then return query select true, v_slot.health_state, v_slot.health_version; return; end if;
  select * into v_slot from public.ai_router_v2_test_slots
  where run_id = p_run_id and provider_code = p_provider_code and slot_number = p_slot_number;
  return query select false, v_slot.health_state, v_slot.health_version;
end;
$$;

create or replace function public.complete_ai_router_v2_test_operation(p_run_id text, p_operation_id text)
returns void language sql security definer set search_path = public
as $$ update public.ai_router_v2_test_operations set completed_at = coalesce(completed_at, now()) where run_id = p_run_id and operation_id = p_operation_id; $$;

create or replace function public.cleanup_ai_router_v2_test_run(p_run_id text)
returns void language plpgsql security definer set search_path = public
as $$ begin
  if p_run_id not like 'studentos-router-v2-live-%' then raise exception 'invalid_ai_router_test_identifier'; end if;
  delete from public.ai_router_v2_test_runs where run_id = p_run_id;
end; $$;

create or replace function public.verify_ai_router_v2_schema()
returns table (schema_version text, target text, capabilities jsonb)
language sql stable security definer set search_path = public
as $$
  select '202607220001'::text, 'project_1_auth_shared'::text, jsonb_build_array(
    'global_primary_ring', 'central_slot_health', 'claim_token_cas',
    'stale_result_observability', 'pollinations_transition_cas',
    'isolated_database_concurrency_test', 'service_role_only'
  );
$$;

revoke all on function public.claim_ai_router_slot(text, text, integer, text, integer) from public, anon, authenticated;
revoke all on function public.record_ai_router_success(text, text, integer, text) from public, anon, authenticated;
revoke all on function public.record_ai_router_failure(text, text, integer, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.claim_ai_router_pollinations_probe(text, integer) from public, anon, authenticated;
revoke all on function public.enter_ai_router_pollinations_mode(text, integer, integer, bigint) from public, anon, authenticated;
revoke all on function public.leave_ai_router_pollinations_mode(text, text) from public, anon, authenticated;
revoke all on function public.claim_ai_router_v2_test_primary(text, text) from public, anon, authenticated;
revoke all on function public.prepare_ai_router_v2_test_slot(text, text, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_ai_router_v2_test_slot(text, text, text, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.record_ai_router_v2_test_result(text, text, text, integer, text, boolean, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_ai_router_v2_test_operation(text, text) from public, anon, authenticated;
revoke all on function public.cleanup_ai_router_v2_test_run(text) from public, anon, authenticated;
revoke all on function public.verify_ai_router_v2_schema() from public, anon, authenticated;

grant execute on function public.claim_ai_router_slot(text, text, integer, text, integer) to service_role;
grant execute on function public.record_ai_router_success(text, text, integer, text) to service_role;
grant execute on function public.record_ai_router_failure(text, text, integer, text, text, integer, boolean) to service_role;
grant execute on function public.claim_ai_router_pollinations_probe(text, integer) to service_role;
grant execute on function public.enter_ai_router_pollinations_mode(text, integer, integer, bigint) to service_role;
grant execute on function public.leave_ai_router_pollinations_mode(text, text) to service_role;
grant execute on function public.claim_ai_router_v2_test_primary(text, text) to service_role;
grant execute on function public.prepare_ai_router_v2_test_slot(text, text, integer, text, timestamptz) to service_role;
grant execute on function public.claim_ai_router_v2_test_slot(text, text, text, integer, integer, timestamptz) to service_role;
grant execute on function public.record_ai_router_v2_test_result(text, text, text, integer, text, boolean, integer, timestamptz) to service_role;
grant execute on function public.complete_ai_router_v2_test_operation(text, text) to service_role;
grant execute on function public.cleanup_ai_router_v2_test_run(text) to service_role;
grant execute on function public.verify_ai_router_v2_schema() to service_role;

notify pgrst, 'reload schema';

commit;
