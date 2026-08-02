import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getPublicProductCapabilities } from "./domain/productFeatureAccessService.js";
import {
  ALL_PLAN_KEYS,
  FEATURE_KEYS,
  canUseClassroomAction,
  canUseFeature,
  getPublicEntitlementSummary,
} from "./domain/planEntitlementService.js";
import { ONBOARDING_STEPS } from "./domain/productLifecycleService.js";
import { FORBIDDEN_PUBLIC_WORKSPACE_KEYS, createPublicStudentWorkspaceDTO } from "./presentation/publicStudentWorkspaceDto.js";
import { STATE_SCOPE_COLLECTIONS } from "./repository/stateScopes.js";
import {
  assertRecoveryRouteAccess,
  getPublicRecoveryCapability,
  requireOwnedRecoveryPreview,
  requireOwnedRecoveryRun,
} from "./recovery/recoveryAccessService.js";
import { getRecoveryConfig } from "./recovery/recoveryConfig.js";
import { publicRecoveryPreview, publicRecoveryRun, rejectRecoveryPreview } from "./recovery/recoveryEngineService.js";
import { RECOVERY_FAILURES } from "./recovery/recoveryErrors.js";
import { createRecoveryEvaluationState } from "./recovery/recoveryEvaluationCases.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099";
const NOW = "2026-08-02T10:00:00.000Z";
const ENABLED_CONFIG = getRecoveryConfig({
  STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true",
  STUDENTOS_RECOVERY_UI_ENABLED: "true",
  STUDENTOS_RECOVERY_ROLLOUT_MODE: "allowlist",
  STUDENTOS_RECOVERY_ROLLOUT_USER_IDS: USER_ID,
});

function activePlanState(planId, { trial = false, setupComplete = true } = {}) {
  const state = createRecoveryEvaluationState();
  state.studentProfile.productLifecycle = {
    state: setupComplete ? "dashboard_active" : "workspace_ready",
    selectedPlanId: planId,
    accessMode: trial ? "trial" : "paid_plan",
    paymentMethodVerifiedAt: NOW,
    legalConsentCompleteAt: NOW,
    onboarding: {
      completedSteps: [...ONBOARDING_STEPS],
      answers: {},
      currentStep: "complete",
    },
    classroomChoice: "manual",
    manualSetupSelectedAt: NOW,
    materialsSelectedAt: NOW,
    selectedMaterialIds: [],
    selectedMaterialLabels: [],
    setupSummaryReadyAt: NOW,
    workspaceReadyAt: NOW,
    tutorialChoice: "skip",
    dashboardActivatedAt: setupComplete ? NOW : null,
  };
  state.billingSubscriptions = [{
    id: `subscription_${planId}_${trial ? "trial" : "paid"}`,
    userId: USER_ID,
    planId,
    status: trial ? "trialing" : "active",
    updatedAt: NOW,
  }];
  return state;
}

function expectRecoveryCode(action, code) {
  assert.throws(action, (error) => error?.code === code, code);
}

