-- C-02: embedding-space integrity and pgvector/full-text RRF retrieval.
-- Apply identically to every StudentOS shard before enabling real embeddings.

alter table public.source_chunks
  add column if not exists embedding_family text,
  add column if not exists embedding_version text,
  add column if not exists embedding_retry_required boolean not null default false,
  add column if not exists embedding_fallback boolean not null default false,
  add column if not exists embedding_target_provider text,
  add column if not exists embedding_target_family text,
  add column if not exists embedding_target_model text,
  add column if not exists embedding_target_version text,
  add column if not exists embedding_target_dimensions integer;

alter table public.embeddings_metadata
  add column if not exists embedding_family text,
  add column if not exists embedding_version text,
  add column if not exists retry_required boolean not null default false,
  add column if not exists fallback boolean not null default false;

-- Legacy deterministic vectors have a known identity. Other legacy vectors are not trusted
-- until they are re-embedded with an explicit family/version/dimension identity.
update public.source_chunks
set embedding_family = 'studentos_deterministic_hash',
    embedding_model = 'studentos-hash-embedding',
    embedding_version = '1',
    embedding_retry_required = false,
    embedding_fallback = false
where embedding_status = 'embedded'
  and embedding_provider = 'mock_deterministic'
  and (embedding_family is null or embedding_version is null);

update public.source_chunks
set embedding_status = 'retry_required',
    embedding_retry_required = true,
    embedding_error = coalesce(embedding_error, 'legacy_embedding_identity_missing')
where embedding_status = 'embedded'
  and (
    embedding_family is null
    or embedding_model is null
    or embedding_version is null
    or embedding_dimensions is null
  );

create index if not exists source_chunks_embedding_identity_idx
  on public.source_chunks (
    user_id,
    embedding_status,
    embedding_family,
    embedding_model,
    embedding_version,
    embedding_dimensions
  )
  where deleted_at is null;

create index if not exists source_chunks_retry_required_idx
  on public.source_chunks (user_id, embedding_retry_required, status)
  where deleted_at is null;

create index if not exists source_chunks_fts_idx
  on public.source_chunks using gin (to_tsvector('simple', coalesce(chunk_text, '') || ' ' || coalesce(citation_label, '')))
  where deleted_at is null and status = 'indexed';

create or replace function public.match_source_chunks_v2(
  p_user_id uuid,
  p_query_text text,
  p_query_embedding jsonb,
  p_embedding_provider text,
  p_embedding_family text,
  p_embedding_model text,
  p_embedding_version text,
  p_embedding_dimensions integer,
  p_course_id text default null,
  p_topic_id text default null,
  p_match_count integer default 8,
  p_min_similarity double precision default 0
)
returns table (
  chunk_id text,
  source_id text,
  source_title text,
  citation_label text,
  course_id text,
  topic_id text,
  chunk_index integer,
  snippet text,
  similarity double precision,
  lexical_score double precision,
  rrf_score double precision,
  confidence_score double precision,
  confidence_label text,
  embedding_status text,
  embedding_provider text,
  embedding_family text,
  embedding_model text,
  embedding_version text,
  embedding_dimensions integer,
  retrieval_mode text
)
language plpgsql
stable
security invoker
as $$
declare
  has_vector boolean := false;
  vector_literal text;
  safe_limit integer := greatest(1, least(coalesce(p_match_count, 8), 50));
