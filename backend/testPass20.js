import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import { createDeletionWorkflow, ensureLifecycleState, getAccountLifecycleConfig } from "./account/lifecycleService.js";
import { buildDeletionDryRunReport } from "./account/deletionDryRunService.js";
import { recordDeletionApprovalScaffold } from "./account/operatorReviewService.js";
import {
  executeFinalDeletion,
  getFinalDeletionSafetyConfig,
  getPublicFinalDeletionSafetyStatus,
  prepareFinalDeletionExecution,
} from "./account/deletionExecutionService.js";
import { validateProductionReadiness } from "./config/saasConfig.js";

const requestNow = new Date("2026-05-01T00:00:00.000Z");
const executeNow = new Date("2026-06-01T00:00:00.000Z");
const lifecycleConfig = getAccountLifecycleConfig({});
const safeEnabledConfig = {
  ...getFinalDeletionSafetyConfig({}),
  internalOpsEnabled: true,
  finalDeletionEnabled: true,
  authAdminDeleteEnabled: true,
  dualControlRequired: true,
  evidenceRequired: true,
  requiredApprovals: 2,
  largeDiffRowThreshold: 25,
  allowBillingMarkOnly: false,
};

function deletionState() {
  const state = createSeedState(requestNow);
  ensureLifecycleState(state);
  state.sourceMaterials.push({
    id: "source_delete_boundary",
    title: "Private source",
    storageBucket: "private-source-bucket",
    storagePath: `${state.studentProfile.id}/course/source/material.pdf`,
    extractedText: "raw private extracted content must never enter evidence",
  });
  state.dataExportRequests.push({
    id: "export_delete_boundary",
    userId: state.studentProfile.id,
    storageBucket: "private-export-bucket",
    storagePath: `${state.studentProfile.id}/exports/export_delete_boundary/studentos-export.json`,
  });
  const request = createDeletionWorkflow(state, {}, lifecycleConfig, requestNow);
  buildDeletionDryRunReport(state, request.id, requestNow);
  return { state, request };
}

function approveTwice(state, request) {
  recordDeletionApprovalScaffold(state, request.id, {
    operatorId: "operator_alpha",
    note: "Reviewed the dry run and deletion scope.",
  }, requestNow);
  recordDeletionApprovalScaffold(state, request.id, {
    operatorId: "operator_beta",
    note: "Second independent approval after scope review.",
  }, requestNow);
}

const defaultConfig = getFinalDeletionSafetyConfig({});
assert.equal(defaultConfig.finalDeletionEnabled, false);
assert.equal(defaultConfig.authAdminDeleteEnabled, false);
assert.equal(defaultConfig.requiredApprovals, 2);
assert.equal(getPublicFinalDeletionSafetyStatus(defaultConfig).disabledByDefault, true);

const selfApproval = deletionState();
assert.throws(() => recordDeletionApprovalScaffold(selfApproval.state, selfApproval.request.id, {
  operatorId: selfApproval.state.studentProfile.id,
  note: "The target user must not self-approve.",
}), /cannot approve/);

const oneApproval = deletionState();
recordDeletionApprovalScaffold(oneApproval.state, oneApproval.request.id, {
  operatorId: "operator_alpha",
  note: "First review completed with a clear operator note.",
});
assert.throws(() => recordDeletionApprovalScaffold(oneApproval.state, oneApproval.request.id, {
  operatorId: "operator_alpha",
  note: "Duplicate approval must not count twice.",
}), /already approved/);
const oneApprovalPlan = prepareFinalDeletionExecution({
  state: oneApproval.state,
  requestId: oneApproval.request.id,
  operatorId: "operator_executor",
  config: safeEnabledConfig,
  now: executeNow,
});
assert(oneApprovalPlan.blockers.includes("two_distinct_operator_approvals_required"));

const disabled = deletionState();
approveTwice(disabled.state, disabled.request);
const blockedEvidence = [];
const disabledResult = await executeFinalDeletion({
  state: disabled.state,
  requestId: disabled.request.id,
  operatorId: "operator_executor",
  config: defaultConfig,
  repository: {
    insertDeletionExecutionEvidence: async (_session, evidence) => blockedEvidence.push(evidence),
  },
  session: { user: { id: disabled.state.studentProfile.id } },
  now: executeNow,
});
assert.equal(disabledResult.executed, false);
assert(disabledResult.blockers.includes("final_deletion_disabled"));
assert.equal(blockedEvidence[0].evidenceType, "blocked_attempt");

