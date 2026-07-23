-- StudentOS Provider Router V2 global scheduler and per-credential health.
-- Apply to Project 1 (AUTH/shared) only. Never apply this migration to data shards.

begin;

create table if not exists public.ai_router_global_state (
  singleton boolean primary key default true check (singleton),
  primary_cursor bigint not null default 0 check (primary_cursor >= 0),
  nvidia_cursor bigint not null default 0 check (nvidia_cursor >= 0),
  pollinations_active_until timestamptz,
  pollinations_next_probe_at timestamptz,
  pollinations_probe_operation_id text,
  pollinations_probe_lease_expires_at timestamptz,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.ai_router_global_state (singleton) values (true)
on conflict (singleton) do nothing;

create table if not exists public.ai_router_slots (
  provider_code text not null check (provider_code in ('groq', 'gemini', 'nvidia')),
  slot_number integer not null check (
    (provider_code = 'groq' and slot_number between 1 and 5)
    or (provider_code = 'gemini' and slot_number between 1 and 6)
    or (provider_code = 'nvidia' and slot_number between 1 and 3)
  ),
  health_state text not null default 'healthy' check (health_state in ('healthy', 'cooling', 'half_open', 'disabled')),
  cooldown_until timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  credential_fingerprint text,
  half_open_operation_id text,
  half_open_lease_expires_at timestamptz,
  last_status_class text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (provider_code, slot_number)
);

create table if not exists public.ai_router_operation_claims (
  operation_id text primary key check (char_length(operation_id) between 1 and 160),
  primary_ordinal bigint not null check (primary_ordinal > 0),
  primary_slot_ordinal integer not null check (primary_slot_ordinal between 1 and 11),
  nvidia_ordinal bigint,
  nvidia_slot_number integer check (nvidia_slot_number between 1 and 3),
  lease_expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_router_operation_claims_lease_idx
  on public.ai_router_operation_claims (lease_expires_at)
  where completed_at is null;

alter table public.ai_router_global_state enable row level security;
alter table public.ai_router_slots enable row level security;
alter table public.ai_router_operation_claims enable row level security;

revoke all privileges on table public.ai_router_global_state from public, anon, authenticated;
revoke all privileges on table public.ai_router_slots from public, anon, authenticated;
revoke all privileges on table public.ai_router_operation_claims from public, anon, authenticated;
grant all privileges on table public.ai_router_global_state to service_role;
grant all privileges on table public.ai_router_slots to service_role;
grant all privileges on table public.ai_router_operation_claims to service_role;

create or replace function public.claim_ai_router_primary(
  p_operation_id text,
  p_lease_ms integer
)
returns table (
  primary_ordinal bigint,
  primary_slot_ordinal integer,
  replay boolean,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.ai_router_operation_claims%rowtype;
  v_ordinal bigint;
  v_lease interval;
begin
  if coalesce(p_operation_id, '') = '' or char_length(p_operation_id) > 160 or p_lease_ms < 1000 then
    raise exception 'invalid_ai_router_primary_claim';
  end if;
  v_lease := make_interval(secs => least(p_lease_ms, 900000)::double precision / 1000.0);
  perform pg_advisory_xact_lock(hashtextextended('studentos:ai-router-v2:primary', 0));

  select * into v_claim from public.ai_router_operation_claims where operation_id = p_operation_id;
  if v_claim.operation_id is not null then
    update public.ai_router_operation_claims
    set lease_expires_at = now() + v_lease,
        completed_at = null,
        updated_at = now()
    where operation_id = p_operation_id
    returning * into v_claim;
    return query select v_claim.primary_ordinal, v_claim.primary_slot_ordinal, true, v_claim.lease_expires_at;
    return;
  end if;

  update public.ai_router_global_state
  set primary_cursor = primary_cursor + 1,
      version = version + 1,
      updated_at = now()
  where singleton = true
  returning primary_cursor into v_ordinal;

  insert into public.ai_router_operation_claims (
    operation_id, primary_ordinal, primary_slot_ordinal, lease_expires_at
  ) values (
    p_operation_id, v_ordinal, ((v_ordinal - 1) % 11 + 1)::integer, now() + v_lease
  ) returning * into v_claim;

  delete from public.ai_router_operation_claims
  where coalesce(completed_at, lease_expires_at) < now() - interval '24 hours'
    and operation_id <> p_operation_id;

  return query select v_claim.primary_ordinal, v_claim.primary_slot_ordinal, false, v_claim.lease_expires_at;
end;
$$;

create or replace function public.claim_ai_router_nvidia(p_operation_id text)
returns table (nvidia_ordinal bigint, nvidia_slot_number integer, replay boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.ai_router_operation_claims%rowtype;
  v_ordinal bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('studentos:ai-router-v2:nvidia', 0));
  select * into v_claim from public.ai_router_operation_claims where operation_id = p_operation_id for update;
  if v_claim.operation_id is null then raise exception 'ai_router_operation_not_claimed'; end if;
  if v_claim.nvidia_ordinal is not null then
    return query select v_claim.nvidia_ordinal, v_claim.nvidia_slot_number, true;
    return;
  end if;
  update public.ai_router_global_state
  set nvidia_cursor = nvidia_cursor + 1, version = version + 1, updated_at = now()
  where singleton = true returning nvidia_cursor into v_ordinal;
  update public.ai_router_operation_claims
  set nvidia_ordinal = v_ordinal,
      nvidia_slot_number = ((v_ordinal - 1) % 3 + 1)::integer,
      updated_at = now()
  where operation_id = p_operation_id returning * into v_claim;
  return query select v_claim.nvidia_ordinal, v_claim.nvidia_slot_number, false;
end;
$$;

create or replace function public.claim_ai_router_slot(
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
  skip_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.ai_router_slots%rowtype;
  v_lease interval;
begin
  if not exists (
    select 1 from public.ai_router_operation_claims
    where operation_id = p_operation_id and completed_at is null and lease_expires_at > now()
  ) then raise exception 'ai_router_operation_lease_missing'; end if;
  if coalesce(p_credential_fingerprint, '') = '' or char_length(p_credential_fingerprint) > 128 or p_half_open_lease_ms < 1000 then
    raise exception 'invalid_ai_router_slot_claim';
  end if;
  v_lease := make_interval(secs => least(p_half_open_lease_ms, 300000)::double precision / 1000.0);
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
      last_status_class = 'configuration_changed', updated_at = now()
    where ai_router_slots.provider_code = p_provider_code and ai_router_slots.slot_number = p_slot_number
    returning * into v_slot;
  end if;

  if v_slot.health_state = 'disabled' then
    return query select false, p_provider_code, p_slot_number, v_slot.health_state, v_slot.cooldown_until, v_slot.failure_count, 'disabled'::text;
    return;
  end if;
  if v_slot.health_state = 'cooling' and v_slot.cooldown_until > now() then
    return query select false, p_provider_code, p_slot_number, v_slot.health_state, v_slot.cooldown_until, v_slot.failure_count, 'cooling'::text;
    return;
  end if;
  if v_slot.health_state = 'cooling' then
    update public.ai_router_slots set health_state = 'half_open', updated_at = now()
    where ai_router_slots.provider_code = p_provider_code and ai_router_slots.slot_number = p_slot_number
    returning * into v_slot;
  end if;
  if v_slot.health_state = 'half_open'
    and v_slot.half_open_lease_expires_at > now()
    and v_slot.half_open_operation_id is distinct from p_operation_id
  then
    return query select false, p_provider_code, p_slot_number, v_slot.health_state, v_slot.cooldown_until, v_slot.failure_count, 'half_open_lease_held'::text;
    return;
  end if;
  if v_slot.health_state = 'half_open' then
    update public.ai_router_slots set
      half_open_operation_id = p_operation_id,
      half_open_lease_expires_at = now() + v_lease,
      updated_at = now()
    where ai_router_slots.provider_code = p_provider_code and ai_router_slots.slot_number = p_slot_number
    returning * into v_slot;
  end if;
  return query select true, p_provider_code, p_slot_number, v_slot.health_state, v_slot.cooldown_until, v_slot.failure_count, null::text;
end;
$$;

create or replace function public.record_ai_router_success(
  p_operation_id text,
  p_provider_code text,
  p_slot_number integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_router_slots set
    health_state = 'healthy', cooldown_until = null, failure_count = 0,
    half_open_operation_id = null, half_open_lease_expires_at = null,
    last_status_class = 'success', last_success_at = now(), updated_at = now()
  where provider_code = p_provider_code and slot_number = p_slot_number;
end;
$$;

create or replace function public.record_ai_router_failure(
  p_operation_id text,
  p_provider_code text,
  p_slot_number integer,
  p_status_class text,
  p_cooldown_ms integer,
  p_disable boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_cooldown_ms < 0 or p_cooldown_ms > 604800000 then raise exception 'invalid_ai_router_cooldown'; end if;
  update public.ai_router_slots set
    health_state = case when p_disable then 'disabled' else 'cooling' end,
    cooldown_until = case when p_disable then null else now() + make_interval(secs => p_cooldown_ms::double precision / 1000.0) end,
    failure_count = failure_count + 1,
    half_open_operation_id = null, half_open_lease_expires_at = null,
    last_status_class = left(coalesce(p_status_class, 'request_failed'), 80),
    last_failure_at = now(), updated_at = now()
  where provider_code = p_provider_code and slot_number = p_slot_number;
end;
$$;

create or replace function public.reset_ai_router_slot(
  p_provider_code text,
  p_slot_number integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_router_slots set
    health_state = 'healthy', cooldown_until = null, failure_count = 0,
    half_open_operation_id = null, half_open_lease_expires_at = null,
    last_status_class = 'operator_reset', updated_at = now()
  where provider_code = p_provider_code and slot_number = p_slot_number;
  if not found then raise exception 'ai_router_slot_not_found'; end if;
end;
$$;

create or replace function public.claim_ai_router_pollinations_probe(
  p_operation_id text,
  p_probe_interval_ms integer
)
returns table (
  fallback_active boolean,
  probe_claimed boolean,
  fallback_active_until timestamptz,
  next_probe_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.ai_router_global_state%rowtype;
begin
  if p_probe_interval_ms < 1000 or p_probe_interval_ms > 3600000 then raise exception 'invalid_ai_router_probe_interval'; end if;
  perform pg_advisory_xact_lock(hashtextextended('studentos:ai-router-v2:pollinations', 0));
  select * into v_state from public.ai_router_global_state where singleton = true for update;
  if v_state.pollinations_active_until is null or v_state.pollinations_active_until <= now() then
    update public.ai_router_global_state set
      pollinations_active_until = null, pollinations_next_probe_at = null,
      pollinations_probe_operation_id = null, pollinations_probe_lease_expires_at = null,
      version = version + 1, updated_at = now()
    where singleton = true;
    return query select false, true, null::timestamptz, null::timestamptz;
    return;
  end if;
  if v_state.pollinations_next_probe_at > now() then
    return query select true, false, v_state.pollinations_active_until, v_state.pollinations_next_probe_at;
    return;
  end if;
  if v_state.pollinations_probe_lease_expires_at > now()
    and v_state.pollinations_probe_operation_id is distinct from p_operation_id
  then
    return query select true, false, v_state.pollinations_active_until, v_state.pollinations_next_probe_at;
    return;
  end if;
  update public.ai_router_global_state set
    pollinations_probe_operation_id = p_operation_id,
    pollinations_probe_lease_expires_at = now() + interval '60 seconds',
    pollinations_next_probe_at = now() + make_interval(secs => p_probe_interval_ms::double precision / 1000.0),
    version = version + 1, updated_at = now()
  where singleton = true returning * into v_state;
  return query select true, true, v_state.pollinations_active_until, v_state.pollinations_next_probe_at;
end;
$$;

create or replace function public.enter_ai_router_pollinations_mode(
  p_operation_id text,
  p_fallback_max_ms integer,
  p_probe_interval_ms integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_fallback_max_ms < 1000 or p_fallback_max_ms > 3600000
    or p_probe_interval_ms < 1000 or p_probe_interval_ms > p_fallback_max_ms
  then raise exception 'invalid_pollinations_fallback_window'; end if;
  perform pg_advisory_xact_lock(hashtextextended('studentos:ai-router-v2:pollinations', 0));
  update public.ai_router_global_state set
    pollinations_active_until = case
      when pollinations_active_until is null or pollinations_active_until <= now()
        then now() + make_interval(secs => p_fallback_max_ms::double precision / 1000.0)
      else pollinations_active_until
    end,
    pollinations_next_probe_at = case
      when pollinations_active_until is null or pollinations_active_until <= now()
        then now() + make_interval(secs => p_probe_interval_ms::double precision / 1000.0)
      else pollinations_next_probe_at
    end,
    pollinations_probe_operation_id = null,
    pollinations_probe_lease_expires_at = null,
    version = version + 1, updated_at = now()
  where singleton = true;
end;
$$;

create or replace function public.leave_ai_router_pollinations_mode(p_operation_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_router_global_state set
    pollinations_active_until = null, pollinations_next_probe_at = null,
    pollinations_probe_operation_id = null, pollinations_probe_lease_expires_at = null,
    version = version + 1, updated_at = now()
  where singleton = true;
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
    health_state = case when health_state = 'half_open' then 'cooling' else health_state end,
    cooldown_until = case when health_state = 'half_open' then greatest(coalesce(cooldown_until, now()), now()) else cooldown_until end,
    updated_at = now()
  where half_open_operation_id = p_operation_id;
  update public.ai_router_global_state set
    pollinations_probe_operation_id = null,
    pollinations_probe_lease_expires_at = null,
    updated_at = now()
  where singleton = true and pollinations_probe_operation_id = p_operation_id;
end;
$$;

revoke all on function public.claim_ai_router_primary(text, integer) from public, anon, authenticated;
revoke all on function public.claim_ai_router_nvidia(text) from public, anon, authenticated;
revoke all on function public.claim_ai_router_slot(text, text, integer, text, integer) from public, anon, authenticated;
revoke all on function public.record_ai_router_success(text, text, integer) from public, anon, authenticated;
revoke all on function public.record_ai_router_failure(text, text, integer, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.reset_ai_router_slot(text, integer) from public, anon, authenticated;
revoke all on function public.claim_ai_router_pollinations_probe(text, integer) from public, anon, authenticated;
revoke all on function public.enter_ai_router_pollinations_mode(text, integer, integer) from public, anon, authenticated;
revoke all on function public.leave_ai_router_pollinations_mode(text) from public, anon, authenticated;
revoke all on function public.complete_ai_router_operation(text) from public, anon, authenticated;

grant execute on function public.claim_ai_router_primary(text, integer) to service_role;
grant execute on function public.claim_ai_router_nvidia(text) to service_role;
grant execute on function public.claim_ai_router_slot(text, text, integer, text, integer) to service_role;
grant execute on function public.record_ai_router_success(text, text, integer) to service_role;
grant execute on function public.record_ai_router_failure(text, text, integer, text, integer, boolean) to service_role;
grant execute on function public.reset_ai_router_slot(text, integer) to service_role;
grant execute on function public.claim_ai_router_pollinations_probe(text, integer) to service_role;
grant execute on function public.enter_ai_router_pollinations_mode(text, integer, integer) to service_role;
grant execute on function public.leave_ai_router_pollinations_mode(text) to service_role;
grant execute on function public.complete_ai_router_operation(text) to service_role;

commit;
