import { createHash, randomUUID } from "node:crypto";
import { isAcademicContextRecord, isClassroomRecord } from "../connectors/googleClassroom/mapper.js";

export const ACADEMIC_CONTEXT_ARTIFACT_KINDS = Object.freeze([
  "assignment",
  "material",
  "syllabus",
  "exam_schedule",
]);

export const ACADEMIC_CONTEXT_STATUSES = Object.freeze({
  EMPTY: "context_empty",
  NEEDS_PREPARATION: "context_needs_preparation",
  PREPARING: "context_preparing",
  READY: "context_ready",
  FAILED: "context_failed",
});

const COURSE_REQUIRED_ARTIFACT_KINDS = new Set(["assignment", "material", "syllabus"]);
const READY_SOURCE_STATUSES = new Set(["indexed", "ready", "completed"]);
const PENDING_SOURCE_STATUSES = new Set(["pending", "queued", "uploading", "extracting", "processing", "preparing"]);
const FAILED_SOURCE_STATUSES = new Set(["failed", "needs_ocr", "needs_attention"]);
const PREPARATION_SETTLE_MS = 600;

function academicContextError(message, code) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function normalizedArtifactKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return ACADEMIC_CONTEXT_ARTIFACT_KINDS.includes(kind) ? kind : null;
}

