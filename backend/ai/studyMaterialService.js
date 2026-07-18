import { randomUUID } from "node:crypto";
import { getAiProviderConfig } from "./providerConfig.js";
import { runProviderFallback } from "./providers.js";
import { isReadableStudyMaterial } from "../domain/academicContextKinds.js";

const MAX_CONTENT_LENGTH = 14_000;
const STUDY_STATUSES = new Set(["not_started", "studying", "done"]);
const QUEUE_STATUSES = new Set(["pending", "studying", "done"]);

function clean(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function slug(value, fallback = "topic") {
  return clean(value, 180).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54) || fallback;
}

function todoItemId(date, index, title) {
  return `todo_${String(date || "today").replace(/[^0-9-]/g, "")}_${index + 1}_${slug(title, "study-item").slice(0, 42)}`;
}

/** Returns true if a line is a PDF page marker, table header, CO code, or other document artifact — not a real syllabus topic. */
function isSyllabusArtifactLine(text) {
  const trimmed = String(text || "").replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length < 3) return true;
  // Purely numeric, punctuation-only, or single-char fragments
  if (/^[\d\s.,;:!?\-–—•*#/()\[\]]+$/.test(trimmed)) return true;
  // Page markers: "- 23 -", "— 5 —", "- 24 -", "Page 3", etc.
  if (/^[-–—]\s*\d+\s*[-–—]$/.test(trimmed)) return true;
  if (/^page\s+\d+$/i.test(trimmed)) return true;
  // "Detailed Syllabus" / "Detailed Syllabus continued"
  if (/^detailed\s+syllabus(\s+continued)?$/i.test(trimmed)) return true;
  // Table/header labels: "Module Contents Contact Hours CO Linked", column headers
  if (/^module\s+contents?\s+contact\s+hours?/i.test(trimmed)) return true;
  if (/^(s\.?\s*no|sr\.?\s*no|serial|contact\s+hours?|hours?|credits?|total)$/i.test(trimmed)) return true;
  // CO-code-only lines: "RCC-PCC-AIML-401.CO1", "CO1", "PO3", "CO1, CO2"
  if (/^([A-Z]{1,6}-)*[A-Z]{1,6}-\d{2,5}\.[A-Z]{2}\d+$/i.test(trimmed)) return true;
  if (/^(CO|PO|PSO)\d{1,2}(\s*,\s*(CO|PO|PSO)\d{1,2})*$/i.test(trimmed)) return true;
  // Course code lines that contain no descriptive words (e.g. "RCC-PCC-AIML-401")
  if (/^[A-Z]{2,6}(-[A-Z]{2,6}){1,4}(-\d{2,5})?$/.test(trimmed)) return true;
  return false;
}

/** Cleans a real topic title: strips trailing CO refs, excess list markers, and whitespace. Returns empty string if nothing meaningful remains. */
function cleanSyllabusTopicLine(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  // Strip trailing CO/PO references like "(CO1, CO2)" or "CO1"
  t = t.replace(/\s*\(?\s*(CO|PO|PSO)\d{1,2}(\s*,\s*(CO|PO|PSO)\d{1,2})*\s*\)?\s*\.?\s*$/i, "").trim();
  // Strip leading list markers that survived prior parsing ("- ", "• ", "1. ")
  t = t.replace(/^[-–—•*]\s+/, "").replace(/^\d+[.):]\s+/, "").trim();
  // Strip trailing period if it's a leftover
  t = t.replace(/\.$/, "").trim();
  return t;
}

export function ensureDailyTodoStudyState(plan) {
  if (!plan || !Array.isArray(plan.items)) return plan;
  for (const [index, item] of plan.items.entries()) {
    item.id = clean(item.id, 180) || todoItemId(plan.date, index, item.title);
    item.study_status = STUDY_STATUSES.has(item.study_status) ? item.study_status : "not_started";
    item.study_completed_at = item.study_completed_at || null;
    item.generated_material_id = item.generated_material_id || null;
    if (item.topic_mastery_queue) normalizeTopicMasteryQueue(item.topic_mastery_queue);
  }
  return plan;
}

export function findDailyTodoItem(state, itemId) {
  const plan = ensureDailyTodoStudyState(state?.studentProfile?.dailyTodoPlan);
  return plan?.items?.find((item) => item.id === String(itemId || "")) || null;
}

