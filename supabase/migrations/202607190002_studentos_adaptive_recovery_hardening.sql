-- StudentOS Adaptive Recovery Engine production-readiness hardening.
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4 only.
-- Migration 202607190001 must already be present. This migration is additive and idempotent.

begin;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'recovery_user_state', 'academic_events', 'academic_state_snapshots',
    'topic_recovery_states', 'topic_recovery_state_history', 'recovery_runs',
    'recovery_previews', 'plan_versions'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_own_select', table_name);
    execute format(
      'create policy %I on public.%I for select using (user_id = auth.uid())',
      table_name || '_own_select', table_name
    );
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all privileges on table public.%I to service_role', table_name);
  end loop;
end;
$$;

create or replace function public.persist_recovery_changes(
  p_user_id uuid,
  p_expected_academic_revision integer,
  p_expected_plan_version integer,
  p_user_state jsonb default null,
  p_academic_events jsonb default '[]'::jsonb,
  p_academic_state_snapshots jsonb default '[]'::jsonb,
  p_topic_recovery_states jsonb default '[]'::jsonb,
  p_topic_recovery_state_history jsonb default '[]'::jsonb,
  p_recovery_runs jsonb default '[]'::jsonb,
  p_recovery_previews jsonb default '[]'::jsonb,
  p_plan_versions jsonb default '[]'::jsonb,
  p_background_jobs jsonb default '[]'::jsonb
)
returns table (academic_revision integer, plan_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.recovery_user_state%rowtype;
  v_row jsonb;
  v_payload jsonb;
  v_academic_revision integer;
  v_plan_version integer;
  v_lease_expires timestamptz;
begin
  if p_user_id is null or p_expected_academic_revision is null or p_expected_plan_version is null then
    raise exception 'RECOVERY_CONCURRENCY_CONFLICT';
  end if;
  if jsonb_typeof(coalesce(p_academic_events, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_academic_state_snapshots, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_topic_recovery_states, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_topic_recovery_state_history, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_recovery_runs, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_recovery_previews, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_plan_versions, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_background_jobs, '[]'::jsonb)) <> 'array'
  then
    raise exception 'RECOVERY_PLAN_INFEASIBLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':adaptive_recovery', 0));
  insert into public.recovery_user_state (id, user_id, payload, created_at, updated_at)
  values (
    'recovery_user_state:' || p_user_id::text,
    p_user_id,
    jsonb_build_object(
      'id', 'recovery_user_state:' || p_user_id::text,
      'userId', p_user_id::text,
      'academicRevision', 0,
      'snapshotVersion', 0,
      'planVersion', 0,
      'currentSnapshotId', null,
      'currentPlanId', null,
      'mutationLeaseToken', null,
      'mutationLeaseExpiresAt', null,
      'updatedAt', now()
    ),
    now(),
    now()
  ) on conflict (user_id) do nothing;

  select * into v_state from public.recovery_user_state where user_id = p_user_id for update;
  v_academic_revision := coalesce((v_state.payload->>'academicRevision')::integer, 0);
  v_plan_version := coalesce((v_state.payload->>'planVersion')::integer, 0);
  v_lease_expires := nullif(v_state.payload->>'mutationLeaseExpiresAt', '')::timestamptz;
  if v_academic_revision <> p_expected_academic_revision or v_plan_version <> p_expected_plan_version then
    raise exception 'RECOVERY_CONCURRENCY_CONFLICT';
  end if;
  if v_lease_expires is not null and v_lease_expires > now() then
    raise exception 'RECOVERY_CONCURRENCY_CONFLICT';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_academic_events, '[]'::jsonb)) loop
    if coalesce(v_row->>'id', '') = '' or v_row->>'userId' <> p_user_id::text then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
    insert into public.academic_events (id, user_id, payload, created_at, updated_at)
    values (v_row->>'id', p_user_id, v_row, coalesce(nullif(v_row->>'createdAt', '')::timestamptz, now()), now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now()
      where academic_events.user_id = p_user_id;
    if not found then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_academic_state_snapshots, '[]'::jsonb)) loop
    if coalesce(v_row->>'id', '') = '' or v_row->>'userId' <> p_user_id::text then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
    insert into public.academic_state_snapshots (id, user_id, payload, created_at, updated_at)
    values (v_row->>'id', p_user_id, v_row, coalesce(nullif(v_row->>'createdAt', '')::timestamptz, now()), now())
    on conflict (id) do nothing;
    if not found and not exists (
      select 1 from public.academic_state_snapshots where id = v_row->>'id' and user_id = p_user_id and payload = v_row
    ) then raise exception 'RECOVERY_CONCURRENCY_CONFLICT'; end if;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_topic_recovery_states, '[]'::jsonb)) loop
    if coalesce(v_row->>'id', '') = '' or v_row->>'userId' <> p_user_id::text then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
    insert into public.topic_recovery_states (id, user_id, payload, created_at, updated_at)
    values (v_row->>'id', p_user_id, v_row, coalesce(nullif(v_row->>'firstObservedAt', '')::timestamptz, now()), now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now()
      where topic_recovery_states.user_id = p_user_id;
    if not found then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_topic_recovery_state_history, '[]'::jsonb)) loop
    if coalesce(v_row->>'id', '') = '' or v_row->>'userId' <> p_user_id::text then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
    insert into public.topic_recovery_state_history (id, user_id, payload, created_at, updated_at)
    values (v_row->>'id', p_user_id, v_row, coalesce(nullif(v_row->>'createdAt', '')::timestamptz, now()), now())
    on conflict (id) do nothing;
    if not found and not exists (
      select 1 from public.topic_recovery_state_history where id = v_row->>'id' and user_id = p_user_id and payload = v_row
    ) then raise exception 'RECOVERY_CONCURRENCY_CONFLICT'; end if;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_recovery_runs, '[]'::jsonb)) loop
    if coalesce(v_row->>'id', '') = '' or v_row->>'userId' <> p_user_id::text then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
    insert into public.recovery_runs (id, user_id, payload, created_at, updated_at)
    values (v_row->>'id', p_user_id, v_row, coalesce(nullif(v_row->>'createdAt', '')::timestamptz, now()), now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now()
      where recovery_runs.user_id = p_user_id;
    if not found then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_recovery_previews, '[]'::jsonb)) loop
    if coalesce(v_row->>'id', '') = '' or v_row->>'userId' <> p_user_id::text then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
    insert into public.recovery_previews (id, user_id, payload, created_at, updated_at)
    values (v_row->>'id', p_user_id, v_row, coalesce(nullif(v_row->>'createdAt', '')::timestamptz, now()), now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now()
      where recovery_previews.user_id = p_user_id;
    if not found then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_plan_versions, '[]'::jsonb)) loop
    if coalesce(v_row->>'id', '') = '' or v_row->>'userId' <> p_user_id::text then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
    insert into public.plan_versions (id, user_id, payload, created_at, updated_at)
    values (v_row->>'id', p_user_id, v_row, coalesce(nullif(v_row->>'createdAt', '')::timestamptz, now()), now())
    on conflict (id) do nothing;
    if not found and not exists (
      select 1 from public.plan_versions where id = v_row->>'id' and user_id = p_user_id and payload = v_row
    ) then raise exception 'RECOVERY_CONCURRENCY_CONFLICT'; end if;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_background_jobs, '[]'::jsonb)) loop
    if coalesce(v_row->>'id', '') = '' or v_row->>'userId' <> p_user_id::text
      or v_row->>'jobType' <> 'recovery_analysis' or coalesce(v_row->>'status', 'queued') <> 'queued'
      or coalesce((v_row->>'attempts')::integer, 0) <> 0
    then raise exception 'RECOVERY_PLAN_INFEASIBLE'; end if;
    insert into public.background_jobs (
      id, user_id, source_id, job_type, status, attempts, max_attempts, last_error,
      locked_at, processed_at, payload, created_at, updated_at
    ) values (
      v_row->>'id', p_user_id, nullif(v_row->>'sourceId', ''), 'recovery_analysis', 'queued', 0,
      greatest(1, least(10, coalesce((v_row->>'maxAttempts')::integer, 3))), null, null, null,
      v_row, coalesce(nullif(v_row->>'createdAt', '')::timestamptz, now()), now()
    ) on conflict (id) do nothing;
    if not found and not exists (
      select 1 from public.background_jobs where id = v_row->>'id' and user_id = p_user_id and payload = v_row
    ) then raise exception 'RECOVERY_CONCURRENCY_CONFLICT'; end if;
  end loop;

  if p_user_state is not null then
    if jsonb_typeof(p_user_state) <> 'object'
      or p_user_state->>'userId' <> p_user_id::text
      or p_user_state->>'id' <> v_state.id
      or coalesce((p_user_state->>'academicRevision')::integer, -1) not between p_expected_academic_revision and p_expected_academic_revision + 1
      or coalesce((p_user_state->>'planVersion')::integer, -1) not between p_expected_plan_version and p_expected_plan_version + 1
    then raise exception 'RECOVERY_PLAN_INFEASIBLE'; end if;
    v_payload := (p_user_state - 'mutationLeaseToken' - 'mutationLeaseExpiresAt')
      || jsonb_build_object(
        'mutationLeaseToken', v_state.payload->'mutationLeaseToken',
        'mutationLeaseExpiresAt', v_state.payload->'mutationLeaseExpiresAt'
      );
    update public.recovery_user_state set payload = v_payload, updated_at = now() where user_id = p_user_id;
    v_academic_revision := coalesce((v_payload->>'academicRevision')::integer, v_academic_revision);
    v_plan_version := coalesce((v_payload->>'planVersion')::integer, v_plan_version);
  end if;

  return query select v_academic_revision, v_plan_version;
