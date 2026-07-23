import { createHash } from "node:crypto";
import { providerForOrdinal, providerOrderForOrdinal, runProviderFallback } from "./providers.js";
import { PRIMARY_KEY_RING, createRouterV2Session, runProviderRouterV2 } from "./providerRouterV2.js";

const MAX_OPERATION_ID_LENGTH = 160;
const MAX_OUTCOME_BYTES = 128 * 1024;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeOutcome(value) {
  if (value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > MAX_OUTCOME_BYTES) {
      return { outcomeStored: false, reason: "outcome_too_large" };
    }
    return JSON.parse(serialized);
  } catch {
    return { outcomeStored: false, reason: "outcome_not_serializable" };
  }
}

function rolloutBucket(userId) {
  const digest = createHash("sha256").update(String(userId || "anonymous")).digest();
  return digest.readUInt32BE(0) % 100;
}

function cycleEnabledForUser(config, userId) {
  if (config?.routing?.enabled !== true) return false;
  const percent = Number(config.routing.rolloutPercent || 0);
  return percent >= 100 || (percent > 0 && rolloutBucket(userId) < percent);
}

function routerV2EnabledForUser(config, userId) {
  if (config?.routing?.v2?.enabled !== true) return false;
  const percent = Number(config.routing.v2.rolloutPercent || 0);
  return percent >= 100 || (percent > 0 && rolloutBucket(userId) < percent);
}

function globalRouterOperationId(userId, requestId) {
  const digest = createHash("sha256").update(`${String(userId)}:${String(requestId)}`).digest("hex");
  return `router:${digest}`;
}

function validPrimaryClaim(claim) {
  const ordinal = Number(claim?.ordinal);
  const slotOrdinal = Number(claim?.slotOrdinal);
  const leaseExpiresAt = Date.parse(claim?.leaseExpiresAt || "");
  return Number.isSafeInteger(ordinal)
    && ordinal > 0
    && Number.isInteger(slotOrdinal)
    && slotOrdinal >= 1
    && slotOrdinal <= PRIMARY_KEY_RING.length
    && ((ordinal - 1) % PRIMARY_KEY_RING.length) + 1 === slotOrdinal
    && Number.isFinite(leaseExpiresAt)
    && leaseExpiresAt > Date.now();
}

function safePrimaryClaimError() {
  const error = new Error("AI routing is temporarily unavailable. Please retry this action.");
  error.status = 503;
  error.code = "ai_router_v2_primary_claim_failed";
  return error;
}

export function getAiOperationId({ idempotencyKey, requestId } = {}) {
  const supplied = String(idempotencyKey || "").trim();
  if (!supplied) return String(requestId || "").trim();
  if (supplied.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(supplied)) {
    const error = new Error("Please retry this action with a new request.");
    error.status = 400;
    error.code = "invalid_idempotency_key";
    throw error;
  }
  const operationId = `idem:${supplied}`;
  if (operationId.length > MAX_OPERATION_ID_LENGTH) throw new Error("invalid_ai_operation_id");
  return operationId;
}

export function fingerprintAiOperation(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

async function completeWithRetry({ repository, session, completion, logger }) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await repository.completeRoutedAiOperation(session, completion);
    } catch (error) {
      lastError = error;
      logger?.warn?.("ai_routing.completion_retry", {
        requestId: completion.requestId,
        attempt,
        status: error?.status || 500,
      });
      if (attempt < 3) await sleep(25 * attempt);
    }
  }
  throw lastError || new Error("ai_operation_settlement_failed");
}

function operationConflictError(error) {
  if (!/idempotency_key_reused_with_different_request/i.test(String(error?.message || ""))) return error;
  const conflict = new Error("This request changed while it was being retried. Please start it again.");
  conflict.status = 409;
  conflict.code = "idempotency_conflict";
  return conflict;
}

async function beginWithWait({ repository, session, allowanceRequest, requestFingerprint, config }) {
  const waitUntil = Date.now() + Number(config.routing.concurrentWaitMs || 5_000);
  let result;
  do {
    try {
      result = await repository.beginRoutedAiOperation(session, {
        ...allowanceRequest,
        requestFingerprint,
        leaseMs: config.routing.leaseMs,
      });
    } catch (error) {
      throw operationConflictError(error);
    }
    if (!result?.busy) return result;
    // An unrelated operation must never acquire a reservation from a state
    // snapshot loaded before that operation finished. Give it the bounded
    // grace period, then make the caller retry and reload current domain state.
    if (result.sameOperation !== true) {
      await sleep(Math.max(0, waitUntil - Date.now()));
      return result;
    }
    if (Date.now() >= waitUntil) return result;
    await sleep(Math.min(Number(config.routing.replayPollMs || 125), Math.max(1, waitUntil - Date.now())));
  } while (Date.now() <= waitUntil);
  return result;
}

