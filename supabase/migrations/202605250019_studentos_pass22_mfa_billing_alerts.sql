-- StudentOS Pass 22 operator MFA scaffold, billing cancellation reconciliation, and monitoring alerts.
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- Internal ops and final deletion remain disabled by default.

alter table public.billing_cancellation_events
  drop constraint if exists billing_cancellation_events_status_check;

alter table public.billing_cancellation_events
  add constraint billing_cancellation_events_status_check
  check (status in (
    'not_required',
    'scaffold_only',
    'provider_cancelled',
    'provider_cancelled_at_period_end',
    'provider_cancellation_required',
    'provider_cancellation_review_required',
    'manually_waived_with_evidence',
    'failed'
  ));

create table if not exists public.monitoring_alert_events (
  id text primary key,
  target_user_id uuid,
  request_id text not null,
  alert_type text not null,
  severity text not null default 'warn',
  source text not null default 'studentos-api',
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint monitoring_alert_events_type_check
    check (alert_type in (
      'high_risk_operator_action',
      'billing_cancellation_failure',
      'deletion_approval_recorded',
      'export_download_anomaly'
    )),
  constraint monitoring_alert_events_severity_check
    check (severity in ('info', 'warn', 'error', 'critical'))
);

create index if not exists monitoring_alert_events_target_created_idx
  on public.monitoring_alert_events (target_user_id, created_at desc);

create index if not exists monitoring_alert_events_type_created_idx
  on public.monitoring_alert_events (alert_type, created_at desc);

alter table public.monitoring_alert_events enable row level security;

revoke all on public.monitoring_alert_events from public;
revoke all on public.monitoring_alert_events from anon;
revoke all on public.monitoring_alert_events from authenticated;
grant select, insert on public.monitoring_alert_events to service_role;

drop trigger if exists monitoring_alert_events_append_only_update on public.monitoring_alert_events;
create trigger monitoring_alert_events_append_only_update
  before update on public.monitoring_alert_events
  for each row execute function public.reject_deletion_execution_evidence_mutation();

drop trigger if exists monitoring_alert_events_append_only_delete on public.monitoring_alert_events;
create trigger monitoring_alert_events_append_only_delete
  before delete on public.monitoring_alert_events
  for each row execute function public.reject_deletion_execution_evidence_mutation();
