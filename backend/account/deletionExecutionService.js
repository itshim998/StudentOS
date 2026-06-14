import { buildDeletionDryRunReport } from "./deletionDryRunService.js";
import { ensureLifecycleState, recordLifecycleAudit } from "./lifecycleService.js";

function nowIso(now = new Date()) {
  return now.toISOString();
}

function evidenceId(prefix, now = new Date()) {
  return `${prefix}_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

function readBool(env, key, fallback = false) {
  const value = readValue(env, key);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readInt(env, key, fallback) {
  const raw = readValue(env, key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function safeText(value, fallback = "", maxLength = 180) {
  return String(value || fallback).trim().slice(0, maxLength);
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = item?.[key];
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function getFinalDeletionSafetyConfig(env = process.env) {
  return {
    internalOpsEnabled: readBool(env, "STUDENTOS_INTERNAL_OPS_ENABLED", false),
    finalDeletionEnabled: readBool(env, "STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED", false),
    authAdminDeleteEnabled: readBool(env, "STUDENTOS_AUTH_ADMIN_DELETE_ENABLED", false),
    dualControlRequired: readBool(env, "STUDENTOS_DELETION_DUAL_CONTROL_REQUIRED", true),
    evidenceRequired: readBool(env, "STUDENTOS_DELETION_EVIDENCE_ENABLED", true),
    requiredApprovals: Math.max(2, readInt(env, "STUDENTOS_DELETION_REQUIRED_APPROVALS", 2)),
    largeDiffRowThreshold: Math.max(1, readInt(env, "STUDENTOS_DELETION_DIFF_MAX_ROW_CHANGE", 25)),
    allowBillingMarkOnly: readBool(env, "STUDENTOS_DELETION_ALLOW_BILLING_MARK_ONLY", false),
  };
}

export function getPublicFinalDeletionSafetyStatus(config = getFinalDeletionSafetyConfig()) {
  return {
    finalDeletionEnabled: config.finalDeletionEnabled,
    internalOpsRequired: true,
    authAdminDeleteEnabled: config.authAdminDeleteEnabled,
    dualControlRequired: config.dualControlRequired,
    evidenceRequired: config.evidenceRequired,
    requiredApprovals: config.requiredApprovals,
    largeDiffRowThreshold: config.largeDiffRowThreshold,
    billingPolicy: config.allowBillingMarkOnly ? "mark_only_allowed" : "provider_cancellation_required",
    disabledByDefault: true,
    secretsExposed: false,
  };
}

export function getDistinctDeletionApprovals(state, requestId) {
  ensureLifecycleState(state);
  return uniqueBy(
    state.accountDeletionReviews
      .filter((review) => review.deletionRequestId === requestId && review.decision === "approve_scaffold")
      .sort((left, right) => Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "")),
    "operatorId",
  );
}

export function isUnexpectedlyLargeDeletionDiff(diff = {}, config = getFinalDeletionSafetyConfig()) {
  if (diff.baseline) return false;
  return Object.values(diff.summaryDelta || {})
    .some((value) => Math.abs(Number(value || 0)) > config.largeDiffRowThreshold);
}

function buildBillingPolicy(state, config, cancellation = null) {
  const active = (state.billingSubscriptions || []).filter((subscription) =>
    ["active", "trialing", "past_due"].includes(subscription.status));
  const fallback = {
    activeSubscriptionCount: active.length,
    policy: active.length ? "provider_cancellation_review_required" : "no_active_subscription",
    providerCancellationExecuted: false,
    markOnlyAllowed: config.allowBillingMarkOnly,
    blocksExecution: active.length > 0 && !config.allowBillingMarkOnly,
  };
  return cancellation
    ? {
        ...fallback,
        ...cancellation,
        blocksExecution: cancellation.blocksExecution === true,
      }
    : fallback;
}

function buildAuthDeletionPlan(userId, config) {
  return {
    userId,
    serverSideOnly: true,
    adminBoundaryPrepared: true,
    adminDeleteEnabled: config.authAdminDeleteEnabled,
    authDeleteExecuted: false,
    frontendAllowed: false,
  };
}

function storagePlan(state) {
  return {
    sourceObjects: (state.sourceMaterials || [])
      .filter((item) => item.storageBucket && item.storagePath)
      .map((item) => ({ bucket: item.storageBucket, path: item.storagePath })),
    exportObjects: (state.dataExportRequests || [])
      .filter((item) => item.storageBucket && item.storagePath)
      .map((item) => ({ bucket: item.storageBucket, path: item.storagePath })),
  };
}

function safeApproval(approval) {
  return {
    id: approval.id,
    operatorId: approval.operatorId,
    decision: approval.decision,
    createdAt: approval.createdAt,
    operatorNoteRecorded: Boolean(approval.operatorNote),
  };
}

function createEvidence({
  state,
  request,
  type,
  status,
  approvals,
  dryRun,
  billingPolicy,
  authDeletion,
  metadata = {},
  now = new Date(),
}) {
  return {
    id: evidenceId(`deletion_evidence_${type}`, now),
    userId: state.studentProfile.id,
    deletionRequestId: request.id,
    evidenceType: type,
    status,
    approvals: approvals.map(safeApproval),
    dryRunReport: dryRun,
    dryRunDiff: dryRun.diff || {},
    affectedCounts: dryRun.summary || {},
    billingPolicy,
    authDeletion,
    metadata: {
      ...metadata,
      rawExtractedContentIncluded: false,
      storagePathsIncluded: false,
      secretsIncluded: false,
    },
    createdAt: nowIso(now),
  };
}

export function prepareFinalDeletionExecution({
  state,
  requestId,
  operatorId,
  acknowledgeLargeDiff = false,
  billingCancellation = null,
  config = getFinalDeletionSafetyConfig(),
  now = new Date(),
} = {}) {
  ensureLifecycleState(state);
  const request = state.accountDeletionRequests.find((item) => item.id === requestId);
  if (!request || request.userId !== state.studentProfile.id) {
    const error = new Error("Deletion request not found");
    error.status = 404;
    throw error;
  }
  const executorId = safeText(operatorId);
  const dryRun = buildDeletionDryRunReport(state, requestId, now);
  const approvals = getDistinctDeletionApprovals(state, requestId);
  const billingPolicy = buildBillingPolicy(state, config, billingCancellation);
  const authDeletion = buildAuthDeletionPlan(state.studentProfile.id, config);
  const unexpectedlyLargeDiff = isUnexpectedlyLargeDeletionDiff(dryRun.diff, config);
  const blockers = [];
  if (!config.internalOpsEnabled) blockers.push("internal_ops_disabled");
  if (!config.finalDeletionEnabled) blockers.push("final_deletion_disabled");
  if (!config.dualControlRequired) blockers.push("dual_control_safeguard_disabled");
  if (!config.evidenceRequired) blockers.push("immutable_evidence_safeguard_disabled");
  if (!config.authAdminDeleteEnabled) blockers.push("auth_admin_delete_disabled");
  if (!executorId) blockers.push("executor_operator_id_required");
  if (executorId === request.userId) blockers.push("target_user_cannot_execute_own_deletion");
  if (approvals.length < config.requiredApprovals) blockers.push("two_distinct_operator_approvals_required");
  if (Date.parse(request.gracePeriodEndsAt || "") > now.getTime()) blockers.push("deletion_grace_period_active");
  if (unexpectedlyLargeDiff && !acknowledgeLargeDiff) blockers.push("large_dry_run_diff_requires_acknowledgement");
  if (billingPolicy.blocksExecution) blockers.push("billing_provider_cancellation_review_required");
  return {
    authorized: blockers.length === 0,
    blockers,
    request,
    approvals,
    dryRun,
    unexpectedlyLargeDiff,
    largeDiffAcknowledged: Boolean(acknowledgeLargeDiff),
    billingPolicy,
    authDeletion,
    storage: storagePlan(state),
  };
}

export async function executeFinalDeletion({
  state,
  requestId,
  operatorId,
  acknowledgeLargeDiff = false,
  billingCancellation = null,
  config = getFinalDeletionSafetyConfig(),
  repository,
  session,
  authClient,
  now = new Date(),
} = {}) {
  const preparation = prepareFinalDeletionExecution({
    state,
    requestId,
    operatorId,
    acknowledgeLargeDiff,
    billingCancellation,
    config,
    now,
  });
  const { request, approvals, dryRun, billingPolicy, authDeletion } = preparation;
  if (!repository?.insertDeletionExecutionEvidence) throw new Error("deletion_evidence_repository_unavailable");
  if (!preparation.authorized) {
    request.finalExecutionStatus = "blocked";
    request.updatedAt = nowIso(now);
    const evidence = createEvidence({
      state,
      request,
      type: "blocked_attempt",
      status: "blocked",
      approvals,
      dryRun,
      billingPolicy,
      authDeletion,
      metadata: { blockers: preparation.blockers },
      now,
    });
    request.lastExecutionEvidenceId = evidence.id;
    await repository.insertDeletionExecutionEvidence(session, evidence);
    recordLifecycleAudit(state, {
      action: "account.deletion.execution_blocked",
      targetType: "account_deletion_request",
      targetId: request.id,
      riskLevel: "high",
      metadata: { blockers: preparation.blockers, evidenceId: evidence.id },
      now,
    });
    return { ...preparation, evidence, executed: false };
  }

  request.finalExecutionStatus = "authorized";
  request.updatedAt = nowIso(now);
  const startedEvidence = createEvidence({
    state,
    request,
    type: "execution_started",
    status: "authorized",
    approvals,
    dryRun,
    billingPolicy,
    authDeletion,
    metadata: { largeDiffAcknowledged: preparation.largeDiffAcknowledged },
    now,
  });
  request.lastExecutionEvidenceId = startedEvidence.id;
  await repository.insertDeletionExecutionEvidence(session, startedEvidence);
  try {
    await repository.executeFinalAccountDeletion(session, {
      userId: state.studentProfile.id,
      sourceObjects: preparation.storage.sourceObjects,
      exportObjects: preparation.storage.exportObjects,
    });
    if (!authClient?.adminDeleteUser) throw new Error("auth_admin_delete_boundary_unavailable");
    await authClient.adminDeleteUser(state.studentProfile.id);
    const completedAt = new Date();
    const completedEvidence = createEvidence({
      state,
      request,
      type: "execution_completed",
      status: "completed",
      approvals,
      dryRun,
      billingPolicy,
      authDeletion: { ...authDeletion, authDeleteExecuted: true },
      metadata: { dataShardCleanupExecuted: true, storageApiCleanupExecuted: true },
      now: completedAt,
    });
    await repository.insertDeletionExecutionEvidence(session, completedEvidence);
    return {
      ...preparation,
      evidence: completedEvidence,
      executed: true,
      authDeletion: completedEvidence.authDeletion,
    };
  } catch (error) {
    const failedAt = new Date();
    const failureEvidence = createEvidence({
      state,
      request,
      type: "partial_failure",
      status: "partial_failure",
      approvals,
      dryRun,
      billingPolicy,
      authDeletion,
      metadata: { failure: safeText(error?.message || error, "deletion_execution_failed") },
      now: failedAt,
    });
    await repository.insertDeletionExecutionEvidence(session, failureEvidence);
    error.deletionEvidence = failureEvidence;
    throw error;
  }
}