async function executeLegacyOperation({ repository, session, config, allowanceRequest, responseMode, fixedProviderOrder, fetchImpl, run, isLogicalSuccess, logger }) {
  const reservation = await repository.reserveAiWeeklyAllowance(session, allowanceRequest);
  if (!reservation.allowed) return { blocked: true, reservation, result: null, settlement: null, success: false };
  let result;
  try {
    const providerOrder = Array.isArray(fixedProviderOrder) && fixedProviderOrder.length
      ? [...new Set(fixedProviderOrder)]
      : null;
    const providerExecutor = providerOrder
      ? (providerRequest = {}) => runProviderFallback({
          ...providerRequest,
          responseMode: providerRequest.responseMode || responseMode,
          providerOrder,
          config,
          fetchImpl: providerRequest.fetchImpl || fetchImpl,
        })
      : runProviderFallback;
    result = await run({ providerExecutor, routed: false });
  } catch (error) {
    await repository.settleAiWeeklyAllowance(session, { requestId: allowanceRequest.requestId, status: "refunded" }).catch(() => null);
    throw error;
  }
  const success = isLogicalSuccess(result);
  const settlement = await repository.settleAiWeeklyAllowance(session, {
    requestId: allowanceRequest.requestId,
    status: success ? "charged" : "refunded",
  }).catch((error) => {
    logger?.warn?.("ai_allowance.settlement_failed", { requestId: allowanceRequest.requestId, status: error?.status || 500 });
    return null;
  });
  return { blocked: false, busy: false, replay: false, reservation, result, settlement, success, routed: false };
}

