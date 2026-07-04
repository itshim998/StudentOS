import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ACADEMIC_CONTEXT_STATUSES,
  addManualExam,
  advanceAcademicContextPreparation,
  beginAcademicContextPreparation,
  beginSelectedClassroomContentBackfill,
  getAcademicContextInventory,
  getAcademicContextReadiness,
  getSelectedClassroomItemsNeedingBackfill,
  markAcademicContextNeedsPreparation,
} from "./domain/academicContextService.js";
import { addManualCourse } from "./domain/courseManagementService.js";
import {
  importClassroomSnapshotIntoState,
  selectClassroomItemsForAcademicContext,
} from "./connectors/googleClassroom/mapper.js";
import {
  backfillSelectedClassroomContentIntoState,
  shouldRunAutomaticClassroomCheck,
} from "./connectors/googleClassroom/syncService.js";
import {
  buildDailyTodoInput,
  generateDailyTodoPlan,
} from "./ai/dailyTodoService.js";
import { getAiProviderConfig } from "./ai/providerConfig.js";
import { resetProviderRuntimeForTests } from "./ai/providers.js";
import { initialStateForUser } from "./repository/studentOsRepository.js";
import {
  CLASSROOM_WRITE_ACTIONS,
  FEATURE_KEYS,
  canUseClassroomAction,
  canUseFeature,
  getClassroomSyncPolicy,
} from "./domain/planEntitlementService.js";
import { getProductFlowConfig } from "./domain/productLifecycleService.js";

const now = new Date("2026-08-01T12:00:00.000Z");
const selectedState = initialStateForUser({ id: "phase12_selected" });
selectedState.studentProfile.preferences.googleClassroom = {
  lastSyncAt: "2026-07-31T08:00:00.000Z",
  lastSyncSummary: { discoveredAssignments: 2 },
};
const classroomSnapshot = {
  courses: [{ providerCourseId: "course_ai", title: "AI", section: "Semester 1" }],
  courseWork: [
    {
      providerCourseId: "course_ai",
      providerCourseWorkId: "selected_assignment",
      title: "AI search assignment",
      description: "",
      dueAt: "2026-08-03T23:59:00.000Z",
      updateTime: "2026-07-31T07:00:00.000Z",
      materials: [],
    },
    {
      providerCourseId: "course_ai",
      providerCourseWorkId: "unselected_assignment",
      title: "Unselected AI worksheet",
      description: "Should remain review-only.",
      dueAt: "2026-08-05T23:59:00.000Z",
      updateTime: "2026-07-31T07:10:00.000Z",
      materials: [],
    },
  ],
  courseWorkMaterials: [{
    providerCourseId: "course_ai",
    providerCourseWorkMaterialId: "selected_material_post",
    title: "AI CIA guide",
    description: "",
    updateTime: "2026-07-31T07:20:00.000Z",
    materials: [{
      providerMaterialId: "drive_file_1",
      title: "AI CIA guide.pdf",
      rawType: "drive_file",
      linkUrl: "https://classroom.google.com/example",
    }],
  }],
  submissions: [],
  errors: [],
};
importClassroomSnapshotIntoState(selectedState, classroomSnapshot, { now });
const selectedAssignment = selectedState.classroomItems.find((item) => item.externalId === "selected_assignment");
const unselectedAssignment = selectedState.classroomItems.find((item) => item.externalId === "unselected_assignment");
const selectedMaterial = selectedState.classroomItems.find((item) => item.providerMaterialId === "drive_file_1");
selectClassroomItemsForAcademicContext(selectedState, [selectedAssignment.id, selectedMaterial.id], { now });
markAcademicContextNeedsPreparation(selectedState, "classroom_context_selected", { now });

let inventory = getAcademicContextInventory(selectedState);
assert.equal(inventory.selectedClassroomItems.length, 2);
assert.equal(inventory.selectedMetadataOnly.length, 2);
assert.equal(inventory.selectedAssignmentsWithDueDates.length, 1);
assert.equal(inventory.selectedClassroomItems.some((item) => item.id === unselectedAssignment.id), false);
assert.equal(selectedState.assignments.some((item) => item.classroomItemId === unselectedAssignment.id && item.academicContextIncluded), false);
assert.equal(selectedState.sourceMaterials.find((source) => source.classroomItemId === selectedMaterial.id).status, "metadata_only");
assert.equal(getAcademicContextReadiness(selectedState).status, ACADEMIC_CONTEXT_STATUSES.SELECTED_METADATA);

