import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyStudyTestEvaluation } from "./ai/studyTestEvaluationService.js";
import { buildDailyTodoInput, generateDailyTodoPlan } from "./ai/dailyTodoService.js";
import { beginAcademicContextPreparation, advanceAcademicContextPreparation } from "./domain/academicContextService.js";
import { applyStudentOnboarding, refreshAcademicRoadmap } from "./domain/onboardingService.js";
import { normalizeWeeklyAvailability } from "./domain/studyAvailabilityService.js";
import { isEvidenceDerivedWeakTopic, TOPIC_WEAK_THRESHOLD_PERCENT } from "./domain/topicPerformanceService.js";
import { initialStateForUser, StudentOsRepository } from "./repository/studentOsRepository.js";

const monday = new Date("2026-07-20T12:00:00.000Z");
const state = initialStateForUser({ id: "pass36_evidence_student", email: "student@example.com" });
state.courses.push({ id: "course_math", title: "Mathematics", source: "manual", academicContextIncluded: true });
state.topics.push(
  { id: "topic_a", courseId: "course_math", title: "Algebra", mastery: "not_started", coverageState: "uncovered", weakSignals: [], academicContextIncluded: true },
  { id: "topic_b", courseId: "course_math", title: "Geometry", mastery: "not_started", coverageState: "uncovered", weakSignals: [], academicContextIncluded: true },
);
state.syllabi.push({ id: "syllabus_math", courseId: "course_math", title: "Mathematics syllabus", units: ["Algebra", "Geometry"], academicContextIncluded: true });
state.exams.push({ id: "exam_math", courseId: "course_math", title: "Mathematics exam", examDate: "2026-08-20", academicContextIncluded: true });
state.studentProfile.preferences = {
  dailyStudyAvailabilityMinutes: 120,
  scheduleText: "Weekdays after 6 PM, and weekends all day.",
  timetableText: "Weekdays after 6 PM, and weekends all day.",
  studyAvailability: normalizeWeeklyAvailability("Weekdays after 6 PM, and weekends all day."),
};
state.timetable.push({
  id: "class_math_monday",
  courseId: "course_math",
  title: "Mathematics class",
  dayOfWeek: 1,
  startTime: "18:00",
  endTime: "19:00",
  kind: "blocked",
  academicContextIncluded: true,
});
beginAcademicContextPreparation(state, { now: monday });
advanceAcademicContextPreparation(state, { now: monday, force: true });

function assessedItem(topicId, title) {
  return {
    id: `todo_${topicId}`,
    title: `Study ${title}`,
    related_course: "Mathematics",
    related_context: title,
    topic_mastery_queue: {
      activeTopicId: topicId,
      topics: [{ id: topicId, title, order: 1, status: "done", subparts: [] }],
    },
  };
}

function applyAssessment({ sessionId, topicId, topicTitle, earned, available, assessedAt, mapped = true }) {
  const item = assessedItem(topicId || `unmapped_${sessionId}`, topicTitle);
  state.studentProfile.dailyTodoPlan = { date: assessedAt.slice(0, 10), items: [item] };
  const session = {
    id: sessionId,
    userId: state.studentProfile.id,
    todoItemId: item.id,
    parentTopicId: topicId || null,
    courseId: "course_math",
    topicId: topicId || null,
    status: "submitted_pending_evaluation",
    answers: {},
    testPaper: {
      topic: topicTitle,
      questions: [{
        question_number: 1,
        marks: available,
        course_id: mapped ? "course_math" : null,
        topic_id: mapped ? topicId : null,
        topic_title: mapped ? topicTitle : null,
        mapping_source: mapped ? "studentos_strict_test_scope" : null,
      }],
    },
  };
  const evaluation = {
    total_marks: available,
    scored_marks: earned,
    percentage: (earned / available) * 100,
    question_results: [{ question_number: 1, marks_awarded: earned, max_marks: available }],
    strengths: [], weak_topics: [], next_steps: [], short_revision_plan: "Review and retry.",
  };
  state.testSessions.push(session);
  return applyStudyTestEvaluation({ state, item, session, evaluation, now: new Date(assessedAt) });
}

