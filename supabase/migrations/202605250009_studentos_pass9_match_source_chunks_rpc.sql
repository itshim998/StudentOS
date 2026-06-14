-- StudentOS Pass 9 shard-side hybrid retrieval RPC
-- RUN IDENTICALLY ON: Project 2, Project 3, and Project 4.
-- Service-role backend calls must pass p_user_id; the function filters by user_id and never returns other users' chunks.

create or replace function public.studentos_json_cosine_similarity(left_values jsonb, right_values jsonb)
returns double precision
language sql
stable
as $$
  with pairs as (
    select
      l.ordinality,
      (l.value)::double precision as left_value,
      (r.value)::double precision as right_value
    from jsonb_array_elements_text(coalesce(left_values, '[]'::jsonb)) with ordinality as l(value, ordinality)
    join jsonb_array_elements_text(coalesce(right_values, '[]'::jsonb)) with ordinality as r(value, ordinality)
      on r.ordinality = l.ordinality
  ),
  sums as (
    select
      coalesce(sum(left_value * right_value), 0) as dot_product,
      coalesce(sum(left_value * left_value), 0) as left_mag,
      coalesce(sum(right_value * right_value), 0) as right_mag
    from pairs
  )
  select case
    when left_mag = 0 or right_mag = 0 then 0
    else dot_product / sqrt(left_mag * right_mag)
  end
  from sums;
$$;

create or replace function public.match_source_chunks(
  p_user_id uuid,
  p_query_embedding jsonb,
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
  confidence_score double precision,
  confidence_label text,
  embedding_status text,
  retrieval_mode text
)
language plpgsql
stable
as $$
declare
  has_vector boolean := false;
  vector_literal text;
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

  if has_vector then
    select '[' || string_agg(value::text, ',') || ']'
    into vector_literal
    from jsonb_array_elements_text(coalesce(p_query_embedding, '[]'::jsonb)) as value;

    if vector_literal is not null then
      return query execute $sql$
        select
          sc.id as chunk_id,
          sc.source_material_id as source_id,
          sm.title as source_title,
          coalesce(sc.citation_label, sm.citation_label, sm.title) as citation_label,
          sc.course_id,
          sc.topic_id,
          sc.chunk_index,
          left(sc.chunk_text, 420) as snippet,
          greatest(0, 1 - (sc.embedding <=> $1::extensions.vector))::double precision as similarity,
          least(1, greatest(0, 1 - (sc.embedding <=> $1::extensions.vector)))::double precision as confidence_score,
          case
            when greatest(0, 1 - (sc.embedding <=> $1::extensions.vector)) >= 0.60 then 'high'
            when greatest(0, 1 - (sc.embedding <=> $1::extensions.vector)) >= 0.42 then 'medium'
            else 'low'
          end as confidence_label,
          coalesce(sc.embedding_status, 'embedded') as embedding_status,
          'rpc-vector'::text as retrieval_mode
        from public.source_chunks sc
        join public.source_materials sm
          on sm.id = sc.source_material_id
         and sm.user_id = sc.user_id
        where sc.user_id = $2
          and sm.user_id = $2
          and sc.deleted_at is null
          and sm.deleted_at is null
          and sc.status = 'indexed'
          and sm.status = 'indexed'
          and sc.embedding is not null
          and ($3 is null or sc.course_id = $3)
          and ($4 is null or sc.topic_id = $4 or sc.topic_id is null)
          and greatest(0, 1 - (sc.embedding <=> $1::extensions.vector)) >= $5
        order by sc.embedding <=> $1::extensions.vector
        limit $6
      $sql$
      using vector_literal, p_user_id, p_course_id, p_topic_id, p_min_similarity, greatest(1, least(coalesce(p_match_count, 8), 50));
      return;
    end if;
  end if;

  return query
    with scored as (
      select
        sc.id as chunk_id,
        sc.source_material_id as source_id,
        sm.title as source_title,
        coalesce(sc.citation_label, sm.citation_label, sm.title) as citation_label,
        sc.course_id,
        sc.topic_id,
        sc.chunk_index,
        left(sc.chunk_text, 420) as snippet,
        greatest(0, public.studentos_json_cosine_similarity(sc.embedding_values, p_query_embedding))::double precision as similarity,
        coalesce(sc.embedding_status, 'pending_embedding') as embedding_status
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
        and sc.embedding_values is not null
        and (p_course_id is null or sc.course_id = p_course_id)
        and (p_topic_id is null or sc.topic_id = p_topic_id or sc.topic_id is null)
    )
    select
      scored.chunk_id,
      scored.source_id,
      scored.source_title,
      scored.citation_label,
      scored.course_id,
      scored.topic_id,
      scored.chunk_index,
      scored.snippet,
      scored.similarity,
      scored.similarity as confidence_score,
      case
        when scored.similarity >= 0.60 then 'high'
        when scored.similarity >= 0.42 then 'medium'
        else 'low'
      end as confidence_label,
      scored.embedding_status,
      'rpc-json'::text as retrieval_mode
    from scored
    where scored.similarity >= p_min_similarity
    order by scored.similarity desc
    limit greatest(1, least(coalesce(p_match_count, 8), 50));
end;
$$;

grant execute on function public.studentos_json_cosine_similarity(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.match_source_chunks(uuid, jsonb, text, text, integer, double precision) to authenticated, service_role;

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
        if new.embedding_values is not null then
          select '[' || string_agg(value::text, ',') || ']'
          into vector_literal
          from jsonb_array_elements_text(new.embedding_values) as value;
          if vector_literal is not null then
            new.embedding = vector_literal::extensions.vector;
          end if;
        end if;
        return new;
      end;
      $body$;
    $fn$;
    execute 'drop trigger if exists studentos_source_chunks_embedding_sync on public.source_chunks';
    execute 'create trigger studentos_source_chunks_embedding_sync before insert or update of embedding_values on public.source_chunks for each row execute function public.studentos_sync_source_chunk_embedding()';
    execute 'update public.source_chunks set embedding_values = embedding_values where embedding_values is not null and embedding is null';
  else
    raise notice 'StudentOS Pass 9: pgvector unavailable; match_source_chunks will use JSON embedding fallback.';
  end if;
exception when others then
  raise notice 'StudentOS Pass 9: optional vector sync skipped: %', SQLERRM;
end $$;
