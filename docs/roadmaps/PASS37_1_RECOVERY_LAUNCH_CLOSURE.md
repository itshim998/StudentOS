# PASS 37.1 — Adaptive Recovery launch closure

Status: code-complete and default-off. This pass does not authorize production enablement.

## Scope

PASS 37.1 closes the code-level launch boundary for Adaptive Recovery without changing the existing database schema or running the Recovery worker. It adds a dedicated Plus/Pro entitlement, a separate public-UI kill switch, consistent authorization on every public Recovery route, safe run and preview projections, a small reusable frontend API/access seam, a review-first Today interface, deterministic tests, and this launch record.

The pass does not add faculty provenance, learning-capacity estimation, combined lessons, Assignment Coach V2, diagrams, image generation, UI action execution, live voice, social challenges, proctoring, Android, Classroom writeback, or assignment submission.

## Product decisions

- Adaptive Recovery is available only to active Plus and Pro subscriptions.
- Trial Mode, Starter, and Essential are not entitled.
- Analysis starts only after an explicit student action. Opening or reading Today does not start analysis.
- Every result is a proposal. The live Today plan changes only after an explicit second-step confirmation.
- Reject keeps the current plan.
- Applied, rejected, stale, expired, superseded, and failed results never offer an unsupported one-click undo.
- Existing immutable plan-version history remains the internal audit/recovery mechanism.
- Classroom stays read-only, and the interface explicitly states that applying does not change Classroom or submit assignments.

## Entitlement and flags

The dedicated server-owned entitlement is:

`adaptive_recovery.enabled`

Plan mapping:

| Access | Adaptive Recovery |
| --- | --- |
| Trial Mode | unavailable |
| Starter | unavailable |
| Essential | unavailable |
| Plus | entitled |
| Pro | entitled |

Both flags are required for public availability:

| Flag | Default | Purpose |
| --- | --- | --- |
| `STUDENTOS_ADAPTIVE_RECOVERY_ENABLED` | `false` | Enables the existing Recovery engine boundary. |
| `STUDENTOS_RECOVERY_UI_ENABLED` | `false` | Exposes the public Recovery capability and routes to the frontend. |

The entitlement remains authoritative even when both flags are true. Neither flag is enabled in `.env`, a workflow, or production configuration by this pass. The Azure deployment workflow keeps the existing engine flag explicitly set to `false`.

## Backend route gates

The following routes share the same server-owned access policy:

| Route | Required checks |
| --- | --- |
| `POST /api/recovery/analyze` | Account session, narrow Recovery state, engine flag, UI flag, dashboard-active lifecycle, Plus/Pro entitlement, request rate policy, `Idempotency-Key`, existing AI allowance settlement. |
| `GET /api/recovery/runs/:id` | Account session, narrow Recovery state, both flags, lifecycle, entitlement, owned run lookup. |
| `GET /api/recovery/previews/:id` | Account session, narrow Recovery state, both flags, lifecycle, entitlement, owned preview lookup. |
| `POST /api/recovery/previews/:id/apply` | Account session, narrow Recovery state, both flags, lifecycle, entitlement, ownership, `Idempotency-Key`, stale/expiry/supersession checks, transactional apply. |
| `POST /api/recovery/previews/:id/reject` | Account session, narrow Recovery state, both flags, lifecycle, entitlement, ownership, `Idempotency-Key`, expiry/status checks, idempotent rejection. |

The route layer continues to use `loadRecoveryState`; it does not fall back to full-account or dashboard fan-out. The Recovery state scope does not include source chunks, embedding metadata, AI messages, or AI conversations.

## Public contract

The product-capability projection reports one of four values without requiring browser-side plan-name logic:

- `disabled`
- `plan_unavailable`
- `setup_required`
- `available`

It also states that review is required and automatic apply is false.

Public run responses contain only:

- run ID;
- safe status and progress stage;
- preview ID when ready;
- stable safe error code and retryability;
- correlation ID;
- created and updated times.

Public preview responses contain only:

- preview/run IDs;
- safe status;
- concise student-facing summary;
- aggregate evidence counts;
- current/proposed task and minute summaries;
- human-readable added, moved, adjusted, reassessment, deferred, and warning groups;
- expiry and update times;
- apply/reject availability;
- correlation ID.

They do not expose raw provider output, provider or model identity, prompts, tokens, leases, snapshots, internal job payloads, raw evidence IDs, private quota state, answer sheets, hidden rubrics, or chain-of-thought. The general `PublicStudentWorkspaceDTO` still forbids internal Recovery collections.

## Frontend module boundary

One application bootstrap and one session source of truth remain in `frontend/scripts/app.js`.

- `frontend/scripts/core/api-client.js` owns the shared authenticated JSON request primitive and preserves safe error metadata.
- `frontend/scripts/core/feature-access.js` reads only the server-projected Recovery capability.
- `frontend/scripts/features/recovery.js` owns the Recovery surface, explicit analysis start, one bounded poller, safe state mapping, preview rendering, confirmation, apply/reject idempotency keys, refresh identifiers, focus restoration, and session/close cancellation.
- `app.js` supplies the existing session-backed API facade, current public workspace state, and a callback that refreshes Today after apply.

No framework, parallel authentication system, duplicate entitlement table, model-selected selector, arbitrary dynamic import, or broad `app.js` rewrite was introduced.

## User-interface states

The Today entry is rendered only for `available`. Ineligible and disabled accounts do not receive a permanent warning.

The Recovery dialog supports:

