-- StudentOS Pass 3 data shard schema
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- Browser clients must not connect directly to these shards in Pass 3.
-- user_id points to the Project 1 auth user id. It intentionally does not
-- foreign-key to auth.users because each data shard is a separate Supabase project.

create extension if not exists pgcrypto;

create table if not exists public.student_profiles (
  user_id uuid primary key,
  display_name text not null,
  grade_band text not null default 'high_school',
  school_system text,
  timezone text not null default 'UTC',
  discipline_index integer not null default 50 check (discipline_index between 0 and 100),
  learning_adaptivity_score integer not null default 50 check (learning_adaptivity_score between 0 and 100),
  preferences jsonb not null default '{}'::jsonb,
  visibility jsonb not null default '{"defaultAudience":"student_only","externalProgressSharing":false}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  title text not null,
  term text,
  teacher text,
  exam_date date,
  color text,
  syllabus_id text,
  subject_ids jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.topics (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  course_id text not null,
  title text not null,
  coverage_state text not null default 'uncovered' check (coverage_state in ('uncovered', 'teaching', 'covered')),
  mastery text not null default 'not_started',
  weak_signals jsonb not null default '[]'::jsonb,
  source_material_ids jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.syllabi (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  course_id text,
  title text not null,
  units jsonb not null default '[]'::jsonb,
  source_material_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exams (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  course_id text,
  title text not null,
  exam_date date not null,
  weight numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  course_id text,
  title text not null,
  due_at timestamptz,
  status text not null default 'open',
  source text not null default 'manual',
  external_provider text,
  external_id text,
  topic_ids jsonb not null default '[]'::jsonb,
  automation_eligibility text not null default 'requires_contract',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.timetable_events (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  course_id text,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  course_id text,
  topic_id text,
  title text not null,
  body text not null default '',
  source_material_ids jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.source_materials (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  course_id text,
  title text not null,
  kind text not null default 'uploaded_file_metadata',
  storage_bucket text,
  storage_path text,
  file_size_bytes integer,
  content_sha256 text,
  extracted_text_preview text,
  citation_label text not null,
  web_fallback_allowed boolean not null default true,
  deleted_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.test_sessions (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  assignment_id text,
  course_id text,
  topic_id text,
  question_format text not null default 'mcq' check (question_format in ('mcq', 'short_answer', 'mixed')),
  status text not null default 'open',
  questions jsonb not null default '[]'::jsonb,
  answer_key jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.test_results (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  test_session_id text,
  course_id text,
  topic_id text,
  grading_mode text not null default 'mcq_auto',
  score_percent numeric not null check (score_percent between 0 and 100),
  credits_awarded integer not null default 0 check (credits_awarded between 0 and 3),
  answers jsonb not null default '[]'::jsonb,
  answer_key jsonb not null default '[]'::jsonb,
  corrections jsonb not null default '[]'::jsonb,
  completed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  source_type text not null,
  source_id text,
  amount integer not null,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roadmap_items (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  course_id text,
  topic_id text,
  title text not null,
  kind text not null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  due_at timestamptz,
  status text not null default 'open',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.revision_events (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  course_id text,
  topic_id text,
  scheduled_at timestamptz,
  reason text not null,
  completed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tutor_lessons (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  course_id text,
  topic_id text,
  title text not null,
  mode text not null,
  trigger text,
  source_labels jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignment_automation_contracts (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  assignment_id text,
  status text not null,
  required_credits integer not null default 1,
  available_credits integer not null default 0,
  allowed_actions jsonb not null default '[]'::jsonb,
  blocked_actions jsonb not null default '[]'::jsonb,
  student_review_required boolean not null default true,
  real_submission_allowed boolean not null default false,
  rationale text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  actor_id text,
  action text not null,
  target_type text,
  target_id text,
  risk_level text not null default 'low',
  metadata jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_conversations (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  title text not null,
  verb text,
  course_id text,
  topic_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  conversation_id text not null,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  verb text,
  content text not null default '',
  source_labels jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_items (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  course_id text,
  topic_id text,
  kind text not null default 'note',
  title text not null,
  body text not null default '',
  source_material_ids jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.embeddings_metadata (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null,
  source_material_id text,
  memory_item_id text,
  provider text not null default 'pending',
  model text not null default 'pending',
  vector_table text,
  vector_ref text,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_profiles_user_id_idx on public.student_profiles (user_id);
create index if not exists courses_user_id_idx on public.courses (user_id);
create index if not exists topics_user_course_idx on public.topics (user_id, course_id);
create index if not exists syllabi_user_course_idx on public.syllabi (user_id, course_id);
create index if not exists exams_user_course_idx on public.exams (user_id, course_id);
create index if not exists assignments_user_due_idx on public.assignments (user_id, due_at);
create index if not exists timetable_events_user_start_idx on public.timetable_events (user_id, starts_at);
create index if not exists notes_user_topic_idx on public.notes (user_id, topic_id);
create index if not exists source_materials_user_course_idx on public.source_materials (user_id, course_id);
create index if not exists test_sessions_user_topic_idx on public.test_sessions (user_id, topic_id);
create index if not exists test_results_user_topic_idx on public.test_results (user_id, topic_id);
create index if not exists credit_ledger_user_created_idx on public.credit_ledger (user_id, created_at);
create index if not exists roadmap_items_user_status_idx on public.roadmap_items (user_id, status, due_at);
create index if not exists revision_events_user_schedule_idx on public.revision_events (user_id, scheduled_at);
create index if not exists tutor_lessons_user_topic_idx on public.tutor_lessons (user_id, topic_id);
create index if not exists assignment_contracts_user_assignment_idx on public.assignment_automation_contracts (user_id, assignment_id);
create index if not exists audit_logs_user_created_idx on public.audit_logs (user_id, created_at);
create index if not exists ai_conversations_user_created_idx on public.ai_conversations (user_id, created_at);
create index if not exists ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);
create index if not exists memory_items_user_topic_idx on public.memory_items (user_id, topic_id);
create index if not exists embeddings_metadata_user_source_idx on public.embeddings_metadata (user_id, source_material_id);

alter table public.student_profiles enable row level security;
alter table public.courses enable row level security;
alter table public.topics enable row level security;
alter table public.syllabi enable row level security;
alter table public.exams enable row level security;
alter table public.assignments enable row level security;
alter table public.timetable_events enable row level security;
alter table public.notes enable row level security;
alter table public.source_materials enable row level security;
alter table public.test_sessions enable row level security;
alter table public.test_results enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.roadmap_items enable row level security;
alter table public.revision_events enable row level security;
alter table public.tutor_lessons enable row level security;
alter table public.assignment_automation_contracts enable row level security;
alter table public.audit_logs enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.memory_items enable row level security;
alter table public.embeddings_metadata enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'student_profiles',
    'courses',
    'topics',
    'syllabi',
    'exams',
    'assignments',
    'timetable_events',
    'notes',
    'source_materials',
    'test_sessions',
    'test_results',
    'credit_ledger',
    'roadmap_items',
    'revision_events',
    'tutor_lessons',
    'assignment_automation_contracts',
    'audit_logs',
    'ai_conversations',
    'ai_messages',
    'memory_items',
    'embeddings_metadata'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_own', table_name);
    execute format(
      'create policy %I on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      table_name || '_own',
      table_name
    );
  end loop;
end $$;

revoke all on all tables in schema public from public;
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
