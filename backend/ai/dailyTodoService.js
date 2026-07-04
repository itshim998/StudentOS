import { getPreparedAcademicContextCapsule } from "../domain/academicContextService.js";
import { getAiProviderConfig } from "./providerConfig.js";
import { runProviderFallback } from "./providers.js";

const PRIORITIES = new Set(["high", "medium", "low"]);
const MAX_ITEMS = 6;

function clean(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function validDate(value) {
  const date = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) ? date : null;
}

function validTime(value) {
  const time = clean(value, 5);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
}

function validTimezone(value) {
  const timezone = clean(value, 80);
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "UTC";
  }
}

function localDateParts(now, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

export function normalizeDailyTodoClock({ currentDate, currentTime, timezone, now = new Date() } = {}) {
  const safeTimezone = validTimezone(timezone);
  const fallback = localDateParts(now, safeTimezone);
  return {
    currentDate: validDate(currentDate) || fallback.date,
    currentTime: validTime(currentTime) || fallback.time,
    timezone: safeTimezone,
  };
}

function activeItems(items = []) {
  return items.filter((item) => !item.archived && item.status !== "archived" && item.academicContextIncluded !== false);
}

export function buildDailyTodoInput(state, { currentDate, currentTime, timezone, planTier = null, now = new Date() } = {}) {
  const preparedContext = getPreparedAcademicContextCapsule(state);
  if (!preparedContext) {
    const error = new Error("Prepare Academic Context before generating today’s TO-DO list.");
    error.status = 409;
    error.code = "academic_context_not_ready";
    throw error;
  }
  const clock = normalizeDailyTodoClock({ currentDate, currentTime, timezone, now });
  const preferences = state.studentProfile?.preferences || {};
  const topics = activeItems(state.topics || []);
  return {
    ...clock,
    planTier,
    studentProfile: {
      gradeBand: state.studentProfile?.gradeBand || null,
      schoolSystem: state.studentProfile?.schoolSystem || null,
      academicGoal: preferences.academicGoal || null,
      stream: preferences.stream || null,
      classLevel: preferences.classLevel || null,
      dailyStudyAvailabilityMinutes: preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || null,
      studyBreakPattern: preferences.studyBreakPattern || null,
    },
    onboardingProfile: {
      gradeBand: state.studentProfile?.gradeBand || null,
      schoolSystem: state.studentProfile?.schoolSystem || null,
      academicGoal: preferences.academicGoal || null,
      stream: preferences.stream || null,
      classLevel: preferences.classLevel || null,
      dailyStudyAvailabilityMinutes: preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || null,
      studyBreakPattern: preferences.studyBreakPattern || null,
      studyDays: preferences.studyDays || null,
      preferredStudyTime: preferences.preferredStudyTime || null,
    },
    preparedAcademicContext: preparedContext,
    timetable: activeItems(state.timetable || []).map((item) => ({
      title: item.title,
      courseId: item.courseId || null,
      startsAt: item.startsAt || null,
      endsAt: item.endsAt || null,
    })),
    weakTopics: topics.filter((topic) => (topic.weakSignals || []).length || topic.mastery === "revision_required").map((topic) => ({
      title: topic.title,
      courseId: topic.courseId,
    })),
    completedTopics: topics.filter((topic) => topic.coverageState === "covered" || ["secure", "strong"].includes(topic.mastery)).map((topic) => ({
      title: topic.title,
      courseId: topic.courseId,
    })),
    existingPlanForToday: state.studentProfile?.dailyTodoPlan?.date === clock.currentDate
      ? state.studentProfile.dailyTodoPlan
      : null,
  };
}

export function hasUsefulDailyTodoContext(input = {}) {
  const context = input.preparedAcademicContext || {};
  return Boolean(
    context.assignments?.length ||
    context.exams?.length ||
    context.syllabi?.some((item) => item.units?.length || item.summary) ||
    context.materials?.some((item) => item.readyForStudy && item.summary),
  );
}

function daysUntil(date, currentDate) {
  const target = Date.parse(`${String(date || "").slice(0, 10)}T12:00:00.000Z`);
  const current = Date.parse(`${currentDate}T12:00:00.000Z`);
  return Number.isFinite(target) && Number.isFinite(current) ? Math.ceil((target - current) / 86_400_000) : null;
}

function remainingStudyMinutes(input) {
  const [hour, minute] = input.currentTime.split(":").map(Number);
  const dayRemaining = Math.max(20, (23 * 60) - (hour * 60 + minute));
  const preferred = Number(input.studentProfile?.dailyStudyAvailabilityMinutes || 0);
  return preferred > 0 ? Math.max(20, Math.min(dayRemaining, preferred)) : Math.min(dayRemaining, 180);
}

function deterministicCandidates(input) {
  const context = input.preparedAcademicContext;
  const deadlineCandidates = [];
  const representedCourses = new Set();
  const syllabusByCourse = new Map((context.syllabi || []).map((item) => [String(item.courseId || ""), item]));
  const activeAssignments = (context.assignments || [])
    .filter((item) => !item.handedIn && !["done", "completed", "submitted", "graded", "returned"].includes(String(item.status || "").toLowerCase()))
    .sort((left, right) => Date.parse(left.dueAt || "") - Date.parse(right.dueAt || ""));
  for (const assignment of activeAssignments.slice(0, 3)) {
    const days = daysUntil(assignment.dueAt, input.currentDate);
    representedCourses.add(String(assignment.courseId || assignment.courseTitle || ""));
    deadlineCandidates.push({
      title: `Move ${assignment.title} forward`,
      reason: days !== null && days <= 1 ? "This is the nearest assignment deadline." : "This keeps upcoming due work under control.",
      related_course: assignment.courseTitle || "",
      related_context: assignment.description || assignment.title,
      priority: days !== null && days <= 2 ? "high" : "medium",
      duration: days !== null && days <= 1 ? 50 : 40,
      dueInDays: days ?? 10_000,
      deadlineType: "assignment",
    });
  }
  const upcomingExams = [...(context.exams || [])]
    .sort((left, right) => Date.parse(left.examDate || "") - Date.parse(right.examDate || ""));
  for (const exam of upcomingExams.slice(0, 3)) {
    const days = daysUntil(exam.examDate, input.currentDate);
    if (days !== null && days < 0) continue;
    const syllabus = syllabusByCourse.get(String(exam.courseId || ""));
    const topics = (syllabus?.units || []).slice(0, 3).map((unit) => typeof unit === "string" ? unit : unit?.title).filter(Boolean);
    representedCourses.add(String(exam.courseId || exam.courseTitle || ""));
    deadlineCandidates.push({
      title: `Review for ${exam.title}`,
      reason: days === 0
        ? "The exam is today, so use a short focused review."
        : `${days !== null ? `The exam is in ${days} day${days === 1 ? "" : "s"}.` : "This exam is upcoming."}${topics.length ? ` Start with ${topics.join(", ")}.` : " Build syllabus coverage now."}`,
      related_course: exam.courseTitle || "",
      related_context: [exam.title, exam.notes, syllabus?.title].filter(Boolean).join(" / "),
      priority: days !== null && days <= 7 ? "high" : "medium",
      duration: days === 0 ? 30 : 40,
      dueInDays: days ?? 10_000,
      deadlineType: "exam",
    });
  }

  deadlineCandidates.sort((left, right) => left.dueInDays - right.dueInDays || (left.deadlineType === "assignment" ? -1 : 1));
  const candidates = deadlineCandidates;
  const parallelContext = [
    ...(context.syllabi || []).filter((item) => item.units?.length || item.summary),
    ...(context.materials || []).filter((item) => item.readyForStudy && item.summary),
  ];
  for (const material of parallelContext) {
    const courseKey = String(material.courseId || material.courseTitle || material.id || "");
    if (representedCourses.has(courseKey)) continue;
    representedCourses.add(courseKey);
    candidates.push({
      title: `Build coverage in ${material.courseTitle || material.title}`,
      reason: "Keep this lower-priority subject moving in parallel while nearer exams and deadlines stay first.",
      related_course: material.courseTitle || "",
      related_context: material.title,
      priority: "low",
      duration: 25,
    });
  }
  return candidates;
}

export function buildDeterministicDailyTodoPlan(input, { now = new Date() } = {}) {
  let remaining = remainingStudyMinutes(input);
  const items = [];
  for (const candidate of deterministicCandidates(input)) {
    if (items.length >= MAX_ITEMS || remaining < 20) break;
    const duration = Math.max(20, Math.min(candidate.duration, remaining));
    items.push({
      title: candidate.title,
      time_hint: `${duration} minutes`,
      reason: candidate.reason,
      related_course: candidate.related_course,
      related_context: candidate.related_context,
      priority: candidate.priority,
    });
    remaining -= duration;
  }
  if (!items.length) {
    const error = new Error("Add your syllabus, assignments, or exam dates first so StudentOS can generate a useful plan.");
    error.status = 400;
    error.code = "academic_context_too_weak";
    throw error;
  }
  return {
    date: input.currentDate,
    generated_at: now.toISOString(),
    timezone: input.timezone,
    summary: "A focused plan for the rest of today.",
    items,
  };
}

export function buildDailyTodoMessages(input) {
  return [
    {
      role: "system",
      content: [
        "You are StudentOS. Build a practical study TO-DO list only for the rest of today.",
        "Prioritize current local date and time, remaining day, nearest exams, exam syllabus coverage, assignment due dates and handed-in status, prepared material, timetable, weak/completed topics, and the student's study rhythm.",
        "Put the most urgent exam or assignment first, then the next urgent subject, while keeping lower-priority subjects moving in parallel when time allows.",
        "Do not invent courses, assignments, exams, or materials. Keep every reason concrete and calm.",
        "Return only valid JSON with keys date, generated_at, summary, and items.",
        "Each item must contain title, time_hint, reason, related_course, related_context, and priority (high, medium, or low).",
        `Return between 1 and ${MAX_ITEMS} items.`,
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify(input),
    },
  ];
}

function parseProviderJson(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  return JSON.parse(cleaned);
}

export function normalizeDailyTodoPlan(value, input, { now = new Date() } = {}) {
  const items = Array.isArray(value?.items) ? value.items.slice(0, MAX_ITEMS).map((item) => ({
    title: clean(item?.title, 180),
    time_hint: clean(item?.time_hint || item?.timeHint, 80),
    reason: clean(item?.reason, 320),
    related_course: clean(item?.related_course || item?.relatedCourse, 140),
    related_context: clean(item?.related_context || item?.relatedContext, 220),
    priority: PRIORITIES.has(String(item?.priority || "").toLowerCase()) ? String(item.priority).toLowerCase() : "medium",
  })).filter((item) => item.title && item.reason && item.time_hint) : [];
  if (!items.length) throw new Error("daily_todo_invalid_shape");
  return {
    date: input.currentDate,
    generated_at: now.toISOString(),
    timezone: input.timezone,
    summary: clean(value?.summary, 280) || "A focused plan for the rest of today.",
    items,
  };
}

function isGroundedDailyTodoPlan(plan, input) {
  const context = input.preparedAcademicContext || {};
  const known = [
    ...(context.courses || []).flatMap((item) => [item.title]),
    ...(context.assignments || []).flatMap((item) => [item.title, item.description]),
    ...(context.exams || []).flatMap((item) => [item.title, item.notes]),
    ...(context.syllabi || []).flatMap((item) => [item.title, item.summary]),
    ...(context.materials || []).flatMap((item) => [item.title, item.summary]),
  ].map((value) => clean(value, 500).toLowerCase()).filter(Boolean);
  return plan.items.every((item) => {
    const references = [item.related_course, item.related_context].map((value) => clean(value, 500).toLowerCase()).filter(Boolean);
    return references.length > 0 && references.some((reference) => known.some((value) => value.includes(reference) || reference.includes(value)));
  });
}

export async function generateDailyTodoPlan({
  state,
  currentDate,
  currentTime,
  timezone,
  planTier = null,
  now = new Date(),
  providerConfig = getAiProviderConfig(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const input = buildDailyTodoInput(state, { currentDate, currentTime, timezone, planTier, now });
  if (!hasUsefulDailyTodoContext(input)) {
    const error = new Error("Add your syllabus, assignments, or exam dates first so StudentOS can generate a useful plan.");
    error.status = 400;
    error.code = "academic_context_too_weak";
    throw error;
  }
  if (["mock", "bridge"].includes(providerConfig.requestedMode)) {
    return {
      generationSucceeded: true,
      plan: buildDeterministicDailyTodoPlan(input, { now }),
      input,
    };
  }
  const result = await runProviderFallback({
    messages: buildDailyTodoMessages(input),
    config: providerConfig,
    fetchImpl,
  });
  if (result.providerFailure || !result.text) {
    return { generationSucceeded: false, retryable: true, plan: null, input };
  }
  try {
    const normalized = normalizeDailyTodoPlan(parseProviderJson(result.text), input, { now });
    return {
      generationSucceeded: true,
      plan: isGroundedDailyTodoPlan(normalized, input) ? normalized : buildDeterministicDailyTodoPlan(input, { now }),
      input,
    };
  } catch {
    return { generationSucceeded: false, retryable: true, plan: null, input };
  }
}
