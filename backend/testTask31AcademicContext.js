import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyAcademicContextDeletion,
  buildAcademicContextDeletionPlan,
  linkManualAcademicContextUpload,
  validateManualAcademicContextContract,
} from "./domain/academicContextService.js";
import { getClassroomSyncPolicy, CLASSROOM_WRITE_ACTIONS, canUseClassroomAction } from "./domain/planEntitlementService.js";
import {
  importClassroomSnapshotIntoState,
  selectClassroomItemsForAcademicContext,
  syncClassroomCoursesIntoState,
} from "./connectors/googleClassroom/mapper.js";
import { initialStateForUser } from "./repository/studentOsRepository.js";
import { buildSourceCleanupPlan } from "./storage/sourceCleanupService.js";
import { validateAcademicContextPdfUpload } from "./storage/sourceMaterialService.js";
import { getProductFlowConfig } from "./domain/productLifecycleService.js";

const now = new Date("2026-07-01T08:00:00.000Z");
const pdfBytes = Buffer.from("%PDF-1.4\n%%EOF", "ascii");
const pdfFile = { filename: "calculus.pdf", mimeType: "application/pdf", bytes: pdfBytes };
const pdfValidation = validateAcademicContextPdfUpload({
  filename: pdfFile.filename,
  mimeType: pdfFile.mimeType,
  sizeBytes: pdfFile.bytes.length,
  bytes: pdfFile.bytes,
});
assert.equal(pdfValidation.ok, true);
assert.equal(validateAcademicContextPdfUpload({
  filename: "notes.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  sizeBytes: 20,
  bytes: Buffer.from("not a pdf"),
}).ok, false);

const noCourses = initialStateForUser({ id: "task31_no_courses" });
assert.throws(
  () => validateManualAcademicContextContract({ state: noCourses, fields: { artifactKind: "material" }, file: pdfFile, pdfValidation }),
  /Add a course in Setup before uploading academic context\./,
);

const state = initialStateForUser({ id: "task31_student" });
state.courses.push({ id: "course_calculus", title: "Calculus II" });
assert.throws(
  () => validateManualAcademicContextContract({
    state,
    fields: { artifactKind: "assignment", courseId: "course_calculus", deadline: "2026-07-08" },
    file: { filename: "bad.txt" },
    pdfValidation: { ok: false },
  }),
  /Please upload a PDF for Academic Context\./,
);
assert.throws(
  () => validateManualAcademicContextContract({ state, fields: { artifactKind: "assignment" }, file: pdfFile, pdfValidation }),
  /Choose a course for this assignment\./,
);
assert.throws(
  () => validateManualAcademicContextContract({ state, fields: { artifactKind: "material" }, file: pdfFile, pdfValidation }),
  /Choose a course for this material\./,
);
assert.throws(
  () => validateManualAcademicContextContract({
    state,
    fields: { artifactKind: "assignment", courseId: "course_calculus" },
    file: pdfFile,
    pdfValidation,
  }),
  /Set the assignment deadline before uploading\./,
);

const assignmentContract = validateManualAcademicContextContract({
  state,
  fields: { artifactKind: "assignment", title: "Integration worksheet", courseId: "course_calculus", deadline: "2026-07-08" },
  file: pdfFile,
  pdfValidation,
});
const assignmentMaterial = {
  id: "src_assignment_pdf",
  userId: state.studentProfile.id,
  courseId: "course_calculus",
  title: assignmentContract.title,
  status: "indexed",
};
const linkedAssignment = linkManualAcademicContextUpload(state, assignmentMaterial, assignmentContract, { now });
state.sourceMaterials.push(assignmentMaterial);
assert.equal(linkedAssignment.assignment.title, "Integration worksheet");
assert.equal(linkedAssignment.assignment.courseId, "course_calculus");
assert.equal(linkedAssignment.assignment.dueDate, "2026-07-08");
assert.equal(linkedAssignment.assignment.handedIn, false);
assert.equal(linkedAssignment.assignment.source, "manual_upload");
assert.equal(assignmentMaterial.academicContextIncluded, true);
assert.equal(buildSourceCleanupPlan(state, assignmentMaterial.id).assignmentIds[0], linkedAssignment.assignment.id);

