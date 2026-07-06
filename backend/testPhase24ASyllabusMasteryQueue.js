import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initialStateForUser } from "./repository/studentOsRepository.js";
import {
  activeMasteryTopic,
  completeCurrentMasteryTarget,
  ensureDailyTodoStudyState,
  ensureTopicMasteryQueue,
  generateStudyMaterial,
  isActiveTopicTestUnlocked,
  relatedMaterialsForTodo,
} from "./ai/studyMaterialService.js";
import { generateStudyTest } from "./ai/studyTestService.js";
import { applyStudyTestEvaluation } from "./ai/studyTestEvaluationService.js";

const now = new Date("2026-07-05T10:00:00.000Z");
const state = initialStateForUser({ id: "phase24a_student" });
state.courses.push({
  id: "course_math",
  title: "Mathematics",
  source: "manual",
  academicContextIncluded: true,
});
state.exams.push({
  id: "exam_math_cia",
  courseId: "course_math",
  title: "Mathematics CIA 1",
  examDate: "2026-07-09",
  academicContextIncluded: true,
});
state.syllabi.push({
  id: "syllabus_math_cia",
  courseId: "course_math",
  title: "Mathematics CIA 1 syllabus",
  units: [
    "Matrix decomposition and systems of linear & non-linear equations",
    "Probability distributions and sampling",
    "Optimization methods",
  ],
  academicContextIncluded: true,
});
state.studentProfile.dailyTodoPlan = ensureDailyTodoStudyState({
  date: "2026-07-05",
  generated_at: now.toISOString(),
  items: [{
    title: "Prepare Mathematics CIA 1",
    related_course: "Mathematics",
    related_context: "Mathematics CIA 1 syllabus",
    reason: "The exam is approaching.",
    time_hint: "45 minutes",
    priority: "high",
  }],
});

const item = state.studentProfile.dailyTodoPlan.items[0];
const queue = ensureTopicMasteryQueue(state, item, { now });
assert.deepEqual(queue.topics.map((topic) => topic.title), state.syllabi[0].units);
assert.equal(activeMasteryTopic(item).title, "Matrix decomposition and systems of linear & non-linear equations");
assert.equal(isActiveTopicTestUnlocked(item), false);

await assert.rejects(
  generateStudyTest({ state, item, now, providerConfig: { requestedMode: "mock" } }),
  /Complete every note in this syllabus topic/,
);

