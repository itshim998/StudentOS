import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getAccountSnapshot } from "./account/accountService.js";
import { resolveEntitlements } from "./billing/billingService.js";
import { getSaasConfig, getPublicSaasStatus } from "./config/saasConfig.js";
import { getSupabaseEnvironment } from "./config/supabaseEnv.js";
import {
  ALL_PLAN_KEYS,
  CLASSROOM_WRITE_ACTIONS,
  FEATURE_KEYS,
  PAID_PLAN_KEYS,
  canUseClassroomAction,
  canUseFeature,
  getAcademicContextPolicy,
  getAssistantPolicy,
  getClassroomSyncPolicy,
  getFeatureLimit,
  getPlanEntitlements,
  getPublicEntitlementSummary,
  getPublicPlanSummaries,
  getPublicPlanSummary,
  isPaidPlan,
  isTrialPlan,
  normalizePlanKey,
} from "./domain/planEntitlementService.js";
import {
  getProductLifecycleSnapshot,
  normalizeProductLifecycle,
} from "./domain/productLifecycleService.js";
import { initialStateForUser } from "./repository/studentOsRepository.js";

const validPlans = ["trial", "starter", "essential", "plus", "pro"];
assert.deepEqual(ALL_PLAN_KEYS, validPlans);
assert.deepEqual(PAID_PLAN_KEYS, validPlans.slice(1));
for (const planKey of validPlans) {
  assert.equal(normalizePlanKey(planKey.toUpperCase()), planKey);
}
assert.equal(normalizePlanKey("free"), null);
assert.equal(normalizePlanKey("group"), null);
assert.equal(normalizePlanKey(""), null);
assert.equal(normalizePlanKey(null), null);
assert.equal(isTrialPlan("trial"), true);
assert.equal(isPaidPlan("trial"), false);
assert.equal(isPaidPlan("starter"), true);

const publicPlans = getPublicPlanSummaries();
assert.deepEqual(publicPlans.map((plan) => plan.priceDisplay), [
  "₹99/month",
  "₹159/month",
  "₹259/month",
  "₹549/month",
]);
assert.deepEqual(publicPlans.map((plan) => plan.priceMonthlyInr), [99, 159, 259, 549]);
assert.equal(publicPlans.find((plan) => plan.planKey === "essential")?.recommended, true);
assert.equal(publicPlans.filter((plan) => plan.recommended).length, 1);
assert.equal(new Set(publicPlans.map((plan) => plan.positioning)).size, 4);
assert(publicPlans.every((plan) => plan.featureBullets.length >= 5 && plan.featureBullets.length <= 6));
assert(publicPlans.every((plan) => plan.bestFor));

const bannedPublicTerms = /storage|tokens?|models?|providers?|backend|supabase|groq|gemini|pollinations|vectors?|embeddings?|chunks?/i;
for (const summary of [...publicPlans, getPublicPlanSummary("trial")]) {
  assert.doesNotMatch(JSON.stringify(summary), bannedPublicTerms);
  assert.equal("hiddenLimits" in summary, false);
  assert.equal("features" in summary, false);
}

assert.equal(getClassroomSyncPolicy("starter").autoCheckEnabled, false);
assert.equal(getClassroomSyncPolicy("starter").intervalDays, null);
assert.equal(getClassroomSyncPolicy("essential").intervalDays, 7);
assert.equal(getClassroomSyncPolicy("plus").intervalDays, 5);
assert.equal(getClassroomSyncPolicy("pro").intervalDays, 3);
assert.equal(getClassroomSyncPolicy("trial").oncePerTrial, true);
assert.equal(getClassroomSyncPolicy("trial").metadataOnly, true);
assert.equal(getClassroomSyncPolicy("pro").readOnly, true);

assert.equal(canUseFeature("starter", FEATURE_KEYS.LEARNING_LEVEL), false);
assert.equal(canUseFeature("essential", FEATURE_KEYS.LEARNING_LEVEL), false);
assert.equal(canUseFeature("plus", FEATURE_KEYS.LEARNING_LEVEL), true);
assert.equal(canUseFeature("pro", FEATURE_KEYS.LEARNING_LEVEL), true);
assert.equal(canUseFeature("plus", FEATURE_KEYS.LEARNING_LEVEL_ADAPTIVE_DIFFICULTY), true);
assert.equal(canUseFeature("starter", FEATURE_KEYS.CONSISTENCY_POINTS), false);
assert.equal(canUseFeature("essential", FEATURE_KEYS.CONSISTENCY_POINTS), false);
assert.equal(canUseFeature("plus", FEATURE_KEYS.CONSISTENCY_POINTS), false);
assert.equal(canUseFeature("pro", FEATURE_KEYS.CONSISTENCY_POINTS), true);
assert.equal(canUseFeature("plus", FEATURE_KEYS.ASSIGNMENT_COACH), true);
assert.equal(canUseFeature("pro", FEATURE_KEYS.ASSIGNMENT_REVIEW), true);

