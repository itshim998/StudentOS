import { createHash } from "node:crypto";
import {
  GeminiTextProvider,
  GroqGroundedProvider,
  NvidiaTextProvider,
  PollinationsTextProvider,
  isRequestCompatibilityError,
  providerStatusClass,
} from "./providers.js";

export const PRIMARY_KEY_RING = Object.freeze([
  Object.freeze({ providerCode: "groq", slotNumber: 1 }),
  Object.freeze({ providerCode: "groq", slotNumber: 2 }),
  Object.freeze({ providerCode: "groq", slotNumber: 3 }),
  Object.freeze({ providerCode: "groq", slotNumber: 4 }),
  Object.freeze({ providerCode: "groq", slotNumber: 5 }),
  Object.freeze({ providerCode: "gemini", slotNumber: 1 }),
  Object.freeze({ providerCode: "gemini", slotNumber: 2 }),
  Object.freeze({ providerCode: "gemini", slotNumber: 3 }),
  Object.freeze({ providerCode: "gemini", slotNumber: 4 }),
  Object.freeze({ providerCode: "gemini", slotNumber: 5 }),
  Object.freeze({ providerCode: "gemini", slotNumber: 6 }),
]);

export const NVIDIA_KEY_RING = Object.freeze([1, 2, 3]);
const RATE_LIMIT_SEQUENCE_MS = Object.freeze([60_000, 120_000, 300_000, 900_000, 3_600_000]);

function credentialFingerprint(keyRecord) {
  return createHash("sha256").update(String(keyRecord?.value || "")).digest("hex");
}

function ringFromStart(ring, startIndex) {
  const start = ((Number(startIndex || 1) - 1) % ring.length + ring.length) % ring.length;
  return [...ring.slice(start), ...ring.slice(0, start)];
}

function configuredKey(config, providerCode, slotNumber) {
  return config?.[providerCode]?.keys?.find((key) => key.index === slotNumber) || null;
}

function jitter(milliseconds, random) {
  const factor = 0.9 + (Math.max(0, Math.min(1, Number(random?.() ?? Math.random()))) * 0.2);
  return Math.max(1, Math.round(milliseconds * factor));
}

export function cooldownForProviderFailure(error, { failureCount = 0, providerConfig = {}, random = Math.random } = {}) {
  const status = Number(error?.status || 0);
  if (status === 429) {
    if (Number.isFinite(Number(error?.retryAfterMs)) && Number(error.retryAfterMs) >= 0) return Math.ceil(Number(error.retryAfterMs));
    const base = RATE_LIMIT_SEQUENCE_MS[Math.min(Math.max(0, Number(failureCount || 0)), RATE_LIMIT_SEQUENCE_MS.length - 1)];
    return jitter(base, random);
  }
  return jitter(Math.min(60_000, Math.max(1_000, Number(providerConfig.keyCooldownMs || 30_000))), random);
}

function abortError() {
  const error = new Error("ai_operation_aborted");
  error.name = "AbortError";
  return error;
}

function deadlineReached(operationDeadline) {
  return Boolean(operationDeadline && Date.now() >= operationDeadline);
}

function safeAttempt({ providerCode, slotNumber = null, attemptNumber, fallbackLevel, outcome, latencyMs = 0, cooldownMs = null, skipReason = null, model = null }) {
  return {
    provider: providerCode,
    slotNumber,
    attemptNumber,
    fallbackLevel,
    outcome,
    latencyMs,
    ...(cooldownMs ? { cooldownMs } : {}),
    ...(skipReason ? { skipReason } : {}),
    ...(model ? { model } : {}),
  };
}

function providerForSlot(providerCode, config, fetchImpl) {
  if (providerCode === "groq") return new GroqGroundedProvider({ config, fetchImpl });
  if (providerCode === "gemini") return new GeminiTextProvider({ config, fetchImpl });
  if (providerCode === "nvidia") return new NvidiaTextProvider({ config, fetchImpl });
  if (providerCode === "pollinations") return new PollinationsTextProvider({ config, fetchImpl });
  return null;
}

function resultFailure({ failures, attempts, invalidOutputSeen }) {
  return {
    provider: "none",
    providerCode: null,
    modelUsed: null,
    text: "",
    fallbackReason: failures.join(",") || "provider_unavailable",
    attempts,
    generationSucceeded: false,
    providerFailure: true,
    invalidOutputSeen,
  };
}

export function createRouterV2Session({ primarySlotOrdinal }) {
  return {
    primarySlotOrdinal,
    attemptedSlots: new Set(),
    attemptNumber: 0,
    attempts: [],
    failures: [],
    invalidOutputSeen: false,
    pollinationsAttempted: false,
  };
}