const largeDiff = deletionState();
approveTwice(largeDiff.state, largeDiff.request);
largeDiff.state.notes.push(...Array.from({ length: 30 }, (_, index) => ({
  id: `late_note_${index}`,
  title: `Late note ${index}`,
})));
const largeDiffPlan = prepareFinalDeletionExecution({
  state: largeDiff.state,
  requestId: largeDiff.request.id,
  operatorId: "operator_executor",
  config: { ...safeEnabledConfig, largeDiffRowThreshold: 5 },
  now: executeNow,
});
assert.equal(largeDiffPlan.unexpectedlyLargeDiff, true);
assert(largeDiffPlan.blockers.includes("large_dry_run_diff_requires_acknowledgement"));

const executable = deletionState();
approveTwice(executable.state, executable.request);
const persistedEvidence = [];
let deletionPlan = null;
let authDeletedUserId = null;
const result = await executeFinalDeletion({
  state: executable.state,
  requestId: executable.request.id,
  operatorId: "operator_executor",
  acknowledgeLargeDiff: true,
  config: safeEnabledConfig,
  repository: {
    insertDeletionExecutionEvidence: async (_session, evidence) => persistedEvidence.push(evidence),
    executeFinalAccountDeletion: async (_session, plan) => {
      deletionPlan = plan;
      return { deleted: true, storageApiCleanupExecuted: true };
    },
  },
  session: { user: { id: executable.state.studentProfile.id } },
  authClient: {
    adminDeleteUser: async (userId) => {
      authDeletedUserId = userId;
      return { deleted: true };
    },
  },
  now: executeNow,
});
assert.equal(result.executed, true);
assert.equal(deletionPlan.sourceObjects.length, 1);
assert.equal(deletionPlan.exportObjects.length, 1);
assert.equal(authDeletedUserId, executable.state.studentProfile.id);
assert.equal(persistedEvidence.length, 2);
assert.equal(persistedEvidence[0].evidenceType, "execution_started");
assert.equal(persistedEvidence[1].evidenceType, "execution_completed");
const evidenceText = JSON.stringify(persistedEvidence);
assert.equal(evidenceText.includes("raw private extracted content"), false);
assert.equal(evidenceText.includes("/course/source/material.pdf"), false);
assert.equal(evidenceText.includes("private-source-bucket"), false);

const productionEnv = {
  STUDENTOS_ENV: "production",
  STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED: "true",
};
const preflight = validateProductionReadiness({
  env: productionEnv,
  supabaseConfig: {
    mode: "supabase",
    authConfigured: true,
    shardsConfigured: true,
    jwtSecretPresent: true,
    auth: { url: "https://auth.example" },
    shards: [
      { url: "https://shard-1.example", serviceRoleKey: "key-1" },
      { url: "https://shard-2.example", serviceRoleKey: "key-2" },
      { url: "https://shard-3.example", serviceRoleKey: "key-3" },
    ],
  },
  saasConfig: {
    deployment: "production",
    rateLimit: { enabled: true },
    quotas: { enforcementEnabled: true },
    demoSeedEnabled: false,
    billing: { provider: { provider: "none" }, paymentIntegrationEnabled: false },
  },
});
assert(preflight.errors.includes("production_final_deletion_requires_internal_ops"));
assert(preflight.errors.includes("production_final_deletion_requires_auth_admin_delete_boundary"));
assert(preflight.warnings.includes("production_final_deletion_launch_review_required"));

const operatorJs = await readFile(new URL("../frontend/scripts/operator.js", import.meta.url), "utf8");
const operatorHtml = await readFile(new URL("../frontend/operator.html", import.meta.url), "utf8");
for (const frontend of [operatorJs, operatorHtml]) {
  assert.equal(frontend.includes("adminDeleteUser"), false);
  assert.equal(frontend.includes("service_role"), false);
}
assert(operatorJs.includes("/api/internal/operator/session"));
assert(operatorJs.includes("Authorization: `Bearer ${operatorSession.token}`"));
assert(operatorJs.includes("/execute?userId="));

console.log("PASS | StudentOS Pass 20 final deletion safety architecture tests passed");
