const HANDED_IN_STATES = new Set([
  "TURNED_IN",
  "RETURNED",
  "DONE",
  "GRADED",
  "SUBMITTED",
  "COMPLETE",
  "COMPLETED",
]);

const ACTIVE_SUBMISSION_STATES = new Set([
  "CREATED",
  "NEW",
  "ASSIGNED",
  "OPEN",
  "NOT_SUBMITTED",
  "RECLAIMED_BY_STUDENT",
]);

const CLASSROOM_ITEM_STATES = new Set(["discovered", "selected", "imported", "ignored", "archived"]);

function safeId(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "unknown";
}

function nowIso(now = new Date()) {
  return now.toISOString();
}

function timestampFor(value, fallback = Number.POSITIVE_INFINITY) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function dateOnly(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function classroomAssignmentId(providerCourseId, providerCourseWorkId) {
  return `classroom_assignment_${safeId(providerCourseId)}_${safeId(providerCourseWorkId)}`;
}

function classroomCourseId(providerCourseId) {
  return `classroom_course_${safeId(providerCourseId)}`;
}

function classroomTopicId(providerCourseId, providerCourseWorkId) {
  return `classroom_topic_${safeId(providerCourseId)}_${safeId(providerCourseWorkId)}`;
}

function classroomSourceId(providerCourseId, providerCourseWorkId, providerMaterialId, index = 0) {
  return `classroom_material_${safeId(providerCourseId)}_${safeId(providerCourseWorkId)}_${safeId(providerMaterialId || index)}`;
}

function classroomItemId(type, providerCourseId, externalId, providerMaterialId = "") {
  const suffix = providerMaterialId ? `_${safeId(providerMaterialId)}` : "";
  return `classroom_item_${safeId(type)}_${safeId(providerCourseId)}_${safeId(externalId)}${suffix}`;
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) {
    items.push(item);
    return { action: "discovered", item };
  }
  const existing = items[index];
  const selectionState = CLASSROOM_ITEM_STATES.has(existing.selectionState)
    ? existing.selectionState
    : "discovered";
  const updated = {
    ...existing,
    ...item,
    selectionState,
    selectedAt: existing.selectedAt || item.selectedAt || null,
    importedAt: existing.importedAt || item.importedAt || null,
    academicContextIncluded: existing.academicContextIncluded === true,
    createdAt: existing.createdAt || item.createdAt,
  };
  items[index] = updated;
  return { action: "updated", item: updated };
}

export function isClassroomRecord(item = {}) {
  return item.source === "google_classroom" ||
    item.provider === "google_classroom" ||
    String(item.sourceType || "").startsWith("google_classroom");
}

export function isAcademicContextRecord(item = {}) {
  if (item.archived === true || item.deletedAt) return false;
  if (!isClassroomRecord(item)) return true;
  return item.academicContextIncluded === true && item.selectionState === "imported";
}

export function normalizeClassroomSubmissionState(value, { hasSubmission = true, dueAt = null } = {}) {
  const rawState = String(value || "").trim().toUpperCase();
  const state = rawState || (!hasSubmission && dueAt ? "NOT_SUBMITTED" : "UNKNOWN");
  const handedIn = HANDED_IN_STATES.has(state);
  const active = !handedIn && ACTIVE_SUBMISSION_STATES.has(state);
  return {
    state,
    handedIn,
    active,
    unknown: !handedIn && !active,
  };
}

function assignmentStatus({ dueAt, handedIn, active }, now = new Date()) {
  if (handedIn) return "completed";
  if (!active && !dueAt) return "unknown";
  const due = timestampFor(dueAt);
  if (!Number.isFinite(due)) return "open";
  const remaining = due - now.getTime();
  if (remaining < 0) return "overdue";
  if (remaining <= 72 * 60 * 60 * 1000) return "due_soon";
  return "open";
}

function materialMetadata(material = {}, fallback = {}) {
  return {
    providerMaterialId: material.providerMaterialId || fallback.providerMaterialId || null,
    title: material.title || fallback.title || "Classroom material",
    rawType: material.rawType || fallback.rawType || "material",
    linkUrl: material.linkUrl || fallback.linkUrl || null,
    creationTime: material.creationTime || fallback.creationTime || null,
    updateTime: material.updateTime || fallback.updateTime || null,
  };
}

function courseMap(snapshot = {}) {
  return new Map((snapshot.courses || []).map((course) => [course.providerCourseId, course]));
}

