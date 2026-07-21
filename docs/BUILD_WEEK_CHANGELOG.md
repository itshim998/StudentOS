# Build Week Changelog

## Adaptive Recovery Engine backend — 2026-07-19

Original baseline: `aac00ac5f2b811eab2666bc5595bc70e80bdc7d0`. The completed implementation commit is `e46da0ecbbb88eec418f49a62aca9b340bd1e17f`.

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

Migration 001 was applied and verified identically on data Projects 2, 3, and 4. Recovery remained disabled.

## Adaptive Recovery production-readiness remediation — 2026-07-19

Observed `HEAD`: `e46da0ecbbb88eec418f49a62aca9b340bd1e17f`. Remediation changes remain uncommitted, so no remediation commit hash is claimed. The Azure workflow had not been run when remediation began.

Added and corrected:

- Dedicated Azure Container App worker using the API image, no ingress, `npm run jobs:dev`, `0.25` CPU, `0.5Gi`, and fixed 1–1 replicas; the API remains 0–1. The manual workflow now maps the same backend/provider secrets to both resources and validates the actual worker before a future enable request.
- Push/PR validation on Node 22 with clean install, Playwright Chromium, migration planning, recovery tests/evaluation, full tests, production/Azure preflights, repository Node syntax checks, and whitespace checks. It never deploys or performs live Supabase verification.
- Same-run/same-job retry lifecycle with sanitized attempt history, retryability-aware job handling, exhaustion, allowance-row reopening/refund, and exactly-once charge on eventual success.
- Strict recovery output validation inside provider fallback: schema-invalid Groq can fall through to Gemini and Pollinations, while all-invalid output is non-retryable and transport-only failure is retryable. There is no repair call and no raw-output persistence.
- Additive migration 002 with authenticated/public privilege revocation, dormant owner-read policies, service-role authority and permission verification, plus transactional exact-delta recovery persistence.
- Ordinary-first request hooks and exact worker recovery deltas so recovery progress cannot overwrite unrelated profile/preferences or ordinary academic collections.
- Full-duration handling for existing unfinished tasks, while only new recovery activities remain clamped to 20–60 minutes.
- Correct persisted recovery export fields with lease/provider/raw-output/secret exclusions, migration-002-aware schema tooling, and focused remediation coverage.

Operational status: migration 002 is pending deployment and the updated live schema verifier has not been run. Adaptive Recovery remains disabled pending migration 002 on all three data shards, hardened live verification, API/worker deployment with recovery false, actual worker readiness inspection, and post-deployment validation. Migration 001 remains byte-for-byte unchanged.
