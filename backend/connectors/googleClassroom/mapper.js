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

function dateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function submissionStatusFor(courseWork, submission) {
  const state = String(submission?.state || "").toUpperCase();
  if (["TURNED_IN", "RETURNED"].includes(state)) return "done";
  const dueDate = courseWork.dueAt ? new Date(courseWork.dueAt) : null;
  if (dueDate && !Number.isNaN(dueDate.getTime())) {
    const hoursUntilDue = (dueDate.getTime() - Date.now()) / (60 * 60 * 1000);
    if (hoursUntilDue <= 72 && hoursUntilDue >= -12) return "due_soon";
  }
  return "open";
}

function courseId(providerCourseId) {
  return `classroom_course_${safeId(providerCourseId)}`;
}

function assignmentId(providerCourseId, providerCourseWorkId) {
  return `classroom_assignment_${safeId(providerCourseId)}_${safeId(providerCourseWorkId)}`;
}

function materialId(providerCourseId, providerCourseWorkId, providerMaterialId, index) {
  return `classroom_material_${safeId(providerCourseId)}_${safeId(providerCourseWorkId)}_${safeId(providerMaterialId || index)}`;
}

function topicId(providerCourseId, courseWorkTitle) {
  return `classroom_topic_${safeId(providerCourseId)}_${safeId(courseWorkTitle || "assignment")}`;
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...item };
    return "updated";
  }
  items.push(item);
  return "imported";
}

function tokenize(value = "") {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 4);
}

