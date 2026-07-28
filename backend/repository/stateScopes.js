export const STATE_SCOPE_NAMES = Object.freeze({
  DASHBOARD: "dashboard",
  ACADEMIC_CONTEXT: "academic_context",
  TEST_SESSION: "test_session",
  ACCOUNT_LIFECYCLE: "account_lifecycle",
  RECOVERY: "recovery",
  AI: "ai",
  FULL: "full",
});

const DASHBOARD_COLLECTIONS = Object.freeze([
  "courses",
  "topics",
  "syllabi",
  "exams",
  "assignments",
  "timetable",
  "notes",
  "sourceMaterials",
  "testSessions",
  "testResults",
  "creditLedger",
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "assignmentAutomationContracts",
  "memoryItems",
  "backgroundJobs",
  "billingSubscriptions",
  "dataExportRequests",
  "dataExportJobs",
  "accountDeletionRequests",
  "classroomItems",
]);

const ACADEMIC_CONTEXT_COLLECTIONS = Object.freeze([
  "courses",
  "topics",
  "syllabi",
  "exams",
  "assignments",
  "timetable",
  "notes",
  "sourceMaterials",
  "sourceChunks",
  "testSessions",
  "testResults",
  "creditLedger",
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "assignmentAutomationContracts",
  "memoryItems",
  "embeddingsMetadata",
  "backgroundJobs",
  "jobEvents",
  "billingSubscriptions",
  "classroomItems",
]);

const TEST_SESSION_COLLECTIONS = Object.freeze([
  "courses",
  "topics",
  "assignments",
  "testSessions",
  "testResults",
  "creditLedger",
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "assignmentAutomationContracts",
  "auditLog",
]);

const ACCOUNT_LIFECYCLE_COLLECTIONS = Object.freeze([
  "billingSubscriptions",
  "billingWebhookEvents",
  "consentVersions",
  "userConsents",
  "legalAcceptances",
  "dataExportRequests",
  "dataExportJobs",
  "accountDeletionRequests",
  "accountDeletionReviews",
  "roleInvitations",
  "auditLog",
]);

const RECOVERY_COLLECTIONS = Object.freeze([
  "courses",
  "topics",
  "assignments",
  "timetable",
  "notes",
  "sourceMaterials",
  "testSessions",
  "testResults",
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "backgroundJobs",
  "auditLog",
  "recoveryUserStates",
  "academicEvents",
  "academicStateSnapshots",
  "topicRecoveryStates",
  "topicRecoveryStateHistory",
  "recoveryRuns",
  "recoveryPreviews",
  "planVersions",
]);

const AI_COLLECTIONS = Object.freeze([
  "courses",
  "topics",
  "assignments",
  "sourceMaterials",
  "sourceChunks",
  "testResults",
  "creditLedger",
  "roadmap",
  "memoryItems",
  "embeddingsMetadata",
  "billingSubscriptions",
  "classroomItems",
  "aiConversations",
  "aiMessages",
]);

export const STATE_SCOPE_COLLECTIONS = Object.freeze({
  [STATE_SCOPE_NAMES.DASHBOARD]: DASHBOARD_COLLECTIONS,
  [STATE_SCOPE_NAMES.ACADEMIC_CONTEXT]: ACADEMIC_CONTEXT_COLLECTIONS,
  [STATE_SCOPE_NAMES.TEST_SESSION]: TEST_SESSION_COLLECTIONS,
  [STATE_SCOPE_NAMES.ACCOUNT_LIFECYCLE]: ACCOUNT_LIFECYCLE_COLLECTIONS,
  [STATE_SCOPE_NAMES.RECOVERY]: RECOVERY_COLLECTIONS,
  [STATE_SCOPE_NAMES.AI]: AI_COLLECTIONS,
});

export function normalizeStateScope(scope) {
  const normalized = String(scope || STATE_SCOPE_NAMES.DASHBOARD).trim().toLowerCase();
  if (normalized === STATE_SCOPE_NAMES.FULL) return STATE_SCOPE_NAMES.FULL;
  return Object.prototype.hasOwnProperty.call(STATE_SCOPE_COLLECTIONS, normalized)
    ? normalized
    : STATE_SCOPE_NAMES.DASHBOARD;
}

export function collectionKeysForScope(scope, allCollectionKeys = []) {
  const normalized = normalizeStateScope(scope);
  if (normalized === STATE_SCOPE_NAMES.FULL) return [...allCollectionKeys];
  const allowed = new Set(allCollectionKeys);
  return (STATE_SCOPE_COLLECTIONS[normalized] || []).filter((key) => allowed.has(key));
}
