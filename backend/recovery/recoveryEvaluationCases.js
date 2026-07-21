import { createEmptyStudentState } from "../domain/studentosDomain.js";
import { StudentOsRepository } from "../repository/studentOsRepository.js";
import { getRecoveryConfig } from "./recoveryConfig.js";
import { assertReasoningGrounded, buildAcademicStateSnapshot, ensureRecoveryCollections, recordAcademicEvent, validTopicEvidence } from "./academicStateBuilder.js";
import { deriveEvidenceStrength, buildRecoveryIntents, applyTopicRecoveryStates, markRecoveryTaskProgress } from "./recoveryPolicy.js";
import { buildRecoveryPlanPreview, generatePlanDiff, validateRecoveryPlan } from "./recoveryPlanner.js";
import { RecoveryReasoningOutputSchema } from "./recoverySchemas.js";
import { applyRecoveryPreview, processRecoveryRun, queueRecoveryAnalysis } from "./recoveryEngineService.js";
import { RECOVERY_FAILURES } from "./recoveryErrors.js";
import { getAiProviderConfig } from "../ai/providerConfig.js";
import { resetProviderRuntimeForTests, runProviderFallback } from "../ai/providers.js";

export function createRecoveryEvaluationState({ secure = false, correctOnly = false, examDate = "2026-07-22" } = {}) {
  const state = createEmptyStudentState({ userId: "00000000-0000-4000-8000-000000000001", displayName: "Recovery Test" });
  state.studentProfile.timezone = "UTC";
  state.studentProfile.preferences = { dailyStudyAvailabilityMinutes: 60 };
  state.studentProfile.dailyTodoPlan = {
    date: "2026-07-19",
    items: [
      { id: "done_task", title: "Completed foundation", courseId: "course_math", topicId: "topic_algebra", duration_minutes: 20, priority: "medium", study_status: "done", study_completed_at: "2026-07-19T08:00:00.000Z" },
      { id: "unfinished_task", title: "Unfinished worksheet", courseId: "course_math", topicId: "topic_algebra", duration_minutes: 30, priority: "high", study_status: "not_started" },
    ],
  };
  state.courses = [{ id: "course_math", userId: state.studentProfile.id, title: "Mathematics", examDate }];
  state.topics = [{
    id: "topic_algebra",
    userId: state.studentProfile.id,
    courseId: "course_math",
    title: "Algebra",
    coverageState: secure ? "covered" : "teaching",
    mastery: secure ? "secure" : "revision_required",
    academicContextIncluded: true,
    performance: {
      source: "studentos_assessment_evidence",
      status: secure ? "secure" : "needs_recovery",
      latestPercentage: secure ? 90 : correctOnly ? 100 : 40,
      weightedPercentage: secure ? 82 : correctOnly ? 100 : 40,
      latestAssessedAt: "2026-07-19T09:00:00.000Z",
    },
  }];
  state.syllabi = [{ id: "syllabus_math", courseId: "course_math", title: "Mathematics", units: [{ id: "topic_algebra", title: "Algebra" }] }];
  state.exams = [{ id: "exam_math", courseId: "course_math", title: "Mathematics exam", examDate }];
  state.assignments = [{ id: "assignment_math", courseId: "course_math", topicIds: ["topic_algebra"], title: "Algebra assignment", dueAt: "2026-07-20T18:00:00.000Z", status: "open" }];
  state.testResults = [{
    id: secure ? "result_reassessment" : "result_initial",
    userId: state.studentProfile.id,
    testSessionId: secure ? "session_reassessment" : "session_initial",
    completedAt: "2026-07-19T09:00:00.000Z",
    topicEvidence: [{
      courseId: "course_math", topicId: "topic_algebra", topicTitle: "Algebra",
      marksEarned: secure || correctOnly ? 10 : 4, marksAvailable: 10,
      percentage: secure || correctOnly ? 100 : 40, questionNumbers: [1, 2, 3],
      incorrectQuestionNumbers: secure || correctOnly ? [] : [1, 2, 3],
      assessedAt: "2026-07-19T09:00:00.000Z", testResultId: secure ? "result_reassessment" : "result_initial",
      testSessionId: secure ? "session_reassessment" : "session_initial", mappingSource: "studentos_strict_test_scope",
    }],
  }];
  state.billingSubscriptions = [{ id: "sub_test", userId: state.studentProfile.id, planId: "starter", status: "active", updatedAt: "2026-07-19T00:00:00.000Z" }];
  state.roadmap = [];
  state.backgroundJobs = [];
  state.auditLog = [];
  ensureRecoveryCollections(state);
  return state;
}