assert.equal(TOPIC_WEAK_THRESHOLD_PERCENT, 70);
applyAssessment({ sessionId: "session_a_low", topicId: "topic_a", topicTitle: "Algebra", earned: 6, available: 10, assessedAt: "2026-07-19T10:00:00.000Z" });
applyAssessment({ sessionId: "session_b_strong", topicId: "topic_b", topicTitle: "Geometry", earned: 8, available: 10, assessedAt: "2026-07-19T11:00:00.000Z" });
applyAssessment({ sessionId: "session_c_unmapped", topicId: null, topicTitle: "Invented topic", earned: 2, available: 10, assessedAt: "2026-07-19T12:00:00.000Z", mapped: false });

const topicA = state.topics.find((topic) => topic.id === "topic_a");
const topicB = state.topics.find((topic) => topic.id === "topic_b");
assert.equal(topicA.performance.latestPercentage, 60);
assert.equal(topicA.performance.totalMarksEarned, 6);
assert.equal(topicA.performance.totalMarksAvailable, 10);
assert.equal(topicA.performance.status, "needs_recovery");
assert.equal(isEvidenceDerivedWeakTopic(topicA), true);
assert.equal(topicB.performance.status, "secure");
assert.equal(isEvidenceDerivedWeakTopic(topicB), false);
assert.equal(state.topics.some((topic) => topic.title === "Invented topic"), false);
assert.equal(state.testResults.find((result) => result.testSessionId === "session_c_unmapped").scorePercent, 20);
assert.deepEqual(state.testResults.find((result) => result.testSessionId === "session_c_unmapped").topicEvidence, []);

refreshAcademicRoadmap(state, { now: monday });
assert.equal(state.roadmap.filter((item) => item.kind === "weak_topic_recovery" && item.topicId === "topic_a" && item.status === "open").length, 1);
state.studentProfile.dailyTodoPlan = {
  date: "2026-07-20",
  items: [{ title: "Finish geometry notes", related_course: "Mathematics", related_context: "Geometry", time_hint: "25 minutes", priority: "low", study_status: "studying" }],
};
const planningInput = buildDailyTodoInput(state, { currentDate: "2026-07-20", currentTime: "17:00", timezone: "Asia/Calcutta", now: monday });
assert.deepEqual(planningInput.weakTopics.map((topic) => topic.title), ["Algebra"]);
assert.equal(planningInput.studyAvailability.originalText, "Weekdays after 6 PM, and weekends all day.");
assert.equal(planningInput.studyAvailability.capacityMinutes, 120);
assert.equal(planningInput.studyAvailability.fixedCommitments[0].title, "Mathematics class");

const planned = await generateDailyTodoPlan({
  state,
  currentDate: "2026-07-20",
  currentTime: "17:00",
  timezone: "Asia/Calcutta",
  now: monday,
  providerConfig: { requestedMode: "mock" },
});
assert(planned.plan.items.some((item) => /Algebra/.test(item.title)));
assert(planned.plan.items.some((item) => item.title === "Finish geometry notes"));
assert(planned.plan.items.every((item) => !item.scheduled_start || item.scheduled_start >= "19:00"));
assert(planned.plan.items.reduce((sum, item) => sum + item.duration_minutes, 0) <= 120);
for (let index = 1; index < planned.plan.items.length; index += 1) {
  const previous = planned.plan.items[index - 1];
  const current = planned.plan.items[index];
  if (previous.scheduled_end && current.scheduled_start) assert(previous.scheduled_end <= current.scheduled_start);
}

const weekendInput = buildDailyTodoInput(state, { currentDate: "2026-07-18", currentTime: "10:00", timezone: "Asia/Calcutta", now: new Date("2026-07-18T10:00:00.000Z") });
assert(weekendInput.studyAvailability.capacityMinutes > 0);
assert.equal(weekendInput.studyAvailability.exactWindows.length, 0);
const weekendPlan = await generateDailyTodoPlan({ state, currentDate: "2026-07-18", currentTime: "10:00", timezone: "Asia/Calcutta", now: new Date("2026-07-18T10:00:00.000Z"), providerConfig: { requestedMode: "mock" } });
assert(weekendPlan.plan.items.every((item) => item.scheduled_start === null && /weekend study time/i.test(item.suggested_window)));

