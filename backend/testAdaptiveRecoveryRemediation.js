import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getAiProviderConfig } from "./ai/providerConfig.js";
import { resetProviderRuntimeForTests, runProviderFallback } from "./ai/providers.js";
import { buildSafeExportPreview } from "./account/lifecycleService.js";
import { processClaimedJob } from "./jobs/workerRuntime.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { buildAcademicStateSnapshot, ensureRecoveryCollections } from "./recovery/academicStateBuilder.js";
import { createRecoveryEvaluationState } from "./recovery/recoveryEvaluationCases.js";
import { getRecoveryConfig } from "./recovery/recoveryConfig.js";
import { queueRecoveryAnalysis } from "./recovery/recoveryEngineService.js";
import { RECOVERY_FAILURES } from "./recovery/recoveryErrors.js";
import { buildRecoveryPlanPreview, validateRecoveryPlan } from "./recovery/recoveryPlanner.js";
import { parseRecoveryReasoningJson } from "./recovery/recoverySchemas.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const session = { authenticated: false, user: { id: USER_ID, email: "recovery-test@studentos.local" } };
const recoveryConfig = getRecoveryConfig({ STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true" });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function providerCode(url) {
  if (String(url).includes("groq")) return "groq";
  if (String(url).includes("googleapis")) return "gemini";
  return "pollinations";
}

function providerSuccess(provider, text) {
  return provider === "gemini"
    ? response({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] })
    : response({ choices: [{ message: { content: text }, finish_reason: "stop" }] });
}

function deterministicProviderConfig() {
  return getAiProviderConfig({
    STUDENTOS_AI_MODE: "auto",
    STUDENTOS_AI_PROVIDER_CYCLE_ENABLED: "false",
    STUDENTOS_AI_CONCURRENT_WAIT_MS: "5",
    STUDENTOS_AI_REPLAY_POLL_MS: "1",
    STUDENTOS_AI_LOGICAL_OPERATION_TIMEOUT_MS: "5000",
    GROQ_API_KEY_1: "remediation-groq-key",
    GEMINI_API_KEY_1: "remediation-gemini-key",
    POLLINATIONS_API_KEY: "remediation-pollinations-key",
  });
}

const emptyReasoning = JSON.stringify({
  topicRecommendations: [],
  replanRequired: false,
  urgency: "none",
  summary: "No grounded recovery change is required.",
});

async function fallbackWith(outputs) {
  resetProviderRuntimeForTests();
  const calls = [];
  const result = await runProviderFallback({
    messages: [{ role: "user", content: "Return strict recovery JSON." }],
    responseMode: "json",
    providerOrder: ["groq", "gemini", "pollinations"],
    config: deterministicProviderConfig(),
    validateOutput: (providerResult) => parseRecoveryReasoningJson(providerResult.text),
    fetchImpl: async (url) => {
      const provider = providerCode(url);
      calls.push(provider);
      const output = outputs[provider];
      if (output === "transport") return response({ error: { message: "temporary" } }, 503);
      return providerSuccess(provider, output);
    },
  });
  return { result, calls };
}

{
  const { result, calls } = await fallbackWith({ groq: "not-json", gemini: emptyReasoning, pollinations: emptyReasoning });
  assert.equal(result.providerCode, "gemini");
  assert.deepEqual(result.attempts.map((item) => item.outcome), ["invalid_output", "success"]);
  assert.deepEqual(calls, ["groq", "gemini"]);
}

{
  const { result, calls } = await fallbackWith({ groq: "not-json", gemini: "also-not-json", pollinations: emptyReasoning });
  assert.equal(result.providerCode, "pollinations");
  assert.deepEqual(result.attempts.map((item) => item.outcome), ["invalid_output", "invalid_output", "success"]);
  assert.deepEqual(calls, ["groq", "gemini", "pollinations"]);
}

{
  const { result, calls } = await fallbackWith({ groq: "invalid-groq-secret", gemini: "invalid-gemini-secret", pollinations: "invalid-pollinations-secret" });
  assert.equal(result.providerFailure, true);
  assert.equal(result.invalidOutputSeen, true);
  assert.deepEqual(result.attempts.map((item) => item.outcome), ["invalid_output", "invalid_output", "invalid_output"]);
  assert.deepEqual(calls, ["groq", "gemini", "pollinations"], "schema failures must not trigger same-provider repair calls");
  assert.doesNotMatch(JSON.stringify(result.attempts), /invalid-.*-secret/);
}

