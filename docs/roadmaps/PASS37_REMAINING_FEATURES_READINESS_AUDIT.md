# PASS 37.0 — Remaining StudentOS Features Readiness Audit

Audit date: 2026-08-02

Branch: `feature/remaining-features-readiness`

Audited baseline: `f37f67c` (`Fix H-03 background embedding boundary (#11)`)

Document status: planning and compatibility audit only; no feature is enabled or implemented by this pass.

This audit covers only these eight requested capabilities:

1. real-time learning-capacity estimation;
2. strict faculty-source adherence and provenance;
3. combined next-syllabus teaching with related weak-prerequisite recovery;
4. an actual Assignment Coach and evaluation workflow;
5. universal UI assistance through a safe whitelisted action registry;
6. deterministic diagrams plus generative images;
7. Gemini Live voice;
8. Adaptive Recovery frontend and launch readiness.

Social or personality challenges, webcam proctoring, Android work, and Google Classroom writeback or submission are explicitly outside scope.

## 1. Executive verdict

**Overall verdict: not ready to launch as a combined feature set.** The repository has valuable reusable foundations, but no requested feature meets the complete backend, data, frontend, entitlement, security, operations, and live-verification bar. Adaptive Recovery is the closest: its backend is substantial and its offline evaluation passes, while its UI, lifecycle/entitlement closure, rollback surface, and live operational truth remain incomplete. Gemini Live has the largest architecture and privacy gap.

| Feature | Readiness category | Launch verdict | Principal reason |
| --- | --- | --- | --- |
| Learning capacity | Partial foundation | Not launchable | Availability and workload budgeting exist, but there is no capacity model, snapshot, confidence, consent, or safe adaptation contract. |
| Faculty provenance | Partial foundation | Not launchable | Private sources and citations exist, but creator authority and verification are not represented or enforced. |
| Next syllabus + related weak recovery | Partial foundation | Not launchable | Ordered syllabus and evidence-backed weak topics exist independently; there is no prerequisite relationship graph or combined-lesson contract. |
| Actual Assignment Coach | Major new subsystem required | Not launchable | Entitlements and adjacent test/evaluation patterns exist, but assignment structure, rubric, answer, parsing, and evaluation objects do not. |
| Safe universal UI assistance | Major new subsystem required | Not launchable | Ask StudentOS is textual; no server-owned action registry, proposal schema, confirmation policy, or audited dispatcher exists. |
| Diagrams + generated images | Major new subsystem required | Not launchable | A text diagram scaffold and disabled image-provider scaffold exist, but rendering, artifact jobs, storage, safety, and UI do not. |
| Gemini Live voice | Major new subsystem required | Not launchable | The current AI path is server-side request/response text. No realtime session, ephemeral credential, browser-media, consent, quota, or voice-tool boundary exists. |
| Adaptive Recovery | Partial foundation | Backend-ready candidate, launch-blocked | Strong engine, persistence, worker, API, and tests; no feature UI and no verified live deployment/schema/worker/flag state. |

The first implementation pass should be **PASS 37.1 — Recovery launch closure (code-only, flag remains off)**. It should add the smallest safe frontend module seam, Recovery preview/diff/apply/reject UI, lifecycle and entitlement enforcement, and contract/E2E coverage. Live verification and rollout belong to a separate operator-controlled pass.

## 2. Repository baseline and inherited boundaries

### Runtime topology

| Layer | Current repository truth | Relevance to PASS 37 |
| --- | --- | --- |
| Browser | Static frontend rooted at `frontend/index.html`, with most behavior in `frontend/scripts/app.js` and styling in `frontend/styles/main.css`. | Every new feature needs a modular surface rather than another large block in the monolith. |
| API | Node HTTP application in `backend/server.js`, with domain, AI, repository, storage, connector, and Recovery modules. | New authorization and feature contracts must remain server-owned. |
| Data | One central Supabase auth/control project and three data shards selected by `backend/supabase/shardRouter.js`. | User feature data belongs identically on all three data shards; authentication data must not be duplicated into them. |
| Storage | Source objects use private Supabase storage through `backend/storage/sourceMaterialService.js` and `backend/storage/sourceStoragePlan.js`. | Assignment attachments and generated visual artifacts should reuse private ownership and signed-open patterns. |
| Jobs | Durable background-job service in `backend/jobs/jobService.js`, worker runtime in `backend/jobs/workerRuntime.js`, and `npm run jobs:dev`. | Parsing, generation, backfill, and cleanup work must use workers rather than ordinary reads. |
| Deployment | Azure Container Apps API plus dedicated no-ingress worker in `infra/azure/containerapp.bicep` and `.github/workflows/azure-container-apps-studentos.yml`; Cloudflare serves the frontend. | Declared topology is not evidence that the current live revision, schema, flags, or worker behavior are correct. |

The frontend is already at a modularity threshold: `frontend/scripts/app.js` is 7,566 lines, `frontend/styles/main.css` is 8,589 lines, and `frontend/index.html` is 796 lines. The separate `frontend/scripts/ai-response-enhancements.js` and `frontend/scripts/ai-drawer-adaptive-layout.js` show that incremental extraction is feasible, but they do not constitute a general feature architecture.

### Security and integrity baselines that later passes must inherit

| Boundary | Current evidence | Required preservation |
| --- | --- | --- |
| C-01 server-owned assessment integrity | `backend/ai/studyTestService.js`, `backend/ai/studyTestEvaluationService.js`, `backend/testC01AssessmentIntegrity.js` | Clients never author authoritative questions, answer keys, rubrics, marks, or final scores. |
| C-02 embedding-space integrity | `backend/embeddings/embeddingService.js`, `backend/testEmbeddings.js`, `supabase/migrations/202607270001_c02_embedding_space_integrity.sql` | Retrieval uses exact provider/family/model/version/dimension compatibility and fails closed on mismatch. |
| H-01 public DTO allowlist | `backend/presentation/publicStudentWorkspaceDto.js`, `backend/testH01PublicWorkspaceDto.js` | No private Recovery, assessment, provenance-verification, job, provider, or voice-session internals enter workspace DTOs. |
| H-02 narrow state repositories | `backend/repository/stateScopes.js`, `backend/testH02NarrowStateRepositories.js`, `supabase/migrations/202607280001_h02_narrow_state_repositories.sql` | Every new route receives the narrowest state scope and uses transactional, entity-specific writes. |
| H-03 background-only embeddings | `backend/embeddings/embeddingProcessingStatus.js`, `backend/jobs/workerRuntime.js`, `backend/testH03BackgroundEmbeddings.js` | Reads never create embeddings, parse artifacts, or perform hidden maintenance. |
| Read-only Classroom | `backend/connectors/googleClassroom/config.js`, `apiClient.js`, `syncService.js`, and `backend/domain/planEntitlementService.js` | No plan may turn in, submit, modify, delete, grade, or write back to Classroom. |
| Lifecycle and entitlements | `backend/domain/productLifecycleService.js`, `productFeatureAccessService.js`, `planEntitlementService.js` | New routes must require dashboard-active lifecycle where applicable and enforce feature access server-side. |

