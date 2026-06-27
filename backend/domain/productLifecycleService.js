export const PRODUCT_LIFECYCLE_STATES = Object.freeze([
  "signed_out",
  "signed_up",
  "plan_selected",
  "trial_selected",
  "paid_plan_selected",
  "payment_method_verified",
  "legal_consent_complete",
  "onboarding_started",
  "onboarding_progress_saved",
  "classroom_choice_pending",
  "classroom_connected",
  "manual_setup_selected",
  "materials_selected",
  "setup_summary_ready",
  "workspace_preparing",
  "workspace_ready",
  "tutorial_offered",
  "dashboard_active",
  "payment_failed_locked",
  "export_window",
  "deletion_pending",
]);

export const PRODUCT_PLAN_IDS = Object.freeze(["starter", "essential", "plus", "pro"]);

export const ONBOARDING_STEPS = Object.freeze([
  "about_you",
  "education_system",
  "daily_schedule",
  "exam_pattern",
  "academic_context",
]);

export const REQUIRED_LEGAL_CONSENTS = Object.freeze([
  "termsOfService",
  "privacyPolicy",
  "trialBilling",
  "trialLimits",
  "paymentMandate",
  "cancellationWindow",
  "academicDataUse",
  "noOutcomeGuarantee",
  "responsibleUse",
  "aiAccuracy",
]);

function nowIso(now = new Date()) {
  return now.toISOString();
}

