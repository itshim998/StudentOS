import assert from "node:assert/strict";
import { seedStateForUser } from "./repository/studentOsRepository.js";
import { getPublicPlanCatalog } from "./saas/plans.js";
import {
  ONBOARDING_STEPS,
  PRODUCT_FLOW_STEP_ORDER,
  PRODUCT_LIFECYCLE_STATES,
  REQUIRED_LEGAL_CONSENTS,
  applyProductLifecycleAction,
  getProductFlowConfig,
  getProductLifecycleSnapshot,
  requireDashboardActive,
} from "./domain/productLifecycleService.js";

const fixedNow = new Date("2026-06-27T10:00:00.000Z");
const config = getProductFlowConfig({}, "development");
const state = seedStateForUser({ id: "student_pass35_new", email: "new@student.example" });

assert.equal(state.courses.length, 0, "new authenticated profiles must not inherit demo courses");
assert.equal(state.assignments.length, 0, "new authenticated profiles must not inherit demo assignments");
assert.equal(getProductLifecycleSnapshot(state, fixedNow).nextStep, "about_you");
assert.equal(getProductLifecycleSnapshot(state, fixedNow).canGoPrevious, false);
assert.throws(() => requireDashboardActive(state), /Complete StudentOS setup/);

const publicPlans = getPublicPlanCatalog();
assert.deepEqual(publicPlans.map((plan) => [plan.id, plan.priceMonthlyInr]), [
  ["starter", 99],
  ["essential", 159],
  ["plus", 259],
  ["pro", 549],
]);
assert(publicPlans.every((plan) => !("quotas" in plan) && !("features" in plan)));

assert.deepEqual(PRODUCT_FLOW_STEP_ORDER.slice(0, 4), ["about_you", "education_system", "pricing", "trial_choice"]);
assert.throws(() => applyProductLifecycleAction(state, "select_plan", { planId: "plus" }, { config, now: fixedNow }), /name and academic identity/);
assert.throws(() => applyProductLifecycleAction(state, "save_onboarding_step", {
  step: "about_you",
  answers: { displayName: "" },
}, { config, now: fixedNow }), /Enter your name/);

applyProductLifecycleAction(state, "save_onboarding_step", {
  step: "about_you",
  answers: { displayName: "Pass 35 Student" },
}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).nextStep, "education_system");

const academicIdentity = {
  institution: "Example University",
  level: "Undergraduate",
  stream: "Science",
  yearSemester: "Semester 2",
};
applyProductLifecycleAction(state, "save_step_draft", {
  step: "education_system",
  answers: academicIdentity,
}, { config, now: fixedNow });
applyProductLifecycleAction(state, "navigate_previous", {}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).nextStep, "about_you");
assert.equal(getProductLifecycleSnapshot(state).canGoPrevious, false);
applyProductLifecycleAction(state, "save_onboarding_step", {
  step: "about_you",
  answers: { displayName: "Pass 35 Student" },
}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).nextStep, "education_system");
assert.deepEqual(getProductLifecycleSnapshot(state).onboarding.answers.education_system, academicIdentity);
applyProductLifecycleAction(state, "save_onboarding_step", {
  step: "education_system",
  answers: academicIdentity,
}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).nextStep, "pricing");

applyProductLifecycleAction(state, "select_plan", { planId: "plus" }, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).state, "plan_selected");
assert.equal(getProductLifecycleSnapshot(state).nextStep, "trial_choice");
applyProductLifecycleAction(state, "navigate_previous", {}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).nextStep, "pricing");
assert.equal(getProductLifecycleSnapshot(state).selectedPlanId, "plus");
applyProductLifecycleAction(state, "select_plan", { planId: "plus" }, { config, now: fixedNow });
applyProductLifecycleAction(state, "choose_access", { accessMode: "trial" }, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).state, "trial_selected");
assert.equal(getProductLifecycleSnapshot(state).nextStep, "payment_method");

applyProductLifecycleAction(state, "navigate_previous", {}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).nextStep, "trial_choice");
assert.equal(getProductLifecycleSnapshot(state).accessMode, "trial");
applyProductLifecycleAction(state, "choose_access", { accessMode: "trial" }, { config, now: fixedNow });