### Terminology and scaffold traps

- Existing `learning_level` entitlements are not a real-time learning-capacity model. Capacity must mean feasible workload/time, never IQ, intelligence, diagnosis, mental health, personality, or biological capability.
- Existing “recovery” copy in generic frontend error and Classroom connection paths is not the Adaptive Recovery feature UI.
- `createTutorLesson` currently returns a Mermaid-like `flowchart TD` string that the frontend shows as escaped text; this is not an operational deterministic diagram renderer.
- `PollinationsImageProviderScaffold` reports disabled route/frontend status. It is not a generated-image product path.
- Assignment Coach and Review entitlement keys and `/api/assignment-contract` are policy scaffolding, not an actual assignment parser, answer workspace, rubric engine, or evaluation product.
- `generated_study_material` is correctly distinguishable as StudentOS-generated content, but current readable academic-context semantics do not provide an authority tier. Generated content must never become faculty evidence through a retrieval loop.

## 3. Per-feature readiness matrix

The categories used here are:

- **Ready foundation:** bounded implementation can start without first creating a missing cross-cutting subsystem.
- **Partial foundation:** important adjacent implementation exists, but at least one data, policy, API, UI, or operational contract must be designed first.
- **Major new subsystem required:** only adjacent primitives or scaffolds exist; the core capability and its safety boundary are absent.
- **Blocked:** implementation cannot be responsibly planned until an external or product decision is made. A feature may still be launch-blocked without being implementation-blocked.

### 3.1 Real-time learning-capacity estimation — Partial foundation

| Audit dimension | Finding |
| --- | --- |
| Reusable files | `backend/domain/studyAvailabilityService.js`, `backend/ai/dailyTodoService.js`, `backend/domain/planningStateService.js`, `backend/recovery/academicStateBuilder.js`, `backend/recovery/recoveryPlanner.js` |
| Ready foundation | Weekly availability, fixed commitments, timetable windows, remaining minutes, deadlines, unfinished work, weak-topic evidence, and schedule-feasible task allocation already exist. |
| Missing/incompatible | There is no explicit capacity snapshot, observation window, confidence, reason codes, policy version, optional student check-in, completion-behavior signal, or bounded effect on task count, lesson depth, or assessment length. “Learning Level” must not be reused as capacity. |
| Schema/storage impact | Add shard-local capacity snapshots and input-signal summaries. Store minimally necessary derived values and reason codes; avoid raw behavioral exhaust. No auth-project migration. |
| Worker/API impact | Event-driven recomputation may run after availability, deadline, completion, or assessment changes. A read may retrieve the latest snapshot but must never recompute it. API must expose a plain-language explanation and allow a student override/check-in. |
| Frontend impact | A small Today/plan explanation surface is needed, including “why this workload,” confidence/uncertainty, and a manual adjustment path. It must not label or rank a student’s intelligence. |
| Entitlement/flag | The safe availability-derived estimate can support every active plan; adaptive influence should remain aligned to existing adaptive-plan entitlements until product decides otherwise. Use a server flag during shadow evaluation. |
| Security/privacy | Prohibit IQ, medical, disability, personality, mood, webcam, voice-emotion, biometric, demographic, or protected-class inference. Do not use absence or slow response as a diagnosis. Retention and deletion must follow account data lifecycle. |
| Operations/tests | Needs deterministic policy tests, drift/overload evaluation, reason-code snapshots, shard parity, H-01/H-02 tests, and shadow metrics before any plan changes. |
| Predecessor passes | Recovery lifecycle closure; capacity policy/data contract; then shadow recomputation and UI. |

### 3.2 Strict faculty-source adherence and provenance — Partial foundation

| Audit dimension | Finding |
| --- | --- |
| Reusable files | `backend/domain/academicContextKinds.js`, `backend/domain/academicContextService.js`, `backend/storage/sourceMaterialService.js`, `backend/ai/groundedPromptBuilder.js`, `backend/embeddings/embeddingService.js`, Google Classroom mapper/sync files |
| Ready foundation | Private owned sources, chunk citations, grounded snippets, generated-content labeling, Classroom origin metadata, and compatible hybrid retrieval exist. |
| Missing/incompatible | Source kinds describe semantics, not authority. Manual upload does not prove creator role. Classroom origin does not prove a particular item is faculty-authored. There is no authority tier, verification status/basis, institution/course identity, derivation chain, dispute path, or retrieval policy that prioritizes verified faculty material. Citation labels do not disclose authority status. In strict faculty mode, the system must answer from verified faculty/institution material or say that such support is unavailable; separately labeled general knowledge must never be presented as faculty-backed. |
| Schema/storage impact | Add source provenance assertions and immutable verification events on all data shards; add safe denormalized authority metadata to source/chunk indexes only where needed. Represent `derived_from` links so generated material cannot become original evidence. |
| Worker/API impact | A backfill job should classify existing rows as `unknown` rather than guessing. Reindex only retrieval metadata that truly changes; do not rewrite compatible embeddings unnecessarily. APIs need owned provenance summaries and verification workflows. |
| Frontend impact | Upload/import surfaces need creator/source assertions and clear “verified,” “student asserted,” “provider origin,” “generated,” or “unknown” badges. Answers need per-citation authority disclosure and fallback disclosure. |
| Entitlement/flag | Strict honesty and generated-content exclusion are universal security policy, not paid benefits. Enhanced source-management UX can vary by plan, but authority enforcement cannot. |
| Security/privacy | Prevent self-asserted “faculty” status from becoming verified. Do not infer authority from filename or prose. Keep generated notes and model output non-authoritative. Preserve ownership, signed private access, and C-02 compatibility. |
| Operations/tests | Needs adversarial spoofing, provenance-chain, mixed-authority retrieval, unknown-backfill, generated-loop, RLS, deletion, and shard-parity tests. |
| Predecessor passes | Product definition of “faculty/institution verified”; additive provenance migration; backfill/shadow retrieval; then strict enforcement. |

### 3.3 Next syllabus plus related weak-prerequisite recovery — Partial foundation

