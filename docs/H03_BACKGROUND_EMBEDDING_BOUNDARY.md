# H-03 background embedding boundary

Document and chunk embeddings are no longer generated or repaired while ordinary API state is being loaded.

## Execution boundary

Persisted document embeddings may be created or changed only by the background worker while processing:

- `source_ingestion` jobs;
- explicit `embedding_reindex` or `source_reindex` jobs;
- a separately controlled recovery job if a future recovery policy explicitly schedules one.

Ephemeral query vectors used by an intentional Ask StudentOS retrieval request are not persistence backfills. They are never written to source chunks or embedding metadata.

## Read behaviour

`getStateContext()` authenticates and loads the selected repository scope. It does not call an embedding provider and does not persist onboarding compatibility hydration. A missing profile is returned as an initial in-memory state and is first persisted by an explicit mutation.

Public workspace and source-status responses expose a read-only `embeddingProcessing` summary and per-source `processing` status. These values report queued, processing, awaiting-worker, ready, or needs-attention states without doing the work.

## Upload and reindex behaviour

Upload requests validate the file, store it privately, create the source record and enqueue one deterministic `source_ingestion` job. Extraction, chunking, embedding and embedding-metadata persistence happen in the worker.

`POST /api/embeddings/reindex` only creates or reuses one deterministic `embedding_reindex` job. Concurrent or repeated requests for the same scope converge on the same job ID instead of duplicating provider work.

## Persistence

The worker loads only academic-context state for ingestion and reindex work, or recovery state for recovery work. Source/chunk/metadata/job results are persisted through the H-02 transactional state-patch boundary. Queue-only changes use a narrow background-jobs and job-events patch.
