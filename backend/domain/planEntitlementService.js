export const PLAN_KEYS = Object.freeze({
  TRIAL: "trial",
  STARTER: "starter",
  ESSENTIAL: "essential",
  PLUS: "plus",
  PRO: "pro",
});

export const PAID_PLAN_KEYS = Object.freeze([
  PLAN_KEYS.STARTER,
  PLAN_KEYS.ESSENTIAL,
  PLAN_KEYS.PLUS,
  PLAN_KEYS.PRO,
]);

export const ALL_PLAN_KEYS = Object.freeze([
  PLAN_KEYS.TRIAL,
  ...PAID_PLAN_KEYS,
]);

export const FEATURE_KEYS = Object.freeze({
  ROADMAP_BASIC: "roadmap.basic",
  ROADMAP_ADAPTIVE: "roadmap.adaptive",
  TODO_DAILY: "todo.daily",
  TODO_ADAPTIVE: "todo.adaptive",
  SYLLABUS_UPDATES: "syllabus_updates.allowed",
  EXAM_TIMELINE_UPDATES: "exam_timeline_updates.allowed",
  MANUAL_UPLOAD: "manual_upload.enabled",
  CLASSROOM_MANUAL_IMPORT: "classroom.manual_import.enabled",
  CLASSROOM_AUTO_CHECK: "classroom.auto_check.enabled",
  CLASSROOM_AUTO_CHECK_INTERVAL_DAYS: "classroom.auto_check_interval_days",
  ASSESSMENT_BASIC: "assessment.basic.enabled",
  ASSESSMENT_EXPANDED: "assessment.expanded.enabled",
  MOCK_TESTS: "mock_tests.enabled",
  NOTES_GENERATION: "notes.generation.enabled",
  NOTES_VISUALS: "notes.visuals.enabled",
  FLASHCARDS: "flashcards.enabled",
  ASSISTANT: "assistant.enabled",
  ASSISTANT_DEPTH: "assistant.depth",
  ASSISTANT_DAILY_BUDGET: "assistant.daily_budget",
  ASSISTANT_HEAVY_ACTION_BUDGET: "assistant.heavy_action_budget",
  LEARNING_LEVEL: "learning_level.enabled",
  LEARNING_LEVEL_ADAPTIVE_DIFFICULTY: "learning_level.adaptive_difficulty",
  CONSISTENCY_POINTS: "consistency_points.enabled",
  ASSIGNMENT_COACH: "assignment_coach.enabled",
  ASSIGNMENT_REVIEW: "assignment_review.enabled",
  ASSIGNMENT_WRITEBACK: "assignment_writeback.enabled",
});