function baseClassroomItem({ id, itemType, providerCourseId, externalId, course, title, now, existing = null }) {
  return {
    id,
    provider: "google_classroom",
    source: "google_classroom",
    itemType,
    externalId,
    providerCourseId,
    courseTitle: course?.title || existing?.courseTitle || "Classroom course",
    courseSection: course?.section || existing?.courseSection || null,
    title: title || "Classroom work",
    selectionState: existing?.selectionState || "discovered",
    selectedAt: existing?.selectedAt || null,
    importedAt: existing?.importedAt || null,
    academicContextIncluded: existing?.academicContextIncluded === true,
    readOnly: true,
    lastSeenAt: nowIso(now),
    createdAt: existing?.createdAt || nowIso(now),
    updatedAt: nowIso(now),
  };
}

function syncImportedAssignment(state, item, now) {
  const assignment = (state.assignments || []).find((candidate) => candidate.classroomItemId === item.id);
  if (!assignment) return;
  assignment.title = item.title;
  assignment.description = item.description || "";
  assignment.dueAt = item.dueAt || null;
  assignment.dueDate = dateOnly(item.dueAt);
  assignment.submissionState = item.submissionState;
  assignment.submissionStatus = item.submissionState;
  assignment.handedIn = item.handedIn === true;
  assignment.status = assignmentStatus(item, now);
  assignment.alternateLink = item.alternateLink || null;
  assignment.classroomUpdatedAt = item.providerUpdatedAt || null;
  assignment.updatedAt = item.providerUpdatedAt || nowIso(now);
}

function discoverAssignmentItems(state, snapshot, summary, now) {
  const courses = courseMap(snapshot);
  const submissions = snapshot.submissions || [];
  for (const work of snapshot.courseWork || []) {
    if (!work.providerCourseId || !work.providerCourseWorkId) {
      summary.skippedItems += 1;
      continue;
    }
    const id = classroomItemId("assignment", work.providerCourseId, work.providerCourseWorkId);
    const existing = state.classroomItems.find((item) => item.id === id) || null;
    const submission = submissions.find((candidate) =>
      candidate.providerCourseId === work.providerCourseId &&
      candidate.providerCourseWorkId === work.providerCourseWorkId) || null;
    let submissionInfo = normalizeClassroomSubmissionState(submission?.state, {
      hasSubmission: Boolean(submission),
      dueAt: work.dueAt,
    });
    if (!submission && existing?.handedIn === true) {
      submissionInfo = normalizeClassroomSubmissionState(existing.submissionState || "TURNED_IN");
    }
    const item = {
      ...baseClassroomItem({
        id,
        itemType: "assignment",
        providerCourseId: work.providerCourseId,
        externalId: work.providerCourseWorkId,
        course: courses.get(work.providerCourseId),
        title: work.title || "Classroom assignment",
        now,
        existing,
      }),
      providerCourseWorkId: work.providerCourseWorkId,
      description: work.description || "",
      dueAt: work.dueAt || null,
      postedAt: work.creationTime || null,
      providerUpdatedAt: work.updateTime || submission?.updateTime || null,
      submissionState: submissionInfo.state,
      handedIn: submissionInfo.handedIn,
      active: submissionInfo.active,
      submissionUnknown: submissionInfo.unknown,
      providerSubmissionId: submission?.providerSubmissionId || null,
      maxPoints: work.maxPoints ?? null,
      workType: work.workType || null,
      alternateLink: work.alternateLink || submission?.alternateLink || null,
    };
    const result = upsertById(state.classroomItems, item);
    if (result.action === "discovered") summary.discoveredAssignments += 1;
    else summary.updatedAssignments += 1;
    if (result.item.academicContextIncluded) syncImportedAssignment(state, result.item, now);

    (work.materials || []).forEach((material, index) => {
      const normalized = materialMetadata(material);
      const materialExternalId = normalized.providerMaterialId || `${work.providerCourseWorkId}_${index}`;
      const materialItemId = classroomItemId("material", work.providerCourseId, work.providerCourseWorkId, materialExternalId);
      const existingMaterial = state.classroomItems.find((candidate) => candidate.id === materialItemId) || null;
      const materialItem = {
        ...baseClassroomItem({
          id: materialItemId,
          itemType: "material",
          providerCourseId: work.providerCourseId,
          externalId: materialExternalId,
          course: courses.get(work.providerCourseId),
          title: normalized.title,
          now,
          existing: existingMaterial,
        }),
        providerCourseWorkId: work.providerCourseWorkId,
        providerMaterialId: normalized.providerMaterialId,
        parentTitle: work.title || "Classroom assignment",
        dueAt: work.dueAt || null,
        postedAt: normalized.creationTime || work.creationTime || null,
        providerUpdatedAt: normalized.updateTime || work.updateTime || null,
        linkUrl: normalized.linkUrl,
        rawType: normalized.rawType,
      };
      const materialResult = upsertById(state.classroomItems, materialItem);
      if (materialResult.action === "discovered") summary.discoveredMaterials += 1;
      else summary.updatedMaterials += 1;
    });
  }
}