assert.throws(() => applyProductLifecycleAction(state, "verify_payment_method_placeholder", {}, {
  config: getProductFlowConfig({}, "production"),
  now: fixedNow,
}), /not available/);
applyProductLifecycleAction(state, "verify_payment_method_placeholder", {}, { config, now: fixedNow });
let lifecycle = getProductLifecycleSnapshot(state);
assert.equal(lifecycle.paymentMethodVerificationMode, "development_placeholder");
assert.equal(lifecycle.realPaymentCompleted, false);
assert.equal(lifecycle.nextStep, "legal_consent");

applyProductLifecycleAction(state, "navigate_previous", {}, { config, now: fixedNow });
lifecycle = getProductLifecycleSnapshot(state);
assert.equal(lifecycle.nextStep, "payment_method");
assert.equal(lifecycle.canGoPrevious, false, "verified payment must lock plan and trial pages");
assert.throws(() => applyProductLifecycleAction(state, "navigate_previous", {}, { config, now: fixedNow }), /no earlier setup page/);
assert.throws(() => applyProductLifecycleAction(state, "select_plan", { planId: "starter" }, { config, now: fixedNow }), /cannot be changed/);
assert.throws(() => applyProductLifecycleAction(state, "choose_access", { accessMode: "paid_plan" }, { config, now: fixedNow }), /cannot be changed/);
applyProductLifecycleAction(state, "verify_payment_method_placeholder", {}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).nextStep, "legal_consent");

assert.throws(() => applyProductLifecycleAction(state, "complete_legal", {
  consents: {},
  ageGate: "adult",
}, { config, now: fixedNow }), /every required item/);

const legalConsents = Object.fromEntries(REQUIRED_LEGAL_CONSENTS.map((key) => [key, true]));
assert.throws(() => applyProductLifecycleAction(state, "complete_legal", {
  consents: legalConsents,
  ageGate: "minor",
}, { config, now: fixedNow }), /Parent or guardian consent/);
applyProductLifecycleAction(state, "complete_legal", {
  consents: legalConsents,
  ageGate: "minor",
  guardianConsentAcknowledged: true,
}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).nextStep, "daily_schedule");

for (const step of ONBOARDING_STEPS.filter((item) => !["about_you", "education_system"].includes(item))) {
  applyProductLifecycleAction(state, "save_onboarding_step", {
    step,
    answers: {},
  }, { config, now: fixedNow });
}
lifecycle = getProductLifecycleSnapshot(state);
assert.equal(lifecycle.nextStep, "classroom_setup");
assert.equal(lifecycle.onboarding.progressPercent, 100);

applyProductLifecycleAction(state, "choose_classroom_path", { choice: "classroom" }, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).state, "classroom_choice_pending");
assert.throws(() => applyProductLifecycleAction(state, "save_materials", {}, { config, now: fixedNow }), /Complete the Classroom/);

applyProductLifecycleAction(state, "choose_classroom_path", { choice: "manual" }, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).state, "manual_setup_selected");
applyProductLifecycleAction(state, "save_materials", {
  materialLabels: ["Calculus syllabus"],
}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).nextStep, "setup_summary");
applyProductLifecycleAction(state, "confirm_setup_summary", {}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).nextStep, "workspace_preparation");
applyProductLifecycleAction(state, "start_workspace_preparation", {}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).state, "workspace_preparing");
applyProductLifecycleAction(state, "complete_workspace_preparation", {}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).nextStep, "tutorial");
applyProductLifecycleAction(state, "choose_tutorial", { choice: "show" }, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).dashboardActive, false);
applyProductLifecycleAction(state, "complete_tutorial", {}, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).dashboardActive, true);
assert.doesNotThrow(() => requireDashboardActive(state));

assert(PRODUCT_LIFECYCLE_STATES.includes("payment_failed_locked"));
assert(PRODUCT_LIFECYCLE_STATES.includes("export_window"));
assert(PRODUCT_LIFECYCLE_STATES.includes("deletion_pending"));
assert.equal(config.realPaymentEnabled, false);
assert.equal(config.placeholderCanCreateCharge, false);
assert.equal(config.placeholderCanCreateMandate, false);

console.log(JSON.stringify({
  pass: "35.1",
  lifecycleState: getProductLifecycleSnapshot(state).state,
  publicPlans: publicPlans.map((plan) => `${plan.label}:₹${plan.priceMonthlyInr}`),
  realPaymentEnabled: config.realPaymentEnabled,
  secretsPrinted: false,
}, null, 2));
