-- StudentOS Pass 7 extraction metadata
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- Additive only. Existing payload rows remain compatible.

alter table public.source_materials
  add column if not exists extraction_error text,
  add column if not exists extraction_pages integer,
  add column if not exists extraction_provider text,
  add column if not exists indexed_at timestamptz,
  add column if not exists failed_at timestamptz;

create index if not exists source_materials_user_extraction_provider_idx
  on public.source_materials (user_id, extraction_provider);

create index if not exists source_materials_user_indexed_idx
  on public.source_materials (user_id, indexed_at)
  where indexed_at is not null;

create index if not exists source_materials_user_failed_idx
  on public.source_materials (user_id, failed_at)
  where failed_at is not null;
