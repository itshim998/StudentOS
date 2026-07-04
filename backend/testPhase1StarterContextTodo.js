import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ACADEMIC_CONTEXT_ARTIFACT_KINDS,
  ACADEMIC_CONTEXT_STATUSES,
  addManualExam,
  advanceAcademicContextPreparation,
  applyAcademicContextDeletion,
  beginAcademicContextPreparation,
  buildAcademicContextDeletionPlan,
  getAcademicContextReadiness,
  linkManualAcademicContextUpload,
  markAcademicContextNeedsPreparation,
  removeManualExam,
  updateManualExam,
  validateManualAcademicContextContract,
} from "./domain/academicContextService.js";
import { addManualCourse, updateManualCourse } from "./domain/courseManagementService.js";
import {
  buildDailyTodoInput,
  generateDailyTodoPlan,
  normalizeDailyTodoClock,
} from "./ai/dailyTodoService.js";
import { getAiProviderConfig } from "./ai/providerConfig.js";
import { resetProviderRuntimeForTests } from "./ai/providers.js";
import { classifyAiTask } from "./ai/aiWeeklyAllowanceService.js";
import { initialStateForUser, StudentOsRepository } from "./repository/studentOsRepository.js";
import {
  CLASSROOM_WRITE_ACTIONS,
  FEATURE_KEYS,
  canUseClassroomAction,
  canUseFeature,
} from "./domain/planEntitlementService.js";
import { getProductFlowConfig } from "./domain/productLifecycleService.js";

const now = new Date("2026-07-03T12:15:00.000Z");
const state = initialStateForUser({ id: "phase1_context_student" });
assert.equal(getAcademicContextReadiness(state).status, ACADEMIC_CONTEXT_STATUSES.EMPTY);

const course = addManualCourse(state, {
  courseName: "Physics",
  courseCode: "PHY 101",
  term: "Semester 1",
}, { now, idFactory: () => "course-test-id" });
assert.equal(getAcademicContextReadiness(state).status, ACADEMIC_CONTEXT_STATUSES.NEEDS_PREPARATION);
assert.equal(getAcademicContextReadiness(state).hasUsefulContext, false);
updateManualCourse(state, course.id, { courseName: "Applied Physics", courseCode: "PHY 101", term: "Semester 1" }, { now });
assert.equal(state.studentProfile.academicContextPreparation.changeReason, "course_updated");

const pdfFile = { filename: "physics-syllabus.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4 test") };
const syllabusContract = validateManualAcademicContextContract({
  state,
  fields: { artifactKind: "syllabus", courseId: course.id, title: "Physics syllabus" },
  file: pdfFile,
  pdfValidation: { ok: true },
});
assert.equal(syllabusContract.deadline, null);
assert.throws(() => validateManualAcademicContextContract({
  state,
  fields: { artifactKind: "syllabus", title: "Missing course" },
  file: pdfFile,
  pdfValidation: { ok: true },
}), /Choose a course for this syllabus/i);
assert.throws(() => validateManualAcademicContextContract({
  state,
  fields: { artifactKind: "material", courseId: course.id },
  file: { ...pdfFile, filename: "notes.txt" },
  pdfValidation: { ok: false },
}), /upload a PDF/i);
assert.throws(() => validateManualAcademicContextContract({
  state,
  fields: { artifactKind: "assignment", courseId: course.id },
  file: pdfFile,
  pdfValidation: { ok: true },
}), /deadline/i);

const semesterState = initialStateForUser({ id: "phase1_semester_schedule" });
const examScheduleContract = validateManualAcademicContextContract({
  state: semesterState,
  fields: { artifactKind: "exam_schedule", title: "Semester exam schedule" },
  file: pdfFile,
  pdfValidation: { ok: true },
});
assert.equal(examScheduleContract.courseId, null);
assert.throws(() => validateManualAcademicContextContract({
  state: semesterState,
  fields: { artifactKind: "exam_schedule", title: "Not a PDF" },
  file: { ...pdfFile, filename: "exam-schedule.txt" },
  pdfValidation: { ok: false },
}), /upload a PDF/i);
assert(ACADEMIC_CONTEXT_ARTIFACT_KINDS.includes("exam_schedule"));

const material = {
  id: "source_physics_syllabus",
  userId: state.studentProfile.id,
  courseId: course.id,
  title: "Physics syllabus",
  status: "indexed",
  extractedText: "Motion, forces, energy, and waves form the semester syllabus.",
};
const linked = linkManualAcademicContextUpload(state, material, syllabusContract, { now });
state.sourceMaterials.push(material);
markAcademicContextNeedsPreparation(state, "syllabus_uploaded", { now });
assert.equal(linked.syllabus.sourceMaterialId, material.id);
assert.equal(getAcademicContextReadiness(state).hasUsefulContext, true);

