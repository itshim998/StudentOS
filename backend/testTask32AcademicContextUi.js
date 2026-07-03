import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CLASSROOM_WRITE_ACTIONS, canUseClassroomAction, getClassroomSyncPolicy } from "./domain/planEntitlementService.js";
import { getProductFlowConfig } from "./domain/productLifecycleService.js";

const [app, html, css] = await Promise.all([
  readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8"),
  readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
  readFile(new URL("../frontend/styles/main.css", import.meta.url), "utf8"),
]);

const navHtml = html.slice(html.indexOf('aria-label="Views"'), html.indexOf('class="rail-session-card"'));
const academicHtml = html.slice(html.indexOf('id="view-memory"'), html.indexOf('id="view-studio"'));
const academicText = academicHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const renderSources = app.slice(app.indexOf("function renderSources"), app.indexOf("function renderSelects"));
const assignmentMarkup = renderSources.slice(renderSources.indexOf("const assignmentCards"), renderSources.indexOf("const materialCardMarkup"));
const materialMarkup = renderSources.slice(renderSources.indexOf("const materialCardMarkup"), renderSources.indexOf("const classroomReview ="));
const materialStatus = app.slice(app.indexOf("function academicContextMaterialStatus"), app.indexOf("function isIncludedAcademicContextItem"));

assert.match(navHtml, />\s*Academic Context\s*</);
assert.doesNotMatch(navHtml, />\s*Memory\s*</);
assert.match(academicText, /Academic Context/);
assert.match(academicText, /Courses, syllabus, exam dates, assignments, and materials StudentOS can use for your semester\./);
assert.match(academicHtml, /id="academic-context-add-button"[^>]*>Add PDF</);
assert(academicHtml.indexOf('class="memory-library-panel academic-context-content-panel"') < academicHtml.indexOf('class="academic-context-support-column"'));

for (const summary of ["Courses", "Exam dates", "Assignments", "PDFs"]) {
  assert.match(renderSources, new RegExp(summary));
}
assert.match(renderSources, /id="academic-context-assignments-title">Assignments</);
assert.match(renderSources, /id="academic-context-materials-title">Study materials</);
assert.match(renderSources, /isIncludedAcademicContextItem\(assignment\)/);
assert.match(renderSources, /isIncludedAcademicContextItem\(source\)/);
assert.match(renderSources, /No assignments added yet\./);
assert.match(renderSources, /Upload an assignment PDF with a deadline so StudentOS can plan it\./);
assert.match(renderSources, /No study materials added yet\./);
assert.match(renderSources, /Upload a PDF handout or reading to help StudentOS understand your course\./);
assert.match(renderSources, /No syllabus added yet\./);
assert.match(renderSources, /No exam schedule PDF added\./);

assert.match(academicHtml, /id="source-form"[^>]*novalidate/);
assert.match(academicHtml, /name="artifactKind"/);
assert.match(academicHtml, /name="title"/);
assert.match(academicHtml, /name="courseId"[^>]*required/);
assert.match(academicHtml, /name="deadline"/);
assert.match(academicHtml, /Set the deadline of the assignment\./);
assert.match(academicHtml, /name="file"[^>]*accept="\.pdf,application\/pdf"/);
assert.match(app, /els\.sourceDeadlineField\.hidden = !assignment/);
assert.match(app, /els\.sourceDeadline\.required = assignment/);
assert.match(app, /Add a course in Setup before uploading academic context\./);
assert.match(app, /Added to Academic Context\./);

for (const label of ["Due", "Origin", "Ask StudentOS", "Delete"]) assert.match(assignmentMarkup, new RegExp(label));
assert.match(assignmentMarkup, /academicContextPreview/);
assert.match(assignmentMarkup, /Manual upload/);
assert.match(app, /function academicContextOrigin[\s\S]*\? "Classroom" : "Manual upload"/);
assert.match(materialMarkup, /Origin/);
assert.match(materialMarkup, /Selected material/);
assert.match(materialStatus, /Ready for study/);
assert.match(materialStatus, /Preparing/);
assert.match(materialStatus, /Needs attention/);
assert.match(materialMarkup, /academicContextPreview/);
assert.doesNotMatch(materialMarkup, /<small>Due<\/small>/);

assert.match(renderSources, /reviewEnabled[\s\S]*classroomReviewItems/);
assert.match(renderSources, /New Classroom work found\. Choose what to add to your academic context\./);
assert.match(renderSources, />Add to Academic Context</);
assert.match(renderSources, />Ignore</);
assert.match(renderSources, /No new Classroom work to review\./);
assert.match(renderSources, /Starter uses Classroom only to help set up your course list\. Upload PDFs manually to add assignments or materials\./);
assert.equal(getClassroomSyncPolicy("starter").courseworkReviewEnabled, false);
for (const plan of ["essential", "plus", "pro"]) assert.equal(getClassroomSyncPolicy(plan).courseworkReviewEnabled, true);

assert.match(html, /This will permanently delete this file from StudentOS\. StudentOS will stop using it for planning, answers, and revision\. This will not delete anything from Google Classroom\./);
assert.match(html, />Keep it</);
assert.match(html, />Delete permanently</);
assert.match(app, /Removed from Academic Context\./);
assert.match(app, /academicContextDeleteCancel\?\.focus/);

assert.match(css, /\.academic-context-layout\s*\{[\s\S]*grid-template-columns:/);
assert.match(css, /@media \(max-width: 980px\)[\s\S]*\.academic-context-layout\s*\{[\s\S]*grid-template-columns: 1fr/);
assert.match(css, /@media \(max-width: 680px\)[\s\S]*#view-memory\s*\{[\s\S]*padding-bottom:/);
assert.match(css, /\.academic-context-card-copy h4[\s\S]*overflow-wrap: break-word/);

const visibleAcademicCopy = `${academicText}\n${renderSources}`;
assert.doesNotMatch(visibleAcademicCopy, /\b(?:provider|model|token|storage|database|backend|vector|embedding|chunks?|debug|OAuth scope|source-grounded)\b/i);
assert.doesNotMatch(`${html}\n${app}`, /Plan Free/i);
for (const plan of ["trial", "starter", "essential", "plus", "pro"]) {
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(plan, action), false);
}
assert.equal(getProductFlowConfig({}, "development").realPaymentEnabled, false);

console.log("PASS | StudentOS Task 3.2 Academic Context UI tests passed");