{
  const { result } = await fallbackWith({ groq: "transport", gemini: "transport", pollinations: "transport" });
  assert.equal(result.providerFailure, true);
  assert.equal(result.invalidOutputSeen, false);
}

{
  resetProviderRuntimeForTests();
  let calls = 0;
  const unrelated = await runProviderFallback({
    messages: [{ role: "user", content: "Unrelated workflow" }],
    providerOrder: ["groq", "gemini", "pollinations"],
    config: deterministicProviderConfig(),
    fetchImpl: async (url) => {
      calls += 1;
      return providerSuccess(providerCode(url), "legacy free-form output");
    },
  });
  assert.equal(unrelated.providerCode, "groq");
  assert.equal(unrelated.text, "legacy free-form output");
  assert.equal(calls, 1, "unrelated routing must remain unchanged without an output validator");
}

function plannerSnapshot({ capacity, unfinishedDuration }) {
  const state = createRecoveryEvaluationState();
  state.studentProfile.preferences.dailyStudyAvailabilityMinutes = capacity;
  state.studentProfile.dailyTodoPlan.items = [
    { id: "done_task", title: "Completed foundation", courseId: "course_math", topicId: "topic_algebra", duration_minutes: 20, priority: "medium", study_status: "done", study_completed_at: "2026-07-19T08:00:00.000Z" },
    { id: "long_unfinished", title: "Long unfinished paper", courseId: "course_math", topicId: "topic_algebra", duration_minutes: unfinishedDuration, priority: "high", study_status: "not_started" },
  ];
  const snapshot = buildAcademicStateSnapshot(state, {
      triggeringEventIds: [],
      clock: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" },
      config: recoveryConfig,
      now: new Date("2026-07-19T12:00:00.000Z"),
    }).snapshot;
  snapshot.state.availability = { capacityMinutes: capacity, fixedCommitments: [], exactWindows: [], originalText: "" };
  return { state, snapshot };
}

{
  const { state, snapshot } = plannerSnapshot({ capacity: 120, unfinishedDuration: 90 });
  const proposal = buildRecoveryPlanPreview(snapshot, [], { now: new Date("2026-07-19T12:00:00.000Z") });
  const retained = proposal.plan.items.find((item) => item.id === "long_unfinished");
  assert.equal(retained.duration_minutes, 90);
  assert.equal(retained.task_origin, "existing_unfinished");
  assert.equal(proposal.deferredWork.some((item) => item.id === "long_unfinished"), false);
  assert.equal(validateRecoveryPlan({ ...proposal, snapshot, state }), true);
}

{
  const { state, snapshot } = plannerSnapshot({ capacity: 60, unfinishedDuration: 90 });
  const proposal = buildRecoveryPlanPreview(snapshot, [], { now: new Date("2026-07-19T12:00:00.000Z") });
  assert.equal(proposal.plan.items.some((item) => item.id === "long_unfinished"), false);
  const deferred = proposal.deferredWork.find((item) => item.id === "long_unfinished");
  assert.equal(deferred.originalTaskId, "long_unfinished");
  assert.equal(deferred.originalDurationMinutes, 90);
  assert.equal(validateRecoveryPlan({ ...proposal, snapshot, state }), true);
}

{
  const { snapshot } = plannerSnapshot({ capacity: 180, unfinishedDuration: 90 });
  const evidenceId = snapshot.state.evidence[0].id;
  const proposal = buildRecoveryPlanPreview(snapshot, [{
    id: "recovery_intent_long",
    courseId: "course_math",
    topicId: "topic_algebra",
    topicTitle: "Algebra",
    evidenceIds: [evidenceId],
    evidenceStrength: "strong",
    priority: 80,
    priorityBand: "critical",
    status: "active",
    activityType: "targeted_practice",
    recommendedMinutes: 90,
    reasonCode: "MAPPED_ASSESSMENT_GAP",
    explanation: "Mapped assessment evidence requires focused practice.",
  }]);
  const generated = proposal.plan.items.find((item) => item.recovery_intent_id === "recovery_intent_long");
  assert.equal(generated.duration_minutes, 60);
  assert.equal(generated.task_origin, "recovery_generated");
}