| Audit dimension | Finding |
| --- | --- |
| Reusable files | `backend/ai/studyMaterialService.js`, `backend/ai/studyTestService.js`, `backend/ai/dailyTodoService.js`, `backend/recovery/academicStateBuilder.js`, `backend/recovery/recoveryPolicy.js` |
| Ready foundation | Explicit syllabus ordering, source order, exact parent-topic generation, strict assessment-to-topic mappings, evidence-backed weak status, and separate recovery priorities exist. |
| Missing/incompatible | No prerequisite/related-topic graph exists. The system cannot prove that a weak topic is directly related to the next syllabus topic. There is no combined-lesson segmentation contract, per-segment attribution, recovery insertion limit, or rule preventing unrelated weak-topic detours. |
| Schema/storage impact | Add directed topic relationships with type, strength, source/provenance, verification status, and policy version on data shards. Preserve canonical syllabus topic IDs and assessment evidence links. |
| Worker/API impact | Relationship extraction may be a reviewable background proposal, never an automatic read-side mutation. The lesson builder must deterministically select the next syllabus topic first, then only verified direct prerequisites with qualifying weak evidence. |
| Frontend impact | Study UI must visually separate “next syllabus” from “prerequisite refresh,” explain the relation and evidence, and let the student skip the recovery insert without losing the main lesson. |
| Entitlement/flag | Candidate mapping is to existing adaptive roadmap/Learning Level plans (Plus and Pro) until product approves broader access. Strict main-topic ordering remains universal. |
| Security/privacy | Never fabricate a relationship or weakness. Weakness requires C-01-protected assessment evidence and strict topic mapping. Generated content cannot supply the relationship’s authority. |
| Operations/tests | Needs graph-cycle handling, missing/uncertain relationship cases, unrelated-weak exclusion, lesson-order, evidence attribution, staleness, and Recovery interaction evaluations. |
| Predecessor passes | Provenance enforcement; relationship model/migration; shadow relationship proposals; combined lesson implementation. |

### 3.4 Actual Assignment Coach and evaluation — Major new subsystem required

| Audit dimension | Finding |
| --- | --- |
| Reusable files | Assignment routes in `backend/server.js`, `backend/domain/studentosDomain.js`, `backend/domain/planEntitlementService.js`, source storage, `backend/ai/studyTestService.js`, `backend/ai/studyTestEvaluationService.js` |
| Ready foundation | Owned assignment metadata and deadlines, attachments/source linkage, read-only Classroom import, Plus/Pro Coach entitlement, Pro Review entitlement, student-review contract, typed/handwritten test artifacts, server-owned scoring, and question-level feedback patterns exist. |
| Missing/incompatible | There is no normalized assignment document, question/subquestion tree, rubric criteria, per-question marks, authoritative instruction version, student answer artifact, draft lifecycle, parse confidence/review flow, assignment-specific evaluation service, or durable result model. Existing test evaluation cannot be relabeled as assignment evaluation. |
| Schema/storage impact | Add assignment documents/versions, question nodes, rubric criteria, owned attachment references, answer attempts/items, evaluations, and criterion results on data shards. Keep rubrics and answer keys private and out of public DTOs. |
| Worker/API impact | Add idempotent parse and evaluation jobs with reviewable parse output, exact source version/fingerprint, retry policy, and stale-result rejection. Server must own scoring inputs and validate every assignment/course/user relationship. |
| Frontend impact | Needs assignment selection, instruction/rubric review, per-question workspace, artifact upload, save/resume, submit-for-evaluation confirmation, result/correction view, and accessible mobile layout. “Submit” must mean submit to StudentOS for evaluation, never Classroom turn-in. |
| Entitlement/flag | Preserve current Coach = Plus/Pro and Review = Pro. No plan gets assignment writeback. Heavy work uses private internal limits without exposing technical quotas in public pricing copy. |
| Security/privacy | Enforce C-01; resist prompt injection in assignment documents; quarantine unsafe files; never expose hidden rubrics/keys; prevent cross-user access; provide academic-integrity policy for guidance versus answer generation. |
| Operations/tests | Needs parser accuracy sets, rubric agreement evaluation, handwritten/typed artifact tests, stale version tests, RLS/shard parity, job idempotency, deletion/retention, and Classroom no-write regression tests. |
| Predecessor passes | Faculty provenance; topic relationships; capacity policy; assignment data/parse pass; then coach/evaluation/UI pass. |

### 3.5 Safe universal UI assistance — Major new subsystem required

| Audit dimension | Finding |
| --- | --- |
| Reusable files | Ask route in `backend/server.js`, `frontend/scripts/app.js`, product lifecycle and feature-access services, narrow state scopes, safe link/markup rendering helpers |
| Ready foundation | Ask StudentOS has an authenticated, dashboard-active, entitled text path. Fixed frontend navigation functions and server-owned mutations already exist. |
| Missing/incompatible | No versioned action registry, structured proposal schema, server-side argument validation, confirmation class, capability token, execution audit, idempotency key, or frontend dispatcher exists. A model currently cannot safely request navigation or product actions. |
| Schema/storage impact | Prefer a code-defined registry plus shard-local proposal/execution audit records. Store action ID/version and redacted structured arguments, not selectors, scripts, credentials, or arbitrary URLs. |
| Worker/API impact | Most UI/navigation actions should be synchronous proposals. Durable heavy actions should enqueue an existing/new typed job only after normal endpoint authorization and confirmation. The model never invokes a worker or repository directly. |
| Frontend impact | Add a dispatcher that maps a closed action ID to a local handler/view ID. Reject unknown versions. Never execute model-supplied JavaScript, CSS selectors, HTML, URL schemes, endpoint names, or HTTP methods. Show confirmation and outcome. |
| Entitlement/flag | Navigation/read-only assistance may follow Assistant access on every active plan. Each proposed mutation must independently satisfy the target feature’s plan, lifecycle, ownership, rate, and confirmation rules. |
| Security/privacy | Primary threats are arbitrary action execution, confused deputy, prompt injection, cross-user IDs, replay, hidden destructive actions, and audit leakage. Destructive/high-impact actions should not enter v1. |
| Operations/tests | Needs registry snapshot tests, JSON-schema fuzzing, unknown-action fail-closed tests, prompt-injection suites, replay/idempotency, confirmation, entitlement/lifecycle, audit redaction, and responsive E2E. |
| Predecessor passes | Frontend feature seams; stable target APIs; action registry/proposal pass; Gemini Live only after this boundary is proven. |

### 3.6 Deterministic diagrams plus generative images — Major new subsystem required

