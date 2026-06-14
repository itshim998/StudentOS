-- StudentOS Pass 10 background jobs
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.

create table if not exists public.background_jobs (
  id text primary key,
  user_id uuid not null,
  source_id text,
  job_type text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  last_error text,
  locked_at timestamptz,
  processed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint background_jobs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  constraint background_jobs_type_check
    check (job_type in ('source_ingestion', 'source_reindex', 'embedding_reindex'))
);

create index if not exists background_jobs_user_status_idx
  on public.background_jobs (user_id, status, created_at);

create index if not exists background_jobs_user_source_idx
  on public.background_jobs (user_id, source_id, status);

create index if not exists background_jobs_runnable_idx
  on public.background_jobs (status, created_at)
  where status = 'queued';

alter table public.background_jobs enable row level security;

drop policy if exists background_jobs_own on public.background_jobs;
create policy background_jobs_own
  on public.background_jobs
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.background_jobs to authenticated;
grant all on public.background_jobs to service_role;