export const CLASSROOM_WRITE_ACTIONS = Object.freeze([
  "writeback",
  "assignment_submission",
  "automatic_assignment_submission",
  "hidden_submission",
  "grade_modification",
  "turn_in",
  "delete",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const PUBLIC_PLAN_SUMMARIES = deepFreeze({
  trial: {
    planKey: "trial",
    displayName: "Trial Mode",
    priceMonthlyInr: null,
    priceDisplay: "7-day Trial Mode",
    positioning: "A limited way to try your guided academic workspace.",
    featureBullets: [
      "A guided first study plan",
      "Limited manual material import",
      "Basic tests and revision",
      "Ask StudentOS for guided help",
      "One Classroom coursework check during Trial Mode",
    ],
    bestFor: "Trying the core StudentOS workflow before your selected plan begins.",
    recommended: false,
  },
  starter: {
    planKey: "starter",
    displayName: "Starter",
    priceMonthlyInr: 99,
    priceDisplay: "₹99/month",
    positioning: "For students who need daily structure.",
    featureBullets: [
      "Daily study plan from your syllabus",
      "Adaptive To-Do list",
      "Manual material upload",
      "Basic tests and revision",
      "Ask StudentOS for guided help",
    ],
    bestFor: "One focused semester.",
    recommended: false,
  },
  essential: {
    planKey: "essential",
    displayName: "Essential",
    priceMonthlyInr: 159,
    priceDisplay: "₹159/month",
    positioning: "Recommended for regular school or college use.",
    featureBullets: [
      "Everything in Starter",
      "Weekly Classroom coursework checks",
      "Flashcards for active subjects",
      "Visual notes with simple diagrams",
      "More tests, revision, and study material",
      "More room for your academic context",
    ],
    bestFor: "Regular school or college use.",
    recommended: true,
  },
  plus: {
    planKey: "plus",
    displayName: "Plus",
    priceMonthlyInr: 259,
    priceDisplay: "₹259/month",
    positioning: "For heavier semesters and deeper preparation.",
    featureBullets: [
      "Everything in Essential",
      "More frequent Classroom checks",
      "Roadmaps adapt to your Learning Level",
      "Deeper explanations and stronger planning",
      "More visual notes and flowcharts",
      "Higher support for mock tests and assignments",
    ],
    bestFor: "Engineering, exam-heavy months, and deeper preparation.",
    recommended: false,
  },
  pro: {
    planKey: "pro",
    displayName: "Pro",
    priceMonthlyInr: 549,
    priceDisplay: "₹549/month",
    positioning: "Highest support for serious exam seasons.",
    featureBullets: [
      "Everything in Plus",
      "Consistency Points for steady study habits",
      "Priority roadmap and assignment preparation",
      "Advanced assignment checking",
      "Strongest tests, revision, and study material support",
      "Built for intense semesters",
    ],
    bestFor: "High-intensity students and serious exam prep.",
    recommended: false,
  },
});

const COMMON_DISABLED_WRITE_ACTIONS = Object.freeze(Object.fromEntries(
  CLASSROOM_WRITE_ACTIONS.map((action) => [action, false]),
));

function featurePolicy(overrides = {}) {
  return {
    [FEATURE_KEYS.ROADMAP_BASIC]: true,
    [FEATURE_KEYS.ROADMAP_ADAPTIVE]: false,
    [FEATURE_KEYS.TODO_DAILY]: true,
    [FEATURE_KEYS.TODO_ADAPTIVE]: false,
    [FEATURE_KEYS.SYLLABUS_UPDATES]: true,
    [FEATURE_KEYS.EXAM_TIMELINE_UPDATES]: true,
    [FEATURE_KEYS.MANUAL_UPLOAD]: true,
    [FEATURE_KEYS.CLASSROOM_MANUAL_IMPORT]: true,
    [FEATURE_KEYS.CLASSROOM_AUTO_CHECK]: false,
    [FEATURE_KEYS.CLASSROOM_AUTO_CHECK_INTERVAL_DAYS]: null,
    [FEATURE_KEYS.ASSESSMENT_BASIC]: true,
    [FEATURE_KEYS.ASSESSMENT_EXPANDED]: false,
    [FEATURE_KEYS.MOCK_TESTS]: false,
    [FEATURE_KEYS.NOTES_GENERATION]: false,
    [FEATURE_KEYS.NOTES_VISUALS]: false,
    [FEATURE_KEYS.FLASHCARDS]: false,
    [FEATURE_KEYS.ASSISTANT]: true,
    [FEATURE_KEYS.ASSISTANT_DEPTH]: "guided",
    [FEATURE_KEYS.ASSISTANT_DAILY_BUDGET]: 4,
    [FEATURE_KEYS.ASSISTANT_HEAVY_ACTION_BUDGET]: 2,
    [FEATURE_KEYS.LEARNING_LEVEL]: false,
    [FEATURE_KEYS.LEARNING_LEVEL_ADAPTIVE_DIFFICULTY]: false,
    [FEATURE_KEYS.CONSISTENCY_POINTS]: false,
    [FEATURE_KEYS.ASSIGNMENT_COACH]: false,
    [FEATURE_KEYS.ASSIGNMENT_REVIEW]: false,
    [FEATURE_KEYS.ASSIGNMENT_WRITEBACK]: false,
    ...overrides,
  };
}

function hiddenLimits(overrides = {}) {
  return {
    maxSyllabusTimelineUpdatesPerMonth: 1,
    maxExamTimelineUpdatesPerMonth: 1,
    maxRoadmapRegenerationsPerMonth: 1,
    maxMockTestsPerMonth: 1,
    maxGeneratedStudyMaterialsPerMonth: 2,
    assistantDailyBudget: 4,
    heavyActionBudgetPerMonth: 2,
    classroomAutoCheckIntervalDays: 4,
    academicContextTier: "trial",
    priorityLevel: "standard",
    aiRequestsPerDay: 4,
    uploadsPerDay: 2,
    maxFileBytes: 8 * 1024 * 1024,
    maxSources: 5,
    maxCourses: 4,
    workerJobsPerDay: 8,
    reindexJobsPerDay: 2,
    storageBytes: 40 * 1024 * 1024,
    ...overrides,
  };
}

function planDefinition({
  planKey,
  features,
  limits,
  classroom,
  assistant,
  academicContext,
}) {
  const publicSummary = PUBLIC_PLAN_SUMMARIES[planKey];
  return deepFreeze({
    planKey,
    displayName: publicSummary.displayName,
    isTrial: planKey === PLAN_KEYS.TRIAL,
    isPaid: PAID_PLAN_KEYS.includes(planKey),
    publicSummary,
    features,
    hiddenLimits: limits,
    classroom: {
      manualImportEnabled: features[FEATURE_KEYS.CLASSROOM_MANUAL_IMPORT] === true,
      autoCheckEnabled: features[FEATURE_KEYS.CLASSROOM_AUTO_CHECK] === true,
      intervalDays: features[FEATURE_KEYS.CLASSROOM_AUTO_CHECK_INTERVAL_DAYS],
      metadataOnly: true,
      readOnly: true,
      writeActions: COMMON_DISABLED_WRITE_ACTIONS,
      ...classroom,
    },
    assistant: {
      enabled: features[FEATURE_KEYS.ASSISTANT] === true,
      depth: features[FEATURE_KEYS.ASSISTANT_DEPTH],
      dailyBudget: features[FEATURE_KEYS.ASSISTANT_DAILY_BUDGET],
      heavyActionBudgetPerMonth: features[FEATURE_KEYS.ASSISTANT_HEAVY_ACTION_BUDGET],
      ...assistant,
    },
    academicContext: {
      tier: limits.academicContextTier,
      capacityWarningAtPercent: 90,
      userManagedSelectedMaterials: true,
      automaticSelectedMaterialDeletion: false,
      ...academicContext,
    },
  });
}

const PLAN_ENTITLEMENTS = deepFreeze({
  trial: planDefinition({
    planKey: "trial",
    features: featurePolicy({
      [FEATURE_KEYS.CLASSROOM_AUTO_CHECK]: true,
      [FEATURE_KEYS.CLASSROOM_AUTO_CHECK_INTERVAL_DAYS]: 4,
      [FEATURE_KEYS.MOCK_TESTS]: true,
    }),
    limits: hiddenLimits(),
    classroom: {
      oncePerTrial: true,
      cadenceLabel: "One coursework check during Trial Mode",
    },
    assistant: { depthLabel: "Guided help" },
    academicContext: { tierLabel: "Trial academic context" },
  }),
  starter: planDefinition({
    planKey: "starter",
    features: featurePolicy({
      [FEATURE_KEYS.TODO_ADAPTIVE]: true,
      [FEATURE_KEYS.MOCK_TESTS]: true,
      [FEATURE_KEYS.NOTES_GENERATION]: true,
      [FEATURE_KEYS.ASSISTANT_DAILY_BUDGET]: 10,
      [FEATURE_KEYS.ASSISTANT_HEAVY_ACTION_BUDGET]: 8,
    }),
    limits: hiddenLimits({
      maxSyllabusTimelineUpdatesPerMonth: 4,
      maxExamTimelineUpdatesPerMonth: 4,
      maxRoadmapRegenerationsPerMonth: 2,
      maxMockTestsPerMonth: 4,
      maxGeneratedStudyMaterialsPerMonth: 6,
      assistantDailyBudget: 10,
      heavyActionBudgetPerMonth: 8,
      classroomAutoCheckIntervalDays: null,
      academicContextTier: "focused",
      aiRequestsPerDay: 10,
      uploadsPerDay: 5,
      maxFileBytes: 12 * 1024 * 1024,
      maxSources: 30,
      maxCourses: 6,
      workerJobsPerDay: 20,
      reindexJobsPerDay: 8,
      storageBytes: 120 * 1024 * 1024,
    }),
    classroom: { oncePerTrial: false, cadenceLabel: "Manual coursework checks" },
    assistant: { depthLabel: "Guided help" },
    academicContext: { tierLabel: "Focused academic context" },
  }),
  essential: planDefinition({
    planKey: "essential",
    features: featurePolicy({
      [FEATURE_KEYS.TODO_ADAPTIVE]: true,
      [FEATURE_KEYS.CLASSROOM_AUTO_CHECK]: true,
      [FEATURE_KEYS.CLASSROOM_AUTO_CHECK_INTERVAL_DAYS]: 7,
      [FEATURE_KEYS.ASSESSMENT_EXPANDED]: true,
      [FEATURE_KEYS.MOCK_TESTS]: true,
      [FEATURE_KEYS.NOTES_GENERATION]: true,
      [FEATURE_KEYS.NOTES_VISUALS]: true,
      [FEATURE_KEYS.FLASHCARDS]: true,
      [FEATURE_KEYS.ASSISTANT_DEPTH]: "expanded",
      [FEATURE_KEYS.ASSISTANT_DAILY_BUDGET]: 20,
      [FEATURE_KEYS.ASSISTANT_HEAVY_ACTION_BUDGET]: 18,
    }),
    limits: hiddenLimits({
      maxSyllabusTimelineUpdatesPerMonth: 8,
      maxExamTimelineUpdatesPerMonth: 8,
      maxRoadmapRegenerationsPerMonth: 5,
      maxMockTestsPerMonth: 8,
      maxGeneratedStudyMaterialsPerMonth: 14,
      assistantDailyBudget: 20,
      heavyActionBudgetPerMonth: 18,
      classroomAutoCheckIntervalDays: 7,
      academicContextTier: "expanded",
      priorityLevel: "enhanced",
      aiRequestsPerDay: 20,
      uploadsPerDay: 10,
      maxFileBytes: 16 * 1024 * 1024,
      maxSources: 70,
      maxCourses: 10,
      workerJobsPerDay: 40,
      reindexJobsPerDay: 16,
      storageBytes: 250 * 1024 * 1024,
    }),
    classroom: { oncePerTrial: false, cadenceLabel: "Weekly coursework checks" },
    assistant: { depthLabel: "Expanded help" },
    academicContext: { tierLabel: "Expanded academic context" },
  }),
  plus: planDefinition({
    planKey: "plus",
    features: featurePolicy({
      [FEATURE_KEYS.ROADMAP_ADAPTIVE]: true,
      [FEATURE_KEYS.TODO_ADAPTIVE]: true,
      [FEATURE_KEYS.CLASSROOM_AUTO_CHECK]: true,
      [FEATURE_KEYS.CLASSROOM_AUTO_CHECK_INTERVAL_DAYS]: 5,
      [FEATURE_KEYS.ASSESSMENT_EXPANDED]: true,
      [FEATURE_KEYS.MOCK_TESTS]: true,
      [FEATURE_KEYS.NOTES_GENERATION]: true,
      [FEATURE_KEYS.NOTES_VISUALS]: true,
      [FEATURE_KEYS.FLASHCARDS]: true,
      [FEATURE_KEYS.ASSISTANT_DEPTH]: "deep",
      [FEATURE_KEYS.ASSISTANT_DAILY_BUDGET]: 35,
      [FEATURE_KEYS.ASSISTANT_HEAVY_ACTION_BUDGET]: 32,
      [FEATURE_KEYS.LEARNING_LEVEL]: true,
      [FEATURE_KEYS.LEARNING_LEVEL_ADAPTIVE_DIFFICULTY]: true,
      [FEATURE_KEYS.ASSIGNMENT_COACH]: true,
    }),
    limits: hiddenLimits({
      maxSyllabusTimelineUpdatesPerMonth: 14,
      maxExamTimelineUpdatesPerMonth: 14,
      maxRoadmapRegenerationsPerMonth: 8,
      maxMockTestsPerMonth: 16,
      maxGeneratedStudyMaterialsPerMonth: 28,
      assistantDailyBudget: 35,
      heavyActionBudgetPerMonth: 32,
      classroomAutoCheckIntervalDays: 5,
      academicContextTier: "deep",
      priorityLevel: "priority",
      aiRequestsPerDay: 35,
      uploadsPerDay: 18,
      maxFileBytes: 20 * 1024 * 1024,
      maxSources: 150,
      maxCourses: 14,
      workerJobsPerDay: 70,
      reindexJobsPerDay: 28,
      storageBytes: 400 * 1024 * 1024,
    }),
    classroom: { oncePerTrial: false, cadenceLabel: "Coursework checks every five days" },
    assistant: { depthLabel: "Deeper help and planning" },
    academicContext: { tierLabel: "Deep academic context" },
  }),
  pro: planDefinition({
    planKey: "pro",
    features: featurePolicy({
      [FEATURE_KEYS.ROADMAP_ADAPTIVE]: true,
      [FEATURE_KEYS.TODO_ADAPTIVE]: true,
      [FEATURE_KEYS.CLASSROOM_AUTO_CHECK]: true,
      [FEATURE_KEYS.CLASSROOM_AUTO_CHECK_INTERVAL_DAYS]: 3,
      [FEATURE_KEYS.ASSESSMENT_EXPANDED]: true,
      [FEATURE_KEYS.MOCK_TESTS]: true,
      [FEATURE_KEYS.NOTES_GENERATION]: true,
      [FEATURE_KEYS.NOTES_VISUALS]: true,
      [FEATURE_KEYS.FLASHCARDS]: true,
      [FEATURE_KEYS.ASSISTANT_DEPTH]: "strongest",
      [FEATURE_KEYS.ASSISTANT_DAILY_BUDGET]: 50,
      [FEATURE_KEYS.ASSISTANT_HEAVY_ACTION_BUDGET]: 50,
      [FEATURE_KEYS.LEARNING_LEVEL]: true,
      [FEATURE_KEYS.LEARNING_LEVEL_ADAPTIVE_DIFFICULTY]: true,
      [FEATURE_KEYS.CONSISTENCY_POINTS]: true,
      [FEATURE_KEYS.ASSIGNMENT_COACH]: true,
      [FEATURE_KEYS.ASSIGNMENT_REVIEW]: true,
    }),
    limits: hiddenLimits({
      maxSyllabusTimelineUpdatesPerMonth: 24,
      maxExamTimelineUpdatesPerMonth: 24,
      maxRoadmapRegenerationsPerMonth: 12,
      maxMockTestsPerMonth: 28,
      maxGeneratedStudyMaterialsPerMonth: 45,
      assistantDailyBudget: 50,
      heavyActionBudgetPerMonth: 50,
      classroomAutoCheckIntervalDays: 3,
      academicContextTier: "highest",
      priorityLevel: "highest",
      aiRequestsPerDay: 50,
      uploadsPerDay: 28,
      maxFileBytes: 24 * 1024 * 1024,
      maxSources: 300,
      maxCourses: 20,
      workerJobsPerDay: 100,
      reindexJobsPerDay: 40,
      storageBytes: 650 * 1024 * 1024,
    }),
    classroom: { oncePerTrial: false, cadenceLabel: "Coursework checks every three days" },
    assistant: { depthLabel: "Strongest help and planning" },
    academicContext: { tierLabel: "Highest academic context" },
  }),
});

const UNSELECTED_ENTITLEMENTS = deepFreeze({
  planKey: null,
  displayName: "Setup required",
  isTrial: false,
  isPaid: false,
  publicSummary: null,
  features: Object.fromEntries(Object.values(FEATURE_KEYS).map((key) => [key, false])),
  hiddenLimits: hiddenLimits({
    maxSyllabusTimelineUpdatesPerMonth: 0,
    maxExamTimelineUpdatesPerMonth: 0,
    maxRoadmapRegenerationsPerMonth: 0,
    maxMockTestsPerMonth: 0,
    maxGeneratedStudyMaterialsPerMonth: 0,
    assistantDailyBudget: 0,
    heavyActionBudgetPerMonth: 0,
    classroomAutoCheckIntervalDays: null,
    academicContextTier: "unselected",
    aiRequestsPerDay: 0,
    uploadsPerDay: 0,
    maxFileBytes: 0,
    maxSources: 0,
    maxCourses: 0,
    workerJobsPerDay: 0,
    reindexJobsPerDay: 0,
    storageBytes: 0,
  }),
  classroom: {
    manualImportEnabled: false,
    autoCheckEnabled: false,
    intervalDays: null,
    metadataOnly: true,
    readOnly: true,
    oncePerTrial: false,
    cadenceLabel: "Available after setup",
    writeActions: COMMON_DISABLED_WRITE_ACTIONS,
  },
  assistant: {
    enabled: false,
    depth: "disabled",
    depthLabel: "Available after setup",
    dailyBudget: 0,
    heavyActionBudgetPerMonth: 0,
  },
  academicContext: {
    tier: "unselected",
    tierLabel: "Available after setup",
    capacityWarningAtPercent: 90,
    userManagedSelectedMaterials: true,
    automaticSelectedMaterialDeletion: false,
  },
});

export function normalizePlanKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ALL_PLAN_KEYS.includes(normalized) ? normalized : null;
}

export function isPaidPlan(planKey) {
  return PAID_PLAN_KEYS.includes(normalizePlanKey(planKey));
}

export function isTrialPlan(planKey) {
  return normalizePlanKey(planKey) === PLAN_KEYS.TRIAL;
}

export function getPlanEntitlements(planKey) {
  const normalized = normalizePlanKey(planKey);
  return normalized ? PLAN_ENTITLEMENTS[normalized] : UNSELECTED_ENTITLEMENTS;
}

export function getPublicPlanSummary(planKey) {
  const normalized = normalizePlanKey(planKey);
  if (!normalized) return null;
  const summary = PUBLIC_PLAN_SUMMARIES[normalized];
  return {
    ...summary,
    id: summary.planKey,
    label: summary.displayName,
    highlights: [...summary.featureBullets],
  };
}

export function getPublicPlanSummaries() {
  return PAID_PLAN_KEYS.map(getPublicPlanSummary);
}

export function canUseFeature(planKey, featureKey) {
  const value = getPlanEntitlements(planKey).features[String(featureKey || "")];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return Boolean(value && !["disabled", "none"].includes(String(value).toLowerCase()));
}

export function getFeatureLimit(planKey, featureKey) {
  const value = getPlanEntitlements(planKey).features[String(featureKey || "")];
  return value === undefined ? null : value;
}

export function getClassroomSyncPolicy(planKey) {
  return getPlanEntitlements(planKey).classroom;
}

export function getAssistantPolicy(planKey) {
  return getPlanEntitlements(planKey).assistant;
}

export function getAcademicContextPolicy(planKey) {
  return getPlanEntitlements(planKey).academicContext;
}

export function canUseClassroomAction(planKey, action) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!CLASSROOM_WRITE_ACTIONS.includes(normalizedAction)) return false;
  return getClassroomSyncPolicy(planKey).writeActions[normalizedAction] === true;
}