| Audit dimension | Finding |
| --- | --- |
| Reusable files | `createTutorLesson` in `backend/domain/studentosDomain.js`, diagram presentation in `frontend/scripts/app.js`, `PollinationsImageProviderScaffold` in `backend/ai/providers.js`, source storage/job foundations, visual-notes entitlement |
| Ready foundation | A deterministic text diagram concept, limited safe SVG/markup handling, private storage, provider configuration conventions, worker primitives, and Essential+ visual-notes entitlement exist. |
| Missing/incompatible | The diagram is escaped code text, not a rendered accessible graph. The image scaffold has route/frontend disabled. There is no validated diagram DSL, renderer, artifact record, provider job lifecycle, private image storage, moderation, attribution, alt text, retry/cancel/cleanup, or fallback. |
| Schema/storage impact | Add owned visual artifacts with kind, source specification/fingerprint, provider/job status, private bucket/path, accessibility text, expiry/retention, and `evidence_allowed = false`. Deterministic specs may be stored inline only under a strict size/schema limit. |
| Worker/API impact | Deterministic rendering may be local and synchronous only when bounded; generative images must be job-backed. Fetch/store provider output server-side with allowlisted hosts and content checks. Ordinary lesson reads must not create images. |
| Frontend impact | Render deterministic diagrams through a pinned, sanitized renderer with text fallback and alt description. Generated images need pending/failure/cancel states, disclosure, private signed access, and deterministic fallback. |
| Entitlement/flag | Preserve deterministic visual notes at Essential+. Candidate generative access is Plus/Pro under private limits; final mapping is a product decision. Use separate flags so deterministic diagrams do not depend on a generative provider. |
| Security/privacy | Treat diagram/image content as non-evidence. Prevent XSS through SVG/DSL, SSRF through provider URLs, unsafe image content, prompt data leakage, public object URLs, and generated-content feedback into faculty evidence. |
| Operations/tests | Needs renderer security corpus, accessibility snapshots, artifact RLS/deletion, provider outage/fallback, moderation, cost/usage, job idempotency, cleanup, and storage lifecycle tests. |
| Predecessor passes | Provenance rules; deterministic renderer pass; then separate generated-image artifact pass. |

### 3.7 Gemini Live voice — Major new subsystem required

| Audit dimension | Finding |
| --- | --- |
| Reusable files | Server-side Gemini/text provider conventions in `backend/ai/providers.js` and `providerRouterV2.js`, Assistant entitlement/allowance, Ask presentation, and future safe action registry |
| Ready foundation | Authenticated AI access, provider routing discipline, response presentation, hidden usage limits, and server-owned feature access can be reused conceptually. |
| Missing/incompatible | No microphone capture, audio codec path, realtime transport, ephemeral session credential, Gemini Live session broker, turn protocol, transcript/consent policy, interruption handling, usage settlement, voice UI, or voice-tool integration exists. Long-lived server text keys must never be sent to the browser. |
| Schema/storage impact | Add minimal voice session/usage records on data shards. Default to no raw-audio retention and no transcript retention; any opt-in transcript needs explicit purpose, retention, deletion, and public projection rules. |
| Worker/API impact | Add a dedicated session-mint/broker boundary with short-lived scoped credentials or a server relay, depending on provider capability and threat review. Post-session summarization is optional background work; it must not occur from a read. Do not silently fall back a live session across providers. |
| Frontend impact | Needs explicit microphone consent, device/error states, live status, mute/end, interruption, text fallback, transcript policy disclosure, and accessible non-voice parity. Tool actions must use the safe proposal registry. |
| Entitlement/flag | Candidate rollout: Pro-only internal pilot, then Plus/Pro if evaluation and cost permit. Keep a dedicated kill switch and private session allowance; do not publish protocol/token quotas as plan copy. |
| Security/privacy | Highest-risk feature: microphone privacy, long-lived credential theft, prompt injection through audio, unintended recording, sensitive transcripts, children’s data, regional processing, abuse/cost, and unsafe tool actions. No emotion, identity, accent, disability, or capacity inference from voice. |
| Operations/tests | Needs provider contract verification, browser/device matrix, reconnect/expiry, consent/retention, token-scope, cost cutoff, abuse, tool-injection, latency, accessibility, regional/privacy review, and kill-switch drills. |
| Predecessor passes | Safe UI action registry, frontend modularization, provider/privacy decisions, dedicated voice implementation, controlled pilot. |

### 3.8 Adaptive Recovery frontend and readiness — Partial foundation

| Audit dimension | Finding |
| --- | --- |
| Reusable files | Entire `backend/recovery/` directory, Recovery routes in `backend/server.js`, Recovery job handling, migrations `202607190001` and `202607190002`, `scripts/verifyAdaptiveRecoverySchemaLive.js`, Recovery tests/evaluation |
| Ready foundation | Evidence-only weakness, immutable snapshots, deterministic fingerprints, fixed provider sequence, strict schemas, preview/diff/apply/reject, TTL/stale/superseded protection, idempotency, optimistic leases, advisory-lock RPCs, service-role/RLS posture, plan versions, dedicated job type, public projections, and offline evaluation exist. |
| Missing/incompatible | There is no Recovery view or client. Recovery routes require an account session but do not match the normal dashboard-active and explicit plan-entitlement gates used by academic routes. There is no product rollback API/UI/runbook. Live migrations, API revision, worker revision, flag state, and functional queue processing are unverified in this audit. |
| Schema/storage impact | Existing migrations are present for all shards, but presence in Git is not deployment evidence. Any lifecycle/entitlement metadata change should remain additive. Do not create a new migration merely to mark readiness. |
| Worker/API impact | The worker path exists. Add consistent lifecycle/feature checks, safe status/polling semantics, rate/allowance policy, and operator observability. Preserve review-first apply and exactly-once behavior. |
| Frontend impact | Add a dedicated Recovery module/view with run state, evidence summary, proposed-plan diff, deferrals, warnings, apply/reject confirmation, stale/expired handling, retry guidance, and clear post-apply result. Internals remain outside the general workspace DTO. |
| Entitlement/flag | Repository defaults and deployment templates declare Recovery off; the workflow can explicitly enable it after schema/topology gates. Actual live state is unknown. Candidate entitlement is Plus/Pro to align with adaptive roadmap, pending product decision. |
| Security/privacy | Preserve evidence-only weakness, no mental-health/intelligence inference, cross-user denial, server-owned snapshots, no client-authored recovery state, no hidden apply, and provider-failure preservation of the live plan. |
| Operations/tests | Offline Recovery suites pass. Launch still requires live read-only schema/API/topology checks, controlled worker functional verification, flag audit, rollback drill, dashboards/alerts, and staged cohort evaluation. |
| Predecessor passes | None of the other seven features. This is the recommended first implementation target. |

## 4. Dependency graph and critical path

```text
Existing C-01 / C-02 / H-01 / H-02 / H-03 / lifecycle / read-only Classroom
        |
        +--> Minimal frontend feature seams --> Recovery UI + gate closure --> Recovery ops verification/rollout
        |
        +--> Faculty provenance contract --> strict retrieval/disclosure
        |            |                         |
        |            |                         +--> related-topic graph --> combined lesson
        |            |                         |                         |
        |            |                         |                         +--> Assignment Coach/evaluation
        |            |                         |
        |            |                         +--> deterministic diagrams --> generated-image artifacts
        |            |
        |            +--> generated content is permanently non-authoritative
        |
        +--> Capacity policy + snapshots ------> combined lesson / Assignment workload / Recovery scheduling
        |
        +--> Stable modular feature APIs --> safe UI action registry --> Gemini Live voice
```

Critical-path conclusions:

