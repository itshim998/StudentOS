import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyTestScore,
  determineAssignmentCoverage,
  handleAssignmentLearningFlow,
  normalizeLearningState,
} from "./domain/studentosDomain.js";
import { importClassroomSnapshotIntoState } from "./connectors/googleClassroom/mapper.js";

function supabaseShapedState(overrides = {}) {
  return {
    studentProfile: {
      id: "student_supabase_shape",
      displayName: "Supabase Student",
      preferences: {},
    },
    courses: [{
      id: "course_computer_organization",
      title: "Computer Organization",
      teacher: "RCCIIT",
      examDate: "2026-07-01",
    }],
    topics: [{
      id: "topic_number_systems",
      courseId: "course_computer_organization",
      title: "Number systems",
      mastery: "secure",
      coverageState: "covered",
    }],
    assignments: [{
      id: "assignment_cia_2",
      courseId: "course_computer_organization",
      title: "CIA-2 Assignments",
      source: "google_classroom",
      provider: "google_classroom",
      providerCourseId: "classroom_course_1",
      providerCourseWorkId: "classroom_work_1",
      topicIds: ["topic_number_systems"],
      readOnly: true,
    }],
    ...overrides,
  };
}

const shaped = supabaseShapedState();
normalizeLearningState(shaped);
for (const key of [
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "auditLog",
  "testSessions",
  "testResults",
  "assignmentLearningFlows",
]) {
  assert(Array.isArray(shaped[key]), `${key} should be normalized to an array`);
}
assert(Array.isArray(shaped.topics[0].weakSignals));

const coveredState = supabaseShapedState();
const coveredFlow = handleAssignmentLearningFlow(coveredState, "assignment_cia_2");
assert.equal(coveredFlow.coverage.status, "covered");
assert.equal(coveredFlow.action, "practice_test");
assert.equal(coveredFlow.realSubmissionAllowed, false);
assert.equal(coveredFlow.studentReviewRequired, true);
assert(Array.isArray(coveredFlow.coverage.topicCoverages));
assert(Array.isArray(coveredFlow.lesson.sourceLabels));
assert(Array.isArray(coveredFlow.testSession.questions));
assert.equal(coveredState.testSessions.length, 1);
assert.equal(coveredState.tutorLessons.length, 1);
assert.equal(coveredState.assignmentLearningFlows.length, 1);
assert.equal(coveredState.auditLog.length, 1);

const partialState = supabaseShapedState({
  topics: [{
    id: "topic_cache_memory",
    courseId: "course_computer_organization",
    title: "Cache memory",
    mastery: "new",
    coverageState: "teaching",
  }],
  assignments: [{
    id: "assignment_cache",
    courseId: "course_computer_organization",
    title: "Cache memory worksheet",
    topicIds: ["topic_cache_memory"],
    source: "google_classroom",
    readOnly: true,
  }],
});
const partialFlow = handleAssignmentLearningFlow(partialState, "assignment_cache");
assert.equal(partialFlow.coverage.status, "partially_covered");
assert.equal(partialFlow.action, "quick_revision_then_test");
assert.equal(partialState.testSessions.length, 1);

const noTopicAssignment = {
  id: "assignment_no_topics",
  courseId: "course_computer_organization",
  title: "Imported assignment without mapped topics",
  source: "google_classroom",
  readOnly: true,
};
const noTopicCoverage = determineAssignmentCoverage(supabaseShapedState(), noTopicAssignment);
assert.equal(noTopicCoverage.status, "uncovered");
assert.equal(noTopicCoverage.topicCoverages.length, 0);

const fallbackTopicState = supabaseShapedState({
  topics: [],
  assignments: [noTopicAssignment],
});
const fallbackFlow = handleAssignmentLearningFlow(fallbackTopicState, "assignment_no_topics");
assert.equal(fallbackFlow.coverage.status, "uncovered");
assert.equal(fallbackFlow.action, "mastery_roadmap_before_test");
assert.equal(fallbackTopicState.topics.length, 1);
assert.equal(fallbackTopicState.assignments[0].topicIds.length, 1);
assert.equal(fallbackTopicState.testSessions.length, 0);

const missingCourseState = supabaseShapedState({
  assignments: [{
    id: "assignment_missing_course_id",
    title: "Imported assignment missing optional course id",
    topicIds: ["topic_number_systems"],
    source: "google_classroom",
    readOnly: true,
  }],
});
const missingCourseFlow = handleAssignmentLearningFlow(missingCourseState, "assignment_missing_course_id");
assert.equal(missingCourseState.assignments[0].courseId, "course_computer_organization");
assert.equal(missingCourseFlow.roadmapItem.courseId, "course_computer_organization");

const classroomState = {
  studentProfile: {
    id: "student_classroom_shape",
    displayName: "Classroom Student",
    preferences: {},
  },
};
const importSummary = importClassroomSnapshotIntoState(classroomState, {
  courses: [{
    providerCourseId: "course_live_1",
    title: "Computer Organization",
    section: "Semester",
  }],
  courseWork: [{
    providerCourseId: "course_live_1",
    providerCourseWorkId: "work_cia_2",
    title: "CIA-2 Assignments",
    description: "Computer organization assignment.",
    dueAt: "2026-06-15T10:00:00Z",
    maxPoints: 20,
    workType: "ASSIGNMENT",
  }],
  submissions: [{
    providerCourseId: "course_live_1",
    providerCourseWorkId: "work_cia_2",
    providerSubmissionId: "submission_cia_2",
    state: "NEW",
  }],
});
assert.equal(importSummary.importedAssignments, 1);
const importedAssignment = classroomState.assignments[0];
const importedFlow = handleAssignmentLearningFlow(classroomState, importedAssignment.id);
assert.equal(importedFlow.coverage.status, "uncovered");
assert.equal(importedFlow.action, "mastery_roadmap_before_test");
assert.equal(importedFlow.realSubmissionAllowed, false);

const scoreState = supabaseShapedState({
  topics: [{
    id: "topic_low_score",
    courseId: "course_computer_organization",
    title: "Instruction pipelining",
    mastery: "new",
    coverageState: "teaching",
  }],
});
const scoreResult = applyTestScore(scoreState, {
  courseId: "course_computer_organization",
  topicId: "topic_low_score",
  scorePercent: 62,
  answers: [{
    question: "Pipeline hazard",
    selected: "Wrong",
    correct: "Correct",
    concept: "data hazard",
    isCorrect: false,
  }],
});
assert.equal(scoreResult.creditEntry, null);
assert.equal(scoreState.testResults.length, 1);
assert.equal(scoreState.creditLedger.length, 0);
assert.equal(scoreState.roadmap.length, 1);
assert.equal(scoreState.revisionEvents.length, 1);
assert.equal(scoreState.tutorLessons.length, 1);
assert(scoreState.topics[0].weakSignals.includes("immediate revision required"));
assert(Array.isArray(scoreResult.correctionSheet.corrections));
assert(Array.isArray(scoreResult.weakTopics));

const serverSource = await readFile(new URL("./server.js", import.meta.url), "utf8");
assert(serverSource.includes('const STUDENTOS_APP_PASS = "30";'));
assert(!serverSource.includes('pass: "21"'));
assert(serverSource.includes("assignmentFlowError"));

const frontendSource = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
assert(frontendSource.includes("Assignment flow unavailable"));
assert(frontendSource.includes("handled privately"));

console.log("PASS | StudentOS Pass 25.1 assignment-flow Supabase shape regression tests passed");
