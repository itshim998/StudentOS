import assert from "node:assert/strict";
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

console.log("PASS | StudentOS Phase 2.4A syllabus topic mastery queue tests passed");
