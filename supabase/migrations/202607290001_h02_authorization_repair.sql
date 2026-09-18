-- H-02 Authorization Repair: replace legacy JWT claim check with PostgREST session role.
-- Apply identically to every StudentOS data shard.

create or replace function public.studentos_assert_state_owner(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 1. service_role request -> allowed
  if coalesce(current_setting('role', true), '') = 'service_role' then
    return;
  end if;

  -- 2. non-service-role request with matching auth.uid() -> allowed
  if p_user_id is not null and auth.uid() is not null and auth.uid() = p_user_id then
    return;
  end if;

  -- 3. all other requests (mismatched uid, anonymous, or missing role/identity) -> denied
  raise exception 'STUDENTOS_STATE_UNAUTHORIZED' using errcode = '42501';
end;
$$;

-- Restrict internal authorization helper so external API callers cannot invoke it directly through PostgREST
revoke execute on function public.studentos_assert_state_owner(uuid) from public, anon, authenticated;
grant execute on function public.studentos_assert_state_owner(uuid) to service_role;

-- Reconfirm execution grants on public H-02 state functions
grant execute on function public.load_studentos_state_scope(uuid, text, text) to authenticated, service_role;
grant execute on function public.persist_studentos_state_patch(uuid, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.delete_studentos_source_artifacts(uuid, text, text[], text[], text[], text[], text[], text[], text[]) to authenticated, service_role;
