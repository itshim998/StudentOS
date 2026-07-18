import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getClassroomDueWork,
  importClassroomSnapshotIntoState,
  isAcademicContextRecord,
  migrateLegacyClassroomAcademicData,
  normalizeClassroomSubmissionState,
  selectClassroomItemsForAcademicContext,
} from "./connectors/googleClassroom/mapper.js";
import { shouldRunAutomaticClassroomCheck } from "./connectors/googleClassroom/syncService.js";
import { initialStateForUser, StudentOsRepository } from "./repository/studentOsRepository.js";
import { countAcademicContextMaterials } from "./domain/productFeatureAccessService.js";
import {
  CLASSROOM_WRITE_ACTIONS,
  canUseClassroomAction,
  getClassroomSyncPolicy,
} from "./domain/planEntitlementService.js";
import { getProductFlowConfig } from "./domain/productLifecycleService.js";
import { purgeLegacyAcademicCache } from "../frontend/scripts/migrations/legacyAcademicCache.js";

const now = new Date("2026-07-01T06:00:00.000Z");
const day = (offset) => new Date(now.getTime() + offset * 24 * 60 * 60 * 1000).toISOString();
const state = initialStateForUser({ id: "student_task2", email: "task2@student.example" });
const courseWork = [
  { id: "A", title: "Assignment A", dueAt: day(3), creationTime: day(-4), updateTime: day(-2), submission: "NEW" },
  { id: "B", title: "Assignment B", dueAt: day(1), creationTime: day(-2), updateTime: day(-1), submission: "CREATED" },
  { id: "C", title: "Assignment C", dueAt: null, creationTime: day(-1), updateTime: day(-1), submission: "RECLAIMED_BY_STUDENT" },
  { id: "D", title: "Assignment D", dueAt: day(2), creationTime: day(-20), updateTime: day(-20), submission: "NEW" },
  { id: "E", title: "Assignment E", dueAt: day(5), creationTime: day(0), updateTime: day(0), submission: "NEW" },
  { id: "F", title: "Overdue assignment F", dueAt: day(-1), creationTime: day(-3), updateTime: day(-2), submission: "NEW" },
  { id: "old_2024", title: "Old handed-in assignment", dueAt: "2024-09-12T12:00:00.000Z", creationTime: "2024-09-01T12:00:00.000Z", updateTime: "2024-09-13T12:00:00.000Z", submission: "TURNED_IN" },
];

const summary = importClassroomSnapshotIntoState(state, {
  courses: [{ providerCourseId: "course_task2", title: "Applied Physics", section: "Semester 2" }],
  courseWork: courseWork.map((item) => ({
    providerCourseId: "course_task2",
    providerCourseWorkId: item.id,
    title: item.title,
    dueAt: item.dueAt,
    creationTime: item.creationTime,
    updateTime: item.updateTime,
    workType: "ASSIGNMENT",
    materials: item.id === "A" ? [{ providerMaterialId: "A_note", title: "Assignment A note", rawType: "link" }] : [],
  })),
  submissions: courseWork.map((item) => ({
    providerCourseId: "course_task2",
    providerCourseWorkId: item.id,
    providerSubmissionId: `submission_${item.id}`,
    state: item.submission,
  })),
}, { now });

assert.equal(summary.discoveredAssignments, 6);
assert.equal(summary.discoveredMaterials, 1);
assert.equal(summary.importedAssignments, 0);
assert.equal(state.assignments.length, 0, "discovery must not create academic assignments");
assert.equal(state.sourceMaterials.length, 0, "discovery must not create source materials");
assert.equal(countAcademicContextMaterials(state), 0, "unselected Classroom work must not count as academic context");

const assignmentItem = (externalId) => state.classroomItems.find((item) => item.itemType === "assignment" && item.externalId === externalId);
const selectedABC = ["A", "B", "C", "F"].map((id) => assignmentItem(id).id);
selectClassroomItemsForAcademicContext(state, selectedABC, { now });
assert.deepEqual(state.assignments.filter(isAcademicContextRecord).map((item) => item.title).sort(), ["Assignment A", "Assignment B", "Assignment C", "Overdue assignment F"]);
assert.equal(countAcademicContextMaterials(state), 4);
assert.equal(assignmentItem("D").selectionState, "discovered");