1. Recovery can proceed independently and should validate the frontend module, preview/confirm, job-status, and staged-rollout patterns first.
2. Provenance must precede combined lessons, Assignment Coach, and factual visual generation; otherwise generated or student-asserted material can be mistaken for faculty authority.
3. Capacity is an input to planning, not a replacement for Learning Level. It should be shadowed before it influences Recovery, assignments, or lesson length.
4. The relationship graph must exist before the combined lesson can claim a weak topic is “related.”
5. Deterministic diagrams must be the reliable fallback before generated images launch.
6. The action registry must precede voice tooling. Gemini Live must not invent its own action bridge.

## 5. Adaptive Recovery launch truth table

| Launch condition | Repository evidence | Current truth | Closure evidence/command |
| --- | --- | --- | --- |
| Engine and policy code | `backend/recovery/` | Yes | Offline Recovery tests and evaluation pass. |
| API routes | analyze, run, preview, apply, reject routes in `backend/server.js` | Present in source; deployed revision unknown | Read-only `npm run verify:azure-deployment`, followed by authenticated route smoke in a non-production test account. |
| Worker handler | `recovery_analysis` path in worker runtime | Present in source; deployed functional state unknown | Read-only Azure topology inspection first; `npm run verify:worker` is **mutating** and may only run in an approved test environment because it creates and deletes verification data. |
| Migrations in Git | `202607190001_studentos_adaptive_recovery_engine.sql`, `202607190002_studentos_adaptive_recovery_hardening.sql` | Yes | File presence only. |
| Migrations live on all three shards | Live schema not inspected in PASS 37.0 | Operationally unverified | `npm run verify:recovery-schema` is the exact read-only schema/permission verifier once authorized credentials are configured. |
| RLS/service-role posture | Migration and verifier assertions exist | Designed; live state unverified | Same `npm run verify:recovery-schema`, with zero authenticated table grants and required service-role posture. |
| API/worker topology parity | Bicep/workflow declare same image and secret references; worker has no ingress and fixed replica | Declared; live state unverified | `npm run preflight:azure` locally, then read-only `az containerapp show` queries for both apps in the approved subscription. |
| Feature flag | Code/Bicep/workflow deployment default is false; workflow input can explicitly enable both apps after gates | Repository default off; actual live values unknown | Read-only `az containerapp show --resource-group <resource-group> --name <app-name> --query "properties.template.containers[0].env[?name=='STUDENTOS_ADAPTIVE_RECOVERY_ENABLED'].{name:name,value:value,secretRef:secretRef}"` for API and worker. |
| Frontend | No Adaptive Recovery view, action, polling, diff, apply, or reject UI | No | PASS 37.1 implementation plus E2E. |
| Lifecycle/plan enforcement | Recovery routes use feature flag and account session; they do not use the normal dashboard-active/feature gates | Incomplete | Route contract tests for lifecycle state, plan, ownership, allowance, and disabled flag. |
| Review-first apply | Preview/diff/apply/reject with stale and exactly-once protection | Yes in code/offline tests | Preserve in E2E and controlled live smoke. |
| Product rollback | Plan versions exist, but no user/operator rollback contract, endpoint, UI, or drill was found | No | Decide undo semantics, implement or document operator rollback, and run a controlled drill. |
| Observability/runbook | Job events and safe error envelopes exist | Partial | Define alerts for stuck/failed runs, provider failure, preview expiry, and apply conflict; publish enable/disable/rollback runbook. |
| Production launch | All rows above must be verified for one release revision | **No** | Staged internal cohort only after schema, topology, UI, gates, rollback, and monitoring close. |

No live command was run during this audit. That restraint is intentional: a repository declaration is not live truth, and `verify:worker` is not read-only.

## 6. Data and migration plan

### Placement rule

All new user academic, artifact, proposal, and session data belongs on **each of data shards 2–4 with identical schemas and policies**, using the current shard router. The central auth/control project remains limited to authentication and existing explicitly central control data, including Provider Router V2 state. No requested feature justifies copying academic content, rubrics, transcripts, or behavior signals into the auth project.

| Proposed data family | Minimum records/fields | Migration notes |
| --- | --- | --- |
| Learning capacity | `learning_capacity_snapshots`: user/course or global scope, bounded signal summary, available minutes, suggested workload envelope, confidence, reason codes, policy version, source-event watermark, timestamps | Additive shard migration. Backfill only from explicit availability and current workload; mark confidence low and do not infer past behavior. |
| Provenance | `source_provenance_assertions`, `source_provenance_verification_events`; source ID, asserted creator role, authority tier, status, basis/provider reference, institution/course, verifier class, `derived_from`, timestamps | Existing sources backfill to `unknown`, not faculty. Verification events immutable. Denormalize only safe retrieval fields. |
| Topic relations | `topic_relationships`: from/to topic IDs, direction, relation type, strength, source/provenance ID, status, policy version | Reject cross-user/course references; handle cycles deterministically; proposed relations require review or verified authoritative basis. |
| Assignment Coach | assignment document/version, question-node tree, rubric criteria/version, owned attachment references, answer attempt/items, evaluation/result/criterion rows | Keep authoritative instructions, rubrics, and keys private. Version/fingerprint every parse and evaluation. Reuse private object storage rather than embedding binary data in rows. |
| UI actions | action proposal and execution audit: registry ID/version, user, target entity type/ID, redacted structured args, confirmation class/status, idempotency key, outcome code, timestamps | Registry definitions remain in code. Do not store free-form executable payloads, selectors, scripts, arbitrary URLs, credentials, or raw model chain-of-thought. |
| Visual artifacts | artifact kind, source spec/fingerprint, generation job/provider reference, private storage path, disclosure, alt text, status, expiry/retention, `evidence_allowed = false` | Separate deterministic specs from generated binary objects. Add cleanup/deletion policy and signed-open endpoint. |
| Voice | minimal live session and usage event: user, provider session reference/hash, consent/policy version, start/end/status, usage, optional transcript-retention choice | Default no raw audio and no transcript storage. If product approves transcript retention, use a separate explicit record family with narrow retention and deletion. |

Migration discipline for every data pass:

1. write one additive, idempotent migration and apply the same SQL to all three data shards;
2. add service-role-only persistence and owned read projections before any route is enabled;
3. update H-02 narrow scopes and H-01 forbidden/allowed DTO tests in the same pass;
4. backfill by a typed background job with watermark, idempotency, per-shard counts, and safe retry;
5. shadow-read and compare before enforcing a new policy;
6. keep old columns readable until rollback criteria and retention windows close;
7. do not change C-02 embedding identity during provenance work; metadata-only retrieval changes should not trigger unnecessary re-embedding;
8. verify schema, RLS, RPC grants, indexes, and shard parity live before raising a flag.

Rollback is flag-first and reader-compatible: stop new jobs, turn off the feature in both API and worker, keep the previous reader/writer contract deployed, and leave additive tables/columns in place until the retention window and incident review close. Backfill and proposal rows must be versioned so they can be ignored or tombstoned without destructive down-migrations. A later cleanup migration is allowed only after live counts, deletion requirements, and rollback windows are verified on every shard.

