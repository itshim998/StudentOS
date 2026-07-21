# Adaptive Recovery Engine

## Scope and provenance

The original Build Week baseline is `aac00ac5f2b811eab2666bc5595bc70e80bdc7d0`. The implementation reviewed for this remediation is commit `e46da0ecbbb88eec418f49a62aca9b340bd1e17f`, which is also the final observed repository `HEAD` while these remediation changes remain uncommitted. No remediation commit hash is claimed.

Migration 001 was already applied and successfully verified on data Projects 2–4 before remediation. Migration 002 is implemented locally but remains pending deployment. The Azure deployment workflow had not been run when remediation started. Adaptive Recovery remains disabled until migration 002, the API, the dedicated worker, and post-deployment validation all succeed.

StudentOS already had mapped question/topic assessment evidence, topic performance summaries, a deterministic Today planner and availability allocator, a roadmap backlog, authenticated sharded Supabase persistence, a durable background-job worker, provider fallback, diagnostics, and the weekly AI allowance ledger. Build Week adds the recovery event/snapshot/state/run/preview/version lifecycle, strict runtime contracts, deterministic recovery policy and diffs, transactional application, API endpoints, worker routing, evaluation, and operations documentation. It does not claim the pre-existing systems as new work.

The engine changes only today's plan and existing roadmap records after explicit preview application. Multi-day scheduling, a new frontend, Classroom writes, billing or quota changes, additional providers, and a second planning system are outside scope. Classroom remains read-only.

## Runtime flow

When `STUDENTOS_ADAPTIVE_RECOVERY_ENABLED` is false, semantic hooks return before creating recovery records and every recovery endpoint returns `RECOVERY_ENGINE_DISABLED`. Existing Today and To-Do writes continue through their established paths.

When enabled, assessment/reassessment completion, task completion or rollover, material availability/context changes, exam changes, meaningful Classroom sync deltas, manual analysis, and preview application create bounded semantic events. Events contain identifiers and deltas; they exclude answer sheets, source content, uploads, tokens, secrets, and complete Classroom objects. Automatic hooks coalesce pending events into one queued recovery run.

The worker persists this lifecycle:

`queued -> building_state -> reasoning -> validating -> planning -> ready_for_review -> applying -> applied`

Terminal states are `rejected`, `superseded`, and `failed`. Retryable failures reuse the same run and background job through `failed -> retrying -> building_state`, archive sanitized attempt metadata, and increment `processingAttempt`. Only errors explicitly marked retryable are retried, and exhaustion marks the existing run without creating a preview or replacement run. A snapshot is a canonical SHA-256 fingerprint of compact academic state. Identical state reuses the existing immutable snapshot. An academic-revision conflict before preview creation supersedes the run.

Reasoning context uses known course/topic IDs, deterministic `evidence:{testResultId}:{topicId}` references, mapped marks, recovery state, deadlines, available minutes, unfinished tasks, and an explicit untrusted-data boundary. The strict Zod contract rejects unknown properties, fabricated/duplicate references, invalid enums, invalid IANA timezones, oversized fields/counts/durations, fenced output, and malformed JSON. Schema-invalid output advances to the next provider in the fixed order; it never triggers a same-provider repair call. If at least one provider responds but none returns valid schema, the run fails non-retryably with `RECOVERY_OUTPUT_INVALID`. Transport-only failure remains retryable.

Recovery alone fixes provider order to Groq, Gemini, then Pollinations and forces the existing routed allowance lifecycle even when general cycling is disabled. Existing workflows keep their established routing. One batched run uses one existing `planning` allowance ledger row even across background retries: retryable failure refunds and reopens the same request, while success charges it exactly once. Raw provider responses are not persisted. Runs retain validated conclusions and sanitized provider/model/outcome/latency metadata only.

## Deterministic policy and planning

Evidence strength is calculated in application code, never accepted from the model:

- Strong: two below-threshold assessments, or at least three mapped incorrect answers totalling at least 10 lost marks.
- Moderate: at least two mapped incorrect answers, or at least 5 lost marks.
- Weak: one valid mapped incorrect answer.
- Insufficient: no mapped incorrect evidence or an invalid topic mapping.

Priority is clamped to 0–100 from the specified evidence base, exam proximity, assignment urgency, unfinished work, active recovery, secure reassessment reduction, course-overload penalty, and model direction limited to plus/minus five. Bands are critical at 80, high at 60, medium at 35, and low above zero.

The model selects bounded recovery direction but never time slots. New recovery activities are restricted to concept review, worked examples, targeted practice, retrieval practice, reassessment, and 20–60 minute tasks. Existing unfinished tasks are tagged separately and retain their full positive duration, including durations above 60 minutes. They are scheduled only when the whole task fits or deferred whole with the original task ID and duration; tasks are not split in this pass. The existing allocator chooses exact slots. Multiple eligible courses cap one course at 50 percent of available recovery minutes. The validator checks course/topic/evidence ownership, availability windows, fixed commitments, overlaps, capacity, duplicate IDs, generated-task durations, completed-work immutability, and explicit whole unfinished-work deferral during both preview construction and immediate pre-apply validation.

Task completion moves recovery to `awaiting_reassessment`; it cannot resolve mastery. Only mapped reassessment evidence satisfying the existing 70 percent topic policy resolves recovery. Later below-threshold mapped evidence reactivates the topic. Diffs classify additions, moves, duration/priority changes, reassessments, explicit deferrals, safe removals, and unchanged work. Completed work remains byte-for-field stable in the relevant task fields; unfinished work must remain scheduled or explicitly deferred.