{
  const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
  const initial = createRecoveryEvaluationState();
  initial.recoveryRuns.push({ id: "run_scoped", userId: USER_ID, status: "queued", processingAttempt: 0 });
  await repository.saveState(session, initial);
  const workerState = await repository.loadState(session);
  const requestState = await repository.loadState(session);
  requestState.studentProfile.preferences.concurrentPreference = "must-survive";
  await repository.saveOrdinaryState(session, requestState);
  const workerRun = workerState.recoveryRuns.find((item) => item.id === "run_scoped");
  workerRun.status = "building_state";
  await repository.saveRecoveryChanges(session, workerState, { recoveryRuns: [workerRun] });
  assert.equal((await repository.loadState(session)).studentProfile.preferences.concurrentPreference, "must-survive");

  const staleAcademic = await repository.loadState(session);
  const currentAcademic = await repository.loadState(session);
  ensureRecoveryCollections(currentAcademic).academicRevision += 1;
  await repository.saveRecoveryChanges(session, currentAcademic, { userState: true });
  await assert.rejects(
    repository.saveRecoveryChanges(session, staleAcademic, { recoveryRuns: [staleAcademic.recoveryRuns[0]] }),
    (error) => error.code === RECOVERY_FAILURES.CONCURRENCY_CONFLICT,
  );

  const stalePlan = await repository.loadState(session);
  const currentPlan = await repository.loadState(session);
  ensureRecoveryCollections(currentPlan).planVersion += 1;
  await repository.saveRecoveryChanges(session, currentPlan, { userState: true });
  await assert.rejects(
    repository.saveRecoveryChanges(session, stalePlan, { recoveryRuns: [stalePlan.recoveryRuns[0]] }),
    (error) => error.code === RECOVERY_FAILURES.CONCURRENCY_CONFLICT,
  );

  const beforeFailedTransaction = await repository.loadState(session);
  const badUserState = clone(ensureRecoveryCollections(beforeFailedTransaction));
  badUserState.academicRevision += 2;
  const partialEvent = { id: "event_must_not_persist", userId: USER_ID, eventType: "manual_analysis_requested" };
  await assert.rejects(repository.saveRecoveryChanges(session, beforeFailedTransaction, { userState: badUserState, academicEvents: [partialEvent] }));
  assert.equal((await repository.loadState(session)).academicEvents.some((item) => item.id === partialEvent.id), false);
}

function validRecoveryReasoning(evidenceId) {
  return JSON.stringify({
    topicRecommendations: [{
      syllabusTopicId: "topic_algebra",
      evidenceIds: [evidenceId],
      evidenceStrength: "strong",
      priorityChange: "increase",
      activityType: "targeted_practice",
      recommendedMinutes: 30,
      reasonCode: "MAPPED_ASSESSMENT_GAP",
      explanation: "Mapped incorrect answers show an algebra gap.",
    }],
    replanRequired: true,
    urgency: "high",
    summary: "A grounded algebra recovery activity is recommended.",
  });
}

async function queuedWorkerFixture(idempotencyKey) {
  const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
  const initial = createRecoveryEvaluationState();
  const originalPlan = clone(initial.studentProfile.dailyTodoPlan);
  await repository.saveState(session, initial);
  const state = await repository.loadState(session);
  const queued = await queueRecoveryAnalysis({
    repository,
    session,
    state,
    input: { currentDate: "2026-07-19", currentTime: "12:00", timezone: "UTC" },
    idempotencyKey,
    correlationId: `correlation_${idempotencyKey}`,
    config: recoveryConfig,
  });
  return { repository, queued, originalPlan };
}

async function runClaim(repository, fetchImpl) {
  const listedJob = await repository.claimNextBackgroundJob({ workerId: "remediation-test", lockTimeoutSeconds: 1 });
  assert.ok(listedJob, "expected a queued recovery job");
  return processClaimedJob({
    repository,
    config: { mode: "mock" },
    listedJob,
    recoveryRuntimeConfig: recoveryConfig,
    aiProviderRuntimeConfig: deterministicProviderConfig(),
    recoveryFetchImpl: fetchImpl,
  });
}

