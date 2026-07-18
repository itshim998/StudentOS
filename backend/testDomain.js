import assert from "node:assert/strict";
import {
  applyTestScore,
  buildExtensionDecisionDraft,
  createAssignmentAutomationContractForState,
  createTutorLesson,
  determineAssignmentCoverage,
  determineTopicCoverage,
  getCreditBalance,
  getTodayNextActions,
  handleAssignmentLearningFlow,
  scoreMcqAnswers,
  scoreToCredits,
} from "./domain/studentosDomain.js";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";

assert.equal(scoreToCredits(95), 3);
assert.equal(scoreToCredits(84), 2);
assert.equal(scoreToCredits(70), 1);
assert.equal(scoreToCredits(69), 0);
assert.equal(scoreMcqAnswers({ answers: ["A", "B", "C", "D"], answerKey: ["A", "B", "C", "X"] }), 75);

const answerKeyState = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
const answerKeyResult = applyTestScore(answerKeyState, {
  courseId: "course_alg2",
  topicId: "topic_quadratics",
  type: "mcq",
  answers: ["A", "B", "C", "D"],
  answerKey: ["A", "B", "C", "X"],
});
assert.equal(answerKeyResult.result.scorePercent, 75);
assert.equal(answerKeyResult.result.creditsAwarded, 1);
assert.equal(answerKeyResult.creditEntry.amount, 1);

const state = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
const beforeCredits = getCreditBalance(state);

const coveredCoverage = determineAssignmentCoverage(state, "assign_quad_ws");
assert.equal(coveredCoverage.status, "covered");
const partialCoverage = determineAssignmentCoverage(state, "assign_stats_review");
assert.equal(partialCoverage.status, "partially_covered");
const uncoveredCoverage = determineAssignmentCoverage(state, "assign_trig_intro");
assert.equal(uncoveredCoverage.status, "uncovered");

const trigTopicCoverage = determineTopicCoverage(state, "topic_trig_basics");
assert.equal(trigTopicCoverage.status, "uncovered");

const failed = applyTestScore(state, {
  courseId: "course_alg2",
  topicId: "topic_quadratics",
  scorePercent: 62,
  type: "mcq",
  answers: [
    {
      question: "Choose the correct quadratic setup.",
      selected: "Use any two numbers",
      correct: "Identify a, b, and c first",
      concept: "word problem setup",
      isCorrect: false,
    },
  ],
});
assert.equal(failed.result.creditsAwarded, 0);
assert.equal(failed.roadmapItem.priority, "medium");
assert.equal(failed.correctionSheet.corrections.length, 1);
assert.equal(failed.weakTopics.length, 0);
assert.equal(failed.roadmapItem.kind, "corrections");
assert.equal(getCreditBalance(state), beforeCredits);

const strong = applyTestScore(state, {
  courseId: "course_alg2",
  topicId: "topic_quadratics",
  scorePercent: 91,
  type: "mcq",
});
assert.equal(strong.result.creditsAwarded, 3);
assert.equal(getCreditBalance(state), beforeCredits + 3);
assert.equal(strong.tutorLesson.sourceLabels.length > 0, true);

const assignment = state.assignments.find((item) => item.id === "assign_quad_ws");
const course = state.courses.find((item) => item.id === assignment.courseId);
const topics = state.topics.filter((topic) => assignment.topicIds.includes(topic.id));
const contract = createAssignmentAutomationContractForState({
  state,
  assignment,
  course,
  topics,
  creditBalance: getCreditBalance(state),
});
assert.equal(contract.studentReviewRequired, true);
assert.equal(contract.realSubmissionAllowed, false);
assert(contract.blockedActions.includes("silent_submission"));
assert(contract.blockedActions.includes("classroom_posting"));

const uncoveredFlow = handleAssignmentLearningFlow(state, "assign_trig_intro");
assert.equal(uncoveredFlow.coverage.status, "uncovered");
assert.equal(uncoveredFlow.action, "mastery_roadmap_before_test");
assert.equal(uncoveredFlow.testSession, null);
assert.equal(uncoveredFlow.lesson.mode, "teach_then_mastery_check");

const coveredFlow = handleAssignmentLearningFlow(state, "assign_quad_ws");
assert.equal(coveredFlow.coverage.status, "covered");
assert.equal(coveredFlow.action, "practice_test");
assert.equal(coveredFlow.testSession.questionFormat, "mcq");

const lesson = createTutorLesson({
  course,
  topic: topics[0],
  sources: state.sourceMaterials.filter((source) => topics[0].sourceMaterialIds.includes(source.id)),
  coverageStatus: "covered",
  wrongConcepts: ["factorisation speed"],
});
assert.match(lesson.diagram, /flowchart TD/);
assert(lesson.commonMistakes.some((item) => /factorisation speed/i.test(item)));

const actions = getTodayNextActions(state);
assert(actions.length > 0);
assert.equal(actions[0].status, "open");

const extension = buildExtensionDecisionDraft({
  profile: state.studentProfile,
  assignment,
  reason: "medical appointment conflict",
});
assert.equal(extension.canAutoSend, false);
assert.equal(extension.canPostToClassroom, false);
assert.equal(extension.recommendation, "support_reasonable_extension");

console.log("PASS | StudentOS Pass 2 domain policy tests passed");