function discoverMaterialPostItems(state, snapshot, summary, now) {
  const courses = courseMap(snapshot);
  for (const post of snapshot.courseWorkMaterials || []) {
    if (!post.providerCourseId || !post.providerCourseWorkMaterialId) {
      summary.skippedItems += 1;
      continue;
    }
    const materials = post.materials?.length ? post.materials : [{
      providerMaterialId: post.providerCourseWorkMaterialId,
      title: post.title,
      rawType: "coursework_material",
      linkUrl: post.alternateLink || null,
    }];
    materials.forEach((material, index) => {
      const normalized = materialMetadata(material, post);
      const providerMaterialId = normalized.providerMaterialId || `${post.providerCourseWorkMaterialId}_${index}`;
      const id = classroomItemId("material", post.providerCourseId, `post_${post.providerCourseWorkMaterialId}`, providerMaterialId);
      const existing = state.classroomItems.find((candidate) => candidate.id === id) || null;
      const item = {
        ...baseClassroomItem({
          id,
          itemType: "material",
          providerCourseId: post.providerCourseId,
          externalId: providerMaterialId,
          course: courses.get(post.providerCourseId),
          title: normalized.title || post.title,
          now,
          existing,
        }),
        providerCourseWorkMaterialId: post.providerCourseWorkMaterialId,
        providerMaterialId,
        parentTitle: post.title || null,
        postedAt: normalized.creationTime || post.creationTime || null,
        providerUpdatedAt: normalized.updateTime || post.updateTime || null,
        linkUrl: normalized.linkUrl || post.alternateLink || null,
        rawType: normalized.rawType,
      };
      const result = upsertById(state.classroomItems, item);
      if (result.action === "discovered") summary.discoveredMaterials += 1;
      else summary.updatedMaterials += 1;
    });
  }
}

function applyClassroomRetention(state, summary, retention = {}) {
  const maxAssignments = Number(retention.maxImportedAssignments || 200);
  const maxMaterials = Number(retention.maxImportedMaterials || 400);
  for (const [itemType, limit, summaryKey] of [
    ["assignment", maxAssignments, "evictedAssignments"],
    ["material", maxMaterials, "evictedMaterials"],
  ]) {
    const active = state.classroomItems.filter((item) => item.itemType === itemType && item.selectionState !== "archived");
    if (!Number.isFinite(limit) || limit <= 0 || active.length <= limit) continue;
    const overflow = active
      .filter((item) => !item.academicContextIncluded && !["selected", "imported"].includes(item.selectionState))
      .sort((left, right) => timestampFor(left.lastSeenAt, 0) - timestampFor(right.lastSeenAt, 0))
      .slice(0, active.length - limit);
    overflow.forEach((item) => {
      item.selectionState = "archived";
      item.archivedAt = item.archivedAt || nowIso();
    });
    summary[summaryKey] += overflow.length;
  }
  summary.retentionApplied = summary.evictedAssignments > 0 || summary.evictedMaterials > 0;
}

