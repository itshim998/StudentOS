import { isAcademicContextRecord } from "../connectors/googleClassroom/mapper.js";

function slug(value, fallback = "item") {
  const clean = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return clean || fallback;
}

function nowIso(now = new Date()) {
  return now.toISOString();
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDate(value, fallback = null) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function dateOnly(value) {
  const date = toDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

function unique(values) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function splitList(value) {
  if (Array.isArray(value)) return unique(value);
  return unique(String(value || "").split(/[,;\n]/g));
}

function parseSubjectLines(value, now = new Date()) {
  if (Array.isArray(value)) return value;
  const lines = String(value || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    const [titleRaw, examRaw, topicsRaw] = line.split("|").map((part) => part?.trim());
    return {
      title: titleRaw || `Subject ${index + 1}`,
      teacher: "",
      examDate: dateOnly(examRaw) || null,
      topics: splitList(topicsRaw),
    };
  });
}

function parseWeakTopicLines(value) {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [courseRaw, topicsRaw] = line.split(":").map((part) => part?.trim());
      const topics = splitList(topicsRaw || courseRaw);
      return topics.map((topic) => ({
        courseTitle: topicsRaw ? courseRaw : "",
        title: topic,
      }));
    });
}

function parseTopicSignalLines(value) {
  return parseWeakTopicLines(value);
}

function parseTimetableLines(value, courses = [], now = new Date()) {
  if (Array.isArray(value)) return value;
  const lines = String(value || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    const [dayRaw, timeRaw, titleRaw, courseRaw] = line.split("|").map((part) => part?.trim());
    if (!line.includes("|") || !timeRaw || (!titleRaw && !courseRaw)) return null;
    const startDate = addDays(now, index % 5);
    const [startHour = "18", startMinute = "00"] = String(timeRaw).split("-")[0].split(":");
    startDate.setHours(Number(startHour) || 18, Number(startMinute) || 0, 0, 0);
    const endDate = addHours(startDate, 1);
    const courseTitle = courseRaw || titleRaw || courses[index % Math.max(1, courses.length)]?.title;
    const course = courses.find((item) => item.title.toLowerCase() === String(courseTitle || "").toLowerCase()) || courses[index % Math.max(1, courses.length)];
    return {
      id: `class_${slug(dayRaw || titleRaw || "block")}_${index + 1}`,
      courseId: course?.id || null,
      title: titleRaw || `${course?.title || "Study"} block`,
      startsAt: startDate.toISOString(),
      endsAt: endDate.toISOString(),
      location: dayRaw || "Planned",
    };
  }).filter(Boolean);
}

function normalizeBreakPattern(value) {
  const raw = String(value || "").trim();
  if (!raw) return { label: "", focusMinutes: null, breakMinutes: null };
  const match = raw.match(/(\d+)\D+(\d+)/);
  if (!match) return { label: raw, focusMinutes: null, breakMinutes: null };
  return {
    label: `${match[1]}/${match[2]}`,
    focusMinutes: Number(match[1]),
    breakMinutes: Number(match[2]),
  };
}

function findCourseForWeakTopic(courses, weakTopic) {
  if (weakTopic.courseTitle) {
    const match = courses.find((course) => course.title.toLowerCase() === String(weakTopic.courseTitle).toLowerCase());
    if (match) return match;
  }
  return courses.find((course) =>
    (course.topics || []).some((topic) => topic.toLowerCase() === String(weakTopic.title || "").toLowerCase())) ||
    courses[0];
}

function buildTopic({ course, title, weak = false, completed = false, index = 0 }) {
  return {
    id: `topic_${slug(course.title)}_${slug(title || `topic_${index + 1}`)}`,
    courseId: course.id,
    title: title || `${course.title} foundations`,
    coverageState: completed ? "covered" : weak ? "teaching" : "uncovered",
    mastery: completed ? "developing" : weak ? "revision_required" : "not_started",
    weakSignals: weak ? ["onboarding weak topic"] : [],
    sourceMaterialIds: [],
    createdAt: nowIso(),
  };
}

