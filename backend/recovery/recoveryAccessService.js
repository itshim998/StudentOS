import { resolveEntitlements } from "../billing/billingService.js";
import { FEATURE_KEYS, canUseFeature } from "../domain/planEntitlementService.js";
import { getProductLifecycleSnapshot } from "../domain/productLifecycleService.js";
import { isRecoveryRolloutUserEligible } from "./recoveryConfig.js";
import { RECOVERY_FAILURES, RecoveryError, assertRecoveryEnabled } from "./recoveryErrors.js";

export const RECOVERY_CAPABILITY_STATUSES = Object.freeze({
  DISABLED: "disabled",
  PLAN_UNAVAILABLE: "plan_unavailable",
  SETUP_REQUIRED: "setup_required",
  AVAILABLE: "available",
});

function getRecoveryUserId(state = {}) {
  return state.studentProfile?.id || state.studentProfile?.userId || null;
}

export function getPublicRecoveryCapability(state = {}, config = {}) {
  const disabled = config.enabled !== true
    || config.uiEnabled !== true
    || !isRecoveryRolloutUserEligible(getRecoveryUserId(state), config);
  if (disabled) {
    return {
      status: RECOVERY_CAPABILITY_STATUSES.DISABLED,
      available: false,
      reviewRequired: true,
      automaticApply: false,
    };
  }

  const lifecycle = getProductLifecycleSnapshot(state);
  const activePlanKey = resolveEntitlements(state).activePlanKey;
  if (activePlanKey && !canUseFeature(activePlanKey, FEATURE_KEYS.ADAPTIVE_RECOVERY)) {
    return {
      status: RECOVERY_CAPABILITY_STATUSES.PLAN_UNAVAILABLE,
      available: false,
      reviewRequired: true,
      automaticApply: false,
    };
  }
  if (!activePlanKey || lifecycle.dashboardActive !== true) {
    return {
      status: RECOVERY_CAPABILITY_STATUSES.SETUP_REQUIRED,
      available: false,
      reviewRequired: true,
      automaticApply: false,
    };
  }
  return {
    status: RECOVERY_CAPABILITY_STATUSES.AVAILABLE,
    available: true,
    reviewRequired: true,
    automaticApply: false,
  };
}

export function assertRecoveryRouteAccess(state = {}, config = {}, correlationId = null) {
  assertRecoveryEnabled(config, correlationId);
  if (config.uiEnabled !== true) {
    throw new RecoveryError(
      RECOVERY_FAILURES.UI_DISABLED,
      "Adaptive Recovery is not available.",
      { retryable: false, correlationId },
    );
  }
  const capability = getPublicRecoveryCapability(state, config);
  if (capability.status === RECOVERY_CAPABILITY_STATUSES.DISABLED) {
    throw new RecoveryError(
      RECOVERY_FAILURES.UI_DISABLED,
      "Adaptive Recovery is not available.",
      { retryable: false, correlationId },
    );
  }
  if (capability.status === RECOVERY_CAPABILITY_STATUSES.SETUP_REQUIRED) {
    throw new RecoveryError(
      RECOVERY_FAILURES.SETUP_REQUIRED,
      "Complete StudentOS setup before reviewing a recovery plan.",
      { retryable: false, correlationId },
    );
  }
  if (capability.status === RECOVERY_CAPABILITY_STATUSES.PLAN_UNAVAILABLE) {
    throw new RecoveryError(
      RECOVERY_FAILURES.PLAN_UNAVAILABLE,
      "Adaptive Recovery is not available for this StudentOS plan.",
      { retryable: false, correlationId },
    );
  }
  return capability;
}

function requireOwnedRecoveryObject(collection, id, userId, label, correlationId = null) {
  const item = (collection || []).find((candidate) => candidate.id === id && candidate.userId === userId);
  if (item) return item;
  throw new RecoveryError(
    RECOVERY_FAILURES.UNAUTHORIZED,
    `${label} is not available for this account.`,
    { retryable: false, correlationId },
  );
}

export function requireOwnedRecoveryRun(state = {}, id, userId, correlationId = null) {
  return requireOwnedRecoveryObject(state.recoveryRuns, id, userId, "Recovery run", correlationId);
}

export function requireOwnedRecoveryPreview(state = {}, id, userId, correlationId = null) {
  return requireOwnedRecoveryObject(state.recoveryPreviews, id, userId, "Recovery preview", correlationId);
}
