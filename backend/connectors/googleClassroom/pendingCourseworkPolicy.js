export const PENDING_CLASSROOM_SUBMISSION_STATES = Object.freeze([
  "NEW",
  "CREATED",
  "RECLAIMED_BY_STUDENT",
]);

const PENDING_STATE_SET = new Set(PENDING_CLASSROOM_SUBMISSION_STATES);

function normalizedId(value) {
  return String(value || "").trim();
}

function validTimestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function normalizePendingSubmissionState(value) {
  return String(value || "").trim().toUpperCase();
}

export function isPendingClassroomSubmissionState(value) {
  return PENDING_STATE_SET.has(normalizePendingSubmissionState(value));
}

export function classroomCourseWorkKey(providerCourseId, providerCourseWorkId) {
  const courseId = normalizedId(providerCourseId);
  const workId = normalizedId(providerCourseWorkId);
  return courseId && workId ? `${courseId}\u0000${workId}` : "";
}

export function compareClassroomCourseworkNewestFirst(left = {}, right = {}) {
  const creationDifference = validTimestamp(right.creationTime) - validTimestamp(left.creationTime);
  if (creationDifference) return creationDifference;
  const updateDifference = validTimestamp(right.updateTime) - validTimestamp(left.updateTime);
  if (updateDifference) return updateDifference;
  return classroomCourseWorkKey(left.providerCourseId, left.providerCourseWorkId)
    .localeCompare(classroomCourseWorkKey(right.providerCourseId, right.providerCourseWorkId));
}

export function pendingCourseworkSnapshot({ courseWork = [], submissions = [] } = {}, { limit = Number.POSITIVE_INFINITY } = {}) {
  const pendingSubmissionByWork = new Map();
  for (const submission of submissions) {
    if (!isPendingClassroomSubmissionState(submission?.state)) continue;
    const key = classroomCourseWorkKey(submission?.providerCourseId, submission?.providerCourseWorkId);
    if (!key || pendingSubmissionByWork.has(key)) continue;
    pendingSubmissionByWork.set(key, {
      ...submission,
      state: normalizePendingSubmissionState(submission.state),
    });
  }

  const uniqueCoursework = new Map();
  for (const work of courseWork) {
    const key = classroomCourseWorkKey(work?.providerCourseId, work?.providerCourseWorkId);
    if (!key || !pendingSubmissionByWork.has(key) || uniqueCoursework.has(key)) continue;
    uniqueCoursework.set(key, work);
  }

  const sortedCourseWork = [...uniqueCoursework.values()].sort(compareClassroomCourseworkNewestFirst);
  const candidateLimit = Number.isFinite(Number(limit)) && Number(limit) >= 0
    ? Math.floor(Number(limit))
    : sortedCourseWork.length;
  const selectedCourseWork = sortedCourseWork.slice(0, candidateLimit);
  const selectedKeys = new Set(selectedCourseWork.map((work) =>
    classroomCourseWorkKey(work.providerCourseId, work.providerCourseWorkId)));
  const selectedSubmissions = [...pendingSubmissionByWork.entries()]
    .filter(([key]) => selectedKeys.has(key))
    .map(([, submission]) => submission);

  return {
    courseWork: selectedCourseWork,
    submissions: selectedSubmissions,
    pendingKeys: selectedKeys,
  };
}
