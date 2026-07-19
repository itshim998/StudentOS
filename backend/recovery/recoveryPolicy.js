import { randomUUID } from "node:crypto";

const PRIORITY_CHANGE_INFLUENCE = Object.freeze({ increase: 5, decrease: -5, resolve_candidate: -5, maintain: 0, none: 0 });

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function daysUntil(value, currentDate) {
  const target = Date.parse(String(value || ""));
  const current = Date.parse(`${currentDate}T12:00:00.000Z`);
  return Number.isFinite(target) && Number.isFinite(current) ? Math.ceil((target - current) / 86_400_000) : null;
}

function urgencyPoints(days, kind) {
  if (days === null || days < 0) return kind === "assignment" && days !== null ? 20 : 0;
  if (kind === "exam") return days <= 3 ? 25 : days <= 7 ? 18 : days <= 14 ? 10 : 0;
  return days <= 1 ? 20 : days <= 3 ? 14 : days <= 7 ? 7 : 0;
}

export function deriveEvidenceStrength(evidenceRows = []) {
  const weakAssessments = new Set(evidenceRows.filter((row) => Number(row.percentage) < 70).map((row) => row.testResultId));
  const incorrectQuestions = evidenceRows.reduce((sum, row) => sum + Number(row.incorrectQuestionCount || 0), 0);
  const lostMarks = evidenceRows.reduce((sum, row) => sum + Number(row.incorrectMarks || 0), 0);
  if (weakAssessments.size >= 2 || (incorrectQuestions >= 3 && lostMarks >= 10)) return "strong";
  if (incorrectQuestions >= 2 || lostMarks >= 5) return "moderate";
  if (incorrectQuestions >= 1 || lostMarks > 0) return "weak";
  return "insufficient";
}

export function priorityBand(score) {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  if (score > 0) return "low";
  return "none";
}

function assignmentApplies(assignment, topic) {
  return assignment.courseId === topic.courseId && (!(assignment.topicIds || []).length || assignment.topicIds.includes(topic.id));
}

function activityFor(topic, recommendation) {
  if (recommendation?.activityType) return recommendation.activityType;
  if (topic.performance?.status === "recovering") return "reassessment";
  return "targeted_practice";
}

export function buildRecoveryIntents(snapshot, reasoning = { topicRecommendations: [] }) {
  const state = snapshot?.state || {};
  const recommendationByTopic = new Map((reasoning.topicRecommendations || []).map((item) => [item.syllabusTopicId, item]));
  const evidenceByTopic = new Map();
  for (const evidence of state.evidence || []) {
    const rows = evidenceByTopic.get(evidence.syllabusTopicId) || [];
    rows.push(evidence);
    evidenceByTopic.set(evidence.syllabusTopicId, rows);
  }
  const currentDate = state.clock?.currentDate;
  const unfinished = (state.currentPlan?.items || []).filter((item) => !["done", "completed"].includes(item.studyStatus));
  const totalCourseMinutes = new Map();
  for (const item of state.currentPlan?.items || []) {
    const value = Number(item.durationMinutes || 0);
    totalCourseMinutes.set(item.courseId, (totalCourseMinutes.get(item.courseId) || 0) + value);
  }
  const totalMinutes = [...totalCourseMinutes.values()].reduce((sum, value) => sum + value, 0);
  const intents = [];
  for (const topic of state.topics || []) {
    const evidence = evidenceByTopic.get(topic.id) || [];
    const strength = deriveEvidenceStrength(evidence);
    const recommendation = recommendationByTopic.get(topic.id);
    const latestSecure = topic.performance?.status === "secure" && Number(topic.performance?.latestPercentage) >= 70 && Number(topic.performance?.weightedPercentage) >= 70;
    const base = { strong: 40, moderate: 28, weak: 15, insufficient: 0 }[strength];
    const examScore = Math.max(0, ...(state.exams || []).filter((exam) => exam.courseId === topic.courseId).map((exam) => urgencyPoints(daysUntil(exam.examDate, currentDate), "exam")));
    const assignmentScore = Math.max(0, ...(state.assignments || []).filter((assignment) => assignmentApplies(assignment, topic) && !["done", "completed", "submitted", "graded", "returned"].includes(String(assignment.status).toLowerCase())).map((assignment) => urgencyPoints(daysUntil(assignment.dueAt, currentDate), "assignment")));
    const unfinishedScore = Math.min(15, unfinished.filter((item) => item.topicId === topic.id || item.courseId === topic.courseId).length * 8);
    const currentRecovery = (state.recoveryStates || []).find((item) => item.topicId === topic.id);
    const activeScore = ["active", "scheduled", "in_progress", "awaiting_reassessment"].includes(currentRecovery?.status) ? 10 : 0;
    const overload = totalMinutes > 0 && Number(totalCourseMinutes.get(topic.courseId) || 0) / totalMinutes > 0.5 ? -10 : 0;
    const reassessment = latestSecure ? -35 : 0;
    const modelInfluence = PRIORITY_CHANGE_INFLUENCE[recommendation?.priorityChange] || 0;
    const priority = clamp(base + examScore + assignmentScore + unfinishedScore + activeScore + overload + reassessment + modelInfluence, 0, 100);
    const evidenceIds = evidence.filter((row) => Number(row.incorrectMarks) > 0 || latestSecure).map((row) => row.id);
    const status = latestSecure
      ? "resolved"
      : strength === "insufficient"
        ? "insufficient_evidence"
        : priority >= 35
          ? "active"
          : "observed";
    intents.push({
      id: `recovery_intent:${topic.id}:${activityFor(topic, recommendation)}`,
      topicId: topic.id,
      courseId: topic.courseId,
      topicTitle: topic.title,
      activityType: activityFor(topic, recommendation),
      recommendedMinutes: clamp(Number(recommendation?.recommendedMinutes || 30), 20, 60),
      evidenceIds,
      evidenceStrength: strength,
      priority,
      priorityBand: priorityBand(priority),
      status,
      reasonCode: latestSecure ? "REASSESSMENT_SECURE" : recommendation?.reasonCode || `EVIDENCE_${strength.toUpperCase()}`,
      explanation: recommendation?.explanation || (latestSecure
        ? "Mapped reassessment evidence now supports resolution."
        : "Priority was calculated from mapped assessment evidence and current academic constraints."),
    });
  }
  return intents;
}

