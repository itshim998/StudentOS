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

function submittedAnswersFor(session, selector = (answer) => answer) {
  return session.questions.map((question, index) => ({
    questionId: question.id,
    selected: selector(session.answerKey[index], index, question),
  }));
}

assert.equal(scoreToCredits(95), 3);
assert.equal(scoreToCredits(84), 2);
assert.equal(scoreToCredits(70), 1);
assert.equal(scoreToCredits(69), 0);
assert.equal(scoreMcqAnswers({ answers: ["A", "B", "C", "D"], answerKey: ["A", "B", "C", "X"] }), 75);
assert.equal(scoreMcqAnswers({ answers: ["A"], answerKey: ["A", "B"] }), null);
assert.equal(scoreMcqAnswers({ answers: [{ selected: "B", isCorrect: true }], answerKey: ["A"] }), 0);

const answerKeyState = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
const answerKeyFlow = handleAssignmentLearningFlow(answerKeyState, "assign_quad_ws");
const answerKeySession = answerKeyState.testSessions.find((session) => session.id === answerKeyFlow.testSession.id);
const answerKeyResult = applyTestScore(answerKeyState, {
  testSessionId: answerKeySession.id,
  answers: submittedAnswersFor(answerKeySession, (answer, index) => index < 6 ? answer : "wrong"),
});
assert.equal(answerKeyResult.result.scorePercent, 75);
assert.equal(answerKeyResult.result.creditsAwarded, 1);
assert.equal(answerKeyResult.creditEntry.amount, 1);
assert.equal(answerKeyResult.result.answerKey, undefined);

const state = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
const coveredCoverage = determineAssignmentCoverage(state, "assign_quad_ws");
assert.equal(coveredCoverage.status, "covered");
const partialCoverage = determineAssignmentCoverage(state, "assign_stats_review");
assert.equal(partialCoverage.status, "partially_covered");
const uncoveredCoverage = determineAssignmentCoverage(state, "assign_trig_intro");
assert.equal(uncoveredCoverage.status, "uncovered");

const trigTopicCoverage = determineTopicCoverage(state, "topic_trig_basics");
assert.equal(trigTopicCoverage.status, "uncovered");

const failedState = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
const failedFlow = handleAssignmentLearningFlow(failedState, "assign_quad_ws");
const failedSession = failedState.testSessions.find((session) => session.id === failedFlow.testSession.id);
const failedBeforeCredits = getCreditBalance(failedState);
const failed = applyTestScore(failedState, {
  testSessionId: failedSession.id,
  answers: submittedAnswersFor(failedSession, () => "definitely-wrong"),
});
assert.equal(failed.result.creditsAwarded, 0);
assert.equal(failed.roadmapItem.priority, "urgent");
assert.equal(failed.correctionSheet.corrections.length, failedSession.questions.length);
assert.equal(failed.weakTopics.length, 0);
assert.equal(failed.roadmapItem.kind, "weak_topic_recovery");
assert.equal(getCreditBalance(failedState), failedBeforeCredits);

const strongState = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
const strongFlow = handleAssignmentLearningFlow(strongState, "assign_quad_ws");
const strongSession = strongState.testSessions.find((session) => session.id === strongFlow.testSession.id);
const beforeCredits = getCreditBalance(strongState);
const strong = applyTestScore(strongState, {
  testSessionId: strongSession.id,
  answers: submittedAnswersFor(strongSession),
});
assert.equal(strong.result.creditsAwarded, 3);
assert.equal(getCreditBalance(strongState), beforeCredits + 3);
assert.equal(strong.tutorLesson.sourceLabels.length > 0, true);
assert.equal(strongSession.status, "completed");

const assignment = strongState.assignments.find((item) => item.id === "assign_quad_ws");
const course = strongState.courses.find((item) => item.id === assignment.courseId);
const topics = strongState.topics.filter((topic) => assignment.topicIds.includes(topic.id));
const contract = createAssignmentAutomationContractForState({
  state: strongState,
  assignment,
  course,
  topics,
  creditBalance: getCreditBalance(strongState),
});
assert.equal(contract.studentReviewRequired, true);
assert.equal(contract.realSubmissionAllowed, false);
assert(contract.blockedActions.includes("silent_submission"));
assert(contract.blockedActions.includes("classroom_posting"));

const uncoveredFlow = handleAssignmentLearningFlow(strongState, "assign_trig_intro");
assert.equal(uncoveredFlow.coverage.status, "uncovered");
assert.equal(uncoveredFlow.action, "mastery_roadmap_before_test");
assert.equal(uncoveredFlow.testSession, null);
assert.equal(uncoveredFlow.lesson.mode, "teach_then_mastery_check");

assert.equal(strongFlow.coverage.status, "covered");
assert.equal(strongFlow.action, "practice_test");
assert.equal(strongFlow.testSession.questionFormat, "mcq");
assert.equal(strongFlow.testSession.answerKey, undefined);
assert(strongFlow.testSession.questions.every((question) => question.answer === undefined));

const lesson = createTutorLesson({
  course,
  topic: topics[0],
  sources: strongState.sourceMaterials.filter((source) => topics[0].sourceMaterialIds.includes(source.id)),
  coverageStatus: "covered",
  wrongConcepts: ["factorisation speed"],
});
assert.match(lesson.diagram, /flowchart TD/);
assert(lesson.commonMistakes.some((item) => /factorisation speed/i.test(item)));

const actions = getTodayNextActions(strongState);
assert(actions.length > 0);
assert.equal(actions[0].status, "open");

const extension = buildExtensionDecisionDraft({
  profile: strongState.studentProfile,
  assignment,
  reason: "medical appointment conflict",
});
assert.equal(extension.canAutoSend, false);
assert.equal(extension.canPostToClassroom, false);
assert.equal(extension.recommendation, "support_reasonable_extension");

console.log("PASS | StudentOS Pass 2 domain policy tests passed");
