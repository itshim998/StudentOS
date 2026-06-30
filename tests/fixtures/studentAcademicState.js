import { createEmptyStudentState } from "../../backend/domain/studentosDomain.js";

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value, days) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

// Explicit test-only academic fixture. Runtime code must never import this file.
export function createSeedState(now = new Date()) {
  const today = dateOnly(now);
  const tomorrow = dateOnly(addDays(now, 1));
  const inThreeDays = dateOnly(addDays(now, 3));
  const nextWeek = dateOnly(addDays(now, 7));
  const state = createEmptyStudentState({
    userId: "student_demo_001",
    displayName: "Aarav",
    email: "demo@studentos.local",
  });

  state.studentProfile = {
    ...state.studentProfile,
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
  };
  state.courses = [
    { id: "course_alg2", title: "Mathematics", term: "Semester 1", teacher: "Ms. Rao", examDate: nextWeek, color: "mint", syllabusId: "syllabus_alg2", subjectIds: ["topic_quadratics", "topic_trig_basics", "topic_stats_intro"] },
    { id: "course_bio", title: "Biology", term: "Semester 1", teacher: "Mr. Sen", examDate: nextWeek, color: "amber", syllabusId: "syllabus_bio", subjectIds: ["topic_cell_cycle", "topic_ecology"] },
    { id: "course_eng", title: "English", term: "Semester 1", teacher: "Ms. Mehta", examDate: nextWeek, color: "violet", syllabusId: "syllabus_eng", subjectIds: ["topic_macbeth", "topic_argument_writing"] },
  ];
  state.topics = [
    { id: "topic_quadratics", courseId: "course_alg2", title: "Quadratic equations", coverageState: "covered", mastery: "developing", weakSignals: ["factorisation speed", "word problem setup"], sourceMaterialIds: ["src_alg_syllabus", "src_quad_notes"] },
    { id: "topic_trig_basics", courseId: "course_alg2", title: "Trigonometry basics", coverageState: "uncovered", mastery: "not_started", weakSignals: [], sourceMaterialIds: ["src_alg_syllabus"] },
    { id: "topic_stats_intro", courseId: "course_alg2", title: "Introductory statistics", coverageState: "teaching", mastery: "revision_required", weakSignals: ["median vs mean", "reading grouped data"], sourceMaterialIds: ["src_alg_syllabus", "src_stats_handout"] },
    { id: "topic_cell_cycle", courseId: "course_bio", title: "Cell cycle and mitosis", coverageState: "covered", mastery: "strong", weakSignals: ["phase ordering under time pressure"], sourceMaterialIds: ["src_bio_notes"] },
    { id: "topic_argument_writing", courseId: "course_eng", title: "Argument writing", coverageState: "covered", mastery: "secure", weakSignals: [], sourceMaterialIds: ["src_eng_rubric"] },
  ];
  state.syllabi = [
    { id: "syllabus_alg2", courseId: "course_alg2", title: "Math semester exam outline", units: ["Algebra", "Trigonometry", "Statistics"], sourceMaterialId: "src_alg_syllabus" },
    { id: "syllabus_bio", courseId: "course_bio", title: "Biology unit outline", units: ["Cell biology", "Ecology"], sourceMaterialId: "src_bio_notes" },
  ];
  state.exams = [
    { id: "exam_math_sem1", courseId: "course_alg2", title: "Mathematics Semester Exam", examDate: nextWeek, weight: 0.4 },
  ];
  state.assignments = [
    { id: "assign_quad_ws", courseId: "course_alg2", topicIds: ["topic_quadratics"], title: "Quadratics worksheet", dueDate: tomorrow, status: "due_soon", source: "mock_google_classroom", automationEligibility: "requires_contract" },
    { id: "assign_stats_review", courseId: "course_alg2", topicIds: ["topic_stats_intro"], title: "Statistics quick review", dueDate: inThreeDays, status: "open", source: "mock_google_classroom", automationEligibility: "requires_contract" },
    { id: "assign_trig_intro", courseId: "course_alg2", topicIds: ["topic_trig_basics"], title: "Trigonometry ratios practice", dueDate: nextWeek, status: "open", source: "manual_demo", automationEligibility: "requires_contract" },
    { id: "assign_bio_diagram", courseId: "course_bio", topicIds: ["topic_cell_cycle"], title: "Mitosis diagram notes", dueDate: nextWeek, status: "open", source: "manual_demo", automationEligibility: "requires_contract" },
  ];
  state.timetable = [
    { id: "class_math_today", courseId: "course_alg2", title: "Math class", startsAt: `${today}T09:00:00+05:30`, endsAt: `${today}T09:45:00+05:30`, location: "Room 204" },
    { id: "study_block_today", courseId: "course_alg2", title: "Focused revision block", startsAt: `${today}T18:30:00+05:30`, endsAt: `${today}T19:25:00+05:30`, location: "Home" },
  ];
  state.notes = [
    { id: "note_quad_summary", courseId: "course_alg2", topicId: "topic_quadratics", title: "Quadratics key methods", body: "Use factorisation when roots are clean. Use formula when factorisation stalls. Always identify a, b, c first.", sourceMaterialIds: ["src_quad_notes"] },
  ];
  state.sourceMaterials = [
    { id: "src_alg_syllabus", courseId: "course_alg2", title: "Math semester syllabus", kind: "syllabus", storageMode: "mock_metadata", citationLabel: "Math syllabus, Unit 2", webFallbackAllowed: true },
    { id: "src_quad_notes", courseId: "course_alg2", title: "Teacher notes: quadratics", kind: "teacher_note", storageMode: "mock_metadata", citationLabel: "Teacher notes, Quadratics", webFallbackAllowed: true },
    { id: "src_stats_handout", courseId: "course_alg2", title: "Class handout: statistics", kind: "uploaded_file_metadata", storageMode: "mock_metadata", citationLabel: "Class handout, Statistics", webFallbackAllowed: true },
    { id: "src_bio_notes", courseId: "course_bio", title: "Biology class notes", kind: "teacher_note", storageMode: "mock_metadata", citationLabel: "Biology notes, Cell cycle", webFallbackAllowed: true },
    { id: "src_eng_rubric", courseId: "course_eng", title: "Argument writing rubric", kind: "rubric", storageMode: "mock_metadata", citationLabel: "English rubric, Argument writing", webFallbackAllowed: false },
  ];
  state.testResults = [
    { id: "test_prev_quad", studentId: state.studentProfile.id, courseId: "course_alg2", topicId: "topic_quadratics", type: "mcq", scorePercent: 76, creditsAwarded: 1, completedAt: today },
    { id: "test_prev_stats", studentId: state.studentProfile.id, courseId: "course_alg2", topicId: "topic_stats_intro", type: "mcq", scorePercent: 64, creditsAwarded: 0, completedAt: today },
  ];
  state.creditLedger = [
    { id: "credit_prev_quad", studentId: state.studentProfile.id, sourceType: "test_result", sourceId: "test_prev_quad", amount: 1, reason: "MCQ score 76% on Quadratic equations", createdAt: today },
  ];
  state.roadmap = [
    { id: "road_quad_revision", courseId: "course_alg2", topicId: "topic_quadratics", title: "Repair factorisation speed", kind: "revision", priority: "high", dueAt: `${tomorrow}T18:00:00+05:30`, status: "open" },
    { id: "road_stats_recovery", courseId: "course_alg2", topicId: "topic_stats_intro", title: "Recover grouped-data basics", kind: "weak_topic_recovery", priority: "urgent", dueAt: `${today}T20:00:00+05:30`, status: "open" },
    { id: "road_trig_teach", courseId: "course_alg2", topicId: "topic_trig_basics", title: "Teach trigonometry from syllabus before testing", kind: "lesson_then_test", priority: "medium", dueAt: `${nextWeek}T17:00:00+05:30`, status: "open" },
  ];
  state.revisionEvents = [
    { id: "rev_quad_24h", courseId: "course_alg2", topicId: "topic_quadratics", scheduledAt: `${tomorrow}T18:00:00+05:30`, reason: "Revision inside 24 hours after developing score band." },
  ];
  state.auditLog = [
    { id: "audit_mock_bootstrap", actorId: state.studentProfile.id, action: "studentos.pass1.mock_bootstrap", riskLevel: "low", createdAt: now.toISOString() },
  ];
  return state;
}