function reasoningFor(snapshot) {
  const evidence = snapshot.state.evidence[0];
  return RecoveryReasoningOutputSchema.parse({
    topicRecommendations: evidence ? [{
      syllabusTopicId: "topic_algebra", evidenceIds: [evidence.id], evidenceStrength: "strong",
      priorityChange: "increase", activityType: "targeted_practice", recommendedMinutes: 30,
      reasonCode: "MAPPED_ASSESSMENT_GAP", explanation: "Mapped answers show an algebra gap.",
    }] : [],
    replanRequired: Boolean(evidence), urgency: "high", summary: "Recovery evaluation.",
  });
}

async function executeCase(name, category, action) {
  const started = Date.now();
  try {
    await action();
    return { name, category, passed: true, durationMs: Date.now() - started };
  } catch (error) {
    return { name, category, passed: false, durationMs: Date.now() - started, error: String(error?.message || error).slice(0, 220) };
  }
}

function expect(value, message) {
  if (!value) throw new Error(message);
}

function evaluationProviderConfig() {
  return { requestedMode: "mock", routing: { enabled: false, shadow: false, rolloutPercent: 0, providers: {}, concurrentWaitMs: 5, leaseMs: 1000, replayPollMs: 1, operationTimeoutMs: 1000 } };
}

function providerResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function deterministicProviderConfig() {
  return getAiProviderConfig({
    STUDENTOS_AI_MODE: "auto",
    GROQ_API_KEY_1: "recovery-groq-test",
    GEMINI_API_KEY_1: "recovery-gemini-test",
    POLLINATIONS_API_KEY: "recovery-pollinations-test",
  });
}

let queuedRecoveryOrdinal = 0;

