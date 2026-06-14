-- StudentOS control database schema
-- RUN ON: Database 1 only.
-- Purpose: preserve SentIQGPT-style sharding with a StudentOS-specific user-to-shard map.

create extension if not exists pgcrypto;

create table if not exists public.studentos_user_shard_map (
  user_id uuid primary key references auth.users (id) on delete cascade,
  assigned_db integer not null check (assigned_db in (2, 3, 4)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists studentos_user_shard_map_assigned_db_idx
  on public.studentos_user_shard_map (assigned_db);

alter table public.studentos_user_shard_map enable row level security;

revoke all on table public.studentos_user_shard_map from public;
revoke all on table public.studentos_user_shard_map from anon;
revoke all on table public.studentos_user_shard_map from authenticated;
grant all on table public.studentos_user_shard_map to service_role;

create table if not exists public.studentos_control_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high', 'critical')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.studentos_control_audit_log enable row level security;
revoke all on table public.studentos_control_audit_log from public;
revoke all on table public.studentos_control_audit_log from anon;
revoke all on table public.studentos_control_audit_log from authenticated;
grant all on table public.studentos_control_audit_log to service_role;