export function getPublicEntitlementSummary(planKey) {
  const entitlements = getPlanEntitlements(planKey);
  return {
    planKey: entitlements.planKey,
    displayName: entitlements.displayName,
    trialMode: entitlements.isTrial,
    paidPlan: entitlements.isPaid,
    assistant: {
      enabled: entitlements.assistant.enabled,
      depth: entitlements.assistant.depthLabel,
    },
    classroom: {
      manualImportEnabled: entitlements.classroom.manualImportEnabled,
      automaticChecksEnabled: entitlements.classroom.autoCheckEnabled,
      cadence: entitlements.classroom.cadenceLabel,
      readOnly: true,
    },
    academicContext: {
      level: entitlements.academicContext.tierLabel,
    },
    learningLevelEnabled: canUseFeature(planKey, FEATURE_KEYS.LEARNING_LEVEL),
    consistencyPointsEnabled: canUseFeature(planKey, FEATURE_KEYS.CONSISTENCY_POINTS),
    assignmentCoachEnabled: canUseFeature(planKey, FEATURE_KEYS.ASSIGNMENT_COACH),
    assignmentReviewEnabled: canUseFeature(planKey, FEATURE_KEYS.ASSIGNMENT_REVIEW),
    assignmentWritebackEnabled: false,
  };
}

export function getLegacyPlanShape(planKey) {
  const entitlements = getPlanEntitlements(planKey);
  return {
    id: entitlements.planKey || "unselected",
    label: entitlements.displayName,
    priceMonthlyInr: entitlements.publicSummary?.priceMonthlyInr ?? null,
    publicHighlights: entitlements.publicSummary ? [...entitlements.publicSummary.featureBullets] : [],
    quotas: { ...entitlements.hiddenLimits },
    features: {
      essentialLearning: entitlements.planKey !== null,
      advancedAutomation: [PLAN_KEYS.PLUS, PLAN_KEYS.PRO].includes(entitlements.planKey),
      groupSpaces: false,
      parentTeacherViews: false,
    },
  };
}