begin
  if p_user_id is null then
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'source_chunks'
      and column_name = 'embedding'
  ) and to_regtype('extensions.vector') is not null
  into has_vector;

  if p_query_embedding is not null and jsonb_typeof(p_query_embedding) = 'array' then
    select '[' || string_agg(value::text, ',') || ']'
    into vector_literal
    from jsonb_array_elements_text(p_query_embedding) as value;
  end if;

  if has_vector and vector_literal is not null and p_embedding_dimensions = 384 then
    return query execute $sql$
      with base as (
        select
          sc.id,
          sc.source_material_id,
          sm.title as source_title,
          coalesce(sc.citation_label, sm.citation_label, sm.title) as citation_label,
          sc.course_id,
          sc.topic_id,
          sc.chunk_index,
          sc.chunk_text,
          sc.embedding_status,
          sc.embedding_retry_required,
          sc.embedding_provider,
          sc.embedding_family,
          sc.embedding_model,
          sc.embedding_version,
          sc.embedding_dimensions,
          sc.embedding,
          to_tsvector('simple', coalesce(sc.chunk_text, '') || ' ' || coalesce(sc.citation_label, '') || ' ' || coalesce(sm.title, '')) as search_vector
        from public.source_chunks sc
        join public.source_materials sm
          on sm.id = sc.source_material_id
         and sm.user_id = sc.user_id
        where sc.user_id = $1
          and sm.user_id = $1
          and sc.deleted_at is null
          and sm.deleted_at is null
          and sc.status = 'indexed'
          and sm.status = 'indexed'
          and ($9 is null or sc.course_id = $9)
          and ($10 is null or sc.topic_id = $10 or sc.topic_id is null)
      ),
      semantic as (
        select
          id,
          greatest(0, 1 - (embedding <=> $2::extensions.vector))::double precision as similarity,
          row_number() over (order by embedding <=> $2::extensions.vector) as semantic_rank
        from base
        where embedding is not null
          and embedding_status = 'embedded'
          and coalesce(embedding_retry_required, false) = false
          and embedding_provider = $3
          and embedding_family = $4
          and embedding_model = $5
          and embedding_version = $6
          and embedding_dimensions = $7
          and greatest(0, 1 - (embedding <=> $2::extensions.vector)) >= $12
        order by embedding <=> $2::extensions.vector
        limit greatest($11 * 6, 24)
      ),
      lexical as (
        select
          id,
          ts_rank_cd(search_vector, websearch_to_tsquery('simple', coalesce($8, '')))::double precision as lexical_score,
          row_number() over (
            order by ts_rank_cd(search_vector, websearch_to_tsquery('simple', coalesce($8, ''))) desc
          ) as lexical_rank
        from base
        where nullif(trim(coalesce($8, '')), '') is not null
          and search_vector @@ websearch_to_tsquery('simple', coalesce($8, ''))
        order by lexical_score desc
        limit greatest($11 * 6, 24)
      ),
      fused as (
        select
          coalesce(s.id, l.id) as id,
          coalesce(s.similarity, 0)::double precision as similarity,
          coalesce(l.lexical_score, 0)::double precision as lexical_score,
          (
            case when s.semantic_rank is null then 0 else 1.0 / (60 + s.semantic_rank) end
            + case when l.lexical_rank is null then 0 else 1.0 / (60 + l.lexical_rank) end
          )::double precision as rrf_score
        from semantic s
        full outer join lexical l on l.id = s.id
      )
      select
        b.id as chunk_id,
        b.source_material_id as source_id,
        b.source_title,
        b.citation_label,
        b.course_id,
        b.topic_id,
        b.chunk_index,
        left(b.chunk_text, 420) as snippet,
        f.similarity,
        f.lexical_score,
        f.rrf_score,
        least(1, greatest(f.similarity, least(1, f.lexical_score * 2)))::double precision as confidence_score,
        case
          when least(1, greatest(f.similarity, least(1, f.lexical_score * 2))) >= 0.60 then 'high'
          when least(1, greatest(f.similarity, least(1, f.lexical_score * 2))) >= 0.42 then 'medium'
          else 'low'
        end as confidence_label,
        b.embedding_status,
        b.embedding_provider,
        b.embedding_family,
        b.embedding_model,
        b.embedding_version,
        b.embedding_dimensions,
        'rpc-pgvector-rrf'::text as retrieval_mode
      from fused f
      join base b on b.id = f.id
      order by f.rrf_score desc, f.similarity desc, f.lexical_score desc
      limit $11
    $sql$
    using
      p_user_id,
      vector_literal,
      p_embedding_provider,
      p_embedding_family,
      p_embedding_model,
      p_embedding_version,
      p_embedding_dimensions,
      p_query_text,
      p_course_id,
      p_topic_id,
      safe_limit,
      p_min_similarity;
    return;
  end if;

  -- Fail closed to full-text retrieval when a compatible pgvector query is unavailable.
  -- JSON cosine is intentionally not used because it would reintroduce mixed-space risk.
  return query
    with base as (
      select
        sc.id,
        sc.source_material_id,
        sm.title as source_title,
        coalesce(sc.citation_label, sm.citation_label, sm.title) as citation_label,
        sc.course_id,
        sc.topic_id,
        sc.chunk_index,
        sc.chunk_text,
        sc.embedding_status,
        sc.embedding_provider,
        sc.embedding_family,
        sc.embedding_model,
        sc.embedding_version,
        sc.embedding_dimensions,
        to_tsvector('simple', coalesce(sc.chunk_text, '') || ' ' || coalesce(sc.citation_label, '') || ' ' || coalesce(sm.title, '')) as search_vector
      from public.source_chunks sc
      join public.source_materials sm
        on sm.id = sc.source_material_id
       and sm.user_id = sc.user_id
      where sc.user_id = p_user_id
        and sm.user_id = p_user_id
        and sc.deleted_at is null
        and sm.deleted_at is null
        and sc.status = 'indexed'
        and sm.status = 'indexed'
        and (p_course_id is null or sc.course_id = p_course_id)
        and (p_topic_id is null or sc.topic_id = p_topic_id or sc.topic_id is null)
    ), ranked as (
      select
        base.*,
        ts_rank_cd(search_vector, websearch_to_tsquery('simple', coalesce(p_query_text, '')))::double precision as lexical_score,
        row_number() over (
          order by ts_rank_cd(search_vector, websearch_to_tsquery('simple', coalesce(p_query_text, ''))) desc
        ) as lexical_rank
      from base
      where nullif(trim(coalesce(p_query_text, '')), '') is not null
        and search_vector @@ websearch_to_tsquery('simple', coalesce(p_query_text, ''))
    )
    select
      ranked.id as chunk_id,
      ranked.source_material_id as source_id,
      ranked.source_title,
      ranked.citation_label,
      ranked.course_id,
      ranked.topic_id,
      ranked.chunk_index,
      left(ranked.chunk_text, 420) as snippet,
      0::double precision as similarity,
      ranked.lexical_score,
      (1.0 / (60 + ranked.lexical_rank))::double precision as rrf_score,
      least(1, ranked.lexical_score * 2)::double precision as confidence_score,
      case
        when least(1, ranked.lexical_score * 2) >= 0.60 then 'high'
        when least(1, ranked.lexical_score * 2) >= 0.42 then 'medium'
        else 'low'
      end as confidence_label,
      ranked.embedding_status,
      ranked.embedding_provider,
      ranked.embedding_family,
      ranked.embedding_model,
      ranked.embedding_version,
      ranked.embedding_dimensions,
      'rpc-fts-rrf'::text as retrieval_mode
    from ranked
    order by ranked.lexical_score desc
    limit safe_limit;
