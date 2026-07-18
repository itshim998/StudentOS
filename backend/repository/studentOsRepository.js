import { confidenceLabel, createDeterministicEmbedding } from "../embeddings/embeddingService.js";
import { createEmptyStudentState, MIN_GROUNDING_CONFIDENCE, retrieveGroundedSources } from "../domain/studentosDomain.js";
import { publicShardRoute, routeUserToShard } from "../supabase/shardRouter.js";
import { createInitialProductLifecycle, normalizeProductLifecycle } from "../domain/productLifecycleService.js";
import { removeLegacyDemoArtifacts } from "../migrations/legacyDemoDataCleanup.js";
import { migrateLegacyClassroomAcademicData } from "../connectors/googleClassroom/mapper.js";
import { normalizeLegacyWeakTopicState } from "../domain/topicPerformanceService.js";

const COLLECTIONS = [
  ["courses", "courses"],
  ["topics", "topics"],
  ["syllabi", "syllabi"],
  ["exams", "exams"],
  ["assignments", "assignments"],
  ["timetable", "timetable_events"],
  ["notes", "notes"],
  ["sourceMaterials", "source_materials"],
  ["sourceChunks", "source_chunks"],
  ["testSessions", "test_sessions"],
  ["testResults", "test_results"],
  ["creditLedger", "credit_ledger"],
  ["roadmap", "roadmap_items"],
  ["revisionEvents", "revision_events"],
  ["tutorLessons", "tutor_lessons"],
  ["assignmentAutomationContracts", "assignment_automation_contracts"],
  ["auditLog", "audit_logs"],
  ["aiConversations", "ai_conversations"],
  ["aiMessages", "ai_messages"],
  ["memoryItems", "memory_items"],
  ["embeddingsMetadata", "embeddings_metadata"],
  ["backgroundJobs", "background_jobs"],
  ["jobEvents", "job_events"],
  ["billingSubscriptions", "billing_subscriptions"],
  ["billingWebhookEvents", "billing_webhook_events"],
  ["consentVersions", "consent_versions"],
  ["userConsents", "user_consents"],
  ["legalAcceptances", "legal_acceptances"],
  ["dataExportRequests", "data_export_requests"],
  ["dataExportJobs", "data_export_jobs"],
  ["accountDeletionRequests", "account_deletion_requests"],
  ["accountDeletionReviews", "account_deletion_reviews"],
  ["roleInvitations", "role_invitations"],
  ["classroomItems", "classroom_items"],
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function accountDisplayName(user = {}) {
  return String(user.user_metadata?.full_name || user.user_metadata?.name || "").trim();
}

export function initialStateForUser(user = {}) {
  const userId = user.id || "student_local_001";
  const state = createEmptyStudentState({
    userId,
    displayName: accountDisplayName(user),
    email: user.email || null,
  });
  state.studentProfile.productLifecycle = createInitialProductLifecycle();
  return state;
}

export function removeDemoSeedRowsForRealUser(state = {}) {
  return removeLegacyDemoArtifacts(state, COLLECTIONS.map(([key]) => key));
}

function ensureStateShape(state) {
  const shaped = {
    ...state,
    syllabi: state.syllabi || [],
    exams: state.exams || [],
    notes: state.notes || [],
    sourceChunks: state.sourceChunks || [],
    aiConversations: state.aiConversations || [],
    aiMessages: state.aiMessages || [],
    memoryItems: state.memoryItems || [],
    embeddingsMetadata: state.embeddingsMetadata || [],
    backgroundJobs: state.backgroundJobs || [],
    jobEvents: state.jobEvents || [],
    assignmentLearningFlows: state.assignmentLearningFlows || [],
  };
  for (const [key] of COLLECTIONS) {
    shaped[key] = shaped[key] || [];
  }
  removeDemoSeedRowsForRealUser(shaped);
  normalizeProductLifecycle(shaped);
  migrateLegacyClassroomAcademicData(shaped);
  normalizeLegacyWeakTopicState(shaped);
  return shaped;
}

function asIsoDate(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function asJson(value, fallback) {
  return value === undefined ? fallback : value;
}

function rowForCollection(key, item, userId) {
  const id = String(item.id);
  const base = {
    id,
    user_id: userId,
    payload: item,
    updated_at: new Date().toISOString(),
  };

  if (key === "courses") {
    return {
      ...base,
      title: item.title,
      term: item.term || null,
      teacher: item.teacher || null,
      exam_date: asIsoDate(item.examDate),
      color: item.color || null,
      syllabus_id: item.syllabusId || null,
      subject_ids: asJson(item.subjectIds, []),
    };
  }
  if (key === "topics") {
    return {
      ...base,
      course_id: item.courseId,
      title: item.title,
      coverage_state: item.coverageState || "uncovered",
      mastery: item.mastery || "not_started",
      weak_signals: asJson(item.weakSignals, []),
      source_material_ids: asJson(item.sourceMaterialIds, []),
    };
  }
  if (key === "assignments") {
    return {
      ...base,
      course_id: item.courseId,
      title: item.title,
      due_at: item.dueDate || item.dueAt || null,
      status: item.status || "open",
      source: item.source || "manual",
      topic_ids: asJson(item.topicIds, []),
    };
  }
  if (key === "syllabi") {
    return {
      ...base,
      course_id: item.courseId || null,
      title: item.title || "Syllabus",
      units: asJson(item.units, []),
      source_material_id: item.sourceMaterialId || null,
    };
  }
  if (key === "exams") {
    return {
      ...base,
      course_id: item.courseId || null,
      title: item.title || "Exam",
      exam_date: asIsoDate(item.examDate) || asIsoDate(new Date().toISOString()),
      weight: item.weight ?? null,
    };
  }
  if (key === "timetable") {
    return {
      ...base,
      course_id: item.courseId || null,
      title: item.title,
      starts_at: item.startsAt,
      ends_at: item.endsAt,
      location: item.location || null,
    };
  }
  if (key === "notes") {
    return {
      ...base,
      course_id: item.courseId || null,
      topic_id: item.topicId || null,
      title: item.title || "Note",
      body: item.body || "",
      source_material_ids: asJson(item.sourceMaterialIds, []),
    };
  }
  if (key === "sourceMaterials") {
    return {
      ...base,
      course_id: item.courseId || null,
      title: item.title,
      kind: item.kind || "uploaded_file_metadata",
      source_type: item.sourceType || item.kind || "uploaded_file_metadata",
      filename: item.filename || null,
      mime_type: item.mimeType || null,
      size_bytes: item.sizeBytes ?? item.fileSizeBytes ?? null,
      storage_bucket: item.storageBucket || null,
      storage_path: item.storagePath || null,
      status: item.status || item.extractionStatus || "ready",
      extracted_text: item.extractedText || null,
      extraction_summary: item.extractionSummary || null,
      extraction_error: item.extractionError || null,
      extraction_pages: item.extractionPages ?? null,
      extraction_provider: item.extractionProvider || null,
      indexed_at: item.indexedAt || null,
      failed_at: item.failedAt || null,
      citation_label: item.citationLabel || item.title,
      web_fallback_allowed: item.webFallbackAllowed !== false,
      deleted_at: item.deletedAt || null,
    };
  }
  if (key === "classroomItems") {
    return {
      ...base,
      external_id: item.externalId || item.providerCourseWorkId || item.providerMaterialId,
      provider_course_id: item.providerCourseId,
      provider_course_work_id: item.providerCourseWorkId || null,
      provider_material_id: item.providerMaterialId || null,
      item_type: item.itemType,
      title: item.title,
      course_title: item.courseTitle || null,
      due_at: item.dueAt || null,
      posted_at: item.postedAt || null,
      provider_updated_at: item.providerUpdatedAt || null,
      submission_state: item.submissionState || null,
      handed_in: item.handedIn === true,
      selection_state: item.selectionState || "discovered",
      selected_at: item.selectedAt || null,
      imported_at: item.importedAt || null,
      academic_context_included: item.academicContextIncluded === true,
      last_seen_at: item.lastSeenAt || new Date().toISOString(),
    };
  }
  if (key === "sourceChunks") {
    return {
      ...base,
      source_material_id: item.sourceMaterialId,
      course_id: item.courseId || null,
      topic_id: item.topicId || null,
      chunk_index: item.chunkIndex ?? 0,
      chunk_text: item.text || item.chunkText || "",
      char_count: item.charCount ?? String(item.text || item.chunkText || "").length,
      token_estimate: item.tokenEstimate ?? Math.ceil(String(item.text || item.chunkText || "").length / 4),
      citation_label: item.citationLabel || null,
      status: item.status || "indexed",
      embedding_status: item.embeddingStatus || "pending_embedding",
      embedding_provider: item.embeddingProvider || null,
      embedding_model: item.embeddingModel || null,
      embedding_hash: item.embeddingHash || null,
      embedding_dimensions: item.embeddingDimensions ?? null,
      embedding_values: item.embeddingVector || null,
      embedding_updated_at: item.embeddingUpdatedAt || null,
      embedding_error: item.embeddingError || null,
      deleted_at: item.deletedAt || null,
    };
  }
  if (key === "testSessions") {
    const persistedStatus = ["submitted_pending_evaluation", "ready_for_evaluation", "evaluated"].includes(item.status)
      ? "completed"
      : item.status === "time_expired" ? "abandoned" : "open";
    return {
      ...base,
      assignment_id: item.assignmentId || null,
      course_id: item.courseId || null,
      topic_id: item.topicId || null,
      question_format: item.questionFormat || "mcq",
      status: persistedStatus,
      questions: asJson(item.testPaper?.questions || item.questions, []),
      answer_key: asJson(item.answerKey, []),
    };
  }
  if (key === "testResults") {
    return {
      ...base,
      test_session_id: item.testSessionId || null,
      course_id: item.courseId || null,
      topic_id: item.topicId || null,
      grading_mode: item.type === "short_answer" ? "short_answer_pending" : "mcq_auto",
      score_percent: item.scorePercent ?? 0,
      credits_awarded: item.creditsAwarded || 0,
      answers: asJson(item.answers, []),
      answer_key: asJson(item.answerKey, []),
      completed_at: item.completedAt || new Date().toISOString(),
    };
  }
  if (key === "creditLedger") {
    return {
      ...base,
      source_type: item.sourceType,
      source_id: item.sourceId || null,
      amount: item.amount || 0,
      reason: item.reason || "",
    };
  }
  if (key === "roadmap") {
    return {
      ...base,
      course_id: item.courseId || null,
      topic_id: item.topicId || null,
      title: item.title,
      kind: item.kind,
      priority: item.priority || "medium",
      due_at: item.dueAt || null,
      status: item.status || "open",
    };
  }
  if (key === "revisionEvents") {
    return {
      ...base,
      course_id: item.courseId || null,
      topic_id: item.topicId || null,
      scheduled_at: item.scheduledAt,
      reason: item.reason || "",
      completed_at: item.completedAt || null,
    };
  }
  if (key === "tutorLessons") {
    return {
      ...base,
      course_id: item.courseId || null,
      topic_id: item.topicId || null,
      title: item.title,
      mode: item.mode,
      trigger: item.trigger || "manual",
      source_labels: asJson(item.sourceLabels, []),
      steps: asJson(item.steps, []),
    };
  }
  if (key === "assignmentAutomationContracts") {
    return {
      ...base,
      assignment_id: item.assignmentId,
      status: item.status,
      required_credits: item.requiredCredits || 1,
      available_credits: item.availableCredits || 0,
      allowed_actions: asJson(item.allowedActions, []),
      blocked_actions: asJson(item.blockedActions, []),
      student_review_required: item.studentReviewRequired !== false,
      real_submission_allowed: item.realSubmissionAllowed === true,
      rationale: item.rationale || "",
    };
  }
  if (key === "auditLog") {
    return {
      ...base,
      actor_id: item.actorId || userId,
      action: item.action,
      target_type: item.targetType || null,
      target_id: item.targetId || null,
      risk_level: item.riskLevel || "low",
      metadata: asJson(item.metadata, {}),
    };
  }
  if (key === "aiConversations") {
    return {
      ...base,
      title: item.title || "StudentOS conversation",
      verb: item.verb || null,
      course_id: item.courseId || null,
      topic_id: item.topicId || null,
    };
  }
  if (key === "aiMessages") {
    return {
      ...base,
      conversation_id: item.conversationId,
      role: item.role,
      verb: item.verb || null,
      content: item.content || "",
      source_labels: asJson(item.sourceLabels, []),
    };
  }
  if (key === "memoryItems") {
    return {
      ...base,
      course_id: item.courseId || null,
      topic_id: item.topicId || null,
      kind: item.kind || "note",
      title: item.title || "Memory item",
      body: item.body || "",
      source_material_ids: asJson(item.sourceMaterialIds, []),
      status: item.status || "ready",
      deleted_at: item.deletedAt || null,
    };
  }
  if (key === "embeddingsMetadata") {
    return {
      ...base,
      source_material_id: item.sourceMaterialId || null,
      source_chunk_id: item.sourceChunkId || null,
      memory_item_id: item.memoryItemId || null,
      provider: item.provider || "pending",
      model: item.model || "pending",
      vector_table: item.vectorTable || null,
      vector_ref: item.vectorRef || null,
      chunk_index: item.chunkIndex ?? null,
      dimensions: item.dimensions ?? null,
      embedding_hash: item.embeddingHash || null,
      embedding_values: item.embeddingValues || null,
      embedding_status: item.embeddingStatus || item.status || "pending_embedding",
      error: item.error || null,
      status: item.status || item.embeddingStatus || "pending",
    };
  }
  if (key === "backgroundJobs") {
    return {
      ...base,
      source_id: item.sourceId || null,
      job_type: item.jobType,
      status: item.status || "queued",
      attempts: item.attempts || 0,
      max_attempts: item.maxAttempts || 3,
      last_error: item.lastError || null,
      locked_at: item.lockedAt || null,
      processed_at: item.processedAt || null,
    };
  }
  if (key === "jobEvents") {
    return {
      ...base,
      job_id: item.jobId || null,
      source_id: item.sourceId || null,
      event_type: item.eventType,
      severity: item.severity || "info",
      message: item.message || item.eventType,
      metadata: asJson(item.metadata, {}),
    };
  }
  if (key === "billingSubscriptions") {
    return {
      ...base,
      plan_id: item.planId || "unselected",
      status: item.status || "unselected",
      provider: item.provider || "none",
      provider_customer_id: item.providerCustomerId || null,
      provider_subscription_id: item.providerSubscriptionId || null,
      renewal_at: item.renewalAt || null,
      cancel_at_period_end: item.cancelAtPeriodEnd === true,
    };
  }
  if (key === "billingWebhookEvents") {
    return {
      ...base,
      provider: item.provider,
      provider_event_id: item.providerEventId,
      event_type: item.eventType,
      status: item.status || "processed",
      subscription_id: item.subscriptionId || null,
      metadata: asJson(item.metadata, {}),
      processed_at: item.processedAt || new Date().toISOString(),
    };
  }
  if (key === "consentVersions") {
    return {
      ...base,
      privacy_version: item.privacyVersion,
      terms_version: item.termsVersion,
      consent_schema_version: item.consentSchemaVersion,
      status: item.status || "active",
      effective_at: item.effectiveAt || new Date().toISOString(),
    };
  }
  if (key === "userConsents") {
    return {
      ...base,
      consent_version_id: item.consentVersionId,
      consent_key: item.consentKey,
      granted: item.granted === true,
      status: item.status || "declined",
      withdrawn_at: item.withdrawnAt || null,
    };
  }
  if (key === "legalAcceptances") {
    return {
      ...base,
      privacy_version: item.privacyVersion,
      terms_version: item.termsVersion,
      consent_schema_version: item.consentSchemaVersion,
      acceptance_source: item.acceptanceSource || "account_settings",
      accepted_at: item.acceptedAt || new Date().toISOString(),
    };
  }
  if (key === "dataExportRequests") {
    return {
      ...base,
      status: item.status || "queued",
      scope: item.scope || "student_owned_data",
      format: item.format || "json",
      delivery: item.delivery || "manual_review_required",
      requested_at: item.requestedAt || new Date().toISOString(),
      expires_at: item.expiresAt || null,
      storage_bucket: item.storageBucket || null,
      storage_path: item.storagePath || null,
      package_size_bytes: item.packageSizeBytes ?? null,
      package_sha256: item.packageSha256 || null,
      ready_at: item.readyAt || null,
      downloaded_at: item.downloadedAt || null,
      retention_expires_at: item.retentionExpiresAt || null,
      package_deleted_at: item.packageDeletedAt || null,
      cleanup_status: item.cleanupStatus || "pending",
    };
  }
  if (key === "dataExportJobs") {
    return {
      ...base,
      export_request_id: item.exportRequestId,
      status: item.status || "queued",
      attempts: item.attempts || 0,
      max_attempts: item.maxAttempts || 3,
      last_error: item.lastError || null,
      processed_at: item.processedAt || null,
    };
  }
  if (key === "accountDeletionRequests") {
    return {
      ...base,
      status: item.status || "requested",
      reason: item.reason || "student_request",
      requested_at: item.requestedAt || new Date().toISOString(),
      grace_period_ends_at: item.gracePeriodEndsAt,
      reviewed_at: item.reviewedAt || null,
      final_delete_allowed: item.finalDeleteAllowed === true,
      dry_run_generated_at: item.dryRunGeneratedAt || null,
      dry_run_report: asJson(item.dryRunReport, {}),
      final_execution_status: item.finalExecutionStatus || "not_started",
      last_execution_evidence_id: item.lastExecutionEvidenceId || null,
    };
  }
  if (key === "accountDeletionReviews") {
    return {
      ...base,
      deletion_request_id: item.deletionRequestId,
      review_type: item.reviewType,
      decision: item.decision,
      operator_id: item.operatorId || null,
      operator_note: item.operatorNote || null,
      dry_run_report: asJson(item.dryRunReport, {}),
      dry_run_diff: asJson(item.dryRunDiff, {}),
    };
  }
  if (key === "roleInvitations") {
    return {
      ...base,
      invite_email: item.inviteEmail || null,
      role: item.role || "guardian_future",
      status: item.status || "disabled",
      enabled: item.enabled === true,
      student_consent_required: item.studentConsentRequired !== false,
      explicit_student_consent: item.explicitStudentConsent === true,
    };
  }
  return base;
}

function inFilter(values = []) {
  const clean = values.filter(Boolean).map((value) => String(value).replace(/["(),]/g, ""));
  if (!clean.length) return null;
  return `in.(${clean.join(",")})`;
}

function profileRow(profile, userId) {
  return {
    user_id: userId,
    display_name: profile.displayName || "Student",
    grade_band: profile.gradeBand || "high_school",
    school_system: profile.schoolSystem || null,
    timezone: profile.timezone || "UTC",
    discipline_index: profile.disciplineIndex ?? 50,
    learning_adaptivity_score: profile.learningAdaptivityScore ?? 50,
    preferences: profile.preferences || {},
    visibility: profile.visibility || {},
    payload: profile,
    updated_at: new Date().toISOString(),
  };
}

function fromPayload(row) {
  return row?.payload || null;
}

function safeErrorLabel(error) {
  return String(error?.message || error || "rpc_unavailable")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/apikey[A-Za-z0-9._:= -]*/gi, "apikey=[redacted]")
    .slice(0, 160);
}

function nowIso() {
  return new Date().toISOString();
}

function isStaleJob(job, lockTimeoutSeconds = 600) {
  if (job?.status !== "processing" || !job.lockedAt) return false;
  return Date.now() - Date.parse(job.lockedAt) > Number(lockTimeoutSeconds || 600) * 1000;
}

function backgroundJobFromRow(row) {
  if (!row) return null;
  const payload = row.payload || {};
  return {
    ...payload,
    id: row.id || payload.id,
    userId: row.user_id || payload.userId,
    sourceId: row.source_id ?? payload.sourceId ?? null,
    jobType: row.job_type || payload.jobType,
    status: row.status || payload.status || "queued",
    attempts: Number(row.attempts ?? payload.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? payload.maxAttempts ?? 3),
    lastError: row.last_error ?? payload.lastError ?? null,
    lockedAt: row.locked_at ?? payload.lockedAt ?? null,
    processedAt: row.processed_at ?? payload.processedAt ?? null,
    createdAt: row.created_at || payload.createdAt,
    updatedAt: row.updated_at || payload.updatedAt,
    payload: payload.payload || {},
  };
}

function dataExportJobFromRow(row) {
  if (!row) return null;
  const payload = row.payload || {};
  return {
    ...payload,
    id: row.id || payload.id,
    userId: row.user_id || payload.userId,
    exportRequestId: row.export_request_id || payload.exportRequestId,
    status: row.status || payload.status || "queued",
    attempts: Number(row.attempts ?? payload.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? payload.maxAttempts ?? 3),
    lastError: row.last_error ?? payload.lastError ?? null,
    lockedAt: payload.lockedAt || null,
    processedAt: row.processed_at ?? payload.processedAt ?? null,
    createdAt: row.created_at || payload.createdAt,
    updatedAt: row.updated_at || payload.updatedAt,
  };
}

function classroomTokenRow(record, userId) {
  return {
    id: record.id || `classroom_token_${userId}`,
    user_id: userId,
    provider: record.provider || "google_classroom",
    provider_account_email: record.providerAccountEmail || null,
    scopes: record.scopes || [],
    token_status: record.tokenStatus || record.status || "connected",
    encrypted_access_token: record.encryptedAccessToken || null,
    encrypted_refresh_token: record.encryptedRefreshToken || null,
    encryption_key_id: record.encryptionKeyId || null,
    token_created_at: record.tokenCreatedAt || record.createdAt || new Date().toISOString(),
    token_updated_at: record.tokenUpdatedAt || record.updatedAt || new Date().toISOString(),
    access_expires_at: record.accessExpiresAt || record.expiresAt || null,
    refresh_expires_at: record.refreshExpiresAt || null,
    last_refresh_at: record.lastRefreshAt || null,
    disconnected_at: record.disconnectedAt || null,
    last_error: record.lastError || null,
    payload: record.payload || {},
    updated_at: new Date().toISOString(),
  };
}

function classroomTokenFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider || "google_classroom",
    providerAccountEmail: row.provider_account_email || null,
    scopes: row.scopes || [],
    tokenStatus: row.token_status || "connected",
    encryptedAccessToken: row.encrypted_access_token || null,
    encryptedRefreshToken: row.encrypted_refresh_token || null,
    encryptionKeyId: row.encryption_key_id || null,
    tokenCreatedAt: row.token_created_at || row.created_at,
    tokenUpdatedAt: row.token_updated_at || row.updated_at,
    accessExpiresAt: row.access_expires_at || null,
    refreshExpiresAt: row.refresh_expires_at || null,
    lastRefreshAt: row.last_refresh_at || null,
    disconnectedAt: row.disconnected_at || null,
    lastError: row.last_error || null,
    payload: row.payload || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function classroomSyncRunRow(run, userId) {
  return {
    id: run.id,
    user_id: userId,
    provider: run.provider || "google_classroom",
    status: run.status || "completed",
    started_at: run.startedAt || run.createdAt || new Date().toISOString(),
    completed_at: run.completedAt || null,
    imported_courses: run.importedCourses || 0,
    updated_courses: run.updatedCourses || 0,
    imported_assignments: run.importedAssignments || 0,
    updated_assignments: run.updatedAssignments || 0,
    imported_materials: run.importedMaterials || 0,
    updated_materials: run.updatedMaterials || 0,
    skipped_items: run.skippedItems || 0,
    error_count: run.errorCount || 0,
    error_summary: run.errorSummary || null,
    read_only: run.readOnly !== false,
    writeback_enabled: run.writebackEnabled === true,
    provider_account_email: run.providerAccountEmail || null,
    payload: run.payload || {},
    updated_at: new Date().toISOString(),
  };
}

function classroomSyncRunFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider || "google_classroom",
    status: row.status || "completed",
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
    importedCourses: row.imported_courses || 0,
    updatedCourses: row.updated_courses || 0,
    importedAssignments: row.imported_assignments || 0,
    updatedAssignments: row.updated_assignments || 0,
    importedMaterials: row.imported_materials || 0,
    updatedMaterials: row.updated_materials || 0,
    skippedItems: row.skipped_items || 0,
    errorCount: row.error_count || 0,
    errorSummary: row.error_summary || null,
    readOnly: row.read_only !== false,
    writebackEnabled: row.writeback_enabled === true,
    providerAccountEmail: row.provider_account_email || null,
    payload: row.payload || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safePathSegment(value) {
  return String(value || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
}

function assertOwnedExportPath(userId, path) {
  if (!String(path || "").startsWith(`${safePathSegment(userId)}/exports/`)) {
    throw new Error("export_storage_path_not_owned");
  }
}

function isStaleExportJob(job, lockTimeoutSeconds = 600) {
  if (job?.status !== "processing" || !job.lockedAt) return false;
  return Date.now() - Date.parse(job.lockedAt) > Number(lockTimeoutSeconds || 600) * 1000;
}

function rpcRowsToRetrieval(rows = [], { fallbackMode = "rpc-vector" } = {}) {
  const chunks = rows.map((row) => {
    const confidenceScore = Number(row.confidence_score ?? row.similarity ?? 0) || 0;
    const source = {
      id: row.source_id,
      title: row.source_title,
      sourceType: "uploaded_file",
      citationLabel: row.citation_label || row.source_title,
      status: "indexed",
    };
    return {
      id: row.chunk_id,
      sourceMaterialId: row.source_id,
      courseId: row.course_id || null,
      topicId: row.topic_id || null,
      chunkIndex: row.chunk_index ?? null,
      text: row.snippet || "",
      snippet: row.snippet || "",
      citationLabel: row.citation_label || row.source_title,
      source,
      score: Number(row.similarity || 0) * 100,
      semanticScore: Number(row.similarity || 0),
      confidenceScore,
      confidenceLabel: row.confidence_label || confidenceLabel(confidenceScore),
      groundingType: "uploaded_chunk",
      embeddingStatus: row.embedding_status || "embedded",
      retrievalMode: row.retrieval_mode || fallbackMode,
    };
  }).filter((chunk) => chunk.confidenceScore >= MIN_GROUNDING_CONFIDENCE);
  const bestConfidence = chunks[0]?.confidenceScore || 0;
  return {
    chunks,
    sources: [],
    memories: [],
    labels: chunks.map((chunk) => ({
      label: chunk.citationLabel,
      type: chunk.groundingType,
      sourceId: chunk.sourceMaterialId,
      chunkId: chunk.id,
      snippet: chunk.snippet,
      confidenceLabel: chunk.confidenceLabel,
      confidenceScore: chunk.confidenceScore,
    })),
    hasUploadedMaterial: chunks.length > 0,
    retrievalMode: chunks[0]?.retrievalMode || fallbackMode,
    confidence: {
      score: Number(bestConfidence.toFixed(4)),
      label: confidenceLabel(bestConfidence),
      lowConfidence: bestConfidence < MIN_GROUNDING_CONFIDENCE,
      semanticAvailable: chunks.length > 0,
    },
  };
}

function localRetrieval({ state, message, topic, course, limit, fallbackReason = null }) {
  const retrieval = retrieveGroundedSources({ state, message, topic, course, limit });
  if (fallbackReason) {
    retrieval.rpcFallbackReason = fallbackReason;
  }
  return retrieval;
}

class MockStudentOsRepository {
  constructor() {
    this.states = new Map();
    this.sourceObjects = new Map();
    this.exportPackages = new Map();
    this.deletionExecutionEvidence = [];
    this.operatorAuditEvents = [];
    this.billingCancellationEvents = [];
    this.monitoringAlertEvents = [];
    this.classroomTokens = new Map();
    this.classroomSyncRuns = new Map();
    this.aiUsageLedger = [];
  }

  getInfo() {
    return {
      mode: "mock",
      shard: {
        mode: "mock",
        label: "mock-local",
      },
    };
  }

  async loadState(session) {
    const user = session?.user || { id: "student_local_001" };
    if (!this.states.has(user.id)) {
      this.states.set(user.id, ensureStateShape(initialStateForUser(user)));
    }
    return clone(this.states.get(user.id));
  }

  async saveState(session, state) {
    const userId = session?.user?.id || state.studentProfile.id;
    this.states.set(userId, ensureStateShape(clone(state)));
  }

  async saveTestResultBundle(session, state) {
    await this.saveState(session, state);
  }

  async saveAssignmentFlow(session, state) {
    await this.saveState(session, state);
  }

  async saveAssignmentContract(session, state) {
    await this.saveState(session, state);
  }

  async saveTutorLesson(session, state) {
    await this.saveState(session, state);
  }

  async saveSourceMaterial(session, state) {
    await this.saveState(session, state);
  }

  async saveSourceIngestion(session, state) {
    await this.saveState(session, state);
  }

  async saveBackgroundJobs(session, state) {
    await this.saveState(session, state);
  }

  async saveAccountLifecycle(session, state) {
    await this.saveState(session, state);
  }

  async saveDataExportState(session, state) {
    await this.saveState(session, state);
  }

  async saveClassroomToken(session, record) {
    const userId = session.user.id;
    this.classroomTokens.set(userId, classroomTokenRow(record, userId));
    return { saved: true, mode: "mock" };
  }

  async getClassroomToken(session) {
    return classroomTokenFromRow(this.classroomTokens.get(session.user.id));
  }

  async deleteClassroomToken(session) {
    return { deleted: this.classroomTokens.delete(session.user.id), mode: "mock" };
  }

  async markClassroomTokenStatus(session, { status, lastError = "", updatedAt = nowIso() } = {}) {
    const row = this.classroomTokens.get(session.user.id);
    if (!row) return { updated: false, mode: "mock" };
    row.token_status = status;
    row.last_error = lastError || null;
    row.token_updated_at = updatedAt;
    row.updated_at = updatedAt;
    if (status === "disconnected") row.disconnected_at = updatedAt;
    this.classroomTokens.set(session.user.id, row);
    return { updated: true, mode: "mock" };
  }

  async saveClassroomSyncRun(session, run) {
    const userId = session.user.id;
    const row = classroomSyncRunRow(run, userId);
    const items = this.classroomSyncRuns.get(userId) || [];
    const index = items.findIndex((item) => item.id === row.id);
    if (index >= 0) items[index] = row;
    else items.unshift(row);
    this.classroomSyncRuns.set(userId, items.slice(0, 50));
    return { saved: true, mode: "mock" };
  }

  async listClassroomSyncRuns(session, { limit = 10 } = {}) {
    return (this.classroomSyncRuns.get(session.user.id) || [])
      .slice(0, limit)
      .map(classroomSyncRunFromRow);
  }

  async reserveAiWeeklyAllowance(session, request = {}) {
    const userId = session.user.id;
    const existing = this.aiUsageLedger.find((entry) => entry.userId === userId && entry.requestId === request.requestId);
    const used = this.aiUsageLedger
      .filter((entry) => entry.userId === userId && entry.periodKey === request.periodKey && ["reserved", "charged"].includes(entry.status))
      .reduce((sum, entry) => sum + Number(entry.creditCost || 0), 0);
    if (existing) {
      return {
        allowed: ["reserved", "charged"].includes(existing.status),
        allowance: request.allowance,
        used,
        remaining: Math.max(0, request.allowance - used),
        entryId: existing.id,
        status: existing.status,
      };
    }
    const allowed = Number(request.creditCost || 0) <= Math.max(0, Number(request.allowance || 0) - used);
    const entry = {
      id: `ai_usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      planTier: request.planTier,
      periodKey: request.periodKey,
      actionType: request.actionType,
      creditCost: Number(request.creditCost || 0),
      status: allowed ? "reserved" : "blocked",
      requestId: request.requestId,
      metadata: request.metadata || {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.aiUsageLedger.push(entry);
    const nextUsed = used + (allowed ? entry.creditCost : 0);
    return {
      allowed,
      allowance: request.allowance,
      used: nextUsed,
      remaining: Math.max(0, Number(request.allowance || 0) - nextUsed),
      entryId: entry.id,
      status: entry.status,
    };
  }

  async settleAiWeeklyAllowance(session, { requestId, status } = {}) {
    const entry = this.aiUsageLedger.find((item) => item.userId === session.user.id && item.requestId === requestId);
    if (!entry) return null;
    if (entry.status === "reserved" && ["charged", "refunded"].includes(status)) {
      entry.status = status;
      entry.updatedAt = nowIso();
    }
    const used = this.aiUsageLedger
      .filter((item) => item.userId === session.user.id && item.periodKey === entry.periodKey && ["reserved", "charged"].includes(item.status))
      .reduce((sum, item) => sum + Number(item.creditCost || 0), 0);
    return { entryId: entry.id, status: entry.status, periodKey: entry.periodKey, creditCost: entry.creditCost, used };
  }

  async beginRoutedAiOperation(session, request = {}) {
    const userId = session.user.id;
    const now = Date.now();
    for (const entry of this.aiUsageLedger) {
      if (entry.userId !== userId || entry.periodKey !== request.periodKey || entry.routingStatus !== "running") continue;
      if (Date.parse(entry.routingLeaseExpiresAt || 0) > now) continue;
      if (entry.status === "reserved") entry.status = "refunded";
      entry.routingStatus = "failed";
      entry.routingLeaseExpiresAt = null;
      entry.routingAttempts = [...(entry.routingAttempts || []), { outcome: "lease_expired" }];
      entry.updatedAt = nowIso();
    }

    let existing = this.aiUsageLedger.find((entry) => entry.userId === userId && entry.requestId === request.requestId);
    if (existing && existing.requestFingerprint !== request.requestFingerprint) {
      const error = new Error("idempotency_key_reused_with_different_request");
      error.status = 409;
      throw error;
    }

    const usage = () => this.aiUsageLedger
      .filter((entry) => entry.userId === userId && entry.periodKey === request.periodKey && ["reserved", "charged"].includes(entry.status))
      .reduce((sum, entry) => sum + Number(entry.creditCost || 0), 0);
    const successCount = () => this.aiUsageLedger
      .filter((entry) => entry.userId === userId && entry.periodKey === request.periodKey && entry.status === "charged")
      .length;
    const result = (entry, fields = {}) => {
      const used = usage();
      return {
        allowed: false,
        busy: false,
        sameOperation: false,
        replay: false,
        allowance: Number(request.allowance || 0),
        used,
        remaining: Math.max(0, Number(request.allowance || 0) - used),
        entryId: entry?.id || null,
        status: entry?.status || null,
        routingStatus: entry?.routingStatus || null,
        successfulCount: successCount(),
        selectedOrdinal: entry?.routingOrdinal || null,
        leaseExpiresAt: entry?.routingLeaseExpiresAt || null,
        outcome: entry?.outcome ? clone(entry.outcome) : null,
        ...fields,
      };
    };

    if (existing?.routingStatus === "succeeded" && existing.status === "charged") {
      return result(existing, { allowed: true, sameOperation: true, replay: true });
    }
    if (existing?.routingStatus === "failed" && existing.status === "refunded" && existing.outcome) {
      return result(existing, { allowed: true, sameOperation: true, replay: true });
    }
    if (existing?.routingStatus === "running") {
      return result(existing, { allowed: true, busy: true, sameOperation: true });
    }
    if (existing?.status === "blocked") {
      return result(existing, { sameOperation: true, replay: true });
    }

    const active = this.aiUsageLedger.find((entry) => (
      entry.userId === userId
      && entry.periodKey === request.periodKey
      && entry.routingStatus === "running"
    ));
    if (active) return result(active, { busy: true });

    const used = usage();
    const allowed = Number(request.creditCost || 0) <= Math.max(0, Number(request.allowance || 0) - used);
    if (!allowed) {
      if (!existing) {
        existing = {
          id: `ai_usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          userId,
          requestId: request.requestId,
          requestFingerprint: request.requestFingerprint,
          periodKey: request.periodKey,
          planTier: request.planTier,
          actionType: request.actionType,
          creditCost: Number(request.creditCost || 0),
          metadata: request.metadata || {},
          createdAt: nowIso(),
        };
        this.aiUsageLedger.push(existing);
      }
      Object.assign(existing, { status: "blocked", routingStatus: "blocked", updatedAt: nowIso() });
      return result(existing);
    }

    const ordinal = successCount() + 1;
    if (!existing) {
      existing = {
        id: `ai_usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        requestId: request.requestId,
        requestFingerprint: request.requestFingerprint,
        periodKey: request.periodKey,
        createdAt: nowIso(),
      };
      this.aiUsageLedger.push(existing);
    }
    Object.assign(existing, {
      planTier: request.planTier,
      actionType: request.actionType,
      creditCost: Number(request.creditCost || 0),
      status: "reserved",
      metadata: request.metadata || {},
      routingStatus: "running",
      routingOrdinal: ordinal,
      routingLeaseExpiresAt: new Date(now + Math.max(1_000, Number(request.leaseMs || 180_000))).toISOString(),
      routingPrimaryProvider: null,
      routingFinalProvider: null,
      routingAttempts: [],
      outcome: null,
      updatedAt: nowIso(),
    });
    return result(existing, { allowed: true });
  }

  async completeRoutedAiOperation(session, completion = {}) {
    const entry = this.aiUsageLedger.find((item) => item.userId === session.user.id && item.requestId === completion.requestId);
    if (!entry) return null;
    let changed = false;
    if (entry.status === "reserved" && entry.routingStatus === "running") {
      entry.status = completion.succeeded ? "charged" : "refunded";
      entry.routingStatus = completion.succeeded ? "succeeded" : "failed";
      entry.routingLeaseExpiresAt = null;
      entry.routingPrimaryProvider = completion.primaryProvider || null;
      entry.routingFinalProvider = completion.succeeded ? completion.finalProvider || null : null;
      entry.routingAttempts = clone(Array.isArray(completion.attempts) ? completion.attempts : []);
      entry.outcome = completion.outcome ? clone(completion.outcome) : null;
      entry.updatedAt = nowIso();
      changed = true;
    }
    const used = this.aiUsageLedger
      .filter((item) => item.userId === session.user.id && item.periodKey === entry.periodKey && ["reserved", "charged"].includes(item.status))
      .reduce((sum, item) => sum + Number(item.creditCost || 0), 0);
    const successfulCount = this.aiUsageLedger
      .filter((item) => item.userId === session.user.id && item.periodKey === entry.periodKey && item.status === "charged")
      .length;
    return {
      entryId: entry.id,
      status: entry.status,
      routingStatus: entry.routingStatus,
      periodKey: entry.periodKey,
      creditCost: entry.creditCost,
      used,
      successfulCount,
      changed,
      outcome: entry.outcome ? clone(entry.outcome) : null,
    };
  }

  async getAiWeeklySuccessfulRequestCount(session, { periodKey } = {}) {
    return this.aiUsageLedger.filter((entry) => (
      entry.userId === session.user.id && entry.periodKey === periodKey && entry.status === "charged"
    )).length;
  }

  async uploadExportPackage(session, { bucket, path, bytes }) {
    assertOwnedExportPath(session.user.id, path);
    this.exportPackages.set(`${bucket}/${path}`, Buffer.from(bytes));
    return { uploaded: true, mode: "mock_private_export_storage" };
  }

  async downloadExportPackage(session, { bucket, path }) {
    assertOwnedExportPath(session.user.id, path);
    const bytes = this.exportPackages.get(`${bucket}/${path}`);
    if (!bytes) {
      const error = new Error("export_package_not_found");
      error.status = 404;
      throw error;
    }
    return { downloaded: true, mode: "mock_private_export_storage", bytes: Buffer.from(bytes) };
  }

  async deleteExportPackage(session, { bucket, path }) {
    assertOwnedExportPath(session.user.id, path);
    return {
      deleted: this.exportPackages.delete(`${bucket}/${path}`),
      mode: "mock_private_export_storage",
    };
  }

  async listExpiredExportRequests({ now = new Date(), limit = 100 } = {}) {
    const candidates = [];
    for (const state of this.states.values()) {
      for (const request of state.dataExportRequests || []) {
        if (request.storagePath &&
            !request.packageDeletedAt &&
            request.retentionExpiresAt &&
            Date.parse(request.retentionExpiresAt) <= now.getTime()) {
          candidates.push({ ...request });
        }
      }
    }
    return candidates
      .sort((left, right) => Date.parse(left.retentionExpiresAt) - Date.parse(right.retentionExpiresAt))
      .slice(0, limit);
  }

  async insertDeletionExecutionEvidence(session, evidence) {
    if (evidence.userId !== session.user.id) throw new Error("deletion_evidence_user_mismatch");
    this.deletionExecutionEvidence.push(clone(evidence));
    return clone(evidence);
  }

  async listDeletionExecutionEvidence(session) {
    return this.deletionExecutionEvidence
      .filter((evidence) => evidence.userId === session.user.id)
      .map(clone);
  }

  async executeFinalAccountDeletion(session, { sourceObjects = [], exportObjects = [] } = {}) {
    for (const storageObject of sourceObjects) {
      await this.deleteStorageObject(session, storageObject);
    }
    for (const storageObject of exportObjects) {
      await this.deleteExportPackage(session, storageObject);
    }
    this.states.delete(session.user.id);
    return {
      deleted: true,
      mode: "mock",
      storageApiCleanupExecuted: true,
    };
  }

  async insertOperatorAuditEvent(_session, event) {
    this.operatorAuditEvents.push(clone(event));
    return clone(event);
  }

  async listOperatorAuditEvents(session) {
    return this.operatorAuditEvents
      .filter((event) => !session?.user?.id || event.targetUserId === session.user.id)
      .map(clone);
  }

  async insertBillingCancellationEvent(_session, event) {
    this.billingCancellationEvents.push(clone(event));
    return clone(event);
  }

  async listBillingCancellationEvents(session) {
    return this.billingCancellationEvents
      .filter((event) => event.targetUserId === session.user.id)
      .map(clone);
  }

  async insertMonitoringAlertEvent(_session, event) {
    this.monitoringAlertEvents.push(clone(event));
    return clone(event);
  }

  async listMonitoringAlertEvents(session) {
    return this.monitoringAlertEvents
      .filter((event) => !session?.user?.id || event.targetUserId === session.user.id)
      .map(clone);
  }

  async hardDeleteSourceArtifacts(session, { sourceId, storageBucket, storagePath, assignmentIds = [], syllabusIds = [] } = {}) {
    const state = await this.loadState(session);
    if (storageBucket && storagePath) await this.deleteStorageObject(session, { bucket: storageBucket, path: storagePath });
    const assignments = new Set(assignmentIds);
    if (sourceId) {
      state.sourceMaterials = (state.sourceMaterials || []).filter((item) => item.id !== sourceId);
      state.sourceChunks = (state.sourceChunks || []).filter((item) => item.sourceMaterialId !== sourceId);
      state.memoryItems = (state.memoryItems || []).filter((item) => !item.sourceMaterialIds?.includes(sourceId));
      state.embeddingsMetadata = (state.embeddingsMetadata || []).filter((item) => item.sourceMaterialId !== sourceId);
      state.backgroundJobs = (state.backgroundJobs || []).filter((item) => item.sourceId !== sourceId);
      state.jobEvents = (state.jobEvents || []).filter((item) => item.sourceId !== sourceId);
    }
    state.assignments = (state.assignments || []).filter((item) => !assignments.has(item.id));
    const syllabi = new Set(syllabusIds);
    state.syllabi = (state.syllabi || []).filter((item) => !syllabi.has(item.id));
    await this.saveState(session, state);
    return { hardDeleted: true, mode: "mock", storageObjectDeleteRequested: Boolean(storagePath) };
  }

  async deleteAcademicExam(session, examId) {
    const state = await this.loadState(session);
    state.exams = (state.exams || []).filter((item) => item.id !== examId);
    await this.saveState(session, state);
    return { deleted: true, mode: "mock" };
  }

  async uploadStorageObject(session, { bucket, path, bytes }) {
    this.sourceObjects.set(`${session.user.id}/${bucket}/${path}`, Buffer.from(bytes));
    return { uploaded: true, mode: "mock_private_source_storage" };
  }

  async deleteStorageObject(session, { bucket, path }) {
    return { deleted: this.sourceObjects.delete(`${session.user.id}/${bucket}/${path}`), mode: "mock_private_source_storage" };
  }

  async downloadStorageObject(session, { bucket, path }) {
    const bytes = this.sourceObjects.get(`${session.user.id}/${bucket}/${path}`);
    return { downloaded: Boolean(bytes), mode: "mock_private_source_storage", bytes: bytes ? Buffer.from(bytes) : null };
  }

  async saveAiConversation(session, conversation, messages) {
    const state = await this.loadState(session);
    const conversationIndex = state.aiConversations.findIndex((item) => item.id === conversation.id);
    if (conversationIndex >= 0) state.aiConversations[conversationIndex] = conversation;
    else state.aiConversations.push(conversation);
    for (const message of messages) {
      const messageIndex = state.aiMessages.findIndex((item) => item.id === message.id);
      if (messageIndex >= 0) state.aiMessages[messageIndex] = message;
      else state.aiMessages.push(message);
    }
    await this.saveState(session, state);
  }

  async retrieveGroundedChunks(session, args) {
    return localRetrieval(args);
  }

  async listRunnableJobs({ limit = 25 } = {}) {
    const jobs = [];
    for (const state of this.states.values()) {
      jobs.push(...(state.backgroundJobs || []).filter((job) => job.status === "queued"));
    }
    return jobs
      .sort((left, right) => Date.parse(left.createdAt || "") - Date.parse(right.createdAt || ""))
      .slice(0, limit);
  }

  async claimNextBackgroundJob({ lockTimeoutSeconds = 600, workerId = "local-worker" } = {}) {
    const timestamp = nowIso();
    for (const [userId, state] of this.states.entries()) {
      let changed = false;
      for (const job of state.backgroundJobs || []) {
        if (isStaleJob(job, lockTimeoutSeconds)) {
          job.status = "queued";
          job.lockedAt = null;
          job.updatedAt = timestamp;
          changed = true;
        }
      }
      const job = (state.backgroundJobs || [])
        .filter((item) => item.status === "queued")
        .filter((item) => Number(item.attempts || 0) < Number(item.maxAttempts || 3))
        .sort((left, right) => Date.parse(left.createdAt || "") - Date.parse(right.createdAt || ""))[0];
      if (!job) {
        if (changed) this.states.set(userId, ensureStateShape(state));
        continue;
      }
      job.status = "processing";
      job.lockedAt = timestamp;
      job.attempts = Number(job.attempts || 0) + 1;
      job.updatedAt = timestamp;
      job.payload = { ...(job.payload || {}), workerId };
      this.states.set(userId, ensureStateShape(state));
      return clone(job);
    }
    return null;
  }

  async saveBackgroundJobForUser(user, job, state = null) {
    const session = { authenticated: false, mode: "local_preview", user };
    const target = state || await this.loadState(session);
    const index = (target.backgroundJobs || []).findIndex((item) => item.id === job.id);
    if (index >= 0) target.backgroundJobs[index] = job;
    else target.backgroundJobs.push(job);
    await this.saveState(session, target);
  }

  async claimNextDataExportJob({ lockTimeoutSeconds = 600, workerId = "local-export-worker" } = {}) {
    const timestamp = nowIso();
    for (const [userId, state] of this.states.entries()) {
      for (const job of state.dataExportJobs || []) {
        if (isStaleExportJob(job, lockTimeoutSeconds)) {
          job.status = Number(job.attempts || 0) >= Number(job.maxAttempts || 3) ? "failed" : "queued";
          job.lockedAt = null;
          job.updatedAt = timestamp;
        }
      }
      const job = (state.dataExportJobs || [])
        .filter((item) => item.status === "queued")
        .filter((item) => Number(item.attempts || 0) < Number(item.maxAttempts || 3))
        .sort((left, right) => Date.parse(left.createdAt || "") - Date.parse(right.createdAt || ""))[0];
      if (!job) continue;
      job.status = "processing";
      job.lockedAt = timestamp;
      job.attempts = Number(job.attempts || 0) + 1;
      job.updatedAt = timestamp;
      job.workerId = workerId;
      this.states.set(userId, ensureStateShape(state));
      return clone(job);
    }
    return null;
  }
}

class SupabaseStudentOsRepository {
  constructor({ config, shardClients }) {
    this.config = config;
    this.shardClients = shardClients;
  }

  canUseSupabase(session) {
    return this.config.mode === "supabase" && session?.authenticated === true;
  }

  route(session) {
    return routeUserToShard(session.user.id, this.shardClients);
  }

  getInfo(session) {
    if (!this.canUseSupabase(session)) {
      return {
        mode: "mock",
        shard: {
          mode: "mock",
          label: "mock-local",
        },
      };
    }
    return {
      mode: "supabase",
      shard: publicShardRoute(this.route(session)),
    };
  }

  async loadState(session) {
    const route = this.route(session);
    const user = session.user;
    const profileRows = await route.client.select("student_profiles", {
      columns: "payload",
      filters: { user_id: `eq.${user.id}` },
      limit: 1,
    });

    if (!profileRows.length) {
      const initialState = ensureStateShape(initialStateForUser(user));
      await this.saveState(session, initialState);
      return initialState;
    }

    const storedProfile = fromPayload(profileRows[0]);
    const storedProfilePayload = JSON.stringify(storedProfile ?? null);
    const storedLifecycle = JSON.stringify(storedProfile?.productLifecycle ?? null);
    const state = {
      studentProfile: storedProfile,
    };
    for (const [key, table] of COLLECTIONS) {
      const rows = await route.client.select(table, {
        columns: "payload",
        filters: { user_id: `eq.${user.id}` },
        order: "created_at.asc",
      });
      state[key] = rows.map(fromPayload).filter(Boolean);
    }
    const classroomMigrationKeys = [
      "classroomItems",
      "assignments",
      "sourceMaterials",
      "sourceChunks",
      "memoryItems",
      "embeddingsMetadata",
      "backgroundJobs",
      "courses",
      "topics",
      "roadmap",
      "testSessions",
      "assignmentAutomationContracts",
      "tutorLessons",
      "revisionEvents",
    ];
    const beforeClassroomMigration = Object.fromEntries(classroomMigrationKeys.map((key) => [key, JSON.stringify(state[key] || [])]));
    const shaped = ensureStateShape(state);
    if (JSON.stringify(shaped.studentProfile) !== storedProfilePayload || JSON.stringify(shaped.studentProfile.productLifecycle) !== storedLifecycle) {
      await route.client.upsert("student_profiles", profileRow(shaped.studentProfile, user.id), {
        onConflict: "user_id",
        returning: "minimal",
      });
    }
    const changedClassroomKeys = classroomMigrationKeys.filter((key) => JSON.stringify(shaped[key] || []) !== beforeClassroomMigration[key]);
    if (changedClassroomKeys.length) {
      await this.saveChangedCollections(session, shaped, changedClassroomKeys);
    }
    return shaped;
  }

  async saveState(session, state) {
    const route = this.route(session);
    const userId = session.user.id;
    const shaped = ensureStateShape(state);
    await route.client.upsert("student_profiles", profileRow(shaped.studentProfile, userId), {
      onConflict: "user_id",
      returning: "minimal",
    });
    for (const [key, table] of COLLECTIONS) {
      const items = shaped[key] || [];
      if (!items.length) continue;
      const rows = items.filter((item) => item?.id).map((item) => rowForCollection(key, item, userId));
      if (rows.length) {
        await route.client.upsert(table, rows, { onConflict: "id", returning: "minimal" });
      }
    }
  }

  async saveChangedCollections(session, state, keys) {
    const route = this.route(session);
    const userId = session.user.id;
    const shaped = ensureStateShape(state);
    for (const key of keys) {
      const table = COLLECTIONS.find(([collectionKey]) => collectionKey === key)?.[1];
      if (!table) continue;
      const rows = (shaped[key] || []).filter((item) => item?.id).map((item) => rowForCollection(key, item, userId));
      if (rows.length) {
        await route.client.upsert(table, rows, { onConflict: "id", returning: "minimal" });
      }
    }
  }

  async saveTestResultBundle(session, state) {
    await this.saveChangedCollections(session, state, [
      "topics",
      "testResults",
      "creditLedger",
      "roadmap",
      "revisionEvents",
      "tutorLessons",
      "auditLog",
    ]);
  }

  async saveAssignmentFlow(session, state) {
    await this.saveChangedCollections(session, state, [
      "testSessions",
      "roadmap",
      "tutorLessons",
      "auditLog",
    ]);
  }

  async saveAssignmentContract(session, state) {
    await this.saveChangedCollections(session, state, [
      "assignmentAutomationContracts",
      "auditLog",
    ]);
  }

  async saveTutorLesson(session, state) {
    await this.saveChangedCollections(session, state, ["tutorLessons"]);
  }

  async saveSourceMaterial(session, state) {
    await this.saveChangedCollections(session, state, ["sourceMaterials"]);
  }

  async saveSourceIngestion(session, state) {
    await this.saveChangedCollections(session, state, ["assignments", "syllabi", "sourceMaterials", "sourceChunks", "memoryItems", "embeddingsMetadata", "backgroundJobs", "jobEvents", "auditLog"]);
  }

  async saveBackgroundJobs(session, state) {
    await this.saveChangedCollections(session, state, ["backgroundJobs", "jobEvents", "sourceChunks", "embeddingsMetadata", "sourceMaterials", "memoryItems", "auditLog"]);
  }

  async saveAccountLifecycle(session, state) {
    await this.saveChangedCollections(session, state, [
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
  }

  async saveDataExportState(session, state) {
    await this.saveChangedCollections(session, state, [
      "dataExportRequests",
      "dataExportJobs",
      "auditLog",
    ]);
  }

  async saveClassroomToken(session, record) {
    const route = this.route(session);
    await route.client.upsert("classroom_tokens", classroomTokenRow(record, session.user.id), {
      onConflict: "user_id,provider",
      returning: "minimal",
    });
    return { saved: true, mode: "supabase", shard: publicShardRoute(route) };
  }

  async getClassroomToken(session) {
    const route = this.route(session);
    const rows = await route.client.select("classroom_tokens", {
      columns: "*",
      filters: {
        user_id: `eq.${session.user.id}`,
        provider: "eq.google_classroom",
      },
      limit: 1,
    });
    return classroomTokenFromRow(rows[0]);
  }

  async deleteClassroomToken(session) {
    const route = this.route(session);
    await route.client.deleteRows("classroom_tokens", {
      filters: {
        user_id: `eq.${session.user.id}`,
        provider: "eq.google_classroom",
      },
    });
    return { deleted: true, mode: "supabase", shard: publicShardRoute(route) };
  }

  async markClassroomTokenStatus(session, { status, lastError = "", updatedAt = nowIso() } = {}) {
    const route = this.route(session);
    const existing = await this.getClassroomToken(session);
    if (!existing) return { updated: false, mode: "supabase", shard: publicShardRoute(route) };
    await route.client.upsert("classroom_tokens", {
      id: existing.id,
      user_id: session.user.id,
      provider: "google_classroom",
      token_status: status,
      last_error: lastError || null,
      token_updated_at: updatedAt,
      disconnected_at: status === "disconnected" ? updatedAt : existing.disconnectedAt || null,
      payload: {
        ...(existing.payload || {}),
        statusUpdatedBy: "studentos_backend",
      },
      updated_at: updatedAt,
    }, {
      onConflict: "user_id,provider",
      returning: "minimal",
    });
    return { updated: true, mode: "supabase", shard: publicShardRoute(route) };
  }

  async saveClassroomSyncRun(session, run) {
    const route = this.route(session);
    await route.client.upsert("classroom_sync_runs", classroomSyncRunRow(run, session.user.id), {
      onConflict: "id",
      returning: "minimal",
    });
    return { saved: true, mode: "supabase", shard: publicShardRoute(route) };
  }

  async listClassroomSyncRuns(session, { limit = 10 } = {}) {
    const route = this.route(session);
    const rows = await route.client.select("classroom_sync_runs", {
      columns: "*",
      filters: {
        user_id: `eq.${session.user.id}`,
      },
      order: "started_at.desc",
      limit,
    });
    return rows.map(classroomSyncRunFromRow).filter(Boolean);
  }

  async reserveAiWeeklyAllowance(session, request = {}) {
    const route = this.route(session);
    const rows = await route.client.rpc("reserve_ai_weekly_allowance", {
      p_user_id: session.user.id,
      p_plan_tier: request.planTier,
      p_period_key: request.periodKey,
      p_allowance: request.allowance,
      p_action_type: request.actionType,
      p_credit_cost: request.creditCost,
      p_request_id: request.requestId,
      p_metadata: request.metadata || {},
    });
    const row = rows?.[0] || {};
    return {
      allowed: row.allowed === true,
      allowance: Number(row.allowance || request.allowance || 0),
      used: Number(row.used || 0),
      remaining: Number(row.remaining || 0),
      entryId: row.entry_id || null,
      status: row.entry_status || (row.allowed ? "reserved" : "blocked"),
    };
  }

  async settleAiWeeklyAllowance(session, { requestId, status } = {}) {
    const route = this.route(session);
    const rows = await route.client.rpc("settle_ai_weekly_allowance", {
      p_user_id: session.user.id,
      p_request_id: requestId,
      p_status: status,
    });
    const row = rows?.[0];
    return row ? {
      entryId: row.entry_id,
      status: row.entry_status,
      periodKey: row.period_key,
      creditCost: Number(row.credit_cost || 0),
      used: Number(row.used || 0),
    } : null;
  }

  async beginRoutedAiOperation(session, request = {}) {
    const route = this.route(session);
    const rows = await route.client.rpc("begin_routed_ai_operation", {
      p_user_id: session.user.id,
      p_plan_tier: request.planTier,
      p_period_key: request.periodKey,
      p_allowance: request.allowance,
      p_action_type: request.actionType,
      p_credit_cost: request.creditCost,
      p_request_id: request.requestId,
      p_request_fingerprint: request.requestFingerprint,
      p_lease_ms: request.leaseMs,
      p_metadata: request.metadata || {},
    });
    const row = rows?.[0] || {};
    return {
      allowed: row.allowed === true,
      busy: row.busy === true,
      sameOperation: row.same_operation === true,
      replay: row.replay === true,
      allowance: Number(row.allowance || request.allowance || 0),
      used: Number(row.used || 0),
      remaining: Number(row.remaining || 0),
      entryId: row.entry_id || null,
      status: row.entry_status || null,
      routingStatus: row.routing_status || null,
      successfulCount: Number(row.successful_count || 0),
      selectedOrdinal: row.selected_ordinal ? Number(row.selected_ordinal) : null,
      leaseExpiresAt: row.lease_expires_at || null,
      outcome: row.outcome || null,
    };
  }

  async completeRoutedAiOperation(session, completion = {}) {
    const route = this.route(session);
    const rows = await route.client.rpc("complete_routed_ai_operation", {
      p_user_id: session.user.id,
      p_request_id: completion.requestId,
      p_succeeded: completion.succeeded === true,
      p_primary_provider: completion.primaryProvider || null,
      p_final_provider: completion.finalProvider || null,
      p_attempts: Array.isArray(completion.attempts) ? completion.attempts : [],
      p_outcome: completion.outcome || null,
    });
    const row = rows?.[0];
    return row ? {
      entryId: row.entry_id,
      status: row.entry_status,
      routingStatus: row.routing_status,
      periodKey: row.period_key,
      creditCost: Number(row.credit_cost || 0),
      used: Number(row.used || 0),
      successfulCount: Number(row.successful_count || 0),
      changed: row.changed === true,
      outcome: row.outcome || null,
    } : null;
  }

  async getAiWeeklySuccessfulRequestCount(session, { periodKey } = {}) {
    const route = this.route(session);
    const rows = await route.client.select("ai_usage_ledger", {
      columns: "id",
      filters: {
        user_id: `eq.${session.user.id}`,
        period_key: `eq.${periodKey}`,
        status: "eq.charged",
      },
    });
    return rows.length;
  }

  async uploadExportPackage(session, { bucket, path, bytes, mimeType }) {
    assertOwnedExportPath(session.user.id, path);
    const route = this.route(session);
    return route.client.uploadObject(bucket, path, bytes, {
      contentType: mimeType || "application/json; charset=utf-8",
      upsert: true,
    });
  }

  async downloadExportPackage(session, { bucket, path }) {
    assertOwnedExportPath(session.user.id, path);
    const route = this.route(session);
    const bytes = await route.client.downloadObject(bucket, path);
    return { downloaded: true, mode: "private_supabase_storage", bytes };
  }

  async deleteExportPackage(session, { bucket, path }) {
    assertOwnedExportPath(session.user.id, path);
    const route = this.route(session);
    return route.client.deleteObjects(bucket, [path]);
  }

  async listExpiredExportRequests({ now = new Date(), limit = 100 } = {}) {
    const requests = [];
    for (const shard of this.shardClients.filter((item) => item?.client?.isConfigured?.())) {
      const rows = await shard.client.select("data_export_requests", {
        columns: "*",
        filters: {
          retention_expires_at: `lte.${now.toISOString()}`,
          package_deleted_at: "is.null",
          storage_path: "not.is.null",
        },
        order: "retention_expires_at.asc",
        limit,
      });
      requests.push(...rows.map((row) => ({
        ...(row.payload || {}),
        id: row.id,
        userId: row.user_id,
        storageBucket: row.storage_bucket,
        storagePath: row.storage_path,
        retentionExpiresAt: row.retention_expires_at,
        packageDeletedAt: row.package_deleted_at,
      })));
    }
    return requests
      .sort((left, right) => Date.parse(left.retentionExpiresAt) - Date.parse(right.retentionExpiresAt))
      .slice(0, limit);
  }

  async insertDeletionExecutionEvidence(session, evidence) {
    const route = this.route(session);
    return route.client.insert("deletion_execution_evidence", {
      id: evidence.id,
      user_id: evidence.userId,
      deletion_request_id: evidence.deletionRequestId,
      evidence_type: evidence.evidenceType,
      status: evidence.status,
      approvals: evidence.approvals || [],
      dry_run_report: evidence.dryRunReport || {},
      dry_run_diff: evidence.dryRunDiff || {},
      affected_counts: evidence.affectedCounts || {},
      billing_policy: evidence.billingPolicy || {},
      auth_deletion: evidence.authDeletion || {},
      metadata: evidence.metadata || {},
      created_at: evidence.createdAt,
    }, { returning: "minimal" });
  }

  async listDeletionExecutionEvidence(session) {
    const route = this.route(session);
    const rows = await route.client.select("deletion_execution_evidence", {
      columns: "id,deletion_request_id,evidence_type,status,approvals,dry_run_diff,affected_counts,billing_policy,auth_deletion,metadata,created_at",
      filters: { user_id: `eq.${session.user.id}` },
      order: "created_at.desc",
      limit: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      deletionRequestId: row.deletion_request_id,
      evidenceType: row.evidence_type,
      status: row.status,
      approvals: row.approvals || [],
      dryRunDiff: row.dry_run_diff || {},
      affectedCounts: row.affected_counts || {},
      billingPolicy: row.billing_policy || {},
      authDeletion: row.auth_deletion || {},
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
  }

  async executeFinalAccountDeletion(session, { userId, sourceObjects = [], exportObjects = [] } = {}) {
    if (!userId || userId !== session.user.id) throw new Error("final_deletion_user_mismatch");
    const route = this.route(session);
    for (const storageObject of sourceObjects) {
      if (storageObject.bucket && storageObject.path) {
        await route.client.deleteObjects(storageObject.bucket, [storageObject.path]);
      }
    }
    for (const storageObject of exportObjects) {
      assertOwnedExportPath(userId, storageObject.path);
      if (storageObject.bucket && storageObject.path) {
        await route.client.deleteObjects(storageObject.bucket, [storageObject.path]);
      }
    }
    const userFilter = { user_id: `eq.${userId}` };
    const tables = [
      "account_deletion_reviews",
      "role_invitations",
      "data_export_jobs",
      "data_export_requests",
      "legal_acceptances",
      "user_consents",
      "consent_versions",
      "billing_webhook_events",
      "billing_subscriptions",
      "job_events",
      "background_jobs",
      "embeddings_metadata",
      "memory_items",
      "ai_usage_ledger",
      "ai_messages",
      "ai_conversations",
      "audit_logs",
      "assignment_automation_contracts",
      "tutor_lessons",
      "revision_events",
      "roadmap_items",
      "credit_ledger",
      "test_results",
      "test_sessions",
      "source_chunks",
      "source_materials",
      "notes",
      "timetable_events",
      "assignments",
      "classroom_items",
      "exams",
      "syllabi",
      "topics",
      "courses",
      "account_deletion_requests",
    ];
    for (const table of tables) {
      await route.client.deleteRows(table, { filters: userFilter });
    }
    await route.client.deleteRows("student_profiles", { filters: userFilter });
    return {
      deleted: true,
      mode: "supabase",
      storageApiCleanupExecuted: true,
      evidencePreserved: true,
    };
  }

  async insertOperatorAuditEvent(session, event) {
    const route = session?.user?.id
      ? this.route(session)
      : this.shardClients.find((item) => item?.client?.isConfigured?.());
    if (!route?.client) throw new Error("operator_audit_shard_unavailable");
    return route.client.insert("operator_audit_events", {
      id: event.id,
      target_user_id: event.targetUserId || null,
      request_id: event.requestId,
      operator_id: event.operatorId,
      operator_role: event.operatorRole,
      action: event.action,
      note: event.note,
      metadata: event.metadata || {},
      created_at: event.createdAt,
    }, { returning: "minimal" });
  }

  async listOperatorAuditEvents(session) {
    const route = this.route(session);
    const rows = await route.client.select("operator_audit_events", {
      columns: "id,target_user_id,request_id,operator_id,operator_role,action,note,metadata,created_at",
      filters: { target_user_id: `eq.${session.user.id}` },
      order: "created_at.desc",
      limit: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      targetUserId: row.target_user_id,
      requestId: row.request_id,
      operatorId: row.operator_id,
      operatorRole: row.operator_role,
      action: row.action,
      note: row.note,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
  }

  async insertBillingCancellationEvent(session, event) {
    const route = this.route(session);
    return route.client.insert("billing_cancellation_events", {
      id: event.id,
      target_user_id: event.targetUserId,
      deletion_request_id: event.deletionRequestId || null,
      request_id: event.requestId,
      operator_id: event.operatorId,
      provider: event.provider,
      status: event.status,
      note: event.note,
      metadata: event.metadata || {},
      created_at: event.createdAt,
    }, { returning: "minimal" });
  }

  async listBillingCancellationEvents(session) {
    const route = this.route(session);
    const rows = await route.client.select("billing_cancellation_events", {
      columns: "id,target_user_id,deletion_request_id,request_id,operator_id,provider,status,note,metadata,created_at",
      filters: { target_user_id: `eq.${session.user.id}` },
      order: "created_at.desc",
      limit: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      targetUserId: row.target_user_id,
      deletionRequestId: row.deletion_request_id,
      requestId: row.request_id,
      operatorId: row.operator_id,
      provider: row.provider,
      status: row.status,
      note: row.note,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
  }

  async insertMonitoringAlertEvent(session, event) {
    const route = session?.user?.id
      ? this.route(session)
      : this.shardClients.find((item) => item?.client?.isConfigured?.());
    if (!route?.client) throw new Error("monitoring_alert_shard_unavailable");
    return route.client.insert("monitoring_alert_events", {
      id: event.id,
      target_user_id: event.targetUserId || null,
      request_id: event.requestId,
      alert_type: event.alertType,
      severity: event.severity,
      source: event.source,
      message: event.message,
      metadata: event.metadata || {},
      created_at: event.createdAt,
    }, { returning: "minimal" });
  }

  async listMonitoringAlertEvents(session) {
    const route = this.route(session);
    const rows = await route.client.select("monitoring_alert_events", {
      columns: "id,target_user_id,request_id,alert_type,severity,source,message,metadata,created_at",
      filters: { target_user_id: `eq.${session.user.id}` },
      order: "created_at.desc",
      limit: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      targetUserId: row.target_user_id,
      requestId: row.request_id,
      alertType: row.alert_type,
      severity: row.severity,
      source: row.source,
      message: row.message,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
  }

  async uploadStorageObject(session, { bucket, path, bytes, mimeType }) {
    const route = this.route(session);
    return route.client.uploadObject(bucket, path, bytes, {
      contentType: mimeType,
      upsert: false,
    });
  }

  async deleteStorageObject(session, { bucket, path }) {
    if (!bucket || !path) return { deleted: false, reason: "missing_storage_reference" };
    const route = this.route(session);
    return route.client.deleteObjects(bucket, [path]);
  }

  async downloadStorageObject(session, { bucket, path }) {
    if (!bucket || !path) throw new Error("missing_storage_reference");
    const route = this.route(session);
    const bytes = await route.client.downloadObject(bucket, path);
    return {
      downloaded: true,
      mode: "private_supabase_storage",
      bytes,
    };
  }

  async hardDeleteSourceArtifacts(session, {
    sourceId,
    storageBucket,
    storagePath,
    memoryItemIds = [],
    sourceChunkIds = [],
    embeddingIds = [],
    jobIds = [],
    jobEventIds = [],
    assignmentIds = [],
    syllabusIds = [],
  } = {}) {
    if (!sourceId && !assignmentIds.length) throw new Error("academic_context_record_required");
    const route = this.route(session);
    if (storageBucket && storagePath) {
      await route.client.deleteObjects(storageBucket, [storagePath]);
    }
    const userFilter = `eq.${session.user.id}`;
    const deletes = sourceId ? [
      ["job_events", { user_id: userFilter, source_id: `eq.${sourceId}` }],
      ["background_jobs", { user_id: userFilter, source_id: `eq.${sourceId}` }],
      ["source_chunks", { user_id: userFilter, source_material_id: `eq.${sourceId}` }],
      ["embeddings_metadata", { user_id: userFilter, source_material_id: `eq.${sourceId}` }],
      ["source_materials", { user_id: userFilter, id: `eq.${sourceId}` }],
    ] : [];
    const memoryFilter = inFilter(memoryItemIds);
    if (memoryFilter) deletes.unshift(["memory_items", { user_id: userFilter, id: memoryFilter }]);
    const chunkFilter = inFilter(sourceChunkIds);
    if (chunkFilter) deletes.unshift(["source_chunks", { user_id: userFilter, id: chunkFilter }]);
    const embeddingFilter = inFilter(embeddingIds);
    if (embeddingFilter) deletes.unshift(["embeddings_metadata", { user_id: userFilter, id: embeddingFilter }]);
    const jobFilter = inFilter(jobIds);
    if (jobFilter) deletes.unshift(["background_jobs", { user_id: userFilter, id: jobFilter }]);
    const eventFilter = inFilter(jobEventIds);
    if (eventFilter) deletes.unshift(["job_events", { user_id: userFilter, id: eventFilter }]);
    const assignmentFilter = inFilter(assignmentIds);
    if (assignmentFilter) deletes.unshift(["assignments", { user_id: userFilter, id: assignmentFilter }]);
    const syllabusFilter = inFilter(syllabusIds);
    if (syllabusFilter) deletes.unshift(["syllabi", { user_id: userFilter, id: syllabusFilter }]);
    for (const [table, filters] of deletes) {
      await route.client.deleteRows(table, { filters });
    }
    return {
      hardDeleted: true,
      mode: "supabase",
      storageObjectDeleteRequested: Boolean(storagePath),
    };
  }

  async deleteAcademicExam(session, examId) {
    const route = this.route(session);
    await route.client.deleteRows("exams", {
      filters: {
        user_id: `eq.${session.user.id}`,
        id: `eq.${examId}`,
      },
    });
    return { deleted: true, mode: "supabase" };
  }

  async saveAiConversation(session, conversation, messages) {
    const state = await this.loadState(session);
    const conversationIndex = state.aiConversations.findIndex((item) => item.id === conversation.id);
    if (conversationIndex >= 0) state.aiConversations[conversationIndex] = conversation;
    else state.aiConversations.push(conversation);
    for (const message of messages) {
      const messageIndex = state.aiMessages.findIndex((item) => item.id === message.id);
      if (messageIndex >= 0) state.aiMessages[messageIndex] = message;
      else state.aiMessages.push(message);
    }
    await this.saveChangedCollections(session, state, ["aiConversations", "aiMessages"]);
  }

  async retrieveGroundedChunks(session, { state, message, topic, course, limit = 4 }) {
    if (!this.canUseSupabase(session)) {
      return localRetrieval({ state, message, topic, course, limit });
    }
    const route = this.route(session);
    if (!route.client?.rpc) {
      return localRetrieval({ state, message, topic, course, limit, fallbackReason: "rpc_client_unavailable" });
    }
    try {
      const queryEmbedding = createDeterministicEmbedding([
        message,
        topic?.title || "",
        course?.title || "",
        ...(topic?.weakSignals || []),
      ].join(" "));
      const rows = await route.client.rpc("match_source_chunks", {
        p_user_id: session.user.id,
        p_query_embedding: queryEmbedding,
        p_course_id: course?.id || null,
        p_topic_id: topic?.id || null,
        p_match_count: limit,
        p_min_similarity: MIN_GROUNDING_CONFIDENCE,
      });
      return rpcRowsToRetrieval(rows, { fallbackMode: rows?.[0]?.retrieval_mode || "rpc-vector" });
    } catch (error) {
      return localRetrieval({
        state,
        message,
        topic,
        course,
        limit,
        fallbackReason: safeErrorLabel(error),
      });
    }
  }

  async listRunnableJobs({ limit = 25 } = {}) {
    const jobs = [];
    for (const shard of this.shardClients.filter((item) => item?.client?.isConfigured?.())) {
      const rows = await shard.client.select("background_jobs", {
        columns: "payload",
        filters: { status: "eq.queued" },
        order: "created_at.asc",
        limit,
      });
      jobs.push(...rows.map(fromPayload).filter(Boolean));
    }
    return jobs
      .sort((left, right) => Date.parse(left.createdAt || "") - Date.parse(right.createdAt || ""))
      .slice(0, limit);
  }

  async claimNextBackgroundJob({ workerId = "studentos-worker", lockTimeoutSeconds = 600 } = {}) {
    for (const shard of this.shardClients.filter((item) => item?.client?.isConfigured?.())) {
      if (!shard.client?.rpc) continue;
      try {
        const rows = await shard.client.rpc("claim_next_background_job", {
          p_worker_id: workerId,
          p_lock_timeout_seconds: lockTimeoutSeconds,
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        const job = backgroundJobFromRow(row);
        if (job?.id) return job;
      } catch (error) {
        continue;
      }
    }
    const fallbackJobs = await this.listRunnableJobs({ limit: 1 });
    const fallbackJob = fallbackJobs[0] || null;
    if (!fallbackJob?.id || !fallbackJob.userId) return null;
    fallbackJob.status = "processing";
    fallbackJob.lockedAt = nowIso();
    fallbackJob.attempts = Number(fallbackJob.attempts || 0) + 1;
    fallbackJob.updatedAt = nowIso();
    fallbackJob.payload = { ...(fallbackJob.payload || {}), workerId, claimMode: "fallback" };
    const route = routeUserToShard(fallbackJob.userId, this.shardClients);
    await route.client.upsert("background_jobs", rowForCollection("backgroundJobs", fallbackJob, fallbackJob.userId), {
      onConflict: "id",
      returning: "minimal",
    });
    return fallbackJob;
  }

  async saveBackgroundJobForUser(user, job, state = null) {
    const session = { authenticated: true, user };
    if (state) {
      await this.saveBackgroundJobs(session, state);
      return;
    }
    const route = routeUserToShard(user.id, this.shardClients);
    await route.client.upsert("background_jobs", rowForCollection("backgroundJobs", job, user.id), {
      onConflict: "id",
      returning: "minimal",
    });
  }

  async claimNextDataExportJob({ workerId = "studentos-export-worker", lockTimeoutSeconds = 600 } = {}) {
    for (const shard of this.shardClients.filter((item) => item?.client?.isConfigured?.())) {
      if (!shard.client?.rpc) continue;
      try {
        const rows = await shard.client.rpc("claim_next_data_export_job", {
          p_worker_id: workerId,
          p_lock_timeout_seconds: lockTimeoutSeconds,
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        const job = dataExportJobFromRow(row);
        if (job?.id) return job;
      } catch {
        continue;
      }
    }
    for (const shard of this.shardClients.filter((item) => item?.client?.isConfigured?.())) {
      const rows = await shard.client.select("data_export_jobs", {
        columns: "*",
        filters: { status: "eq.queued" },
        order: "created_at.asc",
        limit: 1,
      });
      const job = dataExportJobFromRow(rows[0]);
      if (!job?.id || !job.userId) continue;
      job.status = "processing";
      job.lockedAt = nowIso();
      job.attempts = Number(job.attempts || 0) + 1;
      job.updatedAt = nowIso();
      job.workerId = workerId;
      await shard.client.upsert("data_export_jobs", rowForCollection("dataExportJobs", job, job.userId), {
        onConflict: "id",
        returning: "minimal",
      });
      return job;
    }
    return null;
  }
}

export class StudentOsRepository {
  constructor({ config, shardClients }) {
    this.mock = new MockStudentOsRepository();
    this.supabase = new SupabaseStudentOsRepository({ config, shardClients });
  }

  useSupabase(session) {
    return this.supabase.canUseSupabase(session);
  }

  getInfo(session) {
    return this.useSupabase(session) ? this.supabase.getInfo(session) : this.mock.getInfo(session);
  }

  async loadState(session) {
    return this.useSupabase(session) ? this.supabase.loadState(session) : this.mock.loadState(session);
  }

  async saveState(session, state) {
    return this.useSupabase(session) ? this.supabase.saveState(session, state) : this.mock.saveState(session, state);
  }

  async saveTestResultBundle(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveTestResultBundle(session, state)
      : this.mock.saveTestResultBundle(session, state);
  }

  async saveAssignmentFlow(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveAssignmentFlow(session, state)
      : this.mock.saveAssignmentFlow(session, state);
  }

  async saveAssignmentContract(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveAssignmentContract(session, state)
      : this.mock.saveAssignmentContract(session, state);
  }

  async saveTutorLesson(session, state) {
    return this.useSupabase(session) ? this.supabase.saveTutorLesson(session, state) : this.mock.saveTutorLesson(session, state);
  }

  async saveSourceMaterial(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveSourceMaterial(session, state)
      : this.mock.saveSourceMaterial(session, state);
  }

  async saveSourceIngestion(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveSourceIngestion(session, state)
      : this.mock.saveSourceIngestion(session, state);
  }

  async saveBackgroundJobs(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveBackgroundJobs(session, state)
      : this.mock.saveBackgroundJobs(session, state);
  }

  async saveAccountLifecycle(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveAccountLifecycle(session, state)
      : this.mock.saveAccountLifecycle(session, state);
  }

  async saveDataExportState(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveDataExportState(session, state)
      : this.mock.saveDataExportState(session, state);
  }

  async saveClassroomToken(session, record) {
    return this.useSupabase(session)
      ? this.supabase.saveClassroomToken(session, record)
      : this.mock.saveClassroomToken(session, record);
  }

  async getClassroomToken(session) {
    return this.useSupabase(session)
      ? this.supabase.getClassroomToken(session)
      : this.mock.getClassroomToken(session);
  }

  async deleteClassroomToken(session) {
    return this.useSupabase(session)
      ? this.supabase.deleteClassroomToken(session)
      : this.mock.deleteClassroomToken(session);
  }

  async markClassroomTokenStatus(session, statusPatch) {
    return this.useSupabase(session)
      ? this.supabase.markClassroomTokenStatus(session, statusPatch)
      : this.mock.markClassroomTokenStatus(session, statusPatch);
  }

  async saveClassroomSyncRun(session, run) {
    return this.useSupabase(session)
      ? this.supabase.saveClassroomSyncRun(session, run)
      : this.mock.saveClassroomSyncRun(session, run);
  }

  async listClassroomSyncRuns(session, options) {
    return this.useSupabase(session)
      ? this.supabase.listClassroomSyncRuns(session, options)
      : this.mock.listClassroomSyncRuns(session, options);
  }

  async reserveAiWeeklyAllowance(session, request) {
    return this.useSupabase(session)
      ? this.supabase.reserveAiWeeklyAllowance(session, request)
      : this.mock.reserveAiWeeklyAllowance(session, request);
  }

  async settleAiWeeklyAllowance(session, settlement) {
    return this.useSupabase(session)
      ? this.supabase.settleAiWeeklyAllowance(session, settlement)
      : this.mock.settleAiWeeklyAllowance(session, settlement);
  }

  async beginRoutedAiOperation(session, request) {
    return this.useSupabase(session)
      ? this.supabase.beginRoutedAiOperation(session, request)
      : this.mock.beginRoutedAiOperation(session, request);
  }

  async completeRoutedAiOperation(session, completion) {
    return this.useSupabase(session)
      ? this.supabase.completeRoutedAiOperation(session, completion)
      : this.mock.completeRoutedAiOperation(session, completion);
  }

  async getAiWeeklySuccessfulRequestCount(session, request) {
    return this.useSupabase(session)
      ? this.supabase.getAiWeeklySuccessfulRequestCount(session, request)
      : this.mock.getAiWeeklySuccessfulRequestCount(session, request);
  }

  async uploadExportPackage(session, storageObject) {
    return this.useSupabase(session)
      ? this.supabase.uploadExportPackage(session, storageObject)
      : this.mock.uploadExportPackage(session, storageObject);
  }

  async downloadExportPackage(session, storageObject) {
    return this.useSupabase(session)
      ? this.supabase.downloadExportPackage(session, storageObject)
      : this.mock.downloadExportPackage(session, storageObject);
  }

  async deleteExportPackage(session, storageObject) {
    return this.useSupabase(session)
      ? this.supabase.deleteExportPackage(session, storageObject)
      : this.mock.deleteExportPackage(session, storageObject);
  }

  async listExpiredExportRequests(options) {
    return this.supabase.config.mode === "supabase"
      ? this.supabase.listExpiredExportRequests(options)
      : this.mock.listExpiredExportRequests(options);
  }

  async insertDeletionExecutionEvidence(session, evidence) {
    return this.useSupabase(session)
      ? this.supabase.insertDeletionExecutionEvidence(session, evidence)
      : this.mock.insertDeletionExecutionEvidence(session, evidence);
  }

  async listDeletionExecutionEvidence(session) {
    return this.useSupabase(session)
      ? this.supabase.listDeletionExecutionEvidence(session)
      : this.mock.listDeletionExecutionEvidence(session);
  }

  async executeFinalAccountDeletion(session, plan) {
    return this.useSupabase(session)
      ? this.supabase.executeFinalAccountDeletion(session, plan)
      : this.mock.executeFinalAccountDeletion(session, plan);
  }

  async insertOperatorAuditEvent(session, event) {
    return this.supabase.config.mode === "supabase"
      ? this.supabase.insertOperatorAuditEvent(session, event)
      : this.mock.insertOperatorAuditEvent(session, event);
  }

  async listOperatorAuditEvents(session) {
    return this.useSupabase(session)
      ? this.supabase.listOperatorAuditEvents(session)
      : this.mock.listOperatorAuditEvents(session);
  }

  async insertBillingCancellationEvent(session, event) {
    return this.useSupabase(session)
      ? this.supabase.insertBillingCancellationEvent(session, event)
      : this.mock.insertBillingCancellationEvent(session, event);
  }

  async listBillingCancellationEvents(session) {
    return this.useSupabase(session)
      ? this.supabase.listBillingCancellationEvents(session)
      : this.mock.listBillingCancellationEvents(session);
  }

  async insertMonitoringAlertEvent(session, event) {
    return this.supabase.config.mode === "supabase"
      ? this.supabase.insertMonitoringAlertEvent(session, event)
      : this.mock.insertMonitoringAlertEvent(session, event);
  }

  async listMonitoringAlertEvents(session) {
    return this.useSupabase(session)
      ? this.supabase.listMonitoringAlertEvents(session)
      : this.mock.listMonitoringAlertEvents(session);
  }

  async hardDeleteSourceArtifacts(session, cleanup) {
    return this.useSupabase(session)
      ? this.supabase.hardDeleteSourceArtifacts(session, cleanup)
      : this.mock.hardDeleteSourceArtifacts(session, cleanup);
  }

  async deleteAcademicExam(session, examId) {
    return this.useSupabase(session)
      ? this.supabase.deleteAcademicExam(session, examId)
      : this.mock.deleteAcademicExam(session, examId);
  }

  async uploadStorageObject(session, storageObject) {
    if (!this.useSupabase(session)) return this.mock.uploadStorageObject(session, storageObject);
    return this.supabase.uploadStorageObject(session, storageObject);
  }

  async downloadStorageObject(session, storageObject) {
    if (!this.useSupabase(session)) return this.mock.downloadStorageObject(session, storageObject);
    return this.supabase.downloadStorageObject(session, storageObject);
  }

  async deleteStorageObject(session, storageObject) {
    if (!this.useSupabase(session)) return this.mock.deleteStorageObject(session, storageObject);
    return this.supabase.deleteStorageObject(session, storageObject);
  }

  async saveAiConversation(session, conversation, messages) {
    return this.useSupabase(session)
      ? this.supabase.saveAiConversation(session, conversation, messages)
      : this.mock.saveAiConversation(session, conversation, messages);
  }

  async retrieveGroundedChunks(session, args) {
    return this.useSupabase(session)
      ? this.supabase.retrieveGroundedChunks(session, args)
      : this.mock.retrieveGroundedChunks(session, args);
  }

  async listRunnableJobs(options) {
    return this.supabase.config.mode === "supabase"
      ? this.supabase.listRunnableJobs(options)
      : this.mock.listRunnableJobs(options);
  }

  async claimNextBackgroundJob(options) {
    return this.supabase.config.mode === "supabase"
      ? this.supabase.claimNextBackgroundJob(options)
      : this.mock.claimNextBackgroundJob(options);
  }

  async saveBackgroundJobForUser(user, job, state = null) {
    return this.supabase.config.mode === "supabase"
      ? this.supabase.saveBackgroundJobForUser(user, job, state)
      : this.mock.saveBackgroundJobForUser(user, job, state);
  }

  async claimNextDataExportJob(options) {
    return this.supabase.config.mode === "supabase"
      ? this.supabase.claimNextDataExportJob(options)
      : this.mock.claimNextDataExportJob(options);
  }
}
