-- StudentOS Pass 24 Google Classroom persistent token metadata and sync history
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- Tokens are encrypted by the backend before storage. Browser clients must not access these tables.

create table if not exists public.classroom_tokens (
  id text primary key,
  user_id uuid not null,
  provider text not null default 'google_classroom',
  provider_account_email text,
  scopes text[] not null default '{}'::text[],
  token_status text not null default 'connected',
  encrypted_access_token text,
  encrypted_refresh_token text,
  encryption_key_id text,
  token_created_at timestamptz not null default now(),
  token_updated_at timestamptz not null default now(),
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  last_refresh_at timestamptz,
  disconnected_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classroom_tokens_provider_check
    check (provider in ('google_classroom')),
  constraint classroom_tokens_status_check
    check (token_status in ('connected', 'expired', 'error', 'disconnected'))
);

create unique index if not exists classroom_tokens_user_provider_idx
  on public.classroom_tokens (user_id, provider);

create index if not exists classroom_tokens_user_status_idx
  on public.classroom_tokens (user_id, token_status);

create table if not exists public.classroom_sync_runs (
  id text primary key,
  user_id uuid not null,
  provider text not null default 'google_classroom',
  status text not null default 'queued',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  imported_courses integer not null default 0,
  updated_courses integer not null default 0,
  imported_assignments integer not null default 0,
  updated_assignments integer not null default 0,
  imported_materials integer not null default 0,
  updated_materials integer not null default 0,
  skipped_items integer not null default 0,
  error_count integer not null default 0,
  error_summary text,
  read_only boolean not null default true,
  writeback_enabled boolean not null default false,
  provider_account_email text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classroom_sync_runs_provider_check
    check (provider in ('google_classroom', 'google_classroom_mock')),
  constraint classroom_sync_runs_status_check
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled'))
);

create index if not exists classroom_sync_runs_user_started_idx
  on public.classroom_sync_runs (user_id, started_at desc);

alter table public.classroom_tokens enable row level security;
alter table public.classroom_sync_runs enable row level security;

revoke all on public.classroom_tokens from public;
revoke all on public.classroom_tokens from anon;
revoke all on public.classroom_tokens from authenticated;
grant all on public.classroom_tokens to service_role;

revoke all on public.classroom_sync_runs from public;
revoke all on public.classroom_sync_runs from anon;
revoke all on public.classroom_sync_runs from authenticated;
grant all on public.classroom_sync_runs to service_role;