end;
$$;

grant execute on function public.match_source_chunks_v2(
  uuid, text, jsonb, text, text, text, text, integer, text, text, integer, double precision
) to authenticated, service_role;

-- Keep pgvector synchronised only for fully valid, primary embeddings. Degraded or
-- retry-required vectors remain available in JSON for diagnostics/re-embedding but are
-- never treated as production semantic vectors.
do $$
begin
  if to_regtype('extensions.vector') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'source_chunks' and column_name = 'embedding'
  ) then
    execute $fn$
      create or replace function public.studentos_sync_source_chunk_embedding()
      returns trigger
      language plpgsql
      as $body$
      declare
        vector_literal text;
      begin
        if new.embedding_status = 'embedded'
           and coalesce(new.embedding_retry_required, false) = false
           and new.embedding_dimensions = 384
           and new.embedding_values is not null then
          select '[' || string_agg(value::text, ',') || ']'
          into vector_literal
          from jsonb_array_elements_text(new.embedding_values) as value;
          new.embedding = case when vector_literal is null then null else vector_literal::extensions.vector end;
        else
          new.embedding = null;
        end if;
        return new;
      end;
      $body$;
    $fn$;
    execute 'drop trigger if exists studentos_source_chunks_embedding_sync on public.source_chunks';
    execute 'create trigger studentos_source_chunks_embedding_sync before insert or update on public.source_chunks for each row execute function public.studentos_sync_source_chunk_embedding()';
    execute 'update public.source_chunks set embedding_values = embedding_values';
  end if;
exception when others then
  raise notice 'C-02 optional pgvector synchronisation skipped: %', SQLERRM;
end $$;
