-- StudentOS Task 2: Classroom discovery, selection, import, and hand-in truth.
-- Apply to all three StudentOS data shards. Do not apply to the auth project.

create table if not exists public.classroom_items (
  id text primary key,
  user_id uuid not null,
  external_id text not null,
  provider_course_id text not null,
  provider_course_work_id text,
  provider_material_id text,
  item_type text not null,
  title text not null,
  course_title text,
  due_at timestamptz,
  posted_at timestamptz,
  provider_updated_at timestamptz,
  submission_state text,
  handed_in boolean not null default false,
  selection_state text not null default 'discovered',
  selected_at timestamptz,
  imported_at timestamptz,
  academic_context_included boolean not null default false,
  last_seen_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classroom_items_type_check
    check (item_type in ('assignment', 'material')),
  constraint classroom_items_selection_state_check
    check (selection_state in ('discovered', 'selected', 'imported', 'ignored', 'archived'))
);

create index if not exists classroom_items_user_selection_idx
  on public.classroom_items (user_id, selection_state, due_at);
create index if not exists classroom_items_user_external_idx
  on public.classroom_items (user_id, provider_course_id, external_id);
create index if not exists classroom_items_user_handed_in_idx
  on public.classroom_items (user_id, handed_in, due_at);

alter table public.classroom_items enable row level security;

drop policy if exists classroom_items_own on public.classroom_items;
create policy classroom_items_own on public.classroom_items
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.classroom_items from public;
revoke all on public.classroom_items from anon;
grant select, insert, update, delete on public.classroom_items to authenticated;
grant all on public.classroom_items to service_role;

-- Previous versions wrote every discovered Classroom row into academic tables.
-- Keep rows for auditability, but fail closed unless the profile proves selection.
update public.assignments as assignment
set payload = assignment.payload || jsonb_build_object(
  'selectionState',
  case
    when coalesce(profile.payload #> '{productLifecycle,selectedMaterialIds}', '[]'::jsonb) ? assignment.id then 'imported'
    else 'discovered'
  end,
  'academicContextIncluded',
  coalesce(profile.payload #> '{productLifecycle,selectedMaterialIds}', '[]'::jsonb) ? assignment.id
)
from public.student_profiles as profile
where profile.user_id = assignment.user_id
  and (
    assignment.payload->>'source' = 'google_classroom'
    or assignment.payload->>'provider' = 'google_classroom'
  );

update public.source_materials as material
set payload = material.payload || jsonb_build_object(
  'selectionState',
  case
    when coalesce(profile.payload #> '{productLifecycle,selectedMaterialIds}', '[]'::jsonb) ? material.id then 'imported'
    else 'discovered'
  end,
  'academicContextIncluded',
  coalesce(profile.payload #> '{productLifecycle,selectedMaterialIds}', '[]'::jsonb) ? material.id
)
from public.student_profiles as profile
where profile.user_id = material.user_id
  and (
    material.payload->>'source' = 'google_classroom'
    or material.payload->>'provider' = 'google_classroom'
    or material.payload->>'sourceType' like 'google_classroom%'
  );