export function importClassroomSnapshotIntoState(state, snapshot = {}, { now = new Date(), retention = {} } = {}) {
  state.classroomItems = state.classroomItems || [];
  state.assignments = state.assignments || [];
  state.sourceMaterials = state.sourceMaterials || [];
  state.auditLog = state.auditLog || [];
  const summary = {
    discoveredCourses: new Set((snapshot.courses || []).map((course) => course.providerCourseId).filter(Boolean)).size,
    discoveredAssignments: 0,
    updatedAssignments: 0,
    discoveredMaterials: 0,
    updatedMaterials: 0,
    selectedItems: state.classroomItems.filter((item) => item.academicContextIncluded).length,
    importedCourses: 0,
    updatedCourses: 0,
    importedAssignments: 0,
    importedMaterials: 0,
    importedTopics: 0,
    updatedTopics: 0,
    skippedItems: 0,
    evictedAssignments: 0,
    evictedMaterials: 0,
    retentionApplied: false,
    googleClassroomDeleted: false,
    errors: [],
    emptyClassroom: !(snapshot.courseWork || []).length && !(snapshot.courseWorkMaterials || []).length,
  };
  discoverAssignmentItems(state, snapshot, summary, now);
  discoverMaterialPostItems(state, snapshot, summary, now);
  applyClassroomRetention(state, summary, retention);
  state.classroomItems.sort((left, right) => {
    const updated = timestampFor(right.providerUpdatedAt || right.postedAt, 0) - timestampFor(left.providerUpdatedAt || left.postedAt, 0);
    return updated || String(left.id).localeCompare(String(right.id));
  });
  state.auditLog.push({
    id: `audit_classroom_discovery_${now.getTime()}`,
    actorId: state.studentProfile?.id || "student_unknown",
    action: "google_classroom.discovery_completed",
    targetType: "google_classroom",
    targetId: state.studentProfile?.id || "student_unknown",
    riskLevel: "low",
    metadata: {
      readOnly: true,
      discoveredCourses: summary.discoveredCourses,
      discoveredAssignments: summary.discoveredAssignments,
      discoveredMaterials: summary.discoveredMaterials,
      updatedAssignments: summary.updatedAssignments,
      updatedMaterials: summary.updatedMaterials,
      academicContextImports: 0,
      writebackEnabled: false,
    },
    createdAt: nowIso(now),
  });
  return summary;
}

function ensureCourse(state, item, now) {
  const id = classroomCourseId(item.providerCourseId);
  let course = state.courses.find((candidate) => candidate.id === id);
  if (!course) {
    course = { id };
    state.courses.push(course);
  }
  Object.assign(course, {
    title: item.courseTitle || "Classroom course",
    term: item.courseSection || "Classroom",
    source: "google_classroom",
    provider: "google_classroom",
    providerCourseId: item.providerCourseId,
    readOnly: true,
    academicContextIncluded: true,
    selectionState: "imported",
    archived: false,
    updatedAt: item.providerUpdatedAt || nowIso(now),
  });
  return course;
}

function ensureAssignment(state, item, now) {
  const course = ensureCourse(state, item, now);
  const topicId = classroomTopicId(item.providerCourseId, item.providerCourseWorkId);
  let topic = state.topics.find((candidate) => candidate.id === topicId);
  if (!topic) {
    topic = { id: topicId };
    state.topics.push(topic);
  }
  Object.assign(topic, {
    courseId: course.id,
    title: item.title,
    mastery: "new",
    coverageState: "uncovered",
    weakSignals: [],
    source: "google_classroom",
    provider: "google_classroom",
    providerCourseId: item.providerCourseId,
    providerCourseWorkId: item.providerCourseWorkId,
    classroomItemId: item.id,
    academicContextIncluded: true,
    selectionState: "imported",
    archived: false,
    readOnly: true,
    updatedAt: item.providerUpdatedAt || nowIso(now),
  });
  const id = classroomAssignmentId(item.providerCourseId, item.providerCourseWorkId);
  let assignment = state.assignments.find((candidate) => candidate.id === id);
  if (!assignment) {
    assignment = { id, createdAt: nowIso(now) };
    state.assignments.push(assignment);
  }
  Object.assign(assignment, {
    courseId: course.id,
    topicIds: [topic.id],
    title: item.title,
    description: item.description || "",
    dueDate: dateOnly(item.dueAt),
    dueAt: item.dueAt || null,
    status: assignmentStatus(item, now),
    source: "google_classroom",
    provider: "google_classroom",
    providerCourseId: item.providerCourseId,
    providerCourseWorkId: item.providerCourseWorkId,
    providerSubmissionId: item.providerSubmissionId || null,
    submissionStatus: item.submissionState,
    submissionState: item.submissionState,
    handedIn: item.handedIn === true,
    maxPoints: item.maxPoints ?? null,
    workType: item.workType || null,
    alternateLink: item.alternateLink || null,
    classroomUpdatedAt: item.providerUpdatedAt || null,
    importedAt: item.importedAt || nowIso(now),
    updatedAt: item.providerUpdatedAt || nowIso(now),
    automationEligibility: "requires_contract",
    readOnly: true,
    learningFlowReady: true,
    classroomItemId: item.id,
    academicContextIncluded: true,
    selectionState: "imported",
    archived: false,
  });
  return assignment;
}