const cadenceBefore = structuredClone(selectedState.studentProfile.preferences.googleClassroom);
const backfill = beginSelectedClassroomContentBackfill(selectedState, { now });
assert.equal(backfill.started, true);
assert.equal(backfill.items.length, 2);
assert.equal(backfill.readiness.status, ACADEMIC_CONTEXT_STATUSES.CLASSROOM_BACKFILL);
const fetchedIds = [];
const backfillSummary = await backfillSelectedClassroomContentIntoState({
  state: selectedState,
  session: { authenticated: true, user: { id: "phase12_selected" } },
  repository: null,
  items: backfill.items,
  config: { mode: "mock", scopes: [] },
  now,
  fetchItem: async (item) => {
    fetchedIds.push(item.id);
    return { content: item.id === selectedAssignment.id ? "Implement BFS and A* search, then compare their complexity." : "" };
  },
});
assert.deepEqual(new Set(fetchedIds), new Set([selectedAssignment.id, selectedMaterial.id]));
assert.equal(fetchedIds.includes(unselectedAssignment.id), false);
assert.equal(backfillSummary.contentReady, 1);
assert.equal(backfillSummary.manualUploadRequired, 1);
assert.equal(backfillSummary.cadenceUnchanged, true);
assert.deepEqual(selectedState.studentProfile.preferences.googleClassroom, cadenceBefore);
assert.equal(shouldRunAutomaticClassroomCheck({
  state: selectedState,
  policy: { autoCheckEnabled: true, intervalDays: 7 },
  now,
}).reason, "schedule_not_due");
assert.equal(getSelectedClassroomItemsNeedingBackfill(selectedState, { now }).length, 0);
assert.equal(beginSelectedClassroomContentBackfill(selectedState, { now }).started, false);

markAcademicContextNeedsPreparation(selectedState, "selected_classroom_content_checked", { now });
beginAcademicContextPreparation(selectedState, { now });
advanceAcademicContextPreparation(selectedState, { now, force: true });
let readiness = getAcademicContextReadiness(selectedState);
assert.equal(readiness.status, ACADEMIC_CONTEXT_STATUSES.READY);
assert.equal(readiness.lessComplete, true);
assert.match(readiness.manualUploadGuidance, /manual upload/i);
assert.equal(selectedState.studentProfile.academicContextPreparation.capsule.assignments[0].description.includes("BFS"), true);

const automaticDiscovery = structuredClone(classroomSnapshot);
automaticDiscovery.courseWork.push({
  providerCourseId: "course_ai",
  providerCourseWorkId: "new_review_only",
  title: "New review-only work",
  description: "New instructions",
  dueAt: "2026-08-07T23:59:00.000Z",
  updateTime: "2026-08-01T11:00:00.000Z",
  materials: [],
});
importClassroomSnapshotIntoState(selectedState, automaticDiscovery, { now });
const reviewOnly = selectedState.classroomItems.find((item) => item.externalId === "new_review_only");
assert.equal(reviewOnly.selectionState, "discovered");
assert.equal(reviewOnly.academicContextIncluded, false);
assert.equal(getAcademicContextReadiness(selectedState).status, ACADEMIC_CONTEXT_STATUSES.READY);
selectClassroomItemsForAcademicContext(selectedState, [reviewOnly.id], { now });
assert.equal(getAcademicContextReadiness(selectedState).status, ACADEMIC_CONTEXT_STATUSES.NEEDS_PREPARATION);

const starterState = initialStateForUser({ id: "phase12_starter" });
const starterCourse = addManualCourse(starterState, { courseName: "Physics" }, { now, idFactory: () => "starter-course" });
addManualExam(starterState, {
  courseId: starterCourse.id,
  examName: "Physics CIA",
  examDate: "2026-08-12",
}, { now, idFactory: () => "starter-exam" });
assert.equal(beginSelectedClassroomContentBackfill(starterState, { now }).started, false);
beginAcademicContextPreparation(starterState, { now });
advanceAcademicContextPreparation(starterState, { now, force: true });
assert.equal(getAcademicContextReadiness(starterState).status, ACADEMIC_CONTEXT_STATUSES.READY);

