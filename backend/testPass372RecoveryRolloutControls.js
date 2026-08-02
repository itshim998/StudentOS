import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getPublicRecoveryCapability, assertRecoveryRouteAccess } from "./recovery/recoveryAccessService.js";
import {
  RECOVERY_ROLLOUT_MODES,
  getRecoveryConfig,
  getSafeRecoveryStatus,
  isRecoveryRolloutUserEligible,
  parseRecoveryRolloutUserIds,
  validateRecoveryRolloutEnvironment,
} from "./recovery/recoveryConfig.js";
import { RECOVERY_FAILURES } from "./recovery/recoveryErrors.js";
import { createRecoveryEvaluationState } from "./recovery/recoveryEvaluationCases.js";
import { ONBOARDING_STEPS } from "./domain/productLifecycleService.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099";
const NOW = "2026-08-02T10:00:00.000Z";

function activeState(userId = USER_ID, planId = "plus") {
  const state = createRecoveryEvaluationState();
  state.studentProfile.id = userId;
  state.studentProfile.productLifecycle = {
    state: "dashboard_active",
    selectedPlanId: planId,
    accessMode: "paid_plan",
    paymentMethodVerifiedAt: NOW,
    legalConsentCompleteAt: NOW,
    onboarding: {
      completedSteps: [...ONBOARDING_STEPS],
      answers: {},
      currentStep: "complete",
    },
    classroomChoice: "manual",
    manualSetupSelectedAt: NOW,
    materialsSelectedAt: NOW,
    selectedMaterialIds: [],
    selectedMaterialLabels: [],
    setupSummaryReadyAt: NOW,
    workspaceReadyAt: NOW,
    tutorialChoice: "skip",
    dashboardActivatedAt: NOW,
  };
  state.billingSubscriptions = [{
    id: `subscription_${userId}_${planId}`,
    userId,
    planId,
    status: "active",
    updatedAt: NOW,
  }];
  return state;
}

const defaults = validateRecoveryRolloutEnvironment({});
assert.equal(defaults.ok, true);
assert.equal(defaults.mode, RECOVERY_ROLLOUT_MODES.OFF);
assert.equal(defaults.userCount, 0);
assert.deepEqual(defaults.errors, []);

for (const invalid of [
  {
    STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true",
    STUDENTOS_RECOVERY_UI_ENABLED: "true",
    STUDENTOS_RECOVERY_ROLLOUT_MODE: "off",
  },
  {
    STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true",
    STUDENTOS_RECOVERY_UI_ENABLED: "false",
    STUDENTOS_RECOVERY_ROLLOUT_MODE: "allowlist",
    STUDENTOS_RECOVERY_ROLLOUT_USER_IDS: USER_ID,
  },
  {
    STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true",
    STUDENTOS_RECOVERY_UI_ENABLED: "true",
    STUDENTOS_RECOVERY_ROLLOUT_MODE: "allowlist",
    STUDENTOS_RECOVERY_ROLLOUT_USER_IDS: "not-a-uuid",
  },
  {
    STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true",
    STUDENTOS_RECOVERY_UI_ENABLED: "true",
    STUDENTOS_RECOVERY_ROLLOUT_MODE: "allowlist",
    STUDENTOS_RECOVERY_ROLLOUT_USER_IDS: `${USER_ID},${USER_ID}`,
  },
]) {
  const validation = validateRecoveryRolloutEnvironment(invalid);
  assert.equal(validation.ok, false);
  const config = getRecoveryConfig(invalid);
  assert.equal(config.rolloutConfigValid, false);
  assert.equal(config.rolloutMode, RECOVERY_ROLLOUT_MODES.OFF);
  assert.equal(config.rolloutUserIds.length, 0);
  assert.equal(getPublicRecoveryCapability(activeState(USER_ID), config).status, "disabled");
  assert.throws(
    () => assertRecoveryRouteAccess(activeState(USER_ID), config),
    (error) => [RECOVERY_FAILURES.ENGINE_DISABLED, RECOVERY_FAILURES.UI_DISABLED].includes(error?.code),
  );
}

const parsed = parseRecoveryRolloutUserIds(` ${USER_ID.toUpperCase()} , ${OTHER_USER_ID} `);
assert.deepEqual(parsed.userIds, [USER_ID, OTHER_USER_ID]);
assert.deepEqual(parsed.invalidIds, []);
assert.deepEqual(parsed.duplicateIds, []);

const allowlistEnv = {
  STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true",
  STUDENTOS_RECOVERY_UI_ENABLED: "true",
  STUDENTOS_RECOVERY_ROLLOUT_MODE: "allowlist",
  STUDENTOS_RECOVERY_ROLLOUT_USER_IDS: `${USER_ID},${OTHER_USER_ID}`,
};
const allowlistValidation = validateRecoveryRolloutEnvironment(allowlistEnv);
assert.equal(allowlistValidation.ok, true);
assert.equal(allowlistValidation.userCount, 2);
const allowlistConfig = getRecoveryConfig(allowlistEnv);
assert.equal(allowlistConfig.enabled, true);
assert.equal(allowlistConfig.uiEnabled, true);
assert.equal(allowlistConfig.rolloutMode, RECOVERY_ROLLOUT_MODES.ALLOWLIST);
assert.equal(isRecoveryRolloutUserEligible(USER_ID, allowlistConfig), true);
assert.equal(isRecoveryRolloutUserEligible("00000000-0000-4000-8000-000000000777", allowlistConfig), false);

