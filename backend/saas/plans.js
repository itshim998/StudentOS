import {
  ALL_PLAN_KEYS,
  getLegacyPlanShape,
  getPublicPlanSummaries,
  normalizePlanKey,
} from "../domain/planEntitlementService.js";

export const USER_ROLES = Object.freeze({
  STUDENT: "student",
  PARENT_GUARDIAN: "parent_guardian_future",
  TEACHER_INSTITUTION: "teacher_institution_future",
  ADMIN_INTERNAL: "admin_internal",
});

export const ACTIVE_ROLES = Object.freeze([USER_ROLES.STUDENT]);

export const BILLING_PLANS = Object.freeze(Object.fromEntries(
  ALL_PLAN_KEYS.map((planKey) => [planKey, Object.freeze(getLegacyPlanShape(planKey))]),
));

const UNSELECTED_PLAN = Object.freeze(getLegacyPlanShape(null));

export function getPlan(planId = null) {
  const normalized = normalizePlanKey(planId);
  return normalized ? BILLING_PLANS[normalized] : UNSELECTED_PLAN;
}

export function getRole(role = USER_ROLES.STUDENT) {
  return ACTIVE_ROLES.includes(role) ? role : USER_ROLES.STUDENT;
}

export function getPublicPlanCatalog() {
  return getPublicPlanSummaries();
}