function ensureMaterial(state, item, now) {
  const course = ensureCourse(state, item, now);
  const workId = item.providerCourseWorkId || `post_${item.providerCourseWorkMaterialId || item.externalId}`;
  const id = classroomSourceId(item.providerCourseId, workId, item.providerMaterialId || item.externalId);
  let source = state.sourceMaterials.find((candidate) => candidate.id === id);
  if (!source) {
    source = { id, createdAt: nowIso(now) };
    state.sourceMaterials.push(source);
  }
  Object.assign(source, {
    courseId: course.id,
    title: item.title,
    kind: "classroom_selected_material",
    sourceType: "google_classroom_selected_material",
    filename: item.title,
    status: "ready",
    extractionSummary: "Selected Classroom work is available as a read-only study reference.",
    citationLabel: `Google Classroom: ${item.title}`,
    webFallbackAllowed: false,
    provider: "google_classroom",
    source: "google_classroom",
    providerCourseId: item.providerCourseId,
    providerCourseWorkId: item.providerCourseWorkId || null,
    providerCourseWorkMaterialId: item.providerCourseWorkMaterialId || null,
    providerMaterialId: item.providerMaterialId || item.externalId,
    linkUrl: item.linkUrl || null,
    readOnly: true,
    importedAt: item.importedAt || nowIso(now),
    updatedAt: item.providerUpdatedAt || nowIso(now),
    classroomItemId: item.id,
    academicContextIncluded: true,
    selectionState: "imported",
    archived: false,
    deletedAt: null,
  });
  return source;
}

function archiveAcademicRecord(record, now) {
  record.academicContextIncluded = false;
  record.selectionState = "ignored";
  record.archived = true;
  record.archivedAt = record.archivedAt || nowIso(now);
  if (record.status && !["completed", "done"].includes(record.status)) record.status = "archived";
}

function archiveSourceArtifacts(state, sourceIds, now) {
  const ids = new Set(sourceIds);
  for (const chunk of state.sourceChunks || []) {
    if (ids.has(chunk.sourceMaterialId || chunk.sourceId)) {
      chunk.deletedAt = chunk.deletedAt || nowIso(now);
      chunk.status = "archived";
    }
  }
  for (const memory of state.memoryItems || []) {
    if (ids.has(memory.sourceMaterialId) || (memory.sourceMaterialIds || []).some((id) => ids.has(id))) {
      memory.deletedAt = memory.deletedAt || nowIso(now);
      memory.status = "archived";
    }
  }
  for (const embedding of state.embeddingsMetadata || []) {
    if (ids.has(embedding.sourceMaterialId)) {
      embedding.deletedAt = embedding.deletedAt || nowIso(now);
      embedding.status = "archived";
    }
  }
  for (const job of state.backgroundJobs || []) {
    if (ids.has(job.sourceId)) job.status = "archived";
  }
}

function archiveItemAcademicContext(state, item, now) {
  const assignments = (state.assignments || []).filter((record) => record.classroomItemId === item.id);
  const sources = (state.sourceMaterials || []).filter((record) => record.classroomItemId === item.id);
  assignments.forEach((record) => archiveAcademicRecord(record, now));
  sources.forEach((record) => archiveAcademicRecord(record, now));
  archiveSourceArtifacts(state, sources.map((record) => record.id), now);
  const assignmentIds = new Set(assignments.map((record) => record.id));
  const topicIds = new Set(assignments.flatMap((record) => record.topicIds || []));
  for (const roadmap of state.roadmap || []) {
    if (assignmentIds.has(roadmap.assignmentId) || [...assignmentIds].some((id) => String(roadmap.id || "").includes(id)) || topicIds.has(roadmap.topicId)) {
      roadmap.status = "archived";
      roadmap.archived = true;
    }
  }
  for (const session of state.testSessions || []) {
    if (assignmentIds.has(session.assignmentId)) archiveAcademicRecord(session, now);
  }
  for (const contract of state.assignmentAutomationContracts || []) {
    if (assignmentIds.has(contract.assignmentId)) archiveAcademicRecord(contract, now);
  }
}