end;
$$;

revoke all on function public.persist_recovery_changes(
  uuid, integer, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_recovery_changes(
  uuid, integer, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to service_role;

create or replace function public.recovery_permission_posture()
returns table (
  recovery_table text,
  authenticated_select boolean,
  authenticated_insert boolean,
  authenticated_update boolean,
  authenticated_delete boolean,
  service_role_select boolean,
  service_role_insert boolean,
  service_role_update boolean,
  service_role_delete boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'recovery_user_state', 'academic_events', 'academic_state_snapshots',
    'topic_recovery_states', 'topic_recovery_state_history', 'recovery_runs',
    'recovery_previews', 'plan_versions'
  ] loop
    return query select
      table_name,
      has_table_privilege('authenticated', 'public.' || table_name, 'SELECT'),
      has_table_privilege('authenticated', 'public.' || table_name, 'INSERT'),
      has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE'),
      has_table_privilege('authenticated', 'public.' || table_name, 'DELETE'),
      has_table_privilege('service_role', 'public.' || table_name, 'SELECT'),
      has_table_privilege('service_role', 'public.' || table_name, 'INSERT'),
      has_table_privilege('service_role', 'public.' || table_name, 'UPDATE'),
      has_table_privilege('service_role', 'public.' || table_name, 'DELETE');
  end loop;
end;
$$;

revoke all on function public.recovery_permission_posture() from public, anon, authenticated;
grant execute on function public.recovery_permission_posture() to service_role;

commit;