const safeStatus = getSafeRecoveryStatus(allowlistConfig);
assert.equal(safeStatus.cohortRestricted, true);
assert.equal(safeStatus.rolloutMode, RECOVERY_ROLLOUT_MODES.ALLOWLIST);
assert.equal(safeStatus.rolloutConfigValid, true);
assert.doesNotMatch(JSON.stringify(safeStatus), new RegExp(USER_ID, "i"));

const eligibleState = activeState(USER_ID, "plus");
assert.equal(getPublicRecoveryCapability(eligibleState, allowlistConfig).status, "available");
assert.doesNotThrow(() => assertRecoveryRouteAccess(eligibleState, allowlistConfig));

const ineligibleState = activeState("00000000-0000-4000-8000-000000000777", "plus");
assert.equal(getPublicRecoveryCapability(ineligibleState, allowlistConfig).status, "disabled");
assert.throws(
  () => assertRecoveryRouteAccess(ineligibleState, allowlistConfig),
  (error) => error?.code === RECOVERY_FAILURES.UI_DISABLED,
);

const deploymentWorkflow = await readFile(new URL("../.github/workflows/azure-container-apps-studentos.yml", import.meta.url), "utf8");
assert.doesNotMatch(deploymentWorkflow, /enable_adaptive_recovery:/);
assert.match(deploymentWorkflow, /STUDENTOS_ADAPTIVE_RECOVERY_ENABLED:\s*['"]false['"]/);
assert.match(deploymentWorkflow, /STUDENTOS_RECOVERY_UI_ENABLED:\s*['"]false['"]/);
assert.match(deploymentWorkflow, /STUDENTOS_RECOVERY_ROLLOUT_MODE:\s*['"]off['"]/);
assert.doesNotMatch(deploymentWorkflow, /STUDENTOS_(?:ADAPTIVE_RECOVERY|RECOVERY_UI)_ENABLED=true\b/i);

const rolloutWorkflow = await readFile(new URL("../.github/workflows/adaptive-recovery-rollout.yml", import.meta.url), "utf8");
assert.match(rolloutWorkflow, /workflow_dispatch:/);
assert.doesNotMatch(rolloutWorkflow, /^\s{2}(?:push|pull_request):/m);
assert.match(rolloutWorkflow, /enable_allowlist/);
assert.match(rolloutWorkflow, /ENABLE-RECOVERY-ALLOWLIST/);
assert.match(rolloutWorkflow, /DISABLE-RECOVERY/);
assert.match(rolloutWorkflow, /verifyAdaptiveRecoverySchemaLive\.js/);
assert.match(rolloutWorkflow, /verifyRecoveryRolloutConfig\.js/);
assert.match(rolloutWorkflow, /STUDENTOS_RECOVERY_ROLLOUT_USER_IDS:\s*\$\{\{ secrets\.STUDENTOS_RECOVERY_ROLLOUT_USER_IDS \}\}/);
assert.match(rolloutWorkflow, /studentos-recovery-rollout-user-ids/);
assert.match(rolloutWorkflow, /expected_image="ghcr\.io\/\$\{\{ github\.repository_owner \}\}\/studentos-api:\$\{GITHUB_SHA\}"/);
assert.match(rolloutWorkflow, /current default-branch commit to be deployed dark/);
assert.match(rolloutWorkflow, /Enable the worker first/);
assert.match(rolloutWorkflow, /Hide the API surface first/);
assert.match(rolloutWorkflow, /Roll back a failed enable attempt/);
assert.match(rolloutWorkflow, /failure\(\) && inputs\.action == 'enable_allowlist'/);
assert.match(rolloutWorkflow, /STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=true/);
assert.match(rolloutWorkflow, /STUDENTOS_RECOVERY_UI_ENABLED=true/);
assert.match(rolloutWorkflow, /STUDENTOS_RECOVERY_ROLLOUT_MODE=allowlist/);
assert.match(rolloutWorkflow, /STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false/);
assert.match(rolloutWorkflow, /STUDENTOS_RECOVERY_UI_ENABLED=false/);
assert.match(rolloutWorkflow, /STUDENTOS_RECOVERY_ROLLOUT_MODE=off/);
assert.match(rolloutWorkflow, /Raw CLI output was withheld/);
assert.doesNotMatch(rolloutWorkflow, /echo[^\n]*STUDENTOS_RECOVERY_ROLLOUT_USER_IDS/);

const bicep = await readFile(new URL("../infra/azure/containerapp.bicep", import.meta.url), "utf8");
assert.equal((bicep.match(/name: 'STUDENTOS_RECOVERY_UI_ENABLED'/g) || []).length, 2);
assert.equal((bicep.match(/name: 'STUDENTOS_RECOVERY_ROLLOUT_MODE'/g) || []).length, 2);
assert.equal((bicep.match(/value: 'off'/g) || []).length >= 2, true);

console.log("PASS | PASS 37.2 controlled Recovery rollout policy and workflow safeguards passed");
