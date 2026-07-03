import { randomUUID } from "node:crypto";
import { isAcademicContextRecord } from "../connectors/googleClassroom/mapper.js";
import { markAcademicContextNeedsPreparation } from "./academicContextService.js";

const COURSE_COLORS = ["mint", "amber", "violet", "sky"];

function clean(value, limit = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function slug(value) {
  return clean(value, 64)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "course";
}

function courseError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function activeCourses(state) {
  return (state.courses || []).filter(isAcademicContextRecord);
}

function auditCourseChange(state, course, action, now) {
  state.auditLog = state.auditLog || [];
  state.auditLog.push({
    id: `audit_course_${action}_${now.getTime()}_${randomUUID().slice(0, 6)}`,
    actorId: state.studentProfile?.id || "student_unknown",
    action: `course.${action}`,
    targetType: "course",
    targetId: course.id,
    riskLevel: "low",
    metadata: { source: "manual" },
    createdAt: now.toISOString(),
  });
}

function normalizedCourseInput(input = {}, state = {}) {
  return {
    title: clean(input.courseName ?? input.title, 120),
    courseCode: clean(input.courseCode, 48),
    department: clean(
      input.department ?? input.stream ?? state.studentProfile?.preferences?.stream,
      100,
    ),
    term: clean(input.term ?? input.yearSemester, 80),
  };
}

function assertCourseName(title) {
  if (!title) throw courseError("Add a course name to continue.");
}

function assertNoDuplicateCourse(state, input, excludedId = null) {
  const normalizedTitle = input.title.toLowerCase();
  const normalizedCode = input.courseCode.toLowerCase();
  const duplicate = activeCourses(state).find((course) => {
    if (course.id === excludedId) return false;
    if (clean(course.title).toLowerCase() === normalizedTitle) return true;
    return normalizedCode && clean(course.courseCode).toLowerCase() === normalizedCode;
  });
  if (duplicate) throw courseError("That course is already in your saved courses.", 409);
}

function findManualCourse(state, courseId) {
  const course = (state.courses || []).find((item) => item.id === courseId && isAcademicContextRecord(item));
  if (!course) throw courseError("That course could not be found.", 404);
  if (course.source !== "manual") {
    throw courseError("This course stays linked to its original setup. Add a manual course if you need a separate version.", 409);
  }
  return course;
}

function courseHasLinkedWork(state, courseId) {
  const collections = [
    state.topics,
    state.syllabi,
    state.exams,
    state.assignments,
    state.timetable,
    state.sourceMaterials,
    state.roadmap,
    state.revisionEvents,
  ];
  return collections.some((items) => (items || []).some((item) =>
    item.courseId === courseId && isAcademicContextRecord(item)));
}

export function addManualCourse(state, input = {}, { now = new Date(), idFactory = randomUUID } = {}) {
  state.courses = state.courses || [];
  const values = normalizedCourseInput(input, state);
  assertCourseName(values.title);
  assertNoDuplicateCourse(state, values);
  const course = {
    id: `course_manual_${slug(values.title)}_${idFactory().slice(0, 8)}`,
    title: values.title,
    courseCode: values.courseCode || null,
    department: values.department || null,
    term: values.term || null,
    teacher: "",
    examDate: null,
    color: COURSE_COLORS[activeCourses(state).length % COURSE_COLORS.length],
    syllabusId: null,
    subjectIds: [],
    source: "manual",
    readOnly: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  state.courses.push(course);
  auditCourseChange(state, course, "created", now);
  markAcademicContextNeedsPreparation(state, "course_added", { now });
  return course;
}

export function updateManualCourse(state, courseId, input = {}, { now = new Date() } = {}) {
  const course = findManualCourse(state, courseId);
  const values = normalizedCourseInput(input, state);
  assertCourseName(values.title);
  assertNoDuplicateCourse(state, values, course.id);
  Object.assign(course, {
    title: values.title,
    courseCode: values.courseCode || null,
    department: values.department || null,
    term: values.term || null,
    updatedAt: now.toISOString(),
  });
  auditCourseChange(state, course, "updated", now);
  markAcademicContextNeedsPreparation(state, "course_updated", { now });
  return course;
}

export function archiveManualCourse(state, courseId, { now = new Date() } = {}) {
  const course = findManualCourse(state, courseId);
  if (courseHasLinkedWork(state, course.id)) {
    throw courseError("Remove this course's assignments and materials before archiving it.", 409);
  }
  course.archivedAt = now.toISOString();
  course.updatedAt = now.toISOString();
  auditCourseChange(state, course, "archived", now);
  markAcademicContextNeedsPreparation(state, "course_removed", { now });
  return course;
}