async function prepareQueuedRecovery({ executeAiOperation = undefined, providerConfig = evaluationProviderConfig() } = {}) {
  const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
  const session = { authenticated: false, user: { id: "00000000-0000-4000-8000-000000000001" } };
  await repository.saveState(session, createRecoveryEvaluationState());
  let state = await repository.loadState(session);
  const config = getRecoveryConfig({ STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true" });
  const queued = await queueRecoveryAnalysis({
    repository,
    session,
    state,
    input: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" },
    idempotencyKey: `analysis-evaluation-${++queuedRecoveryOrdinal}`,
    correlationId: "corr",
    config,
  });
  state = await repository.loadState(session);
  const options = { repository, session, state, runId: queued.run.id, config, providerConfig };
  if (executeAiOperation) options.executeAiOperation = executeAiOperation;
  return { repository, session, state, config, queued, options };
}

export async function runRecoveryEvaluationCases() {
  const cases = [];
  cases.push(await executeCase("mapped incorrect evidence is grounded", "evidence_grounding", () => {
    const evidence = validTopicEvidence(createRecoveryEvaluationState());
    expect(evidence.length === 1 && evidence[0].incorrectMarks === 6, "mapped incorrect evidence missing");
  }));
  cases.push(await executeCase("correct-only evidence is not weak", "evidence_grounding", () => {
    const evidence = validTopicEvidence(createRecoveryEvaluationState({ correctOnly: true }));
    expect(deriveEvidenceStrength(evidence) === "insufficient", "correct-only evidence created weakness");
  }));
  cases.push(await executeCase("evidence strength thresholds are exact", "evidence_grounding", () => {
    const row = (overrides = {}) => ({ testResultId: "result-a", percentage: 50, incorrectQuestionCount: 1, incorrectMarks: 2, ...overrides });
    expect(deriveEvidenceStrength([row(), row({ testResultId: "result-b" })]) === "strong", "two below-threshold assessments were not strong");
    expect(deriveEvidenceStrength([row({ incorrectQuestionCount: 3, incorrectMarks: 10 })]) === "strong", "three incorrect answers with ten lost marks were not strong");
    expect(deriveEvidenceStrength([row({ incorrectQuestionCount: 2, incorrectMarks: 2 })]) === "moderate", "two incorrect answers were not moderate");
    expect(deriveEvidenceStrength([row({ percentage: 80, incorrectQuestionCount: 1, incorrectMarks: 1 })]) === "weak", "one mapped incorrect answer was not weak");
    expect(deriveEvidenceStrength([]) === "insufficient", "empty evidence was not insufficient");
  }));
  cases.push(await executeCase("missing topic mapping is excluded", "evidence_grounding", () => {
    const state = createRecoveryEvaluationState();
    state.testResults[0].topicEvidence[0].topicId = null;
    expect(validTopicEvidence(state).length === 0, "unmapped evidence was accepted");
  }));
  cases.push(await executeCase("fabricated evidence is rejected", "evidence_grounding", () => {
    const state = createRecoveryEvaluationState();
    const snapshot = buildAcademicStateSnapshot(state, { clock: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" } }).snapshot;
    const reasoning = reasoningFor(snapshot);
    reasoning.topicRecommendations[0].evidenceIds = ["evidence:fabricated:topic_algebra"];
    let code = null;
    try { assertReasoningGrounded(reasoning, snapshot); } catch (error) { code = error.code; }
    expect(code === RECOVERY_FAILURES.EVIDENCE_INVALID, "fabricated evidence was accepted");
  }));
  cases.push(await executeCase("snapshot fingerprint is deterministic and reused", "recovery_state_transitions", () => {
    const state = createRecoveryEvaluationState();
    const first = buildAcademicStateSnapshot(state, { clock: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" } });
    const immutable = JSON.stringify(first.snapshot);
    const second = buildAcademicStateSnapshot(state, { clock: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" } });
    expect(second.reused && second.snapshot.id === first.snapshot.id && JSON.stringify(first.snapshot) === immutable, "identical academic state created or mutated a snapshot");
  }));
  cases.push(await executeCase("reassessment resolves topic", "reassessment", () => {
    const state = createRecoveryEvaluationState({ secure: true });
    const snapshot = buildAcademicStateSnapshot(state, { clock: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" } }).snapshot;
    const intent = buildRecoveryIntents(snapshot, reasoningFor(snapshot))[0];
    expect(intent.status === "resolved" && intent.priority < 35, "secure reassessment did not reduce priority");
  }));
  cases.push(await executeCase("task completion awaits reassessment", "recovery_state_transitions", () => {
    const state = createRecoveryEvaluationState();
    const snapshot = buildAcademicStateSnapshot(state, { clock: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" } }).snapshot;
    applyTopicRecoveryStates(state, buildRecoveryIntents(snapshot, reasoningFor(snapshot)));
    markRecoveryTaskProgress(state, { topicId: "topic_algebra" }, "done");
    expect(state.topicRecoveryStates[0].status === "awaiting_reassessment", "task completion incorrectly resolved mastery");
  }));
  cases.push(await executeCase("earlier exam raises priority", "priority_adaptation", () => {
    const early = buildAcademicStateSnapshot(createRecoveryEvaluationState({ examDate: "2026-07-20" }), { clock: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" } }).snapshot;
    const late = buildAcademicStateSnapshot(createRecoveryEvaluationState({ examDate: "2026-08-20" }), { clock: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" } }).snapshot;
    expect(buildRecoveryIntents(early, reasoningFor(early))[0].priority > buildRecoveryIntents(late, reasoningFor(late))[0].priority, "exam proximity did not increase priority");
  }));
  cases.push(await executeCase("priority formula applies bounded components", "priority_adaptation", () => {
    const state = createRecoveryEvaluationState();
    const snapshot = buildAcademicStateSnapshot(state, { clock: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" } }).snapshot;
    const intent = buildRecoveryIntents(snapshot, reasoningFor(snapshot))[0];
    expect(intent.priority === 70 && intent.priorityBand === "high", `unexpected deterministic priority ${intent.priority}`);
  }));
  cases.push(await executeCase("reduced availability defers work", "scheduling_feasibility", () => {
    const state = createRecoveryEvaluationState();
    const snapshot = buildAcademicStateSnapshot(state, { clock: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" } }).snapshot;
    snapshot.state.availability = { capacityMinutes: 20, exactWindows: [{ start: 720, end: 740 }], suggestedWindow: "12:00–12:20" };
    const preview = buildRecoveryPlanPreview(snapshot, buildRecoveryIntents(snapshot, reasoningFor(snapshot)));
    expect(preview.deferredWork.length > 0, "work was compressed instead of deferred");
    validateRecoveryPlan({ ...preview, snapshot, state });
  }));
  cases.push(await executeCase("duplicate event is idempotent", "recovery_state_transitions", () => {
    const state = createRecoveryEvaluationState();
    const input = { eventType: "study_task_missed", sourceEntityType: "study_task", sourceEntityId: "task", idempotencyKey: "missed:task" };
    recordAcademicEvent(state, input);
    expect(recordAcademicEvent(state, input).replayed && state.academicEvents.length === 1, "duplicate event was persisted");
  }));
  cases.push(await executeCase("idempotency key rejects changed analysis input", "authorization", async () => {
    const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
    const session = { authenticated: false, user: { id: "00000000-0000-4000-8000-000000000001" } };
    await repository.saveState(session, createRecoveryEvaluationState());
    let state = await repository.loadState(session);
    const config = getRecoveryConfig({ STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true" });
    await queueRecoveryAnalysis({ repository, session, state, input: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" }, idempotencyKey: "analysis-conflict", correlationId: "corr", config });
    state = await repository.loadState(session);
    let code = null;
    try {
      await queueRecoveryAnalysis({ repository, session, state, input: { currentDate: "2026-07-20", currentTime: "12:00", timezone: "UTC" }, idempotencyKey: "analysis-conflict", correlationId: "corr", config });
    } catch (error) { code = error.code; }
    expect(code === RECOVERY_FAILURES.IDEMPOTENCY_CONFLICT, "changed analysis input replayed under the same idempotency key");
  }));
  cases.push(await executeCase("preview apply is exactly once", "authorization", async () => {
    const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
    const session = { authenticated: false, user: { id: "00000000-0000-4000-8000-000000000001" } };
    await repository.saveState(session, createRecoveryEvaluationState());
    let state = await repository.loadState(session);
    const config = getRecoveryConfig({ STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true" });
    const queued = await queueRecoveryAnalysis({ repository, session, state, input: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" }, idempotencyKey: "analysis-one", correlationId: "corr", config });
    state = await repository.loadState(session);
    await processRecoveryRun({ repository, session, state, runId: queued.run.id, config, providerConfig: evaluationProviderConfig() });
    state = await repository.loadState(session);
    const run = state.recoveryRuns.find((item) => item.id === queued.run.id);
    const first = await applyRecoveryPreview({ repository, session, state, previewId: run.previewId, idempotencyKey: "apply-one", config, correlationId: "corr" });
    const version = first.planVersion.version;
    state = await repository.loadState(session);
    const replay = await applyRecoveryPreview({ repository, session, state, previewId: run.previewId, idempotencyKey: "apply-one", config, correlationId: "corr" });
    expect(replay.replayed && replay.planVersion.version === version && state.planVersions.length === 2, "preview replay created another plan version");
    let code = null;
    try {
      await queueRecoveryAnalysis({ repository, session, state, input: { currentDate: "2026-07-19", currentTime: "13:00", timezone: "UTC" }, idempotencyKey: "apply-one", correlationId: "corr", config });
    } catch (error) { code = error.code; }
    expect(code === RECOVERY_FAILURES.IDEMPOTENCY_CONFLICT, "an apply key was reused for a different recovery mutation");
  }));
  cases.push(await executeCase("stale preview cannot overwrite a newer plan", "authorization", async () => {
    const prepared = await prepareQueuedRecovery();
    await processRecoveryRun(prepared.options);
    let state = await prepared.repository.loadState(prepared.session);
    const run = state.recoveryRuns.find((item) => item.id === prepared.queued.run.id);
    state.recoveryUserStates[0].planVersion += 1;
    let code = null;
    try {
      await applyRecoveryPreview({ repository: prepared.repository, session: prepared.session, state, previewId: run.previewId, idempotencyKey: "stale-apply", config: prepared.config, correlationId: "corr" });
    } catch (error) { code = error.code; }
    expect(code === RECOVERY_FAILURES.PREVIEW_STALE, "stale preview applied");
  }));
  cases.push(await executeCase("cross-user preview access is denied", "authorization", async () => {
    const prepared = await prepareQueuedRecovery();
    await processRecoveryRun(prepared.options);
    const state = await prepared.repository.loadState(prepared.session);
    const run = state.recoveryRuns.find((item) => item.id === prepared.queued.run.id);
    let code = null;
    try {
      await applyRecoveryPreview({ repository: prepared.repository, session: { authenticated: false, user: { id: "00000000-0000-4000-8000-000000000099" } }, state, previewId: run.previewId, idempotencyKey: "cross-user", config: prepared.config, correlationId: "corr" });
    } catch (error) { code = error.code; }
    expect(code === RECOVERY_FAILURES.UNAUTHORIZED, "cross-user preview access was allowed");
  }));
  cases.push(await executeCase("optimistic mutation lease rejects stale writer", "authorization", async () => {
    const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
    const session = { authenticated: false, user: { id: "00000000-0000-4000-8000-000000000001" } };
    await repository.saveState(session, createRecoveryEvaluationState());
    const first = await repository.loadState(session);
    const stale = await repository.loadState(session);
    recordAcademicEvent(first, { eventType: "study_task_missed", sourceEntityType: "study_task", sourceEntityId: "first", idempotencyKey: "lease:first" });
    await repository.saveRecoveryState(session, first);
    recordAcademicEvent(stale, { eventType: "study_task_missed", sourceEntityType: "study_task", sourceEntityId: "stale", idempotencyKey: "lease:stale" });
    let code = null;
    try { await repository.saveRecoveryState(session, stale); } catch (error) { code = error.code; }
    expect(code === RECOVERY_FAILURES.CONCURRENCY_CONFLICT, "stale recovery writer was not rejected");
  }));
  cases.push(await executeCase("disabled engine preserves existing state", "authorization", async () => {
    const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
    const session = { authenticated: false, user: { id: "00000000-0000-4000-8000-000000000001" } };
    const state = createRecoveryEvaluationState();
    const before = JSON.stringify(state.studentProfile.dailyTodoPlan);
    let code = null;
    try {
      await queueRecoveryAnalysis({ repository, session, state, idempotencyKey: "disabled", config: getRecoveryConfig({}) });
    } catch (error) { code = error.code; }
    expect(code === RECOVERY_FAILURES.ENGINE_DISABLED && JSON.stringify(state.studentProfile.dailyTodoPlan) === before && state.recoveryRuns.length === 0, "disabled engine changed state");
  }));
  cases.push(await executeCase("recovery uses fixed provider order", "provider_failure", async () => {
    let fixedOrder = null;
    const prepared = await prepareQueuedRecovery({ executeAiOperation: async (request) => {
      fixedOrder = request.fixedProviderOrder;
      const result = await request.run({ providerExecutor: async () => ({ providerFailure: true }) });
      return { blocked: false, busy: false, success: request.isLogicalSuccess(result), result };
    } });
    await processRecoveryRun(prepared.options);
    expect(JSON.stringify(fixedOrder) === JSON.stringify(["groq", "gemini", "pollinations"]), "recovery provider order changed");
  }));
  cases.push(await executeCase("all recovery fallback stages are reachable", "provider_failure", async () => {
    for (const target of ["groq", "gemini", "pollinations"]) {
      resetProviderRuntimeForTests();
      const calls = [];
      const result = await runProviderFallback({
        messages: [{ role: "user", content: "deterministic recovery fallback" }],
        responseMode: "json",
        providerOrder: ["groq", "gemini", "pollinations"],
        config: deterministicProviderConfig(),
        fetchImpl: async (url) => {
          const provider = url.includes("groq") ? "groq" : url.includes("googleapis") ? "gemini" : "pollinations";
          calls.push(provider);
          if (provider !== target) return providerResponse({ error: { message: "temporary" } }, 503);
          if (provider === "gemini") return providerResponse({ candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }] });
          return providerResponse({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
        },
      });
      expect(result.providerCode === target && calls.at(-1) === target, `fallback did not reach ${target}`);
    }
  }));
  cases.push(await executeCase("provider failure leaves live plan untouched", "provider_failure", async () => {
    const prepared = await prepareQueuedRecovery({ providerConfig: { ...evaluationProviderConfig(), requestedMode: "auto" }, executeAiOperation: async (request) => {
      const result = await request.run({ providerExecutor: async () => ({ providerFailure: true, attempts: [
        { provider: "groq", outcome: "failed" }, { provider: "gemini", outcome: "failed" }, { provider: "pollinations", outcome: "failed" },
      ] }) });
      return { blocked: false, busy: false, success: false, result };
    } });
    const before = JSON.stringify(prepared.state.studentProfile.dailyTodoPlan);
    let code = null;
    try { await processRecoveryRun(prepared.options); } catch (error) { code = error.code; }
    const after = await prepared.repository.loadState(prepared.session);
    expect(code === RECOVERY_FAILURES.PROVIDER_FAILED && JSON.stringify(after.studentProfile.dailyTodoPlan) === before && after.recoveryPreviews.length === 0, "provider failure changed the live plan");
  }));
  cases.push(await executeCase("invalid provider output fails without repair", "provider_failure", async () => {
    let providerCalls = 0;
    const prepared = await prepareQueuedRecovery({ providerConfig: { ...evaluationProviderConfig(), requestedMode: "auto" }, executeAiOperation: async (request) => {
      const result = await request.run({ providerExecutor: async () => {
        providerCalls += 1;
        return { providerFailure: true, invalidOutputSeen: true, attempts: [{ provider: "groq", outcome: "invalid_output" }] };
      } });
      return { blocked: false, busy: false, success: request.isLogicalSuccess(result), result };
    } });
    let code = null;
    try { await processRecoveryRun(prepared.options); } catch (error) { code = error.code; }
    expect(code === RECOVERY_FAILURES.OUTPUT_INVALID && providerCalls === 1, "invalid output was repaired or accepted");
  }));
  cases.push(await executeCase("backend diff reports deferral", "scheduling_feasibility", () => {
    const diff = generatePlanDiff({ items: [] }, { items: [] }, [{ id: "deferred", reasonCode: "INSUFFICIENT_AVAILABLE_TIME", explanation: "Later" }]);
    expect(diff[0].changeType === "task_deferred", "deferred diff missing");
  }));
  return cases;
}