export function courseForTodo(state, item) {
  const relatedCourse = clean(item?.related_course, 140).toLowerCase();
  if (!relatedCourse) return null;
  return (state.courses || []).find((course) => {
    const values = [course.title, course.name, course.code].map((value) => clean(value, 140).toLowerCase()).filter(Boolean);
    return values.some((value) => value === relatedCourse || value.includes(relatedCourse) || relatedCourse.includes(value));
  }) || null;
}

function exactTopicTitle(unit) {
  if (typeof unit === "string") return clean(unit, 260);
  return clean(unit?.title || unit?.name || unit?.topic || unit?.module, 260);
}

function moduleLabel(unit, index) {
  if (!unit || typeof unit === "string") return null;
  return clean(unit.moduleTitle || unit.module || unit.unit || unit.section, 140) || (unit.order != null ? `Module ${unit.order}` : null);
}

function parseSyllabusHeadings(source) {
  const text = String(source?.extractedText || source?.extractionSummary || "");
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headings = [];
  for (const line of lines) {
    if (isSyllabusArtifactLine(line)) continue;
    const match = line.match(/^(?:(?:module|unit|topic|chapter)\s*[\w.-]+\s*[:\-–—]\s*|(?:\d+(?:\.\d+)*)[.)]\s+|[-•]\s+)(.+)$/i);
    const raw = clean(match?.[1], 260);
    const title = cleanSyllabusTopicLine(raw);
    if (title && title.length >= 3 && !isSyllabusArtifactLine(title) && !headings.some((entry) => entry.toLowerCase() === title.toLowerCase())) headings.push(title);
    if (headings.length >= 30) break;
  }
  return headings;
}

function scopeTitles(exam) {
  const values = exam?.syllabusTopics || exam?.scopeTopics || exam?.topics || exam?.scope;
  if (!Array.isArray(values)) return [];
  return values.map(exactTopicTitle).filter(Boolean);
}

function matchingAcademicContext(state, item) {
  const course = courseForTodo(state, item);
  const matchesCourse = (entry) => !course?.id || !entry?.courseId || entry.courseId === course.id;
  const exams = (state.exams || []).filter((exam) => !exam.archived && matchesCourse(exam)).sort((left, right) => {
    return new Date(left.examDate || "9999-12-31") - new Date(right.examDate || "9999-12-31");
  });
  const itemText = `${item?.title || ""} ${item?.related_context || ""}`.toLowerCase();
  const exam = exams.find((entry) => itemText.includes(String(entry.title || "").toLowerCase())) || exams[0] || null;
  const syllabus = (state.syllabi || []).find((entry) => !entry.archived && matchesCourse(entry)) || null;
  return { course, exam, syllabus };
}

function orderedSyllabusTopics(state, item, syllabus, exam) {
  let units = (syllabus?.units || []).map((unit, index) => {
    const raw = exactTopicTitle(unit);
    const title = cleanSyllabusTopicLine(raw);
    return { title, module: moduleLabel(unit, index), sourceOrder: index };
  }).filter((unit) => unit.title && !isSyllabusArtifactLine(unit.title));
  let uncertain = false;
  if (!units.length && syllabus?.sourceMaterialId) {
    const source = (state.sourceMaterials || []).find((entry) => entry.id === syllabus.sourceMaterialId);
    units = parseSyllabusHeadings(source).map((title, index) => ({ title, module: null, sourceOrder: index }));
    uncertain = units.length > 0;
  }
  const scoped = scopeTitles(exam);
  if (scoped.length && units.length) {
    const normalizedScope = scoped.map((title) => title.toLowerCase());
    const filtered = units.filter((unit) => normalizedScope.some((title) => title === unit.title.toLowerCase() || title.includes(unit.title.toLowerCase()) || unit.title.toLowerCase().includes(title)));
    if (filtered.length) units = filtered;
  }
  if (!units.length) {
    const fallback = clean(item?.related_context || item?.title, 260) || "Current study topic";
    units = [{ title: fallback, module: null, sourceOrder: 0 }];
    uncertain = true;
  }
  return { units, uncertain };
}

