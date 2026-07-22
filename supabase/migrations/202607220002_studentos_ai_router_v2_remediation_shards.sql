-- StudentOS Provider Router V2 remediation schema capability marker.
-- Apply identically to data Projects 2, 3, and 4 only. Never apply to Project 1 AUTH.

begin;

create or replace function public.verify_ai_router_v2_shard_schema()
returns table (
  schema_version text,
  target text,
  capabilities jsonb,
  settlement_providers jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.ai_usage_ledger') is null
    or to_regprocedure('public.complete_routed_ai_operation(uuid,text,boolean,text,text,jsonb,jsonb)') is null
    or not exists (
      select 1 from pg_constraint
      where conrelid = 'public.ai_usage_ledger'::regclass
        and conname = 'ai_usage_ledger_routing_provider_check'
        and pg_get_constraintdef(oid) ilike '%nvidia%'
    )
  then raise exception 'ai_router_v2_shard_capability_missing'; end if;
  return query select
    '202607220002'::text,
    'data_shard'::text,
    jsonb_build_array('routed_usage_ledger', 'idempotent_settlement', 'nvidia_settlement', 'service_role_only'),
    jsonb_build_array('groq', 'gemini', 'nvidia', 'pollinations');
end;
$$;

revoke all on function public.verify_ai_router_v2_shard_schema() from public, anon, authenticated;
grant execute on function public.verify_ai_router_v2_shard_schema() to service_role;

notify pgrst, 'reload schema';

commit;
