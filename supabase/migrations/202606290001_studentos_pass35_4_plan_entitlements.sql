-- StudentOS PASS 35.4 launch plan catalog alignment.
-- RUN IDENTICALLY ON: data shard Projects 2, 3, and 4.
-- No payment provider is activated by this migration.

alter table if exists public.billing_subscriptions
  drop constraint if exists billing_subscriptions_plan_check;

alter table if exists public.billing_subscriptions
  drop constraint if exists billing_subscriptions_status_check;

update public.billing_subscriptions
set plan_id = 'unselected'
where plan_id in ('free', 'group', 'institution')
   or plan_id is null;

update public.billing_subscriptions
set status = 'unselected'
where status = 'free'
   or status is null;

alter table if exists public.billing_subscriptions
  alter column plan_id set default 'unselected';

alter table if exists public.billing_subscriptions
  alter column status set default 'unselected';

alter table if exists public.billing_subscriptions
  add constraint billing_subscriptions_plan_check
  check (plan_id in ('unselected', 'trial', 'starter', 'essential', 'plus', 'pro'));

alter table if exists public.billing_subscriptions
  add constraint billing_subscriptions_status_check
  check (status in ('unselected', 'selected', 'active', 'trialing', 'past_due', 'cancelled'));