export function selectClassroomItemsForAcademicContext(state, selectedIds = [], { replace = false, now = new Date() } = {}) {
  state.classroomItems = state.classroomItems || [];
  state.courses = state.courses || [];
  state.topics = state.topics || [];
  state.assignments = state.assignments || [];
  state.sourceMaterials = state.sourceMaterials || [];
  state.auditLog = state.auditLog || [];
  const selected = new Set((selectedIds || []).map(String));
  const knownIds = new Set(state.classroomItems
    .filter((item) => item.selectionState !== "archived")
    .map((item) => String(item.id)));
  const unknownIds = [...selected].filter((id) => !knownIds.has(id));
  if (unknownIds.length) {
    const error = new Error("Choose Classroom work currently available for review.");
    error.status = 400;
    error.code = "classroom_selection_invalid";
    throw error;
  }
  if (replace) {
    for (const item of state.classroomItems) {
      if (!item.academicContextIncluded || selected.has(String(item.id))) continue;
      archiveItemAcademicContext(state, item, now);
      item.selectionState = "ignored";
      item.academicContextIncluded = false;
      item.updatedAt = nowIso(now);
    }
  }
  const imported = [];
  for (const item of state.classroomItems) {
    if (!selected.has(String(item.id))) continue;
    item.selectionState = "selected";
    item.selectedAt = item.selectedAt || nowIso(now);
    item.updatedAt = nowIso(now);
    if (item.itemType === "assignment") ensureAssignment(state, item, now);
    else if (item.itemType === "material") ensureMaterial(state, item, now);
    else continue;
    item.selectionState = "imported";
    item.academicContextIncluded = true;
    item.importedAt = item.importedAt || nowIso(now);
    imported.push(item);
  }
  state.auditLog.push({
    id: `audit_classroom_selection_${now.getTime()}`,
    actorId: state.studentProfile?.id || "student_unknown",
    action: "google_classroom.selection_confirmed",
    targetType: "google_classroom",
    targetId: state.studentProfile?.id || "student_unknown",
    riskLevel: "low",
    metadata: {
      selectedItemCount: selected.size,
      importedItemCount: imported.length,
      replace,
      readOnly: true,
      writebackEnabled: false,
    },
    createdAt: nowIso(now),
  });
  return { imported, selectedIds: [...selected], unknownIds: [] };
}

function legacyItemForAssignment(state, assignment, course, now) {
  const providerCourseId = assignment.providerCourseId || course?.providerCourseId || assignment.courseId;
  const providerCourseWorkId = assignment.providerCourseWorkId || assignment.id;
  const submissionInfo = normalizeClassroomSubmissionState(assignment.submissionState || assignment.submissionStatus, {
    hasSubmission: Boolean(assignment.submissionState || assignment.submissionStatus || assignment.providerSubmissionId),
    dueAt: assignment.dueAt || assignment.dueDate,
  });
  return {
    ...baseClassroomItem({
      id: classroomItemId("assignment", providerCourseId, providerCourseWorkId),
      itemType: "assignment",
      providerCourseId,
      externalId: providerCourseWorkId,
      course: { title: course?.title || "Classroom course", section: course?.term || null },
      title: assignment.title,
      now,
    }),
    providerCourseWorkId,
    description: assignment.description || "",
    dueAt: assignment.dueAt || assignment.dueDate || null,
    postedAt: assignment.creationTime || assignment.createdAt || null,
    providerUpdatedAt: assignment.classroomUpdatedAt || assignment.updateTime || assignment.updatedAt || null,
    submissionState: submissionInfo.state,
    handedIn: submissionInfo.handedIn,
    active: submissionInfo.active,
    submissionUnknown: submissionInfo.unknown,
    providerSubmissionId: assignment.providerSubmissionId || null,
    alternateLink: assignment.alternateLink || null,
  };
}

function legacyItemForSource(source, course, now) {
  const providerCourseId = source.providerCourseId || course?.providerCourseId || source.courseId;
  const workId = source.providerCourseWorkId || `post_${source.providerCourseWorkMaterialId || source.id}`;
  const providerMaterialId = source.providerMaterialId || source.id;
  return {
    ...baseClassroomItem({
      id: classroomItemId("material", providerCourseId, workId, providerMaterialId),
      itemType: "material",
      providerCourseId,
      externalId: providerMaterialId,
      course: { title: course?.title || "Classroom course", section: course?.term || null },
      title: source.title,
      now,
    }),
    providerCourseWorkId: source.providerCourseWorkId || null,
    providerCourseWorkMaterialId: source.providerCourseWorkMaterialId || null,
    providerMaterialId,
    postedAt: source.creationTime || source.createdAt || null,
    providerUpdatedAt: source.updateTime || source.updatedAt || null,
    linkUrl: source.linkUrl || null,
    rawType: source.kind || source.sourceType || "material",
  };
}

