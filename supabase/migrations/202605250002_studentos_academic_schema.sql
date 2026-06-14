-- StudentOS academic shard schema
-- RUN ON: Databases 2, 3, and 4.
-- Service-role backend owns writes. RLS keeps student data private by default.

create extension if not exists pgcrypto;

create table if not exists public.student_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  grade_band text not null default 'high_school',
  school_system text,
  timezone text not null default 'UTC',
  discipline_index integer not null default 50 check (discipline_index between 0 and 100),
  learning_adaptivity_score integer not null default 50 check (learning_adaptivity_score between 0 and 100),
  preferences jsonb not null default '{}'::jsonb,
  visibility jsonb not null default '{"defaultAudience":"student_only","externalProgressSharing":false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  title text not null,
  term text,
  teacher text,
  exam_date date,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  coverage_state text not null default 'uncovered' check (coverage_state in ('uncovered', 'teaching', 'covered')),
  mastery text not null default 'not_started' check (mastery in ('not_started', 'revision_required', 'developing', 'strong', 'secure')),
  weak_signals jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.syllabi (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  units jsonb not null default '[]'::jsonb,
  source_material_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  exam_date date not null,
  weight numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'due_soon', 'submitted', 'closed')),
  source text not null default 'manual',
  external_provider text,
  external_id text,
  topic_ids jsonb not null default '[]'::jsonb,
  automation_eligibility text not null default 'requires_contract',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.class_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  title text not null,
  body text not null,
  source_material_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.source_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  title text not null,
  kind text not null default 'uploaded_file',
  storage_bucket text,
  storage_path text,
  file_size_bytes integer,
  content_sha256 text,
  extracted_text_preview text,
  citation_label text not null,
  web_fallback_allowed boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.test_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  question_format text not null default 'mcq' check (question_format in ('mcq', 'short_answer', 'mixed')),
  status text not null default 'open' check (status in ('open', 'completed', 'abandoned')),
  questions jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.test_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  test_session_id uuid references public.test_sessions (id) on delete set null,
  course_id uuid references public.courses (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  grading_mode text not null default 'mcq_auto' check (grading_mode in ('mcq_auto', 'short_answer_pending', 'short_answer_ai')),
  score_percent numeric not null check (score_percent between 0 and 100),
  credits_awarded integer not null default 0 check (credits_awarded between 0 and 3),
  corrections jsonb not null default '[]'::jsonb,
  completed_at timestamptz not null default now()
);

create table if not exists public.credit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  source_type text not null,
  source_id uuid,
  amount integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  title text not null,
  kind text not null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists public.revision_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  scheduled_at timestamptz not null,
  reason text not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tutor_lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  title text not null,
  mode text not null,
  source_labels jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.assignment_automation_contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_profiles (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  status text not null,
  required_credits integer not null default 1,
  available_credits integer not null default 0,
  covered_topic_ids jsonb not null default '[]'::jsonb,
  uncovered_topic_ids jsonb not null default '[]'::jsonb,
  allowed_actions jsonb not null default '[]'::jsonb,
  blocked_actions jsonb not null default '[]'::jsonb,
  student_review_required boolean not null default true,
  real_submission_allowed boolean not null default false,
  rationale text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.student_profiles (id) on delete set null,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high', 'critical')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists courses_user_id_idx on public.courses (user_id);
create index if not exists topics_user_course_idx on public.topics (user_id, course_id);
create index if not exists assignments_user_due_idx on public.assignments (user_id, due_at);
create index if not exists source_materials_user_course_idx on public.source_materials (user_id, course_id);
create index if not exists roadmap_items_user_status_idx on public.roadmap_items (user_id, status, due_at);
create index if not exists revision_events_user_schedule_idx on public.revision_events (user_id, scheduled_at);

alter table public.student_profiles enable row level security;
alter table public.courses enable row level security;
alter table public.topics enable row level security;
alter table public.syllabi enable row level security;
alter table public.exams enable row level security;
alter table public.assignments enable row level security;
alter table public.class_schedules enable row level security;
alter table public.notes enable row level security;
alter table public.source_materials enable row level security;
alter table public.test_sessions enable row level security;
alter table public.test_results enable row level security;
alter table public.credit_ledger_entries enable row level security;
alter table public.roadmap_items enable row level security;
alter table public.revision_events enable row level security;
alter table public.tutor_lessons enable row level security;
alter table public.assignment_automation_contracts enable row level security;
alter table public.audit_logs enable row level security;

-- Representative owner policies. Keep backend service role as canonical writer.
drop policy if exists student_profiles_own on public.student_profiles;
create policy student_profiles_own on public.student_profiles for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists courses_own on public.courses;
create policy courses_own on public.courses for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists topics_own on public.topics;
create policy topics_own on public.topics for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists assignments_own on public.assignments;
create policy assignments_own on public.assignments for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists source_materials_own on public.source_materials;
create policy source_materials_own on public.source_materials for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists test_results_own on public.test_results;
create policy test_results_own on public.test_results for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists credit_ledger_own on public.credit_ledger_entries;
create policy credit_ledger_own on public.credit_ledger_entries for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists roadmap_items_own on public.roadmap_items;
create policy roadmap_items_own on public.roadmap_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists audit_logs_own_read on public.audit_logs;
create policy audit_logs_own_read on public.audit_logs for select using (user_id = auth.uid());

revoke all on all tables in schema public from public;
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- Additional owner policies for remaining user-scoped academic tables.
drop policy if exists syllabi_own on public.syllabi;
create policy syllabi_own on public.syllabi for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists exams_own on public.exams;
create policy exams_own on public.exams for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists class_schedules_own on public.class_schedules;
create policy class_schedules_own on public.class_schedules for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notes_own on public.notes;
create policy notes_own on public.notes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists test_sessions_own on public.test_sessions;
create policy test_sessions_own on public.test_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists revision_events_own on public.revision_events;
create policy revision_events_own on public.revision_events for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists tutor_lessons_own on public.tutor_lessons;
create policy tutor_lessons_own on public.tutor_lessons for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists assignment_contracts_own on public.assignment_automation_contracts;
create policy assignment_contracts_own on public.assignment_automation_contracts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
