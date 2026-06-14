-- StudentOS Pass 3 auth project metadata
-- RUN ON: Project 1 only.
-- Project 1 remains the AUTH project: login/signup/session/JWT only.
-- Academic data belongs on Projects 2, 3, and 4.

create extension if not exists pgcrypto;

create table if not exists public.studentos_auth_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  workspace_email text,
  workspace_connected boolean not null default false,
  preferred_data_region text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.studentos_auth_profiles enable row level security;

drop policy if exists studentos_auth_profiles_own on public.studentos_auth_profiles;
create policy studentos_auth_profiles_own
  on public.studentos_auth_profiles
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.studentos_auth_profiles from public;
revoke all on public.studentos_auth_profiles from anon;
grant select, insert, update on public.studentos_auth_profiles to authenticated;
grant all on public.studentos_auth_profiles to service_role;
