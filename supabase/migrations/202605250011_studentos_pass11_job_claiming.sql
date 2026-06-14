-- StudentOS Pass 11 safer background job claiming
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- This function is for backend/service-role workers only.

create or replace function public.claim_next_background_job(
  p_worker_id text default 'studentos-worker',
  p_lock_timeout_seconds integer default 600
)
returns table (
  id text,
  user_id uuid,
  source_id text,
  job_type text,
  status text,
  attempts integer,
  max_attempts integer,
  last_error text,
  locked_at timestamptz,
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
  v_worker_id text := coalesce(nullif(p_worker_id, ''), 'studentos-worker');
  v_timeout_seconds integer := greatest(coalesce(p_lock_timeout_seconds, 600), 30);
begin
  update public.background_jobs
     set status = case
       when attempts >= max_attempts then 'failed'
       else 'queued'
     end,
     locked_at = null,
     last_error = coalesce(last_error, 'worker_lock_timeout'),
     updated_at = now()
   where status = 'processing'
     and locked_at is not null
     and locked_at < now() - make_interval(secs => v_timeout_seconds);

  select background_jobs.id
    into v_job_id
    from public.background_jobs
   where background_jobs.status = 'queued'
     and background_jobs.attempts < background_jobs.max_attempts
   order by background_jobs.created_at asc
   for update skip locked
   limit 1;

  if v_job_id is null then
    return;
  end if;

  return query
  update public.background_jobs
     set status = 'processing',
         attempts = attempts + 1,
         locked_at = now(),
         payload = jsonb_set(
           jsonb_set(payload, '{workerId}', to_jsonb(v_worker_id), true),
           '{claimMode}', to_jsonb('rpc'::text), true
         ),
         updated_at = now()
   where background_jobs.id = v_job_id
   returning
     background_jobs.id,
     background_jobs.user_id,
     background_jobs.source_id,
     background_jobs.job_type,
     background_jobs.status,
     background_jobs.attempts,
     background_jobs.max_attempts,
     background_jobs.last_error,
     background_jobs.locked_at,
     background_jobs.processed_at,
     background_jobs.payload,
     background_jobs.created_at,
     background_jobs.updated_at;
end;
$$;

revoke all on function public.claim_next_background_job(text, integer) from public;
revoke all on function public.claim_next_background_job(text, integer) from anon;
revoke all on function public.claim_next_background_job(text, integer) from authenticated;
grant execute on function public.claim_next_background_job(text, integer) to service_role;