export async function executeAuthorizedAiOperation({
  repository,
  session,
  config,
  allowanceRequest,
  requestFingerprint,
  workflow,
  responseMode = "text",
  fixedProviderOrder = null,
  forceRoutedLifecycle = false,
  storeFailedOutcome = true,
  run,
  isLogicalSuccess,
  outcomeForReplay = (result) => result,
  logger = null,
  fetchImpl = globalThis.fetch,
  signal = null,
}) {
  const userId = session?.user?.id;
  if (!repository || !userId || !allowanceRequest?.requestId || typeof run !== "function" || typeof isLogicalSuccess !== "function") {
    throw new Error("invalid_authorized_ai_operation");
  }
  if (signal?.aborted) {
    const error = new Error("ai_operation_aborted");
    error.name = "AbortError";
    throw error;
  }

  const routerV2 = routerV2EnabledForUser(config, userId);
  const routed = routerV2 || forceRoutedLifecycle === true || cycleEnabledForUser(config, userId);
  if (!routed) {
    if (config?.routing?.shadow === true) {
      repository.getAiWeeklySuccessfulRequestCount(session, { periodKey: allowanceRequest.periodKey })
        .then((count) => logger?.info?.("ai_routing.shadow_ordinal", {
          workflow,
          ordinal: count + 1,
          primaryProvider: providerForOrdinal(count + 1),
        }))
        .catch(() => null);
    }
    return executeLegacyOperation({ repository, session, config, allowanceRequest, responseMode, fixedProviderOrder, fetchImpl, run, isLogicalSuccess, logger });
  }

  const reservation = await beginWithWait({ repository, session, allowanceRequest, requestFingerprint, config });
  if (reservation?.busy) {
    return { blocked: false, busy: true, replay: false, reservation, result: null, settlement: null, success: false, routed: true };
  }
  if (!reservation?.allowed) {
    return { blocked: true, busy: false, replay: Boolean(reservation?.replay), reservation, result: null, settlement: null, success: false, routed: true };
  }
  if (reservation.replay) {
    const replaySuccess = isLogicalSuccess(reservation.outcome);
    return {
      blocked: false,
      busy: false,
      replay: true,
      reservation,
      result: reservation.outcome,
      settlement: null,
      success: replaySuccess,
      routed: true,
      ordinal: reservation.selectedOrdinal,
    };
  }

  let routerOperationId = null;
  let routerSession = null;
  let routerClaim = null;
  if (routerV2) {
    routerOperationId = globalRouterOperationId(userId, allowanceRequest.requestId);
    try {
      routerClaim = await repository.claimAiRouterPrimary({
        operationId: routerOperationId,
        leaseMs: config.routing.leaseMs,
      });
      if (!validPrimaryClaim(routerClaim)) throw safePrimaryClaimError();
    } catch (error) {
      await completeWithRetry({
        repository,
        session,
        logger,
        completion: {
          requestId: allowanceRequest.requestId,
          succeeded: false,
          primaryProvider: null,
          finalProvider: null,
          attempts: [{ outcome: "scheduler_claim_failed" }],
          outcome: null,
        },
      }).catch(() => null);
      await repository.completeAiRouterOperation({ operationId: routerOperationId }).catch(() => null);
      logger?.warn?.("ai_router_v2.primary_claim_failed", {
        operationCorrelationHash: createHash("sha256").update(routerOperationId).digest("hex").slice(0, 24),
        status: Number(error?.status || 500),
        malformedResponse: error?.code === "ai_router_v2_primary_claim_failed",
      });
      throw safePrimaryClaimError();
    }
    routerSession = createRouterV2Session({ primarySlotOrdinal: routerClaim.slotOrdinal });
  }
  const ordinal = routerV2
    ? Number(routerClaim.ordinal)
    : Number(reservation.selectedOrdinal || reservation.successfulCount + 1);
  const providerOrder = routerV2
    ? [PRIMARY_KEY_RING[routerClaim.slotOrdinal - 1]?.providerCode || "groq"]
    : Array.isArray(fixedProviderOrder) && fixedProviderOrder.length
      ? [...new Set(fixedProviderOrder)]
      : providerOrderForOrdinal(ordinal);
  const operationDeadline = Date.now() + Number(config.routing.operationTimeoutMs || 120_000);
  let latestProviderResult = null;
  const providerExecutor = async (providerRequest = {}) => {
    latestProviderResult = routerV2
      ? await runProviderRouterV2({
          ...providerRequest,
          scheduler: repository,
          operationId: routerOperationId,
          routerSession,
          responseMode: providerRequest.responseMode || responseMode,
          operationDeadline,
          config,
          fetchImpl: providerRequest.fetchImpl || fetchImpl,
          signal: providerRequest.signal || signal,
          logger,
        })
      : await runProviderFallback({
          ...providerRequest,
          responseMode: providerRequest.responseMode || responseMode,
          providerOrder,
          operationDeadline,
          config,
          fetchImpl: providerRequest.fetchImpl || fetchImpl,
          signal: providerRequest.signal || signal,
        });
    return latestProviderResult;
  };

  let result;
  try {
    result = await run({ providerExecutor, operationDeadline, ordinal, routed: true });
  } catch (error) {
    await completeWithRetry({
      repository,
      session,
      logger,
      completion: {
        requestId: allowanceRequest.requestId,
        succeeded: false,
        primaryProvider: providerOrder[0],
        finalProvider: null,
        attempts: latestProviderResult?.attempts || [],
        outcome: null,
      },
    }).catch(() => null);
    if (routerV2) await repository.completeAiRouterOperation({ operationId: routerOperationId }).catch(() => null);
    throw error;
  }

  const success = isLogicalSuccess(result);
  const replayOutcome = success ? outcomeForReplay(result) : storeFailedOutcome ? result : null;
  let settlement;
  try {
    settlement = await completeWithRetry({
      repository,
      session,
      logger,
      completion: {
        requestId: allowanceRequest.requestId,
        succeeded: success,
        primaryProvider: providerOrder[0],
        finalProvider: success ? latestProviderResult?.providerCode || null : null,
        attempts: latestProviderResult?.attempts || [],
        outcome: safeOutcome(replayOutcome),
      },
    });
  } finally {
    if (routerV2) await repository.completeAiRouterOperation({ operationId: routerOperationId }).catch(() => null);
  }

  return {
    blocked: false,
    busy: false,
    replay: false,
    reservation,
    result,
    settlement,
    success,
    routed: true,
    routerV2,
    ordinal,
  };
}

export function isProviderCycleEnabledForUser(config, userId) {
  return cycleEnabledForUser(config, userId);
}

export function isRouterV2EnabledForUser(config, userId) {
  return routerV2EnabledForUser(config, userId);
}