1. Idle explanation and explicit review action.
2. Queued/preparing progress.
3. Evidence review and planning progress.
4. Ready-for-review comparison with progressive disclosure for change groups.
5. Explicit apply confirmation that names Today and excludes Classroom/submission changes.
6. Applied success followed by authoritative Today refresh.
7. Rejected confirmation that the current plan was kept.
8. Safe failure and retry guidance with the current plan preserved.
9. Stale, superseded, and expired blocking states with a fresh-review action.
10. Disabled/inaccessible fail-closed behavior without configuration or plan internals.

The dialog uses native keyboard modality, restores focus to the current entry button, includes live status regions and headings, maintains a stable polling layout, avoids horizontal overflow on narrow viewports, and respects reduced motion.

## Polling and idempotency

- Analysis is never started on page load or ordinary reads.
- Polling has a bounded interval and maximum attempt count.
- Only one poller and one active request controller exist per open Recovery surface.
- Polling stops on terminal state, close, logout, or session replacement.
- Temporary network failures receive bounded retries without starting another analysis.
- Only safe run/preview IDs and operation identifiers may be retained in session storage, isolated by account context.
- Analyze, apply, and reject reuse their operation-specific `Idempotency-Key` during safe replay.
- Apply/reject controls disable synchronously while requests are in flight, preventing double-click duplication.
- The browser never sends a plan diff or modified plan body to apply/reject.

## Security boundaries preserved

- C-01 scoring and private assessment material remain server-owned.
- C-02 embedding identity is unchanged.
- H-01 continues to deny general workspace access to Recovery collections.
- H-02 continues to use the narrow Recovery scope and transactional persistence.
- H-03 remains background-only; public Recovery reads do not create, embed, generate, or persist work.
- Provider/validation failure does not alter the live plan.
- Completed tasks remain protected by existing Recovery plan validation.
- Source storage remains private.
- Classroom write actions and automatic assignment submission remain false for every plan.

## Tests

`backend/testPass371RecoveryLaunchClosure.js` adds deterministic coverage for:

- engine and UI flags defaulting off;
- Trial, Starter, and Essential denial;
- Plus and Pro access;
- lifecycle/setup denial;
- cross-user run and preview denial;
- reject idempotency and expired/superseded rejection;
- safe run/preview projections and read-side immutability;
- public workspace non-leakage;
- narrow Recovery state scope;
- Classroom write actions remaining false;
- route-gate consistency and default-off templates.

The existing Recovery evaluation suite continues to cover apply idempotency, stale apply rejection, cross-user apply denial, provider failure preserving the live plan, grounding, feasibility, plan-version behavior, and AI allowance settlement.

`tests/e2e/adaptive-recovery.spec.js` adds deterministic browser coverage for capability hiding, Plus/Pro exposure, explicit start, polling progression, human-readable diffs, apply confirmation, double-click protection, Today refresh, rejection, stale/expired/failed states, refresh/reopen, poll cancellation, keyboard/focus behavior, narrow viewport, no ImgBB request, and no unexpected failed requests.

No test calls a real AI provider.

## Files changed

- Safe templates: `.env.example`, `.env.template`
- Default-off deployment configuration: `.github/workflows/azure-container-apps-studentos.yml`
- Entitlement/capability policy: `backend/domain/planEntitlementService.js`, `backend/domain/productFeatureAccessService.js`
- Recovery access/config/errors/public projection: `backend/recovery/recoveryAccessService.js`, `backend/recovery/recoveryConfig.js`, `backend/recovery/recoveryErrors.js`, `backend/recovery/recoveryEngineService.js`
- Route integration: `backend/server.js`
- Backend tests and script wiring: `backend/testPass371RecoveryLaunchClosure.js`, `package.json`
- Frontend boundary: `frontend/index.html`, `frontend/scripts/app.js`, `frontend/scripts/core/api-client.js`, `frontend/scripts/core/feature-access.js`, `frontend/scripts/features/recovery.js`, `frontend/styles/recovery.css`
- Browser/build validation: `tests/e2e/adaptive-recovery.spec.js`, `scripts/verifyCloudflareBuild.js`
- This record: `docs/roadmaps/PASS37_1_RECOVERY_LAUNCH_CLOSURE.md`

## Known limitations

- Recovery remains disabled until both flags are explicitly enabled by an authorized operator after PASS 37.2.
- There is no user-facing one-click undo. Students may request another analysis later.
- PASS 37.1 does not verify live shard topology, worker deployment, provider routing, monitoring, or rollback controls.
- The frontend resumes only safe identifiers from the current browser session; it does not expose a general Recovery history browser.
- Polling runs only while the Recovery dialog is open.

## Migration, deployment, and live-state confirmation

- No migration was created.
- No migration was applied.
- Nothing was deployed.
- No live Supabase data was read or changed.
- No Azure resource was read or changed.
- No provider call was made.
- Recovery remains disabled by default.

## PASS 37.2 operational prerequisites

Before any enablement, an authorized operator must:

1. Verify the existing Recovery schema, RPCs, indexes, ownership/RLS policies, and shard parity read-only in the intended environment.
2. Verify the deployed worker topology and that Recovery jobs are disabled until the approved test window.
3. Confirm both kill switches, rollout ownership, monitoring, alerting, rate/allowance thresholds, and safe error telemetry.
4. Run one controlled test-tenant analysis and review/apply/reject smoke without production academic data.
5. Confirm immutable plan history and perform a rollback drill by disabling Recovery while preserving records.
6. Review browser/network responses for the safe public contract and absence of internal/provider data.
7. Start only with an approved internal cohort and an explicit go/no-go decision.

Operational rollback means setting the Recovery flags false and preserving existing history. It does not delete Recovery records or promise UI restoration of a previous plan.
