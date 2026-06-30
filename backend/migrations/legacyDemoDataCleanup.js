const LEGACY_FIXTURE_IDS = new Map(Object.entries({
  courses: ["course_alg2", "course_bio", "course_eng", "course_mathematics", "course_biology", "course_english"],
  topics: [
    "topic_quadratics", "topic_trig_basics", "topic_stats_intro", "topic_cell_cycle", "topic_ecology", "topic_macbeth", "topic_argument_writing",
    "topic_mathematics_quadratic_equations", "topic_mathematics_trigonometry_basics", "topic_mathematics_statistics",
    "topic_biology_cell_cycle_and_mitosis", "topic_biology_ecology", "topic_biology_phase_ordering",
    "topic_english_argument_writing", "topic_english_macbeth",
  ],
  syllabi: ["syllabus_alg2", "syllabus_bio", "syllabus_mathematics", "syllabus_biology", "syllabus_english"],
  exams: ["exam_math_sem1", "exam_course_mathematics", "exam_course_biology", "exam_course_english"],
  assignments: ["assign_quad_ws", "assign_stats_review", "assign_trig_intro", "assign_bio_diagram"],
  timetable: ["class_math_today", "study_block_today", "class_mon_1", "class_tue_2", "class_thu_3"],
  notes: ["note_quad_summary"],
  sourceMaterials: ["src_alg_syllabus", "src_quad_notes", "src_stats_handout", "src_bio_notes", "src_eng_rubric"],
  testResults: ["test_prev_quad", "test_prev_stats"],
  creditLedger: ["credit_prev_quad"],
  roadmap: [
    "road_quad_revision", "road_stats_recovery", "road_trig_teach",
    "road_exam_course_mathematics", "road_exam_course_biology", "road_exam_course_english",
    "road_weak_topic_mathematics_trigonometry_basics", "road_weak_topic_mathematics_statistics", "road_weak_topic_biology_phase_ordering",
    "road_24h_topic_mathematics_quadratic_equations", "road_24h_topic_biology_cell_cycle_and_mitosis", "road_24h_topic_english_argument_writing",
  ],
  revisionEvents: [
    "rev_quad_24h", "rev_onboarding_topic_mathematics_quadratic_equations", "rev_onboarding_topic_biology_cell_cycle_and_mitosis", "rev_onboarding_topic_english_argument_writing",
  ],
  auditLog: ["audit_mock_bootstrap"],
}).map(([key, ids]) => [key, new Set(ids)]));

const LEGACY_PROFILE_GENERATED_IDS = new Map(Object.entries({
  courses: ["course_mathematics", "course_biology", "course_english"],
  topics: [
    "topic_mathematics_quadratic_equations", "topic_mathematics_trigonometry_basics", "topic_mathematics_statistics",
    "topic_biology_cell_cycle_and_mitosis", "topic_biology_ecology", "topic_biology_phase_ordering",
    "topic_english_argument_writing", "topic_english_macbeth",
  ],
  syllabi: ["syllabus_mathematics", "syllabus_biology", "syllabus_english"],
  exams: ["exam_course_mathematics", "exam_course_biology", "exam_course_english"],
  timetable: ["class_mon_1", "class_tue_2", "class_thu_3"],
  roadmap: [
    "road_exam_course_mathematics", "road_exam_course_biology", "road_exam_course_english",
    "road_weak_topic_mathematics_trigonometry_basics", "road_weak_topic_mathematics_statistics", "road_weak_topic_biology_phase_ordering",
    "road_24h_topic_mathematics_quadratic_equations", "road_24h_topic_biology_cell_cycle_and_mitosis", "road_24h_topic_english_argument_writing",
  ],
  revisionEvents: [
    "rev_onboarding_topic_mathematics_quadratic_equations", "rev_onboarding_topic_biology_cell_cycle_and_mitosis", "rev_onboarding_topic_english_argument_writing",
  ],
}).map(([key, ids]) => [key, new Set(ids)]));

export function removeLegacyDemoArtifacts(state = {}, collectionKeys = []) {
  const profile = state.studentProfile || {};
  const preferences = profile.preferences || {};
  const auditHasFixtureAction = (state.auditLog || []).some((item) => item?.action === "demo_onboarding.seeded" || item?.action === "studentos.pass1.mock_bootstrap");
  const hasFixtureFingerprint = auditHasFixtureAction || [
    profile.schoolSystem === "CBSE-style demo",
    profile.displayName === "Aarav",
    preferences.stream === "Science",
    preferences.classLevel === "Grade 10",
  ].filter(Boolean).length >= 3;
  for (const key of collectionKeys) {
    const fixtureIds = LEGACY_FIXTURE_IDS.get(key);
    if (!fixtureIds?.size || !Array.isArray(state[key])) continue;
    const generatedIds = LEGACY_PROFILE_GENERATED_IDS.get(key);
    state[key] = state[key].filter((item) => {
      const id = String(item?.id || "");
      if (!fixtureIds.has(id)) return true;
      return generatedIds?.has(id) && !hasFixtureFingerprint;
    });
  }
  if (Array.isArray(state.auditLog)) {
    state.auditLog = state.auditLog.filter((item) => !["demo_onboarding.seeded", "studentos.pass1.mock_bootstrap"].includes(item?.action));
  }
  if (hasFixtureFingerprint) {
    if (profile.displayName === "Aarav") profile.displayName = "";
    if (profile.gradeBand === "Grade 10" || profile.gradeBand === "high_school") profile.gradeBand = null;
    if (profile.schoolSystem === "CBSE-style demo") profile.schoolSystem = null;
    if (preferences.stream === "Science") preferences.stream = "";
    if (preferences.classLevel === "Grade 10" || preferences.classLevel === "high_school") preferences.classLevel = "";
    if (preferences.academicGoal === "exam_prep") preferences.academicGoal = "";
    if (Number(preferences.dailyStudyAvailabilityMinutes) === 105 || Number(preferences.dailyStudyWindowMinutes) === 95) {
      delete preferences.dailyStudyAvailabilityMinutes;
      delete preferences.dailyStudyWindowMinutes;
    }
    if (preferences.studyBreakPattern === "25/5") delete preferences.studyBreakPattern;
  }
  return state;
}