## Persistence and concurrency

Migration `supabase/migrations/202607190001_studentos_adaptive_recovery_engine.sql` is the unchanged, already-applied Build Week schema. Additive migration `supabase/migrations/202607190002_studentos_adaptive_recovery_hardening.sql` is pending and must be applied identically to data Projects 2, 3, and 4 only, never the Auth project. Migration 002 revokes every table privilege, including `SELECT`, from `public`, `anon`, and `authenticated` on all eight recovery authority tables; leaves dormant owner-scoped read policies as defense in depth; restores full `service_role` authority; and exposes a service-role-only permission-posture RPC for live verification.

Worker lifecycle persistence now calls the service-role-only `persist_recovery_changes` RPC with exact changed recovery rows and newly queued recovery jobs. The RPC locks and version-checks recovery user state, rejects active leases and stale academic/plan versions, preserves database-managed lease fields, validates ownership/collection shapes, inserts immutable rows without rewriting them, and commits the whole delta atomically. Worker progress never writes profiles, preferences, courses, assignments, notes, sources, roadmap, or other ordinary collections. Normal request hooks commit their established ordinary write first, reload recovery authority, and retry one recovery-version conflict; a remaining auxiliary failure is sanitized and does not turn a successful ordinary write into an HTTP failure. Preview application remains exclusively on `apply_recovery_preview`.

`apply_recovery_preview` verifies owner, idempotency key, preview/run association, expiry/status, academic revision, base plan version, and base plan pointer. It atomically writes the new immutable plan bundle, updates the profile Today plan and roadmap, transitions recovery states/history, records the applied semantic event and audit row, and marks preview/run applied. Same-key replay returns the original plan; another key returns `RECOVERY_PREVIEW_ALREADY_APPLIED`.

Existing `dailyTodoPlan` data is lazily adopted as plan version 1. With recovery enabled, later Today generations and study-status changes create immutable plan versions, making pending previews stale when appropriate. Recovery collections are included in safe account exports, deletion dry-run inventories, and final shard deletion. Exported topic records use the persisted evidence strength, priority/band, status, reason/explanation, evidence IDs, versions, and observation/resolution timestamps; lease fields, provider routing, raw output, tokens, credentials, and secrets are excluded.

## API and failure contract

Authenticated endpoints are:

- `POST /api/recovery/analyze` (202)
- `GET /api/recovery/runs/:id`
- `GET /api/recovery/previews/:id`
- `POST /api/recovery/previews/:id/apply`
- `POST /api/recovery/previews/:id/reject`

Mutations require `Idempotency-Key`. Analyze accepts only optional local `currentDate`, `currentTime`, and IANA `timezone`; apply/reject accept an empty object. Errors expose only `error`, stable `code`, `retryable`, `correlationId`, and the existing `secretsPrinted: false` marker. Ownership is 403, stale/applied/concurrency conflict is 409, evidence/context/feasibility is 422, invalid/provider output is 502/503, and allowance exhaustion is 429. Provider, validation, allowance, timeout, and concurrency failures never alter the live plan.

## Deployment and rollback

Deployment order:

1. Keep `STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false`; do not use the migration-001 baseline verifier as evidence that hardening is deployed.
2. Apply migration 002 identically to data Projects 2, 3, and 4.
3. Run `npm run verify:recovery-schema` and require the permission-posture and scoped-persistence RPC checks. `npm run verify:recovery-schema:baseline` exists only to identify a migration-001-only environment.
4. Deploy the API and dedicated no-ingress worker from the same image. The API stays at 0–1 replicas; the worker runs `npm run jobs:dev` at fixed 1–1 replicas with `0.25` CPU and `0.5Gi` memory. Keep recovery false on both.
5. Validate API behavior and inspect the actual worker image, command, absent ingress, fixed scale, secret/env wiring, and ready revision. Run recovery tests/evaluation, full tests, syntax checks, production/Azure preflights, and whitespace checks.
6. Enable recovery only in a later controlled workflow request after all preceding gates pass.

Rollback disables adaptive recovery and recovery job processing first, then rolls back API/worker code if required. Additive tables remain for audit and recovery. Do not drop immutable audit/snapshot/plan data during an operational rollback. The last valid immutable plan version remains available, and the live Today plan is not changed by disabling the engine.

## Evaluation and limitations

`npm run test:recovery` covers schemas, event idempotency, fingerprint reuse, grounding, evidence policy, topic transitions, priority adaptation, feasibility, apply replay, stale and cross-user access, scoped persistence conflicts/atomicity, retry/restart/success and exhaustion, one-charge allowance semantics, provider transport versus invalid-output behavior, full provider traversal without repair, 90-minute unfinished-task handling, safe export fields, migration immutability/permissions, disabled behavior, and API presence. Provider behavior is deterministically mocked and normal tests make no external calls.

`npm run eval:recovery` runs the real grounding, transition, priority, feasibility, reassessment, authorization, and provider-failure code paths. It writes `test-results/recovery-evaluation-summary.json` and exits non-zero if any required case fails.

The current implementation does not schedule beyond today, redesign Today/To-Do, auto-apply a preview, write to Classroom, repair invalid model responses, add provider or billing behavior, split long unfinished tasks, or migrate the Auth project. Live schema verification requires configured shard credentials and is intentionally excluded from normal tests and CI. Do not run the hardened verifier until migration 002 is deployed.

The repository has no lint or static type-check configuration. Validation therefore reports those as unavailable and uses repository-wide `node --check`, runtime Zod contracts, focused tests, preflights, and the full Playwright-backed suite instead.