## 7. Background-job plan

| Proposed job type | Trigger | Idempotency/fingerprint | Output and failure behavior |
| --- | --- | --- | --- |
| `capacity_recompute` | Explicit availability/workload event, completion event, or assessment result | user + relevant event watermark + policy version | Writes a new immutable snapshot. Failure leaves the last explained snapshot active and marks it stale. |
| `provenance_backfill` | Operator-controlled migration rollout | shard + source ID + policy version | Writes `unknown`/provider-origin facts only; never guesses faculty status. Resume by watermark. |
| `topic_relationship_propose` | Explicit syllabus/source preparation action | course + topic-set fingerprint + provenance version | Creates reviewable proposals; does not silently change lesson behavior. |
| `assignment_parse` | Student explicitly imports/selects an owned assignment version | document fingerprint + parser version | Produces a reviewable question/rubric structure. Low confidence fails to manual review, not fabricated structure. |
| `assignment_evaluate` | Student explicitly submits a StudentOS answer attempt for evaluation | attempt/version + rubric version + evaluator policy | Writes immutable criterion results; stale source/rubric versions reject. No Classroom operation. |
| `visual_generate` | Explicit generated-image request after entitlement/confirmation | source spec + prompt policy + provider/model version | Stores a private non-evidence artifact. Provider failure returns deterministic/text fallback. |
| `visual_cleanup` | Scheduled retention/expiry | artifact ID + retention version | Deletes private object and marks tombstone; safe retry and audit required. |
| `voice_postprocess` | Only after explicit opt-in to a defined post-session result | session + consent version + input fingerprint | Optional summary/result only. No default transcript/audio persistence. |

All jobs must use the existing durable claim/lease/retry/event model, narrow repository state, server-owned quotas, safe logs, and bounded retry counts. User cancellation should become a checked state transition, not a best-effort UI fiction. Reads may display status but must not parse, embed, classify, generate, clean up, or repair data. The existing `source_ingestion`, `source_reindex`, `embedding_reindex`, and `recovery_analysis` boundaries remain intact.

## 8. Feature flags and entitlement plan

### Existing anchors to preserve

- Plans are `trial`, `starter`, `essential`, `plus`, and `pro`.
- Assistant access exists across active plans; depth and private limits vary.
- Visual notes are currently Essential, Plus, and Pro.
- Learning Level/adaptive difficulty and adaptive roadmap are currently Plus and Pro.
- Assignment Coach is currently Plus and Pro; Assignment Review is Pro.
- Classroom writeback, assignment submission, automatic/hidden submission, turn-in, grading, modification, and deletion are false for **every** plan.

### Proposed internal flags

`STUDENTOS_LEARNING_CAPACITY_ENABLED`, `STUDENTOS_SOURCE_AUTHORITY_ENABLED`, `STUDENTOS_RELATED_WEAK_TOPIC_LESSONS_ENABLED`, `STUDENTOS_ASSIGNMENT_COACH_V2_ENABLED`, `STUDENTOS_DETERMINISTIC_VISUALS_ENABLED`, `STUDENTOS_GENERATIVE_IMAGES_ENABLED`, `STUDENTOS_UI_ACTION_REGISTRY_ENABLED`, `STUDENTOS_GEMINI_LIVE_ENABLED`, and a frontend Recovery exposure flag paired with the existing `STUDENTOS_ADAPTIVE_RECOVERY_ENABLED`.

Flags are kill switches and staged-rollout controls, not entitlements. Every endpoint must require both the internal flag and the existing server-owned lifecycle/plan/ownership policy.

| Capability | Trial | Starter | Essential | Plus | Pro | Policy note |
| --- | --- | --- | --- | --- | --- | --- |
| Honest authority labels / generated-content exclusion | Enforced | Enforced | Enforced | Enforced | Enforced | Universal integrity rule; never paywalled. |
| Capacity explanation from explicit schedule/workload | Preview candidate | Basic candidate | Basic candidate | Adaptive candidate | Adaptive candidate | Final influence/retention is a blocking product decision; never expose inferred traits. |
| Combined related-prerequisite lesson | Off candidate | Off candidate | Off candidate | On candidate | On candidate | Align initially with adaptive roadmap; validate before widening. |
| Adaptive Recovery | Off candidate | Off candidate | Off candidate | On candidate | On candidate | Final mapping and undo semantics require product decision. |
| Assignment Coach | Off | Off | Off | On | On | Preserve existing entitlement. |
| Advanced assignment review | Off | Off | Off | Off | On | Preserve existing entitlement. |
| Deterministic diagrams | Off | Off | On | On | On | Preserve current visual-notes entitlement. |
| Generated images | Off | Off | Off candidate | On candidate | On candidate | Separate flag/provider budget; deterministic fallback always available. |
| Safe navigation/read-only action proposals | Assistant-gated | Assistant-gated | Assistant-gated | Assistant-gated | Assistant-gated | Target action must independently pass its entitlement and confirmation. |
| Gemini Live | Off | Off | Off | Pilot candidate | Pilot | Start Pro-only; Plus widening only after evaluation and cost/privacy approval. |

Technical request, token, job, storage, or protocol quotas remain private implementation limits and must not be added to public plan copy. No table entry authorizes Google Classroom writeback.

## 9. Frontend modularization strategy

Do not perform a big-bang rewrite. Keep the current bootstrap and extract seams only when a feature needs them.

1. Introduce a small `core` layer for authenticated API requests, session/lifecycle state, safe rendering, feature access, and a static view registry. Preserve existing method signatures at the `app.js` boundary.
2. Implement Recovery as the first isolated feature module because its backend contract already exists. The module owns status polling, projection-to-view mapping, diff rendering, confirmation, and error states; it does not receive repository internals.
3. Extract assignment, visuals, UI-action proposals, and voice as separate feature modules in their respective passes. Each module receives typed public data and explicit callbacks.
4. Keep view IDs and handlers code-defined. The action dispatcher may reference registered IDs only; it may not query model-supplied selectors or dynamically import a model-supplied path.
5. Split CSS by feature only when a module lands, retaining existing design tokens and responsive breakpoints. Require keyboard, focus, screen-reader, narrow viewport, and reduced-motion tests.
6. Maintain one application bootstrap, one session source of truth, and one error-envelope adapter. Do not create parallel auth, entitlement, or API-client implementations per feature.

Suggested target shape, introduced incrementally:

```text
frontend/scripts/
  app.js                         # bootstrap and compatibility facade
  core/api-client.js
  core/session-store.js
  core/lifecycle-access.js
  core/view-registry.js
  core/render-security.js
  features/recovery.js
  features/assignments.js
  features/visuals.js
  features/action-proposals.js
  features/live-voice.js
```

