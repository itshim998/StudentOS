import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initialStateForUser, StudentOsRepository } from "./repository/studentOsRepository.js";
import { ensureDailyTodoStudyState } from "./ai/studyMaterialService.js";
import {
  finishStudyTestSession,
  generateStudyTest,
  saveStudyTestAnswers,
  startStudyTestSession,
} from "./ai/studyTestService.js";
import {
  ANSWER_SHEET_COPY,
  applyStudyTestEvaluation,
  buildDeterministicTestEvaluation,
  evaluateStudyTest,
  extractDocxText,
  normalizeTestEvaluation,
  validateStudyAnswerSheet,
} from "./ai/studyTestEvaluationService.js";
import { CLASSROOM_WRITE_ACTIONS, canUseClassroomAction } from "./domain/planEntitlementService.js";
import { getProductFlowConfig } from "./domain/productLifecycleService.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function minimalStoredDocx(text) {
  const name = Buffer.from("word/document.xml");
  const data = Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, data, central, name, eocd]);
}

const now = new Date("2026-07-05T11:00:00.000Z");
const state = initialStateForUser({ id: "phase23_student" });
state.courses.push({ id: "course_physics", title: "Physics", source: "manual", academicContextIncluded: true });
state.topics.push({
  id: "topic_newtons_laws",
  courseId: "course_physics",
  title: "Newton's laws",
  coverageState: "teaching",
  mastery: "developing",
  weakSignals: [],
  sourceMaterialIds: [],
});
state.studentProfile.dailyTodoPlan = ensureDailyTodoStudyState({
  date: "2026-07-05",
  generated_at: now.toISOString(),
  items: [{
    title: "Review motion and forces",
    related_course: "Physics",
    related_context: "Newton's laws",
    reason: "The mechanics exam is approaching.",
    time_hint: "45 minutes",
    priority: "high",
    study_status: "done",
    study_completed_at: now.toISOString(),
  }],
});
const item = state.studentProfile.dailyTodoPlan.items[0];
state.sourceMaterials.push({
  id: "source_physics",
  userId: state.studentProfile.id,
  courseId: "course_physics",
  title: "Forces lesson",
  generatedContent: "Net force changes acceleration. Free-body diagrams show all forces acting on an object.",
  todoItemId: item.id,
  source: "studentos_generated",
  academicContextIncluded: true,
});

const typedSession = (await generateStudyTest({ state, item, now, providerConfig: { requestedMode: "mock" } })).session;
startStudyTestSession(typedSession, "typed", { now });
saveStudyTestAnswers(typedSession, {
  1: "The central idea is that net force determines how motion changes.",
  2: "Force causes acceleration, while mass resists acceleration. They are connected by F = ma.",
}, { now: new Date(now.getTime() + 60_000) });
finishStudyTestSession(typedSession, { now: new Date(now.getTime() + 120_000) });
assert.equal(typedSession.status, "submitted_pending_evaluation");

let providerPayload = null;
const providerEvaluation = {
  total_marks: 25,
  scored_marks: 12,
  percentage: 48,
  question_results: typedSession.testPaper.questions.map((question) => ({
    question_number: question.question_number,
    marks_awarded: question.question_number <= 2 ? question.marks : 0,
    max_marks: question.marks,
    feedback: question.question_number <= 2 ? "Relevant explanation." : "No answer was provided.",
    correction: "State the key principle and show how it applies.",
  })),
  strengths: ["Connected force and acceleration"],
  weak_topics: ["Free-body diagrams"],
  next_steps: ["Review corrections", "Practise one force diagram"],
  short_revision_plan: "Review the lesson, redraw two diagrams, and answer one fresh question.",
};
const fetchImpl = async (_url, options) => {
  providerPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(providerEvaluation) } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
const providerConfig = {
  requestedMode: "groq",
  groq: {
    configured: true,
    keys: [{ name: "test-key", value: "not-a-real-secret", index: 0 }],
    model: "test-model",
    endpoint: "https://example.invalid/evaluate",
    maxCompletionTokens: 2000,
    reasoningEffort: null,
    timeoutMs: 2000,
  },
  pollinations: { configured: false },
};
const providerResult = await evaluateStudyTest({ state, item, session: typedSession, providerConfig, fetchImpl });
assert.equal(providerResult.evaluationSucceeded, true);
const providerInput = JSON.parse(providerPayload.messages[1].content);
assert.deepEqual(providerInput.student_answers, typedSession.answers, "saved typed answers must be sent for evaluation");
assert.equal(providerInput.test_paper.test_title, typedSession.testPaper.test_title);
assert.equal(providerInput.relevant_study_material[0].title, "Forces lesson");

const normalized = normalizeTestEvaluation(providerEvaluation, typedSession.testPaper);
assert.equal(normalized.total_marks, typedSession.testPaper.total_marks);
assert.equal(normalized.question_results.length, typedSession.testPaper.questions.length);
assert.ok(normalized.percentage >= 0 && normalized.percentage <= 100);

const deterministic = buildDeterministicTestEvaluation({ session: typedSession });
assert.ok(deterministic.question_results.some((result) => result.marks_awarded > 0));
assert.deepEqual(deterministic.question_results.map((result) => result.question_number), typedSession.testPaper.questions.map((question) => question.question_number));

state.testSessions.push(typedSession);
applyStudyTestEvaluation({ state, item, session: typedSession, evaluation: normalized, now });
assert.equal(typedSession.status, "evaluated");
assert.equal(item.workflow_status, "completed");
assert.equal(item.evaluation_completed_at, now.toISOString());
assert.equal(state.testResults[0].testSessionId, typedSession.id);
assert.ok(state.topics.some((topic) => topic.title === "Free-body diagrams" && topic.weakSignals.length));
assert.throws(() => saveStudyTestAnswers(typedSession, { 1: "changed after grading" }, { now }), /cannot be changed/);

