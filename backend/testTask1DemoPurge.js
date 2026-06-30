import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StudentOsRepository, initialStateForUser, removeDemoSeedRowsForRealUser } from "./repository/studentOsRepository.js";
import { applyStudentOnboarding, bindProductOnboardingStep, normalizeOnboardingPayload } from "./domain/onboardingService.js";
import { getTodayNextActions } from "./domain/studentosDomain.js";
import { getProductFlowConfig } from "./domain/productLifecycleService.js";
import { CLASSROOM_WRITE_ACTIONS, canUseClassroomAction } from "./domain/planEntitlementService.js";
import { purgeLegacyAcademicCache } from "../frontend/scripts/migrations/legacyAcademicCache.js";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fresh = initialStateForUser({ id: "student_task1_fresh", email: "fresh@student.example" });
assert.equal(fresh.studentProfile.displayName, "");
for (const key of ["courses", "topics", "exams", "assignments", "timetable", "roadmap", "sourceMaterials"]) {
  assert.deepEqual(fresh[key], [], `fresh ${key} must be empty`);
}
assert.equal(getTodayNextActions(fresh).length, 0);
assert.equal(JSON.stringify(fresh).includes("Aarav"), false);
assert.equal(JSON.stringify(fresh).includes("Quadratics worksheet"), false);

const normalizedEmpty = normalizeOnboardingPayload({ displayName: "Real Student" });
assert.equal(normalizedEmpty.courses.length, 0);
assert.equal(normalizedEmpty.timetable.length, 0);
assert.equal(normalizedEmpty.academicGoal, "");
assert.equal(normalizedEmpty.dailyStudyAvailabilityMinutes, null);

const emptyProfile = initialStateForUser({ id: "student_task1_empty" });
applyStudentOnboarding(emptyProfile, { displayName: "Real Student" });
assert.equal(emptyProfile.studentProfile.displayName, "Real Student");
assert.equal(emptyProfile.courses.length, 0);
assert.equal(emptyProfile.exams.length, 0);
assert.equal(emptyProfile.timetable.length, 0);
assert.equal(emptyProfile.roadmap.length, 0);

const onboardingState = initialStateForUser({ id: "student_task1_onboarding" });
onboardingState.studentProfile.productLifecycle.onboarding.answers = {
  about_you: { displayName: "Nila" },
  education_system: { institution: "North Campus", level: "Year 2", stream: "Astrophysics", yearSemester: "Semester 4" },
  daily_schedule: { schedule: "Weekdays after 7 PM" },
  exam_pattern: { examPattern: "Two written assessments each term" },
  academic_context: { subjects: "Orbital Mechanics", syllabusNotes: "Orbits and reference frames" },
};
bindProductOnboardingStep(onboardingState, "academic_context", { now: new Date("2026-06-30T10:00:00.000Z") });
assert.equal(onboardingState.studentProfile.displayName, "Nila");
assert.equal(onboardingState.studentProfile.gradeBand, "Year 2");
assert.equal(onboardingState.studentProfile.preferences.stream, "Astrophysics");
assert.equal(onboardingState.studentProfile.preferences.scheduleText, "Weekdays after 7 PM");
assert.equal(onboardingState.courses[0]?.title, "Orbital Mechanics");
assert.equal(onboardingState.exams.length, 0);
assert.equal(onboardingState.timetable.length, 0);
assert.equal(onboardingState.roadmap.length, 0);

const contaminated = createSeedState(new Date("2026-06-30T10:00:00.000Z"));
removeDemoSeedRowsForRealUser(contaminated);
assert.equal(contaminated.studentProfile.displayName, "");
assert.equal(contaminated.courses.length, 0);
assert.equal(contaminated.assignments.length, 0);
assert.equal(contaminated.roadmap.length, 0);

const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const firstSession = { authenticated: true, mode: "test", user: { id: "student_task1_first", email: "first@student.example" } };
const secondSession = { authenticated: true, mode: "test", user: { id: "student_task1_second", email: "second@student.example" } };
const firstLoad = await repository.loadState(firstSession);
applyStudentOnboarding(firstLoad, { displayName: "Ira", subjectsText: "Thermodynamics" });
await repository.saveState(firstSession, firstLoad);
assert.equal((await repository.loadState(firstSession)).studentProfile.displayName, "Ira");
assert.equal((await repository.loadState(firstSession)).courses[0]?.title, "Thermodynamics");
const secondLoad = await repository.loadState(secondSession);
assert.equal(secondLoad.studentProfile.displayName, "");
assert.equal(secondLoad.courses.length, 0);

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] || null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const localCache = new MemoryStorage({
  "studentos.profile": JSON.stringify({ displayName: "Aarav", stream: "Science", classLevel: "Grade 10" }),
  "studentos.real-note": JSON.stringify({ displayName: "Nila", subject: "Astrophysics" }),
});
const sessionCache = new MemoryStorage({
  "studentos.sample.workspace": JSON.stringify({ title: "Quadratics worksheet" }),
  "studentos.auth.session": JSON.stringify({ access_token: "kept-in-test" }),
});
purgeLegacyAcademicCache([localCache, sessionCache]);
assert.equal(localCache.getItem("studentos.profile"), null);
assert.notEqual(localCache.getItem("studentos.real-note"), null);
assert.equal(sessionCache.getItem("studentos.sample.workspace"), null);
assert.notEqual(sessionCache.getItem("studentos.auth.session"), null);

async function runtimeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["migrations", "testFixtures"].includes(entry.name)) continue;
      files.push(...await runtimeFiles(target));
    } else if (entry.name.endsWith(".js") && !entry.name.startsWith("test")) {
      files.push(target);
    }
  }
  return files;
}

const scannedFiles = [
  ...await runtimeFiles(path.join(ROOT, "backend")),
  ...await runtimeFiles(path.join(ROOT, "frontend", "scripts")),
  path.join(ROOT, "frontend", "index.html"),
];
const bannedRuntimeData = /Aarav|CBSE-style demo|Practice test for Quadratics worksheet|Quadratics worksheet|Load sample profile|Demo source material|\/api\/demo\/seed|\/api\/files\/mock|demo-seed-btn/i;
for (const file of scannedFiles) {
  const source = await readFile(file, "utf8");
  assert.doesNotMatch(source, bannedRuntimeData, `${path.relative(ROOT, file)} contains runtime fixture data`);
}
const frontendSource = await readFile(path.join(ROOT, "frontend", "scripts", "app.js"), "utf8");
const frontendHtml = await readFile(path.join(ROOT, "frontend", "index.html"), "utf8");
assert.doesNotMatch(`${frontendSource}\n${frontendHtml}`, /Plan Free|Load sample profile/i);
assert.match(frontendSource, /No study task yet\./);
assert.match(frontendSource, /Add your subjects in Setup so StudentOS can plan today\./);
assert.match(frontendSource, /Add your timetable so Today can protect your study time\./);
assert.match(frontendSource, /Add upcoming exams or assignments to build your first plan\./);

for (const plan of ["trial", "starter", "essential", "plus", "pro"]) {
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(plan, action), false);
}
assert.equal(getProductFlowConfig({}, "development").realPaymentEnabled, false);

console.log("PASS | StudentOS Task 1 runtime demo-data purge tests passed");
