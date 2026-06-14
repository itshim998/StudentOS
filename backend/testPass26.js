import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSeedState, getAssignmentInsights, handleAssignmentLearningFlow } from "./domain/studentosDomain.js";
import { importClassroomSnapshotIntoState } from "./connectors/googleClassroom/mapper.js";
import { classifyClassroomError } from "./connectors/googleClassroom/apiClient.js";
import { GOOGLE_CLASSROOM_READONLY_SCOPES, assertNoGoogleClassroomWriteScopes } from "./connectors/googleClassroom/config.js";

const now = new Date("2026-06-08T06:00:00.000Z");
const state = createSeedState(now);
const summary = importClassroomSnapshotIntoState(state, {
  courses: [{
    providerCourseId: "course_native_1",
    title: "Native Classroom Physics",
    section: "Grade 10",
    teacher: "Classroom",
    alternateLink: "https://classroom.google.com/c/native",
    courseState: "ACTIVE",
  }],
  courseWork: [{
    providerCourseId: "course_native_1",
    providerCourseWorkId: "work_motion_1",
    title: "Motion graph assignment",
    description: "Interpret displacement-time graphs.",
    dueAt: "2026-06-10T23:59:00Z",
    maxPoints: 15,
    workType: "ASSIGNMENT",
    alternateLink: "https://classroom.google.com/c/native/a/work_motion_1",
    materials: [{
      providerMaterialId: "mat_motion",
      title: "Motion graph note",
      linkUrl: "https://classroom.google.com/material",
      rawType: "link",
    }],
  }],
  submissions: [{
    providerCourseId: "course_native_1",
    providerCourseWorkId: "work_motion_1",
    providerSubmissionId: "sub_motion_1",
    state: "NEW",
  }],
}, { now });

assert.equal(summary.importedCourses, 1);
assert.equal(summary.importedAssignments, 1);
assert.equal(summary.importedTopics, 1);
assert.equal(summary.emptyClassroom, false);
const importedCourse = state.courses.find((course) => course.providerCourseId === "course_native_1");
const importedAssignment = state.assignments.find((assignment) => assignment.providerCourseWorkId === "work_motion_1");
assert(importedCourse);
assert(importedAssignment);
assert.equal(importedCourse.source, "google_classroom");
assert.equal(importedCourse.readOnly, true);
assert.equal(importedAssignment.source, "google_classroom");
assert.equal(importedAssignment.readOnly, true);
assert.equal(importedAssignment.learningFlowReady, true);
assert.equal(importedAssignment.topicIds.length, 1);
const importedInsight = getAssignmentInsights(state).find((item) => item.assignmentId === importedAssignment.id);
assert.equal(importedInsight.status, "uncovered");
const flow = handleAssignmentLearningFlow(state, importedAssignment.id);
assert.equal(flow.action, "mastery_roadmap_before_test");
assert.equal(flow.realSubmissionAllowed, false);
assert.equal(flow.studentReviewRequired, true);

const emptyState = createSeedState(now);
const emptySummary = importClassroomSnapshotIntoState(emptyState, {
  courses: [],
  courseWork: [],
  submissions: [],
}, { now });
assert.equal(emptySummary.emptyClassroom, true);
assert.equal(emptySummary.importedCourses, 0);
assert.equal(emptySummary.importedAssignments, 0);

const insufficient = classifyClassroomError(403, {
  error: {
    message: "Request had insufficient authentication scopes.",
    errors: [{ reason: "insufficientPermissions" }],
  },
});
assert.equal(insufficient.code, "google_classroom_insufficient_scope");
assert.match(insufficient.message, /Reconnect|scope/i);
assert.equal(classifyClassroomError(401, { error: { message: "Invalid Credentials" } }).connectorState, "expired");
assert.equal(classifyClassroomError(429, { error: { message: "Quota exceeded" } }).code, "google_classroom_rate_limited");

const app = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
assert(app.includes("Google Classroom import"));
assert(app.includes("Analyze assignment"));
assert(app.includes("No active Classroom courses or coursework were found"));
assert(app.includes("learning flow ready"));
assert(app.includes("no writeback"));
assert(app.includes("Google Classroom"));
assert(app.includes("Classroom import unavailable"));
assert(app.includes("Classroom sync needs the approved read-only scopes"));
assert(app.includes("Classroom access expired or was revoked"));
assert(app.includes("Google Classroom is rate-limiting this sync"));
assert(app.includes("Assignment flow unavailable"));
assert(app.includes("safe error"));
assert(app.includes("connectClassroom().catch(renderClassroomError)"));
assert(app.includes("syncClassroom().catch(renderClassroomError)"));
assert(app.includes("disconnectClassroom().catch(renderClassroomError)"));

const qaDoc = await readFile(new URL("../docs/PASS26_CLASSROOM_IMPORT_QA.md", import.meta.url), "utf8");
assert(qaDoc.includes("Browser QA"));
assert(qaDoc.includes("Empty Classroom account"));
assert(qaDoc.includes("covered -> practice test"));
assert(qaDoc.includes("uncovered -> mastery roadmap before test"));

assert.equal(assertNoGoogleClassroomWriteScopes(GOOGLE_CLASSROOM_READONLY_SCOPES), true);
const connectorFiles = [
  await readFile(new URL("./connectors/googleClassroom/apiClient.js", import.meta.url), "utf8"),
  await readFile(new URL("./connectors/googleClassroom/syncService.js", import.meta.url), "utf8"),
  app,
];
for (const file of connectorFiles) {
  assert.equal(file.includes("turnIn"), false);
  assert.equal(file.includes("modifyAttachments"), false);
  assert.equal(file.includes("reclaimSubmission"), false);
}

console.log("PASS | StudentOS Pass 26 Classroom import UX tests passed");