state.studentProfile.preferences.scheduleText = "Only Saturday afternoon.";
state.studentProfile.preferences.timetableText = "Only Saturday afternoon.";
state.studentProfile.preferences.studyAvailability = normalizeWeeklyAvailability("Only Saturday afternoon.");
const narrowed = buildDailyTodoInput(state, { currentDate: "2026-07-20", currentTime: "17:00", timezone: "Asia/Calcutta", now: monday });
assert.equal(narrowed.studyAvailability.capacityMinutes, 0);
assert.notEqual(narrowed.studyAvailability.capacityMinutes, planningInput.studyAvailability.capacityMinutes);
assert.equal(state.studentProfile.preferences.scheduleText, "Only Saturday afternoon.");

const resultCountBeforeDuplicate = state.testResults.length;
applyAssessment({ sessionId: "session_a_low", topicId: "topic_a", topicTitle: "Algebra", earned: 6, available: 10, assessedAt: "2026-07-19T10:00:00.000Z" });
assert.equal(state.testResults.length, resultCountBeforeDuplicate);
refreshAcademicRoadmap(state, { now: monday });
assert.equal(state.roadmap.filter((item) => item.kind === "weak_topic_recovery" && item.topicId === "topic_a" && item.status === "open").length, 1);

applyAssessment({ sessionId: "session_a_recovery", topicId: "topic_a", topicTitle: "Algebra", earned: 9, available: 10, assessedAt: "2026-07-21T10:00:00.000Z" });
assert.equal(topicA.performance.status, "secure");
assert.equal(topicA.performance.assessmentCount, 2);
assert.equal(state.testResults.filter((result) => result.topicEvidence?.some((evidence) => evidence.topicId === "topic_a")).length, 2);
assert.equal(state.roadmap.some((item) => item.kind === "weak_topic_recovery" && item.topicId === "topic_a" && item.status === "open"), false);

const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const session = { authenticated: false, user: { id: state.studentProfile.id, email: "student@example.com" } };
await repository.saveState(session, state);
const reloaded = await repository.loadState(session);
assert.equal(reloaded.topics.find((topic) => topic.id === "topic_a").performance.status, "secure");
assert.equal(reloaded.testResults.filter((result) => result.topicEvidence?.length).length, 3);

const legacyState = initialStateForUser({ id: "pass36_legacy_student" });
applyStudentOnboarding(legacyState, {
  displayName: "Legacy Student",
  subjectsText: "Mathematics||Algebra",
  weakTopicsText: "Mathematics: Random demo weakness",
  timetableText: "Weekdays after 6 PM, and weekends all day.",
}, { now: monday });
assert.equal(legacyState.topics.some(isEvidenceDerivedWeakTopic), false);
assert.equal(legacyState.topics.some((topic) => topic.title === "Random demo weakness"), false);
assert.equal(legacyState.studentProfile.preferences.weakTopicsText, "");
assert.equal(legacyState.studentProfile.preferences.legacyWeakTopicsText, "Mathematics: Random demo weakness");

const [html, appSource, serverSource] = await Promise.all([
  readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
  readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8"),
  readFile(new URL("./server.js", import.meta.url), "utf8"),
]);
assert.doesNotMatch(html, /Generate roadmap/);
assert.doesNotMatch(html, /name="weakTopicsText"/);
assert.match(html, /id="derived-weak-topics"/);
assert.match(html, /Save setup/);
assert.match(appSource, /Weak topics are identified from your test performance/);
assert.doesNotMatch(appSource, /submitOnboarding/);
const setupRoute = serverSource.slice(serverSource.indexOf('url.pathname === "/api/onboarding"'), serverSource.indexOf('url.pathname === "/api/courses"'));
assert.match(setupRoute, /applyStudentOnboarding/);
assert.match(setupRoute, /markAcademicContextNeedsPreparation/);
assert.doesNotMatch(setupRoute, /generateDailyTodoPlan|executeAuthorizedAiOperation/);
assert.match(serverSource, /writebackEnabled: false/);

console.log("PASS 36 evidence-based weak topics and schedule-aware planning checks passed.");