function safeText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function readBool(env, key, fallback = false) {
  const value = String(env?.[key] || "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function productError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hasExistingWorkspace(state = {}) {
  const profileId = String(state.studentProfile?.id || "");
  if (profileId === "student_demo_001") return true;
  return ["courses", "assignments", "sourceMaterials", "roadmap"]
    .some((key) => Array.isArray(state[key]) && state[key].length > 0);
}

export function getProductFlowConfig(env = process.env, deployment = "development") {
  const nonProduction = String(deployment || "development").toLowerCase() !== "production";
  return {
    paymentPlaceholderEnabled: nonProduction && readBool(env, "STUDENTOS_PAYMENT_PLACEHOLDER_ENABLED", true),
    workspacePreparationSimulationEnabled: nonProduction && readBool(env, "STUDENTOS_WORKSPACE_PREPARATION_SIMULATION_ENABLED", true),
    realPaymentEnabled: false,
    placeholderCanCreateCharge: false,
    placeholderCanCreateMandate: false,
    secretsExposed: false,
  };
}

export function createInitialProductLifecycle({ ready = false, now = new Date() } = {}) {
  const timestamp = nowIso(now);
  if (ready) {
    return {
      version: 1,
      state: "dashboard_active",
      selectedPlanId: "starter",
      accessMode: "paid_plan",
      paymentMethodVerifiedAt: timestamp,
      paymentMethodVerificationMode: "legacy_ready",
      legalConsentCompleteAt: timestamp,
      legalConsents: {},
      ageGate: "adult",
      guardianConsentAcknowledged: false,
      onboarding: {
        currentStep: "complete",
        completedSteps: [...ONBOARDING_STEPS],
        answers: {},
      },
      classroomChoice: "manual",
      manualSetupSelectedAt: timestamp,
      selectedMaterialIds: [],
      selectedMaterialLabels: [],
      materialsSelectedAt: timestamp,
      setupSummaryReadyAt: timestamp,
      workspacePreparationStartedAt: timestamp,
      workspaceReadyAt: timestamp,
      tutorialOfferedAt: timestamp,
      tutorialChoice: "skip",
      dashboardActivatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  return {
    version: 1,
    state: "signed_up",
    selectedPlanId: null,
    accessMode: null,
    paymentMethodVerifiedAt: null,
    paymentMethodVerificationMode: null,
    legalConsentCompleteAt: null,
    legalConsents: {},
    ageGate: null,
    guardianConsentAcknowledged: false,
    onboarding: {
      currentStep: ONBOARDING_STEPS[0],
      completedSteps: [],
      answers: {},
    },
    classroomChoice: null,
    classroomConnectedAt: null,
    manualSetupSelectedAt: null,
    selectedMaterialIds: [],
    selectedMaterialLabels: [],
    materialsSelectedAt: null,
    setupSummaryReadyAt: null,
    workspacePreparationStartedAt: null,
    workspaceReadyAt: null,
    tutorialOfferedAt: null,
    tutorialChoice: null,
    dashboardActivatedAt: null,
    paymentFailedAt: null,
    exportWindowEndsAt: null,
    deletionPendingAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeProductLifecycle(state = {}, now = new Date()) {
  state.studentProfile = state.studentProfile || { id: "student_unknown", displayName: "Student", preferences: {} };
  const existing = state.studentProfile.productLifecycle;
  const base = createInitialProductLifecycle({ ready: !existing && hasExistingWorkspace(state), now });
  const lifecycle = {
    ...base,
    ...(existing && typeof existing === "object" ? existing : {}),
  };
  lifecycle.legalConsents = lifecycle.legalConsents && typeof lifecycle.legalConsents === "object"
    ? lifecycle.legalConsents
    : {};
  lifecycle.onboarding = {
    ...base.onboarding,
    ...(lifecycle.onboarding && typeof lifecycle.onboarding === "object" ? lifecycle.onboarding : {}),
  };
  lifecycle.onboarding.completedSteps = Array.isArray(lifecycle.onboarding.completedSteps)
    ? lifecycle.onboarding.completedSteps.filter((step) => ONBOARDING_STEPS.includes(step))
    : [];
  lifecycle.onboarding.answers = lifecycle.onboarding.answers && typeof lifecycle.onboarding.answers === "object"
    ? lifecycle.onboarding.answers
    : {};
  lifecycle.selectedMaterialIds = Array.isArray(lifecycle.selectedMaterialIds) ? lifecycle.selectedMaterialIds : [];
  lifecycle.selectedMaterialLabels = Array.isArray(lifecycle.selectedMaterialLabels) ? lifecycle.selectedMaterialLabels : [];
  if (!PRODUCT_LIFECYCLE_STATES.includes(lifecycle.state)) lifecycle.state = base.state;
  if (lifecycle.selectedPlanId && !PRODUCT_PLAN_IDS.includes(lifecycle.selectedPlanId)) lifecycle.selectedPlanId = null;
  state.studentProfile.productLifecycle = lifecycle;
  return lifecycle;
}

function nextStepFor(lifecycle) {
  if (lifecycle.deletionPendingAt) return "deletion_pending";
  if (lifecycle.paymentFailedAt && !lifecycle.paymentMethodVerifiedAt) return "payment_failed_locked";
  if (lifecycle.dashboardActivatedAt) return "dashboard";
  if (lifecycle.tutorialOfferedAt) return "tutorial";
  if (lifecycle.workspaceReadyAt) return "tutorial";
  if (lifecycle.workspacePreparationStartedAt) return "workspace_preparation";
  if (!lifecycle.selectedPlanId) return "pricing";
  if (!lifecycle.accessMode) return "trial_choice";
  if (!lifecycle.paymentMethodVerifiedAt) return "payment_method";
  if (!lifecycle.legalConsentCompleteAt) return "legal_consent";
  const completed = lifecycle.onboarding.completedSteps || [];
  const nextOnboarding = ONBOARDING_STEPS.find((step) => !completed.includes(step));
  if (nextOnboarding) return nextOnboarding;
  if (!lifecycle.classroomChoice) return "classroom_setup";
  if (lifecycle.classroomChoice === "classroom" && !lifecycle.classroomConnectedAt) return "classroom_setup";
  if (!lifecycle.materialsSelectedAt) return "materials";
  if (!lifecycle.setupSummaryReadyAt) return "setup_summary";
  return "workspace_preparation";
}

export function getProductLifecycleSnapshot(state = {}, now = new Date()) {
  const lifecycle = normalizeProductLifecycle(state, now);
  const completedOnboardingSteps = lifecycle.onboarding.completedSteps.length;
  return {
    ...lifecycle,
    nextStep: nextStepFor(lifecycle),
    onboarding: {
      ...lifecycle.onboarding,
      stepCount: ONBOARDING_STEPS.length,
      completedStepCount: completedOnboardingSteps,
      progressPercent: Math.round((completedOnboardingSteps / ONBOARDING_STEPS.length) * 100),
    },
    paymentMethodVerified: Boolean(lifecycle.paymentMethodVerifiedAt),
    legalConsentComplete: Boolean(lifecycle.legalConsentCompleteAt),
    workspaceReady: Boolean(lifecycle.workspaceReadyAt),
    dashboardActive: Boolean(lifecycle.dashboardActivatedAt),
    realPaymentCompleted: false,
    secretsExposed: false,
  };
}

function requireValue(condition, message) {
  if (!condition) throw productError(message);
}

function touch(lifecycle, stateName, now) {
  lifecycle.state = stateName;
  lifecycle.updatedAt = nowIso(now);
  return lifecycle;
}

function legalPayload(payload = {}) {
  const consents = payload.consents && typeof payload.consents === "object" ? payload.consents : {};
  return Object.fromEntries(REQUIRED_LEGAL_CONSENTS.map((key) => [key, consents[key] === true]));
}

export function applyProductLifecycleAction(state, action, payload = {}, {
  config = getProductFlowConfig(),
  now = new Date(),
} = {}) {
  const lifecycle = normalizeProductLifecycle(state, now);
  const timestamp = nowIso(now);
  switch (action) {
    case "reset_plan": {
      requireValue(!lifecycle.paymentMethodVerifiedAt, "The selected plan cannot be reset after payment-method verification.");
      lifecycle.selectedPlanId = null;
      lifecycle.accessMode = null;
      return touch(lifecycle, "signed_up", now);
    }
    case "select_plan": {
      const planId = safeText(payload.planId, 40).toLowerCase();
      requireValue(PRODUCT_PLAN_IDS.includes(planId), "Choose a current StudentOS plan to continue.");
      lifecycle.selectedPlanId = planId;
      lifecycle.accessMode = null;
      return touch(lifecycle, "plan_selected", now);
    }
    case "choose_access": {
      requireValue(PRODUCT_PLAN_IDS.includes(lifecycle.selectedPlanId), "Choose a plan before selecting access.");
      const accessMode = payload.accessMode === "trial" ? "trial" : payload.accessMode === "paid_plan" ? "paid_plan" : "";
      requireValue(accessMode, "Choose Trial Mode or start the selected plan.");
      lifecycle.accessMode = accessMode;
      return touch(lifecycle, accessMode === "trial" ? "trial_selected" : "paid_plan_selected", now);
    }
    case "verify_payment_method_placeholder": {
      requireValue(lifecycle.accessMode, "Choose how you want to start before verifying access.");
      requireValue(config.paymentPlaceholderEnabled === true, "Development payment-method verification is not available in this environment.");
      lifecycle.paymentMethodVerifiedAt = timestamp;
      lifecycle.paymentMethodVerificationMode = "development_placeholder";
      lifecycle.paymentFailedAt = null;
      return touch(lifecycle, "payment_method_verified", now);
    }
    case "complete_legal": {
      requireValue(lifecycle.paymentMethodVerifiedAt, "Verify your payment method before reviewing onboarding agreements.");
      const consents = legalPayload(payload);
      requireValue(REQUIRED_LEGAL_CONSENTS.every((key) => consents[key]), "Review and agree to every required item before continuing.");
      const ageGate = payload.ageGate === "adult" ? "adult" : payload.ageGate === "minor" ? "minor" : "";
      requireValue(ageGate, "Choose the age and consent option that applies to you.");
      requireValue(ageGate !== "minor" || payload.guardianConsentAcknowledged === true, "Parent or guardian consent must be acknowledged before continuing.");
      lifecycle.legalConsents = consents;
      lifecycle.ageGate = ageGate;
      lifecycle.guardianConsentAcknowledged = ageGate === "minor";
      lifecycle.legalConsentCompleteAt = timestamp;
      return touch(lifecycle, "legal_consent_complete", now);
    }
    case "begin_onboarding": {
      requireValue(lifecycle.legalConsentCompleteAt, "Complete the agreement step before onboarding.");
      lifecycle.onboarding.currentStep = ONBOARDING_STEPS.find((step) => !lifecycle.onboarding.completedSteps.includes(step)) || "complete";
      return touch(lifecycle, "onboarding_started", now);
    }
    case "save_onboarding_step": {
      requireValue(lifecycle.legalConsentCompleteAt, "Complete the agreement step before onboarding.");
      const step = safeText(payload.step, 60);
      requireValue(ONBOARDING_STEPS.includes(step), "Choose a current onboarding step.");
      const answers = payload.answers && typeof payload.answers === "object" ? payload.answers : {};
      if (step === "about_you") {
        const displayName = safeText(answers.displayName, 120);
        requireValue(displayName, "Enter your name to continue.");
        state.studentProfile.displayName = displayName;
      }
      lifecycle.onboarding.answers[step] = Object.fromEntries(Object.entries(answers)
        .slice(0, 30)
        .map(([key, value]) => [safeText(key, 80), safeText(value, 1000)]));
      if (!lifecycle.onboarding.completedSteps.includes(step)) lifecycle.onboarding.completedSteps.push(step);
      const nextStep = ONBOARDING_STEPS.find((item) => !lifecycle.onboarding.completedSteps.includes(item));
      lifecycle.onboarding.currentStep = nextStep || "complete";
      return touch(lifecycle, nextStep ? "onboarding_progress_saved" : "classroom_choice_pending", now);
    }
    case "choose_classroom_path": {
      requireValue(lifecycle.onboarding.completedSteps.length === ONBOARDING_STEPS.length, "Finish the guided setup pages before choosing materials.");
      const choice = payload.choice === "classroom" ? "classroom" : payload.choice === "manual" ? "manual" : "";
      requireValue(choice, "Choose Classroom or manual setup.");
      lifecycle.classroomChoice = choice;
      if (choice === "manual") {
        lifecycle.manualSetupSelectedAt = timestamp;
        lifecycle.classroomConnectedAt = null;
        return touch(lifecycle, "manual_setup_selected", now);
      }
      lifecycle.manualSetupSelectedAt = null;
      return touch(lifecycle, lifecycle.classroomConnectedAt ? "classroom_connected" : "classroom_choice_pending", now);
    }
    case "save_materials": {
      requireValue(lifecycle.manualSetupSelectedAt || lifecycle.classroomConnectedAt, "Complete the Classroom or manual setup choice first.");
      lifecycle.selectedMaterialIds = Array.isArray(payload.materialIds)
        ? payload.materialIds.map((value) => safeText(value, 160)).filter(Boolean).slice(0, 100)
        : [];
      lifecycle.selectedMaterialLabels = Array.isArray(payload.materialLabels)
        ? payload.materialLabels.map((value) => safeText(value, 200)).filter(Boolean).slice(0, 100)
        : [];
      lifecycle.materialsSelectedAt = timestamp;
      return touch(lifecycle, "materials_selected", now);
    }
    case "confirm_setup_summary": {
      requireValue(lifecycle.materialsSelectedAt, "Review academic materials before confirming the summary.");
      lifecycle.setupSummaryReadyAt = timestamp;
      return touch(lifecycle, "setup_summary_ready", now);
    }
    case "edit_setup": {
      requireValue(lifecycle.legalConsentCompleteAt, "Complete the agreement step before editing setup details.");
      requireValue(!lifecycle.workspacePreparationStartedAt && !lifecycle.dashboardActivatedAt, "Use Academic Context to update a workspace that is already being prepared.");
      const targetStep = payload.targetStep === "academic_context" ? "academic_context" : "about_you";
      const targetIndex = ONBOARDING_STEPS.indexOf(targetStep);
      lifecycle.onboarding.completedSteps = lifecycle.onboarding.completedSteps
        .filter((step) => ONBOARDING_STEPS.indexOf(step) < targetIndex);
      lifecycle.onboarding.currentStep = targetStep;
      lifecycle.classroomChoice = null;
      lifecycle.classroomConnectedAt = null;
      lifecycle.manualSetupSelectedAt = null;
      lifecycle.selectedMaterialIds = [];
      lifecycle.selectedMaterialLabels = [];
      lifecycle.materialsSelectedAt = null;
      lifecycle.setupSummaryReadyAt = null;
      lifecycle.workspacePreparationStartedAt = null;
      return touch(lifecycle, "onboarding_progress_saved", now);
    }
    case "start_workspace_preparation": {
      requireValue(lifecycle.setupSummaryReadyAt, "Confirm the setup summary before preparing the workspace.");
      lifecycle.workspacePreparationStartedAt = timestamp;
      return touch(lifecycle, "workspace_preparing", now);
    }
    case "complete_workspace_preparation": {
      requireValue(lifecycle.workspacePreparationStartedAt, "Start workspace preparation first.");
      requireValue(config.workspacePreparationSimulationEnabled === true, "Workspace preparation simulation is not available in this environment.");
      lifecycle.workspaceReadyAt = timestamp;
      lifecycle.tutorialOfferedAt = timestamp;
      return touch(lifecycle, "tutorial_offered", now);
    }
    case "choose_tutorial": {
      requireValue(lifecycle.workspaceReadyAt, "Finish preparing the workspace before opening Today.");
      lifecycle.tutorialChoice = payload.choice === "show" ? "show" : "skip";
      if (lifecycle.tutorialChoice === "show") return touch(lifecycle, "tutorial_offered", now);
      lifecycle.dashboardActivatedAt = timestamp;
      return touch(lifecycle, "dashboard_active", now);
    }
    case "complete_tutorial": {
      requireValue(lifecycle.workspaceReadyAt && lifecycle.tutorialChoice === "show", "Open the tutorial before completing it.");
      lifecycle.tutorialViewedAt = timestamp;
      lifecycle.dashboardActivatedAt = timestamp;
      return touch(lifecycle, "dashboard_active", now);
    }
    default:
      throw productError("This product-flow action is not available.", 404);
  }
}

export function markProductClassroomConnected(state, now = new Date()) {
  const lifecycle = normalizeProductLifecycle(state, now);
  if (lifecycle.classroomChoice !== "classroom") return lifecycle;
  lifecycle.classroomConnectedAt = nowIso(now);
  return touch(lifecycle, "classroom_connected", now);
}

export function requireDashboardActive(state) {
  const snapshot = getProductLifecycleSnapshot(state);
  if (!snapshot.dashboardActive) {
    const error = productError("Complete StudentOS setup before using the academic workspace.", 403);
    error.lifecycleState = snapshot.state;
    error.nextStep = snapshot.nextStep;
    throw error;
  }
  return snapshot;
}
