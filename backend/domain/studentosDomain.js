import { confidenceLabel, cosineSimilarity, createDeterministicEmbedding } from "../embeddings/embeddingService.js";

export const AI_VERBS = Object.freeze(["Ask", "Plan", "Make", "Review"]);

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
    displayName: "Student",
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

export function scoreMcqAnswers({ answers = [], answerKey = [] }) {
  if (!Array.isArray(answers) || answers.length === 0) return null;
  const markedAnswers = answers.filter((answer) => answer && typeof answer === "object" && typeof answer.isCorrect === "boolean");
  if (markedAnswers.length === answers.length) {
    const correctCount = markedAnswers.filter((answer) => answer.isCorrect).length;
    return Math.round((correctCount / answers.length) * 100);
  }
  if (Array.isArray(answerKey) && answerKey.length > 0) {
    const scoredCount = Math.min(answers.length, answerKey.length);
    if (scoredCount === 0) return null;
    const correctCount = answers.slice(0, scoredCount).filter((answer, index) => answerValue(answer) === answerKey[index]).length;
    return Math.round((correctCount / scoredCount) * 100);
  }
  return null;
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
  return state.topics.find((topic) => topic.id === topicId) || null;
}

function courseById(state, courseId) {
  return state.courses.find((course) => course.id === courseId) || null;
}

function sourcesForTopic(state, topic) {
  return (state.sourceMaterials || []).filter((source) => topic.sourceMaterialIds?.includes(source.id));
}

function readySourceMaterials(state) {
  return (state.sourceMaterials || []).filter((source) =>
    !source.deletedAt &&
    ["ready", "indexed"].includes(source.status || source.extractionStatus || "ready"));
}

function readySourceChunks(state) {
  return (state.sourceChunks || []).filter((chunk) =>
    !chunk.deletedAt &&
    ["ready", "indexed"].includes(chunk.status || "indexed"));
}

export function getGroundingContext(state, message = "") {
  const topic = findBestTopicForMessage(state, message);
  const course = courseById(state, topic.courseId) || state.courses[0];
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
        groundingType: source?.sourceType === "uploaded_file" ? "uploaded_chunk" : "demo_chunk",
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
      return { ...source, score, groundingType: source.sourceType === "uploaded_file" ? "uploaded_material" : "mock_material" };
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
      lowConfidence: bestConfidence < 0.42,
      semanticAvailable: chunks.some((chunk) => chunk.embeddingStatus === "embedded"),
    },
  };
}

function latestTestForTopic(state, topicId) {
  return [...(state.testResults || [])]
    .filter((result) => result.topicId === topicId)
    .sort((left, right) => Date.parse(right.completedAt || "") - Date.parse(left.completedAt || ""))[0] || null;
}

