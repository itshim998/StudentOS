-- StudentOS Pass 6 source chunks and embedding-ready metadata
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.

create table if not exists public.source_chunks (
  id text primary key,
  user_id uuid not null,
  source_material_id text not null,
  course_id text,
  topic_id text,
  chunk_index integer not null,
  chunk_text text not nulvl,
  char_count integer not null default 0,
  token_estimate integer not null default 0,
  citation_label text,
  status text not null default 'indexed',
  payload jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists source_chunks_user_source_idx on public.source_chunks (user_id, source_material_id, chunk_index);
create index if not exists source_chunks_user_course_idx on public.source_chunks (user_id, course_id, status);

alter table public.source_chunks enable row level security;

drop policy if exists source_chunks_own on public.source_chunks;
create policy source_chunks_own
  on public.source_chunks
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.embeddings_metadata
  add column if not exists source_chunk_id text,
  add column if not exists chunk_index integer,
  add column if not exists dimensions integer,
  add column if not exists embedding_status text not null default 'pending_embedding',
  add column if not exists error text;

create index if not exists embeddings_metadata_user_chunk_idx on public.embeddings_metadata (user_id, source_chunk_id);

grant select, insert, update, delete on public.source_chunks to authenticated;
grant all on public.source_chunks to service_role;