export function normalizeOnboardingPayload(payload = {}, now = new Date()) {
  const breakPattern = normalizeBreakPattern(payload.studyBreakPattern);
  const coursesInput = parseSubjectLines(payload.courses || payload.subjects || payload.subjectsText, now);
  const normalizedCourses = coursesInput.filter((course) => String(course?.title || "").trim()).map((course, index) => ({
    id: course.id || `course_${slug(course.title || `subject_${index + 1}`)}`,
    title: course.title || `Subject ${index + 1}`,
    term: course.term || payload.term || "",
    teacher: course.teacher || "",
    examDate: dateOnly(course.examDate) || null,
    color: course.color || ["mint", "amber", "violet", "sky"][index % 4],
    topics: splitList(course.topics || course.topicsText),
  }));
  const weakTopics = parseWeakTopicLines(payload.weakTopics || payload.weakTopicsText);
  const completedTopics = parseTopicSignalLines(payload.completedTopics || payload.completedTopicsText);
  return {
    displayName: String(payload.displayName || payload.name || "").trim(),
    stream: payload.stream || "",
    degree: payload.degree || "",
    yearSemester: payload.yearSemester || "",
    classLevel: payload.classLevel || payload.gradeBand || "",
    schoolSystem: payload.schoolSystem || "",
    academicGoal: payload.academicGoal || "",
    dailyStudyAvailabilityMinutes: Number(payload.dailyStudyAvailabilityMinutes || payload.dailyStudyMinutes) || null,
    scheduleText: String(payload.scheduleText || payload.schedule || (!String(payload.timetableText || "").includes("|") ? payload.timetableText : "") || "").trim(),
    examPattern: String(payload.examPattern || "").trim(),
    syllabusNotes: String(payload.syllabusNotes || "").trim(),
    breakPattern,
    courses: normalizedCourses,
    weakTopics,
    completedTopics,
    timetable: parseTimetableLines(payload.timetable || payload.classSchedule || payload.timetableText, normalizedCourses, now),
  };
}

