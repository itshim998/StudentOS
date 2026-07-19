import { allocateStudySlots } from "../domain/studyAvailabilityService.js";
import { ensureDailyTodoStudyState } from "../ai/studyMaterialService.js";
import { RECOVERY_FAILURES, RecoveryError } from "./recoveryErrors.js";

function minutes(item) {
  return Math.max(0, Number(item?.duration_minutes || item?.durationMinutes || 0));
}

function activityTitle(intent) {
  const prefix = {
    concept_review: "Review concepts in",
    worked_examples: "Work examples for",
    targeted_practice: "Practice",
    retrieval_practice: "Recall",
    reassessment: "Reassess",
    resume_unfinished: "Resume",
  }[intent.activityType] || "Review";
  return `${prefix} ${intent.topicTitle}`;
}

function recoveryTask(intent) {
  return {
    id: `todo:${intent.id}`,
    recovery_intent_id: intent.id,
    title: activityTitle(intent),
    reason: intent.explanation,
    reason_code: intent.reasonCode,
    related_course: "",
    related_context: intent.topicTitle,
    courseId: intent.courseId,
    topicId: intent.topicId,
    evidenceIds: intent.evidenceIds,
    activityType: intent.activityType,
    priority: intent.priority >= 60 ? "high" : intent.priority >= 35 ? "medium" : "low",
    priority_score: intent.priority,
    duration_minutes: intent.recommendedMinutes,
    study_status: "not_started",
    study_completed_at: null,
  };
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
}

export function buildRecoveryPlanPreview(snapshot, intents, { now = new Date() } = {}) {
  const state = snapshot.state || {};
  const basePlan = state.currentPlan;
  const capacity = Math.max(0, Number(state.availability?.capacityMinutes || 0));
  const completed = (basePlan?.items || []).filter((item) => ["done", "completed"].includes(item.studyStatus)).map((item) => ({
    id: item.id,
    title: item.title,
    courseId: item.courseId,
    topicId: item.topicId,
    priority: item.priority,
    duration_minutes: item.durationMinutes,
    scheduled_start: item.scheduledStart,
    scheduled_end: item.scheduledEnd,
    study_status: "done",
    study_completed_at: item.completedAt,
    unchanged_completed: true,
  }));
  const unfinished = (basePlan?.items || []).filter((item) => !["done", "completed"].includes(item.studyStatus)).map((item) => ({
    id: item.id,
    title: item.title,
    courseId: item.courseId,
    topicId: item.topicId,
    priority: item.priority,
    duration_minutes: Math.max(20, Number(item.durationMinutes || 30)),
    study_status: item.studyStatus || "not_started",
    reason: "This unfinished work is retained from the current plan.",
    reason_code: "UNFINISHED_WORK_RETAINED",
  }));
  const activeIntents = intents.filter((intent) => intent.status !== "resolved" && intent.evidenceStrength !== "insufficient" && intent.priority >= 35);
  const representedCourses = new Set(activeIntents.map((item) => item.courseId));
  const courseLimit = representedCourses.size > 1 ? Math.floor(capacity * 0.5) : capacity;
  const courseMinutes = new Map();
  const recovery = [];
  const deferred = [];
  for (const intent of [...activeIntents].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))) {
    const used = courseMinutes.get(intent.courseId) || 0;
    if (representedCourses.size > 1 && used + intent.recommendedMinutes > courseLimit) {
      deferred.push({ ...intent, reasonCode: "COURSE_FOCUS_LIMIT", explanation: "Deferred to prevent one course from consuming most available study time." });
      continue;
    }
    recovery.push(recoveryTask(intent));
    courseMinutes.set(intent.courseId, used + intent.recommendedMinutes);
  }
  const candidates = uniqueById([...unfinished, ...recovery]).sort((left, right) => Number(right.priority_score || (right.priority === "high" ? 60 : right.priority === "medium" ? 35 : 1)) - Number(left.priority_score || (left.priority === "high" ? 60 : left.priority === "medium" ? 35 : 1)));
  let remaining = capacity;
  const selected = [];
  for (const item of candidates) {
    const duration = Math.max(20, Math.min(minutes(item) || 30, 60));
    if (duration > remaining) {
      deferred.push({
        id: item.recovery_intent_id || item.id,
        topicId: item.topicId || null,
        courseId: item.courseId || null,
        title: item.title,
        recommendedMinutes: duration,
        reasonCode: "INSUFFICIENT_AVAILABLE_TIME",
        explanation: "Retained for a later plan because the remaining availability is insufficient.",
      });
      continue;
    }
    selected.push({ ...item, duration_minutes: duration });
    remaining -= duration;
  }
  const slots = allocateStudySlots(state.availability || {}, selected.map(minutes));
  const scheduled = selected.map((item, index) => ({
    ...item,
    time_hint: `${minutes(item)} minutes · ${slots[index].suggestedWindow}`,
    suggested_window: slots[index].suggestedWindow,
    scheduled_start: slots[index].scheduledStart,
    scheduled_end: slots[index].scheduledEnd,
  }));
  const plan = ensureDailyTodoStudyState({
    date: state.clock?.currentDate,
    generated_at: now.toISOString(),
    timezone: state.clock?.timezone,
    summary: deferred.length ? "A feasible recovery plan with lower-priority work retained for later." : "A focused recovery plan for the rest of today.",
    items: [...completed, ...scheduled],
    availability: {
      capacityMinutes: capacity,
      originalText: state.availability?.originalText || "",
    },
  });
  return { plan, deferredWork: deferred, basePlan };
}