export function applyTopicRecoveryStates(state, intents, { now = new Date() } = {}) {
  state.topicRecoveryStates = state.topicRecoveryStates || [];
  state.topicRecoveryStateHistory = state.topicRecoveryStateHistory || [];
  const timestamp = now.toISOString();
  const changed = [];
  for (const intent of intents) {
    let recovery = state.topicRecoveryStates.find((item) => item.topicId === intent.topicId);
    const previousStatus = recovery?.status || null;
    const nextStatus = previousStatus === "in_progress" && intent.status === "active" ? "in_progress" : intent.status;
    if (!recovery) {
      recovery = {
        id: `topic_recovery:${intent.topicId}`,
        userId: state.studentProfile.id,
        courseId: intent.courseId,
        topicId: intent.topicId,
        firstObservedAt: timestamp,
        version: 0,
      };
      state.topicRecoveryStates.push(recovery);
    }
    Object.assign(recovery, {
      evidenceIds: intent.evidenceIds,
      evidenceStrength: intent.evidenceStrength,
      priority: intent.priority,
      priorityBand: intent.priorityBand,
      status: nextStatus,
      reasonCode: intent.reasonCode,
      explanation: intent.explanation,
      latestObservedAt: timestamp,
      resolvedAt: nextStatus === "resolved" ? recovery.resolvedAt || timestamp : null,
      version: Number(recovery.version || 0) + 1,
      updatedAt: timestamp,
    });
    if (previousStatus !== nextStatus || recovery.version === 1) {
      const history = {
        id: `topic_recovery_history_${randomUUID()}`,
        userId: recovery.userId,
        topicRecoveryStateId: recovery.id,
        topicId: recovery.topicId,
        fromStatus: previousStatus,
        toStatus: nextStatus,
        evidenceIds: recovery.evidenceIds,
        priority: recovery.priority,
        reasonCode: recovery.reasonCode,
        version: recovery.version,
        createdAt: timestamp,
      };
      state.topicRecoveryStateHistory.push(history);
      changed.push({ recovery, history });
    }
  }
  return changed;
}

export function markRecoveryTaskProgress(state, task, status, { now = new Date() } = {}) {
  if (!task?.topicId) return null;
  const recovery = (state.topicRecoveryStates || []).find((item) => item.topicId === task.topicId);
  if (!recovery || recovery.status === "resolved") return recovery || null;
  const previousStatus = recovery.status;
  recovery.status = status === "done" ? "awaiting_reassessment" : "in_progress";
  recovery.version = Number(recovery.version || 0) + 1;
  recovery.updatedAt = now.toISOString();
  state.topicRecoveryStateHistory = state.topicRecoveryStateHistory || [];
  state.topicRecoveryStateHistory.push({
    id: `topic_recovery_history_${randomUUID()}`,
    userId: recovery.userId,
    topicRecoveryStateId: recovery.id,
    topicId: recovery.topicId,
    fromStatus: previousStatus,
    toStatus: recovery.status,
    evidenceIds: recovery.evidenceIds || [],
    priority: recovery.priority,
    reasonCode: status === "done" ? "TASK_COMPLETED_REASSESSMENT_REQUIRED" : "TASK_STARTED",
    version: recovery.version,
    createdAt: recovery.updatedAt,
  });
  return recovery;
}

