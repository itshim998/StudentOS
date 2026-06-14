-- StudentOS Pass 20 final deletion safety architecture.
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- This migration does not add a SQL account-deletion executor.
-- Irreversible deletion stays backend-mediated and disabled by default.

alter table public.account_deletion_requests
  add column if not exists final_execution_status text not null default 'not_started',
  add column if not exists last_execution_evidence_id text;

alter table public.account_deletion_requests
  drop constraint if exists account_deletion_requests_final_execution_status_check;

alter table public.account_deletion_requests
  add constraint account_deletion_requests_final_execution_status_check
  check (final_execution_status in ('not_started', 'blocked', 'authorized', 'completed', 'partial_failure'));

create unique index if not exists account_deletion_reviews_distinct_operator_approval_idx
  on public.account_deletion_reviews (deletion_request_id, operator_id)
  where decision = 'approve_scaffold' and operator_id is not null;

create table if not exists public.deletion_execution_evidence (
  id text primary key,
  user_id uuid not null,
  deletion_request_id text not null,
  evidence_type text not null,
  status text not null,
  approvals jsonb not null default '[]'::jsonb,
  dry_run_report jsonb not null default '{}'::jsonb,
  dry_run_diff jsonb not null default '{}'::jsonb,
  affected_counts jsonb not null default '{}'::jsonb,
  billing_policy jsonb not null default '{}'::jsonb,
  auth_deletion jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint deletion_execution_evidence_type_check
    check (evidence_type in ('blocked_attempt', 'execution_started', 'execution_completed', 'partial_failure')),
  constraint deletion_execution_evidence_status_check
    check (status in ('blocked', 'authorized', 'completed', 'partial_failure'))
);

create index if not exists deletion_execution_evidence_user_request_idx
  on public.deletion_execution_evidence (user_id, deletion_request_id, created_at desc);

alter table public.deletion_execution_evidence enable row level security;

revoke all on public.deletion_execution_evidence from public;
revoke all on public.deletion_execution_evidence from anon;
revoke all on public.deletion_execution_evidence from authenticated;
grant select, insert on public.deletion_execution_evidence to service_role;

create or replace function public.reject_deletion_execution_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'deletion_execution_evidence is append-only';
end;
$$;

drop trigger if exists deletion_execution_evidence_append_only_update on public.deletion_execution_evidence;
create trigger deletion_execution_evidence_append_only_update
  before update on public.deletion_execution_evidence
  for each row execute function public.reject_deletion_execution_evidence_mutation();

drop trigger if exists deletion_execution_evidence_append_only_delete on public.deletion_execution_evidence;
create trigger deletion_execution_evidence_append_only_delete
  before delete on public.deletion_execution_evidence
  for each row execute function public.reject_deletion_execution_evidence_mutation();

-- Repair Pass 18 RPC ambiguity by qualifying table columns.
create or replace function public.claim_next_data_export_job(
  p_worker_id text default 'studentos-export-worker',
  p_lock_timeout_seconds integer default 600
)
returns table (
  id text,
  user_id uuid,
  export_request_id text,
  status text,
  attempts integer,
  max_attempts integer,
  last_error text,
  processed_at timestamptz,
  payload jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id text;
  v_worker_id text := coalesce(nullif(p_worker_id, ''), 'studentos-export-worker');
  v_timeout_seconds integer := greatest(coalesce(p_lock_timeout_seconds, 600), 30);
begin
  update public.data_export_jobs
     set status = case
       when data_export_jobs.attempts >= data_export_jobs.max_attempts then 'failed'
       else 'queued'
     end,
         last_error = coalesce(data_export_jobs.last_error, 'worker_lock_timeout'),
         payload = data_export_jobs.payload - 'lockedAt',
         updated_at = now()
   where data_export_jobs.status = 'processing'
     and (data_export_jobs.payload->>'lockedAt')::timestamptz < now() - make_interval(secs => v_timeout_seconds);

  select data_export_jobs.id
    into v_job_id
    from public.data_export_jobs
   where data_export_jobs.status = 'queued'
     and data_export_jobs.attempts < data_export_jobs.max_attempts
   order by data_export_jobs.created_at asc
   for update skip locked
   limit 1;

  if v_job_id is null then
    return;
  end if;

  return query
  update public.data_export_jobs
     set status = 'processing',
         attempts = data_export_jobs.attempts + 1,
         payload = jsonb_set(
           jsonb_set(
             jsonb_set(data_export_jobs.payload, '{workerId}', to_jsonb(v_worker_id), true),
             '{claimMode}', to_jsonb('rpc'::text), true
           ),
           '{lockedAt}', to_jsonb(now()::text), true
         ),
         updated_at = now()
   where data_export_jobs.id = v_job_id
   returning
     data_export_jobs.id,
     data_export_jobs.user_id,
     data_export_jobs.export_request_id,
     data_export_jobs.status,
     data_export_jobs.attempts,
     data_export_jobs.max_attempts,
     data_export_jobs.last_error,
     data_export_jobs.processed_at,
     data_export_jobs.payload,
     data_export_jobs.created_at,
     data_export_jobs.updated_at;
end;
$$;

revoke all on function public.claim_next_data_export_job(text, integer) from public;
revoke all on function public.claim_next_data_export_job(text, integer) from anon;
revoke all on function public.claim_next_data_export_job(text, integer) from authenticated;
grant execute on function public.claim_next_data_export_job(text, integer) to service_role;

-- Repair Pass 19 targeted verifier RPC ambiguity by qualifying table columns.
create or replace function public.claim_data_export_job_by_id(
  p_job_id text,
  p_user_id uuid,
  p_worker_id text default 'studentos-export-verifier'
)
returns table (
  id text,
  user_id uuid,
  export_request_id text,
  status text,
  attempts integer,
  max_attempts integer,
  last_error text,
  processed_at timestamptz,
  payload jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.data_export_jobs
     set status = 'processing',
         attempts = data_export_jobs.attempts + 1,
         payload = jsonb_set(
           jsonb_set(
             jsonb_set(data_export_jobs.payload, '{workerId}', to_jsonb(coalesce(nullif(p_worker_id, ''), 'studentos-export-verifier')), true),
             '{claimMode}', to_jsonb('targeted_rpc'::text), true
           ),
           '{lockedAt}', to_jsonb(now()::text), true
         ),
         updated_at = now()
   where data_export_jobs.id = p_job_id
     and data_export_jobs.user_id = p_user_id
     and data_export_jobs.status = 'queued'
     and data_export_jobs.attempts < data_export_jobs.max_attempts
   returning
     data_export_jobs.id,
     data_export_jobs.user_id,
     data_export_jobs.export_request_id,
     data_export_jobs.status,
     data_export_jobs.attempts,
     data_export_jobs.max_attempts,
     data_export_jobs.last_error,
     data_export_jobs.processed_at,
     data_export_jobs.payload,
     data_export_jobs.created_at,
     data_export_jobs.updated_at;
end;
$$;

revoke all on function public.claim_data_export_job_by_id(text, uuid, text) from public;
revoke all on function public.claim_data_export_job_by_id(text, uuid, text) from anon;
revoke all on function public.claim_data_export_job_by_id(text, uuid, text) from authenticated;
grant execute on function public.claim_data_export_job_by_id(text, uuid, text) to service_role;
