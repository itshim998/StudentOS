import { randomUUID } from "node:crypto";
import { getAiProviderConfig } from "./providerConfig.js";
import { runProviderFallback } from "./providers.js";
import { isReadableStudyMaterial } from "../domain/academicContextKinds.js";

const MAX_CONTENT_LENGTH = 14_000;

function clean(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function todoItemId(date, index, title) {
  const slug = clean(title, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "study-item";
  return `todo_${String(date || "today").replace(/[^0-9-]/g, "")}_${index + 1}_${slug}`;
}

export function ensureDailyTodoStudyState(plan) {
  if (!plan || !Array.isArray(plan.items)) return plan;
  for (const [index, item] of plan.items.entries()) {
    item.id = clean(item.id, 180) || todoItemId(plan.date, index, item.title);
    item.study_status = ["not_started", "studying", "done"].includes(item.study_status) ? item.study_status : "not_started";
    item.study_completed_at = item.study_completed_at || null;
    item.generated_material_id = item.generated_material_id || null;
  }
  return plan;
}

export function findDailyTodoItem(state, itemId) {
  const plan = ensureDailyTodoStudyState(state?.studentProfile?.dailyTodoPlan);
  return plan?.items?.find((item) => item.id === String(itemId || "")) || null;
}

function courseForTodo(state, item) {
  const relatedCourse = clean(item?.related_course, 140).toLowerCase();
  if (!relatedCourse) return null;
  return (state.courses || []).find((course) => {
    const values = [course.title, course.name, course.code].map((value) => clean(value, 140).toLowerCase()).filter(Boolean);
    return values.some((value) => value === relatedCourse || value.includes(relatedCourse) || relatedCourse.includes(value));
  }) || null;
}

export function relatedMaterialsForTodo(state, item) {
  if (!item) return [];
  const course = courseForTodo(state, item);
  const terms = [item.title, item.related_context]
    .flatMap((value) => clean(value, 300).toLowerCase().split(/[^a-z0-9]+/))
    .filter((value) => value.length >= 4);
  return (state.sourceMaterials || [])
    .filter((source) => !source.deletedAt && source.academicContextIncluded === true && isReadableStudyMaterial(source))
    .map((source) => {
      let score = 0;
      if (item.generated_material_id && source.id === item.generated_material_id) score += 100;
      if (source.todoItemId === item.id) score += 80;
      if (course?.id && source.courseId === course.id) score += 20;
      const searchable = `${source.title || ""} ${source.extractionSummary || ""}`.toLowerCase();
      score += terms.reduce((total, term) => total + (searchable.includes(term) ? 2 : 0), 0);
      return { source, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .map(({ source }) => source);
}

export function buildDeterministicStudyMaterial(item) {
  const title = clean(item?.title, 180) || "Today’s study item";
  const course = clean(item?.related_course, 140) || "your course";
  const context = clean(item?.related_context, 300);
  const reason = clean(item?.reason, 320);
  return [
    `Study guide: ${title}`,
    "",
    "What to focus on",
    `Build a clear understanding of ${context || title} in ${course}. ${reason}`.trim(),
    "",
    "Core lesson",
    `Start by defining the main ideas in ${context || title}. Connect each idea to one example from your course, then explain the connection in your own words. Separate facts or formulas you need to remember from the reasoning you need to understand.`,
    "",
    "Study steps",
    `1. Read your course outline for ${context || title} and list three key ideas.`,
    "2. Explain each idea without looking at your notes.",
    "3. Work through one representative example and write down why each step is valid.",
    "4. Revisit any step you could not explain clearly.",
    "",
    "Quick self-check",
    `Can you summarize ${context || title} in three sentences, give one example, and identify one common mistake? If not, return to the least clear idea before marking this study item done.`,
  ].join("\n");
}

function studyMaterialMessages(item) {
  return [
    {
      role: "system",
      content: [
        "You are StudentOS. Write a concise, accurate study lesson for one item in a student's plan.",
        "Use only the supplied title, course, context, reason, and time hint. Do not invent a syllabus, assignment detail, source, or deadline.",
        "Use plain text with short headings: What to focus on, Core lesson, Study steps, and Quick self-check.",
        "Do not create a formal test, answer key, grading flow, timer, or submission action.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        title: clean(item?.title, 180),
        course: clean(item?.related_course, 140),
        context: clean(item?.related_context, 300),
        reason: clean(item?.reason, 320),
        timeHint: clean(item?.time_hint, 80),
      }),
    },
  ];
}

export async function generateStudyMaterial({ state, item, now = new Date(), providerConfig = getAiProviderConfig(), fetchImpl = globalThis.fetch } = {}) {
  if (!item) {
    const error = new Error("Choose a study item from today’s queue first.");
    error.status = 404;
    throw error;
  }
  let content;
  if (["mock", "bridge"].includes(providerConfig.requestedMode)) {
    content = buildDeterministicStudyMaterial(item);
  } else {
    const result = await runProviderFallback({ messages: studyMaterialMessages(item), config: providerConfig, fetchImpl });
    if (result.providerFailure || !result.text) return { generationSucceeded: false, material: null };
    content = String(result.text).trim().slice(0, MAX_CONTENT_LENGTH);
  }
  if (!content) return { generationSucceeded: false, material: null };
  const course = courseForTodo(state, item);
  const timestamp = now.toISOString();
  const material = {
    id: `source_generated_${Date.now()}_${randomUUID().slice(0, 8)}`,
    userId: state.studentProfile.id,
    courseId: course?.id || null,
    title: clean(item.title, 180),
    kind: "generated_study_material",
    sourceType: "generated_study_material",
    artifactKind: "material",
    materialKind: "generated_study_material",
    contextKind: "generated_study_material",
    source: "studentos_generated",
    origin: "studentos_generated",
    status: "ready",
    extractionStatus: "ready",
    extractionSummary: clean(item.related_context || item.reason, 500),
    generatedContent: content,
    todoItemId: item.id,
    topicTitle: clean(item.related_context || item.title, 220),
    generatedAt: timestamp,
    academicContextIncluded: true,
    selectionState: "imported",
    readOnly: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { generationSucceeded: true, material };
}

export function updateDailyTodoStudyStatus(state, itemId, status, { now = new Date() } = {}) {
  if (!["studying", "done"].includes(status)) {
    const error = new Error("That study status is not supported.");
    error.status = 400;
    throw error;
  }
  const item = findDailyTodoItem(state, itemId);
  if (!item) {
    const error = new Error("That item is no longer in today’s study queue.");
    error.status = 404;
    throw error;
  }
  if (item.study_status !== "done" || status === "done") item.study_status = status;
  if (status === "done") item.study_completed_at = item.study_completed_at || now.toISOString();
  return item;
}
