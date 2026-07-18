import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GoogleClassroomApiClient } from "./connectors/googleClassroom/apiClient.js";
import { GOOGLE_CLASSROOM_READONLY_SCOPES, assertNoGoogleClassroomWriteScopes } from "./connectors/googleClassroom/config.js";
import {
  getClassroomDueWork,
  importClassroomSnapshotIntoState,
  selectClassroomItemsForAcademicContext,
} from "./connectors/googleClassroom/mapper.js";
import {
  PENDING_CLASSROOM_SUBMISSION_STATES,
  compareClassroomCourseworkNewestFirst,
  isPendingClassroomSubmissionState,
  pendingCourseworkSnapshot,
} from "./connectors/googleClassroom/pendingCourseworkPolicy.js";
import { initialStateForUser } from "./repository/studentOsRepository.js";

const now = new Date("2026-07-18T06:00:00.000Z");
const courseId = "course_pass_36_2";
const work = (id, creationTime, updateTime = creationTime, dueAt = null, materials = []) => ({
  providerCourseId: courseId,
  providerCourseWorkId: id,
  title: `Assignment ${id}`,
  creationTime,
  updateTime,
  dueAt,
  materials,
});
const submission = (id, state) => ({
  providerCourseId: courseId,
  providerCourseWorkId: id,
  providerSubmissionId: `submission_${id}`,
  state,
});

assert.deepEqual(PENDING_CLASSROOM_SUBMISSION_STATES, ["NEW", "CREATED", "RECLAIMED_BY_STUDENT"]);
for (const state of PENDING_CLASSROOM_SUBMISSION_STATES) assert.equal(isPendingClassroomSubmissionState(state), true);
for (const state of ["TURNED_IN", "RETURNED", "SUBMISSION_STATE_UNSPECIFIED", "", null, "ASSIGNED", "OPEN", "future_state"]) {
  assert.equal(isPendingClassroomSubmissionState(state), false, `${String(state)} must fail closed`);
}

const matrixCourseWork = [
  work("new", "2026-07-18T04:00:00.000Z"),
  work("created", "2026-07-18T03:00:00.000Z"),
  work("reclaimed", "2026-07-18T02:00:00.000Z", "2026-07-18T05:00:00.000Z", "2026-07-17T06:00:00.000Z"),
  work("turned_in", "2026-07-18T01:00:00.000Z"),
  work("returned", "2026-07-17T23:00:00.000Z"),
  work("unspecified", "2026-07-17T22:00:00.000Z"),
  work("missing", "2026-07-17T21:00:00.000Z"),
  work("unknown", "2026-07-17T20:00:00.000Z"),
];
const matrixSubmissions = [
  submission("new", "NEW"),
  submission("created", "CREATED"),
  submission("reclaimed", "RECLAIMED_BY_STUDENT"),
  submission("turned_in", "TURNED_IN"),
  submission("returned", "RETURNED"),
  submission("unspecified", "SUBMISSION_STATE_UNSPECIFIED"),
  submission("unknown", "SOMETHING_NEW_FROM_GOOGLE"),
];
const matrix = pendingCourseworkSnapshot({ courseWork: matrixCourseWork, submissions: matrixSubmissions });
assert.deepEqual(matrix.courseWork.map((item) => item.providerCourseWorkId), ["new", "created", "reclaimed"]);
assert.deepEqual(matrix.submissions.map((item) => item.state).sort(), ["CREATED", "NEW", "RECLAIMED_BY_STUDENT"]);

const ordering = [
  work("invalid_b", "invalid", "2026-07-18T04:00:00.000Z"),
  work("same_b", "2026-07-18T05:00:00.000Z", "2026-07-18T04:00:00.000Z"),
  work("old", "2026-07-17T05:00:00.000Z", "2026-07-18T06:00:00.000Z"),
  work("same_a", "2026-07-18T05:00:00.000Z", "2026-07-18T04:00:00.000Z"),
  work("invalid_a", "not-a-date", "2026-07-18T05:00:00.000Z"),
].sort(compareClassroomCourseworkNewestFirst);
assert.deepEqual(ordering.map((item) => item.providerCourseWorkId), ["same_a", "same_b", "old", "invalid_a", "invalid_b"]);
const limited = pendingCourseworkSnapshot({
  courseWork: [...ordering, ordering[0]],
  submissions: ordering.map((item) => submission(item.providerCourseWorkId, "NEW")),
}, { limit: 2 });
assert.deepEqual(limited.courseWork.map((item) => item.providerCourseWorkId), ["same_a", "same_b"], "dedupe and limit follow newest-first ordering");

