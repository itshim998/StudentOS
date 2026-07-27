import { confidenceLabel, cosineSimilarity, createDeterministicEmbedding } from "../embeddings/embeddingService.js";
import { isAcademicContextRecord } from "../connectors/googleClassroom/mapper.js";
import { isEvidenceDerivedWeakTopic } from "./topicPerformanceService.js";

export const AI_VERBS = Object.freeze(["Ask", "Plan", "Make", "Review"]);
export const MIN_GROUNDING_CONFIDENCE = 0.42;

export const ESSENTIAL_LEARNING_FEATURES = Object.freeze([
  "lucid_teaching",
  "diagrams",
  "tests",
  "topic_mastery",
  "revision_roadmaps",
  "structured_notes",
  "source_grounded_tutoring",
  "practice_generation",
]);

export const CONVENIENCE_FEATURES = Object.freeze([
  "assignment_drafting",
  "assignment_automation_eligibility",
  "extension_decision_support",
]);

const COVERAGE_RANK = {
  uncovered: 0,
  partially_covered: 1,
  covered: 2,
};

const PRIORITY_RANK = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const INSTRUCTIONAL_SOURCE_KINDS = new Set([
  "teacher_note",
  "lecture_note",
  "chapter",
  "uploaded_file_metadata",
  "rubric",
  "worked_example",
]);

const LEARNING_STATE_ARRAYS = [
  "courses",
  "topics",
  "syllabi",
  "exams",
  "assignments",
  "timetable",
  "notes",
  "sourceMaterials",
  "sourceChunks",
  "testSessions",
  "testResults",
  "creditLedger",
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "assignmentAutomationContracts",
  "assignmentLearningFlows",
  "auditLog",
  "aiConversations",
  "aiMessages",
  "memoryItems",
  "embeddingsMetadata",
  "backgroundJobs",
  "jobEvents",
  "billingSubscriptions",
  "billingWebhookEvents",
  "consentVersions",
  "userConsents",
  "legalAcceptances",
  "dataExportRequests",
  "dataExportJobs",
  "accountDeletionRequests",
  "accountDeletionReviews",
  "roleInvitations",
  "classroomItems",
  "recoveryUserStates",
  "academicEvents",
  "academicStateSnapshots",
  "topicRecoveryStates",
  "topicRecoveryStateHistory",
  "recoveryRuns",
  "recoveryPreviews",
  "planVersions",
];

export function normalizeLearningState(state = {}) {
  if (!state || typeof state !== "object") {
    const error = new Error("StudentOS state is unavailable");
    error.status = 500;
    throw error;
  }
  for (const key of LEARNING_STATE_ARRAYS) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  state.studentProfile = state.studentProfile || {
    id: "student_unknown",
    displayName: "",
    preferences: {},
  };
  state.studentProfile.preferences = state.studentProfile.preferences || {};
  for (const topic of state.topics) {
    if (!Array.isArray(topic.weakSignals)) topic.weakSignals = [];
  }
  for (const assignment of state.assignments) {
    if (!Array.isArray(assignment.topicIds)) assignment.topicIds = [];
  }
  return state;
}

export function scoreToCredits(scorePercent) {
  const score = Number(scorePercent);
  if (!Number.isFinite(score)) return 0;
  if (score >= 90) return 3;
  if (score >= 80) return 2;
  if (score >= 70) return 1;
  return 0;
}

export function masteryBand(scorePercent) {
  const score = Number(scorePercent);
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 90) return "secure";
  if (score >= 80) return "strong";
  if (score >= 70) return "developing";
  return "revision_required";
}

function clampScore(scorePercent) {
  const score = Number(scorePercent);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
}

function answerValue(answer) {
  if (answer && typeof answer === "object") {
    return answer.selected ?? answer.answer ?? answer.value ?? "";
  }
  return answer;
}

const LEGACY_SCORE_FORBIDDEN_TOP_LEVEL_FIELDS = new Set([
  "scorePercent",
  "score_percent",
  "answerKey",
  "answer_key",
  "creditsAwarded",
  "credits_awarded",
  "mastery",
  "masteryBand",
  "mastery_band",
  "isCorrect",
  "is_correct",
  "correct",
  "correctAnswer",
  "correct_answer",
  "expectedAnswer",
  "expected_answer",
  "rubric",
  "gradingRubric",
  "grading_rubric",
  "internalEvaluation",
  "internal_evaluation",
]);

const LEGACY_SCORE_FORBIDDEN_ANSWER_FIELDS = new Set([
  "isCorrect",
  "is_correct",
  "correct",
  "correctAnswer",
  "correct_answer",
  "expectedAnswer",
  "expected_answer",
  "answerKey",
  "answer_key",
  "creditsAwarded",
  "credits_awarded",
  "mastery",
  "masteryBand",
  "mastery_band",
  "score",
  "scorePercent",
  "score_percent",
  "marks",
  "awardedMarks",
  "awarded_marks",
  "rubric",
  "gradingRubric",
  "grading_rubric",
  "internalEvaluation",
  "internal_evaluation",
]);

function legacyScoreError(message, status = 400, code = "legacy_test_score_invalid") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function hasOwn(record, key) {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

function assertNoClientAssessmentAuthority(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw legacyScoreError("A test score request must be a JSON object.");
  }
  for (const field of LEGACY_SCORE_FORBIDDEN_TOP_LEVEL_FIELDS) {
    if (hasOwn(payload, field)) {
      throw legacyScoreError(`Client-controlled assessment field is not allowed: ${field}.`, 400, "legacy_test_score_authority_rejected");
    }
  }
  for (const answer of Array.isArray(payload.answers) ? payload.answers : []) {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) continue;
    for (const field of LEGACY_SCORE_FORBIDDEN_ANSWER_FIELDS) {
      if (hasOwn(answer, field)) {
        throw legacyScoreError(`Client-controlled answer field is not allowed: ${field}.`, 400, "legacy_test_score_authority_rejected");
      }
    }
  }
}

function legacyQuestionId(question) {
  return String(question?.id ?? question?.questionId ?? question?.question_id ?? "").trim();
}

function comparableAnswer(value) {
  return String(value ?? "").trim();
}

function serverOwnedAnswerKey(session) {
  const questions = Array.isArray(session?.questions) ? session.questions : [];
  let answerKey = Array.isArray(session?.answerKey) ? session.answerKey : null;
  if (!answerKey && questions.length && questions.every((question) => hasOwn(question, "answer"))) {
    answerKey = questions.map((question) => question.answer);
  }
  if (!questions.length || !answerKey || answerKey.length !== questions.length) {
    throw legacyScoreError("This test does not have a complete server-owned answer key.", 409, "legacy_test_answer_key_unavailable");
  }
  return [...answerKey];
}

function normalizeLegacySubmittedAnswers(session, answers) {
  const questions = Array.isArray(session?.questions) ? session.questions : [];
  const questionIds = questions.map(legacyQuestionId);
  if (!questionIds.length || questionIds.some((questionId) => !questionId) || new Set(questionIds).size !== questionIds.length) {
    throw legacyScoreError("This test has invalid server-owned question identifiers.", 409, "legacy_test_question_set_invalid");
  }
  if (!Array.isArray(answers) || answers.length !== questionIds.length) {
    throw legacyScoreError("Submit exactly one answer for every test question.", 400, "legacy_test_answer_count_mismatch");
  }
  const allowedQuestionIds = new Set(questionIds);
  const answersByQuestionId = new Map();
  for (const answer of answers) {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      throw legacyScoreError("Every submitted answer must include its question id.", 400, "legacy_test_answer_shape_invalid");
    }
    const questionId = String(answer.questionId ?? answer.question_id ?? "").trim();
    if (!questionId || !allowedQuestionIds.has(questionId)) {
      throw legacyScoreError("A submitted answer does not belong to this test.", 400, "legacy_test_question_id_mismatch");
    }
    if (answersByQuestionId.has(questionId)) {
      throw legacyScoreError("Each test question can be answered only once.", 400, "legacy_test_duplicate_question_id");
    }
    const selected = answer.selected ?? answer.answer ?? answer.value ?? "";
    answersByQuestionId.set(questionId, {
      questionId,
      selected: String(selected ?? ""),
    });
  }
  if (answersByQuestionId.size !== questionIds.length) {
    throw legacyScoreError("The submitted question ids do not exactly match this test.", 400, "legacy_test_question_id_mismatch");
  }
  return questionIds.map((questionId) => answersByQuestionId.get(questionId));
}