function examPriority(course, now = new Date()) {
  const examDate = toDate(course.examDate, addDays(now, 30));
  const days = Math.max(0, Math.ceil((examDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  if (days <= 3) return "urgent";
  if (days <= 10) return "high";
  if (days <= 21) return "medium";
  return "low";
}

export function generateAcademicRoadmap(state, { now = new Date() } = {}) {
  const items = [];
  const weakTopicIds = new Set((state.topics || []).filter(isAcademicContextRecord)
    .filter((topic) => (topic.weakSignals || []).length || topic.mastery === "revision_required")
    .map((topic) => topic.id));
  const coursesByExam = [...(state.courses || [])].filter(isAcademicContextRecord)
    .sort((left, right) => toDate(left.examDate, addDays(now, 90)) - toDate(right.examDate, addDays(now, 90)));

  for (const course of coursesByExam) {
    const courseTopics = (state.topics || []).filter((topic) => topic.courseId === course.id && isAcademicContextRecord(topic));
    const firstWeak = courseTopics.find((topic) => weakTopicIds.has(topic.id)) || courseTopics[0] || null;
    const priority = examPriority(course, now);
    if (course.examDate) {
      items.push({
        id: `road_exam_${course.id}`,
        courseId: course.id,
        topicId: firstWeak?.id || null,
        title: `Build ${course.title} exam roadmap`,
        kind: "exam_roadmap",
        priority,
        dueAt: addDays(now, priority === "urgent" ? 0 : 1).toISOString(),
        status: "open",
        examPressure: priority,
      });
    }
    for (const topic of courseTopics.filter((item) => weakTopicIds.has(item.id)).slice(0, 3)) {
      items.push({
        id: `road_weak_${topic.id}`,
        courseId: course.id,
        topicId: topic.id,
        title: `Repair weak topic: ${topic.title}`,
        kind: "weak_topic_recovery",
        priority: priority === "low" ? "medium" : priority,
        dueAt: addDays(now, 1).toISOString(),
        status: "open",
        examPressure: priority,
      });
    }
    for (const topic of courseTopics.filter((item) => ["strong", "secure", "developing"].includes(item.mastery)).slice(0, 1)) {
      items.push({
        id: `road_24h_${topic.id}`,
        courseId: course.id,
        topicId: topic.id,
        title: `24-hour revision: ${topic.title}`,
        kind: "revision_24h",
        priority: "medium",
        dueAt: addDays(now, 1).toISOString(),
        status: "open",
        examPressure: priority,
      });
    }
  }

  const dueWork = [...(state.assignments || [])]
    .filter((assignment) => isAcademicContextRecord(assignment) && !assignment.handedIn && !["done", "completed", "returned", "graded", "submitted"].includes(String(assignment.status || "").toLowerCase()))
    .sort((left, right) => toDate(left.dueDate, addDays(now, 90)) - toDate(right.dueDate, addDays(now, 90)))
    .slice(0, 3);
  for (const assignment of dueWork) {
    items.push({
      id: `road_due_${assignment.id}`,
      courseId: assignment.courseId,
      topicId: assignment.topicIds?.[0] || null,
      title: `Protect due work: ${assignment.title}`,
      kind: "due_work_control",
      priority: "high",
      dueAt: toDate(assignment.dueDate, addDays(now, 2)).toISOString(),
      status: "open",
    });
  }

  return items.sort((left, right) => {
    const priority = { urgent: 0, high: 1, medium: 2, low: 3 };
    const diff = (priority[left.priority] ?? 9) - (priority[right.priority] ?? 9);
    if (diff !== 0) return diff;
    return toDate(left.dueAt, addDays(now, 99)) - toDate(right.dueAt, addDays(now, 99));
  });
}

export function applyStudentOnboarding(state, payload = {}, { now = new Date() } = {}) {
  const normalized = normalizeOnboardingPayload(payload, now);
  const timestamp = nowIso(now);
  const onboardingCourses = normalized.courses.map((course) => ({
    id: course.id,
    title: course.title,
    term: course.term,
    teacher: course.teacher,
    examDate: course.examDate,
    color: course.color,
    syllabusId: `syllabus_${slug(course.title)}`,
    subjectIds: [],
    source: "onboarding",
    createdAt: timestamp,
  }));
  const onboardingIds = new Set(onboardingCourses.map((course) => course.id));
  const onboardingTitles = new Set(onboardingCourses.map((course) => course.title.toLowerCase()));
  const preservedCourses = (state.courses || []).filter((course) =>
    isAcademicContextRecord(course) &&
    ["manual", "google_classroom"].includes(course.source) &&
    !onboardingIds.has(course.id) &&
    !onboardingTitles.has(String(course.title || "").toLowerCase()));
  const courses = [...onboardingCourses, ...preservedCourses];
  const topics = [];
  const weakTopicRecords = [];
  for (const course of normalized.courses) {
    const courseWeakTopics = normalized.weakTopics.filter((weak) => findCourseForWeakTopic(normalized.courses, weak)?.id === course.id);
    const courseCompletedTopics = normalized.completedTopics.filter((completed) => findCourseForWeakTopic(normalized.courses, completed)?.id === course.id);
    const topicNames = unique([
      ...(course.topics || []),
      ...courseWeakTopics.map((weak) => weak.title),
      ...courseCompletedTopics.map((completed) => completed.title),
    ]);
    const builtTopics = topicNames.map((title, index) => buildTopic({
          course,
          title,
          weak: courseWeakTopics.some((weak) => String(weak.title).toLowerCase() === String(title).toLowerCase()),
          completed: courseCompletedTopics.some((completed) => String(completed.title).toLowerCase() === String(title).toLowerCase()),
          index,
        }));
    topics.push(...builtTopics);
    weakTopicRecords.push(...builtTopics.filter((topic) => topic.weakSignals.length));
    const targetCourse = courses.find((item) => item.id === course.id);
    targetCourse.subjectIds = builtTopics.map((topic) => topic.id);
  }

  state.studentProfile = {
    ...state.studentProfile,
    displayName: normalized.displayName || state.studentProfile.displayName || "",
    gradeBand: normalized.classLevel || null,
    schoolSystem: normalized.schoolSystem || null,
    preferences: {
      ...(state.studentProfile.preferences || {}),
      academicGoal: normalized.academicGoal,
      stream: normalized.stream,
      degree: normalized.degree,
      yearSemester: normalized.yearSemester,
      classLevel: normalized.classLevel,
      dailyStudyAvailabilityMinutes: normalized.dailyStudyAvailabilityMinutes,
      studyBreakPattern: normalized.breakPattern.label,
      breakCycleMinutes: normalized.breakPattern.focusMinutes,
      breakMinutes: normalized.breakPattern.breakMinutes,
      scheduleText: normalized.scheduleText,
      examPattern: normalized.examPattern,
      syllabusNotes: normalized.syllabusNotes,
      subjectsText: String(payload.subjectsText || payload.subjects || "").trim(),
      weakTopicsText: String(payload.weakTopicsText || "").trim(),
      completedTopicsText: String(payload.completedTopicsText || "").trim(),
      timetableText: String(payload.timetableText || "").trim(),
      weakTopicIds: weakTopicRecords.map((topic) => topic.id),
      onboardingCompletedAt: timestamp,
    },
  };

  state.courses = courses;
  state.topics = topics;
  state.syllabi = courses.map((course) => ({
    id: course.syllabusId,
    courseId: course.id,
    title: `${course.title} academic plan`,
    units: topics.filter((topic) => topic.courseId === course.id).map((topic) => topic.title),
    sourceMaterialId: null,
    createdAt: timestamp,
  })).filter((syllabus) => syllabus.units.length > 0);
  state.exams = courses.filter((course) => course.examDate).map((course) => ({
    id: `exam_${course.id}`,
    courseId: course.id,
    title: `${course.title} exam`,
    examDate: course.examDate,
    weight: 1,
    createdAt: timestamp,
  }));
  state.timetable = normalized.timetable;
  state.roadmap = generateAcademicRoadmap(state, { now });
  state.revisionEvents = [
    ...(state.revisionEvents || []),
    ...topics
      .filter((topic) => ["strong", "secure", "developing"].includes(topic.mastery))
      .map((topic) => ({
        id: `rev_onboarding_${topic.id}`,
        courseId: topic.courseId,
        topicId: topic.id,
        scheduledAt: addDays(now, 1).toISOString(),
        reason: "Revision within 24 hours after completed topic signal.",
      })),
  ];
  state.auditLog = state.auditLog || [];
  state.auditLog.push({
    id: `audit_onboarding_${Date.now()}`,
    actorId: state.studentProfile.id,
    action: "student_onboarding.completed",
    targetType: "student_profile",
    targetId: state.studentProfile.id,
    riskLevel: "low",
    metadata: {
      courseCount: courses.length,
      weakTopicCount: weakTopicRecords.length,
      academicGoal: normalized.academicGoal,
    },
    createdAt: timestamp,
  });

  return {
    profile: state.studentProfile,
    courses,
    topics,
    exams: state.exams,
    timetable: state.timetable,
    roadmap: state.roadmap,
    weakTopics: weakTopicRecords,
    academicGoal: normalized.academicGoal,
    studyBreakPattern: normalized.breakPattern,
  };
}

export function bindProductOnboardingStep(state, step, { now = new Date() } = {}) {
  const answers = state.studentProfile?.productLifecycle?.onboarding?.answers || {};
  const about = answers.about_you || {};
  const education = answers.education_system || {};
  const schedule = answers.daily_schedule || {};
  const exams = answers.exam_pattern || {};
  const academic = answers.academic_context || {};
  const profile = state.studentProfile || { id: "student_unknown", preferences: {} };
  profile.displayName = String(about.displayName || profile.displayName || "").trim();
  profile.gradeBand = String(education.level || "").trim() || null;
  profile.schoolSystem = String(education.institution || "").trim() || null;
  profile.preferences = {
    ...(profile.preferences || {}),
    institution: String(education.institution || "").trim(),
    classLevel: String(education.level || "").trim(),
    stream: String(education.stream || "").trim(),
    yearSemester: String(education.yearSemester || "").trim(),
    scheduleText: String(schedule.schedule || "").trim(),
    examPattern: String(exams.examPattern || "").trim(),
    syllabusNotes: String(academic.syllabusNotes || "").trim(),
  };
  state.studentProfile = profile;
  if (step !== "academic_context") return { profile };
  return applyStudentOnboarding(state, {
    displayName: profile.displayName,
    stream: profile.preferences.stream,
    degree: profile.preferences.yearSemester,
    yearSemester: profile.preferences.yearSemester,
    classLevel: profile.preferences.classLevel,
    schoolSystem: profile.preferences.institution,
    scheduleText: profile.preferences.scheduleText,
    examPattern: profile.preferences.examPattern,
    syllabusNotes: profile.preferences.syllabusNotes,
    subjectsText: String(academic.subjects || "").trim(),
  }, { now });
}

export function hydrateSavedProductOnboarding(state, { now = new Date() } = {}) {
  const lifecycle = state.studentProfile?.productLifecycle;
  const completedSteps = lifecycle?.onboarding?.completedSteps || [];
  const answers = lifecycle?.onboarding?.answers || {};
  if (!completedSteps.length || !Object.keys(answers).length) return false;
  const preferences = state.studentProfile.preferences || {};
  if (preferences.onboardingDataVersion === 1) return false;
  const shouldBuildAcademicState = completedSteps.includes("academic_context") &&
    !(state.courses || []).length &&
    String(answers.academic_context?.subjects || "").trim();
  bindProductOnboardingStep(state, shouldBuildAcademicState ? "academic_context" : "profile_only", { now });
  state.studentProfile.preferences.onboardingDataVersion = 1;
  return true;
}
