-- StudentOS Pass 16 billing and entitlement persistence
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- Billing provider secrets remain backend-only. This schema stores references, never secret keys.

create table if not exists public.billing_subscriptions (
  id text primary key,
  user_id uuid not null,
  plan_id text not null default 'free',
  status text not null default 'free',
  provider text not null default 'none',
  provider_customer_id text,
  provider_subscription_id text,
  renewal_at timestamptz,
  cancel_at_period_end boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_subscriptions_plan_check
    check (plan_id in ('free', 'pro', 'group', 'institution')),
  constraint billing_subscriptions_status_check
    check (status in ('free', 'active', 'trialing', 'past_due', 'cancelled')),
  constraint billing_subscriptions_provider_check
    check (provider in ('none', 'mock', 'razorpay', 'stripe', 'paddle'))
);

create unique index if not exists billing_subscriptions_user_idx
  on public.billing_subscriptions (user_id);

create index if not exists billing_subscriptions_provider_ref_idx
  on public.billing_subscriptions (provider, provider_subscription_id);

alter table public.billing_subscriptions enable row level security;

revoke all on public.billing_subscriptions from public;
revoke all on public.billing_subscriptions from anon;

drop policy if exists billing_subscriptions_own_read on public.billing_subscriptions;
create policy billing_subscriptions_own_read
  on public.billing_subscriptions
  for select
  using (user_id = auth.uid());

grant select on public.billing_subscriptions to authenticated;
grant all on public.billing_subscriptions to service_role;

create table if not exists public.billing_webhook_events (
  id text primary key,
  user_id uuid not null,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  status text not null default 'processed',
  subscription_id text,
  metadata jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_webhook_events_provider_check
    check (provider in ('mock', 'razorpay', 'stripe', 'paddle')),
  constraint billing_webhook_events_type_check
    check (event_type in ('subscription_created', 'subscription_updated', 'subscription_cancelled', 'payment_failed')),
  constraint billing_webhook_events_status_check
    check (status in ('processed', 'ignored', 'failed'))
);

create unique index if not exists billing_webhook_events_provider_event_idx
  on public.billing_webhook_events (provider, provider_event_id);

create index if not exists billing_webhook_events_user_created_idx
  on public.billing_webhook_events (user_id, created_at desc);

alter table public.billing_webhook_events enable row level security;

revoke all on public.billing_webhook_events from public;
revoke all on public.billing_webhook_events from anon;
revoke all on public.billing_webhook_events from authenticated;

grant all on public.billing_webhook_events to service_role;