export function migrateLegacyClassroomAcademicData(state, { now = new Date() } = {}) {
  state.classroomItems = state.classroomItems || [];
  const lifecycle = state.studentProfile?.productLifecycle || {};
  const selectedIds = new Set((lifecycle.selectedMaterialIds || []).map(String));
  const idReplacements = new Map();
  const hiddenAssignmentIds = new Set();
  const hiddenTopicIds = new Set();
  let migratedAssignments = 0;
  let migratedMaterials = 0;
  let hiddenAmbiguousRows = 0;
  for (const assignment of (state.assignments || []).filter(isClassroomRecord)) {
    const linkedItem = assignment.classroomItemId
      ? state.classroomItems.find((item) => item.id === assignment.classroomItemId)
      : null;
    if (linkedItem) {
      idReplacements.set(String(assignment.id), linkedItem.id);
      continue;
    }
    const course = (state.courses || []).find((candidate) => candidate.id === assignment.courseId);
    const legacy = legacyItemForAssignment(state, assignment, course, now);
    const explicit = assignment.academicContextIncluded === true || selectedIds.has(String(assignment.id));
    legacy.selectionState = explicit ? "imported" : assignment.selectionState === "ignored" ? "ignored" : "discovered";
    legacy.academicContextIncluded = explicit;
    legacy.selectedAt = explicit ? assignment.selectedAt || lifecycle.materialsSelectedAt || assignment.importedAt || nowIso(now) : null;
    legacy.importedAt = explicit ? assignment.importedAt || legacy.selectedAt : null;
    const result = upsertById(state.classroomItems, legacy).item;
    idReplacements.set(String(assignment.id), result.id);
    assignment.classroomItemId = result.id;
    assignment.selectionState = explicit ? "imported" : result.selectionState;
    assignment.academicContextIncluded = explicit;
    assignment.handedIn = result.handedIn;
    if (!explicit) {
      archiveAcademicRecord(assignment, now);
      hiddenAssignmentIds.add(String(assignment.id));
      (assignment.topicIds || []).forEach((id) => hiddenTopicIds.add(String(id)));
      hiddenAmbiguousRows += 1;
    }
    migratedAssignments += 1;
  }
  for (const source of (state.sourceMaterials || []).filter(isClassroomRecord)) {
    const linkedItem = source.classroomItemId
      ? state.classroomItems.find((item) => item.id === source.classroomItemId)
      : null;
    if (linkedItem) {
      idReplacements.set(String(source.id), linkedItem.id);
      continue;
    }
    const course = (state.courses || []).find((candidate) => candidate.id === source.courseId);
    const legacy = legacyItemForSource(source, course, now);
    const explicit = source.academicContextIncluded === true || selectedIds.has(String(source.id));
    legacy.selectionState = explicit ? "imported" : source.selectionState === "ignored" ? "ignored" : "discovered";
    legacy.academicContextIncluded = explicit;
    legacy.selectedAt = explicit ? source.selectedAt || lifecycle.materialsSelectedAt || source.importedAt || nowIso(now) : null;
    legacy.importedAt = explicit ? source.importedAt || legacy.selectedAt : null;
    const result = upsertById(state.classroomItems, legacy).item;
    idReplacements.set(String(source.id), result.id);
    source.classroomItemId = result.id;
    source.selectionState = explicit ? "imported" : result.selectionState;
    source.academicContextIncluded = explicit;
    if (!explicit) {
      archiveAcademicRecord(source, now);
      archiveSourceArtifacts(state, [source.id], now);
      hiddenAmbiguousRows += 1;
    }
    migratedMaterials += 1;
  }
  if (lifecycle.selectedMaterialIds) {
    lifecycle.selectedMaterialIds = [...new Set(lifecycle.selectedMaterialIds.map((id) => idReplacements.get(String(id)) || String(id)))];
  }
  for (const roadmap of state.roadmap || []) {
    if (hiddenAssignmentIds.has(String(roadmap.assignmentId || "")) ||
        [...hiddenAssignmentIds].some((id) => String(roadmap.id || "").includes(id)) ||
        hiddenTopicIds.has(String(roadmap.topicId || ""))) {
      roadmap.status = "archived";
      roadmap.archived = true;
    }
  }
  for (const session of state.testSessions || []) {
    if (hiddenAssignmentIds.has(String(session.assignmentId || ""))) archiveAcademicRecord(session, now);
  }
  for (const contract of state.assignmentAutomationContracts || []) {
    if (hiddenAssignmentIds.has(String(contract.assignmentId || ""))) archiveAcademicRecord(contract, now);
  }
  for (const lesson of state.tutorLessons || []) {
    if (hiddenTopicIds.has(String(lesson.topicId || ""))) archiveAcademicRecord(lesson, now);
  }
  for (const revision of state.revisionEvents || []) {
    if (hiddenTopicIds.has(String(revision.topicId || ""))) archiveAcademicRecord(revision, now);
  }
  const activeCourseIds = new Set([
    ...(state.assignments || []).filter(isAcademicContextRecord).map((item) => item.courseId),
    ...(state.sourceMaterials || []).filter(isAcademicContextRecord).map((item) => item.courseId),
  ].filter(Boolean));
  for (const topic of (state.topics || []).filter(isClassroomRecord)) {
    const used = (state.assignments || []).filter(isAcademicContextRecord).some((assignment) => (assignment.topicIds || []).includes(topic.id));
    if (!used) archiveAcademicRecord(topic, now);
  }
  for (const course of (state.courses || []).filter(isClassroomRecord)) {
    if (!activeCourseIds.has(course.id)) archiveAcademicRecord(course, now);
  }
  return { migratedAssignments, migratedMaterials, hiddenAmbiguousRows };
}

