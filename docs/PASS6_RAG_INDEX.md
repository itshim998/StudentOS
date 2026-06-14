# StudentOS Pass 6 RAG Index

Pass 6 adds the first real retrieval index without calling an embedding provider.

## Required Migration

Run this on each data shard project:

`supabase/migrations/202605250006_studentos_pass6_source_chunks.sql`

It creates:

- `source_chunks`
- embedding-ready metadata columns on `embeddings_metadata`

## Pipeline

1. Upload private source through StudentOS backend.
2. Validate file type and size.
3. Upload bytes to the private shard bucket.
4. Extract text:
   - `text/plain`, Markdown: real text extraction.
   - PDF/DOC/PPT/slides: safe placeholder text until parsers are added.
5. Chunk extracted text.
6. Store `source_chunks`.
7. Store `embeddings_metadata` rows with `pending_embedding` status.
8. Ask/Plan/Make/Review retrieves ranked chunks before demo fallback.

## Status Flow

`uploaded -> extracting -> indexed`

If usable text cannot be extracted:

`uploaded -> extracting -> failed`

## Current Retrieval

The ranker uses keyword, course, topic, uploaded-source priority, and chunk match scoring. It returns source title, chunk snippet, and citation label. It does not create citations unless a real uploaded chunk, uploaded material, memory extraction, or mock source exists.

## Next Step

Pass 7 can add background workers and real embeddings. The `embeddings_metadata` rows already carry source/chunk references for that migration.
