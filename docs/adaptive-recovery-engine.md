# Adaptive Recovery Engine

## Scope and provenance

The implementation baseline and final observed working-tree `HEAD` are both `aac00ac5f2b811eab2666bc5595bc70e80bdc7d0`. The recovery implementation is an uncommitted working-tree change on that baseline at the time this document was written.

StudentOS already had mapped question/topic assessment evidence, topic performance summaries, a deterministic Today planner and availability allocator, a roadmap backlog, authenticated sharded Supabase persistence, a durable background-job worker, provider fallback, diagnostics, and the weekly AI allowance ledger. Build Week adds the recovery event/snapshot/state/run/preview/version lifecycle, strict runtime contracts, deterministic recovery policy and diffs, transactional application, API endpoints, worker routing, evaluation, and operations documentation. It does not claim the pre-existing systems as new work.

The engine changes only today's plan and existing roadmap records after explicit preview application. Multi-day scheduling, a new frontend, Classroom writes, billing or quota changes, additional providers, and a second planning system are outside scope. Classroom remains read-only.

## Runtime flow

When `STUDENTOS_ADAPTIVE_RECOVERY_ENABLED` is false, semantic hooks return before creating recovery records and every recovery endpoint returns `RECOVERY_ENGINE_DISABLED`. Existing Today and To-Do writes continue through their established paths.

When enabled, assessment/reassessment completion, task completion or rollover, material availability/context changes, exam changes, meaningful Classroom sync deltas, manual analysis, and preview application create bounded semantic events. Events contain identifiers and deltas; they exclude answer sheets, source content, uploads, tokens, secrets, and complete Classroom objects. Automatic hooks coalesce pending events into one queued recovery run.

The worker persists this lifecycle:

`queued -> building_state -> reasoning -> validating -> planning -> ready_for_review -> applying -> applied`

Terminal states are `rejected`, `superseded`, and `failed`. A snapshot is a canonical SHA-256 fingerprint of compact academic state. Identical state reuses the existing immutable snapshot. An academic-revision conflict before preview creation supersedes the run.

Reasoning context uses known course/topic IDs, deterministic `evidence:{testResultId}:{topicId}` references, mapped marks, recovery state, deadlines, available minutes, unfinished tasks, and an explicit untrusted-data boundary. The strict Zod contract rejects unknown properties, fabricated/duplicate references, invalid enums, invalid IANA timezones, oversized fields/counts/durations, fenced output, and malformed JSON. Invalid output is not repaired or retried with a second model call.

Recovery alone fixes provider order to Groq, Gemini, then Pollinations. Existing workflows keep their established routing. One batched run reserves one existing `planning` allowance operation even if provider fallback occurs. Raw provider responses are not persisted. Runs retain validated conclusions and sanitized provider/model/outcome/latency metadata only.

## Deterministic policy and planning

Evidence strength is calculated in application code, never accepted from the model:

- Strong: two below-threshold assessments, or at least three mapped incorrect answers totalling at least 10 lost marks.
- Moderate: at least two mapped incorrect answers, or at least 5 lost marks.
- Weak: one valid mapped incorrect answer.
- Insufficient: no mapped incorrect evidence or an invalid topic mapping.

Priority is clamped to 0–100 from the specified evidence base, exam proximity, assignment urgency, unfinished work, active recovery, secure reassessment reduction, course-overload penalty, and model direction limited to plus/minus five. Bands are critical at 80, high at 60, medium at 35, and low above zero.

The model selects bounded recovery direction but never time slots. Recovery activities are restricted to concept review, worked examples, targeted practice, retrieval practice, reassessment, unfinished-work resumption, and 20–60 minute tasks. The existing allocator chooses exact slots. Multiple eligible courses cap one course at 50 percent of available recovery minutes. The validator checks course/topic/evidence ownership, availability windows, fixed commitments, overlaps, capacity, duplicate IDs, task durations, completed-work immutability, and explicit unfinished-work deferral during both preview construction and immediate pre-apply validation.

Task completion moves recovery to `awaiting_reassessment`; it cannot resolve mastery. Only mapped reassessment evidence satisfying the existing 70 percent topic policy resolves recovery. Later below-threshold mapped evidence reactivates the topic. Diffs classify additions, moves, duration/priority changes, reassessments, explicit deferrals, safe removals, and unchanged work. Completed work remains byte-for-field stable in the relevant task fields; unfinished work must remain scheduled or explicitly deferred.

## Persistence and concurrency

Migration `supabase/migrations/202607190001_studentos_adaptive_recovery_engine.sql` is additive and idempotent. Apply it to data Projects 2, 3, and 4 only, never the Auth project. It adds owner-RLS tables for recovery user state, semantic events, immutable snapshots, current topic recovery state and immutable history, durable runs, previews, and immutable plan versions. It extends `background_jobs` with `recovery_analysis` and adds uniqueness constraints for event idempotency, snapshot/version reuse, active run deduplication, preview/run association, plan versions, and successful preview application.

Recovery-relevant saves acquire the service-role-only `acquire_recovery_mutation_lease` RPC using the versions observed on load. A stale writer receives `RECOVERY_CONCURRENCY_CONFLICT` rather than overwriting newer recovery state. The lease is bounded and released after recovery collections are saved. Preview application uses the same user guard plus a database transaction and row locks on user state, run, and preview.

`apply_recovery_preview` verifies owner, idempotency key, preview/run association, expiry/status, academic revision, base plan version, and base plan pointer. It atomically writes the new immutable plan bundle, updates the profile Today plan and roadmap, transitions recovery states/history, records the applied semantic event and audit row, and marks preview/run applied. Same-key replay returns the original plan; another key returns `RECOVERY_PREVIEW_ALREADY_APPLIED`.

Existing `dailyTodoPlan` data is lazily adopted as plan version 1. With recovery enabled, later Today generations and study-status changes create immutable plan versions, making pending previews stale when appropriate. Recovery collections are included in safe account exports, deletion dry-run inventories, and final shard deletion.

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

1. Keep `STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false` and background recovery processing disabled.
2. Apply the migration identically to data Projects 2, 3, and 4.
3. Deploy API and background-worker code.
4. Run `npm run migration:plan`, `npm run verify:recovery-schema`, `npm run test:recovery`, `npm run eval:recovery`, the full `npm test`, and production preflight.
5. Enable background workers, confirm worker health, then enable adaptive recovery for the intended environment.

Rollback disables adaptive recovery and recovery job processing first, then rolls back API/worker code if required. Additive tables remain for audit and recovery. Do not drop immutable audit/snapshot/plan data during an operational rollback. The last valid immutable plan version remains available, and the live Today plan is not changed by disabling the engine.

## Evaluation and limitations

`npm run test:recovery` covers schemas, event idempotency, fingerprint reuse, grounding, evidence policy, topic transitions, priority adaptation, feasibility, apply replay, stale and cross-user access, mutation conflict, provider failure, invalid output, disabled behavior, migration guards, and API presence. Provider behavior is deterministically mocked and normal tests make no external calls.

`npm run eval:recovery` runs the real grounding, transition, priority, feasibility, reassessment, authorization, and provider-failure code paths. It writes `test-results/recovery-evaluation-summary.json` and exits non-zero if any required case fails.

The current implementation does not schedule beyond today, redesign Today/To-Do, auto-apply a preview, write to Classroom, repair invalid model responses, add provider or billing behavior, or migrate the Auth project. Live schema verification requires configured shard credentials and is intentionally not run by normal tests.