const state = initialStateForUser({ id: "pass_36_2_student" });
state.classroomItems.push({
  id: "legacy_completed_candidate",
  itemType: "assignment",
  providerCourseId: courseId,
  providerCourseWorkId: "legacy_completed",
  externalId: "legacy_completed",
  title: "Previously cached completed work",
  selectionState: "discovered",
  academicContextIncluded: false,
  submissionState: "TURNED_IN",
  pendingClassroomWork: true,
});
const firstSummary = importClassroomSnapshotIntoState(state, {
  courses: [{ providerCourseId: courseId, title: "Pass 36.2 course" }],
  courseWork: matrixCourseWork,
  submissions: matrixSubmissions,
  courseWorkMaterials: [{
    providerCourseId: courseId,
    providerCourseWorkMaterialId: "material_post",
    title: "Reference sheet",
    creationTime: "2026-07-18T05:30:00.000Z",
    materials: [],
  }],
  assignmentSnapshotComplete: true,
}, { now });
assert.equal(firstSummary.discoveredAssignments, 3);
assert.equal(state.classroomItems.some((item) => item.id === "legacy_completed_candidate"), false, "complete snapshots clean old completed candidates");
assert.equal(firstSummary.discoveredMaterials, 1, "CourseWorkMaterial discovery remains a separate feature");
assert.deepEqual(
  state.classroomItems.filter((item) => item.itemType === "assignment").map((item) => item.externalId),
  ["new", "created", "reclaimed"],
);
assert.equal(getClassroomDueWork(state, { includeDiscoveredReview: true }).some((item) => item.title === "Assignment reclaimed" && item.status === "overdue"), true);
assert.equal(getClassroomDueWork(state, { includeDiscoveredReview: true }).some((item) => item.title === "Reference sheet"), false);

const importedItem = state.classroomItems.find((item) => item.externalId === "new");
selectClassroomItemsForAcademicContext(state, [importedItem.id], { now });
const importedAssignment = state.assignments.find((item) => item.classroomItemId === importedItem.id);
state.testSessions.push({ id: "preserved_test", assignmentId: importedAssignment.id, score: 8 });
state.roadmap.push({ id: "preserved_roadmap", assignmentId: importedAssignment.id, status: "planned" });

importClassroomSnapshotIntoState(state, {
  courses: [{ providerCourseId: courseId, title: "Pass 36.2 course" }],
  courseWork: [work("created", "2026-07-18T03:00:00.000Z")],
  submissions: [submission("created", "CREATED")],
  assignmentSnapshotComplete: false,
}, { now: new Date(now.getTime() + 1000) });
assert(state.classroomItems.some((item) => item.externalId === "reclaimed"), "partial snapshot must not prune stale candidates");
assert.equal(importedAssignment.pendingClassroomWork, true, "partial snapshot must not deactivate imported work");

const reconcileSummary = importClassroomSnapshotIntoState(state, {
  courses: [{ providerCourseId: courseId, title: "Pass 36.2 course" }],
  courseWork: [work("created", "2026-07-18T03:00:00.000Z")],
  submissions: [submission("created", "CREATED")],
  assignmentSnapshotComplete: true,
}, { now: new Date(now.getTime() + 2000) });
assert.equal(reconcileSummary.reconciliationApplied, true);
assert.equal(reconcileSummary.removedAssignmentCandidates, 1);
assert.equal(reconcileSummary.deactivatedImportedAssignments, 1);
assert.equal(state.classroomItems.some((item) => item.externalId === "reclaimed"), false);
assert.equal(state.classroomItems.some((item) => item.externalId === "new"), true, "imported academic record is preserved");
assert.equal(importedAssignment.pendingClassroomWork, false);
assert.equal(getClassroomDueWork(state).some((item) => item.id === importedAssignment.id), false);
assert(state.testSessions.some((item) => item.id === "preserved_test"));
assert(state.roadmap.some((item) => item.id === "preserved_roadmap"));

