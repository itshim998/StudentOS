import { randomUUID } from "node:crypto";
import { getAiProviderConfig } from "./providerConfig.js";
import { runProviderFallback } from "./providers.js";
import { relatedMaterialsForTodo } from "./studyMaterialService.js";

const QUESTION_TYPES = new Set(["objective", "short_answer", "long_answer", "numerical", "mixed"]);
const ANSWER_MODES = new Set(["typed", "handwritten"]);
const ACTIVE_STATUSES = new Set(["ready_to_start", "in_progress"]);
const MAX_ANSWER_LENGTH = 20_000;

function clean(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function courseForItem(state, item) {
  const related = clean(item?.related_course, 140).toLowerCase();
  return (state?.courses || []).find((course) => {
    const labels = [course.title, course.name, course.code].map((value) => clean(value, 140).toLowerCase()).filter(Boolean);
    return related && labels.some((label) => label === related || label.includes(related) || related.includes(label));
  }) || null;
}

function urgencyContext(state, item, course) {
  const matchesCourse = (entry) => !course?.id || !entry.courseId || entry.courseId === course.id;
  const assignment = (state?.assignments || []).filter(matchesCourse).sort((left, right) => {
    return new Date(left.dueAt || left.dueDate || "9999-12-31") - new Date(right.dueAt || right.dueDate || "9999-12-31");
  })[0] || null;
  const exam = (state?.exams || []).filter(matchesCourse).sort((left, right) => {
    return new Date(left.examDate || "9999-12-31") - new Date(right.examDate || "9999-12-31");
  })[0] || null;
  const syllabus = (state?.syllabi || []).find(matchesCourse) || null;
  return {
    assignment: assignment ? { title: clean(assignment.title, 180), dueAt: assignment.dueAt || assignment.dueDate || null } : null,
    exam: exam ? { title: clean(exam.title, 180), examDate: exam.examDate || null } : null,
    syllabus: syllabus ? { title: clean(syllabus.title, 180), units: (syllabus.units || []).slice(0, 12) } : null,
  };
}

function generationContext(state, item) {
  const course = courseForItem(state, item);
  const materials = relatedMaterialsForTodo(state, item).slice(0, 3).map((material) => ({
    title: clean(material.title, 180),
    summary: clean(material.extractionSummary || material.extractedSnippet, 1_200),
    generatedLesson: clean(material.generatedContent, 5_000),
  }));
  return {
    item: {
      title: clean(item?.title, 180),
      course: clean(item?.related_course || course?.title, 140),
      topic: clean(item?.related_context || item?.title, 240),
      reason: clean(item?.reason, 320),
      suggestedStudyTime: clean(item?.time_hint, 80),
    },
    materials,
    ...urgencyContext(state, item, course),
  };
}

export function buildDeterministicTestPaper({ state, item } = {}) {
  const context = generationContext(state, item);
  const topic = context.item.topic || context.item.title || "Today’s study topic";
  const course = context.item.course || "Course not specified";
  const numericalTopic = /\b(?:math|physics|chemistry|account|statistic|calculus|algebra|formula|equation|force|motion)\b/i.test(`${course} ${topic}`);
  const questions = [
    {
      question_number: 1,
      type: "objective",
      prompt: `Which statement best captures the central idea of ${topic}?`,
      marks: 2,
      choices: ["The core principle and when it applies", "An unrelated definition", "A detail with no context", "None of the above"],
    },
    { question_number: 2, type: "short_answer", prompt: `Define two key ideas in ${topic} and explain how they are connected.`, marks: 4 },
    { question_number: 3, type: "short_answer", prompt: `Give one relevant example of ${topic} and explain why it fits.`, marks: 4 },
    numericalTopic
      ? { question_number: 4, type: "numerical", prompt: `Set up and solve one representative problem involving ${topic}. State each assumption and show your working.`, marks: 7 }
      : { question_number: 4, type: "long_answer", prompt: `Analyse ${topic} step by step, using evidence or examples from your study material.`, marks: 7 },
    { question_number: 5, type: "long_answer", prompt: `Identify a common mistake about ${topic}, correct it, and justify the correction.`, marks: 8 },
  ];
  return {
    test_title: `${topic} check`,
    course,
    topic,
    total_marks: questions.reduce((sum, question) => sum + question.marks, 0),
    estimated_minutes: numericalTopic ? 35 : 30,
    instructions: [
      "Answer every question.",
      "Show your reasoning where the question asks for it.",
      "This test must be completed in one sitting.",
    ],
    questions,
  };
}

function testGenerationMessages(context) {
  return [
    {
      role: "system",
      content: [
        "You are StudentOS. Create a rigorous but fair test from only the supplied student task and study context.",
        "Choose the marks, duration, question types, and difficulty for the context and urgency.",
        "Return JSON only with: test_title, course, topic, total_marks, estimated_minutes, instructions (string array), and questions.",
        "Each question must contain question_number, type (objective, short_answer, long_answer, numerical, or mixed), prompt, marks, and choices only for objective questions.",
        "Use 3 to 12 questions. Do not include answers, an answer key, grading, scores, citations, or download instructions.",
      ].join(" "),
    },
    { role: "user", content: JSON.stringify(context) },
  ];
}

function parseJsonObject(text) {
  const value = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function normalizeTestPaper(input, fallback = {}) {
  if (!input || !Array.isArray(input.questions)) return null;
  const questions = input.questions.slice(0, 30).map((question, index) => {
    const type = QUESTION_TYPES.has(question?.type) ? question.type : "short_answer";
    const prompt = clean(question?.prompt, 2_000);
    if (!prompt) return null;
    const normalized = {
      question_number: index + 1,
      type,
      prompt,
      marks: integer(question?.marks, 1, 1, 50),
    };
    if (type === "objective") {
      const choices = (question?.choices || []).map((choice) => clean(choice, 500)).filter(Boolean).slice(0, 8);
      if (choices.length >= 2) normalized.choices = choices;
      else normalized.type = "short_answer";
    }
    return normalized;
  }).filter(Boolean);
  if (questions.length < 1) return null;
  const computedMarks = questions.reduce((sum, question) => sum + question.marks, 0);
  return {
    test_title: clean(input.test_title || fallback.test_title, 180) || "Study check",
    course: clean(input.course || fallback.course, 140) || "Course not specified",
    topic: clean(input.topic || fallback.topic, 240) || "Study topic",
    total_marks: computedMarks,
    estimated_minutes: integer(input.estimated_minutes, Math.max(10, questions.length * 5), 5, 180),
    instructions: (Array.isArray(input.instructions) ? input.instructions : [input.instructions])
      .map((instruction) => clean(instruction, 500)).filter(Boolean).slice(0, 8),
    questions,
  };
}

export async function generateStudyTest({ state, item, now = new Date(), providerConfig = getAiProviderConfig(), fetchImpl = globalThis.fetch } = {}) {
  if (!item || item.study_status !== "done") {
    const error = new Error("Mark this study item done before generating its test.");
    error.status = 409;
    throw error;
  }
  const context = generationContext(state, item);
  let paper;
  if (["mock", "bridge"].includes(providerConfig.requestedMode)) {
    paper = buildDeterministicTestPaper({ state, item });
  } else {
    const result = await runProviderFallback({ messages: testGenerationMessages(context), config: providerConfig, fetchImpl });
    if (result.providerFailure || !result.text) return { generationSucceeded: false, session: null };
    paper = normalizeTestPaper(parseJsonObject(result.text), {
      test_title: `${context.item.topic || context.item.title} check`,
      course: context.item.course,
      topic: context.item.topic,
    });
  }
  paper = normalizeTestPaper(paper, { course: context.item.course, topic: context.item.topic });
  if (!paper) return { generationSucceeded: false, session: null };
  const course = courseForItem(state, item);
  const timestamp = now.toISOString();
  const session = {
    id: randomUUID(),
    userId: state.studentProfile.id,
    todoItemId: item.id,
    courseId: course?.id || null,
    topicId: null,
    questionFormat: paper.questions.every((question) => question.type === "objective") ? "mcq" : "mixed",
    status: "ready_to_start",
    testPaper: paper,
    questions: paper.questions,
    answerMode: null,
    answers: {},
    durationMinutes: paper.estimated_minutes,
    startedAt: null,
    deadlineAt: null,
    lastSavedAt: null,
    submittedAt: null,
    lockedAt: null,
    generatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    academicContextIncluded: true,
    source: "studentos_generated_test",
  };
  return { generationSucceeded: true, session };
}

export function findStudyTestSession(state, { sessionId, todoItemId } = {}) {
  return (state?.testSessions || []).find((session) => {
    if (sessionId) return session.id === String(sessionId);
    return session.todoItemId === String(todoItemId || "");
  }) || null;
}

export function synchronizeTestSession(session, { now = new Date() } = {}) {
  if (session?.status === "in_progress" && session.deadlineAt && new Date(session.deadlineAt).getTime() <= now.getTime()) {
    session.status = "time_expired";
    session.lockedAt = session.lockedAt || session.deadlineAt;
    session.updatedAt = now.toISOString();
  }
  return session;
}

export function publicTestSession(session, options = {}) {
  const projected = structuredClone(session);
  if (projected.answerSheetDraft?.extractedText) delete projected.answerSheetDraft.extractedText;
  return synchronizeTestSession(projected, options);
}

export function startStudyTestSession(session, answerMode, { now = new Date() } = {}) {
  synchronizeTestSession(session, { now });
  if (!ANSWER_MODES.has(answerMode)) {
    const error = new Error("Choose how you will answer before starting the test.");
    error.status = 400;
    throw error;
  }
  if (session.status === "in_progress") return session;
  if (session.status !== "ready_to_start") {
    const error = new Error("This test can no longer be started.");
    error.status = 409;
    throw error;
  }
  const startedAt = now.toISOString();
  session.answerMode = answerMode;
  session.startedAt = startedAt;
  session.deadlineAt = new Date(now.getTime() + integer(session.durationMinutes, 30, 5, 180) * 60_000).toISOString();
  session.status = "in_progress";
  session.updatedAt = startedAt;
  return session;
}

export function saveStudyTestAnswers(session, answers, { now = new Date() } = {}) {
  synchronizeTestSession(session, { now });
  if (session.status !== "in_progress" || session.answerMode !== "typed") {
    const error = new Error(session.status === "time_expired" ? "Time is up. This attempt is locked." : "Answers cannot be changed for this test.");
    error.status = 409;
    throw error;
  }
  const questionNumbers = new Set(session.testPaper.questions.map((question) => String(question.question_number)));
  const next = {};
  for (const [key, value] of Object.entries(answers || {})) {
    if (questionNumbers.has(String(key))) next[String(key)] = String(value || "").slice(0, MAX_ANSWER_LENGTH);
  }
  session.answers = { ...(session.answers || {}), ...next };
  session.lastSavedAt = now.toISOString();
  session.updatedAt = session.lastSavedAt;
  return session;
}

export function finishStudyTestSession(session, { now = new Date() } = {}) {
  synchronizeTestSession(session, { now });
  if (session.status === "time_expired") return session;
  if (session.status !== "in_progress") {
    const error = new Error("This test is not currently in progress.");
    error.status = 409;
    throw error;
  }
  session.status = session.answerMode === "handwritten" ? "ready_for_evaluation" : "submitted_pending_evaluation";
  session.submittedAt = now.toISOString();
  session.lockedAt = session.submittedAt;
  session.updatedAt = session.submittedAt;
  return session;
}

export function isReusableStudyTest(session) {
  return Boolean(session && [...ACTIVE_STATUSES, "time_expired", "submitted_pending_evaluation", "ready_for_evaluation", "evaluated"].includes(session.status));
}
