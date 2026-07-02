-- StudentOS Task 3.4 hotfix: allow the backend service role to reserve and
-- settle weekly AI allowance while keeping the ledger and RPCs backend-only.
-- Apply to all three StudentOS data shards only. Do not apply to the Auth project.

begin;

revoke all on table public.ai_usage_ledger from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_usage_ledger to service_role;

alter function public.reserve_ai_weekly_allowance(
  uuid, text, text, integer, text, integer, text, jsonb
) security invoker;
revoke all on function public.reserve_ai_weekly_allowance(
  uuid, text, text, integer, text, integer, text, jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_ai_weekly_allowance(
  uuid, text, text, integer, text, integer, text, jsonb
) to service_role;

alter function public.settle_ai_weekly_allowance(
  uuid, text, text
) security invoker;
revoke all on function public.settle_ai_weekly_allowance(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.settle_ai_weekly_allowance(
  uuid, text, text
) to service_role;

commit;