importClassroomSnapshotIntoState(state, {
  courses: [{ providerCourseId: courseId, title: "Pass 36.2 course" }],
  courseWork: [work("new", "2026-07-18T04:00:00.000Z"), work("created", "2026-07-18T03:00:00.000Z")],
  submissions: [submission("new", "RECLAIMED_BY_STUDENT"), submission("created", "CREATED")],
  assignmentSnapshotComplete: true,
}, { now: new Date(now.getTime() + 3000) });
assert.equal(importedAssignment.pendingClassroomWork, true, "reclaimed work can return to pending queues");
assert.equal(importedAssignment.submissionState, "RECLAIMED_BY_STUDENT");
assert.equal(getClassroomDueWork(state).some((item) => item.id === importedAssignment.id), true);

const requestedUrls = [];
const apiClient = new GoogleClassroomApiClient({
  accessToken: "redacted-test-token",
  fetchImpl: async (url) => {
    requestedUrls.push(String(url));
    const pageToken = new URL(url).searchParams.get("pageToken");
    return {
      ok: true,
      status: 200,
      async json() {
        return pageToken
          ? { studentSubmissions: [{ id: "sub_2", courseWorkId: "work_2", state: "CREATED" }] }
          : { studentSubmissions: [{ id: "sub_1", courseWorkId: "work_1", state: "NEW" }], nextPageToken: "next" };
      },
    };
  },
});
const pagedSubmissions = await apiClient.listOwnPendingSubmissions(courseId, PENDING_CLASSROOM_SUBMISSION_STATES);
assert.equal(pagedSubmissions.length, 2);
assert.equal(requestedUrls.length, 2, "all submission pages must be consumed");
for (const requestUrl of requestedUrls) {
  const parsed = new URL(requestUrl);
  assert.match(parsed.pathname, /courseWork\/-\/studentSubmissions$/);
  assert.equal(parsed.searchParams.get("userId"), "me");
  assert.deepEqual(parsed.searchParams.getAll("states"), PENDING_CLASSROOM_SUBMISSION_STATES);
}

let paginationRequest = 0;
const failingApiClient = new GoogleClassroomApiClient({
  accessToken: "redacted-test-token",
  fetchImpl: async () => {
    paginationRequest += 1;
    if (paginationRequest === 1) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { studentSubmissions: [{ id: "partial", courseWorkId: "work_partial", state: "NEW" }], nextPageToken: "missing_page" };
        },
      };
    }
    return {
      ok: false,
      status: 503,
      async json() {
        return { error: { message: "Temporary Classroom read failure" } };
      },
    };
  },
});
await assert.rejects(
  () => failingApiClient.listOwnPendingSubmissions(courseId, PENDING_CLASSROOM_SUBMISSION_STATES),
  /could not be refreshed/i,
  "an incomplete page sequence must fail instead of returning partial submissions",
);
assert.equal(paginationRequest, 2);

assertNoGoogleClassroomWriteScopes(GOOGLE_CLASSROOM_READONLY_SCOPES);
const connectorSource = [
  await readFile(new URL("./connectors/googleClassroom/apiClient.js", import.meta.url), "utf8"),
  await readFile(new URL("./connectors/googleClassroom/syncService.js", import.meta.url), "utf8"),
].join("\n");
assert.doesNotMatch(connectorSource, /turnIn|modifyAttachments|reclaimSubmission|studentSubmissions\/[^"'`]*:(?:turnIn|reclaim)/i);
assert.doesNotMatch(connectorSource, /console\.(?:log|info|debug)\([^\n]*(?:studentSubmissions|submissionState)/i);
assert.match(connectorSource, /assignmentSnapshotComplete = false/);

const app = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
assert.match(app, /Pending Classroom work/);
assert.match(app, /New unfinished Classroom work was found\. Choose what to add to your academic context\./);
assert.match(app, /You have no new unfinished Classroom work\./);
const reviewMarkup = app.slice(app.indexOf("const classroomReview ="), app.indexOf("els.sourceList.innerHTML"));
assert.doesNotMatch(reviewMarkup, /Already handed in|Material/);

console.log("PASS | StudentOS Pass 36.2 pending-only Classroom sync tests passed");