export function createSeedState(now = new Date()) {
  const today = dateOnly(now);
  const tomorrow = dateOnly(addDays(now, 1));
  const inThreeDays = dateOnly(addDays(now, 3));
  const nextWeek = dateOnly(addDays(now, 7));

  return {
    studentProfile: {
      id: "student_demo_001",
      displayName: "Aarav",
      gradeBand: "high_school",
      schoolSystem: "CBSE-style demo",
      timezone: "Asia/Calcutta",
      disciplineIndex: 84,
      learningAdaptivityScore: 71,
      preferences: {
        explanationStyle: "lucid_steps_then_examples",
        dailyStudyWindowMinutes: 95,
        breakCycleMinutes: 25,
        breakMinutes: 5,
      },
      visibility: {
        defaultAudience: "student_only",
        externalProgressSharing: false,
      },
    },
    courses: [
      {
        id: "course_alg2",
        title: "Mathematics",
        term: "Semester 1",
        teacher: "Ms. Rao",
        examDate: nextWeek,
        color: "mint",
        syllabusId: "syllabus_alg2",
        subjectIds: ["topic_quadratics", "topic_trig_basics", "topic_stats_intro"],
      },
      {
        id: "course_bio",
        title: "Biology",
        term: "Semester 1",
        teacher: "Mr. Sen",
        examDate: nextWeek,
        color: "amber",
        syllabusId: "syllabus_bio",
        subjectIds: ["topic_cell_cycle", "topic_ecology"],
      },
      {
        id: "course_eng",
        title: "English",
        term: "Semester 1",
        teacher: "Ms. Mehta",
        examDate: nextWeek,
        color: "violet",
        syllabusId: "syllabus_eng",
        subjectIds: ["topic_macbeth", "topic_argument_writing"],
      },
    ],
    topics: [
      {
        id: "topic_quadratics",
        courseId: "course_alg2",
        title: "Quadratic equations",
        coverageState: "covered",
        mastery: "developing",
        weakSignals: ["factorisation speed", "word problem setup"],
        sourceMaterialIds: ["src_alg_syllabus", "src_quad_notes"],
      },
      {
        id: "topic_trig_basics",
        courseId: "course_alg2",
        title: "Trigonometry basics",
        coverageState: "uncovered",
        mastery: "not_started",
        weakSignals: [],
        sourceMaterialIds: ["src_alg_syllabus"],
      },
      {
        id: "topic_stats_intro",
        courseId: "course_alg2",
        title: "Introductory statistics",
        coverageState: "teaching",
        mastery: "revision_required",
        weakSignals: ["median vs mean", "reading grouped data"],
        sourceMaterialIds: ["src_alg_syllabus", "src_stats_handout"],
      },
      {
        id: "topic_cell_cycle",
        courseId: "course_bio",
        title: "Cell cycle and mitosis",
        coverageState: "covered",
        mastery: "strong",
        weakSignals: ["phase ordering under time pressure"],
        sourceMaterialIds: ["src_bio_notes"],
      },
      {
        id: "topic_argument_writing",
        courseId: "course_eng",
        title: "Argument writing",
        coverageState: "covered",
        mastery: "secure",
        weakSignals: [],
        sourceMaterialIds: ["src_eng_rubric"],
      },
    ],
    syllabi: [
      {
        id: "syllabus_alg2",
        courseId: "course_alg2",
        title: "Math semester exam outline",
        units: ["Algebra", "Trigonometry", "Statistics"],
        sourceMaterialId: "src_alg_syllabus",
      },
      {
        id: "syllabus_bio",
        courseId: "course_bio",
        title: "Biology unit outline",
        units: ["Cell biology", "Ecology"],
        sourceMaterialId: "src_bio_notes",
      },
    ],
    exams: [
      {
        id: "exam_math_sem1",
        courseId: "course_alg2",
        title: "Mathematics Semester Exam",
        examDate: nextWeek,
        weight: 0.4,
      },
    ],
    assignments: [
      {
        id: "assign_quad_ws",
        courseId: "course_alg2",
        topicIds: ["topic_quadratics"],
        title: "Quadratics worksheet",
        dueDate: tomorrow,
        status: "due_soon",
        source: "mock_google_classroom",
        automationEligibility: "requires_contract",
      },
      {
        id: "assign_stats_review",
        courseId: "course_alg2",
        topicIds: ["topic_stats_intro"],
        title: "Statistics quick review",
        dueDate: inThreeDays,
        status: "open",
        source: "mock_google_classroom",
        automationEligibility: "requires_contract",
      },
      {
        id: "assign_trig_intro",
        courseId: "course_alg2",
        topicIds: ["topic_trig_basics"],
        title: "Trigonometry ratios practice",
        dueDate: nextWeek,
        status: "open",
        source: "manual_demo",
        automationEligibility: "requires_contract",
      },
      {
        id: "assign_bio_diagram",
        courseId: "course_bio",
        topicIds: ["topic_cell_cycle"],
        title: "Mitosis diagram notes",
        dueDate: nextWeek,
        status: "open",
        source: "manual_demo",
        automationEligibility: "requires_contract",
      },
    ],
    timetable: [
      {
        id: "class_math_today",
        courseId: "course_alg2",
        title: "Math class",
        startsAt: `${today}T09:00:00+05:30`,
        endsAt: `${today}T09:45:00+05:30`,
        location: "Room 204",
      },
      {
        id: "study_block_today",
        courseId: "course_alg2",
        title: "Focused revision block",
        startsAt: `${today}T18:30:00+05:30`,
        endsAt: `${today}T19:25:00+05:30`,
        location: "Home",
      },
    ],
    notes: [
      {
        id: "note_quad_summary",
        courseId: "course_alg2",
        topicId: "topic_quadratics",
        title: "Quadratics key methods",
        body: "Use factorisation when roots are clean. Use formula when factorisation stalls. Always identify a, b, c first.",
        sourceMaterialIds: ["src_quad_notes"],
      },
    ],
    sourceMaterials: [
      {
        id: "src_alg_syllabus",
        courseId: "course_alg2",
        title: "Math semester syllabus",
        kind: "syllabus",
        storageMode: "mock_metadata",
        citationLabel: "Math syllabus, Unit 2",
        webFallbackAllowed: true,
      },
      {
        id: "src_quad_notes",
        courseId: "course_alg2",
        title: "Teacher notes: quadratics",
        kind: "teacher_note",
        storageMode: "mock_metadata",
        citationLabel: "Teacher notes, Quadratics",
        webFallbackAllowed: true,
      },
      {
        id: "src_stats_handout",
        courseId: "course_alg2",
        title: "Class handout: statistics",
        kind: "uploaded_file_metadata",
        storageMode: "mock_metadata",
        citationLabel: "Class handout, Statistics",
        webFallbackAllowed: true,
      },
      {
        id: "src_bio_notes",
        courseId: "course_bio",
        title: "Biology class notes",
        kind: "teacher_note",
        storageMode: "mock_metadata",
        citationLabel: "Biology notes, Cell cycle",
        webFallbackAllowed: true,
      },
      {
        id: "src_eng_rubric",
        courseId: "course_eng",
        title: "Argument writing rubric",
        kind: "rubric",
        storageMode: "mock_metadata",
        citationLabel: "English rubric, Argument writing",
        webFallbackAllowed: false,
      },
    ],
    testSessions: [],
    testResults: [
      {
        id: "test_prev_quad",
        studentId: "student_demo_001",
        courseId: "course_alg2",
        topicId: "topic_quadratics",
        type: "mcq",
        scorePercent: 76,
        creditsAwarded: 1,
        completedAt: today,
      },
      {
        id: "test_prev_stats",
        studentId: "student_demo_001",
        courseId: "course_alg2",
        topicId: "topic_stats_intro",
        type: "mcq",
        scorePercent: 64,
        creditsAwarded: 0,
        completedAt: today,
      },
    ],
    creditLedger: [
      {
        id: "credit_prev_quad",
        studentId: "student_demo_001",
        sourceType: "test_result",
        sourceId: "test_prev_quad",
        amount: 1,
        reason: "MCQ score 76% on Quadratic equations",
        createdAt: today,
      },
    ],
    roadmap: [
      {
        id: "road_quad_revision",
        courseId: "course_alg2",
        topicId: "topic_quadratics",
        title: "Repair factorisation speed",
        kind: "revision",
        priority: "high",
        dueAt: `${tomorrow}T18:00:00+05:30`,
        status: "open",
      },
      {
        id: "road_stats_recovery",
        courseId: "course_alg2",
        topicId: "topic_stats_intro",
        title: "Recover grouped-data basics",
        kind: "weak_topic_recovery",
        priority: "urgent",
        dueAt: `${today}T20:00:00+05:30`,
        status: "open",
      },
      {
        id: "road_trig_teach",
        courseId: "course_alg2",
        topicId: "topic_trig_basics",
        title: "Teach trigonometry from syllabus before testing",
        kind: "lesson_then_test",
        priority: "medium",
        dueAt: `${nextWeek}T17:00:00+05:30`,
        status: "open",
      },
    ],
    revisionEvents: [
      {
        id: "rev_quad_24h",
        courseId: "course_alg2",
        topicId: "topic_quadratics",
        scheduledAt: `${tomorrow}T18:00:00+05:30`,
        reason: "Revision inside 24 hours after developing score band.",
      },
    ],
    tutorLessons: [],
    assignmentAutomationContracts: [],
    assignmentLearningFlows: [],
    auditLog: [
      {
        id: "audit_mock_bootstrap",
        actorId: "system",
        action: "studentos.pass1.mock_bootstrap",
        riskLevel: "low",
        createdAt: now.toISOString(),
      },
    ],
  };
}

