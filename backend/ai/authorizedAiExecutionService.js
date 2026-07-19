import { createHash } from "node:crypto";
import { providerForOrdinal, providerOrderForOrdinal, runProviderFallback } from "./providers.js";

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
  run,
  isLogicalSuccess,
  outcomeForReplay = (result) => result,
  logger = null,
  fetchImpl = globalThis.fetch,
}) {
  const userId = session?.user?.id;
  if (!repository || !userId || !allowanceRequest?.requestId || typeof run !== "function" || typeof isLogicalSuccess !== "function") {
    throw new Error("invalid_authorized_ai_operation");
  }

  const routed = cycleEnabledForUser(config, userId);
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

  const ordinal = Number(reservation.selectedOrdinal || reservation.successfulCount + 1);
  const providerOrder = Array.isArray(fixedProviderOrder) && fixedProviderOrder.length
    ? [...new Set(fixedProviderOrder)]
    : providerOrderForOrdinal(ordinal);
  const operationDeadline = Date.now() + Number(config.routing.operationTimeoutMs || 120_000);
  let latestProviderResult = null;
  const providerExecutor = async (providerRequest = {}) => {
    latestProviderResult = await runProviderFallback({
      ...providerRequest,
      responseMode: providerRequest.responseMode || responseMode,
      providerOrder,
      operationDeadline,
      config,
      fetchImpl: providerRequest.fetchImpl || fetchImpl,
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
    throw error;
  }

  const success = isLogicalSuccess(result);
  const replayOutcome = success ? outcomeForReplay(result) : result;
  const settlement = await completeWithRetry({
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

  return {
    blocked: false,
    busy: false,
    replay: false,
    reservation,
    result,
    settlement,
    success,
    routed: true,
    ordinal,
  };
}

export function isProviderCycleEnabledForUser(config, userId) {
  return cycleEnabledForUser(config, userId);
}