const retrySession = (await generateStudyTest({ state, item, now, providerConfig: { requestedMode: "mock" } })).session;
startStudyTestSession(retrySession, "typed", { now });
saveStudyTestAnswers(retrySession, { 1: "Preserve this answer" }, { now });
finishStudyTestSession(retrySession, { now });
const failed = await evaluateStudyTest({
  state,
  item,
  session: retrySession,
  providerConfig: { requestedMode: "auto", groq: { configured: false }, pollinations: { configured: false } },
});
assert.equal(failed.evaluationSucceeded, false);
assert.equal(retrySession.answers[1], "Preserve this answer");
assert.equal(retrySession.status, "submitted_pending_evaluation");

const allowanceRepository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const allowanceSession = { authenticated: true, mode: "test", user: { id: "phase23_allowance" } };
const allowanceRequest = {
  planTier: "trial",
  periodKey: "week_2026-06-29",
  allowance: 6,
  actionType: "tutoring_explanation",
  creditCost: 3,
  metadata: { workflow: "study_test_evaluation", testSessionId: typedSession.id },
};
const successReservation = await allowanceRepository.reserveAiWeeklyAllowance(allowanceSession, { ...allowanceRequest, requestId: "evaluation_success" });
assert.equal(successReservation.allowed, true);
const successSettlement = await allowanceRepository.settleAiWeeklyAllowance(allowanceSession, { requestId: "evaluation_success", status: "charged" });
assert.equal(successSettlement.status, "charged");
assert.equal(successSettlement.used, 3);
const failureReservation = await allowanceRepository.reserveAiWeeklyAllowance(allowanceSession, { ...allowanceRequest, requestId: "evaluation_failure" });
assert.equal(failureReservation.allowed, true);
const failureSettlement = await allowanceRepository.settleAiWeeklyAllowance(allowanceSession, { requestId: "evaluation_failure", status: "refunded" });
assert.equal(failureSettlement.status, "refunded");
assert.equal(failureSettlement.used, 3, "failed evaluation must not remain charged");
const exhaustedReservation = await allowanceRepository.reserveAiWeeklyAllowance(allowanceSession, { ...allowanceRequest, allowance: 3, requestId: "evaluation_exhausted" });
assert.equal(exhaustedReservation.allowed, false, "exhausted allowance must block before evaluation");

const pdfBytes = Buffer.from("%PDF-1.4\nreadable fixture");
assert.equal(validateStudyAnswerSheet({ filename: "answers.pdf", mimeType: "application/pdf", bytes: pdfBytes }).ok, true);
const docxBytes = minimalStoredDocx("My written answer explains net force and acceleration.");
assert.equal(validateStudyAnswerSheet({ filename: "answers.docx", mimeType: "", bytes: docxBytes }).ok, true);
assert.match(extractDocxText(docxBytes), /net force and acceleration/);
for (const invalid of [
  { filename: "answers.txt", mimeType: "text/plain", bytes: Buffer.from("answer") },
  { filename: "answers.pdf", mimeType: "application/pdf", bytes: Buffer.from("not a pdf") },
  { filename: "answers.docx", mimeType: DOCX_MIME, bytes: Buffer.from("not a docx") },
]) assert.equal(validateStudyAnswerSheet(invalid).ok, false, ANSWER_SHEET_COPY);

const [app, server, css, html, packageJson] = await Promise.all([
  readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8"),
  readFile(new URL("./server.js", import.meta.url), "utf8"),
  readFile(new URL("../frontend/styles/main.css", import.meta.url), "utf8"),
  readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

for (const copy of [
  "Upload your handwritten answer sheet as PDF or DOCX.",
  "Your result",
  "What went well",
  "What to revise",
  "Corrections",
  "Next steps",
  "Review corrections",
  "Back to Today",
  "Continue Study and Evaluate",
]) assert.match(app, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(app, /accept="\.pdf,\.docx/);
assert.match(app, /data-study-test-evaluate/);
assert.match(app, /question\.feedback/);
assert.match(app, /question\.correction/);
assert.match(css, /\.study-test-result/);
assert.match(server, /studyTestEvaluateMatch/);
assert.match(server, /workflow: "study_test_evaluation"/);
assert.match(server, /if \(execution\.blocked\)[\s\S]*evaluationSucceeded/);
assert.match(server, /isLogicalSuccess: \(result\) => result\?\.evaluationSucceeded/);
assert.match(server, /Your answers are safe\. Please try again\./);
assert.match(packageJson, /test:phase2-3/);

const normalStudyUi = `${html.slice(html.indexOf('id="view-study"'), html.indexOf('id="view-studio"'))}\n${app.slice(app.indexOf("function currentStudyPlan"), app.indexOf("function renderDashboardSummary"))}`;
assert.doesNotMatch(normalStudyUi, /data-study-test-(?:download|print|export)/i);
assert.doesNotMatch(normalStudyUi, /(?:Provider|Model|Backend|Debug)\s+(?:status|details?|error|code)|OAuth scope/i);
assert.doesNotMatch(`${html}\n${app}`, /Plan Free/i);
for (const plan of ["trial", "starter", "essential", "plus", "pro"]) {
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(plan, action), false);
}
assert.equal(getProductFlowConfig({}, "development").realPaymentEnabled, false);

console.log("PASS | StudentOS Phase 2.3 test evaluation tests passed");