export function normalizeTopicMasteryQueue(queue) {
  if (!queue || !Array.isArray(queue.topics)) return queue;
  queue.version = 1;
  queue.topics = queue.topics.map((topic, index) => {
    topic.id = clean(topic.id, 180) || `topic_${index + 1}_${slug(topic.title)}`;
    topic.title = cleanSyllabusTopicLine(clean(topic.title, 260));
    topic.order = index + 1;
    topic.status = QUEUE_STATUSES.has(topic.status) ? topic.status : "pending";
    topic.subparts = Array.isArray(topic.subparts) ? topic.subparts.map((part, partIndex) => ({
      ...part,
      id: clean(part.id, 180) || `${topic.id}_part_${partIndex + 1}`,
      title: clean(part.title, 260),
      index: partIndex + 1,
      status: QUEUE_STATUSES.has(part.status) ? part.status : "pending",
      generatedMaterialId: part.generatedMaterialId || null,
    })).filter((part) => part.title) : [];
    if (topic.subparts.length) topic.status = topic.subparts.every((part) => part.status === "done") ? "done" : topic.subparts.some((part) => part.status !== "pending") ? "studying" : topic.status;
    return topic;
  }).filter((topic) => topic.title && !isSyllabusArtifactLine(topic.title));
  if (!queue.activeTopicId || !queue.topics.some((topic) => topic.id === queue.activeTopicId)) queue.activeTopicId = queue.topics.find((topic) => topic.status !== "done")?.id || queue.topics[0]?.id || null;
  return queue;
}

export function ensureTopicMasteryQueue(state, item, { now = new Date() } = {}) {
  if (!item) return null;
  if (item.topic_mastery_queue?.topics?.length) return normalizeTopicMasteryQueue(item.topic_mastery_queue);
  const { course, exam, syllabus } = matchingAcademicContext(state, item);
  const { units, uncertain } = orderedSyllabusTopics(state, item, syllabus, exam);
  const queue = {
    version: 1,
    courseId: course?.id || null,
    courseTitle: clean(item.related_course || course?.title, 140) || "Course not specified",
    examId: exam?.id || null,
    examName: clean(exam?.title, 180) || null,
    syllabusId: syllabus?.id || null,
    syllabusTitle: clean(syllabus?.title, 180) || null,
    scopeUncertain: uncertain,
    guidance: uncertain ? "These headings use the best available syllabus context. Check Academic Context if a heading looks incomplete." : null,
    activeTopicId: null,
    createdAt: now.toISOString(),
    topics: units.map((unit, index) => ({
      id: `topic_${index + 1}_${slug(unit.title)}`,
      title: unit.title,
      module: unit.module,
      order: index + 1,
      sourceOrder: unit.sourceOrder,
      status: "pending",
      subparts: [],
      generatedMaterialId: null,
      completedAt: null,
    })),
  };
  queue.activeTopicId = queue.topics[0]?.id || null;
  item.topic_mastery_queue = queue;
  return queue;
}

export function activeMasteryTopic(item) {
  const queue = normalizeTopicMasteryQueue(item?.topic_mastery_queue);
  return queue?.topics?.find((topic) => topic.id === queue.activeTopicId) || queue?.topics?.find((topic) => topic.status !== "done") || queue?.topics?.[0] || null;
}

export function nextPendingMasteryTarget(item) {
  const topic = activeMasteryTopic(item);
  if (!topic || topic.status === "done") return null;
  const subpart = topic.subparts?.find((part) => part.status !== "done") || null;
  return { topic, subpart, title: subpart?.title || topic.title, materialId: subpart?.generatedMaterialId || topic.generatedMaterialId || null };
}

export function isActiveTopicTestUnlocked(item) {
  return activeMasteryTopic(item)?.status === "done";
}

function deterministicSubparts(parentTitle) {
  const normalized = parentTitle.toLowerCase();
  if (normalized.includes("matrix decomposition") && normalized.includes("linear") && normalized.includes("non-linear")) {
    return [
      "Determinant, trace, and echelon form",
      "LU, QR, eigen-decomposition, and Cholesky decomposition",
      "Linear systems and numerical methods",
      "Non-linear equation methods",
    ];
  }
  if (parentTitle.length < 90) return [];
  const pieces = parentTitle.split(/\s*;\s*|\s+and\s+(?=[A-Z])/).map((part) => clean(part, 220)).filter((part) => part.length >= 10);
  return pieces.length >= 2 && pieces.length <= 6 ? pieces : [];
}

