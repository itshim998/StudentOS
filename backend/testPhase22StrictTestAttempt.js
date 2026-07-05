import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initialStateForUser } from "./repository/studentOsRepository.js";
import { ensureDailyTodoStudyState } from "./ai/studyMaterialService.js";
import {
  buildDeterministicTestPaper,
  finishStudyTestSession,
  generateStudyTest,
  normalizeTestPaper,
  publicTestSession,
  saveStudyTestAnswers,
  startStudyTestSession,
  synchronizeTestSession,
} from "./ai/studyTestService.js";
import { CLASSROOM_WRITE_ACTIONS, canUseClassroomAction } from "./domain/planEntitlementService.js";
import { getProductFlowConfig } from "./domain/productLifecycleService.js";

const generatedAt = new Date("2026-07-05T10:00:00.000Z");
const state = initialStateForUser({ id: "phase22_student" });
state.courses.push({
  id: "course_physics",
  title: "Physics",
  source: "manual",
  academicContextIncluded: true,
  selectionState: "imported",
});
state.exams.push({
  id: "exam_physics",
  courseId: "course_physics",
  title: "Mechanics exam",
  examDate: "2026-07-08",
  academicContextIncluded: true,
});
state.studentProfile.dailyTodoPlan = ensureDailyTodoStudyState({
  date: "2026-07-05",
  generated_at: generatedAt.toISOString(),
  items: [{
    title: "Review motion and forces",
    related_course: "Physics",
    related_context: "Newton's laws",
    reason: "The Physics exam is approaching.",
    time_hint: "45 minutes",
    priority: "high",
    study_status: "done",
    study_completed_at: generatedAt.toISOString(),
  }],
});
const item = state.studentProfile.dailyTodoPlan.items[0];
state.sourceMaterials.push({
  id: "source_lesson",
  userId: state.studentProfile.id,
  courseId: "course_physics",
  title: "Newton's laws lesson",
  generatedContent: "Forces change motion. Study free-body diagrams and net force.",
  todoItemId: item.id,
  academicContextIncluded: true,
  source: "studentos_generated",
});
item.generated_material_id = "source_lesson";

const deterministicPaper = buildDeterministicTestPaper({ state, item });
assert.equal(deterministicPaper.course, "Physics");
assert.equal(deterministicPaper.topic, "Newton's laws");
assert.equal(deterministicPaper.total_marks, deterministicPaper.questions.reduce((sum, question) => sum + question.marks, 0));
assert.ok(deterministicPaper.estimated_minutes > 0);
assert.ok(deterministicPaper.questions.some((question) => question.type === "objective"));
assert.ok(deterministicPaper.questions.some((question) => question.type === "numerical"));
assert.doesNotMatch(JSON.stringify(deterministicPaper), /answer_key|correct_answer|score/i);

const normalized = normalizeTestPaper({
  test_title: "Unsafe marks are recomputed",
  course: "Physics",
  topic: "Motion",
  total_marks: 999,
  estimated_minutes: 25,
  instructions: ["Answer all questions"],
  questions: [{ question_number: 9, type: "objective", prompt: "Choose one", marks: 2, choices: ["A", "B"] }],
});
assert.equal(normalized.total_marks, 2);
assert.equal(normalized.questions[0].question_number, 1);

const generated = await generateStudyTest({ state, item, now: generatedAt, providerConfig: { requestedMode: "mock" } });
assert.equal(generated.generationSucceeded, true);
const typedSession = generated.session;
assert.equal(typedSession.status, "ready_to_start");
assert.equal(typedSession.todoItemId, item.id);
assert.equal(typedSession.testPaper.questions.length, 5);
assert.equal(typedSession.deadlineAt, null);
state.testSessions.push(typedSession);

assert.throws(() => startStudyTestSession(typedSession, null, { now: generatedAt }), /Choose how you will answer/);
startStudyTestSession(typedSession, "typed", { now: generatedAt });
assert.equal(typedSession.status, "in_progress");
assert.equal(typedSession.startedAt, generatedAt.toISOString());
assert.equal(new Date(typedSession.deadlineAt).getTime(), generatedAt.getTime() + typedSession.durationMinutes * 60_000);

