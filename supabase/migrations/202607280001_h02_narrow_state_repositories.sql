-- H-02: narrow state loading and transactional state patches.
-- Apply identically to every StudentOS data shard.

create or replace function public.studentos_assert_state_owner(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and auth.uid() is distinct from p_user_id then
    raise exception 'STUDENTOS_STATE_UNAUTHORIZED' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.studentos_collection_table(p_collection text)
returns text
language sql
immutable
as $$
  select case p_collection
    when 'courses' then 'courses'
    when 'topics' then 'topics'
    when 'syllabi' then 'syllabi'
    when 'exams' then 'exams'
    when 'assignments' then 'assignments'
    when 'timetable' then 'timetable_events'
    when 'notes' then 'notes'
    when 'sourceMaterials' then 'source_materials'
    when 'sourceChunks' then 'source_chunks'
    when 'testSessions' then 'test_sessions'
    when 'testResults' then 'test_results'
    when 'creditLedger' then 'credit_ledger'
    when 'roadmap' then 'roadmap_items'
    when 'revisionEvents' then 'revision_events'
    when 'tutorLessons' then 'tutor_lessons'
    when 'assignmentAutomationContracts' then 'assignment_automation_contracts'
    when 'auditLog' then 'audit_logs'
    when 'aiConversations' then 'ai_conversations'
    when 'aiMessages' then 'ai_messages'
    when 'memoryItems' then 'memory_items'
    when 'embeddingsMetadata' then 'embeddings_metadata'
    when 'backgroundJobs' then 'background_jobs'
    when 'jobEvents' then 'job_events'
    when 'billingSubscriptions' then 'billing_subscriptions'
    when 'billingWebhookEvents' then 'billing_webhook_events'
    when 'consentVersions' then 'consent_versions'
    when 'userConsents' then 'user_consents'
    when 'legalAcceptances' then 'legal_acceptances'
    when 'dataExportRequests' then 'data_export_requests'
    when 'dataExportJobs' then 'data_export_jobs'
    when 'accountDeletionRequests' then 'account_deletion_requests'
    when 'accountDeletionReviews' then 'account_deletion_reviews'
    when 'roleInvitations' then 'role_invitations'
    when 'classroomItems' then 'classroom_items'
    when 'recoveryUserStates' then 'recovery_user_state'
    when 'academicEvents' then 'academic_events'
    when 'academicStateSnapshots' then 'academic_state_snapshots'
    when 'topicRecoveryStates' then 'topic_recovery_states'
    when 'topicRecoveryStateHistory' then 'topic_recovery_state_history'
    when 'recoveryRuns' then 'recovery_runs'
    when 'recoveryPreviews' then 'recovery_previews'
    when 'planVersions' then 'plan_versions'
    else null
  end;
$$;

create or replace function public.load_studentos_state_scope(
  p_user_id uuid,
  p_scope text,
  p_entity_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb := '{}'::jsonb;
  profile_payload jsonb;
  collection_key text;
  table_name text;
  values_payload jsonb;
  scope_keys text[];
begin
  perform public.studentos_assert_state_owner(p_user_id);
  select payload into profile_payload from public.student_profiles where user_id = p_user_id limit 1;
  result := jsonb_build_object('studentProfile', profile_payload);

  case lower(coalesce(p_scope, 'dashboard'))
    when 'dashboard' then scope_keys := array['courses','topics','syllabi','exams','assignments','timetable','notes','sourceMaterials','testSessions','testResults','creditLedger','roadmap','revisionEvents','tutorLessons','assignmentAutomationContracts','memoryItems','backgroundJobs','billingSubscriptions','dataExportRequests','dataExportJobs','accountDeletionRequests','classroomItems'];
    when 'academic_context' then scope_keys := array['courses','topics','syllabi','exams','assignments','timetable','notes','sourceMaterials','sourceChunks','testSessions','testResults','creditLedger','roadmap','revisionEvents','tutorLessons','assignmentAutomationContracts','memoryItems','embeddingsMetadata','backgroundJobs','jobEvents','billingSubscriptions','classroomItems'];
    when 'test_session' then scope_keys := array['courses','topics','syllabi','exams','assignments','timetable','notes','sourceMaterials','testSessions','testResults','creditLedger','roadmap','revisionEvents','tutorLessons','assignmentAutomationContracts','memoryItems','backgroundJobs','billingSubscriptions','dataExportRequests','dataExportJobs','accountDeletionRequests','classroomItems','auditLog'];
    when 'account_lifecycle' then scope_keys := array['billingSubscriptions','billingWebhookEvents','consentVersions','userConsents','legalAcceptances','dataExportRequests','dataExportJobs','accountDeletionRequests','accountDeletionReviews','roleInvitations','auditLog'];
    when 'recovery' then scope_keys := array['courses','topics','assignments','timetable','notes','sourceMaterials','testSessions','testResults','roadmap','revisionEvents','tutorLessons','backgroundJobs','auditLog','recoveryUserStates','academicEvents','academicStateSnapshots','topicRecoveryStates','topicRecoveryStateHistory','recoveryRuns','recoveryPreviews','planVersions'];
    when 'ai' then scope_keys := array['courses','topics','assignments','sourceMaterials','sourceChunks','testResults','creditLedger','roadmap','memoryItems','embeddingsMetadata','billingSubscriptions','classroomItems','aiConversations','aiMessages'];
    when 'full' then scope_keys := array['courses','topics','syllabi','exams','assignments','timetable','notes','sourceMaterials','sourceChunks','testSessions','testResults','creditLedger','roadmap','revisionEvents','tutorLessons','assignmentAutomationContracts','auditLog','aiConversations','aiMessages','memoryItems','embeddingsMetadata','backgroundJobs','jobEvents','billingSubscriptions','billingWebhookEvents','consentVersions','userConsents','legalAcceptances','dataExportRequests','dataExportJobs','accountDeletionRequests','accountDeletionReviews','roleInvitations','classroomItems','recoveryUserStates','academicEvents','academicStateSnapshots','topicRecoveryStates','topicRecoveryStateHistory','recoveryRuns','recoveryPreviews','planVersions'];
    else raise exception 'STUDENTOS_STATE_SCOPE_INVALID';
  end case;

  foreach collection_key in array scope_keys loop
    table_name := public.studentos_collection_table(collection_key);
    if table_name is null or to_regclass(format('public.%I', table_name)) is null then
      result := result || jsonb_build_object(collection_key, '[]'::jsonb);
      continue;
    end if;
    if p_entity_id is not null and collection_key = 'testSessions' then
      execute format('select coalesce(jsonb_agg(payload order by created_at), ''[]''::jsonb) from public.%I where user_id = $1 and id = $2', table_name)
        into values_payload using p_user_id, p_entity_id;
    elsif p_entity_id is not null and collection_key = 'testResults' then
      execute format('select coalesce(jsonb_agg(payload order by created_at), ''[]''::jsonb) from public.%I where user_id = $1 and (test_session_id = $2 or id = $2)', table_name)
        into values_payload using p_user_id, p_entity_id;
    else
      execute format('select coalesce(jsonb_agg(payload order by created_at), ''[]''::jsonb) from public.%I where user_id = $1', table_name)
        into values_payload using p_user_id;
    end if;
    result := result || jsonb_build_object(collection_key, coalesce(values_payload, '[]'::jsonb));
  end loop;
  return result;
end;
$$;

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
  update_assignments text;
  affected integer := 0;
  changed_rows integer := 0;
begin
  perform public.studentos_assert_state_owner(p_user_id);
  if p_profile is not null then
    if p_profile->>'user_id' is distinct from p_user_id::text then raise exception 'STUDENTOS_STATE_OWNER_MISMATCH'; end if;
    select string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ' order by c.ordinal_position)
      into update_assignments
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'student_profiles' and c.column_name not in ('user_id','created_at');
    execute format('insert into public.student_profiles select * from jsonb_populate_record(null::public.student_profiles, $1) on conflict (user_id) do update set %s', update_assignments)
      using p_profile;
  end if;

  for collection_key, rows_payload in select key, value from jsonb_each(coalesce(p_collections, '{}'::jsonb)) loop
    table_name := public.studentos_collection_table(collection_key);
    if table_name is null or to_regclass(format('public.%I', table_name)) is null then raise exception 'STUDENTOS_COLLECTION_INVALID: %', collection_key; end if;
    if jsonb_typeof(rows_payload) <> 'array' then raise exception 'STUDENTOS_COLLECTION_ROWS_INVALID: %', collection_key; end if;
    if exists (select 1 from jsonb_array_elements(rows_payload) row_value where row_value->>'user_id' is distinct from p_user_id::text) then
      raise exception 'STUDENTOS_STATE_OWNER_MISMATCH: %', collection_key;
    end if;
    if jsonb_array_length(rows_payload) = 0 then continue; end if;
    select string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ' order by c.ordinal_position)
      into update_assignments
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = table_name and c.column_name not in ('id','created_at');
    execute format('insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (id) do update set %2$s', table_name, update_assignments)
      using rows_payload;
    affected := affected + jsonb_array_length(rows_payload);
  end loop;

  for collection_key, ids_payload in select key, value from jsonb_each(coalesce(p_delete_ids, '{}'::jsonb)) loop
    table_name := public.studentos_collection_table(collection_key);
    if table_name is null or to_regclass(format('public.%I', table_name)) is null then raise exception 'STUDENTOS_COLLECTION_INVALID: %', collection_key; end if;
    if jsonb_typeof(ids_payload) <> 'array' then raise exception 'STUDENTOS_DELETE_IDS_INVALID: %', collection_key; end if;
    execute format('delete from public.%I where user_id = $1 and id in (select jsonb_array_elements_text($2))', table_name)
      using p_user_id, ids_payload;
    get diagnostics changed_rows = row_count;
    affected := affected + changed_rows;
  end loop;
  return jsonb_build_object('persisted', true, 'affected', affected);
end;
$$;

create or replace function public.delete_studentos_source_artifacts(
  p_user_id uuid,
  p_source_id text default null,
  p_memory_item_ids text[] default '{}',
  p_source_chunk_ids text[] default '{}',
  p_embedding_ids text[] default '{}',
  p_job_ids text[] default '{}',
  p_job_event_ids text[] default '{}',
  p_assignment_ids text[] default '{}',
  p_syllabus_ids text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare deleted_count integer := 0; n integer;
begin
  perform public.studentos_assert_state_owner(p_user_id);
  delete from public.job_events where user_id = p_user_id and (source_id = p_source_id or id = any(p_job_event_ids)); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.background_jobs where user_id = p_user_id and (source_id = p_source_id or id = any(p_job_ids)); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.embeddings_metadata where user_id = p_user_id and (source_material_id = p_source_id or id = any(p_embedding_ids)); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.memory_items where user_id = p_user_id and id = any(p_memory_item_ids); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.source_chunks where user_id = p_user_id and (source_material_id = p_source_id or id = any(p_source_chunk_ids)); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.assignments where user_id = p_user_id and id = any(p_assignment_ids); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.syllabi where user_id = p_user_id and id = any(p_syllabus_ids); get diagnostics n = row_count; deleted_count := deleted_count + n;
  if p_source_id is not null then delete from public.source_materials where user_id = p_user_id and id = p_source_id; get diagnostics n = row_count; deleted_count := deleted_count + n; end if;
  return jsonb_build_object('deleted', deleted_count);
end;
$$;

grant execute on function public.load_studentos_state_scope(uuid, text, text) to authenticated, service_role;
grant execute on function public.persist_studentos_state_patch(uuid, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.delete_studentos_source_artifacts(uuid, text, text[], text[], text[], text[], text[], text[], text[]) to authenticated, service_role;