function applySubparts(topic, titles) {
  if (topic.subparts?.length || !titles?.length) return;
  topic.subparts = titles.slice(0, 6).map((title, index) => ({
    id: `${topic.id}_part_${index + 1}`,
    title: clean(title, 260),
    index: index + 1,
    status: "pending",
    generatedMaterialId: null,
    completedAt: null,
  })).filter((part) => part.title && part.title.toLowerCase() !== topic.title.toLowerCase());
}

export function relatedMaterialsForTodo(state, item) {
  if (!item) return [];
  const course = courseForTodo(state, item);
  const masteryTopic = activeMasteryTopic(item);
  const topicTerms = masteryTopic ? [masteryTopic.title, ...(masteryTopic.subparts || []).map((part) => part.title)] : [];
  const terms = [item.title, item.related_context, ...topicTerms].flatMap((value) => clean(value, 300).toLowerCase().split(/[^a-z0-9]+/)).filter((value) => value.length >= 4);
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
    }).filter(({ score }) => score > 0).sort((left, right) => right.score - left.score).map(({ source }) => source);
}

export function buildDeterministicStudyMaterial(item, target = null) {
  const queueTarget = target || nextPendingMasteryTarget(item);
  const title = clean(queueTarget?.title || item?.related_context || item?.title, 260) || "Current study topic";
  return [
    `# ${title}`,
    "",
    "## Concept explanation",
    `${title} is studied by identifying its central definitions, the conditions under which they apply, and the relationships between them. Keep every conclusion tied to those conditions rather than memorising an isolated rule.`,
    "",
    "## Key formulas and relationships",
    `Write the defining relationship for ${title} as $\\text{result} = f(\\text{known quantities})$, then label each term and its units or assumptions. Use the exact formula supplied in your course material when the topic has a standard form.`,
    "",
    "## Worked example",
    `Take one representative ${title} problem. First list the known information, choose the relevant definition or formula, substitute carefully, and check that the result satisfies the original conditions. Explain why each step follows; do not skip from the question directly to the answer.`,
    "",
    "## Common mistakes",
    "- Applying a rule without checking its assumptions.\n- Changing notation midway through a solution.\n- Giving a result without showing the reasoning or checking it against the question.",
    "",
    "## Practice checks",
    `1. State the main definition in ${title} in your own words.\n2. Work one small example and justify every step.\n3. Explain one situation where the usual rule would not apply.`,
    "",
    "## Summary",
    `A secure understanding of ${title} combines the exact definition, the relevant relationships, a worked application, and the ability to spot invalid assumptions.`,
  ].join("\n");
}

export function studyMaterialMessages(item, queue, target) {
  return [
    {
      role: "system",
      content: [
        "You are StudentOS. Teach exactly one syllabus topic or subpart by writing actual study notes, not a study plan or daily TODO list.",
        "Generate only for the active parent syllabus topic and active subpart supplied by StudentOS.",
        "The supplied parent syllabus topic is an immutable scope boundary. Never rename it, replace it with a friendlier title, or teach content outside it.",
        "Do not choose an easier prerequisite as the main topic.",
        "The first heading must exactly equal the supplied note title.",
        "Use clean Markdown. Put inline math in $...$ or \\(...\\), and block math in $$...$$ or \\[...\\].",
        "Include: concept explanation, relevant Markdown/LaTeX formulas, at least one worked example, common mistakes, short practice checks, and a summary.",
        "A short prerequisite reminder is allowed inside the note, but must not replace the title or become the main lesson.",
        "Do not output What to focus on, Study steps, broad advice, a test, answer key, grading, timer, or submission action.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        course: queue.courseTitle,
        exam: queue.examName,
        syllabus: queue.syllabusTitle,
        parent_syllabus_topic: target.topic.title,
        note_title: target.title,
        syllabus_order: target.topic.order,
        subpart_index: target.subpart?.index || null,
        total_subparts: target.topic.subparts?.length || 1,
        task_context: clean(item.related_context, 400),
      }),
    },
  ];
}

