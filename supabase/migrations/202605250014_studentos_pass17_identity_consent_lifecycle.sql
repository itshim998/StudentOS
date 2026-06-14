-- StudentOS Pass 17 identity, consent, export, deletion, and role-ready lifecycle records.
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- Browser clients do not access data shards directly. Backend service-role writes remain required.

create table if not exists public.consent_versions (
  id text primary key,
  user_id uuid not null,
  privacy_version text not null,
  terms_version text not null,
  consent_schema_version text not null,
  status text not null default 'active',
  effective_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consent_versions_status_check check (status in ('active', 'superseded'))
);

create index if not exists consent_versions_user_status_idx on public.consent_versions (user_id, status);

create table if not exists public.user_consents (
  id text primary key,
  user_id uuid not null,
  consent_version_id text not null references public.consent_versions(id) on delete cascade,
  consent_key text not null,
  granted boolean not null default false,
  status text not null default 'declined',
  withdrawn_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_consents_status_check check (status in ('granted', 'declined', 'withdrawal_requested', 'withdrawn', 'superseded'))
);

create index if not exists user_consents_user_version_idx on public.user_consents (user_id, consent_version_id);

create table if not exists public.legal_acceptances (
  id text primary key,
  user_id uuid not null,
  privacy_version text not null,
  terms_version text not null,
  consent_schema_version text not null,
  acceptance_source text not null default 'account_settings',
  accepted_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists legal_acceptances_user_versions_idx on public.legal_acceptances (user_id, privacy_version, terms_version);

create table if not exists public.data_export_requests (
  id text primary key,
  user_id uuid not null,
  status text not null default 'requested',
  scope text not null default 'student_owned_data',
  format text not null default 'json',
  delivery text not null default 'manual_review_required',
  requested_at timestamptz not null default now(),
  expires_at timestamptz,
  storage_bucket text,
  storage_path text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_export_requests_status_check check (status in ('requested', 'processing', 'ready', 'failed', 'cancelled', 'expired'))
);

create index if not exists data_export_requests_user_created_idx on public.data_export_requests (user_id, created_at desc);

create table if not exists public.data_export_jobs (
  id text primary key,
  user_id uuid not null,
  export_request_id text not null references public.data_export_requests(id) on delete cascade,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  last_error text,
  processed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_export_jobs_status_check check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled'))
);

create index if not exists data_export_jobs_status_created_idx on public.data_export_jobs (status, created_at);

create table if not exists public.account_deletion_requests (
  id text primary key,
  user_id uuid not null,
  status text not null default 'requested',
  reason text not null default 'student_request',
  requested_at timestamptz not null default now(),
  grace_period_ends_at timestamptz not null,
  reviewed_at timestamptz,
  final_delete_allowed boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_deletion_requests_status_check check (status in ('requested', 'review_pending', 'approved', 'cancelled', 'completed'))
);

create index if not exists account_deletion_requests_user_created_idx on public.account_deletion_requests (user_id, created_at desc);

create table if not exists public.role_invitations (
  id text primary key,
  user_id uuid not null,
  invite_email text,
  role text not null,
  status text not null default 'disabled',
  enabled boolean not null default false,
  student_consent_required boolean not null default true,
  explicit_student_consent boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_invitations_role_check check (role in ('guardian_future', 'teacher_future', 'institution_future')),
  constraint role_invitations_status_check check (status in ('disabled', 'requested', 'cancelled', 'accepted', 'expired'))
);

create index if not exists role_invitations_user_created_idx on public.role_invitations (user_id, created_at desc);

alter table public.consent_versions enable row level security;
alter table public.user_consents enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.data_export_requests enable row level security;
alter table public.data_export_jobs enable row level security;
alter table public.account_deletion_requests enable row level security;
alter table public.role_invitations enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'consent_versions',
    'user_consents',
    'legal_acceptances',
    'data_export_requests',
    'data_export_jobs',
    'account_deletion_requests',
    'role_invitations'
  ]
  loop
    execute format('revoke all on public.%I from public', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('revoke all on public.%I from authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end
$$;

drop policy if exists consent_versions_own_read on public.consent_versions;
create policy consent_versions_own_read on public.consent_versions for select using (user_id = auth.uid());
drop policy if exists user_consents_own_read on public.user_consents;
create policy user_consents_own_read on public.user_consents for select using (user_id = auth.uid());
drop policy if exists legal_acceptances_own_read on public.legal_acceptances;
create policy legal_acceptances_own_read on public.legal_acceptances for select using (user_id = auth.uid());
drop policy if exists data_export_requests_own_read on public.data_export_requests;
create policy data_export_requests_own_read on public.data_export_requests for select using (user_id = auth.uid());
drop policy if exists account_deletion_requests_own_read on public.account_deletion_requests;
create policy account_deletion_requests_own_read on public.account_deletion_requests for select using (user_id = auth.uid());
drop policy if exists role_invitations_own_read on public.role_invitations;
create policy role_invitations_own_read on public.role_invitations for select using (user_id = auth.uid());

grant select on public.consent_versions to authenticated;
grant select on public.user_consents to authenticated;
grant select on public.legal_acceptances to authenticated;
grant select on public.data_export_requests to authenticated;
grant select on public.account_deletion_requests to authenticated;
grant select on public.role_invitations to authenticated;