assert.deepEqual(
  getClassroomDueWork(state).map((item) => item.title),
  ["Overdue assignment F", "Assignment B", "Assignment A", "Assignment C"],
  "selected active work must use nearest deadline first and place undated work last",
);
assert.equal(getClassroomDueWork(state)[0].status, "overdue");
assert.deepEqual(
  getClassroomDueWork(state, { includeDiscoveredReview: true }).map((item) => item.title),
  ["Overdue assignment F", "Assignment B", "Assignment A", "Assignment C", "Assignment D", "Assignment E"],
  "eligible discovered work must remain review-only and use deadline rather than posted date",
);

selectClassroomItemsForAcademicContext(state, [assignmentItem("D").id], { now });
assert.deepEqual(
  getClassroomDueWork(state, { includeDiscoveredReview: true }).map((item) => item.title),
  ["Overdue assignment F", "Assignment B", "Assignment D", "Assignment A", "Assignment C", "Assignment E"],
  "newly selected D must move into selected due order by deadline",
);

assert.equal(assignmentItem("old_2024"), undefined, "completed work must not enter discovery state");
assert.equal(getClassroomDueWork(state, { includeDiscoveredReview: true }).some((item) => item.title.includes("Old handed-in")), false);
for (const completed of ["TURNED_IN", "RETURNED", "DONE", "GRADED", "SUBMITTED"]) {
  assert.equal(normalizeClassroomSubmissionState(completed).handedIn, true, `${completed} must be complete`);
}
for (const active of ["CREATED", "NEW", "RECLAIMED_BY_STUDENT"]) {
  assert.equal(normalizeClassroomSubmissionState(active).active, true, `${active} must remain active`);
}
for (const rejected of ["ASSIGNED", "OPEN", "NOT_SUBMITTED", "SUBMISSION_STATE_UNSPECIFIED", ""]) {
  assert.equal(normalizeClassroomSubmissionState(rejected, { hasSubmission: Boolean(rejected), dueAt: day(2) }).active, false, `${rejected || "missing"} must fail closed`);
}
assert.equal(normalizeClassroomSubmissionState("", { hasSubmission: false, dueAt: day(2) }).state, "UNKNOWN");

const materialItem = state.classroomItems.find((item) => item.itemType === "material" && item.providerMaterialId === "A_note");
selectClassroomItemsForAcademicContext(state, [materialItem.id], { now });
assert.equal(state.sourceMaterials.filter(isAcademicContextRecord).length, 1);
assert.equal(state.sourceMaterials.find(isAcademicContextRecord).classroomItemId, materialItem.id);

const legacy = initialStateForUser({ id: "student_task2_legacy" });
legacy.courses.push({ id: "legacy_course", title: "Legacy Classroom", source: "google_classroom", providerCourseId: "legacy_course" });
legacy.assignments.push({
  id: "legacy_unselected",
  courseId: "legacy_course",
  title: "Ambiguous old work",
  source: "google_classroom",
  providerCourseId: "legacy_course",
  providerCourseWorkId: "legacy_work",
  dueAt: "2024-11-01T12:00:00.000Z",
  submissionStatus: "RETURNED",
});
const cleanup = migrateLegacyClassroomAcademicData(legacy, { now });
assert.equal(cleanup.hiddenAmbiguousRows, 1);
assert.equal(isAcademicContextRecord(legacy.assignments[0]), false);
assert.equal(legacy.classroomItems[0].selectionState, "discovered");
assert.equal(getClassroomDueWork(legacy, { includeDiscoveredReview: true }).length, 0);

assert.equal(shouldRunAutomaticClassroomCheck({ state, policy: getClassroomSyncPolicy("starter"), now }).due, false);
assert.equal(shouldRunAutomaticClassroomCheck({ state: initialStateForUser({ id: "essential" }), policy: getClassroomSyncPolicy("essential"), now }).due, true);
const trialState = initialStateForUser({ id: "trial" });
trialState.studentProfile.preferences.googleClassroom = { lastSyncAt: day(-1) };
assert.equal(shouldRunAutomaticClassroomCheck({ state: trialState, policy: getClassroomSyncPolicy("trial"), now }).reason, "trial_check_used");