assert.throws(() => addManualExam(state, { courseId: course.id, examDate: "2026-07-10" }, { now }), /exam name/i);
assert.throws(() => addManualExam(state, { courseId: course.id, examName: "Midterm" }, { now }), /exam date/i);
assert.throws(() => addManualExam(state, { examName: "Midterm", examDate: "2026-07-10" }, { now }), /Choose a course/i);
const exam = addManualExam(state, {
  courseId: course.id,
  examName: "Physics midterm",
  examDate: "2026-07-10",
  examTime: "10:30",
  marksWeightage: "40%",
  notes: "Focus on motion and forces",
}, { now, idFactory: () => "exam-test-id" });
assert.equal(exam.examTime, "10:30");
assert.equal(state.studentProfile.academicContextPreparation.changeReason, "exam_added");
updateManualExam(state, exam.id, { ...exam, examName: "Physics semester midterm", courseId: course.id }, { now });
assert.equal(state.studentProfile.academicContextPreparation.changeReason, "exam_updated");

const preparing = beginAcademicContextPreparation(state, { now });
assert.equal(preparing.status, ACADEMIC_CONTEXT_STATUSES.PREPARING);
const prepared = advanceAcademicContextPreparation(state, { now: new Date("2026-07-03T12:15:01.000Z"), force: true });
assert.equal(prepared.changed, true);
assert.equal(prepared.readiness.status, ACADEMIC_CONTEXT_STATUSES.READY);
assert.equal(prepared.readiness.canGenerateTodo, true);
assert.equal(state.studentProfile.academicContextPreparation.capsule.exams[0].title, "Physics semester midterm");

const clock = normalizeDailyTodoClock({ currentDate: "2026-07-03", currentTime: "18:20", timezone: "Asia/Calcutta", now });
assert.deepEqual(clock, { currentDate: "2026-07-03", currentTime: "18:20", timezone: "Asia/Calcutta" });
const todoInput = buildDailyTodoInput(state, { ...clock, planTier: "starter", now });
assert.equal(todoInput.currentTime, "18:20");
assert.equal(todoInput.timezone, "Asia/Calcutta");
assert.equal(todoInput.preparedAcademicContext.exams.length, 1);

let unreadyProviderCalls = 0;
const unreadyState = initialStateForUser({ id: "phase1_unready" });
const unreadyCourse = addManualCourse(unreadyState, { courseName: "Chemistry" }, { now, idFactory: () => "unready-course" });
addManualExam(unreadyState, { courseId: unreadyCourse.id, examName: "Chemistry exam", examDate: "2026-07-12" }, { now });
await assert.rejects(() => generateDailyTodoPlan({
  state: unreadyState,
  ...clock,
  planTier: "starter",
  now,
  providerConfig: getAiProviderConfig({ STUDENTOS_AI_MODE: "auto", GROQ_API_KEY: "test-key" }),
  fetchImpl: async () => {
    unreadyProviderCalls += 1;
    return new Response("{}", { status: 200 });
  },
}), /Prepare Academic Context/i);
assert.equal(unreadyProviderCalls, 0);

const localTodo = await generateDailyTodoPlan({
  state,
  ...clock,
  planTier: "starter",
  now,
  providerConfig: getAiProviderConfig({ STUDENTOS_AI_MODE: "mock" }),
});
assert.equal(localTodo.generationSucceeded, true);
assert.equal(localTodo.plan.date, "2026-07-03");
assert(localTodo.plan.items.length > 0);
for (const item of localTodo.plan.items) {
  assert(item.title && item.time_hint && item.reason);
  assert(["high", "medium", "low"].includes(item.priority));
}

let providerCalls = 0;
let providerInput = null;
resetProviderRuntimeForTests();
const providerTodo = await generateDailyTodoPlan({
  state,
  ...clock,
  planTier: "starter",
  now,
  providerConfig: getAiProviderConfig({ STUDENTOS_AI_MODE: "auto", GROQ_API_KEY: "test-key" }),
  fetchImpl: async (_url, options) => {
    providerCalls += 1;
    const body = JSON.parse(options.body);
    providerInput = JSON.parse(body.messages[1].content);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: "A focused evening plan.",
        items: [{
          title: "Review motion",
          time_hint: "45 minutes",
          reason: "The Physics exam is approaching.",
          related_course: "Applied Physics",
          related_context: "Physics syllabus",
          priority: "high",
        }],
      }) } }],
    }), { status: 200 });
  },
});
assert.equal(providerCalls, 1);
assert.equal(providerInput.currentDate, "2026-07-03");
assert.equal(providerInput.currentTime, "18:20");
assert.equal(providerInput.timezone, "Asia/Calcutta");
assert.equal(providerTodo.plan.items[0].related_course, "Applied Physics");