function overlaps(left, right) {
  if (!left.scheduled_start || !left.scheduled_end || !right.scheduled_start || !right.scheduled_end) return false;
  const leftStart = timeValue(left.scheduled_start);
  const leftEnd = timeValue(left.scheduled_end);
  const rightStart = timeValue(right.scheduled_start);
  const rightEnd = timeValue(right.scheduled_end);
  return [leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite) && leftStart < rightEnd && rightStart < leftEnd;
}

function timeValue(value) {
  const clock = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function withinWindow(item, window) {
  const start = timeValue(item.scheduled_start);
  const end = timeValue(item.scheduled_end);
  return Number.isFinite(start) && Number.isFinite(end) && start >= Number(window.start) && end <= Number(window.end);
}

function overlapsCommitment(item, commitment) {
  return overlaps(item, {
    scheduled_start: commitment.startTime,
    scheduled_end: commitment.endTime,
  });
}

export function validateRecoveryPlan({ plan, basePlan, deferredWork = [], snapshot, state = null, correlationId = null }) {
  const topics = new Set((state?.topics || snapshot?.state?.topics || []).map((item) => String(item.id)));
  const courses = new Set((state?.courses || snapshot?.state?.courses || []).map((item) => String(item.id)));
  const evidence = new Set((snapshot?.state?.evidence || []).map((item) => String(item.id)));
  const ids = new Set();
  const items = plan?.items || [];
  for (const item of items) {
    if (!item.id || ids.has(item.id)) throw new RecoveryError(RECOVERY_FAILURES.PLAN_INFEASIBLE, "The proposed plan contains duplicate tasks.", { correlationId });
    ids.add(item.id);
    if (item.courseId && !courses.has(String(item.courseId))) throw new RecoveryError(RECOVERY_FAILURES.PLAN_INFEASIBLE, "The proposed plan references an unknown course.", { correlationId });
    if (item.topicId && !topics.has(String(item.topicId))) throw new RecoveryError(RECOVERY_FAILURES.PLAN_INFEASIBLE, "The proposed plan references an unknown topic.", { correlationId });
    if ((item.evidenceIds || []).some((id) => !evidence.has(String(id)))) throw new RecoveryError(RECOVERY_FAILURES.EVIDENCE_INVALID, "The proposed plan references unknown evidence.", { correlationId });
    if (item.recovery_intent_id && (minutes(item) < 20 || minutes(item) > 60)) throw new RecoveryError(RECOVERY_FAILURES.PLAN_INFEASIBLE, "Recovery tasks must be between 20 and 60 minutes.", { correlationId });
    if (item.study_status !== "done" && minutes(item) < 0) throw new RecoveryError(RECOVERY_FAILURES.PLAN_INFEASIBLE, "The proposed plan contains an invalid task duration.", { correlationId });
    if (item.study_status !== "done" && (snapshot?.state?.availability?.exactWindows || []).length &&
        !(snapshot.state.availability.exactWindows || []).some((window) => withinWindow(item, window))) {
      throw new RecoveryError(RECOVERY_FAILURES.PLAN_INFEASIBLE, "The proposed plan falls outside recorded availability.", { correlationId });
    }
    if (item.study_status !== "done" && (snapshot?.state?.availability?.fixedCommitments || []).some((commitment) => overlapsCommitment(item, commitment))) {
      throw new RecoveryError(RECOVERY_FAILURES.PLAN_INFEASIBLE, "The proposed plan overlaps a fixed commitment.", { correlationId });
    }
  }
  for (let index = 0; index < items.length; index += 1) {
    for (let other = index + 1; other < items.length; other += 1) if (overlaps(items[index], items[other])) throw new RecoveryError(RECOVERY_FAILURES.PLAN_INFEASIBLE, "The proposed plan contains overlapping tasks.", { correlationId });
  }
  const plannedMinutes = items.filter((item) => item.study_status !== "done").reduce((sum, item) => sum + minutes(item), 0);
  if (plannedMinutes > Number(snapshot?.state?.availability?.capacityMinutes || 0)) throw new RecoveryError(RECOVERY_FAILURES.PLAN_INFEASIBLE, "The proposed plan exceeds available study time.", { correlationId });
  for (const completed of (basePlan?.items || []).filter((item) => ["done", "completed"].includes(item.studyStatus))) {
    const preserved = items.find((item) => item.id === completed.id);
    if (!preserved || preserved.study_status !== "done" || preserved.title !== completed.title ||
        preserved.courseId !== completed.courseId || preserved.topicId !== completed.topicId || preserved.priority !== completed.priority ||
        preserved.scheduled_start !== completed.scheduledStart || preserved.scheduled_end !== completed.scheduledEnd ||
        preserved.study_completed_at !== completed.completedAt || minutes(preserved) !== Number(completed.durationMinutes || 0)) {
      throw new RecoveryError(RECOVERY_FAILURES.PLAN_INFEASIBLE, "Completed work must remain unchanged.", { correlationId });
    }
  }
  const deferredIds = new Set((deferredWork || []).flatMap((item) => [item.id, item.recovery_intent_id]).filter(Boolean));
  for (const unfinished of (basePlan?.items || []).filter((item) => !["done", "completed"].includes(item.studyStatus))) {
    if (!items.some((item) => item.id === unfinished.id) && !deferredIds.has(unfinished.id)) {
      throw new RecoveryError(RECOVERY_FAILURES.PLAN_INFEASIBLE, "Unfinished work must be scheduled or explicitly deferred.", { correlationId });
    }
  }
  return true;
}

export function generatePlanDiff(basePlan, proposedPlan, deferredWork = []) {
  const before = new Map((basePlan?.items || []).map((item) => [item.id, item]));
  const after = new Map((proposedPlan?.items || []).map((item) => [item.id, item]));
  const deferredIds = new Set(deferredWork.flatMap((item) => [item.id, item.recovery_intent_id]).filter(Boolean));
  const changes = [];
  for (const [id, item] of after) {
    const previous = before.get(id);
    let changeType = "unchanged";
    if (!previous) changeType = item.activityType === "reassessment" ? "reassessment_added" : "task_added";
    else if ((previous.scheduledStart || null) !== (item.scheduled_start || null)) changeType = "task_moved";
    else if (Number(previous.durationMinutes || 0) !== minutes(item)) changeType = "duration_changed";
    else if ((previous.priority || "medium") !== (item.priority || "medium")) changeType = "priority_changed";
    changes.push({
      changeType,
      taskId: id,
      topicId: item.topicId || previous?.topicId || null,
      courseId: item.courseId || previous?.courseId || null,
      before: previous || null,
      after: item,
      reasonCode: item.reason_code || (changeType === "unchanged" ? "UNCHANGED" : "RECOVERY_PLAN_UPDATE"),
      explanation: item.reason || "The task remains unchanged.",
      supportingEvidenceIds: item.evidenceIds || [],
    });
  }
  for (const [id, item] of before) {
    if (after.has(id) || deferredIds.has(id)) continue;
    changes.push({
      changeType: ["done", "completed"].includes(item.studyStatus) ? "unchanged" : "task_removed",
      taskId: id,
      topicId: item.topicId || null,
      courseId: item.courseId || null,
      before: item,
      after: null,
      reasonCode: "OBSOLETE_RECOVERY_WORK",
      explanation: "The task is no longer supported by the latest recovery state.",
      supportingEvidenceIds: [],
    });
  }
  for (const item of deferredWork) changes.push({
    changeType: "task_deferred",
    taskId: item.id,
    topicId: item.topicId || null,
    courseId: item.courseId || null,
    before: null,
    after: item,
    reasonCode: item.reasonCode,
    explanation: item.explanation,
    supportingEvidenceIds: item.evidenceIds || [],
  });
  return changes;
}
