import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import { getAiProviderConfig } from "./providerConfig.js";
import { runProviderFallback } from "./providers.js";
import { relatedMaterialsForTodo } from "./studyMaterialService.js";
import { extractSourceText, inferMimeType, MAX_SOURCE_UPLOAD_BYTES } from "../storage/sourceMaterialService.js";

export const MAX_ANSWER_SHEET_BYTES = MAX_SOURCE_UPLOAD_BYTES;
export const ANSWER_SHEET_COPY = "Upload your handwritten answer sheet as PDF or DOCX.";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EVALUATABLE_STATUSES = new Set(["submitted_pending_evaluation", "ready_for_evaluation", "time_expired"]);
const MAX_DOCX_XML_BYTES = 2 * 1024 * 1024;

function clean(value, limit = 800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function list(value, limit = 8, itemLimit = 500) {
  return (Array.isArray(value) ? value : [value])
    .map((entry) => clean(entry, itemLimit))
    .filter(Boolean)
    .slice(0, limit);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<w:tab\s*\/>/gi, "\t")
    .replace(/<w:br\s*\/>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function zipEntry(buffer, wantedName) {
  const bytes = Buffer.from(buffer || []);
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset += 1) {
    if (bytes.readUInt32LE(offset) === eocdSignature) eocd = offset;
  }
  if (eocd < 0) return null;
  const entryCount = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  for (let index = 0; index < entryCount && offset + 46 <= bytes.length; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) return null;
    const compression = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const filenameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const filename = bytes.subarray(offset + 46, offset + 46 + filenameLength).toString("utf8");
    if (filename === wantedName && localOffset + 30 <= bytes.length && bytes.readUInt32LE(localOffset) === 0x04034b50) {
      if (uncompressedSize > MAX_DOCX_XML_BYTES || compressedSize > bytes.length) return null;
      const localFilenameLength = bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localFilenameLength + localExtraLength;
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      if (compression === 0) return Buffer.from(compressed);
      if (compression === 8) return inflateRawSync(compressed, { maxOutputLength: MAX_DOCX_XML_BYTES });
      return null;
    }
    offset += 46 + filenameLength + extraLength + commentLength;
  }
  return null;
}

export function extractDocxText(bytes) {
  try {
    const documentXml = zipEntry(bytes, "word/document.xml");
    return documentXml ? decodeXml(documentXml.toString("utf8")).slice(0, 120_000) : "";
  } catch {
    return "";
  }
}

export function validateStudyAnswerSheet({ filename, mimeType, sizeBytes, bytes } = {}) {
  const extension = extname(String(filename || "")).toLowerCase();
  const resolvedMime = inferMimeType(filename, mimeType);
  const content = Buffer.from(bytes || []);
  const isPdf = extension === ".pdf" && resolvedMime === "application/pdf" && content.subarray(0, 1024).indexOf("%PDF-") >= 0;
  const isDocx = extension === ".docx" && resolvedMime === DOCX_MIME && content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const size = Number(sizeBytes ?? content.length);
  return {
    ok: size > 0 && size <= MAX_ANSWER_SHEET_BYTES && (isPdf || isDocx),
    filename: clean(filename, 120),
    mimeType: isPdf ? "application/pdf" : isDocx ? DOCX_MIME : resolvedMime,
    sizeBytes: size,
  };
}

export async function extractStudyAnswerSheet(file = {}) {
  const validation = validateStudyAnswerSheet({ ...file, sizeBytes: file.bytes?.length });
  if (!validation.ok) {
    const error = new Error(ANSWER_SHEET_COPY);
    error.status = 400;
    throw error;
  }
  let extractedText = "";
  if (validation.mimeType === "application/pdf") {
    const extraction = await extractSourceText(file);
    extractedText = extraction.status === "indexed" ? extraction.extractedText : "";
  } else {
    extractedText = extractDocxText(file.bytes);
  }
  if (!clean(extractedText, 120_000)) {
    const error = new Error("StudentOS could not read the writing in that answer sheet. Try a clearer PDF or DOCX.");
    error.status = 400;
    throw error;
  }
  return { ...validation, extractedText: String(extractedText).slice(0, 120_000) };
}

