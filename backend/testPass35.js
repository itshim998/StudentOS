import assert from "node:assert/strict";
import { seedStateForUser } from "./repository/studentOsRepository.js";
import { getPublicPlanCatalog } from "./saas/plans.js";
import {
  ONBOARDING_STEPS,
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
assert.equal(getProductLifecycleSnapshot(state, fixedNow).nextStep, "pricing");
assert.throws(() => requireDashboardActive(state), /Complete StudentOS setup/);

const publicPlans = getPublicPlanCatalog();
assert.deepEqual(publicPlans.map((plan) => [plan.id, plan.priceMonthlyInr]), [
  ["starter", 99],
  ["essential", 159],
  ["plus", 259],
  ["pro", 549],
]);
assert(publicPlans.every((plan) => !("quotas" in plan) && !("features" in plan)));

applyProductLifecycleAction(state, "select_plan", { planId: "plus" }, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).state, "plan_selected");
applyProductLifecycleAction(state, "choose_access", { accessMode: "trial" }, { config, now: fixedNow });
assert.equal(getProductLifecycleSnapshot(state).state, "trial_selected");

assert.throws(() => applyProductLifecycleAction(state, "verify_payment_method_placeholder", {}, {
  config: getProductFlowConfig({}, "production"),
  now: fixedNow,
}), /not available/);
applyProductLifecycleAction(state, "verify_payment_method_placeholder", {}, { config, now: fixedNow });
let lifecycle = getProductLifecycleSnapshot(state);
assert.equal(lifecycle.paymentMethodVerificationMode, "development_placeholder");
assert.equal(lifecycle.realPaymentCompleted, false);
assert.equal(lifecycle.nextStep, "legal_consent");

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
assert.equal(getProductLifecycleSnapshot(state).nextStep, "about_you");

for (const step of ONBOARDING_STEPS) {
  applyProductLifecycleAction(state, "save_onboarding_step", {
    step,
    answers: step === "about_you" ? { displayName: "Pass 35 Student" } : {},
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
  pass: "35.0",
  lifecycleState: getProductLifecycleSnapshot(state).state,
  publicPlans: publicPlans.map((plan) => `${plan.label}:₹${plan.priceMonthlyInr}`),
  realPaymentEnabled: config.realPaymentEnabled,
  secretsPrinted: false,
}, null, 2));