function dueSort(left, right) {
  const leftDue = timestampFor(left.dueAt || left.dueDate);
  const rightDue = timestampFor(right.dueAt || right.dueDate);
  if (leftDue !== rightDue) return leftDue - rightDue;
  return timestampFor(left.postedAt || left.createdAt) - timestampFor(right.postedAt || right.createdAt);
}

function assignmentNeedsAction(item = {}) {
  if (item.archived || item.handedIn === true || ["completed", "done", "graded", "returned", "submitted", "archived"].includes(String(item.status || "").toLowerCase())) {
    return false;
  }
  const submission = normalizeClassroomSubmissionState(item.submissionState || item.submissionStatus, {
    hasSubmission: Boolean(item.submissionState || item.submissionStatus || item.providerSubmissionId),
    dueAt: item.dueAt || item.dueDate,
  });
  return !submission.handedIn && (submission.active || Boolean(item.dueAt || item.dueDate));
}

export function getClassroomDueWork(state, { includeDiscoveredReview = false } = {}) {
  const selected = (state.assignments || [])
    .filter((assignment) => isClassroomRecord(assignment) && isAcademicContextRecord(assignment) && assignmentNeedsAction(assignment))
    .map((assignment) => {
      const submission = normalizeClassroomSubmissionState(assignment.submissionState || assignment.submissionStatus, {
        hasSubmission: Boolean(assignment.submissionState || assignment.submissionStatus || assignment.providerSubmissionId),
        dueAt: assignment.dueAt || assignment.dueDate,
      });
      return {
        ...assignment,
        status: assignmentStatus({
          dueAt: assignment.dueAt || assignment.dueDate,
          handedIn: assignment.handedIn === true || submission.handedIn,
          active: submission.active || Boolean(assignment.dueAt || assignment.dueDate),
        }),
        actionType: "study",
        reviewRequired: false,
      };
    })
    .sort(dueSort);
  if (!includeDiscoveredReview) return selected;
  const review = (state.classroomItems || [])
    .filter((item) => item.itemType === "assignment" && item.selectionState === "discovered" && !item.academicContextIncluded && assignmentNeedsAction(item))
    .map((item) => ({
      id: item.id,
      classroomItemId: item.id,
      title: item.title,
      courseTitle: item.courseTitle,
      dueAt: item.dueAt || null,
      dueDate: dateOnly(item.dueAt),
      postedAt: item.postedAt || null,
      status: assignmentStatus(item),
      submissionState: item.submissionState,
      handedIn: item.handedIn === true,
      source: "google_classroom",
      readOnly: true,
      actionType: "review_add",
      reviewRequired: true,
      academicContextIncluded: false,
    }))
    .sort(dueSort);
  return [...selected, ...review];
}

export function getClassroomTodayAction(state, options = {}) {
  return getClassroomDueWork(state, options)[0] || null;
}