resetProviderRuntimeForTests();
const failedTodo = await generateDailyTodoPlan({
  state,
  ...clock,
  planTier: "starter",
  now,
  providerConfig: getAiProviderConfig({ STUDENTOS_AI_MODE: "auto" }),
});
assert.equal(failedTodo.generationSucceeded, false);

const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const session = { authenticated: true, mode: "test", user: { id: "phase1_allowance" } };
const planningTask = classifyAiTask({ verb: "Plan", message: "Generate today's TO-DO list" });
const reservation = await repository.reserveAiWeeklyAllowance(session, {
  planTier: "starter",
  periodKey: "week_2026-06-29",
  allowance: 35,
  actionType: planningTask.actionType,
  creditCost: planningTask.creditCost,
  requestId: "phase1_success",
});
assert.equal(reservation.allowed, true);
const charged = await repository.settleAiWeeklyAllowance(session, { requestId: "phase1_success", status: "charged" });
assert.equal(charged.used, planningTask.creditCost);
await repository.reserveAiWeeklyAllowance(session, {
  planTier: "starter",
  periodKey: "week_2026-06-29",
  allowance: 35,
  actionType: planningTask.actionType,
  creditCost: planningTask.creditCost,
  requestId: "phase1_failure",
});
const refunded = await repository.settleAiWeeklyAllowance(session, { requestId: "phase1_failure", status: "refunded" });
assert.equal(refunded.used, planningTask.creditCost);
const blocked = await repository.reserveAiWeeklyAllowance(session, {
  planTier: "starter",
  periodKey: "week_2026-06-29",
  allowance: planningTask.creditCost,
  actionType: planningTask.actionType,
  creditCost: planningTask.creditCost,
  requestId: "phase1_blocked",
});
assert.equal(blocked.allowed, false);

const syllabusDeletion = buildAcademicContextDeletionPlan(state, { kind: "material", itemId: material.id });
applyAcademicContextDeletion(state, syllabusDeletion, { now });
assert.equal(state.syllabi.some((item) => item.sourceMaterialId === material.id), false);
assert.equal(state.studentProfile.academicContextPreparation.status, ACADEMIC_CONTEXT_STATUSES.NEEDS_PREPARATION);
removeManualExam(state, exam.id, { now });
assert.equal(state.studentProfile.academicContextPreparation.changeReason, "exam_removed");

const [serverSource, appSource, htmlSource] = await Promise.all([
  readFile(new URL("./server.js", import.meta.url), "utf8"),
  readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8"),
  readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
]);
assert.match(serverSource, /url\.pathname === "\/api\/academic-context\/prepare"/);
assert.match(serverSource, /url\.pathname === "\/api\/today\/todo"/);
assert.match(serverSource, /status: generated \? "charged" : "refunded"/);
const todoRoute = serverSource.slice(serverSource.indexOf('url.pathname === "/api/today/todo"'), serverSource.indexOf('url.pathname === "/api/product-flow"'));
assert(todoRoute.indexOf("readiness.canGenerateTodo") < todoRoute.indexOf("reserveAiWeeklyAllowance"));
const starterTodaySource = appSource.slice(appSource.indexOf("function renderStarterToday"), appSource.indexOf("function renderDashboardSummary"));
assert.match(starterTodaySource, /Add your academic context first\./);
assert.match(starterTodaySource, /Prepare Academic Context/);
assert.match(starterTodaySource, /Generate today’s TO-DO list/);
assert.doesNotMatch(starterTodaySource, /Quadratics worksheet|Sources ready|default roadmap/i);
assert.doesNotMatch(starterTodaySource, /\b(provider|model|token|storage|database|backend|vector|embedding|chunks?|debug|OAuth scope)\b/i);
assert.match(htmlSource, /value="syllabus"/);
assert.match(htmlSource, /value="exam_schedule"/);
assert.match(htmlSource, /id="exam-form"/);
assert.doesNotMatch(`${htmlSource}\n${appSource}`, /Plan Free/i);

for (const plan of ["starter", "essential", "plus", "pro"]) {
  assert.equal(canUseFeature(plan, FEATURE_KEYS.ASSIGNMENT_WRITEBACK), false);
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(plan, action), false);
}
assert.equal(getProductFlowConfig({}, "development").realPaymentEnabled, false);

console.log("PASS | StudentOS Phase 1 Starter context preparation and daily TO-DO tests passed");