export async function runProviderRouterV2({
  scheduler,
  operationId,
  routerSession,
  messages,
  responseMode = "text",
  maxTokens,
  reasoningEffort,
  operationDeadline,
  validateOutput = null,
  config,
  fetchImpl = globalThis.fetch,
  signal = null,
  random = Math.random,
  logger = null,
} = {}) {
  if (!scheduler || !operationId || !routerSession || !config) throw new Error("invalid_ai_router_v2_request");
  const attempts = routerSession.attempts ||= [];
  const failures = routerSession.failures ||= [];
  let invalidOutputSeen = routerSession.invalidOutputSeen === true;
  const pollDecision = await scheduler.getAiRouterPollinationsDecision({
    operationId,
    probeIntervalMs: config.pollinations.upstreamProbeIntervalMs,
  });
  const shouldProbeUpstream = !pollDecision.active || pollDecision.probe;

  const trySlot = async ({ providerCode, slotNumber, fallbackLevel, model = null }) => {
    if (signal?.aborted) throw abortError();
    if (deadlineReached(operationDeadline)) {
      failures.push("operation_deadline_exceeded");
      return null;
    }
    const slotKey = `${providerCode}:${slotNumber}`;
    if (routerSession.attemptedSlots.has(slotKey)) return null;
    routerSession.attemptedSlots.add(slotKey);
    routerSession.attemptNumber += 1;
    const attemptNumber = routerSession.attemptNumber;
    const providerConfig = config[providerCode];
    const keyRecord = configuredKey(config, providerCode, slotNumber);
    if (config.routing?.providers?.[providerCode] === false || providerConfig?.enabled === false || !keyRecord) {
      const skipReason = !keyRecord ? "credential_slot_not_configured" : "provider_disabled";
      attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: "skipped", skipReason, model }));
      failures.push(`${providerCode}_${slotNumber}:${skipReason}`);
      return null;
    }
    const claim = await scheduler.claimAiRouterSlot({
      operationId,
      providerCode,
      slotNumber,
      credentialFingerprint: credentialFingerprint(keyRecord),
      leaseMs: Math.min(Number(providerConfig.timeoutMs || 45_000), Math.max(1_000, Number(config.routing.operationTimeoutMs || 120_000))),
    });
    if (!claim.eligible) {
      attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: "skipped", skipReason: claim.skipReason || claim.healthState, model }));
      failures.push(`${providerCode}_${slotNumber}:${claim.skipReason || claim.healthState}`);
      return null;
    }
    const provider = providerForSlot(providerCode, config, fetchImpl);
    const startedAt = Date.now();
    try {
      const result = await provider.generate({
        messages,
        responseMode,
        maxTokens,
        reasoningEffort,
        operationDeadline,
        signal,
        keyRecord,
        model,
        manageRuntimeHealth: false,
      });
      let validatedOutput = null;
      if (typeof validateOutput === "function") {
        try {
          validatedOutput = await validateOutput(result, { provider: providerCode, slotNumber });
        } catch {
          invalidOutputSeen = true;
          routerSession.invalidOutputSeen = true;
          const latencyMs = Date.now() - startedAt;
          attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: "invalid_output", latencyMs, model: result.modelUsed || model }));
          failures.push(`${providerCode}_${slotNumber}:invalid_output`);
          logger?.warn?.("ai_router_v2.attempt", { operationId, providerCode, slotNumber, attemptNumber, fallbackLevel, latencyMs, statusClass: "invalid_output" });
          return null;
        }
      }
      await scheduler.recordAiRouterSuccess({ operationId, providerCode, slotNumber });
      if (pollDecision.active) await scheduler.leaveAiRouterPollinations({ operationId });
      const latencyMs = Date.now() - startedAt;
      attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: "success", latencyMs, model: result.modelUsed || model }));
      logger?.info?.("ai_router_v2.attempt", { operationId, providerCode, slotNumber, attemptNumber, fallbackLevel, latencyMs, statusClass: "success", model: result.modelUsed || model });
      return {
        ...result,
        ...(typeof validateOutput === "function" ? { validatedOutput } : {}),
        attempts,
        generationSucceeded: true,
        providerFailure: false,
        invalidOutputSeen,
      };
    } catch (error) {
      if (signal?.aborted) throw abortError();
      const statusClass = providerStatusClass(error);
      const latencyMs = Date.now() - startedAt;
      if (error?.policyBlocked) {
        attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: "policy_blocked", latencyMs, model }));
        return {
          provider: "none",
          providerCode: null,
          modelUsed: null,
          text: "",
          fallbackReason: `${providerCode}:policy_blocked`,
          attempts,
          policyBlocked: true,
          generationSucceeded: false,
          providerFailure: true,
          invalidOutputSeen,
        };
      }
      if (isRequestCompatibilityError(error)) {
        attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: "request_incompatible", latencyMs, model }));
        failures.push(`${providerCode}_${slotNumber}:request_incompatible`);
        return null;
      }
      const disable = [401, 403].includes(Number(error?.status || 0));
      const cooldownMs = disable ? 0 : cooldownForProviderFailure(error, { failureCount: claim.failureCount, providerConfig, random });
      await scheduler.recordAiRouterFailure({ operationId, providerCode, slotNumber, statusClass, cooldownMs, disable });
      attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: statusClass, latencyMs, cooldownMs, model }));
      failures.push(`${providerCode}_${slotNumber}:${statusClass}`);
      logger?.warn?.("ai_router_v2.attempt", { operationId, providerCode, slotNumber, attemptNumber, fallbackLevel, latencyMs, statusClass, cooldownMs });
      return null;
    }
  };

  if (shouldProbeUpstream) {
    for (const slot of ringFromStart(PRIMARY_KEY_RING, routerSession.primarySlotOrdinal)) {
      const result = await trySlot({ ...slot, fallbackLevel: "primary" });
      if (result) return result;
      if (deadlineReached(operationDeadline)) return resultFailure({ failures, attempts, invalidOutputSeen });
    }

    if (config.routing?.providers?.nvidia !== false && config.nvidia.enabled !== false && config.nvidia.configured) {
      if (responseMode === "json" && !config.nvidia.structuredModel) {
        routerSession.attemptNumber += 1;
        attempts.push(safeAttempt({ providerCode: "nvidia", attemptNumber: routerSession.attemptNumber, fallbackLevel: "nvidia", outcome: "skipped", skipReason: "structured_model_not_configured" }));
        failures.push("nvidia:structured_model_not_configured");
      } else {
        const nvidiaClaim = await scheduler.claimAiRouterNvidia({ operationId });
        for (const slotNumber of ringFromStart(NVIDIA_KEY_RING, nvidiaClaim.slotNumber)) {
          const result = await trySlot({
            providerCode: "nvidia",
            slotNumber,
            fallbackLevel: "nvidia",
            model: responseMode === "json" ? config.nvidia.structuredModel : config.nvidia.model,
          });
          if (result) return result;
          if (deadlineReached(operationDeadline)) return resultFailure({ failures, attempts, invalidOutputSeen });
        }
      }
    }
  }

  if (signal?.aborted) throw abortError();
  if (deadlineReached(operationDeadline)) return resultFailure({ failures, attempts, invalidOutputSeen });
  if (routerSession.pollinationsAttempted) {
    failures.push("pollinations:already_attempted");
    return resultFailure({ failures, attempts, invalidOutputSeen });
  }
  routerSession.pollinationsAttempted = true;
  routerSession.attemptNumber += 1;
  const pollAttemptNumber = routerSession.attemptNumber;
  if (config.routing?.providers?.pollinations === false || config.pollinations.enabled === false || !config.pollinations.configured) {
    attempts.push(safeAttempt({ providerCode: "pollinations", attemptNumber: pollAttemptNumber, fallbackLevel: "final_resort", outcome: "skipped", skipReason: "not_configured" }));
    failures.push("pollinations:not_configured");
    return resultFailure({ failures, attempts, invalidOutputSeen });
  }
  const pollinations = providerForSlot("pollinations", config, fetchImpl);
  const pollStartedAt = Date.now();
  try {
    const result = await pollinations.generate({ messages, responseMode, maxTokens, operationDeadline, signal });
    let validatedOutput = null;
    if (typeof validateOutput === "function") {
      try {
        validatedOutput = await validateOutput(result, { provider: "pollinations", slotNumber: null });
      } catch {
        invalidOutputSeen = true;
        routerSession.invalidOutputSeen = true;
        if (pollDecision.active) await scheduler.leaveAiRouterPollinations({ operationId });
        attempts.push(safeAttempt({ providerCode: "pollinations", attemptNumber: pollAttemptNumber, fallbackLevel: "final_resort", outcome: "invalid_output", latencyMs: Date.now() - pollStartedAt, model: result.modelUsed }));
        failures.push("pollinations:invalid_output");
        return resultFailure({ failures, attempts, invalidOutputSeen });
      }
    }
    await scheduler.enterAiRouterPollinations({
      operationId,
      fallbackMaxMs: config.pollinations.fallbackMaxMs,
      probeIntervalMs: config.pollinations.upstreamProbeIntervalMs,
    });
    attempts.push(safeAttempt({ providerCode: "pollinations", attemptNumber: pollAttemptNumber, fallbackLevel: "final_resort", outcome: "success", latencyMs: Date.now() - pollStartedAt, model: result.modelUsed }));
    return { ...result, ...(typeof validateOutput === "function" ? { validatedOutput } : {}), attempts, generationSucceeded: true, providerFailure: false, invalidOutputSeen };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (pollDecision.active) await scheduler.leaveAiRouterPollinations({ operationId });
    const statusClass = providerStatusClass(error);
    attempts.push(safeAttempt({ providerCode: "pollinations", attemptNumber: pollAttemptNumber, fallbackLevel: "final_resort", outcome: statusClass, latencyMs: Date.now() - pollStartedAt }));
    failures.push(`pollinations:${statusClass}`);
    if (error?.policyBlocked) {
      return { ...resultFailure({ failures, attempts, invalidOutputSeen }), policyBlocked: true };
    }
    return resultFailure({ failures, attempts, invalidOutputSeen });
  }
}
