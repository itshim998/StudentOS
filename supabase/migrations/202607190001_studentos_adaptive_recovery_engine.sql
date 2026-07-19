-- StudentOS Build Week: Adaptive Recovery Engine.
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4 only.
-- This migration is additive and the runtime feature remains disabled by default.

begin;

create table if not exists public.recovery_user_state (
  id text primary key,
  user_id uuid not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academic_events (
  id text primary key,
  user_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_events_payload_size check (octet_length(payload::text) <= 32768)
);

create table if not exists public.academic_state_snapshots (
  id text primary key,
  user_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_state_snapshots_payload_size check (octet_length(payload::text) <= 524288)
);

create table if not exists public.topic_recovery_states (
  id text primary key,
  user_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.topic_recovery_state_history (
  id text primary key,
  user_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recovery_runs (
  id text primary key,
  user_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recovery_runs_payload_size check (octet_length(payload::text) <= 262144)
);

create table if not exists public.recovery_previews (
  id text primary key,
  user_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recovery_previews_payload_size check (octet_length(payload::text) <= 524288)
);

create table if not exists public.plan_versions (
  id text primary key,
  user_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_versions_payload_size check (octet_length(payload::text) <= 524288)
);

create unique index if not exists academic_events_user_idempotency_idx
  on public.academic_events (user_id, (payload->>'idempotencyKey'));
create index if not exists academic_events_unprocessed_idx
  on public.academic_events (user_id, ((payload->>'processedAt') is null), created_at);
create unique index if not exists academic_snapshots_user_version_idx
  on public.academic_state_snapshots (user_id, ((payload->>'version')::integer));
create unique index if not exists academic_snapshots_user_fingerprint_idx
  on public.academic_state_snapshots (user_id, (payload->>'fingerprint'));
create unique index if not exists topic_recovery_states_user_topic_idx
  on public.topic_recovery_states (user_id, (payload->>'topicId'));
create unique index if not exists recovery_runs_user_idempotency_idx
  on public.recovery_runs (user_id, (payload->>'idempotencyKey'));
create unique index if not exists recovery_runs_one_active_snapshot_idx
  on public.recovery_runs (user_id, (payload->>'currentSnapshotId'))
  where payload->>'status' in ('queued', 'building_state', 'reasoning', 'validating', 'planning');
create unique index if not exists recovery_previews_one_per_run_idx
  on public.recovery_previews (user_id, (payload->>'runId'));
create unique index if not exists recovery_previews_one_successful_apply_idx
  on public.recovery_previews (user_id, (payload->>'appliedPlanId'))
  where payload->>'status' = 'applied' and payload->>'appliedPlanId' is not null;
create unique index if not exists recovery_previews_user_mutation_idempotency_idx
  on public.recovery_previews (user_id, (coalesce(payload->>'applyIdempotencyKey', payload->>'rejectIdempotencyKey')))
  where payload->>'applyIdempotencyKey' is not null or payload->>'rejectIdempotencyKey' is not null;
create unique index if not exists plan_versions_user_version_idx
  on public.plan_versions (user_id, ((payload->>'version')::integer));
create unique index if not exists plan_versions_one_recovery_preview_idx
  on public.plan_versions (user_id, (payload->>'recoveryPreviewId'))
  where payload->>'recoveryPreviewId' is not null;

alter table public.background_jobs drop constraint if exists background_jobs_type_check;
alter table public.background_jobs add constraint background_jobs_type_check
  check (job_type in ('source_ingestion', 'source_reindex', 'embedding_reindex', 'recovery_analysis'));

create or replace function public.reject_recovery_immutable_update()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id or new.payload is distinct from old.payload then
    raise exception 'recovery_record_is_immutable';
  end if;
  return new;
end;
$$;

create or replace function public.acquire_recovery_mutation_lease(
  p_user_id uuid,
  p_lease_token text,
  p_expected_academic_revision integer default null,
  p_expected_plan_version integer default null,
  p_lease_seconds integer default 30
)
returns table (acquired boolean, conflict_reason text, academic_revision integer, plan_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.recovery_user_state%rowtype;
  v_revision integer;
  v_plan_version integer;
  v_lease_expires timestamptz;
begin
  if coalesce(p_lease_token, '') = '' then raise exception 'RECOVERY_CONCURRENCY_CONFLICT'; end if;
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
      'mutationLeaseExpiresAt', null
    ),
    now(),
    now()
  ) on conflict (user_id) do nothing;

  select * into v_state from public.recovery_user_state where user_id = p_user_id for update;
  v_revision := coalesce((v_state.payload->>'academicRevision')::integer, 0);
  v_plan_version := coalesce((v_state.payload->>'planVersion')::integer, 0);
  v_lease_expires := nullif(v_state.payload->>'mutationLeaseExpiresAt', '')::timestamptz;

  if p_expected_academic_revision is not null and v_revision <> p_expected_academic_revision then
    return query select false, 'academic_revision', v_revision, v_plan_version;
    return;
  end if;
  if p_expected_plan_version is not null and v_plan_version <> p_expected_plan_version then
    return query select false, 'plan_version', v_revision, v_plan_version;
    return;
  end if;
  if v_lease_expires is not null and v_lease_expires > now()
    and coalesce(v_state.payload->>'mutationLeaseToken', '') <> p_lease_token then
    return query select false, 'lease_held', v_revision, v_plan_version;
    return;
  end if;

  update public.recovery_user_state
    set payload = jsonb_set(
      jsonb_set(payload, '{mutationLeaseToken}', to_jsonb(p_lease_token), true),
      '{mutationLeaseExpiresAt}', to_jsonb(now() + make_interval(secs => greatest(5, least(120, p_lease_seconds)))),
      true
    ),
    updated_at = now()
    where user_id = p_user_id;
  return query select true, null::text, v_revision, v_plan_version;
end;
$$;

create or replace function public.release_recovery_mutation_lease(p_user_id uuid, p_lease_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.recovery_user_state
    set payload = jsonb_set(
      jsonb_set(payload, '{mutationLeaseToken}', 'null'::jsonb, true),
      '{mutationLeaseExpiresAt}', 'null'::jsonb,
      true
    ),
    updated_at = now()
    where user_id = p_user_id and payload->>'mutationLeaseToken' = p_lease_token;
  return found;
end;
$$;

revoke all on function public.acquire_recovery_mutation_lease(uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.acquire_recovery_mutation_lease(uuid, text, integer, integer, integer) to service_role;
revoke all on function public.release_recovery_mutation_lease(uuid, text) from public, anon, authenticated;
grant execute on function public.release_recovery_mutation_lease(uuid, text) to service_role;

drop trigger if exists academic_state_snapshots_immutable on public.academic_state_snapshots;
create trigger academic_state_snapshots_immutable before update on public.academic_state_snapshots
  for each row execute function public.reject_recovery_immutable_update();
drop trigger if exists topic_recovery_history_immutable on public.topic_recovery_state_history;
create trigger topic_recovery_history_immutable before update on public.topic_recovery_state_history
  for each row execute function public.reject_recovery_immutable_update();
drop trigger if exists plan_versions_immutable on public.plan_versions;
create trigger plan_versions_immutable before update on public.plan_versions
  for each row execute function public.reject_recovery_immutable_update();

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
    execute format(
      'create policy %I on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      table_name || '_own', table_name
    );
    execute format('revoke all on public.%I from public, anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end;
$$;

create or replace function public.apply_recovery_preview(
  p_user_id uuid,
  p_preview_id text,
  p_run_id text,
  p_idempotency_key text,
  p_expected_academic_revision integer,
  p_expected_plan_version integer,
  p_expected_plan_id text,
  p_plan_version_id text,
  p_plan_version integer,
  p_plan_payload jsonb,
  p_daily_plan jsonb,
  p_roadmap_rows jsonb,
  p_topic_recovery_rows jsonb,
  p_topic_recovery_history_rows jsonb,
  p_preview_payload jsonb,
  p_run_payload jsonb,
  p_event_payload jsonb,
  p_audit_payload jsonb,
  p_correlation_id text default null
)
returns table (applied boolean, replayed boolean, plan_version_id text, plan_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_state public.recovery_user_state%rowtype;
  v_preview public.recovery_previews%rowtype;
  v_run public.recovery_runs%rowtype;
  v_roadmap jsonb;
  v_topic jsonb;
  v_history jsonb;
begin
  if coalesce(p_idempotency_key, '') = '' then raise exception 'recovery_idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':adaptive_recovery', 0));

  select * into v_user_state from public.recovery_user_state
    where user_id = p_user_id for update;
  select * into v_preview from public.recovery_previews
    where id = p_preview_id and user_id = p_user_id for update;
  select * into v_run from public.recovery_runs
    where id = p_run_id and user_id = p_user_id for update;

  if v_preview.id is null then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
  if v_run.id is null or v_preview.payload->>'runId' <> p_run_id then raise exception 'RECOVERY_UNAUTHORIZED'; end if;
  if nullif(v_user_state.payload->>'mutationLeaseExpiresAt', '')::timestamptz > now() then
    raise exception 'RECOVERY_CONCURRENCY_CONFLICT';
  end if;
  if v_preview.payload->>'status' = 'applied' then
    if v_preview.payload->>'applyIdempotencyKey' = p_idempotency_key then
      return query select false, true, v_preview.payload->>'appliedPlanId', (v_user_state.payload->>'planVersion')::integer;
      return;
    end if;
    raise exception 'RECOVERY_PREVIEW_ALREADY_APPLIED';
  end if;
  if exists (
    select 1 from public.recovery_runs
      where user_id = p_user_id and payload->>'idempotencyKey' = p_idempotency_key
  ) or exists (
    select 1 from public.recovery_previews
      where user_id = p_user_id and id <> p_preview_id
        and coalesce(payload->>'applyIdempotencyKey', payload->>'rejectIdempotencyKey') = p_idempotency_key
  ) then raise exception 'RECOVERY_IDEMPOTENCY_CONFLICT'; end if;
  if v_preview.payload->>'status' <> 'ready_for_review' then raise exception 'RECOVERY_PREVIEW_STALE'; end if;
  if nullif(v_preview.payload->>'expiresAt', '')::timestamptz <= now() then raise exception 'RECOVERY_PREVIEW_STALE'; end if;
  if v_run.payload->>'status' <> 'ready_for_review' then raise exception 'RECOVERY_PREVIEW_STALE'; end if;
  if coalesce((v_preview.payload->>'academicRevision')::integer, -1) <> p_expected_academic_revision
    or coalesce((v_preview.payload->>'basePlanVersion')::integer, -1) <> p_expected_plan_version
    or coalesce(v_preview.payload->>'basePlanId', '') <> coalesce(p_expected_plan_id, '')
  then raise exception 'RECOVERY_PREVIEW_STALE'; end if;
  if v_user_state.id is null
    or coalesce((v_user_state.payload->>'academicRevision')::integer, 0) <> p_expected_academic_revision
    or coalesce((v_user_state.payload->>'planVersion')::integer, 0) <> p_expected_plan_version
    or coalesce(v_user_state.payload->>'currentPlanId', '') <> coalesce(p_expected_plan_id, '')
  then raise exception 'RECOVERY_PREVIEW_STALE'; end if;
  if p_plan_version <> p_expected_plan_version + 1
    or p_plan_payload->>'id' <> p_plan_version_id
    or coalesce((p_plan_payload->>'version')::integer, -1) <> p_plan_version
    or p_preview_payload->>'status' <> 'applied'
    or p_run_payload->>'status' <> 'applied'
  then raise exception 'RECOVERY_PLAN_INFEASIBLE'; end if;

  insert into public.plan_versions (id, user_id, payload, created_at, updated_at)
  values (p_plan_version_id, p_user_id, p_plan_payload, now(), now());

  update public.student_profiles
    set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{dailyTodoPlan}', p_daily_plan, true),
        updated_at = now()
    where user_id = p_user_id;

  if jsonb_typeof(coalesce(p_roadmap_rows, '[]'::jsonb)) <> 'array' then raise exception 'RECOVERY_PLAN_INFEASIBLE'; end if;
  for v_roadmap in select value from jsonb_array_elements(coalesce(p_roadmap_rows, '[]'::jsonb)) loop
    if coalesce(v_roadmap->>'id', '') = '' then continue; end if;
    insert into public.roadmap_items (
      id, user_id, course_id, topic_id, title, kind, priority, due_at, status, payload, created_at, updated_at
    ) values (
      v_roadmap->>'id', p_user_id, v_roadmap->>'courseId', v_roadmap->>'topicId',
      coalesce(v_roadmap->>'title', 'Recovery work'), coalesce(v_roadmap->>'kind', 'weak_topic_recovery'),
      coalesce(v_roadmap->>'priority', 'medium'), nullif(v_roadmap->>'dueAt', '')::timestamptz,
      coalesce(v_roadmap->>'status', 'open'), v_roadmap, now(), now()
    ) on conflict (id) do update set
      course_id = excluded.course_id, topic_id = excluded.topic_id, title = excluded.title,
      kind = excluded.kind, priority = excluded.priority, due_at = excluded.due_at,
      status = excluded.status, payload = excluded.payload, updated_at = now();
  end loop;

  for v_topic in select value from jsonb_array_elements(coalesce(p_topic_recovery_rows, '[]'::jsonb)) loop
    if coalesce(v_topic->>'id', '') = '' then continue; end if;
    insert into public.topic_recovery_states (id, user_id, payload, created_at, updated_at)
    values (v_topic->>'id', p_user_id, v_topic, now(), now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now();
  end loop;

  for v_history in select value from jsonb_array_elements(coalesce(p_topic_recovery_history_rows, '[]'::jsonb)) loop
    if coalesce(v_history->>'id', '') = '' then continue; end if;
    insert into public.topic_recovery_state_history (id, user_id, payload, created_at, updated_at)
    values (v_history->>'id', p_user_id, v_history, now(), now())
    on conflict (id) do nothing;
  end loop;

  update public.recovery_previews set payload = p_preview_payload, updated_at = now()
    where id = p_preview_id and user_id = p_user_id;
  update public.recovery_runs set payload = p_run_payload, updated_at = now()
    where id = p_run_id and user_id = p_user_id;
  update public.recovery_user_state set
    payload = jsonb_set(
      jsonb_set(
        jsonb_set(payload, '{planVersion}', to_jsonb(p_plan_version), true),
        '{currentPlanId}', to_jsonb(p_plan_version_id), true
      ),
      '{academicRevision}', to_jsonb(p_expected_academic_revision + 1), true
    ),
    updated_at = now()
    where user_id = p_user_id;

  insert into public.academic_events (id, user_id, payload, created_at, updated_at)
  values (p_event_payload->>'id', p_user_id, p_event_payload, now(), now())
  on conflict (id) do nothing;
  insert into public.audit_logs (id, user_id, actor_id, action, target_type, target_id, risk_level, metadata, payload, created_at, updated_at)
  values (
    p_audit_payload->>'id', p_user_id, p_user_id::text, 'recovery.preview_applied',
    'recovery_preview', p_preview_id, 'medium', coalesce(p_audit_payload->'metadata', '{}'::jsonb),
    p_audit_payload, now(), now()
  ) on conflict (id) do nothing;

  return query select true, false, p_plan_version_id, p_plan_version;
end;
$$;

revoke all on function public.apply_recovery_preview(uuid, text, text, text, integer, integer, text, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_recovery_preview(uuid, text, text, text, integer, integer, text, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text) to service_role;

commit;
