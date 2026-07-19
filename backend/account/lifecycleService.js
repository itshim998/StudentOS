const CONSENT_KEYS = [
  "aiPersonalization",
  "productResearch",
  "externalProgressSharing",
  "guardianSharingFuture",
];

function nowIso(now = new Date()) {
  return now.toISOString();
}

function lifecycleId(prefix, now = new Date()) {
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

function addDays(now, days) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

function profileId(state) {
  return state.studentProfile.id;
}

function ensureAuditLog(state) {
  state.auditLog = state.auditLog || [];
  return state.auditLog;
}

export function recordLifecycleAudit(state, {
  action,
  targetType,
  targetId,
  riskLevel = "low",
  metadata = {},
  now = new Date(),
}) {
  ensureAuditLog(state).push({
    id: lifecycleId("audit_lifecycle", now),
    actorId: profileId(state),
    action,
    targetType,
    targetId,
    riskLevel,
    metadata,
    createdAt: nowIso(now),
  });
}

const recordAudit = recordLifecycleAudit;

function safeText(value, fallback = "", maxLength = 180) {
  return String(value || fallback).trim().slice(0, maxLength);
}

function pick(object, keys) {
  return Object.fromEntries(keys
    .filter((key) => object?.[key] !== undefined)
    .map((key) => [key, object[key]]));
}

export function getAccountLifecycleConfig(env = process.env) {
  return {
    privacyVersion: readValue(env, "STUDENTOS_PRIVACY_VERSION", "privacy-2026-05"),
    termsVersion: readValue(env, "STUDENTOS_TERMS_VERSION", "terms-2026-05"),
    consentSchemaVersion: readValue(env, "STUDENTOS_CONSENT_SCHEMA_VERSION", "consent-v1"),
    deletionGracePeriodDays: Math.max(1, readInt(env, "STUDENTOS_ACCOUNT_DELETION_GRACE_DAYS", 14)),
    internalOpsEnabled: readBool(env, "STUDENTOS_INTERNAL_OPS_ENABLED", false),
    internalOpsTokenConfigured: Boolean(readValue(env, "STUDENTOS_INTERNAL_OPS_TOKEN")),
    finalDeletionEnabled: readBool(env, "STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED", false),
    roleInvitationsEnabled: readBool(env, "STUDENTOS_ROLE_INVITATIONS_ENABLED", false),
    exportPipelineEnabled: true,
    activeStudentRoleOnly: true,
  };
}

export function getPublicLifecycleConfig(config = getAccountLifecycleConfig()) {
  return {
    privacyVersion: config.privacyVersion,
    termsVersion: config.termsVersion,
    consentSchemaVersion: config.consentSchemaVersion,
    deletionGracePeriodDays: config.deletionGracePeriodDays,
    exportPipelineEnabled: config.exportPipelineEnabled,
    finalDeletionEnabled: false,
    roleInvitationsEnabled: config.roleInvitationsEnabled,
    activeStudentRoleOnly: config.activeStudentRoleOnly,
    secretsExposed: false,
  };
}

export function ensureLifecycleState(state) {
  state.consentVersions = state.consentVersions || [];
  state.userConsents = state.userConsents || [];
  state.legalAcceptances = state.legalAcceptances || [];
  state.dataExportRequests = state.dataExportRequests || [];
  state.dataExportJobs = state.dataExportJobs || [];
  state.accountDeletionRequests = state.accountDeletionRequests || [];
  state.accountDeletionReviews = state.accountDeletionReviews || [];
  state.roleInvitations = state.roleInvitations || [];
  return state;
}

export function ensureCurrentConsentVersion(state, config = getAccountLifecycleConfig(), now = new Date()) {
  ensureLifecycleState(state);
  const existing = state.consentVersions.find((version) =>
    version.privacyVersion === config.privacyVersion &&
    version.termsVersion === config.termsVersion &&
    version.consentSchemaVersion === config.consentSchemaVersion &&
    version.status === "active");
  if (existing) return existing;
  for (const version of state.consentVersions) {
    if (version.status === "active") version.status = "superseded";
  }
  const version = {
    id: lifecycleId("consent_version", now),
    userId: profileId(state),
    privacyVersion: config.privacyVersion,
    termsVersion: config.termsVersion,
    consentSchemaVersion: config.consentSchemaVersion,
    status: "active",
    effectiveAt: nowIso(now),
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  };
  state.consentVersions.push(version);
  return version;
}

export function updateVersionedConsents(state, payload = {}, config = getAccountLifecycleConfig(), now = new Date()) {
  ensureLifecycleState(state);
  const version = ensureCurrentConsentVersion(state, config, now);
  const updated = {};
  for (const key of CONSENT_KEYS) {
    if (!(key in payload)) continue;
    const granted = Boolean(payload[key]);
    let consent = state.userConsents.find((item) =>
      item.consentVersionId === version.id &&
      item.consentKey === key &&
      item.status !== "superseded");
    if (!consent) {
      consent = {
        id: lifecycleId("consent", now),
        userId: profileId(state),
        consentVersionId: version.id,
        consentKey: key,
        createdAt: nowIso(now),
      };
      state.userConsents.push(consent);
    }
    Object.assign(consent, {
      granted,
      status: granted ? "granted" : "declined",
      withdrawnAt: granted ? null : consent.withdrawnAt || null,
      updatedAt: nowIso(now),
    });
    updated[key] = granted;
  }
  recordAudit(state, {
    action: "account.versioned_consents.updated",
    targetType: "consent_version",
    targetId: version.id,
    metadata: { consentSchemaVersion: version.consentSchemaVersion, keys: Object.keys(updated) },
    now,
  });
  return { version, updated };
}

export function createConsentWithdrawalRequest(state, payload = {}, config = getAccountLifecycleConfig(), now = new Date()) {
  ensureLifecycleState(state);
  const version = ensureCurrentConsentVersion(state, config, now);
  const consentKey = CONSENT_KEYS.includes(payload.consentKey) ? payload.consentKey : "externalProgressSharing";
  let consent = state.userConsents.find((item) =>
    item.consentVersionId === version.id &&
    item.consentKey === consentKey &&
    item.status !== "superseded");
  if (!consent) {
    consent = {
      id: lifecycleId("consent", now),
      userId: profileId(state),
      consentVersionId: version.id,
      consentKey,
      granted: false,
      createdAt: nowIso(now),
    };
    state.userConsents.push(consent);
  }
  Object.assign(consent, {
    granted: false,
    status: "withdrawal_requested",
    withdrawnAt: nowIso(now),
    updatedAt: nowIso(now),
  });
  recordAudit(state, {
    action: "account.consent_withdrawal.requested",
    targetType: "user_consent",
    targetId: consent.id,
    metadata: { consentKey, noAutomaticExternalAction: true },
    now,
  });
  return consent;
}

export function recordLegalAcceptance(state, payload = {}, config = getAccountLifecycleConfig(), now = new Date()) {
  ensureLifecycleState(state);
  const accepted = payload.accepted === true;
  if (!accepted) {
    const error = new Error("Terms and privacy acceptance must be explicit");
    error.status = 400;
    throw error;
  }
  const version = ensureCurrentConsentVersion(state, config, now);
  const existing = state.legalAcceptances.find((item) =>
    item.privacyVersion === version.privacyVersion &&
    item.termsVersion === version.termsVersion);
  if (existing) return existing;
  const acceptance = {
    id: lifecycleId("legal", now),
    userId: profileId(state),
    privacyVersion: version.privacyVersion,
    termsVersion: version.termsVersion,
    consentSchemaVersion: version.consentSchemaVersion,
    acceptanceSource: safeText(payload.acceptanceSource, "account_settings", 60),
    acceptedAt: nowIso(now),
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  };
  state.legalAcceptances.push(acceptance);
  recordAudit(state, {
    action: "account.legal_terms.accepted",
    targetType: "legal_acceptance",
    targetId: acceptance.id,
    metadata: {
      privacyVersion: acceptance.privacyVersion,
      termsVersion: acceptance.termsVersion,
    },
    now,
  });
  return acceptance;
}

export function createDataExportWorkflow(state, payload = {}, config = getAccountLifecycleConfig(), now = new Date()) {
  ensureLifecycleState(state);
  const request = {
    id: lifecycleId("export", now),
    userId: profileId(state),
    status: "queued",
    scope: safeText(payload.scope, "student_owned_data", 60),
    format: payload.format === "json" ? "json" : "json",
    delivery: "manual_review_required",
    requestedAt: nowIso(now),
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  };
  const job = {
    id: lifecycleId("export_job", now),
    userId: profileId(state),
    exportRequestId: request.id,
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  };
  state.dataExportRequests.unshift(request);
  state.dataExportJobs.unshift(job);
  recordAudit(state, {
    action: "account.data_export.requested",
    targetType: "data_export_request",
    targetId: request.id,
    riskLevel: "medium",
    metadata: { scope: request.scope, exportJobId: job.id, redactedExportOnly: true },
    now,
  });
  return { request, job, pipelineEnabled: config.exportPipelineEnabled };
}

export function createDeletionWorkflow(state, payload = {}, config = getAccountLifecycleConfig(), now = new Date()) {
  ensureLifecycleState(state);
  const gracePeriodEndsAt = nowIso(addDays(now, config.deletionGracePeriodDays));
  const request = {
    id: lifecycleId("delete", now),
    userId: profileId(state),
    status: "requested",
    reason: safeText(payload.reason, "student_request"),
    safety: "manual_review_no_immediate_deletion",
    requestedAt: nowIso(now),
    gracePeriodEndsAt,
    reviewedAt: null,
    finalDeleteAllowed: false,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  };
  state.accountDeletionRequests.unshift(request);
  recordAudit(state, {
    action: "account.deletion.requested",
    targetType: "account_deletion_request",
    targetId: request.id,
    riskLevel: "high",
    metadata: {
      gracePeriodEndsAt,
      manualReview: true,
      directDeletion: false,
    },
    now,
  });
  return request;
}

export function createFinalDeletionScaffold(state, requestId, config = getAccountLifecycleConfig(), now = new Date()) {
  ensureLifecycleState(state);
  const request = state.accountDeletionRequests.find((item) => item.id === requestId);
  if (!request) {
    const error = new Error("Deletion request not found");
    error.status = 404;
    throw error;
  }
  request.status = "review_pending";
  request.reviewedAt = nowIso(now);
  request.updatedAt = nowIso(now);
  request.finalDeleteAllowed = config.finalDeletionEnabled === true && Date.parse(request.gracePeriodEndsAt) <= now.getTime();
  recordAudit(state, {
    action: "account.deletion.reviewed",
    targetType: "account_deletion_request",
    targetId: request.id,
    riskLevel: "high",
    metadata: {
      finalDeleteAllowed: request.finalDeleteAllowed,
      scaffoldOnly: true,
    },
    now,
  });
  return {
    request,
    scaffoldOnly: true,
    finalDeleteExecuted: false,
  };
}

export function createRoleInvitationGroundwork(state, payload = {}, config = getAccountLifecycleConfig(), now = new Date()) {
  ensureLifecycleState(state);
  const role = ["guardian_future", "teacher_future", "institution_future"].includes(payload.role)
    ? payload.role
    : "guardian_future";
  const explicitConsent = payload.explicitStudentConsent === true;
  const invitation = {
    id: lifecycleId("role_invite", now),
    userId: profileId(state),
    inviteEmail: safeText(payload.email, "", 160).toLowerCase(),
    role,
    status: config.roleInvitationsEnabled && explicitConsent ? "requested" : "disabled",
    enabled: config.roleInvitationsEnabled && explicitConsent,
    studentConsentRequired: true,
    explicitStudentConsent: explicitConsent,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  };
  state.roleInvitations.unshift(invitation);
  recordAudit(state, {
    action: "account.role_invitation.previewed",
    targetType: "role_invitation",
    targetId: invitation.id,
    metadata: {
      role,
      enabled: invitation.enabled,
      studentConsentRequired: true,
    },
    now,
  });
  return invitation;
}

export function buildSafeExportPreview(state) {
  ensureLifecycleState(state);
  return {
    profile: pick(state.studentProfile, [
      "id", "displayName", "email", "gradeBand", "schoolSystem", "timezone",
      "studyRhythm", "visibility", "preferences",
    ]),
    courses: (state.courses || []).map((item) => pick(item, ["id", "title", "term", "examDate"])),
    topics: (state.topics || []).map((item) => pick(item, ["id", "courseId", "title", "mastery", "coverageState"])),
    exams: (state.exams || []).map((item) => pick(item, ["id", "courseId", "title", "examDate", "weight"])),
    assignments: (state.assignments || []).map((item) => pick(item, ["id", "courseId", "title", "dueDate", "status"])),
    classroomItems: (state.classroomItems || []).map((item) => pick(item, [
      "id", "itemType", "title", "courseTitle", "dueAt", "postedAt", "submissionState", "handedIn",
      "selectionState", "selectedAt", "importedAt", "academicContextIncluded", "lastSeenAt",
    ])),
    timetable: (state.timetable || []).map((item) => pick(item, ["id", "courseId", "title", "startsAt", "endsAt"])),
    notes: (state.notes || []).map((item) => pick(item, ["id", "courseId", "topicId", "title", "body"])),
    sourceMaterials: (state.sourceMaterials || []).map((item) => pick(item, [
      "id", "courseId", "title", "sourceType", "filename", "mimeType", "sizeBytes", "status", "createdAt",
    ])),
    testResults: (state.testResults || []).map((item) => pick(item, [
      "id", "courseId", "topicId", "scorePercent", "creditsAwarded", "completedAt",
    ])),
    creditLedger: (state.creditLedger || []).map((item) => pick(item, ["id", "amount", "reason", "createdAt"])),
    roadmap: (state.roadmap || []).map((item) => pick(item, [
      "id", "courseId", "topicId", "title", "kind", "priority", "dueAt", "status",
    ])),
    recovery: {
      userState: (state.recoveryUserStates || []).map((item) => pick(item, [
        "id", "academicRevision", "snapshotVersion", "planVersion", "currentSnapshotId", "currentPlanId", "updatedAt",
      ])),
      academicEvents: (state.academicEvents || []).map((item) => pick(item, [
        "id", "eventType", "sourceEntityType", "sourceEntityId", "payload", "occurredAt", "processedAt", "correlationId",
      ])),
      snapshots: (state.academicStateSnapshots || []).map((item) => pick(item, [
        "id", "version", "academicRevision", "fingerprint", "triggeringEventIds", "state", "createdAt",
      ])),
      topicStates: (state.topicRecoveryStates || []).map((item) => pick(item, [
        "id", "courseId", "topicId", "evidenceIds", "strength", "priorityScore", "priorityBand", "status", "reasons", "updatedAt",
      ])),
      topicStateHistory: (state.topicRecoveryStateHistory || []).map((item) => pick(item, [
        "id", "topicRecoveryStateId", "courseId", "topicId", "fromStatus", "toStatus", "reason", "createdAt",
      ])),
      runs: (state.recoveryRuns || []).map((item) => pick(item, [
        "id", "status", "triggerEventIds", "previousSnapshotId", "currentSnapshotId", "previewId", "failureCode", "failureMessage", "failureRetryable", "providerAttempts", "correlationId", "createdAt", "updatedAt",
      ])),
      previews: (state.recoveryPreviews || []).map((item) => pick(item, [
        "id", "runId", "status", "basePlanVersion", "basePlanId", "academicRevision", "proposedPlan", "backendDiff", "affectedRecords", "deferrals", "expiresAt", "appliedAt", "rejectedAt",
      ])),
      planVersions: (state.planVersions || []).map((item) => pick(item, [
        "id", "version", "parentPlanId", "source", "recoveryPreviewId", "dailyTodoPlan", "roadmap", "createdAt",
      ])),
    },
    consents: state.userConsents.map((item) => pick(item, [
      "id", "consentVersionId", "consentKey", "granted", "status", "withdrawnAt", "updatedAt",
    ])),
    legalAcceptances: state.legalAcceptances.map((item) => pick(item, [
      "id", "privacyVersion", "termsVersion", "consentSchemaVersion", "acceptanceSource", "acceptedAt",
    ])),
    exportPolicy: {
      internalOperationalFieldsExcluded: true,
      secretFieldsExcluded: true,
      storageReferencesExcluded: true,
      providerReferencesExcluded: true,
    },
  };
}

export function getLifecycleSnapshot(state, config = getAccountLifecycleConfig()) {
  ensureLifecycleState(state);
  const version = ensureCurrentConsentVersion(state, config);
  const currentAcceptance = state.legalAcceptances.find((item) =>
    item.privacyVersion === version.privacyVersion &&
    item.termsVersion === version.termsVersion) || null;
  const exportRequests = state.dataExportRequests.slice(0, 10).map((item) => ({
    ...pick(item, [
      "id", "status", "scope", "format", "delivery", "requestedAt", "readyAt",
      "downloadedAt", "expiresAt", "packageSizeBytes", "createdAt", "updatedAt",
      "retentionExpiresAt", "packageDeletedAt", "cleanupStatus",
    ]),
    downloadAvailable: item.status === "ready" &&
      Boolean(item.storageBucket && item.storagePath) &&
      (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()),
  }));
  const exportJobs = state.dataExportJobs.slice(0, 10).map((item) => pick(item, [
    "id", "exportRequestId", "status", "attempts", "maxAttempts", "lastError", "processedAt", "updatedAt",
  ]));
  const deletionRequests = state.accountDeletionRequests.slice(0, 10).map((item) => pick(item, [
    "id", "status", "reason", "safety", "requestedAt", "gracePeriodEndsAt", "reviewedAt",
    "finalDeleteAllowed", "dryRunGeneratedAt", "dryRunReport", "finalExecutionStatus",
    "lastExecutionEvidenceId", "createdAt", "updatedAt",
  ]));
  return {
    legal: {
      privacyVersion: version.privacyVersion,
      termsVersion: version.termsVersion,
      consentSchemaVersion: version.consentSchemaVersion,
      accepted: Boolean(currentAcceptance),
      acceptedAt: currentAcceptance?.acceptedAt || null,
    },
    consentWithdrawalRequests: state.userConsents.filter((item) => item.status === "withdrawal_requested"),
    exportRequests,
    exportJobs,
    deletionRequests,
    deletionReviewHistory: state.accountDeletionReviews.slice(0, 20).map((item) => pick(item, [
      "id", "deletionRequestId", "reviewType", "decision", "operatorNote", "dryRunDiff", "createdAt",
    ])),
    roleInvitations: state.roleInvitations.slice(0, 10).map((item) => pick(item, [
      "id", "role", "status", "enabled", "studentConsentRequired", "explicitStudentConsent", "createdAt",
    ])),
    policy: getPublicLifecycleConfig(config),
  };
}

export function buildInternalOpsSnapshot(state, config = getAccountLifecycleConfig()) {
  ensureLifecycleState(state);
  if (!config.internalOpsEnabled) {
    const error = new Error("Internal account operations are disabled");
    error.status = 404;
    throw error;
  }
  return {
    exportRequests: state.dataExportRequests.map((item) => pick(item, [
      "id", "userId", "status", "scope", "format", "requestedAt", "createdAt", "updatedAt",
    ])),
    exportJobs: state.dataExportJobs.map((item) => pick(item, [
      "id", "userId", "exportRequestId", "status", "attempts", "maxAttempts", "lastError", "updatedAt",
    ])),
    deletionRequests: state.accountDeletionRequests.map((item) => pick(item, [
      "id", "userId", "status", "reason", "requestedAt", "gracePeriodEndsAt", "reviewedAt", "finalDeleteAllowed",
      "dryRunGeneratedAt", "dryRunReport", "finalExecutionStatus", "lastExecutionEvidenceId",
    ])),
    deletionReviews: state.accountDeletionReviews.map((item) => pick(item, [
      "id", "userId", "deletionRequestId", "reviewType", "decision", "operatorId", "operatorNote",
      "dryRunDiff", "createdAt",
    ])),
    auditEvents: (state.auditLog || [])
      .filter((item) => String(item.action || "").startsWith("account."))
      .map((item) => pick(item, ["id", "actorId", "action", "targetType", "targetId", "riskLevel", "metadata", "createdAt"])),
    secretsPrinted: false,
  };
}
