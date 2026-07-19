import { ensureLifecycleState, recordLifecycleAudit } from "./lifecycleService.js";
import { recordDeletionDryRunHistory } from "./operatorReviewService.js";

function nowIso(now = new Date()) {
  return now.toISOString();
}

function ids(items = []) {
  return items.map((item) => item.id).filter(Boolean);
}

function group(key, label, items = []) {
  return {
    key,
    label,
    count: items.length,
    ids: ids(items).slice(0, 100),
  };
}

export function buildDeletionDryRunReport(state, requestId, now = new Date()) {
  ensureLifecycleState(state);
  const request = state.accountDeletionRequests.find((item) => item.id === requestId);
  if (!request || request.userId !== state.studentProfile.id) {
    const error = new Error("Deletion request not found");
    error.status = 404;
    throw error;
  }
  const activeSources = (state.sourceMaterials || []).filter((item) => !item.deletedAt);
  const exportPackages = (state.dataExportRequests || []).filter((item) => item.storagePath);
  const rowGroups = [
    group("courses", "Courses", state.courses),
    group("topics", "Topics", state.topics),
    group("syllabi", "Syllabi", state.syllabi),
    group("exams", "Exams", state.exams),
    group("assignments", "Assignments", state.assignments),
    group("classroom_items", "Classroom work choices", state.classroomItems),
    group("timetable_events", "Timetable events", state.timetable),
    group("notes", "Notes", state.notes),
    group("source_materials", "Private sources", state.sourceMaterials),
    group("source_chunks", "Source sections", state.sourceChunks),
    group("memory_items", "Study records", state.memoryItems),
    group("embeddings_metadata", "Search records", state.embeddingsMetadata),
    group("test_sessions", "Test sessions", state.testSessions),
    group("test_results", "Test results", state.testResults),
    group("credit_ledger", "Credit ledger entries", state.creditLedger),
    group("roadmap_items", "Roadmap items", state.roadmap),
    group("revision_events", "Revision events", state.revisionEvents),
    group("tutor_lessons", "Tutor lessons", state.tutorLessons),
    group("assignment_automation_contracts", "Assignment automation contracts", state.assignmentAutomationContracts),
    group("ai_conversations", "AI conversations", state.aiConversations),
    group("ai_messages", "AI messages", state.aiMessages),
    group("background_jobs", "Background jobs", state.backgroundJobs),
    group("job_events", "Job events", state.jobEvents),
    group("consent_versions", "Consent versions", state.consentVersions),
    group("user_consents", "Consent records", state.userConsents),
    group("legal_acceptances", "Legal acceptances", state.legalAcceptances),
    group("data_export_requests", "Data export requests", state.dataExportRequests),
    group("data_export_jobs", "Data export jobs", state.dataExportJobs),
    group("account_deletion_requests", "Deletion requests", state.accountDeletionRequests),
    group("account_deletion_reviews", "Deletion review history", state.accountDeletionReviews),
    group("role_invitations", "Role invitation groundwork", state.roleInvitations),
    group("recovery_user_state", "Recovery engine state", state.recoveryUserStates),
    group("academic_events", "Recovery academic events", state.academicEvents),
    group("academic_state_snapshots", "Recovery academic snapshots", state.academicStateSnapshots),
    group("topic_recovery_states", "Topic recovery states", state.topicRecoveryStates),
    group("topic_recovery_state_history", "Topic recovery state history", state.topicRecoveryStateHistory),
    group("recovery_runs", "Recovery analysis runs", state.recoveryRuns),
    group("recovery_previews", "Recovery plan previews", state.recoveryPreviews),
    group("plan_versions", "Recovery plan versions", state.planVersions),
  ];
  const storageObjects = [
    ...activeSources
      .filter((item) => item.storagePath)
      .map((item) => ({
        kind: "private_source_material",
        sourceId: item.id,
        title: item.title,
      })),
    ...exportPackages.map((item) => ({
      kind: "private_export_package",
      exportRequestId: item.id,
      title: "StudentOS data export",
    })),
  ];
  const report = {
    requestId: request.id,
    generatedAt: nowIso(now),
    gracePeriodEndsAt: request.gracePeriodEndsAt,
    destructiveActionExecuted: false,
    finalDeletionEnabled: false,
    summary: {
      databaseRows: rowGroups.reduce((sum, item) => sum + item.count, 0),
      storageObjects: storageObjects.length,
      sourceChunks: (state.sourceChunks || []).length,
      memoryItems: (state.memoryItems || []).length,
      embeddingMetadata: (state.embeddingsMetadata || []).length,
      backgroundJobs: (state.backgroundJobs || []).length,
      exportPackages: exportPackages.length,
    },
    rowGroups,
    storageObjects,
    billingReviewRequired: (state.billingSubscriptions || []).length > 0,
    authProjectDeletionRequired: true,
    notes: [
      "This is a read-only preview. No rows or files were deleted.",
      "Final deletion remains disabled until an internal launch review.",
      "Storage paths, external account references, and internal records are intentionally hidden.",
    ],
  };
  recordDeletionDryRunHistory(state, request, report, now);
  request.dryRunGeneratedAt = report.generatedAt;
  request.dryRunReport = report;
  request.updatedAt = report.generatedAt;
  recordLifecycleAudit(state, {
    action: "account.deletion.dry_run_generated",
    targetType: "account_deletion_request",
    targetId: request.id,
    riskLevel: "high",
    metadata: {
      databaseRows: report.summary.databaseRows,
      storageObjects: report.summary.storageObjects,
      destructiveActionExecuted: false,
    },
    now,
  });
  return report;
}
