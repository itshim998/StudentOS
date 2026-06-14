-- StudentOS Pass 12 worker observability
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.

create table if not exists public.job_events (
  id text primary key,
  user_id uuid not null,
  job_id text,
  source_id text,
  event_type text not null,
  severity text not null default 'info',
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_events_type_check
    check (event_type in ('queued', 'claimed', 'retry', 'failed', 'completed', 'cancelled', 'cleanup')),
  constraint job_events_severity_check
    check (severity in ('debug', 'info', 'warn', 'error'))
);

create index if not exists job_events_user_created_idx
  on public.job_events (user_id, created_at desc);

create index if not exists job_events_job_idx
  on public.job_events (job_id, created_at desc);

create index if not exists job_events_source_idx
  on public.job_events (user_id, source_id, created_at desc);

alter table public.job_events enable row level security;

revoke all on public.job_events from public;
revoke all on public.job_events from anon;

drop policy if exists job_events_own on public.job_events;
create policy job_events_own
  on public.job_events
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.job_events to authenticated;
grant all on public.job_events to service_role;