const refreshedBeforeDeadline = publicTestSession(typedSession, { now: new Date(generatedAt.getTime() + 60_000) });
assert.equal(refreshedBeforeDeadline.status, "in_progress", "stored deadline must preserve the attempt across refresh");
saveStudyTestAnswers(typedSession, { 1: "My typed answer", 999: "ignored" }, { now: new Date(generatedAt.getTime() + 60_000) });
assert.deepEqual(typedSession.answers, { 1: "My typed answer" });

const afterDeadline = new Date(new Date(typedSession.deadlineAt).getTime() + 1);
synchronizeTestSession(typedSession, { now: afterDeadline });
assert.equal(typedSession.status, "time_expired");
assert.equal(typedSession.lockedAt, typedSession.deadlineAt);
assert.throws(() => saveStudyTestAnswers(typedSession, { 1: "too late" }, { now: afterDeadline }), /locked/);

const handwritten = (await generateStudyTest({ state, item, now: generatedAt, providerConfig: { requestedMode: "mock" } })).session;
startStudyTestSession(handwritten, "handwritten", { now: generatedAt });
finishStudyTestSession(handwritten, { now: new Date(generatedAt.getTime() + 120_000) });
assert.equal(handwritten.status, "ready_for_evaluation");

const typedSubmitted = (await generateStudyTest({ state, item, now: generatedAt, providerConfig: { requestedMode: "mock" } })).session;
startStudyTestSession(typedSubmitted, "typed", { now: generatedAt });
finishStudyTestSession(typedSubmitted, { now: new Date(generatedAt.getTime() + 120_000) });
assert.equal(typedSubmitted.status, "submitted_pending_evaluation");

const unavailable = await generateStudyTest({
  state,
  item,
  now: generatedAt,
  providerConfig: {
    requestedMode: "auto",
    groq: { configured: false },
    pollinations: { configured: false },
  },
});
assert.equal(unavailable.generationSucceeded, false);
assert.equal(unavailable.session, null);

const notDoneState = structuredClone(state);
notDoneState.studentProfile.dailyTodoPlan.items[0].study_status = "studying";
await assert.rejects(
  generateStudyTest({ state: notDoneState, item: notDoneState.studentProfile.dailyTodoPlan.items[0], providerConfig: { requestedMode: "mock" } }),
  /Mark this study item done/,
);

const [app, server, css, html, packageJson] = await Promise.all([
  readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8"),
  readFile(new URL("./server.js", import.meta.url), "utf8"),
  readFile(new URL("../frontend/styles/main.css", import.meta.url), "utf8"),
  readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

for (const copy of [
  "This test cannot be paused. Start only when you can complete it in one sitting.",
  "Type answers in StudentOS",
  "Upload handwritten answer sheet later",
  "After you finish on paper, you will upload your answer sheet for evaluation.",
  "Submitted for evaluation",
  "Time is up. This attempt is locked.",
]) assert.match(app, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

assert.match(app, /data-study-test-start/);
assert.match(app, /data-study-test-answer/);
assert.match(app, /studyTestTimeLeft\(session\.deadlineAt\)/);
assert.match(app, /\/api\/study\/tests\/\$\{encodeURIComponent\(sessionId\)\}/);
assert.match(css, /\.study-test-timer/);
assert.match(server, /url\.pathname === "\/api\/study\/test"/);
assert.match(server, /metadata: \{ workflow: "study_test"/);
assert.match(server, /status: generated \? "charged" : "refunded"/);
assert.match(server, /synchronizeTestSession/);
assert.match(app, /deadlineAt/);
assert.match(server, /StudentOS could not create this test right now\. Please try again\./);
assert.match(packageJson, /test:phase2-2/);

const studyUi = `${html.slice(html.indexOf('id="view-study"'), html.indexOf('id="view-studio"'))}\n${app.slice(app.indexOf("function currentStudyPlan"), app.indexOf("function renderDashboardSummary"))}`;
assert.doesNotMatch(studyUi, /data-study-test-(?:download|print|export)/i);
assert.doesNotMatch(studyUi, /\b(?:provider|model|token|storage|database|backend|vector|embedding|chunks?|debug|OAuth scope)\b/i);
assert.doesNotMatch(`${html}\n${app}`, /Plan Free/i);
for (const plan of ["trial", "starter", "essential", "plus", "pro"]) {
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(plan, action), false);
}
assert.equal(getProductFlowConfig({}, "development").realPaymentEnabled, false);

console.log("PASS | StudentOS Phase 2.2 strict in-app test attempt tests passed");
