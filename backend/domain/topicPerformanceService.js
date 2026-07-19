import { randomUUID } from "node:crypto";

export const TOPIC_WEAK_THRESHOLD_PERCENT = 70;
const ACTIVE_RECOVERY_STATUSES = new Set(["needs_recovery", "recovering"]);
const AUTHORITATIVE_MAPPING_SOURCE = "studentos_strict_test_scope";

function clean(value, limit = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizedTitle(value) {
  return clean(value, 240).toLowerCase();
}

function evidenceKey(value = {}) {
  return `${clean(value.courseId, 180)}::${clean(value.topicId, 180) || normalizedTitle(value.topicTitle)}`;
}

export function isEvidenceDerivedWeakTopic(topic) {
  return ACTIVE_RECOVERY_STATUSES.has(topic?.performance?.status) && topic?.performance?.source === "studentos_assessment_evidence";
}

export function publicTopicPerformance(topic) {
  if (!topic?.performance) return null;
  const performance = topic.performance;
  return {
    status: performance.status,
    latestPercentage: performance.latestPercentage,
    weightedPercentage: performance.weightedPercentage,
    latestAssessedAt: performance.latestAssessedAt,
    assessmentCount: performance.assessmentCount,
    recoveryState: performance.recoveryState,
  };
}

export function buildTopicEvidenceFromEvaluation({ session, evaluation, testResultId, assessedAt = new Date().toISOString() } = {}) {
  const questionByNumber = new Map((session?.testPaper?.questions || session?.questions || []).map((question) => [String(question.question_number), question]));
  const groups = new Map();
  for (const result of evaluation?.question_results || []) {
    const question = questionByNumber.get(String(result.question_number)) || result;
    const mappingSource = question.mapping_source || question.mappingSource || result.mapping_source || result.mappingSource;
    const courseId = question.course_id || question.courseId || result.course_id || result.courseId;
    const topicId = question.topic_id || question.topicId || result.topic_id || result.topicId || null;
    const topicTitle = question.topic_title || question.topicTitle || result.topic_title || result.topicTitle;
    const marksAvailable = Number(result.max_marks ?? question.marks ?? 0);
    const marksEarned = Number(result.marks_awarded ?? 0);
    if (mappingSource !== AUTHORITATIVE_MAPPING_SOURCE || !courseId || !clean(topicTitle) || !(marksAvailable > 0) || !Number.isFinite(marksEarned)) continue;
    const record = { courseId: String(courseId), topicId: topicId ? String(topicId) : null, topicTitle: clean(topicTitle, 240) };
    const key = evidenceKey(record);
    const group = groups.get(key) || { ...record, marksEarned: 0, marksAvailable: 0, questionNumbers: [], incorrectQuestionNumbers: [] };
    group.marksEarned += Math.max(0, Math.min(marksAvailable, marksEarned));
    group.marksAvailable += marksAvailable;
    group.questionNumbers.push(result.question_number);
    if (marksEarned < marksAvailable) group.incorrectQuestionNumbers.push(result.question_number);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    marksEarned: Math.round(group.marksEarned * 100) / 100,
    marksAvailable: Math.round(group.marksAvailable * 100) / 100,
    percentage: Math.round((group.marksEarned / group.marksAvailable) * 10_000) / 100,
    assessedAt,
    testResultId,
    testSessionId: session?.id || null,
    mappingSource: AUTHORITATIVE_MAPPING_SOURCE,
  }));
}

function evidenceHistory(state, key) {
  return (state.testResults || [])
    .flatMap((result) => result.topicEvidence || [])
    .filter((evidence) => evidence.mappingSource === AUTHORITATIVE_MAPPING_SOURCE && evidenceKey(evidence) === key)
    .sort((left, right) => String(left.assessedAt || "").localeCompare(String(right.assessedAt || "")));
}

function aggregateEvidence(history) {
  const totalMarksEarned = history.reduce((sum, item) => sum + Number(item.marksEarned || 0), 0);
  const totalMarksAvailable = history.reduce((sum, item) => sum + Number(item.marksAvailable || 0), 0);
  const cumulativePercentage = totalMarksAvailable ? (totalMarksEarned / totalMarksAvailable) * 100 : 0;
  let weightedEarned = 0;
  let weightedAvailable = 0;
  history.forEach((item, index) => {
    const recencyWeight = Math.pow(0.7, history.length - index - 1);
    weightedEarned += Number(item.marksEarned || 0) * recencyWeight;
    weightedAvailable += Number(item.marksAvailable || 0) * recencyWeight;
  });
  const latest = history.at(-1);
  const latestPercentage = Number(latest?.percentage || 0);
  const weightedPercentage = weightedAvailable ? (weightedEarned / weightedAvailable) * 100 : 0;
  let status;
  if (latestPercentage < TOPIC_WEAK_THRESHOLD_PERCENT) status = "needs_recovery";
  else if (weightedPercentage < TOPIC_WEAK_THRESHOLD_PERCENT) status = "recovering";
  else status = "secure";
  return {
    source: "studentos_assessment_evidence",
    status,
    recoveryState: status === "needs_recovery" ? "revision_required" : status === "recovering" ? "reassess_after_revision" : "not_required",
    thresholdPercentage: TOPIC_WEAK_THRESHOLD_PERCENT,
    latestPercentage: Math.round(latestPercentage * 100) / 100,
    weightedPercentage: Math.round(weightedPercentage * 100) / 100,
    cumulativePercentage: Math.round(cumulativePercentage * 100) / 100,
    totalMarksEarned: Math.round(totalMarksEarned * 100) / 100,
    totalMarksAvailable: Math.round(totalMarksAvailable * 100) / 100,
    latestAssessedAt: latest?.assessedAt || null,
    assessmentCount: history.length,
    supportingTestResultIds: [...new Set(history.map((item) => item.testResultId).filter(Boolean))],
    updatedAt: latest?.assessedAt || new Date().toISOString(),
  };
}

