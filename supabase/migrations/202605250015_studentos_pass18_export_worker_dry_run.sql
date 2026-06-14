-- StudentOS Pass 18 export delivery and deletion dry-run support.
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- Export objects remain private and backend-mediated.

alter table public.data_export_requests
  add column if not exists package_size_bytes bigint,
  add column if not exists package_sha256 text,
  add column if not exists ready_at timestamptz,
  add column if not exists downloaded_at timestamptz;

alter table public.data_export_requests
  alter column status set default 'queued';

alter table public.data_export_requests
  drop constraint if exists data_export_requests_status_check;

alter table public.data_export_requests
  add constraint data_export_requests_status_check
  check (status in ('requested', 'queued', 'processing', 'ready', 'failed', 'cancelled', 'expired'));

alter table public.account_deletion_requests
  add column if not exists dry_run_generated_at timestamptz,
  add column if not exists dry_run_report jsonb not null default '{}'::jsonb;

create index if not exists data_export_requests_user_status_idx
  on public.data_export_requests (user_id, status, created_at desc);

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
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         last_error = coalesce(last_error, 'worker_lock_timeout'),
         payload = payload - 'lockedAt',
         updated_at = now()
   where status = 'processing'
     and (payload->>'lockedAt')::timestamptz < now() - make_interval(secs => v_timeout_seconds);

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
         attempts = attempts + 1,
         payload = jsonb_set(
           jsonb_set(
             jsonb_set(payload, '{workerId}', to_jsonb(v_worker_id), true),
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
