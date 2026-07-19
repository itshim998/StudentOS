# Build Week Changelog

## Adaptive Recovery Engine backend — 2026-07-19

Baseline and final observed working-tree `HEAD`: `aac00ac5f2b811eab2666bc5595bc70e80bdc7d0` (implementation remains uncommitted at documentation time).

Added:

- Default-off recovery configuration, strict Zod request/reasoning contracts, typed recovery errors, semantic event normalization, deterministic snapshots, evidence grounding, recovery transitions, priority scoring, constrained planning, and backend plan diffs.
- Durable recovery run/preview/version processing in the existing background worker, with recovery-only Groq -> Gemini -> Pollinations routing and one existing planning allowance operation per batch.
- Authenticated analyze/run/preview/apply/reject endpoints with idempotency, ownership, replay, expiry, stale-version, and sanitized failure behavior.
- Additive data-shard migration with owner RLS, immutable history/version records, uniqueness guards, database-backed mutation leasing, and one transactional preview-apply RPC.
- Recovery data in account export/deletion inventories, environment templates, production preflight status, migration planning, live schema verification, focused tests, and a derived evaluation artifact.

Preserved:

- Existing Today/To-Do behavior while disabled, the existing availability allocator and roadmap, existing provider behavior outside recovery, weekly allowances and pricing, and Classroom's read-only boundary.

Not added:

- Frontend redesign, multi-day scheduling, automatic preview application, Classroom writeback, billing changes, quota changes, providers, or a parallel planning system.

Operational requirement: apply `202607190001_studentos_adaptive_recovery_engine.sql` identically to data Projects 2, 3, and 4 before enabling the API hooks and worker processing. Rollback starts by disabling recovery and its worker processing; additive audit and immutable plan records remain.
