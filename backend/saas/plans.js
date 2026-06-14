export const USER_ROLES = Object.freeze({
  STUDENT: "student",
  PARENT_GUARDIAN: "parent_guardian_future",
  TEACHER_INSTITUTION: "teacher_institution_future",
  ADMIN_INTERNAL: "admin_internal",
});

export const ACTIVE_ROLES = Object.freeze([USER_ROLES.STUDENT]);

export const BILLING_PLANS = Object.freeze({
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
  return Object.values(BILLING_PLANS).map((plan) => ({
    id: plan.id,
    label: plan.label,
    quotas: plan.quotas,
    features: plan.features,
  }));
}
