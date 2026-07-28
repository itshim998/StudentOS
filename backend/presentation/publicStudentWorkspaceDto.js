export const PUBLIC_STUDENT_WORKSPACE_KEYS = Object.freeze([
  "studentProfile",
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
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "assignmentAutomationContracts",
  "assignmentLearningFlows",
  "memoryItems",
  "embeddingsMetadata",
  "backgroundJobs",
  "jobEvents",
  "auditLog",
  "billingSubscriptions",
  "billingWebhookEvents",
  "dataExportRequests",
  "dataExportJobs",
  "accountDeletionRequests",
  "accountDeletionReviews",
  "classroomItems",
  "creditBalance",
  "assignmentInsights",
  "todayNextActions",
  "academicContext",
  "todayPlan",
  "classroomDueWork",
  "todayDoNow",
  "queueHealth",
  "embeddingProcessing",
  "persistence",
  "productLifecycle",
  "planAccess",
  "saas",
  "storagePlan",
  "internalMetricsHidden",
]);

export const FORBIDDEN_PUBLIC_WORKSPACE_KEYS = Object.freeze([
  "aiConversations",
  "aiMessages",
  "creditLedger",
  "consentVersions",
  "userConsents",
  "legalAcceptances",
  "roleInvitations",
  "recoveryUserStates",
  "academicEvents",
  "academicStateSnapshots",
  "topicRecoveryStates",
  "topicRecoveryStateHistory",
  "recoveryRuns",
  "recoveryPreviews",
  "planVersions",
]);

const ALLOWED_KEYS = new Set(PUBLIC_STUDENT_WORKSPACE_KEYS);
const FORBIDDEN_KEYS = new Set(FORBIDDEN_PUBLIC_WORKSPACE_KEYS);

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function publicDtoError(code, keys = []) {
  const suffix = keys.length ? `: ${keys.join(", ")}` : "";
  const error = new Error(`${code}${suffix}`);
  error.code = code;
  error.status = 500;
  error.keys = keys;
  return error;
}

export function assertPublicStudentWorkspaceDTO(value) {
  if (!isPlainRecord(value)) throw publicDtoError("PUBLIC_WORKSPACE_DTO_INVALID");
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !ALLOWED_KEYS.has(key));
  if (unknown.length) throw publicDtoError("PUBLIC_WORKSPACE_DTO_UNKNOWN_KEYS", unknown);
  const forbidden = keys.filter((key) => FORBIDDEN_KEYS.has(key));
  if (forbidden.length) throw publicDtoError("PUBLIC_WORKSPACE_DTO_FORBIDDEN_KEYS", forbidden);
  return value;
}

export function createPublicStudentWorkspaceDTO(fields = {}) {
  assertPublicStudentWorkspaceDTO(fields);
  const dto = {};
  for (const key of PUBLIC_STUDENT_WORKSPACE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) dto[key] = fields[key];
  }
  return Object.freeze(dto);
}