const transportFailure = async () => response({ error: { message: "temporary provider outage" } }, 503);

{
  const { repository, queued, originalPlan } = await queuedWorkerFixture("retry-then-success");
  resetProviderRuntimeForTests();
  const first = await runClaim(repository, transportFailure);
  assert.equal(first.willRetry, true);
  let persisted = await repository.loadState(session);
  let run = persisted.recoveryRuns.find((item) => item.id === queued.run.id);
  assert.equal(run.status, "failed");
  assert.equal(run.failureRetryable, true);
  assert.equal(run.processingAttempt, 1);
  assert.equal(run.attemptHistory.length, 1);
  assert.equal(persisted.recoveryPreviews.length, 0);

  const evidenceId = persisted.academicStateSnapshots.find((item) => item.id === run.currentSnapshotId).state.evidence[0].id;
  resetProviderRuntimeForTests();
  const second = await runClaim(repository, async (url) => providerSuccess(providerCode(url), validRecoveryReasoning(evidenceId)));
  assert.equal(second.ok, true);
  persisted = await repository.loadState(session);
  run = persisted.recoveryRuns.find((item) => item.id === queued.run.id);
  assert.equal(run.status, "ready_for_review");
  assert.equal(run.processingAttempt, 2);
  assert.equal(persisted.recoveryPreviews.length, 1);
  assert.deepEqual(persisted.studentProfile.dailyTodoPlan, originalPlan, "analysis and retry must not mutate Today before apply");
  const ledger = repository.mock.aiUsageLedger.filter((item) => item.requestId.startsWith(`recovery:${queued.run.id}:`));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].status, "charged");
  assert.equal(repository.mock.aiUsageLedger.filter((item) => item.status === "charged").length, 1);
}

{
  const { repository, queued } = await queuedWorkerFixture("all-invalid-output");
  resetProviderRuntimeForTests();
  const calls = [];
  const result = await runClaim(repository, async (url) => {
    const provider = providerCode(url);
    calls.push(provider);
    return providerSuccess(provider, "raw-invalid-output-must-not-persist");
  });
  assert.equal(result.willRetry, false);
  const persisted = await repository.loadState(session);
  const run = persisted.recoveryRuns.find((item) => item.id === queued.run.id);
  assert.equal(run.status, "failed");
  assert.equal(run.failureCode, RECOVERY_FAILURES.OUTPUT_INVALID);
  assert.equal(run.failureRetryable, false);
  assert.deepEqual(calls, ["groq", "gemini", "pollinations"]);
  assert.doesNotMatch(JSON.stringify(run), /raw-invalid-output-must-not-persist/);
}

{
  const { repository, queued } = await queuedWorkerFixture("retry-exhaustion");
  let finalResult = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    resetProviderRuntimeForTests();
    finalResult = await runClaim(repository, transportFailure);
  }
  assert.equal(finalResult.exhausted, true);
  const persisted = await repository.loadState(session);
  const run = persisted.recoveryRuns.find((item) => item.id === queued.run.id);
  const job = persisted.backgroundJobs.find((item) => item.sourceId === queued.run.id);
  assert.equal(job.status, "failed");
  assert.equal(job.attempts, 3);
  assert.equal(run.processingAttempt, 3);
  assert.equal(run.failureRetryable, false);
  assert.ok(run.retryExhaustedAt);
  assert.equal(persisted.recoveryPreviews.length, 0);
  assert.equal(repository.mock.aiUsageLedger.filter((item) => item.requestId.startsWith(`recovery:${queued.run.id}:`)).length, 1);
  assert.equal(repository.mock.aiUsageLedger.some((item) => item.status === "charged"), false);
}