const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const session = { authenticated: true, mode: "test", user: { id: "student_task2_reload", email: "reload@student.example" } };
const persisted = await repository.loadState(session);
importClassroomSnapshotIntoState(persisted, {
  courses: [{ providerCourseId: "reload_course", title: "Reload course" }],
  courseWork: [
    { providerCourseId: "reload_course", providerCourseWorkId: "selected", title: "Selected after reload", dueAt: day(1) },
    { providerCourseId: "reload_course", providerCourseWorkId: "unselected", title: "Still unselected", dueAt: day(2) },
  ],
  submissions: [
    { providerCourseId: "reload_course", providerCourseWorkId: "selected", state: "NEW" },
    { providerCourseId: "reload_course", providerCourseWorkId: "unselected", state: "CREATED" },
  ],
}, { now });
selectClassroomItemsForAcademicContext(persisted, [persisted.classroomItems.find((item) => item.externalId === "selected").id], { now });
await repository.saveState(session, persisted);
const reloaded = await repository.loadState(session);
assert.equal(reloaded.assignments.filter(isAcademicContextRecord).length, 1);
assert.equal(reloaded.classroomItems.find((item) => item.externalId === "unselected").academicContextIncluded, false);
const reloadedAgain = await repository.loadState(session);
assert.deepEqual(reloadedAgain.classroomItems, reloaded.classroomItems, "reload must not mutate Classroom discovery timestamps or selection truth");

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] || null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
const cache = new MemoryStorage({
  "studentos.classroom-assignments": JSON.stringify([{ source: "google_classroom", title: "Old unselected cache" }]),
  "studentos.classroom-items": JSON.stringify([{ source: "google_classroom", selectionState: "imported", academicContextIncluded: true }]),
  "studentos.auth.session": JSON.stringify({ access_token: "kept" }),
});
purgeLegacyAcademicCache([cache]);
assert.equal(cache.getItem("studentos.classroom-assignments"), null);
assert.notEqual(cache.getItem("studentos.classroom-items"), null);
assert.notEqual(cache.getItem("studentos.auth.session"), null);

for (const plan of ["trial", "starter", "essential", "plus", "pro"]) {
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(plan, action), false);
}
assert.equal(getProductFlowConfig({}, "development").realPaymentEnabled, false);

const app = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
const connectorSource = [
  await readFile(new URL("./connectors/googleClassroom/apiClient.js", import.meta.url), "utf8"),
  await readFile(new URL("./connectors/googleClassroom/syncService.js", import.meta.url), "utf8"),
].join("\n");
assert.match(app, /Choose Classroom work to add to your academic context\./);
assert.match(app, /Selected for academic context/);
assert.match(app, /New unfinished Classroom work was found/);
assert.match(app, /Review and add/);
assert.doesNotMatch(`${app}\n${html}`, /Plan Free/i);
assert.doesNotMatch(connectorSource, /turnIn|modifyAttachments|reclaimSubmission|studentSubmissions\/[^"'`]*:(?:turnIn|reclaim)/i);

function visibleStringsBetween(source, start, end) {
  const section = source.slice(source.indexOf(start), source.indexOf(end));
  return [...section.matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
    .map((match) => match[2].replace(/\$\{[^}]+\}/g, ""))
    .join(" ");
}
const classroomVisibleCopy = [
  visibleStringsBetween(app, "function classroomStepMarkup", "function materialCandidates"),
  visibleStringsBetween(app, "function materialsStepMarkup", "function summaryValue"),
  visibleStringsBetween(app, "function renderDashboardSummary", "function renderRoadmap"),
  visibleStringsBetween(app, "function renderClassroomPanel", "function renderCourses"),
].join(" ");
assert.doesNotMatch(classroomVisibleCopy, /\b(?:provider|model|token|database|backend|vector|embedding|chunk|debug|OAuth scope|submissionState)\b/i);

console.log("PASS | StudentOS Task 2 Classroom selection and deadline tests passed");