PASS 37.1 should extract only the minimum core contracts Recovery needs. File movement without a feature boundary is not readiness progress.

## 10. Threat model and mandatory controls

| Threat | Mandatory control | Launch-blocking evidence |
| --- | --- | --- |
| Capacity becomes an IQ/health/personality score | Explicit allowed-signal schema, prohibited-inference policy, plain-language reasons, student override, short retention | Adversarial inputs and DTO/log review prove no prohibited trait output or storage. |
| User labels their own upload “faculty” | Assertions are not verification; verified state requires approved basis/provider/human class; immutable audit | Spoofing and mixed-source retrieval tests. |
| Generated content becomes source authority | Permanent generated/derived label and `evidence_allowed = false`; retrieval excludes it from authority decisions | Feedback-loop and citation tests. |
| Weak topic or relationship is fabricated | Only C-01-backed strict topic evidence and verified relationship edges qualify | Missing-map, weak-evidence, unrelated-topic, and graph-cycle evaluations. |
| Client tampers with rubric, answers, or marks | Server-owned versions/fingerprints, private rubric/key data, C-01 scoring | Tamper/replay/stale-version tests. |
| Assignment assistance becomes hidden submission | Student review and explicit StudentOS evaluation only; Classroom write actions false in code and tests | No connector write scopes/methods; all-plan entitlement regression. |
| Model executes arbitrary UI/code/network action | Closed registry, schema validation, code-defined handler mapping, confirmation, idempotency, audit, unknown-action rejection | Prompt-injection/fuzz/replay/unknown-action tests. |
| Diagram causes XSS or generated image causes SSRF | Pinned validated DSL, sanitization, CSP-compatible renderer, server-side allowlisted artifact fetch, private storage | Malicious SVG/DSL corpus and URL-host tests. |
| Live voice leaks a long-lived provider key | Short-lived scoped session credential or server relay; no server key in browser/runtime config | Browser bundle/network inspection and expiry/scope tests. |
| Recording or transcript occurs without informed consent | Explicit mic consent, visible live state, default no retention, versioned opt-in for any transcript | Consent/retention/deletion E2E and privacy review. |
| Voice is used to infer emotion, identity, disability, accent quality, or capacity | Prohibit such inference in policy, prompts, schemas, logs, and evaluation | Red-team audio/transcript cases and output review. |
| Cross-user entity access | Session-owned lookups, shard ownership/RLS, opaque IDs never trusted from model/client | Cross-user tests for every new route and artifact open endpoint. |
| Job replay, cost abuse, or hidden read-side work | Typed idempotency, leases, private limits, cancellation, safe events, explicit mutation endpoints | H-03-style boundary tests plus retry/cost/cleanup evaluation. |
| Recovery applies stale or unseen plan | Preserve immutable snapshot, preview diff, confirmation, TTL, lease, stale/superseded checks | Existing offline tests plus UI E2E and controlled live smoke. |

Any later pass that weakens C-01, C-02, H-01, H-02, H-03, lifecycle gates, private storage, or Classroom read-only behavior fails review even if its feature test passes.

## 11. ChatGPT-versus-Codex ownership

| Work item | ChatGPT/product-design ownership | Codex/repository ownership | Human/operator ownership |
| --- | --- | --- | --- |
| Faculty authority definition | Define accepted roles, verification evidence, dispute UX, and public language | Map policy to schemas, retrieval, APIs, tests, and migration plan | Approve institutional/provider trust and any manual verification operations |
| Capacity policy | Define allowed inputs, explanations, student controls, retention, and prohibited claims | Implement deterministic policy, snapshots, jobs, DTOs, evaluations | Privacy/legal approval where required |
| Combined lesson pedagogy | Define maximum recovery insert, skip behavior, and explanation | Implement relationship contract, evidence selection, lesson segments, tests | Approve curriculum/institution-specific trust if used |
| Assignment integrity | Define guidance-versus-answer policy, review rubric, and student-facing terminology | Implement private assignment models, parsers, server scoring, UI, tests | Approve academic-integrity and retention policy |
| UI actions | Define confirmation classes and allowed v1 actions | Build registry, schemas, dispatcher, audits, red-team tests | Approve any high-impact action class before rollout |
| Visuals | Define acceptable content, disclosure, accessibility, retention, plan positioning | Build renderer, jobs, artifacts, private access, safety tests | Provider/content-policy approval and operational monitoring |
| Gemini Live | Define consent, transcript/audio retention, regional constraints, plan rollout | Build session boundary, client, action integration, usage guards, tests | Provider enablement, privacy/security approval, live kill-switch ownership |
| Recovery | Define entitlement, user copy, rollback/undo promise, rollout cohort | Close lifecycle gates, UI, E2E, observability hooks | Verify live schema/topology, run controlled smoke/rollback, enable flag |

ChatGPT may help produce product decisions, UX contracts, threat cases, and evaluation rubrics, but it is not evidence that repository code or live infrastructure changed. Codex may implement and test approved repository work, but it must not infer product/privacy decisions or enable production. Live migrations, flags, provider activation, and deployment verification require an authorized operator.

## 12. Final numbered pass sequence

| Pass | Type | Scope and exit criterion | Primary owner |
| --- | --- | --- | --- |
| **37.1** | Implementation/frontend/security | **Recovery launch closure, code-only:** extract minimum API/view/access seam; add Recovery run/preview/diff/apply/reject UI; add dashboard-active and explicit entitlement gates; add contract and local E2E; keep flags off. | Codex after product chooses entitlement/undo copy |
| **37.2** | Operations/deployment | Recovery live readiness: read-only schema/API/topology/flag verification, approved test-tenant worker smoke, monitoring/runbook, rollback drill, internal cohort, explicit go/no-go. | Human/operator with Codex evidence support |
| **37.3** | Planning/migration | Faculty provenance contract and additive shard migration; update H-01/H-02 projections/scopes; backfill existing sources to unknown; no enforcement yet. | Product + Codex |
| **37.4** | Implementation/rollout | Provenance verification UI, authority-aware retrieval/disclosure, generated-content exclusion, shadow comparison, then staged strict enforcement. | Codex; operator for rollout |
| **37.5** | Planning/implementation | Capacity allowed-signal policy, snapshots/jobs/API/UI explanation, offline evaluation and shadow mode; no adaptive influence until reviewed. | Product/privacy + Codex |
| **37.6** | Migration/implementation | Topic relationship schema/proposals and combined next-syllabus + direct weak-prerequisite lesson, with skip/attribution and graph evaluations. | Product pedagogy + Codex |
| **37.7** | Migration/backend | Assignment document/question/rubric/answer data model, private storage references, parse job/review, C-01/H-01/H-02 coverage; no evaluation launch. | Codex after integrity policy |
| **37.8** | Implementation/frontend | Assignment Coach workspace and server-owned evaluation/results, typed/handwritten flows, plan gates, retention, E2E; Classroom remains read-only. | Codex + product evaluation review |
| **37.9** | Implementation/frontend | Deterministic diagram DSL/renderer, sanitization, alt text/text fallback, Essential+ gate, accessibility/security corpus. | Codex |
| **37.10** | Migration/jobs/provider | Generated-image artifacts, private storage, moderation, retry/cancel/cleanup, deterministic fallback, usage controls, staged Plus/Pro rollout. | Codex + operator/provider approval |
| **37.11** | Security/implementation | Versioned safe UI action registry, proposals, confirmations, audits, dispatcher, adversarial tests; start with navigation/read-only actions only. | Product confirmations + Codex |
| **37.12** | Provider/frontend/deployment | Gemini Live consent/session broker or relay, browser voice UX, usage/retention/kill switch, safe action integration, Pro internal pilot, regional/privacy review. | Product/privacy + Codex + operator |