function legacyAnswerSignature(answers = []) {
  return JSON.stringify((answers || []).map((answer) => ({
    questionId: String(answer?.questionId || ""),
    selected: String(answer?.selected ?? ""),
  })));
}

function buildServerEvaluatedAnswers(session, orderedAnswers, answerKey, topic) {
  return session.questions.map((question, index) => ({
    question: question.prompt || question.question || `Question ${index + 1}`,
    questionId: legacyQuestionId(question),
    selected: orderedAnswers[index].selected,
    correct: answerKey[index],
    concept: question.concept || topic.title,
    isCorrect: comparableAnswer(orderedAnswers[index].selected) === comparableAnswer(answerKey[index]),
  }));
}

export function scoreMcqAnswers({ answers = [], answerKey = [] }) {
  if (!Array.isArray(answers) || !Array.isArray(answerKey) || answers.length === 0 || answers.length !== answerKey.length) return null;
  const correctCount = answers.filter((answer, index) => comparableAnswer(answerValue(answer)) === comparableAnswer(answerKey[index])).length;
  return Math.round((correctCount / answerKey.length) * 100);
}

export function isReasonableExtensionReason(reason) {
  const value = String(reason || "").trim().toLowerCase();
  if (!value) return false;
  return /\b(ill|sick|medical|family|bereavement|emergency|conflict|exam|school event|internet|power|accessibility|religious|travel delay)\b/.test(value);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDate(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function topicTitleSlug(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((part) => part.length >= 4);
}

function keywordTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((part) => part.length >= 4);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function topicById(state, topicId) {
  return state.topics.find((topic) => topic.id === topicId && isAcademicContextRecord(topic)) || null;
}

function courseById(state, courseId) {
  return state.courses.find((course) => course.id === courseId && isAcademicContextRecord(course)) || null;
}

function sourcesForTopic(state, topic) {
  if (!topic) return [];
  return (state.sourceMaterials || []).filter((source) =>
    isAcademicContextRecord(source) && topic.sourceMaterialIds?.includes(source.id));
}

function readySourceMaterials(state) {
  return (state.sourceMaterials || []).filter((source) =>
    isAcademicContextRecord(source) &&
    !source.deletedAt &&
    ["ready", "indexed"].includes(source.status || source.extractionStatus || "ready"));
}

function readySourceChunks(state) {
  return (state.sourceChunks || []).filter((chunk) =>
    !chunk.deletedAt &&
    ["ready", "indexed"].includes(chunk.status || "indexed"));
}

export function getGroundingContext(state, message = "") {
  normalizeLearningState(state);
  const topic = findBestTopicForMessage(state, message);
  const course = courseById(state, topic?.courseId) || state.courses.find(isAcademicContextRecord);
  return { topic, course };
}

export function retrieveGroundedSources({ state, message = "", topic, course, limit = 4 }) {
  const tokens = uniqueStrings([
    ...keywordTokens(message),
    ...keywordTokens(topic?.title || ""),
    ...keywordTokens(course?.title || ""),
    ...(topic?.weakSignals || []).flatMap(keywordTokens),
  ]);
  const scoreText = (value) => {
    const text = String(value || "").toLowerCase();
    return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
  };
  const queryEmbedding = createDeterministicEmbedding([
    message,
    topic?.title || "",
    course?.title || "",
    ...(topic?.weakSignals || []),
  ].join(" "));
  const recencyBoost = (value) => {
    const created = toDate(value);
    if (!created) return 0;
    const ageMs = Date.now() - created.getTime();
    if (ageMs < 0) return 0.5;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (ageDays <= 7) return 1.5;
    if (ageDays <= 30) return 0.75;
    return 0;
  };
  const sourceById = new Map(readySourceMaterials(state).map((source) => [source.id, source]));
  const chunkMatches = readySourceChunks(state)
    .map((chunk) => {
      const source = sourceById.get(chunk.sourceMaterialId);
      const text = [
        chunk.text || chunk.chunkText,
        chunk.citationLabel,
        source?.title,
        source?.filename,
        source?.citationLabel,
        chunk.courseId === course?.id ? course?.title : "",
      ].join(" ");
      const keywordScore = scoreText(text);
      const semanticRaw = Array.isArray(chunk.embeddingVector)
        ? Math.max(0, cosineSimilarity(queryEmbedding, chunk.embeddingVector))
        : 0;
      const courseScore = chunk.courseId === course?.id ? 5 : 0;
      const topicScore = chunk.topicId === topic?.id ? 4 : 0;
      const sourceStatusScore = source?.status === "indexed" ? 1.5 : 0;
      const uploadedScore = source?.sourceType === "uploaded_file" ? 10 : 0;
      const embeddingScore = chunk.embeddingStatus === "embedded" ? 2 : 0;
      const score = keywordScore +
        semanticRaw * 14 +
        courseScore +
        topicScore +
        uploadedScore +
        embeddingScore +
        sourceStatusScore +
        recencyBoost(chunk.createdAt || source?.createdAt);
      const confidenceScore = Math.min(1, (semanticRaw * 0.45) + (Math.min(keywordScore, 4) / 4 * 0.45) + (source?.sourceType === "uploaded_file" ? 0.1 : 0));
      return {
        ...chunk,
        source,
        score,
        keywordScore,
        semanticScore: Number(semanticRaw.toFixed(4)),
        confidenceScore: Number(confidenceScore.toFixed(4)),
        confidenceLabel: confidenceLabel(confidenceScore),
        groundingType: source?.sourceType === "uploaded_file" ? "uploaded_chunk" : "academic_context_chunk",
        snippet: String(chunk.text || chunk.chunkText || "").slice(0, 420),
      };
    })
    .filter((chunk) => chunk.score > 0 && chunk.source && !chunk.source.deletedAt);
  const materialMatches = readySourceMaterials(state)
    .map((source) => {
      const text = [
        source.title,
        source.filename,
        source.citationLabel,
        source.extractedText,
        source.extractionSummary,
        source.courseId === course?.id ? course?.title : "",
        topic?.sourceMaterialIds?.includes(source.id) ? topic?.title : "",
      ].join(" ");
      const score = scoreText(text) + (source.courseId === course?.id ? 2 : 0) + (topic?.sourceMaterialIds?.includes(source.id) ? 3 : 0) + (source.sourceType === "uploaded_file" ? 4 : 0);
      return { ...source, score, groundingType: source.sourceType === "uploaded_file" ? "uploaded_material" : "student_material" };
    })
    .filter((source) => source.score > 0);

  const memoryMatches = (state.memoryItems || [])
    .filter((item) => !item.deletedAt)
    .map((item) => {
      const text = [item.title, item.body, item.courseTitle, ...(item.sourceLabels || [])].join(" ");
      const score = scoreText(text) + (item.courseId === course?.id ? 2 : 0) + (item.topicId === topic?.id ? 3 : 0);
      return { ...item, score, groundingType: "memory_extraction" };
    })
    .filter((item) => item.score > 0);

  const sources = materialMatches
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
  const chunks = chunkMatches
    .filter((chunk) => chunk.confidenceScore >= MIN_GROUNDING_CONFIDENCE)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
  const memories = memoryMatches
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
  const chunkLabels = chunks.map((chunk) => ({
    label: chunk.citationLabel || chunk.source?.citationLabel || chunk.source?.title,
    type: chunk.groundingType,
    sourceId: chunk.sourceMaterialId,
    chunkId: chunk.id,
    snippet: chunk.snippet,
    confidenceLabel: chunk.confidenceLabel,
    confidenceScore: chunk.confidenceScore,
  }));
  const sourceLabels = sources.map((source) => ({
    label: source.citationLabel || source.title,
    type: source.groundingType,
    sourceId: source.id,
  }));
  const memoryLabels = memories.flatMap((item) =>
    (item.sourceLabels || [item.title]).map((label) => ({
      label,
      type: item.groundingType,
      memoryId: item.id,
    })));
  const fallbackConfidence = (sources.length || memories.length) ? 0.5 : 0;
  const bestConfidence = chunks[0]?.confidenceScore ?? fallbackConfidence;
  return {
    chunks,
    sources,
    memories,
    labels: [...chunkLabels, ...sourceLabels, ...memoryLabels]
      .filter((item, index, items) => item.label && items.findIndex((other) => other.type === item.type && other.label === item.label) === index),
    hasUploadedMaterial: chunks.some((chunk) => chunk.source?.sourceType === "uploaded_file") || sources.some((source) => source.sourceType === "uploaded_file") || memories.some((item) => item.kind === "source_extraction"),
    retrievalMode: chunks.some((chunk) => chunk.embeddingStatus === "embedded") ? "local-json" : "keyword-fallback",
    confidence: {
      score: Number(bestConfidence.toFixed(4)),
      label: confidenceLabel(bestConfidence),
      lowConfidence: bestConfidence < MIN_GROUNDING_CONFIDENCE,
      semanticAvailable: chunks.some((chunk) => chunk.embeddingStatus === "embedded"),
    },
  };
}

function latestTestForTopic(state, topicId) {
  return [...(state.testResults || [])]
    .filter((result) => result.topicId === topicId)
    .sort((left, right) => Date.parse(right.completedAt || "") - Date.parse(left.completedAt || ""))[0] || null;
}

export function createEmptyStudentState({ userId = "student_unknown", displayName = "", email = null } = {}) {
  return {
    studentProfile: {
      id: userId,
      displayName,
      email,
      gradeBand: null,
      schoolSystem: null,
      timezone: null,
      disciplineIndex: null,
      learningAdaptivityScore: null,
      preferences: {},
      visibility: {
        defaultAudience: "student_only",
        externalProgressSharing: false,
      },
    },
    ...Object.fromEntries(LEARNING_STATE_ARRAYS.map((key) => [key, []])),
  };
}

export function getCreditBalance(state) {
  return state.creditLedger.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

export function getSafeStudentProfile(profile, creditBalance = 0) {
  const disciplineIndex = Number(profile?.disciplineIndex);
  const hasStudyRhythm = profile?.disciplineIndex !== null &&
    profile?.disciplineIndex !== undefined &&
    Number.isFinite(disciplineIndex);
  const {
    legacyWeakTopicsText,
    weakTopicsText,
    weakTopicIds,
    ...safePreferences
  } = profile?.preferences || {};
  return {
    id: profile?.id || "student_unknown",
    displayName: profile?.displayName || "",
    gradeBand: profile?.gradeBand || null,
    schoolSystem: profile?.schoolSystem || null,
    timezone: profile?.timezone || null,
    studyRhythm: hasStudyRhythm ? (disciplineIndex >= 80 ? "steady" : disciplineIndex >= 60 ? "building" : "needs support") : null,
    convenienceEligibility: creditBalance > 0 ? "credits available" : "earn credits through tests",
    learningCalibrationVisible: false,
    preferences: safePreferences,
    visibility: profile?.visibility || {},
  };
}

export function daysUntilCourseExam(course, now = new Date()) {
  const examDate = toDate(course?.examDate);
  if (!examDate) return null;
  const diff = examDate.getTime() - now.getTime();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function examPressureForCourse(course, now = new Date()) {
  const days = daysUntilCourseExam(course, now);
  if (days === null) return "none";
  if (days <= 2) return "critical";
  if (days <= 7) return "high";
  if (days <= 14) return "medium";
  return "low";
}

export function determineTopicCoverage(state, topicOrId) {
  const topic = typeof topicOrId === "string" ? topicById(state, topicOrId) : topicOrId;
  if (!topic) {
    return {
      status: "uncovered",
      confidence: 0,
      reasons: ["topic_not_found"],
      sourceLabels: [],
      latestScore: null,
    };
  }

  const sources = sourcesForTopic(state, topic);
  const instructionalSources = sources.filter((source) => INSTRUCTIONAL_SOURCE_KINDS.has(source.kind));
  const latestTest = latestTestForTopic(state, topic.id);
  const latestScore = latestTest ? Number(latestTest.scorePercent) : null;
  const reasons = [];

  if (topic.coverageState === "covered") reasons.push("marked_covered");
  if (topic.coverageState === "teaching") reasons.push("in_class_teaching");
  if (instructionalSources.length > 0) reasons.push("instructional_material_available");
  if (latestScore !== null) reasons.push(`latest_test_${latestScore}`);
  if (isEvidenceDerivedWeakTopic(topic)) reasons.push("assessment_recovery_required");

  let status = "uncovered";
  if (
    topic.coverageState === "covered" ||
    ["developing", "strong", "secure"].includes(topic.mastery) ||
    (latestScore !== null && latestScore >= 70)
  ) {
    status = "covered";
  } else if (
    topic.coverageState === "teaching" ||
    instructionalSources.length > 0 ||
    (latestScore !== null && latestScore > 0) ||
    isEvidenceDerivedWeakTopic(topic)
  ) {
    status = "partially_covered";
  }

  const confidence = Math.min(
    0.95,
    0.35 +
      (topic.coverageState === "covered" ? 0.28 : 0) +
      (instructionalSources.length > 0 ? 0.18 : 0) +
      (latestScore !== null ? 0.16 : 0) +
      (["strong", "secure"].includes(topic.mastery) ? 0.12 : 0),
  );

  return {
    topicId: topic.id,
    title: topic.title,
    status,
    confidence,
    reasons,
    latestScore,
    mastery: topic.mastery,
    weakSignals: topic.weakSignals || [],
    sourceLabels: sources.map((source) => source.citationLabel || source.title),
  };
}

export function determineAssignmentCoverage(state, assignmentOrId) {
  normalizeLearningState(state);
  const assignment = typeof assignmentOrId === "string"
    ? state.assignments.find((item) => item.id === assignmentOrId && isAcademicContextRecord(item))
    : assignmentOrId;
  if (!assignment || !isAcademicContextRecord(assignment)) {
    return {
      status: "uncovered",
      confidence: 0,
      topicCoverages: [],
      summary: "Assignment not found.",
    };
  }

  const topicCoverages = (assignment.topicIds || []).map((topicId) => determineTopicCoverage(state, topicId));
  if (topicCoverages.length === 0) {
    return {
      assignmentId: assignment.id,
      status: "uncovered",
      confidence: 0,
      topicCoverages: [],
      summary: "Needs a mastery roadmap item before testing.",
    };
  }
  const lowestRank = topicCoverages.reduce(
    (rank, coverage) => Math.min(rank, COVERAGE_RANK[coverage.status] ?? 0),
    2,
  );
  const highestRank = topicCoverages.reduce(
    (rank, coverage) => Math.max(rank, COVERAGE_RANK[coverage.status] ?? 0),
    0,
  );
  const status = lowestRank === 2 ? "covered" : highestRank === 0 ? "uncovered" : "partially_covered";
  const confidence = topicCoverages.length
    ? topicCoverages.reduce((sum, coverage) => sum + coverage.confidence, 0) / topicCoverages.length
    : 0;

  const summaryByStatus = {
    covered: "Ready to convert into a practice test before any drafting support.",
    partially_covered: "Needs quick revision before testing.",
    uncovered: "Needs a mastery roadmap item before testing.",
  };

  return {
    assignmentId: assignment.id,
    status,
    confidence,
    topicCoverages,
    summary: summaryByStatus[status],
  };
}

export function getAssignmentInsights(state) {
  normalizeLearningState(state);
  return state.assignments.filter((assignment) =>
    isAcademicContextRecord(assignment) &&
    assignment.handedIn !== true &&
    !["completed", "done", "graded", "returned", "submitted"].includes(String(assignment.status || "").toLowerCase()))
    .map((assignment) => ({
    assignmentId: assignment.id,
    ...determineAssignmentCoverage(state, assignment),
  }));
}

function buildMcqQuestionsForTopic(topic, count = 5) {
  const title = topic?.title || "the topic";
  return Array.from({ length: count }, (_, index) => ({
    id: `q_${topic?.id || "topic"}_${index + 1}`,
    type: "mcq",
    prompt: `Check ${index + 1}: choose the best statement about ${title}.`,
    choices: ["Core definition", "Worked example", "Common trap", "Exam shortcut"],
    answer: index % 2 === 0 ? "Core definition" : "Worked example",
  }));
}

export function createPracticeTestSession({ state, assignment, coverage }) {
  normalizeLearningState(state);
  const primaryTopic = topicById(state, assignment.topicIds?.[0]) || state.topics[0];
  const questions = buildMcqQuestionsForTopic(primaryTopic, coverage.status === "covered" ? 8 : 5);
  const session = {
    id: `session_${assignment.id}_${Date.now()}`,
    studentId: state.studentProfile.id,
    assignmentId: assignment.id,
    courseId: assignment.courseId,
    topicId: primaryTopic.id,
    questionFormat: "mcq",
    status: "open",
    coverageStatus: coverage.status,
    questions,
    answerKey: questions.map((question) => question.answer),
    createdAt: new Date().toISOString(),
  };
  state.testSessions.push(session);
  return session;
}

export function publicLegacyPracticeTestSession(session) {
  if (!session) return null;
  const projected = structuredClone(session);
  delete projected.answerKey;
  delete projected.answer_key;
  delete projected.scoreSettlement;
  delete projected.settledAnswerSignature;
  delete projected.internalEvaluation;
  projected.questions = (projected.questions || []).map((question) => {
    const {
      answer,
      answerKey,
      answer_key,
      correct,
      correctAnswer,
      correct_answer,
      expectedAnswer,
      expected_answer,
      modelAnswer,
      model_answer,
      solution,
      solutions,
      rubric,
      gradingRubric,
      grading_rubric,
      hiddenSolution,
      hiddenSolutions,
      hidden_solution,
      hidden_solutions,
      referenceAnswer,
      reference_answer,
      modelSolution,
      model_solution,
      markingScheme,
      marking_scheme,
      isCorrect,
      is_correct,
      ...safeQuestion
    } = question || {};
    return safeQuestion;
  });
  return projected;
}

export function queueRoadmapItem(state, item) {
  normalizeLearningState(state);
  const existing = state.roadmap.find((roadmapItem) =>
    roadmapItem.topicId === item.topicId &&
    roadmapItem.kind === item.kind &&
    roadmapItem.status === "open" &&
    roadmapItem.title === item.title
  );
  if (existing) return existing;
  state.roadmap.push(item);
  return item;
}

export function createRoadmapItemForAssignmentFlow({ assignment, topic, course, coverage }) {
  const pressure = examPressureForCourse(course);
  const tomorrow = addDays(new Date(), 1).toISOString();
  const titleByCoverage = {
    covered: `Practice test for ${assignment.title}`,
    partially_covered: `Quick revision then test: ${topic.title}`,
    uncovered: `Master ${topic.title} before testing`,
  };
  const kindByCoverage = {
    covered: "practice_test",
    partially_covered: "revision_then_test",
    uncovered: "mastering_new_topic",
  };
  const priorityByCoverage = {
    covered: pressure === "critical" ? "high" : "medium",
    partially_covered: pressure === "low" ? "medium" : "high",
    uncovered: pressure === "low" ? "high" : "urgent",
  };

  return {
    id: `road_${assignment.id}_${coverage.status}_${Date.now()}`,
    courseId: assignment.courseId,
    topicId: topic.id,
    title: titleByCoverage[coverage.status],
    kind: kindByCoverage[coverage.status],
    priority: priorityByCoverage[coverage.status],
    dueAt: tomorrow,
    status: "open",
    examPressure: pressure,
  };
}

export function createRevisionEventForTopic({ courseId, topicId, reason }) {
  return {
    id: `rev_${topicId}_${Date.now()}`,
    courseId,
    topicId,
    scheduledAt: addDays(new Date(), 1).toISOString(),
    reason,
  };
}

export function createTutorLesson({ course, topic, sources = [], trigger = "general", coverageStatus = "partially_covered", wrongConcepts = [] }) {
  const sourceLabels = sources.map((source) => source.citationLabel || source.title);
  const days = daysUntilCourseExam(course);
  const style = days <= 3
    ? "exam-compressed: fast concept, one worked example, immediate MCQ check"
    : days <= 7
      ? "exam-aware: concise explanation plus timed practice"
      : "calm mastery: concept-first explanation and spaced practice";
  const weakSignals = uniqueStrings([...(topic.weakSignals || []), ...wrongConcepts]);

  return {
    id: `lesson_${topic.id}_${Date.now()}`,
    courseId: course.id,
    topicId: topic.id,
    title: coverageStatus === "uncovered" ? `Master ${topic.title}` : `Repair ${topic.title}`,
    mode: coverageStatus === "uncovered" ? "teach_then_mastery_check" : "targeted_correction",
    trigger,
    sourceLabels,
    conceptExplanation: `Start with the core idea of ${topic.title}, then connect it to one exam-style example before testing.`,
    diagram: [
      "flowchart TD",
      `  A[Source: ${sourceLabels[0] || "student material"}] --> B[Key idea]`,
      "  B --> C[Worked example]",
      "  C --> D[MCQ check]",
      "  D --> E[24h revision]",
    ].join("\n"),
    commonMistakes: weakSignals.length > 0
      ? weakSignals.map((signal) => `Watch for ${signal}.`)
      : [`Do not skip the definition step for ${topic.title}.`, "Check units, labels, and final wording."],
    practicePrompts: [
      `Explain ${topic.title} in three lines.`,
      `Solve one easy MCQ on ${topic.title}.`,
      `Write one mistake you will avoid in the exam.`,
    ],
    examAdjustedStyle: style,
    steps: coverageStatus === "uncovered"
      ? ["Teach from source", "Build structured notes", "Run MCQ mastery check", "Schedule revision within 24 hours"]
      : ["Review weak signals", "Correct mistakes", "Run focused MCQ retest", "Schedule 24-hour revision"],
    createdAt: new Date().toISOString(),
  };
}

export function handleAssignmentLearningFlow(state, assignmentId) {
  normalizeLearningState(state);
  const assignment = state.assignments.find((item) => item.id === assignmentId && isAcademicContextRecord(item));
  if (!assignment) {
    const error = new Error("Assignment not found");
    error.status = 404;
    throw error;
  }

  let course = courseById(state, assignment.courseId) || state.courses[0];
  if (!course) {
    course = {
      id: assignment.courseId || `course_${assignment.id}_unmapped`,
      title: "Imported course",
      teacher: "StudentOS",
      examDate: null,
      source: assignment.source || "studentos",
    };
    state.courses.push(course);
  }
  assignment.courseId = assignment.courseId || course.id;
  const topics = (assignment.topicIds || []).map((topicId) => topicById(state, topicId)).filter(Boolean);
  let primaryTopic = topics[0] || state.topics.find((topic) => topic.courseId === course.id) || state.topics[0];
  if (!primaryTopic) {
    primaryTopic = {
      id: `topic_${assignment.id}_imported`,
      courseId: course.id,
      title: assignment.title || "Imported assignment topic",
      mastery: "new",
      coverageState: "uncovered",
      weakSignals: [],
      source: assignment.source || "studentos",
    };
    state.topics.push(primaryTopic);
  }
  if (!assignment.topicIds.includes(primaryTopic.id)) {
    assignment.topicIds = [primaryTopic.id, ...assignment.topicIds].filter(Boolean);
  }
  const coverage = determineAssignmentCoverage(state, assignment);
  const sources = sourcesForTopic(state, primaryTopic);
  const roadmapItem = queueRoadmapItem(
    state,
    createRoadmapItemForAssignmentFlow({ assignment, topic: primaryTopic, course, coverage }),
  );
  const lesson = createTutorLesson({
    course,
    topic: primaryTopic,
    sources,
    trigger: "assignment_flow",
    coverageStatus: coverage.status,
  });
  state.tutorLessons.push(lesson);

  let testSession = null;
  let nextAction = "";
  if (coverage.status === "covered") {
    testSession = createPracticeTestSession({ state, assignment, coverage });
    nextAction = "Take the practice test, review corrections, then decide whether drafting support is appropriate.";
  } else if (coverage.status === "partially_covered") {
    testSession = createPracticeTestSession({ state, assignment, coverage });
    nextAction = "Do quick revision first, then take the shorter practice test.";
  } else {
    nextAction = "Complete the mastery lesson before any test or drafting workflow.";
  }

  const flow = {
    id: `flow_${assignment.id}_${Date.now()}`,
    assignmentId: assignment.id,
    coverage,
    action: coverage.status === "covered"
      ? "practice_test"
      : coverage.status === "partially_covered"
        ? "quick_revision_then_test"
        : "mastery_roadmap_before_test",
    testSession: publicLegacyPracticeTestSession(testSession),
    roadmapItem,
    lesson,
    nextAction,
    realSubmissionAllowed: false,
    studentReviewRequired: true,
    createdAt: new Date().toISOString(),
  };
  flow.coverage.topicCoverages = Array.isArray(flow.coverage.topicCoverages) ? flow.coverage.topicCoverages : [];
  flow.lesson.sourceLabels = Array.isArray(flow.lesson.sourceLabels) ? flow.lesson.sourceLabels : [];
  if (flow.testSession) {
    flow.testSession.questions = Array.isArray(flow.testSession.questions) ? flow.testSession.questions : [];
  }
  state.assignmentLearningFlows.push(flow);
  state.auditLog.push({
    id: `audit_${flow.id}`,
    actorId: state.studentProfile.id,
    action: "assignment_learning_flow.created",
    targetType: "assignment",
    targetId: assignment.id,
    riskLevel: "medium",
    createdAt: new Date().toISOString(),
  });
  return flow;
}

export function createTestResult({ studentId, courseId, topicId, testSessionId, type = "mcq", answers = [], answerKey = [] }) {
  if (type !== "mcq") {
    throw legacyScoreError("The legacy score endpoint supports server-owned MCQ sessions only.", 409, "legacy_test_type_unsupported");
  }
  const derivedScore = scoreMcqAnswers({ answers, answerKey });
  if (derivedScore === null) {
    throw legacyScoreError("The submitted answers could not be scored against the server-owned test.", 400, "legacy_test_score_unavailable");
  }
  const safeSessionId = String(testSessionId || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
  const id = safeSessionId
    ? `test_${safeSessionId}`
    : `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    studentId,
    courseId,
    topicId,
    testSessionId: testSessionId || null,
    type,
    scorePercent: derivedScore,
    masteryBand: masteryBand(derivedScore),
    creditsAwarded: scoreToCredits(derivedScore),
    answers: answers.map((answer) => ({
      questionId: String(answer.questionId || ""),
      selected: String(answer.selected ?? ""),
    })),
    completedAt: new Date().toISOString(),
  };
}

export function createCreditLedgerEntry(testResult) {
  if (!testResult.creditsAwarded) return null;
  return {
    id: `credit_${testResult.id}`,
    studentId: testResult.studentId,
    sourceType: "test_result",
    sourceId: testResult.id,
    amount: testResult.creditsAwarded,
    reason: `${testResult.type.toUpperCase()} score ${testResult.scorePercent}% awarded ${testResult.creditsAwarded} convenience credit(s).`,
    createdAt: new Date().toISOString(),
  };
}

export function createCorrectionSheet({ topic, answers = [], scorePercent }) {
  const explicitWrongAnswers = answers.filter((answer) => answer && answer.isCorrect === false);
  const keyedWrongAnswers = answers
    .filter((answer) =>
      answer &&
      typeof answer === "object" &&
      answer.isCorrect !== false &&
      answer.correct &&
      answerValue(answer) !== answer.correct)
    .map((answer) => ({
      question: answer.question,
      selected: answerValue(answer),
      correct: answer.correct,
      concept: answer.concept,
    }));
  const wrongAnswers = explicitWrongAnswers.concat(keyedWrongAnswers);
  const generatedWrongAnswers = wrongAnswers.length > 0
    ? wrongAnswers
    : scorePercent >= 90
      ? []
      : [
          {
            question: `Core check on ${topic.title}`,
            selected: "Unclear setup",
            correct: "Start from the definition and identify the known values.",
            concept: topic.weakSignals?.[0] || topic.title,
          },
        ];

  const corrections = generatedWrongAnswers.map((answer, index) => ({
    id: `correction_${topic.id}_${index + 1}`,
    question: answer.question || `Question ${index + 1}`,
    selected: answer.selected || "No answer recorded",
    correct: answer.correct || "Review the solution using your materials.",
    concept: answer.concept || topic.weakSignals?.[index] || topic.title,
    repair: `Review ${answer.concept || topic.title}, then solve one near-identical MCQ without notes.`,
  }));

  return {
    topicId: topic.id,
    topicTitle: topic.title,
    corrections,
    weakTopics: uniqueStrings(corrections.map((item) => item.concept).concat(scorePercent < 70 ? ["mastery foundation"] : [])),
  };
}

export function createRevisionRoadmapItem({ testResult, topicTitle, assessmentEvidenceAvailable = false }) {
  const due = addDays(new Date(), 1).toISOString();
  if (testResult.scorePercent >= 70 || !assessmentEvidenceAvailable) {
    return {
      id: `road_followup_${testResult.id}`,
      courseId: testResult.courseId,
      topicId: testResult.topicId,
      title: `Review mistakes for ${topicTitle}`,
      kind: "corrections",
      priority: testResult.scorePercent >= 90 ? "low" : "medium",
      dueAt: due,
      status: "open",
    };
  }
  return {
    id: `road_repair_${testResult.id}`,
    courseId: testResult.courseId,
    topicId: testResult.topicId,
    title: `Immediate mastery repair for ${topicTitle}`,
    kind: "weak_topic_recovery",
    priority: "urgent",
    dueAt: due,
    status: "open",
  };
}

function legacyScoreResponse(state, { session, result, topic, orderedAnswers, answerKey, replayed }) {
  const evaluatedAnswers = buildServerEvaluatedAnswers(session, orderedAnswers, answerKey, topic);
  const correctionSheet = createCorrectionSheet({
    topic,
    answers: evaluatedAnswers,
    scorePercent: result.scorePercent,
  });
  const creditEntry = state.creditLedger.find((entry) => entry.sourceId === result.id) || null;
  const roadmapItem = state.roadmap.find((item) => item.sourceTestResultId === result.id || item.id === `road_followup_${result.id}` || item.id === `road_repair_${result.id}`) || null;
  const revisionEvent = state.revisionEvents.find((item) => item.sourceTestResultId === result.id || item.id === `rev_${result.id}`) || null;
  const lesson = state.tutorLessons.find((item) => item.sourceTestResultId === result.id || item.id === `lesson_${result.id}`) || null;
  const scoreSummary = result.scorePercent >= 90
    ? "Mastery is secure. Credits unlocked for convenience workflows."
    : result.scorePercent >= 70
      ? "Good enough to earn credits, but corrections should be reviewed today."
      : "No credits yet. Review the corrections, then complete a StudentOS test to update topic readiness.";
  const nextRecommendedAction = result.scorePercent < 70
    ? "Open the tutor lesson, review the corrections, then complete a StudentOS test."
    : "Review the correction sheet, then do one 24-hour revision check.";
  return {
    id: result.id,
    testResult: result,
    result,
    replayed,
    scoreSummary,
    creditEntry,
    correctionSheet,
    weakTopics: [],
    roadmapItem,
    revisionEvent,
    tutorLesson: lesson,
    nextRecommendedAction,
    creditBalance: getCreditBalance(state),
  };
}

export function applyTestScore(state, payload = {}) {
  normalizeLearningState(state);
  assertNoClientAssessmentAuthority(payload);
  const testSessionId = String(payload.testSessionId || "").trim();
  if (!testSessionId) {
    throw legacyScoreError("An existing StudentOS test session is required.", 400, "legacy_test_session_required");
  }
  const session = state.testSessions.find((testSession) => testSession.id === testSessionId);
  if (!session) {
    throw legacyScoreError("This StudentOS test session was not found.", 404, "legacy_test_session_not_found");
  }
  const ownerId = session.userId || session.studentId || session.user_id || session.student_id || null;
  if (ownerId && state.studentProfile?.id && ownerId !== state.studentProfile.id) {
    throw legacyScoreError("This test session does not belong to the current account.", 403, "legacy_test_session_forbidden");
  }
  if ((session.questionFormat || session.type || "mcq") !== "mcq") {
    throw legacyScoreError("This test must use its dedicated evaluation flow.", 409, "legacy_test_type_unsupported");
  }
  const answerKey = serverOwnedAnswerKey(session);
  const orderedAnswers = normalizeLegacySubmittedAnswers(session, payload.answers);
  const signature = legacyAnswerSignature(orderedAnswers);
  const deterministicResultId = `test_${String(session.id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180)}`;
  const existingResult = state.testResults.find((result) => result.testSessionId === session.id || result.id === deterministicResultId) || null;
  if (existingResult) {
    const settledSignature = session.settledAnswerSignature || legacyAnswerSignature(existingResult.answers || []);
    if (settledSignature !== signature) {
      throw legacyScoreError("This test has already been scored and its answers cannot be changed.", 409, "legacy_test_already_settled");
    }
    const replayTopic = topicById(state, existingResult.topicId || session.topicId);
    if (!replayTopic) {
      throw legacyScoreError("This scored test is missing its server-owned academic mapping.", 409, "legacy_test_mapping_unavailable");
    }
    return legacyScoreResponse(state, {
      session,
      result: existingResult,
      topic: replayTopic,
      orderedAnswers,
      answerKey,
      replayed: true,
    });
  }
  if (session.status !== "open") {
    throw legacyScoreError("This test session is not open for scoring.", 409, "legacy_test_session_not_open");
  }
  const topic = topicById(state, session.topicId);
  const course = topic ? courseById(state, session.courseId || topic.courseId) : null;
  if (!topic || !course) {
    throw legacyScoreError("This test is missing its server-owned academic mapping.", 409, "legacy_test_mapping_unavailable");
  }
  const result = createTestResult({
    studentId: state.studentProfile.id,
    courseId: course.id,
    topicId: topic.id,
    testSessionId: session.id,
    type: "mcq",
    answers: orderedAnswers,
    answerKey,
  });
  const evaluatedAnswers = buildServerEvaluatedAnswers(session, orderedAnswers, answerKey, topic);
  const creditEntry = createCreditLedgerEntry(result);
  const correctionSheet = createCorrectionSheet({
    topic,
    answers: evaluatedAnswers,
    scorePercent: result.scorePercent,
  });
  const roadmapItem = createRevisionRoadmapItem({
    testResult: result,
    topicTitle: topic.title,
    assessmentEvidenceAvailable: true,
  });
  roadmapItem.sourceTestResultId = result.id;
  const revisionEvent = createRevisionEventForTopic({
    courseId: result.courseId,
    topicId: result.topicId,
    reason: result.scorePercent < 70
      ? "Immediate revision queued after score below 70%."
      : "Spaced revision within 24 hours after test corrections.",
  });
  revisionEvent.id = `rev_${result.id}`;
  revisionEvent.sourceTestResultId = result.id;
  const lesson = createTutorLesson({
    course,
    topic,
    sources: sourcesForTopic(state, topic),
    trigger: "test_result",
    coverageStatus: result.scorePercent < 70 ? "partially_covered" : "covered",
    wrongConcepts: correctionSheet.weakTopics,
  });
  lesson.id = `lesson_${result.id}`;
  lesson.sourceTestResultId = result.id;

  if (!state.testResults.some((item) => item.id === result.id)) state.testResults.push(result);
  if (creditEntry && !state.creditLedger.some((item) => item.id === creditEntry.id)) state.creditLedger.push(creditEntry);
  if (!state.roadmap.some((item) => item.id === roadmapItem.id)) state.roadmap.push(roadmapItem);
  if (!state.revisionEvents.some((item) => item.id === revisionEvent.id)) state.revisionEvents.push(revisionEvent);
  if (!state.tutorLessons.some((item) => item.id === lesson.id)) state.tutorLessons.push(lesson);

  const completedAt = result.completedAt;
  session.status = "completed";
  session.completedAt = completedAt;
  session.updatedAt = completedAt;
  session.resultId = result.id;
  session.settlementVersion = 2;
  session.settledAnswerSignature = signature;

  return legacyScoreResponse(state, {
    session,
    result,
    topic,
    orderedAnswers,
    answerKey,
    replayed: false,
  });
}

export function createAssignmentAutomationContract({ assignment, course, topics, creditBalance }) {
  const requiredCredits = 1;
  const coverage = topics.map((topic) => ({
    topicId: topic.id,
    status: topic.coverageState === "covered" || ["developing", "strong", "secure"].includes(topic.mastery)
      ? "covered"
      : topic.coverageState === "teaching"
        ? "partially_covered"
        : "uncovered",
  }));
  const coveredTopics = topics.filter((topic) => {
    const snapshot = coverage.find((item) => item.topicId === topic.id);
    return snapshot?.status === "covered";
  });
  const uncoveredTopics = topics.filter((topic) => topic.coverageState !== "covered");
  const eligible = creditBalance >= requiredCredits && uncoveredTopics.length === 0;

  return {
    id: `contract_${assignment.id}_${Date.now()}`,
    assignmentId: assignment.id,
    courseId: course.id,
    status: eligible ? "eligible_for_draft" : "learning_required_first",
    requiredCredits,
    availableCredits: creditBalance,
    coveredTopicIds: coveredTopics.map((topic) => topic.id),
    uncoveredTopicIds: uncoveredTopics.map((topic) => topic.id),
    coverageSnapshot: coverage,
    allowedActions: eligible
      ? ["fetch_context", "understand_requirements", "create_draft", "create_learning_plan", "prepare_student_review_checklist"]
      : ["fetch_context", "understand_requirements", "teach_uncovered_topics", "create_learning_plan", "prepare_mastery_test"],
    blockedActions: ["silent_submission", "classroom_posting", "email_sending", "impersonating_student", "bypassing_student_review"],
    studentReviewRequired: true,
    realSubmissionAllowed: false,
    rationale: eligible
      ? "Credits unlock drafting support, but StudentOS still requires student review and never submits in Pass 2."
      : "Convenience drafting waits until topic coverage and at least one earned credit are present.",
    createdAt: new Date().toISOString(),
  };
}

export function createAssignmentAutomationContractForState({ state, assignment, course, topics, creditBalance }) {
  const requiredCredits = 1;
  const topicCoverages = topics.map((topic) => determineTopicCoverage(state, topic));
  const coveredTopics = topicCoverages.filter((coverage) => coverage.status === "covered");
  const uncoveredTopics = topicCoverages.filter((coverage) => coverage.status !== "covered");
  const eligible = creditBalance >= requiredCredits && uncoveredTopics.length === 0;
  return {
    id: `contract_${assignment.id}_${Date.now()}`,
    assignmentId: assignment.id,
    courseId: course.id,
    status: eligible ? "eligible_for_draft" : "learning_required_first",
    requiredCredits,
    availableCredits: creditBalance,
    coveredTopicIds: coveredTopics.map((coverage) => coverage.topicId),
    uncoveredTopicIds: uncoveredTopics.map((coverage) => coverage.topicId),
    coverageSnapshot: topicCoverages.map((coverage) => ({ topicId: coverage.topicId, status: coverage.status })),
    allowedActions: eligible
      ? ["fetch_context", "understand_requirements", "create_draft", "create_learning_plan", "prepare_student_review_checklist"]
      : ["fetch_context", "understand_requirements", "teach_uncovered_topics", "create_learning_plan", "prepare_mastery_test"],
    blockedActions: ["silent_submission", "classroom_posting", "email_sending", "impersonating_student", "bypassing_student_review"],
    studentReviewRequired: true,
    realSubmissionAllowed: false,
    rationale: eligible
      ? "Credits unlock drafting support, but StudentOS still requires student review and never submits in Pass 2."
      : "Convenience drafting waits until topic coverage and at least one earned credit are present.",
    createdAt: new Date().toISOString(),
  };
}

export function buildExtensionDecisionDraft({ profile, assignment, reason }) {
  const reasonable = isReasonableExtensionReason(reason);
  const disciplineOk = Number(profile.disciplineIndex || 0) >= 80;
  const recommendation = disciplineOk && reasonable ? "support_reasonable_extension" : "needs_manual_review";
  return {
    id: `extension_${assignment.id}_${Date.now()}`,
    assignmentId: assignment.id,
    recommendation,
    canAutoSend: false,
    canPostToClassroom: false,
    disciplineIndexUsedInternally: true,
    explanation: recommendation === "support_reasonable_extension"
      ? "Draft support is reasonable because the student has a steady study rhythm and the stated reason appears valid."
      : "StudentOS should not approve this automatically. Keep it as a draft for student or teacher review.",
    draftMessage: `I am requesting a short extension for ${assignment.title}. Reason: ${String(reason || "personal circumstances").trim()}. I understand the requirements and will submit the completed work after review.`,
    safeguards: ["student_review_required", "no_auto_send", "no_classroom_posting", "teacher_decides"],
  };
}

function findBestTopicForMessage(state, message) {
  const lower = String(message || "").toLowerCase();
  const matchedTopic = state.topics.filter(isAcademicContextRecord).find((topic) => {
    const words = topicTitleSlug(topic.title);
    return words.some((word) => lower.includes(word));
  });
  if (matchedTopic) return matchedTopic;
  const matchedAssignment = state.assignments.filter(isAcademicContextRecord).find((assignment) =>
    topicTitleSlug(assignment.title).some((word) => lower.includes(word)));
  const assignmentTopic = topicById(state, matchedAssignment?.topicIds?.[0]);
  if (assignmentTopic) return assignmentTopic;
  const matchedCourse = state.courses.filter(isAcademicContextRecord).find((course) =>
    topicTitleSlug(course.title).some((word) => lower.includes(word)));
  return matchedCourse
    ? state.topics.filter(isAcademicContextRecord).find((topic) => topic.courseId === matchedCourse.id) || null
    : null;
}

export function buildStudyPlan(state, topic) {
  const course = courseById(state, topic.courseId) || state.courses.find(isAcademicContextRecord);
  const pressure = examPressureForCourse(course);
  const preferences = state.studentProfile?.preferences || {};
  const weakTopics = state.topics.filter(isAcademicContextRecord)
    .filter((item) => item.courseId === course.id && isEvidenceDerivedWeakTopic(item))
    .slice(0, 4);
  const dueWork = state.assignments.filter(isAcademicContextRecord)
    .filter((assignment) => assignment.courseId === course.id)
    .sort((left, right) => Date.parse(left.dueDate || "") - Date.parse(right.dueDate || ""))
    .slice(0, 3);
  const timetableBlocks = (state.timetable || [])
    .filter((item) => item.courseId === course.id)
    .slice(0, 3);

  return {
    courseId: course.id,
    pressure,
    daysUntilExam: daysUntilCourseExam(course),
    academicGoal: preferences.academicGoal || "",
    dailyStudyAvailabilityMinutes: preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || null,
    studyBreakPattern: preferences.studyBreakPattern || "",
    timetableBlocks: timetableBlocks.map((item) => ({
      title: item.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    })),
    blocks: [
      `Start with ${topic.title} source recap for ${Math.min(25, preferences.breakCycleMinutes || 25)} minutes.`,
      weakTopics.length ? `Repair weak topics: ${weakTopics.map((item) => item.title).join(", ")}.` : "Run a timed mixed-topic check.",
      dueWork.length ? `Protect due work: ${dueWork.map((item) => item.title).join(", ")}.` : "Use the extra time for spaced revision.",
      timetableBlocks.length ? `Fit this around: ${timetableBlocks.map((item) => item.title).join(", ")}.` : (preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes ? `Use ${preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes} available study minutes.` : "Add your study availability in Setup."),
      "End with a 5-minute correction note and schedule 24-hour revision.",
    ],
  };
}

export function buildMakeArtifacts(state, topic, { flashcardsEnabled = true } = {}) {
  const sources = sourcesForTopic(state, topic);
  return {
    notes: [
      `Definition: write the smallest reliable definition for ${topic.title}.`,
      "Method: list the steps you can repeat under exam pressure.",
      "Example: keep one solved example from your teacher/source material.",
      "Mistake guard: add one trap from your correction sheet.",
    ],
    flashcards: flashcardsEnabled ? [
      { front: `What is the core idea of ${topic.title}?`, back: "Answer from source material in one sentence." },
      { front: "What is the most common mistake?", back: topic.weakSignals?.[0] || "Skipping the setup step." },
      { front: "What should you check before final answer?", back: "Units, labels, and whether the question was fully answered." },
    ] : [],
    quiz: buildMcqQuestionsForTopic(topic, 4),
    summaryScaffold: `Source: ${sources[0]?.citationLabel || "student material"}\nIdea:\nSteps:\nExample:\nMistake to avoid:\nOne-minute recall:`,
  };
}

export function buildReviewCheck(state, topic) {
  const latest = latestTestForTopic(state, topic.id);
  const coverage = determineTopicCoverage(state, topic);
  const weakPoints = isEvidenceDerivedWeakTopic(topic)
    ? [`Mapped test performance: ${topic.performance.latestPercentage}%`]
    : [];
  return {
    coverage,
    latestScore: latest?.scorePercent ?? null,
    weakPoints,
    checks: [
      `Explain ${topic.title} without notes.`,
      "Solve one MCQ under time pressure.",
      "Name the mistake you are most likely to make.",
    ],
    nextAction: coverage.status === "uncovered"
      ? "Open a tutor lesson before testing."
      : weakPoints.length
        ? "Run a focused MCQ retest and review corrections."
        : "Schedule spaced revision within 24 hours.",
  };
}

export function answerFromStudentMaterials({ verb, message, state, retrievalOverride = null, assistantPolicy = {} }) {
  normalizeLearningState(state);
  const { topic, course } = getGroundingContext(state, message);
  const sources = sourcesForTopic(state, topic);
  const rawRetrieved = retrievalOverride || retrieveGroundedSources({ state, message, topic, course });
  const retrieved = {
    chunks: Array.isArray(rawRetrieved?.chunks) ? rawRetrieved.chunks : [],
    sources: Array.isArray(rawRetrieved?.sources) ? rawRetrieved.sources : [],
    memories: Array.isArray(rawRetrieved?.memories) ? rawRetrieved.memories : [],
    labels: Array.isArray(rawRetrieved?.labels) ? rawRetrieved.labels : [],
    hasUploadedMaterial: rawRetrieved?.hasUploadedMaterial === true,
    retrievalMode: rawRetrieved?.retrievalMode || "local-json",
    confidence: rawRetrieved?.confidence || { score: 0, label: "low", lowConfidence: true, semanticAvailable: false },
  };
  const sourceLabels = retrieved.labels.length
    ? retrieved.labels
    : sources.map((source) => ({ label: source.citationLabel, type: "student_material" }));
  const preferences = state.studentProfile?.preferences || {};
  const webFallback = sources.some((source) => source.webFallbackAllowed);
  const requestText = String(message || "").trim();
  const requiresSpecificMaterial = /\b(?:this|my|the attached|the uploaded|selected)\b.{0,40}\b(?:pdf|file|material|notes?|assignment|rubric)\b/i.test(requestText);
  const insufficientMaterial = retrieved.confidence?.lowConfidence ||
    (!retrieved.hasUploadedMaterial && !retrieved.chunks.length && !retrieved.memories.length);
  const groundingSummary = retrieved.confidence?.lowConfidence
    ? "Not enough material yet. Add or choose more relevant material, then ask again."
    : retrieved.hasUploadedMaterial
      ? "I used your selected study material."
      : "Use this as a study-plan draft until you add more relevant material.";
  const retrievedSnippet = retrieved.chunks[0]?.snippet || retrieved.memories[0]?.body || retrieved.sources[0]?.extractedText || "";
  const normalizedVerb = AI_VERBS.includes(verb) ? verb : "Ask";
  if (!topic || !course) {
    const generalGuidance = requiresSpecificMaterial
      ? "I don’t have that material yet. Add or select it in Academic Context, then ask again."
      : "I can answer generally for now. Add your materials for more personalized help.";
    const generalAnswer = normalizedVerb === "Plan"
      ? `${generalGuidance} Start with one clear goal, choose the next deadline or topic, and schedule a focused study block followed by a short review.`
      : normalizedVerb === "Make"
        ? `${generalGuidance} I can still help you create a general study outline once you name the topic and the format you need.`
        : normalizedVerb === "Review"
          ? `${generalGuidance} Tell me the topic or paste the work you want to review, and I’ll help you check understanding without submitting it for you.`
          : generalGuidance;
    return {
      verb: normalizedVerb,
      courseId: null,
      topicId: null,
      coverage: null,
      sourceLabels,
      answer: generalAnswer,
      nextActions: requiresSpecificMaterial ? ["Add or select the missing material"] : ["Ask a study question", "Add academic context when useful"],
      grounding: {
        uploadedMaterialUsed: retrieved.hasUploadedMaterial,
        summary: generalGuidance,
        retrievedCount: retrieved.chunks.length + retrieved.sources.length + retrieved.memories.length,
        retrievalMode: retrieved.retrievalMode,
        confidence: retrieved.confidence,
        snippets: retrieved.chunks.map((chunk) => ({
          chunkId: chunk.id,
          sourceMaterialId: chunk.sourceMaterialId,
          citationLabel: chunk.citationLabel || chunk.source?.citationLabel,
          snippet: chunk.snippet,
          sourceTitle: chunk.source?.title,
          confidenceLabel: chunk.confidenceLabel,
          confidenceScore: chunk.confidenceScore,
          semanticScore: chunk.semanticScore,
        })),
        contextUnavailable: true,
        requiresSpecificMaterial,
      },
      academicProfile: {
        goal: preferences.academicGoal || "",
        stream: preferences.stream || "",
        classLevel: preferences.classLevel || state.studentProfile?.gradeBand || "",
        dailyStudyAvailabilityMinutes: preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || null,
        studyBreakPattern: preferences.studyBreakPattern || "",
        weakTopicCount: (preferences.weakTopicIds || []).length,
      },
      webFallback: { allowed: false },
    };
  }
  const coverage = determineTopicCoverage(state, topic);
  const base = {
    verb: normalizedVerb,
    courseId: course.id,
    topicId: topic.id,
    coverage,
    sourceLabels,
    grounding: {
      uploadedMaterialUsed: retrieved.hasUploadedMaterial,
      summary: groundingSummary,
      retrievedCount: retrieved.chunks.length + retrieved.sources.length + retrieved.memories.length,
      retrievalMode: retrieved.retrievalMode || "local-json",
      confidence: retrieved.confidence,
      snippets: retrieved.chunks.map((chunk) => ({
        chunkId: chunk.id,
        sourceMaterialId: chunk.sourceMaterialId,
        citationLabel: chunk.citationLabel || chunk.source?.citationLabel,
        snippet: chunk.snippet,
        sourceTitle: chunk.source?.title,
        confidenceLabel: chunk.confidenceLabel,
        confidenceScore: chunk.confidenceScore,
        semanticScore: chunk.semanticScore,
      })),
      contextUnavailable: false,
      requiresSpecificMaterial,
    },
    academicProfile: {
      goal: preferences.academicGoal || "",
      stream: preferences.stream || "",
      classLevel: preferences.classLevel || state.studentProfile?.gradeBand || "",
      dailyStudyAvailabilityMinutes: preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || null,
      studyBreakPattern: preferences.studyBreakPattern || "",
      weakTopicCount: (preferences.weakTopicIds || []).length,
    },
    webFallback: webFallback ? { allowed: true, label: "outside references only if your materials are insufficient" } : { allowed: false },
  };

  if (normalizedVerb === "Plan") {
    const plan = buildStudyPlan(state, topic);
    return {
      ...base,
      answer: insufficientMaterial
        ? `${groundingSummary}${plan.academicGoal ? ` Goal: ${plan.academicGoal.replaceAll("_", " ")}.` : ""} I can still help you plan around ${course.title}: start with ${topic.title}, protect due work, and add a relevant source before asking for a detailed explanation.`
        : `Plan for ${requestText || topic.title}: ${plan.daysUntilExam === null ? "no exam date is set" : `${plan.daysUntilExam} day(s) until the ${course.title} exam`}.${plan.academicGoal ? ` Goal: ${plan.academicGoal.replaceAll("_", " ")}.` : ""} Use ${topic.title} first, fit it around timetable blocks, then repair weak topics and due work. ${groundingSummary}`,
      studyPlan: plan,
      nextActions: plan.blocks,
    };
  }

  if (normalizedVerb === "Make") {
    const artifacts = buildMakeArtifacts(state, topic, {
      flashcardsEnabled: assistantPolicy.flashcardsEnabled !== false,
    });
    const createdMaterials = artifacts.flashcards.length
      ? "notes, flashcards, a short quiz, and a summary scaffold"
      : "notes, a short quiz, and a summary scaffold";
    return {
      ...base,
      answer: insufficientMaterial
        ? `${groundingSummary} I can make a safe outline for ${topic.title}, but add a relevant source before using it as final study material.`
        : `Created study materials for ${requestText || topic.title}: ${createdMaterials} for ${topic.title}. ${groundingSummary}`,
      artifacts,
      nextActions: ["Save structured notes", "Try the quiz", "Review missed items before any convenience drafting"],
    };
  }

  if (normalizedVerb === "Review") {
    const review = buildReviewCheck(state, topic);
    return {
      ...base,
      answer: insufficientMaterial
        ? `${groundingSummary} For now, review ${topic.title} by checking coverage, weak points, and one timed question.`
        : `Review for ${requestText || topic.title}: ${topic.title} is ${coverage.status.replace("_", " ")}. Weak points: ${review.weakPoints.join(", ") || "none recorded"}. ${groundingSummary}`,
      review,
      nextActions: [review.nextAction],
    };
  }

  return {
    ...base,
    answer: insufficientMaterial
      ? `${groundingSummary} I do not have enough relevant material to answer "${requestText || topic.title}" yet.`
      : `For "${requestText || topic.title}", start with ${topic.title} from your study context. ${groundingSummary} If a reference goes beyond your material, it must be labeled.`,
      explanation: {
      concept: retrieved.confidence?.lowConfidence
        ? "Not enough material yet to answer this from your sources."
        : retrievedSnippet
        ? `Source note: ${retrievedSnippet.slice(0, 420)}`
        : `Core idea: understand ${topic.title} from the available course material before doing automation.`,
      sourceUse: sourceLabels.map((item) => item.label),
      diagram: `${sourceLabels[0]?.label || "Source"}: concept, example, MCQ check, 24h revision`,
    },
    nextActions: ["Read the material-backed explanation", "Try a quick check", "Add correction if unsure"],
  };
}

export function getTodayNextActions(state) {
  return [...state.roadmap]
    .filter((item) => item.status === "open" && !item.archived)
    .sort((left, right) => {
      const priorityDiff = (PRIORITY_RANK[left.priority] ?? 9) - (PRIORITY_RANK[right.priority] ?? 9);
      if (priorityDiff !== 0) return priorityDiff;
      return Date.parse(left.dueAt || "") - Date.parse(right.dueAt || "");
    })
    .slice(0, 5)
    .map((item) => ({
      ...item,
      courseTitle: courseById(state, item.courseId)?.title || "Course",
      topicTitle: topicById(state, item.topicId)?.title || "Topic",
    }));
}
