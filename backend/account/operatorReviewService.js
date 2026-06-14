import { ensureLifecycleState, recordLifecycleAudit } from "./lifecycleService.js";

function nowIso(now = new Date()) {
  return now.toISOString();
}

function reviewId(prefix, now = new Date()) {
  return `${prefix}_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeText(value, fallback = "", maxLength = 500) {
  return String(value || fallback).trim().slice(0, maxLength);
}

function summaryDelta(previous = {}, current = {}) {
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(current || {})]);
  return Object.fromEntries([...keys].map((key) => [
    key,
    Number(current?.[key] || 0) - Number(previous?.[key] || 0),
  ]));
}

export function compareDeletionDryRuns(previousReport = null, currentReport = {}) {
  if (!previousReport) {
    return {
      baseline: true,
      changed: false,
      previousGeneratedAt: null,
      summaryDelta: summaryDelta({}, currentReport.summary),
    };
  }
  const delta = summaryDelta(previousReport.summary, currentReport.summary);
  return {
    baseline: false,
    changed: Object.values(delta).some((value) => value !== 0),
    previousGeneratedAt: previousReport.generatedAt || null,
    summaryDelta: delta,
  };
}

export function recordDeletionDryRunHistory(state, request, report, now = new Date()) {
  ensureLifecycleState(state);
  const previous = state.accountDeletionReviews
    .filter((review) => review.deletionRequestId === request.id && review.reviewType === "dry_run")
    .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""))[0];
  const diff = compareDeletionDryRuns(previous?.dryRunReport || null, report);
  report.diff = diff;
  const review = {
    id: reviewId("deletion_review_dry_run", now),
    userId: request.userId,
    deletionRequestId: request.id,
    reviewType: "dry_run",
    decision: "dry_run",
    operatorId: null,
    operatorNote: "Read-only deletion dry run generated.",
    dryRunReport: report,
    dryRunDiff: diff,
    payload: { destructiveActionExecuted: false },
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  };
  state.accountDeletionReviews.unshift(review);
  return review;
}

export function recordDeletionApprovalScaffold(state, requestId, payload = {}, now = new Date()) {
  ensureLifecycleState(state);
  const request = state.accountDeletionRequests.find((item) => item.id === requestId);
  if (!request) {
    const error = new Error("Deletion request not found");
    error.status = 404;
    throw error;
  }
  if (!request.dryRunGeneratedAt || !request.dryRunReport) {
    const error = new Error("Generate a deletion dry run before operator review");
    error.status = 409;
    throw error;
  }
  const note = safeText(payload.note);
  if (note.length < 8) {
    const error = new Error("Operator review note must contain at least 8 characters");
    error.status = 400;
    throw error;
  }
  const decision = payload.decision === "reject" ? "reject" : "approve_scaffold";
  const operatorId = safeText(payload.operatorId, "", 120);
  if (!operatorId) {
    const error = new Error("Operator identity is required");
    error.status = 400;
    throw error;
  }
  if (operatorId === request.userId) {
    const error = new Error("The target user cannot approve their own deletion");
    error.status = 403;
    throw error;
  }
  if (decision === "approve_scaffold" && state.accountDeletionReviews.some((review) =>
    review.deletionRequestId === request.id &&
    review.decision === "approve_scaffold" &&
    review.operatorId === operatorId)) {
    const error = new Error("This operator has already approved the deletion request");
    error.status = 409;
    throw error;
  }
  const review = {
    id: reviewId("deletion_review_operator", now),
    userId: request.userId,
    deletionRequestId: request.id,
    reviewType: decision === "reject" ? "rejection" : "approval",
    decision,
    operatorId,
    operatorNote: note,
    dryRunReport: request.dryRunReport,
    dryRunDiff: request.dryRunReport.diff || {},
    payload: {
      scaffoldOnly: true,
      finalDeletionExecuted: false,
      finalDeletionEnabled: false,
    },
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  };
  state.accountDeletionReviews.unshift(review);
  Object.assign(request, {
    status: decision === "reject" ? "cancelled" : "review_pending",
    reviewedAt: nowIso(now),
    finalDeleteAllowed: false,
    updatedAt: nowIso(now),
  });
  recordLifecycleAudit(state, {
    action: decision === "reject"
      ? "account.deletion.review_rejected"
      : "account.deletion.approval_scaffold_recorded",
    targetType: "account_deletion_request",
    targetId: request.id,
    riskLevel: "high",
    metadata: {
      decision,
      operatorNoteRecorded: true,
      scaffoldOnly: true,
      finalDeletionExecuted: false,
    },
    now,
  });
  return {
    request,
    review,
    scaffoldOnly: true,
    finalDeletionExecuted: false,
    finalDeletionEnabled: false,
  };
}