const providerConfig = {
  requestedMode: "groq",
  groq: {
    configured: true,
    keys: [{ name: "test-key", value: "not-a-real-secret", index: 0 }],
    model: "test-model",
    endpoint: "https://example.invalid/phase24c",
    maxCompletionTokens: 2000,
    reasoningEffort: null,
    timeoutMs: 2000,
  },
  pollinations: { configured: false },
};
let materialProviderPayload = null;
const materialProviderState = structuredClone(state);
const materialProviderItem = materialProviderState.studentProfile.dailyTodoPlan.items[0];
const providerGeneratedMaterial = await generateStudyMaterial({
  state: materialProviderState,
  item: materialProviderItem,
  now,
  providerConfig,
  fetchImpl: async (_url, options) => {
    materialProviderPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: [
            "# Friendly beginner matrices",
            "",
            "This section tries to rename the lesson, but includes math $A = LU$.",
            "",
            "\\[Ax=b\\]",
          ].join("\n"),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
assert.equal(providerGeneratedMaterial.generationSucceeded, true);
assert.equal(providerGeneratedMaterial.material.title, "Determinant, trace, and echelon form");
assert.match(providerGeneratedMaterial.material.generatedContent, /^# Determinant, trace, and echelon form/);
assert.doesNotMatch(providerGeneratedMaterial.material.generatedContent, /^# Friendly beginner matrices/);
assert.match(materialProviderPayload.messages[0].content, /Generate only for the active parent syllabus topic/);
assert.match(materialProviderPayload.messages[0].content, /Do not choose an easier prerequisite/);
assert.match(materialProviderPayload.messages[0].content, /Put inline math in \$\.\.\.\$/);

const expectedSubparts = [
  "Determinant, trace, and echelon form",
  "LU, QR, eigen-decomposition, and Cholesky decomposition",
  "Linear systems and numerical methods",
  "Non-linear equation methods",
];

for (const [index, expectedTitle] of expectedSubparts.entries()) {
  const generated = await generateStudyMaterial({ state, item, now, providerConfig: { requestedMode: "mock" } });
  assert.equal(generated.generationSucceeded, true);
  assert.equal(generated.reused, false);
  assert.equal(generated.target.topic.title, "Matrix decomposition and systems of linear & non-linear equations");
  assert.equal(generated.target.subpart.title, expectedTitle);
  assert.equal(generated.material.title, expectedTitle);
  assert.equal(generated.material.kind, "generated_study_material");
  assert.equal(generated.material.contextKind, "generated_study_material");
  assert.equal(generated.material.materialKind, "generated_study_material");
  assert.equal(generated.material.academicContextIncluded, true);
  assert.equal(generated.material.parentSyllabusTopic, "Matrix decomposition and systems of linear & non-linear equations");
  assert.equal(generated.material.subpartIndex, index + 1);
  assert.match(generated.material.generatedContent, new RegExp(`# ${expectedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(generated.material.generatedContent, /Concept explanation/);
  assert.match(generated.material.generatedContent, /Worked example/);
  assert.doesNotMatch(generated.material.generatedContent, /Study guide:|What to focus on|Study steps/i);
  state.sourceMaterials.push(generated.material);

  const reused = await generateStudyMaterial({ state, item, now, providerConfig: { requestedMode: "mock" } });
  assert.equal(reused.reused, true);
  assert.equal(reused.material.id, generated.material.id);
  assert.equal(state.sourceMaterials.filter((source) => source.id === generated.material.id).length, 1);

  const completion = completeCurrentMasteryTarget(state, item, { now });
  assert.equal(completion.topicComplete, index === expectedSubparts.length - 1);
  assert.equal(activeMasteryTopic(item).title, "Matrix decomposition and systems of linear & non-linear equations");
  assert.equal(isActiveTopicTestUnlocked(item), index === expectedSubparts.length - 1);
}

assert.equal(state.sourceMaterials.filter((source) => source.kind === "generated_study_material").length, expectedSubparts.length);
assert.equal(state.sourceMaterials.filter((source) => /pdf/i.test(String(source.sourceType || source.kind || source.title))).length, 0);
assert.ok(relatedMaterialsForTodo(state, item).some((material) => material.parentTopicId === queue.activeTopicId));

const generatedTest = await generateStudyTest({ state, item, now, providerConfig: { requestedMode: "mock" } });
assert.equal(generatedTest.generationSucceeded, true);
assert.equal(generatedTest.session.parentSyllabusTopic, "Matrix decomposition and systems of linear & non-linear equations");
assert.equal(generatedTest.session.testPaper.topic, "Matrix decomposition and systems of linear & non-linear equations");
assert.equal(generatedTest.session.testPaper.test_title, "Matrix decomposition and systems of linear & non-linear equations check");

let testProviderPayload = null;
const providerGeneratedTest = await generateStudyTest({
  state: structuredClone(state),
  item: structuredClone(item),
  now,
  providerConfig,
  fetchImpl: async (_url, options) => {
    testProviderPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            test_title: "Easy prerequisite matrix quiz",
            course: "Friendlier course name",
            topic: "Matrix basics",
            total_marks: 10,
            estimated_minutes: 20,
            instructions: ["Use **clean Markdown** and show $A = LU$ where relevant."],
            questions: [{
              question_number: 1,
              type: "objective",
              prompt: "Which statement belongs to $A = LU$ within this topic?",
              marks: 2,
              choices: ["**Factorization** inside the locked topic", "<script>alert(1)</script>"],
            }],
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
assert.equal(providerGeneratedTest.generationSucceeded, true);
assert.equal(providerGeneratedTest.session.testPaper.topic, "Matrix decomposition and systems of linear & non-linear equations");
assert.equal(providerGeneratedTest.session.testPaper.course, "Mathematics");
assert.equal(providerGeneratedTest.session.testPaper.test_title, "Matrix decomposition and systems of linear & non-linear equations check");
assert.match(testProviderPayload.messages[0].content, /Do not rename the topic/);
assert.match(testProviderPayload.messages[0].content, /Use clean Markdown in question prompts/);
state.testSessions.push(generatedTest.session);

applyStudyTestEvaluation({
  state,
  item,
  session: generatedTest.session,
  evaluation: {
    total_marks: 25,
    scored_marks: 21,
    percentage: 84,
    question_results: [],
    strengths: ["Understands the parent topic"],
    weak_topics: [],
    next_steps: ["Continue the next syllabus topic"],
    short_revision_plan: "Move to the next syllabus topic in order.",
  },
  now,
});

assert.equal(activeMasteryTopic(item).title, "Probability distributions and sampling");
assert.equal(item.study_status, "studying");
assert.equal(isActiveTopicTestUnlocked(item), false);

const [app, css] = await Promise.all([
  readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8"),
  readFile(new URL("../frontend/styles/main.css", import.meta.url), "utf8"),
]);

assert.match(app, /function renderAcademicTextMarkup/);
assert.match(app, /function renderAcademicInlineMarkup/);
assert.match(app, /line\.startsWith\("\\\\\["\)/);
assert.match(app, /element\.replaceWith\(document\.createTextNode/);
assert.match(app, /renderAcademicTextMarkup\(question\.prompt\)/);
assert.match(app, /renderAcademicInlineMarkup\(choice\)/);
assert.match(app, /renderAcademicInlineMarkup\(instruction\)/);
assert.match(app, /renderAcademicTextMarkup\(question\.feedback\)/);
assert.match(app, /renderAcademicTextMarkup\(question\.correction\)/);
assert.match(app, /renderAcademicTextMarkup\(result\.short_revision_plan\)/);
assert.match(app, /function generatedStudyDisplayMetadata/);
assert.match(app, /isInternalGeneratedId/);
assert.match(app, /generatedStudyPdfMetadata\(material\)/);
assert.match(css, /\.study-academic-copy/);
assert.match(css, /\.study-test-prompt/);
assert.match(css, /\.study-result-copy/);

const strictTestUi = app.slice(app.indexOf("function studyTestWarningMarkup"), app.indexOf("function studyTestMarkup"));
assert.doesNotMatch(strictTestUi, /data-study-test-(?:download|print|export)|Export as PDF|Download PDF/i);

console.log("PASS | StudentOS Phase 2.4A syllabus topic mastery queue tests passed");