Each pass must be independently reviewable, preserve flags off by default, identify any migration and deployment step explicitly, and finish its own offline regression suite before the next pass. PASS 37.12 must not be pulled forward merely because a provider credential exists.

## 13. True blocking decisions

These are product, privacy, or architecture decisions the repository does not answer. Everything else can be derived or implemented without stopping for preference questions.

| Decision | Why it blocks | Safe default until decided |
| --- | --- | --- |
| What proves faculty/institution authority? | Determines provenance schema, verification workflow, retrieval enforcement, and badges. Classroom origin alone may not prove author role. | Treat all existing and self-asserted sources as `unknown` or `student_asserted`; generated content is never authoritative. |
| Which capacity signals may influence workload, and for how long? | Determines data minimization, snapshot policy, explanation, consent, and evaluation. | Use only explicit availability/current workload; do not infer traits or adapt plan intensity. |
| Recovery plans and undo promise | Determines entitlement gates, UI copy, plan-version API, and rollout risk. | Flag off; candidate Plus/Pro; preview/reject only until rollback semantics are approved. |
| Assignment assistance boundary | Determines whether the product teaches, suggests, drafts, or evaluates and what constitutes academic misconduct. | Guidance and StudentOS evaluation only; student review required; no external submission/writeback. |
| Generated-image provider/content/retention and final plans | Determines moderation, storage lifecycle, usage protection, and public promise. | Feature off; deterministic/text visuals only. |
| UI action confirmation classes | Determines registry v1 scope and whether any mutation may be proposed. | Navigation/read-only proposals only; no destructive or external actions. |
| Gemini Live credential architecture, regional processing, consent, and retention | Determines browser/server topology and privacy posture. | Feature off; no audio/transcript retention; no provider credential in browser. |

## 14. Validation results

All required validation was run offline from the audited branch on 2026-08-02. On this Windows host, direct `npm` in PowerShell resolves to a blocked `npm.ps1`; the suites were therefore invoked through the native `npm.cmd` executable. This changes only the launcher, not the package script. The initial host-shell policy error occurred before project code and is not counted as a project test failure.

| Required command | Result | Exact evidence |
| --- | --- | --- |
| `npm run check:syntax` | PASS | 181 files checked; 0 failures; `secretsPrinted: false`. |
| `npm run test:recovery` | PASS | Adaptive Recovery 23 evaluation-backed cases and production-readiness remediation safeguards passed. |
| `npm run eval:recovery` | PASS | 23 required, 23 passed, 0 failed across evidence, state, reassessment, priority, scheduling, authorization, and provider-failure categories. |
| `npm run test:pass36-planning` | PASS | Evidence-based weak topics and schedule-aware planning checks passed. |
| `npm run test:pass354` | PASS | Plan/Classroom assertions passed; writeback false and real payment false. |
| `npm run test:c01-assessment-integrity` | PASS | C-01 assessment integrity and adversarial scoring tests passed. |
| `npm run test:h01-public-dto` | PASS | H-01 strict public workspace DTO boundary tests passed. |
| `npm run test:h02-state-repositories` | PASS | H-02 narrow repositories and transactional mutation tests passed. |
| `npm run test:h03-background-embeddings` | PASS | H-03 background-only embedding boundary tests passed. |
| `npm test` | **FAIL** | All Node suites before E2E passed. Playwright: 15 passed, 1 skipped, 14 did not run, 1 failed. Failing test: `tests/e2e/studentos-desktop.spec.js:972:1 › Setup saves availability without manual roadmap or weak-topic controls`. Assertion at line 999 expected no failed requests but received two failures for `/Y7q4YRF9/Student-OS-logo.png`. |

The full-suite asset failure is unrelated to this document-only audit and was not repaired. It must remain visible in the next implementation pass’s baseline and be rechecked before attributing any new E2E failure to PASS 37 work.

Live Supabase, Azure, Cloudflare, provider, migration, worker, and feature-flag verification was **not run**. Operational statements in this document are therefore explicitly “declared in repository” or “unverified,” never “deployed.”

Document-scope validation at commit time:

- `git diff --check`: PASS; no whitespace errors.
- tracked diff scope: PASS; exactly `docs/roadmaps/PASS37_REMAINING_FEATURES_READINESS_AUDIT.md`, 479 inserted lines before this final validation update.
- branch/status review: PASS; branch is `feature/remaining-features-readiness` and no unrelated tracked or untracked change is present.

## 15. No-regression and scope confirmation

PASS 37.0 makes no production behavior, schema, migration, flag, entitlement, provider, deployment, storage, or frontend change. It does not enable Recovery or any other audited feature.

Later passes must prove all of the following in addition to their feature-specific exit criteria:

- C-01 server-owned scoring, private rubrics/keys, and client-tamper rejection remain intact.
- C-02 exact embedding identity and background-only embedding behavior remain intact.
- H-01 public DTOs do not leak internal Recovery, provenance, assignment, job, artifact, provider, voice, or private quota data.
- H-02 routes load and mutate only their narrow state scope, with transactional writes and ownership checks.
- Ordinary reads do not parse, generate, embed, backfill, clean up, or otherwise mutate state.
- Source, attachment, image, and any approved transcript artifacts remain private and user-owned.
- Lifecycle and plan entitlements are enforced by the server; frontend hiding is never the access boundary.
- Classroom stays read-only for Trial, Starter, Essential, Plus, and Pro. There is no writeback, automatic or hidden submission, turn-in, grading, modification, or deletion.
- Generated study material, diagrams, and images are disclosed and never treated as faculty authority or assessment evidence.
- Learning-capacity work never performs intelligence, medical, mental-health, personality, emotion, biometric, demographic, protected-class, or voice-based inference.
- No social/personality challenge system, webcam proctoring, Android implementation, or Classroom submission work is introduced under these passes.
- Feature flags default off until the pass-specific offline suite, live schema/topology checks, monitoring, rollback, and explicit operator approval are complete.

The intended PASS 37.0 change set is exactly one readiness document. No roadmap index existed under `docs/roadmaps`, so no speculative index was added.
