-- StudentOS Pass 21 operator RBAC, audit evidence, and billing cancellation safety.
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- Internal operations and irreversible deletion remain disabled by default.

create table if not exists public.operator_audit_events (
  id text primary key,
  target_user_id uuid,
  request_id text not null,
  operator_id text not null,
  operator_role text not null,
  action text not null,
  note text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint operator_audit_events_role_check
    check (operator_role in ('owner', 'support_admin', 'privacy_reviewer', 'billing_operator', 'read_only_auditor'))
);

create index if not exists operator_audit_events_target_created_idx
  on public.operator_audit_events (target_user_id, created_at desc);

create index if not exists operator_audit_events_operator_created_idx
  on public.operator_audit_events (operator_id, created_at desc);

alter table public.operator_audit_events enable row level security;

revoke all on public.operator_audit_events from public;
revoke all on public.operator_audit_events from anon;
revoke all on public.operator_audit_events from authenticated;
grant select, insert on public.operator_audit_events to service_role;

drop trigger if exists operator_audit_events_append_only_update on public.operator_audit_events;
create trigger operator_audit_events_append_only_update
  before update on public.operator_audit_events
  for each row execute function public.reject_deletion_execution_evidence_mutation();

drop trigger if exists operator_audit_events_append_only_delete on public.operator_audit_events;
create trigger operator_audit_events_append_only_delete
  before delete on public.operator_audit_events
  for each row execute function public.reject_deletion_execution_evidence_mutation();

create table if not exists public.billing_cancellation_events (
  id text primary key,
  target_user_id uuid not null,
  deletion_request_id text,
  request_id text not null,
  operator_id text not null,
  provider text not null,
  status text not null,
  note text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint billing_cancellation_events_provider_check
    check (provider in ('none', 'mock', 'razorpay', 'stripe', 'paddle')),
  constraint billing_cancellation_events_status_check
    check (status in ('not_required', 'scaffold_only', 'provider_cancellation_review_required', 'manually_waived_with_evidence', 'failed'))
);

create index if not exists billing_cancellation_events_target_created_idx
  on public.billing_cancellation_events (target_user_id, created_at desc);

alter table public.billing_cancellation_events enable row level security;

revoke all on public.billing_cancellation_events from public;
revoke all on public.billing_cancellation_events from anon;
revoke all on public.billing_cancellation_events from authenticated;
grant select, insert on public.billing_cancellation_events to service_role;

drop trigger if exists billing_cancellation_events_append_only_update on public.billing_cancellation_events;
create trigger billing_cancellation_events_append_only_update
  before update on public.billing_cancellation_events
  for each row execute function public.reject_deletion_execution_evidence_mutation();

drop trigger if exists billing_cancellation_events_append_only_delete on public.billing_cancellation_events;
create trigger billing_cancellation_events_append_only_delete
  before delete on public.billing_cancellation_events
  for each row execute function public.reject_deletion_execution_evidence_mutation();
