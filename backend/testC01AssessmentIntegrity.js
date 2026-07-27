import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyTestScore,
  getCreditBalance,
  handleAssignmentLearningFlow,
  publicLegacyPracticeTestSession,
  scoreMcqAnswers,
} from "./domain/studentosDomain.js";
import { publicTestSession } from "./ai/studyTestService.js";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";

function expectAssessmentError(callback, { status, code }) {
  assert.throws(callback, (error) => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

function createOpenLegacySession() {
  const state = createSeedState(new Date("2026-07-27T12:00:00+05:30"));
  const flow = handleAssignmentLearningFlow(state, "assign_quad_ws");
  const session = state.testSessions.find((item) => item.id === flow.testSession.id);
  const answers = session.questions.map((question, index) => ({
    questionId: question.id,
    selected: session.answerKey[index],
  }));
  return { state, flow, session, answers };
}

assert.equal(scoreMcqAnswers({
  answers: [{ selected: "wrong", isCorrect: true }],
  answerKey: ["server-answer"],
}), 0);
assert.equal(scoreMcqAnswers({ answers: ["A"], answerKey: ["A", "B"] }), null);

const missingSession = createSeedState(new Date("2026-07-27T12:00:00+05:30"));
expectAssessmentError(() => applyTestScore(missingSession, {
  answers: [],
}), { status: 400, code: "legacy_test_session_required" });

const attack = createOpenLegacySession();
assert.equal(attack.flow.testSession.answerKey, undefined);
assert(attack.flow.testSession.questions.every((question) => question.answer === undefined));
assert.equal(publicLegacyPracticeTestSession(attack.session).answerKey, undefined);

for (const [field, value] of Object.entries({
  scorePercent: 100,
  answerKey: ["forged"],
  creditsAwarded: 3,
  mastery: "secure",
  masteryBand: "secure",
})) {
  expectAssessmentError(() => applyTestScore(attack.state, {
    testSessionId: attack.session.id,
    answers: attack.answers,
    [field]: value,
  }), { status: 400, code: "legacy_test_score_authority_rejected" });
}

for (const [field, value] of Object.entries({
  isCorrect: true,
  correct: attack.session.answerKey[0],
  correctAnswer: attack.session.answerKey[0],
  expectedAnswer: attack.session.answerKey[0],
  awardedMarks: 100,
})) {
  const forgedAnswers = attack.answers.map((answer, index) => index === 0 ? { ...answer, [field]: value } : answer);
  expectAssessmentError(() => applyTestScore(attack.state, {
    testSessionId: attack.session.id,
    answers: forgedAnswers,
  }), { status: 400, code: "legacy_test_score_authority_rejected" });
}

expectAssessmentError(() => applyTestScore(attack.state, {
  testSessionId: attack.session.id,
  answers: attack.answers.slice(1),
}), { status: 400, code: "legacy_test_answer_count_mismatch" });

const duplicateAnswers = attack.answers.map((answer) => ({ ...answer }));
duplicateAnswers[1].questionId = duplicateAnswers[0].questionId;
expectAssessmentError(() => applyTestScore(attack.state, {
  testSessionId: attack.session.id,
  answers: duplicateAnswers,
}), { status: 400, code: "legacy_test_duplicate_question_id" });

const unknownAnswers = attack.answers.map((answer) => ({ ...answer }));
unknownAnswers[0].questionId = "not-a-server-question";
expectAssessmentError(() => applyTestScore(attack.state, {
  testSessionId: attack.session.id,
  answers: unknownAnswers,
}), { status: 400, code: "legacy_test_question_id_mismatch" });

const originalOwner = attack.session.studentId;
attack.session.studentId = "another-student";
expectAssessmentError(() => applyTestScore(attack.state, {
  testSessionId: attack.session.id,
  answers: attack.answers,
}), { status: 403, code: "legacy_test_session_forbidden" });
attack.session.studentId = originalOwner;

const submitted = attack.answers.map((answer, index) => index === 0 ? { ...answer, selected: "wrong" } : answer);
const expectedScore = Math.round(((submitted.length - 1) / submitted.length) * 100);
const before = {
  results: attack.state.testResults.length,
  credits: attack.state.creditLedger.length,
  roadmap: attack.state.roadmap.length,
  revisions: attack.state.revisionEvents.length,
  lessons: attack.state.tutorLessons.length,
  balance: getCreditBalance(attack.state),
};
const settled = applyTestScore(attack.state, {
  testSessionId: attack.session.id,
  answers: submitted,
  courseId: "forged-course-is-ignored",
  topicId: "forged-topic-is-ignored",
});
assert.equal(settled.replayed, false);
assert.equal(settled.result.scorePercent, expectedScore);
assert.equal(settled.result.courseId, attack.session.courseId);
assert.equal(settled.result.topicId, attack.session.topicId);
assert.equal(settled.result.answerKey, undefined);
assert.equal(settled.result.answers.length, attack.session.questions.length);
assert(settled.result.answers.every((answer) => answer.correct === undefined && answer.isCorrect === undefined));
assert.equal(attack.session.status, "completed");
assert.equal(attack.session.resultId, settled.result.id);
assert.equal(attack.state.testResults.length, before.results + 1);
assert.equal(attack.state.roadmap.length, before.roadmap + 1);
assert.equal(attack.state.revisionEvents.length, before.revisions + 1);
assert.equal(attack.state.tutorLessons.length, before.lessons + 1);
assert.equal(attack.state.creditLedger.length, before.credits + (settled.creditEntry ? 1 : 0));

const settledCounts = {
  results: attack.state.testResults.length,
  credits: attack.state.creditLedger.length,
  roadmap: attack.state.roadmap.length,
  revisions: attack.state.revisionEvents.length,
  lessons: attack.state.tutorLessons.length,
  balance: getCreditBalance(attack.state),
};
const replay = applyTestScore(attack.state, {
  testSessionId: attack.session.id,
  answers: submitted,
});
assert.equal(replay.replayed, true);
assert.deepEqual({
  results: attack.state.testResults.length,
  credits: attack.state.creditLedger.length,
  roadmap: attack.state.roadmap.length,
  revisions: attack.state.revisionEvents.length,
  lessons: attack.state.tutorLessons.length,
  balance: getCreditBalance(attack.state),
}, settledCounts);

const changedAfterSettlement = submitted.map((answer, index) => index === 1 ? { ...answer, selected: "changed" } : answer);
expectAssessmentError(() => applyTestScore(attack.state, {
  testSessionId: attack.session.id,
  answers: changedAfterSettlement,
}), { status: 409, code: "legacy_test_already_settled" });

const projected = publicTestSession({
  id: "study-session-public-projection",
  status: "ready_to_start",
  durationMinutes: 30,
  answerKey: ["A"],
  settledAnswerSignature: "private-signature",
  scoreSettlement: { internal: true },
  internalEvaluation: { provider: "private" },
  marking_scheme: "Private marking scheme",
  reference_answers: ["A"],
  questions: [{ id: "q1", prompt: "Visible prompt", answer: "A", solution: "Private solution", hidden_solution: "Private hidden solution", reference_answer: "A", rubric: "Private rubric", is_correct: true }],
  testPaper: {
    answerKey: ["A"],
    gradingRubric: "Private rubric",
    marking_scheme: "Private marking scheme",
    model_solutions: ["Private model solution"],
    questions: [{ question_number: 1, prompt: "Visible prompt", answer: "A", correctAnswer: "A", model_solution: "Private model solution", solution: "Private solution" }],
  },
  answerSheetDraft: { extractedText: "private OCR", filename: "answers.pdf" },
});
assert.equal(projected.answerKey, undefined);
assert.equal(projected.settledAnswerSignature, undefined);
assert.equal(projected.scoreSettlement, undefined);
assert.equal(projected.internalEvaluation, undefined);
assert.equal(projected.marking_scheme, undefined);
assert.equal(projected.reference_answers, undefined);
assert.equal(projected.questions[0].answer, undefined);
assert.equal(projected.questions[0].solution, undefined);
assert.equal(projected.questions[0].hidden_solution, undefined);
assert.equal(projected.questions[0].reference_answer, undefined);
assert.equal(projected.questions[0].is_correct, undefined);
assert.equal(projected.testPaper.answerKey, undefined);
assert.equal(projected.testPaper.gradingRubric, undefined);
assert.equal(projected.testPaper.marking_scheme, undefined);
assert.equal(projected.testPaper.model_solutions, undefined);
assert.equal(projected.testPaper.questions[0].correctAnswer, undefined);
assert.equal(projected.testPaper.questions[0].model_solution, undefined);
assert.equal(projected.answerSheetDraft.extractedText, undefined);
assert.equal(projected.answerSheetDraft.filename, "answers.pdf");

const frontendApp = readFileSync(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
const frontendHtml = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const smokeScript = readFileSync(new URL("../scripts/smokeCoreFlows.js", import.meta.url), "utf8");
const liveVerifier = readFileSync(new URL("../scripts/verifySupabaseLive.js", import.meta.url), "utf8");
assert.doesNotMatch(frontendApp, /api\/tests\/score/);
assert.doesNotMatch(frontendApp, /derivedAnswersForScore/);
assert.doesNotMatch(frontendHtml, /name="scorePercent"/);
assert.doesNotMatch(frontendHtml, /Save test score/);
assert.match(frontendHtml, /server-owned questions and marking/);
assert.match(smokeScript, /forgedScoreResponse\.status, 400/);
assert.match(liveVerifier, /forged authority rejected/);

console.log("PASS | C-01 assessment integrity and adversarial scoring tests passed");
