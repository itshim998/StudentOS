import { randomUUID } from "node:crypto";
import { isAcademicContextRecord, isClassroomRecord } from "../connectors/googleClassroom/mapper.js";

export const ACADEMIC_CONTEXT_ARTIFACT_KINDS = Object.freeze(["assignment", "material"]);

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

function filenameTitle(filename) {
  return String(filename || "Academic context PDF").replace(/\.pdf$/i, "").trim() || "Academic context PDF";
}

export function availableAcademicCourses(state = {}) {
  return (state.courses || []).filter(isAcademicContextRecord);
}

export function validateManualAcademicContextContract({ state = {}, fields = {}, file = null, pdfValidation = null } = {}) {
  const kind = normalizedArtifactKind(fields.artifactKind || fields.kind);
  if (!kind) throw academicContextError("Choose Assignment or Material before uploading.", "academic_context_kind_required");

  const courses = availableAcademicCourses(state);
  if (!courses.length) {
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
  if (!course) {
    throw academicContextError(
      kind === "assignment" ? "Choose a course for this assignment." : "Choose a course for this material.",
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
    courseId: course.id,
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

  if (contract.kind !== "assignment") return { material, assignment: null };

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
  return { material, assignment };
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
  return {
    kind: normalizedKind,
    itemId: id,
    title: material.title,
    assignmentIds,
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
  const classroomItemIds = new Set(plan.classroomItemIds || []);
  const topicIds = new Set(plan.topicIds || []);

  state.sourceMaterials = (state.sourceMaterials || []).filter((item) => !sourceIds.has(item.id));
  state.sourceChunks = (state.sourceChunks || []).filter((item) => !sourceIds.has(item.sourceMaterialId || item.sourceId));
  state.memoryItems = (state.memoryItems || []).filter((item) => !(item.sourceMaterialIds || []).some((id) => sourceIds.has(id)));
  state.embeddingsMetadata = (state.embeddingsMetadata || []).filter((item) => !sourceIds.has(item.sourceMaterialId));
  state.backgroundJobs = (state.backgroundJobs || []).filter((item) => !sourceIds.has(item.sourceId));
  state.jobEvents = (state.jobEvents || []).filter((item) => !sourceIds.has(item.sourceId));
  state.assignments = (state.assignments || []).filter((item) => !assignmentIds.has(item.id));

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
  return plan;
}