for (const planKey of validPlans) {
  assert.equal(canUseFeature(planKey, FEATURE_KEYS.ASSIGNMENT_WRITEBACK), false);
  for (const action of CLASSROOM_WRITE_ACTIONS) {
    assert.equal(canUseClassroomAction(planKey, action), false, `${planKey} must not allow ${action}`);
  }
}
assert.equal(canUseClassroomAction("pro", "unknown_action"), false);
assert.equal(getPlanEntitlements("free").planKey, null);
assert.equal(getPlanEntitlements(undefined).displayName, "Setup required");
assert.equal(getAssistantPolicy("plus").depth, "deep");
assert(getAssistantPolicy("pro").dailyBudget > getAssistantPolicy("starter").dailyBudget);
assert.equal(getAcademicContextPolicy("pro").automaticSelectedMaterialDeletion, false);
assert.equal(getAcademicContextPolicy("pro").capacityWarningAtPercent, 90);
assert.equal(getFeatureLimit("essential", FEATURE_KEYS.CLASSROOM_AUTO_CHECK_INTERVAL_DAYS), 7);

const safeProAccess = getPublicEntitlementSummary("pro");
assert.equal(safeProAccess.learningLevelEnabled, true);
assert.equal(safeProAccess.consistencyPointsEnabled, true);
assert.equal(safeProAccess.assignmentWritebackEnabled, false);
assert.equal("dailyBudget" in safeProAccess.assistant, false);
assert.equal("intervalDays" in safeProAccess.classroom, false);

const saasConfig = getSaasConfig({
  env: { STUDENTOS_DEFAULT_PLAN: "starter" },
  supabaseConfig: getSupabaseEnvironment({ STUDENTOS_MODE: "mock" }),
});
const publicSaas = getPublicSaasStatus(saasConfig);
assert.equal(publicSaas.billing.plans.length, 4);
assert.equal("quotas" in publicSaas.quotas.defaultPlan, false);
assert.equal("features" in publicSaas.quotas.defaultPlan, false);

const newUserState = initialStateForUser({ id: "student_pass354_new", email: "new354@student.example" });
newUserState.studentProfile.productLifecycle.selectedPlanId = "free";
newUserState.studentProfile.productLifecycle.state = "dashboard_active";
newUserState.studentProfile.productLifecycle.dashboardActivatedAt = new Date().toISOString();
normalizeProductLifecycle(newUserState);
const lifecycle = getProductLifecycleSnapshot(newUserState);
assert.equal(lifecycle.selectedPlanId, null);
assert.equal(lifecycle.dashboardActive, false);
assert.equal(lifecycle.nextStep, "about_you");

const account = getAccountSnapshot({
  session: {
    authenticated: true,
    mode: "supabase_auth",
    user: { id: newUserState.studentProfile.id, email: newUserState.studentProfile.email },
  },
  state: newUserState,
  saasConfig,
});
assert.equal(account.planAccess.plan.id, "unselected");
assert.equal(account.planAccess.plan.access.planKey, null);
assert.equal(account.planAccess.academicContext.status, "unavailable");
assert.equal("usage" in account.planAccess, false);
assert.equal("quotas" in account.planAccess, false);
assert.doesNotMatch(JSON.stringify(account.planAccess), /storageBytes|aiRequestsPerDay|maxSources|dailyBudget/i);

const cancelledState = initialStateForUser({ id: "student_pass354_cancelled", email: "cancelled@student.example" });
cancelledState.studentProfile.productLifecycle = {
  ...cancelledState.studentProfile.productLifecycle,
  selectedPlanId: "pro",
  accessMode: "paid_plan",
  paymentMethodVerifiedAt: new Date().toISOString(),
};
cancelledState.billingSubscriptions = [{
  id: "billing_cancelled_354",
  userId: cancelledState.studentProfile.id,
  planId: "pro",
  status: "cancelled",
  provider: "none",
  updatedAt: new Date().toISOString(),
}];
assert.equal(resolveEntitlements(cancelledState).activePlanKey, null);
assert.equal(resolveEntitlements(cancelledState).plan.id, "unselected");

const migration = await readFile(new URL(
  "../supabase/migrations/202606290001_studentos_pass35_4_plan_entitlements.sql",
  import.meta.url,
), "utf8");
for (const planKey of ["unselected", "trial", "starter", "essential", "plus", "pro"]) {
  assert(migration.includes(`'${planKey}'`));
}
assert(migration.includes("where plan_id in ('free', 'group', 'institution')"));
assert.doesNotMatch(migration, /service_role|secret key/i);

console.log(JSON.stringify({
  pass: "35.4",
  plans: publicPlans.map((plan) => plan.priceDisplay),
  classroomCadenceDays: {
    starter: getClassroomSyncPolicy("starter").intervalDays,
    essential: getClassroomSyncPolicy("essential").intervalDays,
    plus: getClassroomSyncPolicy("plus").intervalDays,
    pro: getClassroomSyncPolicy("pro").intervalDays,
  },
  classroomWritebackEnabled: false,
  realPaymentEnabled: false,
  secretsPrinted: false,
}, null, 2));