export function normalizeTestEvaluation(input, paper) {
  if (!input || !Array.isArray(input.question_results) || !paper?.questions?.length) return null;
  const received = new Map(input.question_results.map((result) => [String(result?.question_number), result]));
  const questionResults = paper.questions.map((question) => {
    const source = received.get(String(question.question_number)) || {};
    const maxMarks = Number(question.marks || 0);
    const marksAwarded = Math.round(clampNumber(source.marks_awarded, 0, 0, maxMarks) * 100) / 100;
    return {
      question_number: question.question_number,
      marks_awarded: marksAwarded,
      max_marks: maxMarks,
      feedback: clean(source.feedback, 1_200) || (marksAwarded ? "This answer showed some relevant understanding." : "This answer did not yet show enough relevant understanding."),
      correction: clean(source.correction, 2_000) || "Review the question and rebuild the answer from the relevant study material.",
    };
  });
  const totalMarks = paper.questions.reduce((sum, question) => sum + Number(question.marks || 0), 0);
  const scoredMarks = Math.round(questionResults.reduce((sum, result) => sum + result.marks_awarded, 0) * 100) / 100;
  const percentage = totalMarks ? Math.round((scoredMarks / totalMarks) * 10_000) / 100 : 0;
  return {
    total_marks: totalMarks,
    scored_marks: scoredMarks,
    percentage,
    question_results: questionResults,
    strengths: list(input.strengths, 8) || [],
    weak_topics: list(input.weak_topics, 8, 240),
    next_steps: list(input.next_steps, 8),
    short_revision_plan: clean(input.short_revision_plan, 2_000) || "Review the corrections, revisit the least secure topic, and try a short practice check.",
  };
}

export function buildDeterministicTestEvaluation({ session, answerSheetText = "" } = {}) {
  const paper = session.testPaper;
  const combinedSheet = clean(answerSheetText, 120_000);
  const questionResults = paper.questions.map((question) => {
    const answer = session.answerMode === "typed" ? clean(session.answers?.[String(question.question_number)], 20_000) : combinedSheet;
    const completeness = answer.length >= 120 ? 0.8 : answer.length >= 40 ? 0.65 : answer.length ? 0.4 : 0;
    const awarded = Math.round(Number(question.marks || 0) * completeness * 100) / 100;
    return {
      question_number: question.question_number,
      marks_awarded: awarded,
      max_marks: question.marks,
      feedback: answer ? "The response addresses the question and shows a developing explanation." : "No assessable answer was found for this question.",
      correction: `Revisit ${paper.topic} and give a direct answer with the key idea, reasoning, and one supporting example.`,
    };
  });
  const hasAnswers = questionResults.some((result) => result.marks_awarded > 0);
  return normalizeTestEvaluation({
    question_results: questionResults,
    strengths: hasAnswers ? ["Attempted the test in a structured way", `Used relevant ideas from ${paper.topic}`] : [],
    weak_topics: hasAnswers ? [`Applying ${paper.topic} precisely`] : [paper.topic],
    next_steps: ["Review every correction", `Revisit ${paper.topic}`, "Try one short practice question"],
    short_revision_plan: `Spend 15 minutes reviewing the corrections, 15 minutes revisiting ${paper.topic}, then complete one fresh practice question.`,
  }, paper);
}

