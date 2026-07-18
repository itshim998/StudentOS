import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initialStateForUser } from "./repository/studentOsRepository.js";
import {
  ACADEMIC_CONTEXT_KINDS,
  isReadableStudyMaterial,
  normalizeAcademicContextKind,
} from "./domain/academicContextKinds.js";
import {
  linkManualAcademicContextUpload,
  validateManualAcademicContextContract,
} from "./domain/academicContextService.js";
import { ensureDailyTodoStudyState, generateStudyMaterial, relatedMaterialsForTodo } from "./ai/studyMaterialService.js";
import { CLASSROOM_WRITE_ACTIONS, canUseClassroomAction } from "./domain/planEntitlementService.js";
import { getProductFlowConfig } from "./domain/productLifecycleService.js";

assert.deepEqual(ACADEMIC_CONTEXT_KINDS, [
  "syllabus",
  "study_material",
  "assignment",
  "exam_schedule",
  "generated_study_material",
  "unknown",
]);

for (const [item, expected] of [
  [{ contextKind: "syllabus", artifactKind: "material" }, "syllabus"],
  [{ artifactKind: "material" }, "study_material"],
  [{ materialKind: "assignment" }, "assignment"],
  [{ payload: { kind: "exam_schedule" } }, "exam_schedule"],
  [{ artifactKind: "material", sourceType: "generated_study_material" }, "generated_study_material"],
  [{ title: "Legacy semester syllabus.pdf" }, "syllabus"],
  [{ title: "Unclassified document.pdf" }, "unknown"],
]) assert.equal(normalizeAcademicContextKind(item), expected);

assert.equal(isReadableStudyMaterial({ contextKind: "study_material" }), true);
assert.equal(isReadableStudyMaterial({ contextKind: "generated_study_material" }), true);
for (const kind of ["syllabus", "assignment", "exam_schedule", "unknown"]) {
  assert.equal(isReadableStudyMaterial({ contextKind: kind }), false);
}

const state = initialStateForUser({ id: "phase21b_student" });
state.courses = [{ id: "course_ai", title: "AI", source: "manual", academicContextIncluded: true }];
const pdfFile = { filename: "academic-context.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4") };
const pdfValidation = { ok: true };
for (const [artifactKind, expectedKind] of [
  ["syllabus", "syllabus"],
  ["material", "study_material"],
  ["assignment", "assignment"],
  ["exam_schedule", "exam_schedule"],
]) {
  const fields = {
    artifactKind,
    title: `${artifactKind} PDF`,
    courseId: artifactKind === "exam_schedule" ? "" : "course_ai",
    deadline: artifactKind === "assignment" ? "2026-07-10" : "",
  };
  const contract = validateManualAcademicContextContract({ state, fields, file: pdfFile, pdfValidation });
  const material = { id: `source_${artifactKind}`, userId: state.studentProfile.id, courseId: contract.courseId };
  linkManualAcademicContextUpload(state, material, contract, { now: new Date("2026-07-05T10:00:00.000Z") });
  assert.equal(material.contextKind, expectedKind, `${artifactKind} must persist its normalized kind`);
  assert.equal(normalizeAcademicContextKind(material), expectedKind);
}

state.studentProfile.dailyTodoPlan = ensureDailyTodoStudyState({
  date: "2026-07-05",
  items: [{
    title: "Review neural networks",
    related_course: "AI",
    related_context: "Neural networks",
    reason: "The exam is approaching.",
    time_hint: "40 minutes",
  }],
});
const todoItem = state.studentProfile.dailyTodoPlan.items[0];
state.sourceMaterials = [
  { id: "source_syllabus", courseId: "course_ai", title: "Neural networks syllabus", contextKind: "syllabus", academicContextIncluded: true },
  { id: "source_assignment", courseId: "course_ai", title: "Neural networks assignment", contextKind: "assignment", academicContextIncluded: true },
  { id: "source_exam", courseId: "course_ai", title: "AI exam schedule", contextKind: "exam_schedule", academicContextIncluded: true },
];
assert.deepEqual(relatedMaterialsForTodo(state, todoItem), [], "planning documents must not become lesson material");

state.sourceMaterials.push({
  id: "source_notes",
  courseId: "course_ai",
  title: "Neural networks notes",
  contextKind: "study_material",
  academicContextIncluded: true,
});
assert.equal(relatedMaterialsForTodo(state, todoItem)[0].id, "source_notes");

const generated = await generateStudyMaterial({
  state,
  item: todoItem,
  now: new Date("2026-07-05T10:00:00.000Z"),
  providerConfig: { requestedMode: "mock" },
});
assert.equal(generated.material.contextKind, "generated_study_material");
assert.equal(generated.material.materialKind, "generated_study_material");
assert.equal(normalizeAcademicContextKind(generated.material), "generated_study_material");

const [app, html, server, strictTest, packageJson] = await Promise.all([
  readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8"),
  readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
  readFile(new URL("./server.js", import.meta.url), "utf8"),
  readFile(new URL("./testPhase22StrictTestAttempt.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

for (const copy of [
  "Syllabus",
  "Study materials",
  "Assignments",
  "Exam schedules",
  "Generated by StudentOS",
  "No study note is available yet.",
  "StudentOS has your syllabus and exam date, but not a study handout or notes for this topic.",
  "Generate note",
]) assert.match(`${html}\n${app}`, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

assert.match(html, /id="academic-pdf-viewer"/);
assert.match(html, /type="application\/pdf"/);
assert.match(app, /\/api\/academic-context\/materials\/\$\{encodeURIComponent\(materialId\)\}\/open/);
assert.match(server, /academic-context\|study/);
assert.doesNotMatch(app, /window\.open\("",\s*"_blank"/);
assert.doesNotMatch(app, /about:blank/i);
assert.doesNotMatch(strictTest, /data-study-test-(?:download|print|export)/i);
assert.match(packageJson, /test:phase2-1b/);
assert.doesNotMatch(`${html}\n${app}`, /Plan Free/i);
for (const plan of ["trial", "starter", "essential", "plus", "pro"]) {
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(plan, action), false);
}
assert.equal(getProductFlowConfig({}, "development").realPaymentEnabled, false);

console.log("PASS | StudentOS Phase 2.1B context semantics and PDF viewer tests passed");
