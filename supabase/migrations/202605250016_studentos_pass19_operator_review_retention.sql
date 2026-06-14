-- StudentOS Pass 19 export retention and operator review safety.
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- Final account deletion remains disabled. These records are review scaffolds only.

alter table public.data_export_requests
  add column if not exists retention_expires_at timestamptz,
  add column if not exists package_deleted_at timestamptz,
  add column if not exists cleanup_status text not null default 'pending';

alter table public.data_export_requests
  drop constraint if exists data_export_requests_cleanup_status_check;

alter table public.data_export_requests
  add constraint data_export_requests_cleanup_status_check
  check (cleanup_status in ('pending', 'retained', 'deleted', 'failed'));

create index if not exists data_export_requests_retention_idx
  on public.data_export_requests (retention_expires_at asc)
  where storage_path is not null and package_deleted_at is null;

create table if not exists public.account_deletion_reviews (
  id text primary key,
  user_id uuid not null,
  deletion_request_id text not null references public.account_deletion_requests(id) on delete cascade,
  review_type text not null,
  decision text not null,
  operator_id text,
  operator_note text,
  dry_run_report jsonb not null default '{}'::jsonb,
  dry_run_diff jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_deletion_reviews_type_check
    check (review_type in ('dry_run', 'approval', 'rejection', 'note')),
  constraint account_deletion_reviews_decision_check
    check (decision in ('dry_run', 'approve_scaffold', 'reject', 'note'))
);

create index if not exists account_deletion_reviews_user_request_idx
  on public.account_deletion_reviews (user_id, deletion_request_id, created_at desc);

alter table public.account_deletion_reviews enable row level security;

revoke all on public.account_deletion_reviews from public;
revoke all on public.account_deletion_reviews from anon;
revoke all on public.account_deletion_reviews from authenticated;
grant all on public.account_deletion_reviews to service_role;

-- This targeted RPC exists for isolated live verification only. It cannot claim
-- another user's export job while an operator checks the deployment.
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
         attempts = attempts + 1,
         payload = jsonb_set(
           jsonb_set(
             jsonb_set(payload, '{workerId}', to_jsonb(coalesce(nullif(p_worker_id, ''), 'studentos-export-verifier')), true),
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