function normalizedDeadline(value) {
  const deadline = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  const parsed = new Date(`${deadline}T23:59:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== deadline
    ? null
    : deadline;
}

function clean(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizedExamTime(value) {
  const time = clean(value, 5);
  if (!time) return null;
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
}

function activeAcademicContext(state = {}) {
  const courses = availableAcademicCourses(state);
  const courseIds = new Set(courses.map((course) => String(course.id)));
  const included = (item) => isAcademicContextRecord(item) && item?.academicContextIncluded !== false;
  const syllabi = (state.syllabi || []).filter((item) => included(item) && (!item.courseId || courseIds.has(String(item.courseId))));
  const exams = (state.exams || []).filter((item) => included(item) && (!item.courseId || courseIds.has(String(item.courseId))));
  const assignments = (state.assignments || []).filter((item) => included(item) && (!item.courseId || courseIds.has(String(item.courseId))));
  const materials = (state.sourceMaterials || []).filter((item) => !item.deletedAt && included(item));
  return { courses, syllabi, exams, assignments, materials };
}

function contextCounts(context) {
  return Object.fromEntries(Object.entries(context).map(([key, items]) => [key, items.length]));
}

function hasAnyAcademicContext(context) {
  return Object.values(contextCounts(context)).some((count) => count > 0);
}

function hasUsefulAcademicContext(context) {
  return context.exams.length > 0 ||
    context.assignments.length > 0 ||
    context.materials.length > 0 ||
    context.syllabi.some((item) => item.sourceMaterialId || (item.units || []).length > 0);
}

function contextFingerprintPayload(context) {
  const pick = (items, fields) => items.map((item) => Object.fromEntries(fields.map((field) => [field, item?.[field] ?? null])));
  return {
    courses: pick(context.courses, ["id", "title", "term", "updatedAt", "archivedAt"]),
    syllabi: pick(context.syllabi, ["id", "courseId", "title", "units", "sourceMaterialId", "updatedAt"]),
    exams: pick(context.exams, ["id", "courseId", "title", "examDate", "examTime", "marksWeightage", "notes", "updatedAt"]),
    assignments: pick(context.assignments, ["id", "courseId", "title", "dueAt", "dueDate", "status", "updatedAt"]),
    materials: pick(context.materials, ["id", "courseId", "title", "artifactKind", "status", "chunkCount", "indexedAt", "updatedAt"]),
  };
}

export function academicContextFingerprint(state = {}) {
  return createHash("sha256")
    .update(JSON.stringify(contextFingerprintPayload(activeAcademicContext(state))))
    .digest("hex");
}

function publicPreparationMessage(status, { someMaterialPreparing = false } = {}) {
  if (someMaterialPreparing) return "Some material is still being prepared.";
  if (status === ACADEMIC_CONTEXT_STATUSES.EMPTY) return "Add your academic context first.";
  if (status === ACADEMIC_CONTEXT_STATUSES.NEEDS_PREPARATION) return "Your academic context is ready to prepare.";
  if (status === ACADEMIC_CONTEXT_STATUSES.PREPARING) return "Setting things up for you.";
  if (status === ACADEMIC_CONTEXT_STATUSES.READY) return "Your academic context is ready.";
  return "StudentOS could not prepare everything. Review Academic Context and try again.";
}

export function getAcademicContextReadiness(state = {}) {
  const context = activeAcademicContext(state);
  const counts = contextCounts(context);
  const hasContext = hasAnyAcademicContext(context);
  const hasUsefulContext = hasUsefulAcademicContext(context);
  const fingerprint = academicContextFingerprint(state);
  const stored = state.studentProfile?.academicContextPreparation || {};
  let status = stored.status;
  if (!hasContext) status = ACADEMIC_CONTEXT_STATUSES.EMPTY;
  else if (!Object.values(ACADEMIC_CONTEXT_STATUSES).includes(status)) status = ACADEMIC_CONTEXT_STATUSES.NEEDS_PREPARATION;
  else if (status === ACADEMIC_CONTEXT_STATUSES.READY && stored.fingerprint !== fingerprint) {
    status = ACADEMIC_CONTEXT_STATUSES.NEEDS_PREPARATION;
  }
  const someMaterialPreparing = status === ACADEMIC_CONTEXT_STATUSES.PREPARING && context.materials.some((source) => {
    const sourceStatus = String(source.status || source.extractionStatus || "").toLowerCase();
    return PENDING_SOURCE_STATUSES.has(sourceStatus);
  });
  return {
    status,
    hasContext,
    hasUsefulContext,
    counts,
    preparedAt: status === ACADEMIC_CONTEXT_STATUSES.READY ? stored.preparedAt || null : null,
    preparationRequestedAt: stored.preparationRequestedAt || null,
    failedAt: status === ACADEMIC_CONTEXT_STATUSES.FAILED ? stored.failedAt || null : null,
    someMaterialPreparing,
    canPrepare: hasUsefulContext && status !== ACADEMIC_CONTEXT_STATUSES.PREPARING,
    canGenerateTodo: status === ACADEMIC_CONTEXT_STATUSES.READY && stored.fingerprint === fingerprint,
    message: publicPreparationMessage(status, { someMaterialPreparing }),
  };
}

export function markAcademicContextNeedsPreparation(state, reason = "academic_context_changed", { now = new Date() } = {}) {
  state.studentProfile = state.studentProfile || { id: "student_unknown", preferences: {} };
  const context = activeAcademicContext(state);
  const status = hasAnyAcademicContext(context)
    ? ACADEMIC_CONTEXT_STATUSES.NEEDS_PREPARATION
    : ACADEMIC_CONTEXT_STATUSES.EMPTY;
  state.studentProfile.academicContextPreparation = {
    status,
    changedAt: now.toISOString(),
    changeReason: clean(reason, 80),
    preparationRequestedAt: null,
    preparedAt: null,
    failedAt: null,
    fingerprint: null,
    capsule: null,
  };
  state.studentProfile.dailyTodoPlan = null;
  return getAcademicContextReadiness(state);
}

function compactText(value, limit = 900) {
  return clean(value, limit);
}

export function buildPreparedAcademicContextCapsule(state = {}) {
  const context = activeAcademicContext(state);
  const courseById = new Map(context.courses.map((course) => [String(course.id), course]));
  return {
    courses: context.courses.map((course) => ({
      id: course.id,
      title: course.title,
      term: course.term || null,
    })),
    syllabi: context.syllabi.map((syllabus) => ({
      id: syllabus.id,
      courseId: syllabus.courseId || null,
      courseTitle: courseById.get(String(syllabus.courseId))?.title || null,
      title: syllabus.title,
      units: (syllabus.units || []).slice(0, 30),
      sourceMaterialId: syllabus.sourceMaterialId || null,
    })),
    exams: context.exams.map((exam) => ({
      id: exam.id,
      courseId: exam.courseId,
      courseTitle: courseById.get(String(exam.courseId))?.title || null,
      title: exam.title,
      examDate: exam.examDate,
      examTime: exam.examTime || null,
      marksWeightage: exam.marksWeightage || exam.weight || null,
      notes: compactText(exam.notes, 300) || null,
    })),
    assignments: context.assignments.map((assignment) => ({
      id: assignment.id,
      courseId: assignment.courseId,
      courseTitle: courseById.get(String(assignment.courseId))?.title || assignment.courseTitle || null,
      title: assignment.title,
      dueAt: assignment.dueAt || assignment.dueDate || null,
      status: assignment.status || "open",
      handedIn: assignment.handedIn === true,
    })),
    materials: context.materials.map((material) => ({
      id: material.id,
      courseId: material.courseId || null,
      courseTitle: courseById.get(String(material.courseId))?.title || null,
      title: material.title,
      artifactKind: material.artifactKind || "material",
      summary: compactText(material.extractedText || material.extractionSummary, 1200),
      readyForStudy: READY_SOURCE_STATUSES.has(String(material.status || material.extractionStatus || "").toLowerCase()),
    })),
  };
}

export function beginAcademicContextPreparation(state, { now = new Date() } = {}) {
  const readiness = getAcademicContextReadiness(state);
  if (!readiness.hasUsefulContext) {
    throw academicContextError(
      "Add your syllabus, assignments, or exam dates first so StudentOS can generate a useful plan.",
      "academic_context_too_weak",
    );
  }
  state.studentProfile.academicContextPreparation = {
    status: ACADEMIC_CONTEXT_STATUSES.PREPARING,
    changedAt: state.studentProfile.academicContextPreparation?.changedAt || now.toISOString(),
    changeReason: state.studentProfile.academicContextPreparation?.changeReason || "academic_context_changed",
    preparationRequestedAt: now.toISOString(),
    preparedAt: null,
    failedAt: null,
    fingerprint: academicContextFingerprint(state),
    capsule: null,
  };
  state.studentProfile.dailyTodoPlan = null;
  return getAcademicContextReadiness(state);
}

export function advanceAcademicContextPreparation(state, { now = new Date(), force = false } = {}) {
  const stored = state.studentProfile?.academicContextPreparation;
  if (!stored || stored.status !== ACADEMIC_CONTEXT_STATUSES.PREPARING) {
    return { changed: false, readiness: getAcademicContextReadiness(state) };
  }
  const startedAt = Date.parse(stored.preparationRequestedAt || "");
  if (!force && Number.isFinite(startedAt) && now.getTime() - startedAt < PREPARATION_SETTLE_MS) {
    return { changed: false, readiness: getAcademicContextReadiness(state) };
  }
  const context = activeAcademicContext(state);
  const sourceStatuses = context.materials.map((source) => String(source.status || source.extractionStatus || "ready").toLowerCase());
  if (sourceStatuses.some((status) => PENDING_SOURCE_STATUSES.has(status))) {
    return { changed: false, readiness: getAcademicContextReadiness(state) };
  }
  if (sourceStatuses.some((status) => FAILED_SOURCE_STATUSES.has(status))) {
    Object.assign(stored, {
      status: ACADEMIC_CONTEXT_STATUSES.FAILED,
      failedAt: now.toISOString(),
      preparedAt: null,
      capsule: null,
    });
    return { changed: true, readiness: getAcademicContextReadiness(state) };
  }
  Object.assign(stored, {
    status: ACADEMIC_CONTEXT_STATUSES.READY,
    preparedAt: now.toISOString(),
    failedAt: null,
    fingerprint: academicContextFingerprint(state),
    capsule: buildPreparedAcademicContextCapsule(state),
  });
  return { changed: true, readiness: getAcademicContextReadiness(state) };
}

export function getPreparedAcademicContextCapsule(state = {}) {
  const readiness = getAcademicContextReadiness(state);
  if (!readiness.canGenerateTodo) return null;
  return state.studentProfile?.academicContextPreparation?.capsule || null;
}

function normalizedExamInput(state, input = {}) {
  const courseId = clean(input.courseId || input.course_id, 120);
  const course = availableAcademicCourses(state).find((candidate) => String(candidate.id) === courseId);
  if (!course) throw academicContextError("Choose a course for this exam.", "academic_context_exam_course_required");
  const title = clean(input.examName || input.title, 160);
  if (!title) throw academicContextError("Add an exam name.", "academic_context_exam_name_required");
  const examDate = normalizedDeadline(input.examDate || input.exam_date);
  if (!examDate) throw academicContextError("Set the exam date.", "academic_context_exam_date_required");
  const rawExamTime = clean(input.examTime || input.exam_time, 10);
  const examTime = normalizedExamTime(rawExamTime);
  if (rawExamTime && !examTime) throw academicContextError("Use a valid exam time.", "academic_context_exam_time_invalid");
  return {
    course,
    courseId: course.id,
    title,
    examDate,
    examTime,
    marksWeightage: clean(input.marksWeightage || input.weightage || input.weight, 80) || null,
    notes: clean(input.notes, 1000) || null,
  };
}

export function addManualExam(state, input = {}, { now = new Date(), idFactory = randomUUID } = {}) {
  state.exams = state.exams || [];
  const values = normalizedExamInput(state, input);
  const exam = {
    id: `exam_manual_${now.getTime()}_${idFactory().slice(0, 8)}`,
    ...values,
    course: undefined,
    source: "manual",
    readOnly: false,
    academicContextIncluded: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  delete exam.course;
  state.exams.push(exam);
  markAcademicContextNeedsPreparation(state, "exam_added", { now });
  return exam;
}

function findManualExam(state, examId) {
  const exam = (state.exams || []).find((item) => item.id === examId && isAcademicContextRecord(item));
  if (!exam) throw academicContextError("That exam could not be found.", "academic_context_exam_not_found");
  if (exam.source && exam.source !== "manual") {
    throw academicContextError("This exam stays linked to its original setup.", "academic_context_exam_read_only");
  }
  return exam;
}

export function updateManualExam(state, examId, input = {}, { now = new Date() } = {}) {
  const exam = findManualExam(state, examId);
  const values = normalizedExamInput(state, input);
  Object.assign(exam, values, { course: undefined, updatedAt: now.toISOString() });
  delete exam.course;
  markAcademicContextNeedsPreparation(state, "exam_updated", { now });
  return exam;
}

export function removeManualExam(state, examId, { now = new Date() } = {}) {
  const exam = findManualExam(state, examId);
  state.exams = (state.exams || []).filter((item) => item.id !== exam.id);
  markAcademicContextNeedsPreparation(state, "exam_removed", { now });
  return exam;
}

function filenameTitle(filename) {
  return String(filename || "Academic context PDF").replace(/\.pdf$/i, "").trim() || "Academic context PDF";
}

export function availableAcademicCourses(state = {}) {
  return (state.courses || []).filter(isAcademicContextRecord);
}

export function validateManualAcademicContextContract({ state = {}, fields = {}, file = null, pdfValidation = null } = {}) {
  const kind = normalizedArtifactKind(fields.artifactKind || fields.kind);
  if (!kind) throw academicContextError("Choose what this PDF contains before uploading.", "academic_context_kind_required");

  const courses = availableAcademicCourses(state);
  if (!courses.length && COURSE_REQUIRED_ARTIFACT_KINDS.has(kind)) {
    throw academicContextError(
      "Add a course in Setup before uploading academic context.",
      "academic_context_course_setup_required",
    );
  }

  if (!file || pdfValidation?.ok !== true) {
    throw academicContextError("Please upload a PDF for Academic Context.", "academic_context_pdf_required");
  }

  const courseId = String(fields.courseId || fields.course_id || "").trim();
  const course = courses.find((candidate) => String(candidate.id) === courseId);
  if (!course && COURSE_REQUIRED_ARTIFACT_KINDS.has(kind)) {
    throw academicContextError(
      kind === "assignment"
        ? "Choose a course for this assignment."
        : kind === "syllabus"
          ? "Choose a course for this syllabus."
          : "Choose a course for this material.",
      "academic_context_course_required",
    );
  }

  const deadline = kind === "assignment" ? normalizedDeadline(fields.deadline) : null;
  if (kind === "assignment" && !deadline) {
    throw academicContextError(
      "Set the assignment deadline before uploading.",
      "academic_context_deadline_required",
    );
  }

  return {
    kind,
    title: String(fields.title || "").trim() || filenameTitle(file.filename),
    course,
    courseId: course?.id || null,
    deadline,
    dueAt: deadline ? `${deadline}T23:59:00.000Z` : null,
  };
}

function manualAssignmentStatus(dueAt, now = new Date()) {
  const due = Date.parse(dueAt || "");
  if (!Number.isFinite(due)) return "open";
  const remaining = due - now.getTime();
  if (remaining < 0) return "overdue";
  if (remaining <= 72 * 60 * 60 * 1000) return "due_soon";
  return "open";
}

export function linkManualAcademicContextUpload(state, material, contract, { now = new Date() } = {}) {
  const timestamp = now.toISOString();
  Object.assign(material, {
    artifactKind: contract.kind,
    materialKind: contract.kind,
    origin: "manual_upload",
    source: "manual_upload",
    manualUpload: true,
    academicContextIncluded: true,
    selectionState: "imported",
    dueDate: contract.deadline,
    dueAt: contract.dueAt,
    updatedAt: timestamp,
  });

  if (contract.kind === "syllabus") {
    const syllabus = {
      id: `syllabus_upload_${Date.now()}_${randomUUID().slice(0, 8)}`,
      courseId: contract.courseId,
      title: contract.title,
      units: [],
      sourceMaterialId: material.id,
      source: "manual_upload",
      academicContextIncluded: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    material.syllabusId = syllabus.id;
    state.syllabi = state.syllabi || [];
    state.syllabi.push(syllabus);
    return { material, assignment: null, syllabus };
  }

  if (contract.kind !== "assignment") return { material, assignment: null, syllabus: null };

  const assignment = {
    id: `assign_upload_${Date.now()}_${randomUUID().slice(0, 8)}`,
    userId: material.userId,
    courseId: contract.courseId,
    title: contract.title,
    description: "",
    dueDate: contract.deadline,
    dueAt: contract.dueAt,
    status: manualAssignmentStatus(contract.dueAt, now),
    source: "manual_upload",
    origin: "manual_upload",
    submissionState: "NOT_SUBMITTED",
    handedIn: false,
    active: true,
    readOnly: false,
    sourceMaterialId: material.id,
    sourceMaterialIds: [material.id],
    academicContextIncluded: true,
    selectionState: "imported",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  material.assignmentId = assignment.id;
  state.assignments = state.assignments || [];
  state.assignments.push(assignment);
  return { material, assignment, syllabus: null };
}

function linkedSourceIds(assignment = {}) {
  return [...new Set([
    assignment.sourceMaterialId,
    ...(assignment.sourceMaterialIds || []),
  ].filter(Boolean).map(String))];
}

export function buildAcademicContextDeletionPlan(state, { kind, itemId } = {}) {
  const normalizedKind = normalizedArtifactKind(kind);
  const id = String(itemId || "").trim();
  if (!normalizedKind || !id) return null;

  if (normalizedKind === "assignment") {
    const assignment = (state.assignments || []).find((item) => item.id === id && isAcademicContextRecord(item));
    if (!assignment) return null;
    const sourceIds = linkedSourceIds(assignment);
    const classroomItem = assignment.classroomItemId
      ? (state.classroomItems || []).find((item) => item.id === assignment.classroomItemId)
      : null;
    return {
      kind: normalizedKind,
      itemId: id,
      title: assignment.title,
      assignmentIds: [assignment.id],
      syllabusIds: [],
      sourceIds,
      classroomItemIds: classroomItem ? [classroomItem.id] : [],
      courseId: assignment.courseId || null,
      topicIds: assignment.topicIds || [],
    };
  }

  const material = (state.sourceMaterials || []).find((item) => item.id === id && isAcademicContextRecord(item));
  if (!material) return null;
  const assignmentIds = (state.assignments || [])
    .filter((assignment) => linkedSourceIds(assignment).includes(material.id))
    .map((assignment) => assignment.id);
  const syllabusIds = (state.syllabi || [])
    .filter((syllabus) => syllabus.sourceMaterialId === material.id)
    .map((syllabus) => syllabus.id);
  return {
    kind: normalizedKind,
    itemId: id,
    title: material.title,
    assignmentIds,
    syllabusIds,
    sourceIds: [material.id],
    classroomItemIds: material.classroomItemId ? [material.classroomItemId] : [],
    courseId: material.courseId || null,
    topicIds: [],
  };
}

export function applyAcademicContextDeletion(state, plan, { now = new Date() } = {}) {
  const timestamp = now.toISOString();
  const sourceIds = new Set(plan.sourceIds || []);
  const assignmentIds = new Set(plan.assignmentIds || []);
  const syllabusIds = new Set(plan.syllabusIds || []);
  const classroomItemIds = new Set(plan.classroomItemIds || []);
  const topicIds = new Set(plan.topicIds || []);

  state.sourceMaterials = (state.sourceMaterials || []).filter((item) => !sourceIds.has(item.id));
  state.sourceChunks = (state.sourceChunks || []).filter((item) => !sourceIds.has(item.sourceMaterialId || item.sourceId));
  state.memoryItems = (state.memoryItems || []).filter((item) => !(item.sourceMaterialIds || []).some((id) => sourceIds.has(id)));
  state.embeddingsMetadata = (state.embeddingsMetadata || []).filter((item) => !sourceIds.has(item.sourceMaterialId));
  state.backgroundJobs = (state.backgroundJobs || []).filter((item) => !sourceIds.has(item.sourceId));
  state.jobEvents = (state.jobEvents || []).filter((item) => !sourceIds.has(item.sourceId));
  state.assignments = (state.assignments || []).filter((item) => !assignmentIds.has(item.id));
  state.syllabi = (state.syllabi || []).filter((item) => !syllabusIds.has(item.id));

  for (const item of state.classroomItems || []) {
    if (!classroomItemIds.has(item.id)) continue;
    item.selectionState = "ignored";
    item.academicContextIncluded = false;
    item.updatedAt = timestamp;
  }
  for (const topic of state.topics || []) {
    if (!topicIds.has(topic.id)) continue;
    topic.archived = true;
    topic.archivedAt = topic.archivedAt || timestamp;
    topic.academicContextIncluded = false;
    topic.selectionState = isClassroomRecord(topic) ? "ignored" : topic.selectionState;
  }
  for (const roadmapItem of state.roadmap || []) {
    if (!assignmentIds.has(roadmapItem.assignmentId) && !topicIds.has(roadmapItem.topicId)) continue;
    roadmapItem.archived = true;
    roadmapItem.status = "archived";
    roadmapItem.archivedAt = roadmapItem.archivedAt || timestamp;
  }

  const lifecycle = state.studentProfile?.productLifecycle;
  if (lifecycle) {
    const removedIds = new Set([...sourceIds, ...assignmentIds, ...classroomItemIds]);
    lifecycle.selectedMaterialIds = (lifecycle.selectedMaterialIds || []).filter((id) => !removedIds.has(String(id)));
    lifecycle.materialsDraft = lifecycle.materialsDraft || { materialIds: [], materialLabels: [] };
    lifecycle.materialsDraft.materialIds = (lifecycle.materialsDraft.materialIds || []).filter((id) => !removedIds.has(String(id)));
  }

  state.auditLog = state.auditLog || [];
  state.auditLog.push({
    id: `audit_academic_context_delete_${Date.now()}_${randomUUID().slice(0, 6)}`,
    actorId: state.studentProfile?.id || "student_unknown",
    action: "academic_context.deleted_permanently",
    targetType: plan.kind,
    targetId: plan.itemId,
    riskLevel: "medium",
    metadata: {
      localOnly: classroomItemIds.size > 0,
      classroomUnchanged: true,
      removedSourceCount: sourceIds.size,
      removedAssignmentCount: assignmentIds.size,
    },
    createdAt: timestamp,
  });
  markAcademicContextNeedsPreparation(state, `${plan.kind}_removed`, { now });
  return plan;
}