const materialContract = validateManualAcademicContextContract({
  state,
  fields: { artifactKind: "material", title: "Worked examples", courseId: "course_calculus" },
  file: pdfFile,
  pdfValidation,
});
const material = { id: "src_material_pdf", userId: state.studentProfile.id, courseId: "course_calculus", title: materialContract.title, status: "indexed" };
const linkedMaterial = linkManualAcademicContextUpload(state, material, materialContract, { now });
state.sourceMaterials.push(material);
assert.equal(linkedMaterial.assignment, null);
assert.equal(material.dueAt, null);
assert.equal(material.artifactKind, "material");
assert.equal(material.selectionState, "imported");

const deletionPlan = buildAcademicContextDeletionPlan(state, { kind: "assignment", itemId: linkedAssignment.assignment.id });
applyAcademicContextDeletion(state, deletionPlan, { now });
assert.equal(state.assignments.some((item) => item.id === linkedAssignment.assignment.id), false);
assert.equal(state.sourceMaterials.some((item) => item.id === assignmentMaterial.id), false);
assert.equal(state.sourceMaterials.some((item) => item.id === material.id), true);

const starterState = initialStateForUser({ id: "task31_starter" });
const starterSummary = syncClassroomCoursesIntoState(starterState, {
  courses: [{ providerCourseId: "classroom_calculus", title: "Classroom Calculus" }],
  courseWork: [{ providerCourseId: "classroom_calculus", providerCourseWorkId: "should_not_import", title: "Hidden assignment" }],
}, { now });
assert.equal(starterSummary.courseOnly, true);
assert.equal(starterState.courses.length, 1);
assert.equal(starterState.classroomItems.length, 0);
assert.equal(starterState.assignments.length, 0);
assert.equal(starterState.sourceMaterials.length, 0);
assert.equal(getClassroomSyncPolicy("starter").courseOnly, true);
assert.equal(getClassroomSyncPolicy("starter").courseworkReviewEnabled, false);
assert.equal(getClassroomSyncPolicy("starter").autoCheckEnabled, false);

const essentialState = initialStateForUser({ id: "task31_essential" });
importClassroomSnapshotIntoState(essentialState, {
  courses: [{ providerCourseId: "essential_course", title: "Essential course" }],
  courseWork: [{ providerCourseId: "essential_course", providerCourseWorkId: "work_1", title: "Review assignment", dueAt: "2026-07-05T12:00:00.000Z" }],
  courseWorkMaterials: [{ providerCourseId: "essential_course", providerCourseWorkMaterialId: "material_1", title: "Review material" }],
  submissions: [],
}, { now });
assert.equal(essentialState.assignments.length, 0);
assert.equal(essentialState.sourceMaterials.length, 0);
assert.equal(essentialState.classroomItems.every((item) => item.selectionState === "discovered"), true);
selectClassroomItemsForAcademicContext(essentialState, essentialState.classroomItems.map((item) => item.id), { now });
assert.equal(essentialState.assignments.length, 1);
assert.equal(essentialState.sourceMaterials.length, 1);
for (const plan of ["trial", "starter", "essential", "plus", "pro"]) {
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(plan, action), false);
}
assert.equal(getProductFlowConfig({}, "development").realPaymentEnabled, false);

const app = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
const academicHtml = html.slice(html.indexOf('id="view-memory"'), html.indexOf('id="view-studio"'));
const academicText = academicHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const renderSource = app.slice(app.indexOf("function renderSources"), app.indexOf("function renderSelects"));

assert.match(academicText, /Academic Context/);
assert.doesNotMatch(academicText, /\bMemory\b/);
assert.match(app, /memory: "Academic Context"/);
assert.match(renderSource, />Assignments</);
assert.match(renderSource, />Study materials</);
assert.match(renderSource, /New Classroom work found/);
assert.match(renderSource, /data-classroom-ignore-id/);
assert.match(html, /accept="\.pdf,application\/pdf"/);
assert.match(`${html}\n${app}`, /Set the assignment deadline before uploading\./);
assert.match(html, /Delete permanently/);
assert.match(html, /Keep it/);
assert.match(html, /This will permanently delete this file from StudentOS\./);
assert.match(app, /Starter uses Classroom only to help set up your course list\. Upload PDFs manually to add assignments or materials\./);
assert.match(app, /Classroom courses can help set up your course list\. Upload PDFs manually on Starter\./);
assert.doesNotMatch(`${app}\n${html}`, /Plan Free/i);
assert.doesNotMatch(`${academicText}\n${renderSource}`, /\b(?:provider|model|token|storage|database|backend|vector|embedding|chunk|debug|OAuth scope)\b/i);

console.log("PASS | StudentOS Task 3.1 Academic Context tests passed");
