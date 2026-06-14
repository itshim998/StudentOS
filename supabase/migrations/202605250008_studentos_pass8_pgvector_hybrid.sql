-- StudentOS Pass 8 pgvector-ready hybrid retrieval
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- This migration is additive. It keeps JSON fallback columns even if pgvector is unavailable.

alter table public.source_chunks
  add column if not exists embedding_status text not null default 'pending_embedding',
  add column if not exists embedding_provider text,
  add column if not exists embedding_model text,
  add column if not exists embedding_hash text,
  add column if not exists embedding_dimensions integer,
  add column if not exists embedding_values jsonb,
  add column if not exists embedding_updated_at timestamptz,
  add column if not exists embedding_error text;

alter table public.embeddings_metadata
  add column if not exists embedding_hash text,
  add column if not exists embedding_values jsonb;

create index if not exists source_chunks_user_embedding_status_idx
  on public.source_chunks (user_id, embedding_status, status);

create index if not exists source_chunks_user_embedding_hash_idx
  on public.source_chunks (user_id, embedding_hash);

do $$
begin
  begin
    create extension if not exists vector with schema extensions;
  exception when others then
    raise notice 'StudentOS Pass 8: pgvector extension unavailable; JSON embedding fallback remains enabled.';
  end;

  if to_regtype('extensions.vector') is not null then
    execute 'alter table public.source_chunks add column if not exists embedding extensions.vector(384)';
    execute 'create index if not exists source_chunks_embedding_ivfflat_idx on public.source_chunks using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 100)';
  else
    raise notice 'StudentOS Pass 8: skipping vector column/index because extensions.vector is unavailable.';
  end if;
exception when others then
  raise notice 'StudentOS Pass 8: optional vector setup skipped: %', SQLERRM;
end $$;

-- OCR is intentionally not implemented in Pass 8.
-- Future scaffold: add source_materials.ocr_status/ocr_provider/ocr_error when scanned-PDF OCR is added.
