export const USER_ROLES = Object.freeze({
  STUDENT: "student",
  PARENT_GUARDIAN: "parent_guardian_future",
  TEACHER_INSTITUTION: "teacher_institution_future",
  ADMIN_INTERNAL: "admin_internal",
});

export const ACTIVE_ROLES = Object.freeze([USER_ROLES.STUDENT]);

export const BILLING_PLANS = Object.freeze({
  starter: {
    id: "starter",
    label: "Starter",
    priceMonthlyInr: 99,
    publicHighlights: [
      "Build your academic workspace",
      "Prepare from your syllabus",
      "Know what to do today",
    ],
    quotas: {
      aiRequestsPerDay: 25,
      uploadsPerDay: 5,
      maxFileBytes: 12 * 1024 * 1024,
      maxSources: 30,
      maxCourses: 6,
      workerJobsPerDay: 20,
      reindexJobsPerDay: 8,
      storageBytes: 250 * 1024 * 1024,
    },
    features: {
      essentialLearning: true,
      advancedAutomation: false,
      groupSpaces: false,
      parentTeacherViews: false,
    },
  },
  essential: {
    id: "essential",
    label: "Essential",
    priceMonthlyInr: 159,
    publicHighlights: [
      "Import Google Classroom coursework",
      "Turn materials into a study plan",
      "Track weak topics",
    ],
    quotas: {
      aiRequestsPerDay: 70,
      uploadsPerDay: 12,
      maxFileBytes: 16 * 1024 * 1024,
      maxSources: 90,
      maxCourses: 10,
      workerJobsPerDay: 45,
      reindexJobsPerDay: 16,
      storageBytes: 1024 * 1024 * 1024,
    },
    features: {
      essentialLearning: true,
      advancedAutomation: false,
      groupSpaces: false,
      parentTeacherViews: false,
    },
  },
  plus: {
    id: "plus",
    label: "Plus",
    priceMonthlyInr: 259,
    publicHighlights: [
      "Generate revision and tests",
      "More capacity for heavier semesters",
      "Keep your study plan moving",
    ],
    quotas: {
      aiRequestsPerDay: 120,
      uploadsPerDay: 24,
      maxFileBytes: 20 * 1024 * 1024,
      maxSources: 180,
      maxCourses: 14,
      workerJobsPerDay: 80,
      reindexJobsPerDay: 28,
      storageBytes: 3 * 1024 * 1024 * 1024,
    },
    features: {
      essentialLearning: true,
      advancedAutomation: true,
      groupSpaces: false,
      parentTeacherViews: false,
    },
  },
  free: {
    id: "free",
    label: "Free",
    quotas: {
      aiRequestsPerDay: 25,
      uploadsPerDay: 5,
      maxFileBytes: 12 * 1024 * 1024,
      maxSources: 30,
      maxCourses: 6,
      workerJobsPerDay: 20,
      reindexJobsPerDay: 8,
      storageBytes: 250 * 1024 * 1024,
    },
    features: {
      essentialLearning: true,
      advancedAutomation: false,
      groupSpaces: false,
      parentTeacherViews: false,
    },
  },
  pro: {
    id: "pro",
    label: "Pro",
    priceMonthlyInr: 549,
    publicHighlights: [
      "Priority workspace preparation",
      "Deeper planning for demanding semesters",
      "More room for your academic context",
    ],
    quotas: {
      aiRequestsPerDay: 200,
      uploadsPerDay: 40,
      maxFileBytes: 24 * 1024 * 1024,
      maxSources: 300,
      maxCourses: 20,
      workerJobsPerDay: 120,
      reindexJobsPerDay: 40,
      storageBytes: 5 * 1024 * 1024 * 1024,
    },
    features: {
      essentialLearning: true,
      advancedAutomation: true,
      groupSpaces: false,
      parentTeacherViews: false,
    },
  },
  group: {
    id: "group",
    label: "Group",
    quotas: {
      aiRequestsPerDay: 800,
      uploadsPerDay: 150,
      maxFileBytes: 32 * 1024 * 1024,
      maxSources: 1200,
      maxCourses: 60,
      workerJobsPerDay: 400,
      reindexJobsPerDay: 120,
      storageBytes: 25 * 1024 * 1024 * 1024,
    },
    features: {
      essentialLearning: true,
      advancedAutomation: true,
      groupSpaces: true,
      parentTeacherViews: false,
    },
  },
  institution: {
    id: "institution",
    label: "Institution",
    quotas: {
      aiRequestsPerDay: 5000,
      uploadsPerDay: 1000,
      maxFileBytes: 64 * 1024 * 1024,
      maxSources: 10000,
      maxCourses: 500,
      workerJobsPerDay: 2500,
      reindexJobsPerDay: 1000,
      storageBytes: 500 * 1024 * 1024 * 1024,
    },
    features: {
      essentialLearning: true,
      advancedAutomation: true,
      groupSpaces: true,
      parentTeacherViews: true,
    },
  },
});

export function getPlan(planId = "free") {
  return BILLING_PLANS[String(planId || "free").toLowerCase()] || BILLING_PLANS.free;
}

export function getRole(role = USER_ROLES.STUDENT) {
  return ACTIVE_ROLES.includes(role) ? role : USER_ROLES.STUDENT;
}

export function getPublicPlanCatalog() {
  return ["starter", "essential", "plus", "pro"].map((planId) => BILLING_PLANS[planId]).map((plan) => ({
    id: plan.id,
    label: plan.label,
    priceMonthlyInr: plan.priceMonthlyInr,
    highlights: plan.publicHighlights,
  }));
}