function findOrCreateTopic(state, evidence, now) {
  let topic = (state.topics || []).find((candidate) => evidence.topicId && candidate.id === evidence.topicId);
  if (!topic) {
    topic = (state.topics || []).find((candidate) => candidate.courseId === evidence.courseId && normalizedTitle(candidate.title) === normalizedTitle(evidence.topicTitle));
  }
  if (topic) return topic;
  topic = {
    id: evidence.topicId || `topic_assessment_${randomUUID()}`,
    userId: state.studentProfile?.id,
    courseId: evidence.courseId,
    title: evidence.topicTitle,
    coverageState: "teaching",
    mastery: "not_started",
    weakSignals: [],
    sourceMaterialIds: [],
    academicContextIncluded: true,
    source: "studentos_test_performance",
    createdAt: now.toISOString(),
  };
  state.topics.push(topic);
  return topic;
}

export function applyTopicPerformanceEvidence(state, evidenceRows, { now = new Date() } = {}) {
  state.topics = state.topics || [];
  const changed = [];
  for (const evidence of evidenceRows || []) {
    const topic = findOrCreateTopic(state, evidence, now);
    const history = evidenceHistory(state, evidenceKey(evidence));
    const previousStatus = topic.performance?.status;
    topic.performance = aggregateEvidence(history);
    topic.weakSignals = [];
    if (topic.performance.status === "needs_recovery") {
      topic.mastery = "revision_required";
      if (topic.coverageState === "uncovered") topic.coverageState = "teaching";
    } else if (topic.performance.status === "recovering") {
      topic.mastery = "developing";
      topic.coverageState = "teaching";
    } else {
      topic.mastery = topic.performance.latestPercentage >= 90 ? "secure" : topic.performance.latestPercentage >= 80 ? "strong" : "developing";
      topic.coverageState = "covered";
    }
    topic.updatedAt = now.toISOString();
    changed.push({ topic, previousStatus, status: topic.performance.status });
  }
  state.studentProfile.preferences = state.studentProfile.preferences || {};
  state.studentProfile.preferences.weakTopicIds = state.topics.filter(isEvidenceDerivedWeakTopic).map((topic) => topic.id);
  return changed;
}

export function normalizeLegacyWeakTopicState(state) {
  const preferences = state.studentProfile?.preferences || {};
  if (preferences.weakTopicsText) {
    preferences.legacyWeakTopicsText ||= preferences.weakTopicsText;
    preferences.weakTopicsText = "";
  }
  for (const topic of state.topics || []) {
    if (topic.performance?.source === "studentos_assessment_evidence") {
      topic.weakSignals = [];
      continue;
    }
    if ((topic.weakSignals || []).length) {
      topic.legacyWeakSignals = [...new Set([...(topic.legacyWeakSignals || []), ...topic.weakSignals])];
      topic.weakSignals = [];
      topic.legacyWeakTopicSource = true;
      const representedInSyllabus = (state.syllabi || []).some((syllabus) => syllabus.courseId === topic.courseId && (syllabus.units || []).some((unit) => normalizedTitle(typeof unit === "string" ? unit : unit?.title) === normalizedTitle(topic.title)));
      if (!representedInSyllabus && ["onboarding", "studentos_test_evaluation"].includes(topic.source)) {
        topic.academicContextIncluded = false;
        topic.legacyWeakTopicOnly = true;
      }
      if (topic.mastery === "revision_required") topic.mastery = "not_started";
      if (topic.coverageState === "teaching") topic.coverageState = "uncovered";
    }
  }
  const activeTopicIds = new Set((state.topics || []).filter(isEvidenceDerivedWeakTopic).map((topic) => topic.id));
  for (const item of state.roadmap || []) {
    if (item.kind === "weak_topic_recovery" && !activeTopicIds.has(item.topicId) && item.status === "open") {
      item.status = "completed";
      item.legacyNonAuthoritative = true;
    }
  }
  preferences.weakTopicIds = (state.topics || []).filter(isEvidenceDerivedWeakTopic).map((topic) => topic.id);
  return state;
}
