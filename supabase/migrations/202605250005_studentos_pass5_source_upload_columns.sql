-- StudentOS Pass 5 source upload metadata columns
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- This is additive and keeps existing payload-based rows compatible.

alter table public.source_materials
  add column if not exists source_type text,
  add column if not exists filename text,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint,
  add column if not exists status text not null default 'ready',
  add column if not exists extracted_text text,
  add column if not exists extraction_summary text;

create index if not exists source_materials_user_status_idx on public.source_materials (user_id, status);
create index if not exists source_materials_user_deleted_idx on public.source_materials (user_id, deleted_at);

alter table public.memory_items
  add column if not exists status text not null default 'ready',
  add column if not exists deleted_at timestamptz;

create index if not exists memory_items_user_status_idx on public.memory_items (user_id, status, deleted_at);
