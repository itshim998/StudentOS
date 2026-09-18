-- H-02: persistence repair for database-managed created_at and default columns.
-- Forward-only repair for 202607280001 / 202607290001.
-- Apply identically to every StudentOS data shard.

create or replace function public.persist_studentos_state_patch(
  p_user_id uuid,
  p_profile jsonb default null,
  p_collections jsonb default '{}'::jsonb,
  p_delete_ids jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  collection_key text;
  rows_payload jsonb;
  ids_payload jsonb;
  table_name text;
  insert_columns text;
  select_expressions text;
  update_assignments text;
  affected integer := 0;
  changed_rows integer := 0;
begin
  perform public.studentos_assert_state_owner(p_user_id);

  if p_profile is not null then
    if p_profile->>'user_id' is distinct from p_user_id::text then
      raise exception 'STUDENTOS_STATE_OWNER_MISMATCH';
    end if;

    select
      string_agg(format('%1$I', c.column_name), ', ' order by c.ordinal_position),
      string_agg(
        case
          when c.column_name = 'created_at' then 'coalesce(r.created_at, now())'
          when c.is_nullable = 'NO' and c.column_default is not null then format('coalesce(r.%1$I, %2$s)', c.column_name, c.column_default)
          else format('r.%1$I', c.column_name)
        end,
        ', ' order by c.ordinal_position
      ),
      string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ' order by c.ordinal_position)
        filter (where c.column_name not in ('user_id', 'created_at', 'started_at'))
      into insert_columns, select_expressions, update_assignments
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'student_profiles';

    execute format(
      'insert into public.student_profiles (%1$s) select %2$s from jsonb_populate_record(null::public.student_profiles, $1) r on conflict (user_id) do update set %3$s',
      insert_columns,
      select_expressions,
      update_assignments
    )
    using p_profile;
  end if;

  for collection_key, rows_payload in select key, value from jsonb_each(coalesce(p_collections, '{}'::jsonb)) loop
    table_name := public.studentos_collection_table(collection_key);
    if table_name is null or to_regclass(format('public.%I', table_name)) is null then
      raise exception 'STUDENTOS_COLLECTION_INVALID: %', collection_key;
    end if;
    if jsonb_typeof(rows_payload) <> 'array' then
      raise exception 'STUDENTOS_COLLECTION_ROWS_INVALID: %', collection_key;
    end if;
    if exists (
      select 1 from jsonb_array_elements(rows_payload) row_value
      where row_value->>'user_id' is distinct from p_user_id::text
    ) then
      raise exception 'STUDENTOS_STATE_OWNER_MISMATCH: %', collection_key;
    end if;
    if jsonb_array_length(rows_payload) = 0 then
      continue;
    end if;

    select
      string_agg(format('%1$I', c.column_name), ', ' order by c.ordinal_position),
      string_agg(
        case
          when c.column_name = 'created_at' then 'coalesce(r.created_at, now())'
          when c.is_nullable = 'NO' and c.column_default is not null then format('coalesce(r.%1$I, %2$s)', c.column_name, c.column_default)
          else format('r.%1$I', c.column_name)
        end,
        ', ' order by c.ordinal_position
      ),
      string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ' order by c.ordinal_position)
        filter (where c.column_name not in ('id', 'created_at', 'started_at'))
      into insert_columns, select_expressions, update_assignments
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = table_name;

    execute format(
      'insert into public.%1$I (%2$s) select %3$s from jsonb_populate_recordset(null::public.%1$I, $1) r on conflict (id) do update set %4$s',
      table_name,
      insert_columns,
      select_expressions,
      update_assignments
    )
    using rows_payload;
    affected := affected + jsonb_array_length(rows_payload);
  end loop;

  for collection_key, ids_payload in select key, value from jsonb_each(coalesce(p_delete_ids, '{}'::jsonb)) loop
    table_name := public.studentos_collection_table(collection_key);
    if table_name is null or to_regclass(format('public.%I', table_name)) is null then
      raise exception 'STUDENTOS_COLLECTION_INVALID: %', collection_key;
    end if;
    if jsonb_typeof(ids_payload) <> 'array' then
      raise exception 'STUDENTOS_DELETE_IDS_INVALID: %', collection_key;
    end if;
    execute format('delete from public.%I where user_id = $1 and id in (select jsonb_array_elements_text($2))', table_name)
      using p_user_id, ids_payload;
    get diagnostics changed_rows = row_count;
    affected := affected + changed_rows;
  end loop;

  return jsonb_build_object('persisted', true, 'affected', affected);
end;
$$;

grant execute on function public.persist_studentos_state_patch(uuid, jsonb, jsonb, jsonb) to authenticated, service_role;
