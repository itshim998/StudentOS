import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, css, html] = await Promise.all([
  readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8"),
  readFile(new URL("../frontend/styles/main.css", import.meta.url), "utf8"),
  readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
]);

const queueMarkup = app.slice(app.indexOf("function studyQueueItemMarkup"), app.indexOf("function renderStudyAndEvaluate"));
const generatedPresentation = app.slice(app.indexOf("function isInternalGeneratedId"), app.indexOf("function plainMarkdownInline"));
const queueCss = css.slice(css.indexOf("/* Phase 2.1: focused study workspace */"), css.indexOf(".study-test-warning"));
const studyHtml = html.slice(html.indexOf('id="view-study"'), html.indexOf('id="view-studio"'));

assert.match(queueMarkup, /class="study-queue-card-header"/);
assert.match(queueMarkup, /class="study-priority-badge tag/);
assert.match(queueMarkup, /aria-label="\$\{escapeHtml\(`\$\{priorityLabel\} priority`\)\}"/);
assert.match(queueMarkup, /class="study-queue-meta"/);
assert.match(queueMarkup, /class="study-queue-duration"/);
assert.match(queueMarkup, /class="study-queue-window"/);
assert.match(queueMarkup, /class="study-queue-status"/);
assert.match(queueMarkup, /class="study-selected-marker"/);
assert.doesNotMatch(queueMarkup, /tag\(humanize\(item\.priority/);

assert.match(queueCss, /grid-template-columns:\s*minmax\(360px, 410px\) minmax\(0, 1fr\)/);
assert.match(queueCss, /\.study-queue-item\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column/);
assert.match(queueCss, /\.study-queue-meta\s*\{[\s\S]*?flex-wrap:\s*wrap/);
assert.match(queueCss, /\.study-priority-badge\s*\{[\s\S]*?width:\s*max-content;[\s\S]*?align-self:\s*flex-start/);
assert.match(css, /@media \(max-width: 1240px\)[\s\S]*?\.study-evaluate-content\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
assert.doesNotMatch(queueCss, /word-break:\s*break-all/);
assert.doesNotMatch(queueCss, /writing-mode\s*:/);

assert.match(generatedPresentation, /function removeInternalGeneratedIds/);
assert.match(generatedPresentation, /source_generated\|source_uploaded\|topic_evaluation\|test_result/);
assert.match(generatedPresentation, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
assert.match(generatedPresentation, /function friendlyContextLabel/);
assert.match(generatedPresentation, /function generatedStudyTextMarkup/);
assert.match(generatedPresentation, /blocks\.shift\(\)/);
assert.match(generatedPresentation, /isGenericGeneratedMaterialTitle/);
assert.match(app, /ACADEMIC_TEXT_ALLOWED_TAGS[\s\S]*?"HR"/);
assert.match(app, /block\.type === "rule"/);
assert.match(queueCss, /\.study-generated-table-wrap\s*\{[\s\S]*?overflow-x:\s*auto/);
assert.match(queueCss, /\.study-math-block\s*\{[\s\S]*?overflow-x:\s*auto/);

assert.doesNotMatch(studyHtml, /Generate roadmap/);
assert.doesNotMatch(html, /name="weakTopicsText"/);
assert.doesNotMatch(app, /assignment_writeback\.enabled\s*=\s*true/);

console.log("PASS | PASS 36.1 Study and Evaluate readability checks passed");
