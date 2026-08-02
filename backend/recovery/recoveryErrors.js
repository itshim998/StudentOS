export const RECOVERY_FAILURES = Object.freeze({
  INPUT_INVALID: "RECOVERY_INPUT_INVALID",
  IDEMPOTENCY_REQUIRED: "RECOVERY_IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENCY_CONFLICT: "RECOVERY_IDEMPOTENCY_CONFLICT",
  ENGINE_DISABLED: "RECOVERY_ENGINE_DISABLED",
  UI_DISABLED: "RECOVERY_UI_DISABLED",
  SETUP_REQUIRED: "RECOVERY_SETUP_REQUIRED",
  PLAN_UNAVAILABLE: "RECOVERY_PLAN_UNAVAILABLE",
  SESSION_REQUIRED: "RECOVERY_SESSION_REQUIRED",
  RATE_LIMITED: "RECOVERY_RATE_LIMITED",
  CONTEXT_INSUFFICIENT: "RECOVERY_CONTEXT_INSUFFICIENT",
  EVIDENCE_INVALID: "RECOVERY_EVIDENCE_INVALID",
  PROVIDER_FAILED: "RECOVERY_PROVIDER_FAILED",
  OUTPUT_INVALID: "RECOVERY_OUTPUT_INVALID",
  GROUNDING_FAILED: "RECOVERY_GROUNDING_FAILED",
  PLAN_INFEASIBLE: "RECOVERY_PLAN_INFEASIBLE",
  PREVIEW_STALE: "RECOVERY_PREVIEW_STALE",
  PREVIEW_ALREADY_APPLIED: "RECOVERY_PREVIEW_ALREADY_APPLIED",
  CONCURRENCY_CONFLICT: "RECOVERY_CONCURRENCY_CONFLICT",
  UNAUTHORIZED: "RECOVERY_UNAUTHORIZED",
  ALLOWANCE_EXHAUSTED: "RECOVERY_ALLOWANCE_EXHAUSTED",
});

const DEFAULT_STATUS = Object.freeze({
  [RECOVERY_FAILURES.INPUT_INVALID]: 400,
  [RECOVERY_FAILURES.IDEMPOTENCY_REQUIRED]: 400,
  [RECOVERY_FAILURES.IDEMPOTENCY_CONFLICT]: 409,
  [RECOVERY_FAILURES.ENGINE_DISABLED]: 404,
  [RECOVERY_FAILURES.UI_DISABLED]: 404,
  [RECOVERY_FAILURES.SETUP_REQUIRED]: 403,
  [RECOVERY_FAILURES.PLAN_UNAVAILABLE]: 403,
  [RECOVERY_FAILURES.SESSION_REQUIRED]: 401,
  [RECOVERY_FAILURES.RATE_LIMITED]: 429,
  [RECOVERY_FAILURES.CONTEXT_INSUFFICIENT]: 422,
  [RECOVERY_FAILURES.EVIDENCE_INVALID]: 422,
  [RECOVERY_FAILURES.PROVIDER_FAILED]: 503,
  [RECOVERY_FAILURES.OUTPUT_INVALID]: 502,
  [RECOVERY_FAILURES.GROUNDING_FAILED]: 502,
  [RECOVERY_FAILURES.PLAN_INFEASIBLE]: 422,
  [RECOVERY_FAILURES.PREVIEW_STALE]: 409,
  [RECOVERY_FAILURES.PREVIEW_ALREADY_APPLIED]: 409,
  [RECOVERY_FAILURES.CONCURRENCY_CONFLICT]: 409,
  [RECOVERY_FAILURES.UNAUTHORIZED]: 403,
  [RECOVERY_FAILURES.ALLOWANCE_EXHAUSTED]: 429,
});

const RETRYABLE = new Set([
  RECOVERY_FAILURES.PROVIDER_FAILED,
  RECOVERY_FAILURES.CONCURRENCY_CONFLICT,
]);

export class RecoveryError extends Error {
  constructor(code, message, options = {}) {
    super(String(message || "Recovery analysis could not be completed."));
    this.name = "RecoveryError";
    this.code = code;
    this.status = options.status || DEFAULT_STATUS[code] || 500;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
    this.correlationId = options.correlationId || null;
  }
}

export function assertRecoveryEnabled(config, correlationId = null) {
  if (config?.enabled === true) return;
  throw new RecoveryError(
    RECOVERY_FAILURES.ENGINE_DISABLED,
    "Adaptive Recovery Engine is not enabled.",
    { retryable: false, correlationId },
  );
}

export function recoveryErrorEnvelope(error, fallbackCorrelationId = null) {
  const recovery = error instanceof RecoveryError || Object.values(RECOVERY_FAILURES).includes(error?.code);
  const sessionRequired = !recovery && Number(error?.status || 0) === 401;
  const rateLimited = !recovery && Number(error?.status || 0) === 429;
  return {
    error: recovery
      ? error.message
      : sessionRequired
        ? "Sign in to review a recovery plan."
        : rateLimited
          ? "Too many plan review attempts. Please wait a minute and try again."
          : "Recovery analysis could not be completed.",
    code: recovery
      ? error.code
      : sessionRequired
        ? RECOVERY_FAILURES.SESSION_REQUIRED
        : rateLimited
          ? RECOVERY_FAILURES.RATE_LIMITED
          : RECOVERY_FAILURES.PROVIDER_FAILED,
    retryable: recovery ? error.retryable : rateLimited,
    correlationId: error?.correlationId || fallbackCorrelationId || null,
  };
}