function enforceExactNoteTitle(content, title) {
  const body = String(content || "").trim().replace(/^#{1,6}\s+[^\n]+\n+/, "");
  return `# ${title}\n\n${body}`.slice(0, MAX_CONTENT_LENGTH);
}

export async function generateStudyMaterial({ state, item, now = new Date(), providerConfig = getAiProviderConfig(), fetchImpl = globalThis.fetch, providerExecutor = runProviderFallback } = {}) {
  if (!item) {
    const error = new Error("Choose a study item from today’s queue first.");
    error.status = 404;
    throw error;
  }
  const queue = ensureTopicMasteryQueue(state, item, { now });
  let topic = activeMasteryTopic(item);
  applySubparts(topic, deterministicSubparts(topic.title));
  const target = nextPendingMasteryTarget(item);
  if (!target) {
    const error = new Error("This syllabus topic is complete. Generate its test when you are ready.");
    error.status = 409;
    throw error;
  }
  if (target.materialId) {
    const material = (state.sourceMaterials || []).find((source) => source.id === target.materialId && !source.deletedAt) || null;
    if (material) return { generationSucceeded: true, material, queue, target, reused: true };
  }
  let content;
  if (["mock", "bridge"].includes(providerConfig.requestedMode)) content = buildDeterministicStudyMaterial(item, target);
  else {
    const result = await providerExecutor({ messages: studyMaterialMessages(item, queue, target), config: providerConfig, fetchImpl, responseMode: "text" });
    if (result.providerFailure || !result.text) return { generationSucceeded: false, material: null, queue, target };
    content = enforceExactNoteTitle(result.text, target.title);
  }
  if (!content) return { generationSucceeded: false, material: null, queue, target };
  const course = courseForTodo(state, item);
  const timestamp = now.toISOString();
  const material = {
    id: `source_generated_${Date.now()}_${randomUUID().slice(0, 8)}`,
    userId: state.studentProfile.id,
    courseId: course?.id || null,
    title: target.title,
    kind: "generated_study_material",
    sourceType: "generated_study_material",
    artifactKind: "material",
    materialKind: "generated_study_material",
    contextKind: "generated_study_material",
    contentKind: "generated_study_material",
    source: "studentos_generated",
    origin: "studentos_generated",
    status: "ready",
    studyStatus: "studying",
    extractionStatus: "ready",
    extractionSummary: clean(`Study notes for ${target.title}`, 500),
    generatedContent: content,
    todoItemId: item.id,
    examName: queue.examName,
    parentSyllabusTopic: target.topic.title,
    parentTopicId: target.topic.id,
    syllabusModule: target.topic.module,
    syllabusOrder: target.topic.order,
    subpartTitle: target.subpart?.title || null,
    subpartId: target.subpart?.id || null,
    subpartIndex: target.subpart?.index || 1,
    totalSubparts: target.topic.subparts?.length || 1,
    generatedAt: timestamp,
    academicContextIncluded: true,
    selectionState: "imported",
    readOnly: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (target.subpart) {
    target.subpart.generatedMaterialId = material.id;
    target.subpart.status = "studying";
  } else {
    target.topic.generatedMaterialId = material.id;
    target.topic.status = "studying";
  }
  item.generated_material_id = material.id;
  item.study_status = "studying";
  return { generationSucceeded: true, material, queue, target, reused: false };
}

export function completeCurrentMasteryTarget(state, item, { now = new Date() } = {}) {
  const target = nextPendingMasteryTarget(item);
  if (!target || !target.materialId) {
    const error = new Error("Generate and read the current note before marking it done.");
    error.status = 409;
    throw error;
  }
  const timestamp = now.toISOString();
  const completed = target.subpart || target.topic;
  completed.status = "done";
  completed.completedAt = completed.completedAt || timestamp;
  const material = (state.sourceMaterials || []).find((source) => source.id === target.materialId);
  if (material) {
    material.studyStatus = "done";
    material.updatedAt = timestamp;
  }
  if (target.topic.subparts?.length) {
    target.topic.status = target.topic.subparts.every((part) => part.status === "done") ? "done" : "studying";
    if (target.topic.status === "done") target.topic.completedAt = target.topic.completedAt || timestamp;
  } else {
    target.topic.status = "done";
    target.topic.completedAt = target.topic.completedAt || timestamp;
  }
  const allDone = item.topic_mastery_queue.topics.every((topic) => topic.status === "done");
  item.study_status = allDone ? "done" : "studying";
  if (allDone) item.study_completed_at = item.study_completed_at || timestamp;
  return { target, topicComplete: target.topic.status === "done", allDone, testUnlocked: target.topic.status === "done" };
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