export function getCreditBalance(state) {
  return state.creditLedger.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

export function getSafeStudentProfile(profile, creditBalance = 0) {
  const disciplineIndex = Number(profile.disciplineIndex || 0);
  return {
    id: profile.id,
    displayName: profile.displayName,
    gradeBand: profile.gradeBand,
    schoolSystem: profile.schoolSystem,
    timezone: profile.timezone,
    studyRhythm: disciplineIndex >= 80 ? "steady" : disciplineIndex >= 60 ? "building" : "needs support",
    convenienceEligibility: creditBalance > 0 ? "credits available" : "earn credits through tests",
    learningCalibrationVisible: false,
    preferences: profile.preferences,
    visibility: profile.visibility,
  };
}

export function daysUntilCourseExam(course, now = new Date()) {
  const examDate = toDate(course?.examDate);
  if (!examDate) return 30;
  const diff = examDate.getTime() - now.getTime();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function examPressureForCourse(course, now = new Date()) {
  const days = daysUntilCourseExam(course, now);
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
  if ((topic.weakSignals || []).length > 0) reasons.push("weak_signals_present");

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
    (topic.weakSignals || []).length > 0
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
    ? state.assignments.find((item) => item.id === assignmentOrId)
    : assignmentOrId;
  if (!assignment) {
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
  return state.assignments.map((assignment) => ({
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
  const assignment = state.assignments.find((item) => item.id === assignmentId);
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
    testSession,
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
    flow.testSession.answerKey = Array.isArray(flow.testSession.answerKey) ? flow.testSession.answerKey : [];
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

export function createTestResult({ studentId, courseId, topicId, scorePercent, type = "mcq", answers = [], answerKey = [] }) {
  const derivedScore = type === "mcq" ? scoreMcqAnswers({ answers, answerKey }) : null;
  const score = clampScore(scorePercent) ?? derivedScore ?? 0;
  const id = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    studentId,
    courseId,
    topicId,
    type,
    scorePercent: score,
    masteryBand: masteryBand(score),
    creditsAwarded: scoreToCredits(score),
    answers,
    answerKey,
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

export function createRevisionRoadmapItem({ testResult, topicTitle }) {
  const due = addDays(new Date(), 1).toISOString();
  if (testResult.scorePercent >= 70) {
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

export function applyTestScore(state, payload) {
  normalizeLearningState(state);
  let topic = topicById(state, payload.topicId) || state.topics[0];
  let course = topic ? courseById(state, payload.courseId || topic.courseId) || state.courses[0] : state.courses[0];
  if (!course) {
    course = {
      id: payload.courseId || "course_unmapped",
      title: "Imported course",
      teacher: "StudentOS",
      examDate: null,
    };
    state.courses.push(course);
  }
  if (!topic) {
    topic = {
      id: payload.topicId || "topic_unmapped",
      courseId: course.id,
      title: "Imported topic",
      mastery: "new",
      coverageState: "uncovered",
      weakSignals: [],
    };
    state.topics.push(topic);
  }
  if (!Array.isArray(topic.weakSignals)) topic.weakSignals = [];
  const session = payload.testSessionId
    ? state.testSessions.find((testSession) => testSession.id === payload.testSessionId)
    : null;
  const answerKey = payload.answerKey || session?.answerKey || session?.questions?.map((question) => question.answer) || [];
  const result = createTestResult({
    studentId: state.studentProfile.id,
    courseId: payload.courseId || topic.courseId,
    topicId: topic.id,
    scorePercent: payload.scorePercent,
    type: payload.type || "mcq",
    answers: payload.answers || [],
    answerKey,
  });
  const creditEntry = createCreditLedgerEntry(result);
  const correctionSheet = createCorrectionSheet({
    topic,
    answers: payload.answers || [],
    scorePercent: result.scorePercent,
  });
  const roadmapItem = createRevisionRoadmapItem({ testResult: result, topicTitle: topic.title });
  const revisionEvent = createRevisionEventForTopic({
    courseId: result.courseId,
    topicId: result.topicId,
    reason: result.scorePercent < 70
      ? "Immediate revision queued after score below 70%."
      : "Spaced revision within 24 hours after test corrections.",
  });
  const lesson = createTutorLesson({
    course,
    topic,
    sources: sourcesForTopic(state, topic),
    trigger: "test_result",
    coverageStatus: result.scorePercent < 70 ? "partially_covered" : "covered",
    wrongConcepts: correctionSheet.weakTopics,
  });

  state.testResults.push(result);
  if (creditEntry) state.creditLedger.push(creditEntry);
  state.roadmap.push(roadmapItem);
  state.revisionEvents.push(revisionEvent);
  state.tutorLessons.push(lesson);

  topic.mastery = masteryBand(result.scorePercent);
  if (result.scorePercent < 70 && !topic.weakSignals.includes("immediate revision required")) {
    topic.weakSignals.push("immediate revision required");
  }
  for (const weakTopic of correctionSheet.weakTopics) {
    if (weakTopic && !topic.weakSignals.includes(weakTopic)) {
      topic.weakSignals.push(weakTopic);
    }
  }

  const scoreSummary = result.scorePercent >= 90
    ? "Mastery is secure. Credits unlocked for convenience workflows."
    : result.scorePercent >= 70
      ? "Good enough to earn credits, but corrections should be reviewed today."
      : "No credits yet. StudentOS queued mastery repair before convenience workflows.";
  const nextRecommendedAction = result.scorePercent < 70
    ? "Open the tutor lesson, repair weak points, then retest."
    : "Review the correction sheet, then do one 24-hour revision check.";

  return {
    result,
    scoreSummary,
    creditEntry,
    correctionSheet,
    weakTopics: correctionSheet.weakTopics,
    roadmapItem,
    revisionEvent,
    tutorLesson: lesson,
    nextRecommendedAction,
    creditBalance: getCreditBalance(state),
  };
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
  const matchedTopic = state.topics.find((topic) => {
    const words = topicTitleSlug(topic.title);
    return words.some((word) => lower.includes(word));
  });
  if (matchedTopic) return matchedTopic;

  const dueAssignment = [...state.assignments]
    .sort((left, right) => Date.parse(left.dueDate || "") - Date.parse(right.dueDate || ""))[0];
  return topicById(state, dueAssignment?.topicIds?.[0]) || state.topics[0];
}

export function buildStudyPlan(state, topic) {
  const course = courseById(state, topic.courseId) || state.courses[0];
  const pressure = examPressureForCourse(course);
  const preferences = state.studentProfile?.preferences || {};
  const weakTopics = state.topics
    .filter((item) => item.courseId === course.id && (item.weakSignals?.length || ["revision_required", "not_started"].includes(item.mastery)))
    .slice(0, 4);
  const dueWork = state.assignments
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
    academicGoal: preferences.academicGoal || "exam_prep",
    dailyStudyAvailabilityMinutes: preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || 90,
    studyBreakPattern: preferences.studyBreakPattern || `${preferences.breakCycleMinutes || 25}/${preferences.breakMinutes || 5}`,
    timetableBlocks: timetableBlocks.map((item) => ({
      title: item.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    })),
    blocks: [
      `Start with ${topic.title} source recap for ${Math.min(25, preferences.breakCycleMinutes || 25)} minutes.`,
      weakTopics.length ? `Repair weak topics: ${weakTopics.map((item) => item.title).join(", ")}.` : "Run a timed mixed-topic check.",
      dueWork.length ? `Protect due work: ${dueWork.map((item) => item.title).join(", ")}.` : "Use the extra time for spaced revision.",
      timetableBlocks.length ? `Fit this around: ${timetableBlocks.map((item) => item.title).join(", ")}.` : `Use ${preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || 90} available study minutes.`,
      "End with a 5-minute correction note and schedule 24-hour revision.",
    ],
  };
}

export function buildMakeArtifacts(state, topic) {
  const sources = sourcesForTopic(state, topic);
  return {
    notes: [
      `Definition: write the smallest reliable definition for ${topic.title}.`,
      "Method: list the steps you can repeat under exam pressure.",
      "Example: keep one solved example from your teacher/source material.",
      "Mistake guard: add one trap from your correction sheet.",
    ],
    flashcards: [
      { front: `What is the core idea of ${topic.title}?`, back: "Answer from source material in one sentence." },
      { front: "What is the most common mistake?", back: topic.weakSignals?.[0] || "Skipping the setup step." },
      { front: "What should you check before final answer?", back: "Units, labels, and whether the question was fully answered." },
    ],
    quiz: buildMcqQuestionsForTopic(topic, 4),
    summaryScaffold: `Source: ${sources[0]?.citationLabel || "student material"}\nIdea:\nSteps:\nExample:\nMistake to avoid:\nOne-minute recall:`,
  };
}

export function buildReviewCheck(state, topic) {
  const latest = latestTestForTopic(state, topic.id);
  const coverage = determineTopicCoverage(state, topic);
  const weakPoints = uniqueStrings([...(topic.weakSignals || []), ...(latest && latest.scorePercent < 70 ? ["recent score below mastery"] : [])]);
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

export function answerFromStudentMaterials({ verb, message, state, retrievalOverride = null }) {
  const { topic, course } = getGroundingContext(state, message);
  const sources = sourcesForTopic(state, topic);
  const retrieved = retrievalOverride || retrieveGroundedSources({ state, message, topic, course });
  const sourceLabels = retrieved.labels.length
    ? retrieved.labels
    : sources.map((source) => ({ label: source.citationLabel, type: "mock_material" }));
  const preferences = state.studentProfile?.preferences || {};
  const webFallback = sources.some((source) => source.webFallbackAllowed);
  const groundingSummary = retrieved.confidence?.lowConfidence
    ? "Retrieved source context is low confidence; treat this as insufficient until more relevant material is indexed."
    : retrieved.hasUploadedMaterial
      ? "Grounding includes uploaded private material."
      : "Grounding is from mock/demo course material unless labeled otherwise.";
  const retrievedSnippet = retrieved.chunks[0]?.snippet || retrieved.memories[0]?.body || retrieved.sources[0]?.extractedText || "";
  const coverage = determineTopicCoverage(state, topic);
  const normalizedVerb = AI_VERBS.includes(verb) ? verb : "Ask";
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
        citationLabel: chunk.citationLabel || chunk.source?.citationLabel,
        snippet: chunk.snippet,
        sourceTitle: chunk.source?.title,
        confidenceLabel: chunk.confidenceLabel,
        confidenceScore: chunk.confidenceScore,
        semanticScore: chunk.semanticScore,
      })),
    },
    academicProfile: {
      goal: preferences.academicGoal || "exam_prep",
      stream: preferences.stream || "",
      classLevel: preferences.classLevel || state.studentProfile?.gradeBand || "",
      dailyStudyAvailabilityMinutes: preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || 90,
      studyBreakPattern: preferences.studyBreakPattern || `${preferences.breakCycleMinutes || 25}/${preferences.breakMinutes || 5}`,
      weakTopicCount: (preferences.weakTopicIds || []).length,
    },
    webFallback: webFallback ? { allowed: true, label: "outside references only if your materials are insufficient" } : { allowed: false },
  };

  if (normalizedVerb === "Plan") {
    const plan = buildStudyPlan(state, topic);
    return {
      ...base,
      answer: `Plan: ${plan.daysUntilExam} day(s) until the ${course.title} exam. Goal: ${plan.academicGoal.replaceAll("_", " ")}. Use ${topic.title} first, fit it around timetable blocks, then repair weak topics and due work. ${groundingSummary}`,
      studyPlan: plan,
      nextActions: plan.blocks,
    };
  }

  if (normalizedVerb === "Make") {
    const artifacts = buildMakeArtifacts(state, topic);
    return {
      ...base,
      answer: `Make: generated notes, flashcards, a short quiz, and a summary scaffold for ${topic.title}. ${groundingSummary}`,
      artifacts,
      nextActions: ["Save structured notes", "Try the quiz", "Review missed items before any convenience drafting"],
    };
  }

  if (normalizedVerb === "Review") {
    const review = buildReviewCheck(state, topic);
    return {
      ...base,
      answer: `Review: ${topic.title} is ${coverage.status.replace("_", " ")}. Weak points: ${review.weakPoints.join(", ") || "none recorded"}. ${groundingSummary}`,
      review,
      nextActions: [review.nextAction],
    };
  }

  return {
    ...base,
    answer: `Ask: from ${sourceLabels[0]?.label || "student materials"}, ${topic.title} should be explained from your study context first. ${groundingSummary} If the material is thin, any outside reference must be labeled.`,
      explanation: {
      concept: retrieved.confidence?.lowConfidence
        ? "StudentOS found only low-confidence source context for this request, so it should not pretend the uploaded material is enough."
        : retrievedSnippet
        ? `Uploaded/source note: ${retrievedSnippet.slice(0, 420)}`
        : `Core idea: understand ${topic.title} from the available course material before doing automation.`,
      sourceUse: sourceLabels.map((item) => item.label),
      diagram: `${sourceLabels[0]?.label || "Source"} -> concept -> example -> MCQ check -> 24h revision`,
    },
    nextActions: ["Read the material-backed explanation", "Try a quick check", "Add correction if unsure"],
  };
}

export function getTodayNextActions(state) {
  return [...state.roadmap]
    .filter((item) => item.status === "open")
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