function evaluationMessages({ state, item, session, answerSheetText }) {
  const materials = relatedMaterialsForTodo(state, item).slice(0, 3).map((material) => ({
    title: clean(material.title, 180),
    study_text: clean(material.generatedContent || material.extractedText || material.extractedSnippet || material.extractionSummary, 8_000),
  }));
  return [
    {
      role: "system",
      content: [
        "You are StudentOS evaluating a student's completed test. Use only the supplied test, answers, and study context.",
        "Award marks fairly against each question's maximum marks. Do not invent missing answers or award more than the question maximum.",
        "Return JSON only with total_marks, scored_marks, percentage, question_results, strengths, weak_topics, next_steps, and short_revision_plan.",
        "Each question result must include question_number, marks_awarded, max_marks, feedback, and correction.",
        "Feedback and corrections must be concise, specific, educational, and suitable for the student.",
        "Use clean Markdown in feedback, corrections, strengths, weak topics, next steps, and revision plan. Put inline math in $...$ or \\(...\\), and block math in $$...$$ or \\[...\\].",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        course: session.testPaper.course,
        topic: session.testPaper.topic,
        test_paper: session.testPaper,
        student_answers: session.answerMode === "typed" ? session.answers : undefined,
        handwritten_answer_sheet_text: session.answerMode === "handwritten" ? String(answerSheetText || "").slice(0, 120_000) : undefined,
        relevant_study_material: materials,
        marking_instructions: ["Use the marks shown on each question.", ...(session.testPaper.instructions || [])],
        total_marks: session.testPaper.total_marks,
      }),
    },
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

export async function evaluateStudyTest({ state, item, session, answerSheetText = "", providerConfig = getAiProviderConfig(), fetchImpl = globalThis.fetch, providerExecutor = runProviderFallback } = {}) {
  if (!session || (!EVALUATABLE_STATUSES.has(session.status) && session.status !== "evaluated")) {
    const error = new Error("This test is not ready for evaluation.");
    error.status = 409;
    throw error;
  }
  if (session.status === "evaluated" && session.evaluation) return { evaluationSucceeded: true, evaluation: session.evaluation, reused: true };
  if (session.answerMode === "handwritten" && !clean(answerSheetText, 120_000)) {
    const error = new Error(ANSWER_SHEET_COPY);
    error.status = 400;
    throw error;
  }
  let evaluation;
  if (["mock", "bridge"].includes(providerConfig.requestedMode)) {
    evaluation = buildDeterministicTestEvaluation({ session, answerSheetText });
  } else {
    const result = await providerExecutor({ messages: evaluationMessages({ state, item, session, answerSheetText }), config: providerConfig, fetchImpl, responseMode: "json" });
    if (result.providerFailure || !result.text) return { evaluationSucceeded: false, evaluation: null };
    evaluation = normalizeTestEvaluation(parseJsonObject(result.text), session.testPaper);
  }
  return { evaluationSucceeded: Boolean(evaluation), evaluation: evaluation || null, reused: false };
}

function topicId(title) {
  const slug = clean(title, 120).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "review";
  return `topic_evaluation_${slug}_${randomUUID().slice(0, 8)}`;
}

function masteryForScore(score) {
  return score >= 90 ? "secure" : score >= 80 ? "strong" : score >= 70 ? "developing" : "revision_required";
}

export function applyStudyTestEvaluation({ state, item, session, evaluation, answerSheet = null, now = new Date() } = {}) {
  const timestamp = now.toISOString();
  session.status = "evaluated";
  session.evaluation = evaluation;
  session.evaluatedAt = timestamp;
  session.updatedAt = timestamp;
  if (answerSheet) {
    session.answerSheet = {
      filename: clean(answerSheet.filename, 120),
      mimeType: answerSheet.mimeType,
      sizeBytes: answerSheet.sizeBytes,
      submittedAt: timestamp,
    };
  }
  delete session.answerSheetDraft;
  const queue = item.topic_mastery_queue;
  const testedTopic = queue?.topics?.find((topic) => topic.id === session.parentTopicId) || null;
  const nextTopic = testedTopic ? queue.topics.find((topic) => topic.order > testedTopic.order && topic.status !== "done") : null;
  if (nextTopic) {
    queue.activeTopicId = nextTopic.id;
    item.study_status = "studying";
    item.workflow_status = "in_progress";
  } else {
    item.study_status = "done";
    item.study_completed_at = item.study_completed_at || timestamp;
    item.workflow_status = "completed";
  }
  item.evaluation_completed_at = timestamp;
  item.test_session_id = session.id;
  item.latest_score_percentage = evaluation.percentage;
  item.weak_topics = evaluation.weak_topics;

  state.testResults = state.testResults || [];
  const existingResult = state.testResults.find((result) => result.testSessionId === session.id);
  const resultRecord = {
    id: existingResult?.id || `test_result_${randomUUID()}`,
    userId: state.studentProfile.id,
    testSessionId: session.id,
    courseId: session.courseId || null,
    topicId: session.topicId || null,
    type: "ai_evaluation",
    scorePercent: evaluation.percentage,
    answers: session.answers || {},
    evaluation,
    academicContextIncluded: true,
    createdAt: existingResult?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  if (existingResult) Object.assign(existingResult, resultRecord);
  else state.testResults.push(resultRecord);

  state.topics = state.topics || [];
  const signal = `test evaluation ${Math.round(evaluation.percentage)}%`;
  for (const weakTitle of evaluation.weak_topics) {
    let topic = state.topics.find((candidate) => candidate.courseId === session.courseId && clean(candidate.title, 240).toLowerCase() === weakTitle.toLowerCase());
    if (!topic) {
      topic = {
        id: topicId(weakTitle),
        userId: state.studentProfile.id,
        courseId: session.courseId || null,
        title: weakTitle,
        coverageState: "teaching",
        mastery: "revision_required",
        weakSignals: [],
        sourceMaterialIds: [],
        academicContextIncluded: true,
        source: "studentos_test_evaluation",
        createdAt: timestamp,
      };
      state.topics.push(topic);
    }
    topic.weakSignals = Array.isArray(topic.weakSignals) ? topic.weakSignals : [];
    if (!topic.weakSignals.includes(signal)) topic.weakSignals.push(signal);
    topic.mastery = "revision_required";
    topic.coverageState = topic.coverageState === "uncovered" ? "teaching" : topic.coverageState;
    topic.updatedAt = timestamp;
  }
  const studiedTopic = state.topics.find((topic) => topic.courseId === session.courseId && clean(topic.title, 240).toLowerCase() === clean(session.testPaper.topic, 240).toLowerCase());
  if (studiedTopic && evaluation.percentage >= 70 && !evaluation.weak_topics.some((title) => title.toLowerCase() === clean(studiedTopic.title, 240).toLowerCase())) {
    studiedTopic.coverageState = "covered";
    studiedTopic.mastery = masteryForScore(evaluation.percentage);
    studiedTopic.updatedAt = timestamp;
  }
  return { session, item, resultRecord };
}