const defaultConfig = getRecoveryConfig({});
assert.equal(defaultConfig.enabled, false);
assert.equal(defaultConfig.uiEnabled, false);
assert.equal(defaultConfig.rolloutMode, "off");
expectRecoveryCode(
  () => assertRecoveryRouteAccess(activePlanState("plus"), defaultConfig),
  RECOVERY_FAILURES.ENGINE_DISABLED,
);
expectRecoveryCode(
  () => assertRecoveryRouteAccess(activePlanState("plus"), getRecoveryConfig({ STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true" })),
  RECOVERY_FAILURES.UI_DISABLED,
);

const planExpectations = [
  ["starter", false],
  ["essential", false],
  ["plus", true],
  ["pro", true],
];
for (const [planId, expected] of planExpectations) {
  const state = activePlanState(planId);
  assert.equal(canUseFeature(planId, FEATURE_KEYS.ADAPTIVE_RECOVERY), expected, planId);
  const capability = getPublicRecoveryCapability(state, ENABLED_CONFIG);
  assert.equal(capability.available, expected, planId);
  assert.equal(capability.status, expected ? "available" : "plan_unavailable", planId);
  if (expected) assert.doesNotThrow(() => assertRecoveryRouteAccess(state, ENABLED_CONFIG));
  else expectRecoveryCode(() => assertRecoveryRouteAccess(state, ENABLED_CONFIG), RECOVERY_FAILURES.PLAN_UNAVAILABLE);
}

const trialState = activePlanState("plus", { trial: true });
assert.equal(getPublicRecoveryCapability(trialState, ENABLED_CONFIG).status, "plan_unavailable");
expectRecoveryCode(() => assertRecoveryRouteAccess(trialState, ENABLED_CONFIG), RECOVERY_FAILURES.PLAN_UNAVAILABLE);

const setupPendingState = activePlanState("plus", { setupComplete: false });
assert.equal(getPublicRecoveryCapability(setupPendingState, ENABLED_CONFIG).status, "setup_required");
expectRecoveryCode(() => assertRecoveryRouteAccess(setupPendingState, ENABLED_CONFIG), RECOVERY_FAILURES.SETUP_REQUIRED);

const ownershipState = {
  recoveryRuns: [{ id: "run_owned", userId: USER_ID }],
  recoveryPreviews: [{ id: "preview_owned", userId: USER_ID }],
};
assert.equal(requireOwnedRecoveryRun(ownershipState, "run_owned", USER_ID).id, "run_owned");
assert.equal(requireOwnedRecoveryPreview(ownershipState, "preview_owned", USER_ID).id, "preview_owned");
expectRecoveryCode(() => requireOwnedRecoveryRun(ownershipState, "run_owned", OTHER_USER_ID), RECOVERY_FAILURES.UNAUTHORIZED);
expectRecoveryCode(() => requireOwnedRecoveryPreview(ownershipState, "preview_owned", OTHER_USER_ID), RECOVERY_FAILURES.UNAUTHORIZED);

const projectionState = {
  recoveryUserStates: [{ id: "user_state", userId: USER_ID, academicRevision: 2, planVersion: 4, currentPlanId: "plan_private" }],
  recoveryRuns: [{
    id: "run_public",
    userId: USER_ID,
    status: "reasoning",
    previewId: "preview_public",
    correlationId: "correlation_safe",
    triggerEventIds: ["event_private"],
    currentSnapshotId: "snapshot_private",
    providerRouting: { finalProvider: "provider_private", model: "model_private" },
    providerAttempts: [{ provider: "provider_private", token: "token_private" }],
    rawOutput: "raw_private",
    createdAt: NOW,
    updatedAt: NOW,
  }],
};
const runProjection = publicRecoveryRun(projectionState.recoveryRuns[0]);
assert.deepEqual(Object.keys(runProjection).sort(), ["correlationId", "createdAt", "error", "id", "previewId", "progressStage", "status", "updatedAt"].sort());
assert.equal(runProjection.status, "reviewing");
assert.doesNotMatch(JSON.stringify(runProjection), /provider|model_private|token_private|snapshot_private|event_private|raw_private/i);

const previewRecord = {
  id: "preview_public",
  userId: USER_ID,
  runId: "run_public",
  status: "ready_for_review",
  basePlanId: "plan_private",
  basePlanVersion: 4,
  academicRevision: 2,
  proposedPlan: {
    date: "2026-08-02",
    summary: "A focused plan for today.",
    items: [{ id: "task_private", title: "Review algebra", duration_minutes: 30, priority: "high", study_status: "not_started" }],
  },
  backendDiff: [{
    changeType: "task_added",
    taskId: "task_private",
    topicId: "topic_private",
    courseId: "course_private",
    before: null,
    after: { id: "task_private", title: "Review algebra", duration_minutes: 30, priority: "high", evidenceIds: ["evidence_private"] },
    reasonCode: "PRIVATE_REASON",
    explanation: "Mapped assessment evidence supports a short review.",
    supportingEvidenceIds: ["evidence_private"],
  }],
  affectedTopicIds: ["topic_private"],
  affectedCourseIds: ["course_private"],
  evidenceIds: ["evidence_private"],
  expiresAt: "2026-08-03T10:00:00.000Z",
  createdAt: NOW,
  updatedAt: NOW,
};
projectionState.recoveryPreviews = [previewRecord];
const beforeReadProjection = JSON.stringify(projectionState);
const previewProjection = publicRecoveryPreview(previewRecord, projectionState, new Date(NOW));
assert.equal(previewProjection.status, "ready_for_review");
assert.equal(previewProjection.applyAvailable, true);
assert.equal(previewProjection.changes.added.length, 1);
assert.equal(previewProjection.evidenceSummary.supportingItemCount, 1);
assert.equal(JSON.stringify(projectionState), beforeReadProjection, "public Recovery projection mutated state during a read");
assert.doesNotMatch(JSON.stringify(previewProjection), /plan_private|task_private|topic_private|course_private|evidence_private|PRIVATE_REASON|provider|prompt|lease|snapshot|token/i);

const expiredProjection = publicRecoveryPreview({ ...previewRecord, expiresAt: "2026-08-01T10:00:00.000Z" }, projectionState, new Date(NOW));
assert.equal(expiredProjection.status, "expired");
assert.equal(expiredProjection.applyAvailable, false);
const supersededProjection = publicRecoveryPreview({ ...previewRecord, academicRevision: 1 }, projectionState, new Date(NOW));
assert.equal(supersededProjection.status, "superseded");
assert.equal(supersededProjection.rejectAvailable, false);

const session = { authenticated: true, user: { id: USER_ID } };
const repository = { saveRecoveryChanges: async () => ({ persisted: true }) };
const rejectionPlan = { date: "2026-08-02", items: [{ id: "current_task", title: "Current task" }] };
const rejectionState = {
  studentProfile: { id: USER_ID, dailyTodoPlan: structuredClone(rejectionPlan) },
  recoveryRuns: [{ id: "run_reject", userId: USER_ID, status: "ready_for_review" }],
  recoveryPreviews: [{ id: "preview_reject", runId: "run_reject", userId: USER_ID, status: "ready_for_review", expiresAt: "2026-08-03T10:00:00.000Z" }],
};
const firstReject = await rejectRecoveryPreview({ repository, session, state: rejectionState, previewId: "preview_reject", idempotencyKey: "reject-once", config: ENABLED_CONFIG, now: new Date(NOW) });
const replayReject = await rejectRecoveryPreview({ repository, session, state: rejectionState, previewId: "preview_reject", idempotencyKey: "reject-once", config: ENABLED_CONFIG, now: new Date(NOW) });
assert.equal(firstReject.replayed, false);
assert.equal(replayReject.replayed, true);
assert.deepEqual(rejectionState.studentProfile.dailyTodoPlan, rejectionPlan);

for (const [id, previewStatus, expiresAt] of [
  ["preview_expired", "ready_for_review", "2026-08-01T10:00:00.000Z"],
  ["preview_superseded", "superseded", "2026-08-03T10:00:00.000Z"],
]) {
  const state = {
    recoveryRuns: [{ id: `run_${id}`, userId: USER_ID, status: previewStatus }],
    recoveryPreviews: [{ id, runId: `run_${id}`, userId: USER_ID, status: previewStatus, expiresAt }],
  };
  await assert.rejects(
    rejectRecoveryPreview({ repository, session, state, previewId: id, idempotencyKey: `reject-${id}`, config: ENABLED_CONFIG, now: new Date(NOW) }),
    (error) => error?.code === RECOVERY_FAILURES.PREVIEW_STALE,
  );
}

const publicWorkspace = createPublicStudentWorkspaceDTO({
  studentProfile: { id: USER_ID },
  planAccess: { capabilities: getPublicProductCapabilities(activePlanState("plus"), { recoveryConfig: ENABLED_CONFIG }) },
});
assert.equal(publicWorkspace.planAccess.capabilities.recovery.status, "available");
for (const key of FORBIDDEN_PUBLIC_WORKSPACE_KEYS) assert.equal(Object.hasOwn(publicWorkspace, key), false, key);
assert(!STATE_SCOPE_COLLECTIONS.recovery.includes("sourceChunks"));
assert(!STATE_SCOPE_COLLECTIONS.recovery.includes("embeddingsMetadata"));
assert(!STATE_SCOPE_COLLECTIONS.recovery.includes("aiMessages"));
assert(STATE_SCOPE_COLLECTIONS.recovery.includes("recoveryRuns"));
assert(STATE_SCOPE_COLLECTIONS.recovery.includes("recoveryPreviews"));

for (const planId of ALL_PLAN_KEYS) {
  const summary = getPublicEntitlementSummary(planId);
  assert.equal(summary.assignmentWritebackEnabled, false, planId);
  for (const action of ["writeback", "assignment_submission", "automatic_assignment_submission", "hidden_submission", "turn_in"]) {
    assert.equal(canUseClassroomAction(planId, action), false, `${planId}:${action}`);
  }
}

const serverSource = await readFile(new URL("./server.js", import.meta.url), "utf8");
const recoveryRouteSource = serverSource.slice(serverSource.indexOf('url.pathname === "/api/recovery/analyze"'), serverSource.indexOf('url.pathname === "/api/health"'));
assert.equal((recoveryRouteSource.match(/assertRecoveryRouteAccess\(/g) || []).length, 5);
assert.match(recoveryRouteSource, /enforceRateLimit\(req, session, "ai_call"\)/);
assert.match(recoveryRouteSource, /requireOwnedRecoveryRun/);
assert.match(recoveryRouteSource, /requireOwnedRecoveryPreview/);
assert.doesNotMatch(recoveryRouteSource, /loadState\(|loadDashboardState\(|loadAcademicContext\(/);

const example = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const template = await readFile(new URL("../.env.template", import.meta.url), "utf8");
for (const content of [example, template]) {
  assert.match(content, /^STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false$/m);
  assert.match(content, /^STUDENTOS_RECOVERY_UI_ENABLED=false$/m);
  assert.match(content, /^STUDENTOS_RECOVERY_ROLLOUT_MODE=off$/m);
  assert.match(content, /^STUDENTOS_RECOVERY_ROLLOUT_USER_IDS=$/m);
  assert.doesNotMatch(content, /^STUDENTOS_(?:ADAPTIVE_RECOVERY|RECOVERY_UI)_ENABLED=true$/m);
}

const azureWorkflow = await readFile(new URL("../.github/workflows/azure-container-apps-studentos.yml", import.meta.url), "utf8");
assert.doesNotMatch(azureWorkflow, /enable_adaptive_recovery:/, "Deployment workflow must not double as a Recovery rollout control");
assert.match(azureWorkflow, /STUDENTOS_ADAPTIVE_RECOVERY_ENABLED:\s*['"]false['"]/);
assert.match(azureWorkflow, /STUDENTOS_RECOVERY_UI_ENABLED:\s*['"]false['"]/);
assert.match(azureWorkflow, /STUDENTOS_RECOVERY_ROLLOUT_MODE:\s*['"]off['"]/);
assert.doesNotMatch(azureWorkflow, /STUDENTOS_(?:ADAPTIVE_RECOVERY|RECOVERY_UI)_ENABLED=true\b/i);

console.log("PASS | PASS 37.1 Recovery launch authorization, projection, idempotency, and default-off checks passed");