const priorityState = initialStateForUser({ id: "phase12_priority" });
priorityState.studentProfile.preferences.dailyStudyAvailabilityMinutes = 180;
const courseNames = ["AI", "Electronics", "Math", "OS", "DAA", "EVS"];
const priorityCourses = courseNames.map((courseName) => addManualCourse(priorityState, { courseName }, {
  now,
  idFactory: () => `${courseName.toLowerCase()}-course`,
}));
priorityState.syllabi = priorityCourses.map((course, index) => ({
  id: `syllabus_${course.id}`,
  courseId: course.id,
  title: `${course.title} semester syllabus`,
  units: [`Topic 1`, `Topic 2`, `Topic ${index + 3}`],
  academicContextIncluded: true,
  source: "manual",
  updatedAt: now.toISOString(),
}));
addManualExam(priorityState, {
  courseId: priorityCourses[0].id,
  examName: "AI CIA 1",
  examDate: "2026-09-02",
  notes: "Topics 1-2 of 6",
}, { now, idFactory: () => "ai-exam" });
addManualExam(priorityState, {
  courseId: priorityCourses[1].id,
  examName: "Electronics CIA 1",
  examDate: "2026-09-04",
  notes: "Topics 1-2 of 6",
}, { now, idFactory: () => "electronics-exam" });
markAcademicContextNeedsPreparation(priorityState, "fixture_ready", { now });
beginAcademicContextPreparation(priorityState, { now });
advanceAcademicContextPreparation(priorityState, { now, force: true });
const priorityInput = buildDailyTodoInput(priorityState, {
  currentDate: "2026-08-01",
  currentTime: "18:00",
  timezone: "Asia/Calcutta",
  planTier: "essential",
  now,
});
assert.equal(priorityInput.currentDate, "2026-08-01");
assert.equal(priorityInput.currentTime, "18:00");
assert.equal(priorityInput.timezone, "Asia/Calcutta");
assert.equal(priorityInput.planTier, "essential");
assert.equal(priorityInput.preparedAcademicContext.syllabi.length, 6);
assert.equal(priorityInput.preparedAcademicContext.exams.length, 2);
assert.equal(priorityInput.onboardingProfile.dailyStudyAvailabilityMinutes, 180);
const deterministic = await generateDailyTodoPlan({
  state: priorityState,
  currentDate: "2026-08-01",
  currentTime: "18:00",
  timezone: "Asia/Calcutta",
  planTier: "essential",
  now,
  providerConfig: getAiProviderConfig({ STUDENTOS_AI_MODE: "mock" }),
});
assert.match(deterministic.plan.items[0].title, /AI CIA 1/i);
assert.match(deterministic.plan.items[1].title, /Electronics CIA 1/i);
assert.deepEqual(deterministic.plan.items.slice(2).map((item) => item.related_course), ["Math", "OS", "DAA", "EVS"]);

let providerCalls = 0;
let providerUrl = "";
resetProviderRuntimeForTests();
const corrected = await generateDailyTodoPlan({
  state: priorityState,
  currentDate: "2026-08-01",
  currentTime: "18:00",
  timezone: "Asia/Calcutta",
  planTier: "pro",
  now,
  providerConfig: getAiProviderConfig({ STUDENTOS_AI_MODE: "auto", GROQ_API_KEY: "test-key" }),
  fetchImpl: async (url) => {
    providerCalls += 1;
    providerUrl = String(url);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: "Generic plan",
        items: [{
          title: "Study something",
          time_hint: "30 minutes",
          reason: "Studying is useful.",
          related_course: "Unknown",
          related_context: "Nothing selected",
          priority: "medium",
        }],
      }) } }],
    }), { status: 200 });
  },
});
assert.equal(providerCalls, 1);
assert.match(providerUrl, /groq/i);
assert.doesNotMatch(corrected.plan.items[0].title, /Study something/i);
assert.match(corrected.plan.items[0].title, /AI CIA 1/i);

const [serverSource, appSource, configSource] = await Promise.all([
  readFile(new URL("./server.js", import.meta.url), "utf8"),
  readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8"),
  readFile(new URL("./connectors/googleClassroom/config.js", import.meta.url), "utf8"),
]);
const prepareRoute = serverSource.slice(serverSource.indexOf('url.pathname === "/api/academic-context/prepare"'), serverSource.indexOf('url.pathname === "/api/academic-context/exams"'));
assert.match(prepareRoute, /activePlanKey !== "starter"/);
assert.match(prepareRoute, /backfillSelectedClassroomContentIntoState/);
assert.match(prepareRoute, /autoGenerateTodo/);
assert(prepareRoute.indexOf("backfillSelectedClassroomContentIntoState") < prepareRoute.indexOf("beginAcademicContextPreparation"));
assert.match(appSource, /\["trial", "starter", "essential", "plus", "pro"\]/);
assert.match(appSource, /Some selected Classroom work needs a manual upload/);
const todayFlow = appSource.slice(appSource.indexOf("function renderStarterToday"), appSource.indexOf("function renderDashboardSummary"));
assert.doesNotMatch(todayFlow, /Quadratics worksheet|default roadmap/i);
assert.doesNotMatch(todayFlow, /\b(provider|model|token|storage|database|backend|vector|embedding|chunks?|debug|OAuth scope)\b/i);
assert.doesNotMatch(`${appSource}\n${serverSource}`, /Plan Free/i);
assert.doesNotMatch(configSource, /classroom\.coursework\.students|classroom\.rosters|drive\.file|drive\.readonly/i);

for (const plan of ["starter", "essential", "plus", "pro"]) {
  assert.equal(canUseFeature(plan, FEATURE_KEYS.ASSIGNMENT_WRITEBACK), false);
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(plan, action), false);
}
assert.equal(getClassroomSyncPolicy("starter").courseworkReviewEnabled, false);
for (const plan of ["trial", "essential", "plus", "pro"]) {
  assert.equal(getClassroomSyncPolicy(plan).courseworkReviewEnabled, true);
}
assert.equal(getProductFlowConfig({}, "development").realPaymentEnabled, false);

console.log("PASS | StudentOS Phase 1.2 multi-tier daily TO-DO tests passed");