function inferTopicTitle(courseWork = {}) {
  const title = String(courseWork.title || "").trim();
  if (!title) return "Imported Classroom topic";
  return title
    .replace(/\b(worksheet|assignment|homework|quiz|test|practice|classwork|cw|hw)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || title.slice(0, 90);
}

function existingTopicForCourseWork(state, mappedCourseId, courseWork = {}) {
  const textTokens = new Set(tokenize(`${courseWork.title || ""} ${courseWork.description || ""}`));
  if (!textTokens.size) return null;
  return (state.topics || []).find((topic) => {
    if (topic.courseId !== mappedCourseId) return false;
    const topicTokens = tokenize(topic.title);
    return topicTokens.some((token) => textTokens.has(token));
  }) || null;
}

function ensureTopicForCourseWork(state, mappedCourseId, courseWork, summary, now) {
  const existing = existingTopicForCourseWork(state, mappedCourseId, courseWork);
  if (existing) return existing.id;
  const id = topicId(courseWork.providerCourseId, courseWork.title || courseWork.providerCourseWorkId);
  const action = upsertById(state.topics, {
    id,
    courseId: mappedCourseId,
    title: inferTopicTitle(courseWork),
    mastery: "new",
    coverageState: "uncovered",
    weakSignals: [],
    importSignal: "classroom_assignment_needs_mapping",
    source: "google_classroom",
    provider: "google_classroom",
    providerCourseId: courseWork.providerCourseId,
    providerCourseWorkId: courseWork.providerCourseWorkId,
    readOnly: true,
    updatedAt: courseWork.updateTime || nowIso(now),
    createdAt: nowIso(now),
  });
  if (action === "imported") summary.importedTopics += 1;
  else summary.updatedTopics += 1;
  return id;
}

function findSubmission(submissions, courseWork) {
  return submissions.find((submission) =>
    submission.providerCourseId === courseWork.providerCourseId &&
    submission.providerCourseWorkId === courseWork.providerCourseWorkId) || null;
}

export function importClassroomSnapshotIntoState(state, snapshot, { now = new Date() } = {}) {
  state.courses = state.courses || [];
  state.topics = state.topics || [];
  state.assignments = state.assignments || [];
  state.sourceMaterials = state.sourceMaterials || [];
  state.auditLog = state.auditLog || [];
  const summary = {
    importedCourses: 0,
    updatedCourses: 0,
    importedAssignments: 0,
    updatedAssignments: 0,
    importedMaterials: 0,
    updatedMaterials: 0,
    importedTopics: 0,
    updatedTopics: 0,
    skippedItems: 0,
    errors: [],
    emptyClassroom: !(snapshot.courses || []).length && !(snapshot.courseWork || []).length,
  };
  const providerCourseIdToCourseId = new Map();
  for (const classroomCourse of snapshot.courses || []) {
    if (!classroomCourse.providerCourseId) {
      summary.skippedItems += 1;
      continue;
    }
    const id = courseId(classroomCourse.providerCourseId);
    providerCourseIdToCourseId.set(classroomCourse.providerCourseId, id);
    const action = upsertById(state.courses, {
      id,
      title: classroomCourse.title || "Google Classroom course",
      term: classroomCourse.section || "Classroom",
      teacher: classroomCourse.teacher || "Google Classroom",
      color: "mint",
      source: "google_classroom",
      provider: "google_classroom",
      providerCourseId: classroomCourse.providerCourseId,
      alternateLink: classroomCourse.alternateLink || null,
      classroomState: classroomCourse.courseState || null,
      updatedAt: classroomCourse.updateTime || nowIso(now),
      readOnly: true,
    });
    if (action === "imported") summary.importedCourses += 1;
    else summary.updatedCourses += 1;
  }
  for (const courseWork of snapshot.courseWork || []) {
    if (!courseWork.providerCourseId || !courseWork.providerCourseWorkId) {
      summary.skippedItems += 1;
      continue;
    }
    const mappedCourseId = providerCourseIdToCourseId.get(courseWork.providerCourseId) || courseId(courseWork.providerCourseId);
    const submission = findSubmission(snapshot.submissions || [], courseWork);
    const id = assignmentId(courseWork.providerCourseId, courseWork.providerCourseWorkId);
    const mappedTopicId = ensureTopicForCourseWork(state, mappedCourseId, courseWork, summary, now);
    const action = upsertById(state.assignments, {
      id,
      courseId: mappedCourseId,
      topicIds: [mappedTopicId],
      title: courseWork.title || "Google Classroom assignment",
      description: courseWork.description || "",
      dueDate: dateOnly(courseWork.dueAt),
      dueAt: courseWork.dueAt || null,
      status: submissionStatusFor(courseWork, submission),
      source: "google_classroom",
      provider: "google_classroom",
      providerCourseId: courseWork.providerCourseId,
      providerCourseWorkId: courseWork.providerCourseWorkId,
      providerSubmissionId: submission?.providerSubmissionId || null,
      submissionStatus: submission?.state || "UNKNOWN",
      maxPoints: courseWork.maxPoints ?? null,
      workType: courseWork.workType || null,
      alternateLink: courseWork.alternateLink || submission?.alternateLink || null,
      classroomUpdatedAt: courseWork.updateTime || submission?.updateTime || null,
      automationEligibility: "requires_contract",
      readOnly: true,
      learningFlowReady: true,
    });
    if (action === "imported") summary.importedAssignments += 1;
    else summary.updatedAssignments += 1;
    (courseWork.materials || []).forEach((material, index) => {
      const sourceId = materialId(courseWork.providerCourseId, courseWork.providerCourseWorkId, material.providerMaterialId, index);
      const materialAction = upsertById(state.sourceMaterials, {
        id: sourceId,
        courseId: mappedCourseId,
        title: material.title || `${courseWork.title} material`,
        kind: "classroom_attachment_metadata",
        sourceType: "google_classroom_attachment_metadata",
        filename: material.title || null,
        mimeType: null,
        sizeBytes: null,
        status: "ready",
        storageMode: "external_metadata_only",
        extractionSummary: `Read-only Google Classroom ${material.rawType || "material"} metadata. StudentOS did not fetch file contents.`,
        citationLabel: `Google Classroom: ${courseWork.title}`,
        webFallbackAllowed: false,
        provider: "google_classroom",
        providerCourseId: courseWork.providerCourseId,
        providerCourseWorkId: courseWork.providerCourseWorkId,
        providerMaterialId: material.providerMaterialId || null,
        linkUrl: material.linkUrl || null,
        readOnly: true,
        createdAt: nowIso(now),
        updatedAt: nowIso(now),
      });
      if (materialAction === "imported") summary.importedMaterials += 1;
      else summary.updatedMaterials += 1;
    });
  }
  state.auditLog.push({
    id: `audit_classroom_sync_${Date.now()}`,
    actorId: state.studentProfile.id,
    action: "google_classroom.sync_completed",
    targetType: "google_classroom",
    targetId: state.studentProfile.id,
    riskLevel: "low",
    metadata: {
      readOnly: true,
      importedCourses: summary.importedCourses,
      updatedCourses: summary.updatedCourses,
      importedAssignments: summary.importedAssignments,
      updatedAssignments: summary.updatedAssignments,
      importedMaterials: summary.importedMaterials,
      updatedMaterials: summary.updatedMaterials,
      importedTopics: summary.importedTopics,
      updatedTopics: summary.updatedTopics,
      emptyClassroom: summary.emptyClassroom,
      writebackEnabled: false,
    },
    createdAt: nowIso(now),
  });
  return summary;
}