{
  const state = createRecoveryEvaluationState();
  state.recoveryUserStates[0].mutationLeaseToken = "lease-secret-token";
  state.recoveryUserStates[0].mutationLeaseExpiresAt = "2026-07-19T13:00:00.000Z";
  state.topicRecoveryStates = [{
    id: "topic_recovery:topic_algebra", userId: USER_ID, courseId: "course_math", topicId: "topic_algebra",
    evidenceIds: ["evidence:result_initial:topic_algebra"], evidenceStrength: "strong", priority: 88, priorityBand: "critical",
    status: "active", reasonCode: "MAPPED_ASSESSMENT_GAP", explanation: "Grounded explanation", version: 2,
    firstObservedAt: "2026-07-18T10:00:00.000Z", latestObservedAt: "2026-07-19T10:00:00.000Z", resolvedAt: null,
    updatedAt: "2026-07-19T10:00:00.000Z",
  }];
  state.topicRecoveryStateHistory = [{
    id: "history_1", userId: USER_ID, topicRecoveryStateId: "topic_recovery:topic_algebra", courseId: "course_math",
    topicId: "topic_algebra", fromStatus: null, toStatus: "active", evidenceIds: ["evidence:result_initial:topic_algebra"],
    priority: 88, reasonCode: "MAPPED_ASSESSMENT_GAP", version: 1, createdAt: "2026-07-18T10:00:00.000Z",
  }];
  state.recoveryRuns = [{
    id: "run_export", userId: USER_ID, status: "failed", processingAttempt: 2, providerRouting: { finalProvider: "gemini" },
    providerAttempts: [{ provider: "gemini", model: "secret-model" }], rawOutput: "raw-provider-secret", createdAt: "2026-07-19T09:00:00.000Z",
    updatedAt: "2026-07-19T10:00:00.000Z",
  }];
  const exported = buildSafeExportPreview(state);
  const topic = exported.recovery.topicStates[0];
  assert.deepEqual(topic.evidenceIds, ["evidence:result_initial:topic_algebra"]);
  assert.equal(topic.evidenceStrength, "strong");
  assert.equal(topic.priority, 88);
  assert.equal(topic.status, "active");
  assert.equal(topic.reasonCode, "MAPPED_ASSESSMENT_GAP");
  assert.equal(topic.firstObservedAt, "2026-07-18T10:00:00.000Z");
  assert.equal(exported.recovery.topicStateHistory[0].reasonCode, "MAPPED_ASSESSMENT_GAP");
  assert.equal(exported.recovery.runs[0].processingAttempts, 2);
  const serialized = JSON.stringify(exported);
  assert.doesNotMatch(serialized, /lease-secret-token|mutationLease|raw-provider-secret|secret-model|providerRouting|providerAttempts/);
}

{
  const migration001Bytes = await readFile(new URL("../supabase/migrations/202607190001_studentos_adaptive_recovery_engine.sql", import.meta.url));
  assert.equal(createHash("sha256").update(migration001Bytes).digest("hex"), "fd47f9a32de6fec514c14bcb767f81e7db641a7e813cb06bc009e607d7857934");
  const migration002 = await readFile(new URL("../supabase/migrations/202607190002_studentos_adaptive_recovery_hardening.sql", import.meta.url), "utf8");
  for (const marker of [
    "revoke all privileges on table", "from public, anon, authenticated", "grant all privileges on table", "to service_role",
    "for select using (user_id = auth.uid())", "persist_recovery_changes", "recovery_permission_posture",
    "pg_advisory_xact_lock", "for update", "RECOVERY_CONCURRENCY_CONFLICT", "mutationLeaseToken", "p_background_jobs",
  ]) assert.ok(migration002.includes(marker), `migration 002 is missing ${marker}`);
  assert.match(migration002, /revoke all on function public\.persist_recovery_changes[\s\S]+from public, anon, authenticated;/i);
  assert.match(migration002, /grant execute on function public\.persist_recovery_changes[\s\S]+to service_role;/i);
  assert.doesNotMatch(migration002, /grant execute[\s\S]+to authenticated/i);
  const plan = await readFile(new URL("../scripts/printMigrationPlan.js", import.meta.url), "utf8");
  assert.ok(plan.indexOf("202607190001_studentos_adaptive_recovery_engine.sql") < plan.indexOf("202607190002_studentos_adaptive_recovery_hardening.sql"));
}

console.log("PASS | Adaptive Recovery production-readiness remediation safeguards passed");
