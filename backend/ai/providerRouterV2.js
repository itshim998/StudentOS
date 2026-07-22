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
const MAX_PROVIDER_COOLDOWN_MS = 3_600_000;
const LEGACY_RATE_LIMIT_BACKOFF_MS = Object.freeze([60_000, 120_000, 300_000, 900_000, MAX_PROVIDER_COOLDOWN_MS]);

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
  const sampled = Number(random?.() ?? Math.random());
  const normalized = Number.isFinite(sampled) ? Math.max(0, Math.min(1, sampled)) : 0.5;
  const factor = 0.9 + (normalized * 0.2);
  return Math.max(1, Math.round(milliseconds * factor));
}

export function cooldownForProviderFailure(error, { failureCount = 0, providerConfig = {}, random = Math.random } = {}) {
  const status = Number(error?.status || 0);
  if (status === 429) {
    if (Number.isFinite(Number(error?.retryAfterMs)) && Number(error.retryAfterMs) >= 0) {
      return Math.min(MAX_PROVIDER_COOLDOWN_MS, Math.ceil(Number(error.retryAfterMs)));
    }
    const rawConfiguredBase = Number(providerConfig.rateLimitCooldownMs);
    const configuredBase = Math.min(MAX_PROVIDER_COOLDOWN_MS, Math.max(1_000, Number.isFinite(rawConfiguredBase) ? rawConfiguredBase : 60_000));
    const rawFailureCount = Number(failureCount);
    const exponent = Math.min(20, Math.max(0, Math.floor(Number.isFinite(rawFailureCount) ? rawFailureCount : 0)));
    const legacyBackoff = LEGACY_RATE_LIMIT_BACKOFF_MS[Math.min(exponent, LEGACY_RATE_LIMIT_BACKOFF_MS.length - 1)];
    const boundedBackoff = Math.min(MAX_PROVIDER_COOLDOWN_MS, Math.max(legacyBackoff, configuredBase * (2 ** exponent)));
    return Math.min(MAX_PROVIDER_COOLDOWN_MS, Math.max(configuredBase, jitter(boundedBackoff, random)));
  }
  const rawKeyCooldown = Number(providerConfig.keyCooldownMs);
  const keyCooldown = Math.min(60_000, Math.max(1_000, Number.isFinite(rawKeyCooldown) ? rawKeyCooldown : 30_000));
  return jitter(keyCooldown, random);
}

export function classifyRouterAttemptFailure(error) {
  if (error?.policyBlocked) return { category: "policy", outcome: "policy_blocked", mutatesHealth: false };
  if (isRequestCompatibilityError(error)) return { category: "request_specific", outcome: "request_incompatible", mutatesHealth: false };
  const status = Number(error?.status || 0);
  const message = String(error?.message || "");
  if (/empty_response|invalid[_ -]?output|malformed/i.test(message)) {
    return { category: "request_specific", outcome: "invalid_output", mutatesHealth: false };
  }
  if (error?.capabilitySkipped || /unsupported|capabilit/i.test(message)) {
    return { category: "request_specific", outcome: "unsupported_capability", mutatesHealth: false };
  }
  if ([401, 403].includes(status)) return { category: "availability", outcome: "credential_rejected", mutatesHealth: true };
  if (status === 429) return { category: "availability", outcome: "rate_limited", mutatesHealth: true };
  if (status === 408 || status >= 500) return { category: "availability", outcome: "transient_failure", mutatesHealth: true };
  if (error?.name === "AbortError" || /timed?\s*out|timeout/i.test(message)) {
    return { category: "availability", outcome: "provider_timeout", mutatesHealth: true };
  }
  if (error?.name === "TypeError" || /fetch|network|socket|transport|econn|temporar(?:y|ily)[_ -]?unavailable/i.test(message)) {
    return { category: "availability", outcome: "transport_failure", mutatesHealth: true };
  }
  return { category: "request_specific", outcome: providerStatusClass(error), mutatesHealth: false };
}

function abortError() {
  const error = new Error("ai_operation_aborted");
  error.name = "AbortError";
  return error;
}

function deadlineReached(operationDeadline) {
  return Boolean(operationDeadline && Date.now() >= operationDeadline);
}

function safeAttempt({ providerCode, slotNumber = null, attemptNumber, fallbackLevel, outcome, category = null, latencyMs = 0, cooldownMs = null, skipReason = null, model = null, casApplied = null }) {
  return {
    provider: providerCode,
    slotNumber,
    attemptNumber,
    fallbackLevel,
    outcome,
    ...(category ? { category } : {}),
    latencyMs,
    ...(cooldownMs ? { cooldownMs } : {}),
    ...(skipReason ? { skipReason } : {}),
    ...(model ? { model } : {}),
    ...(typeof casApplied === "boolean" ? { casApplied } : {}),
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
  const upstreamOutcomes = { availabilityFailures: 0, requestSpecificFailures: 0 };
  const operationCorrelationHash = createHash("sha256").update(String(operationId)).digest("hex").slice(0, 24);
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
      attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: "skipped", category: "ineligible_configuration", skipReason, model }));
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
      upstreamOutcomes.availabilityFailures += 1;
      attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: "skipped", category: "availability", skipReason: claim.skipReason || claim.healthState, model }));
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
          upstreamOutcomes.requestSpecificFailures += 1;
          const latencyMs = Date.now() - startedAt;
          attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: "invalid_output", category: "request_specific", latencyMs, model: result.modelUsed || model }));
          failures.push(`${providerCode}_${slotNumber}:invalid_output`);
          logger?.warn?.("ai_router_v2.attempt", { operationCorrelationHash, providerCode, slotNumber, attemptNumber, fallbackLevel, latencyMs, attemptCategory: "request_specific", statusClass: "invalid_output" });
          return null;
        }
      }
      const healthResult = await scheduler.recordAiRouterSuccess({ operationId, providerCode, slotNumber, claimToken: claim.claimToken });
      if (pollDecision.active && pollDecision.probe) {
        const transition = await scheduler.leaveAiRouterPollinations({ operationId, probeToken: pollDecision.probeToken });
        if (transition?.applied === false) logger?.warn?.("ai_router_v2.pollinations_transition_stale", { operationCorrelationHash, transition: "leave", applied: false });
      }
      const latencyMs = Date.now() - startedAt;
      attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: "success", category: "success", latencyMs, model: result.modelUsed || model, casApplied: healthResult?.applied !== false }));
      logger?.info?.("ai_router_v2.attempt", { operationCorrelationHash, providerCode, slotNumber, attemptNumber, fallbackLevel, latencyMs, attemptCategory: "success", statusClass: "success", casApplied: healthResult?.applied !== false, model: result.modelUsed || model });
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
      const classification = classifyRouterAttemptFailure(error);
      const latencyMs = Date.now() - startedAt;
      if (classification.category === "policy") {
        attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: "policy_blocked", category: "policy", latencyMs, model }));
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
      if (classification.category === "request_specific") {
        upstreamOutcomes.requestSpecificFailures += 1;
        if (classification.outcome === "invalid_output") {
          invalidOutputSeen = true;
          routerSession.invalidOutputSeen = true;
        }
        attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: classification.outcome, category: "request_specific", latencyMs, model }));
        failures.push(`${providerCode}_${slotNumber}:${classification.outcome}`);
        return null;
      }
      upstreamOutcomes.availabilityFailures += 1;
      const disable = [401, 403].includes(Number(error?.status || 0));
      const cooldownMs = disable ? 0 : cooldownForProviderFailure(error, { failureCount: claim.failureCount, providerConfig, random });
      const healthResult = await scheduler.recordAiRouterFailure({ operationId, providerCode, slotNumber, claimToken: claim.claimToken, statusClass: classification.outcome, cooldownMs, disable });
      attempts.push(safeAttempt({ providerCode, slotNumber, attemptNumber, fallbackLevel, outcome: classification.outcome, category: "availability", latencyMs, cooldownMs, model, casApplied: healthResult?.applied !== false }));
      failures.push(`${providerCode}_${slotNumber}:${classification.outcome}`);
      logger?.warn?.("ai_router_v2.attempt", { operationCorrelationHash, providerCode, slotNumber, attemptNumber, fallbackLevel, latencyMs, attemptCategory: "availability", statusClass: classification.outcome, cooldownMs, casApplied: healthResult?.applied !== false });
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
        attempts.push(safeAttempt({ providerCode: "nvidia", attemptNumber: routerSession.attemptNumber, fallbackLevel: "nvidia", outcome: "skipped", category: "ineligible_capability", skipReason: "structured_model_not_configured" }));
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
        attempts.push(safeAttempt({ providerCode: "pollinations", attemptNumber: pollAttemptNumber, fallbackLevel: "final_resort", outcome: "invalid_output", category: "request_specific", latencyMs: Date.now() - pollStartedAt, model: result.modelUsed }));
        failures.push("pollinations:invalid_output");
        return resultFailure({ failures, attempts, invalidOutputSeen });
      }
    }
    const availabilityExhausted = upstreamOutcomes.availabilityFailures > 0 && upstreamOutcomes.requestSpecificFailures === 0;
    if (!pollDecision.active && availabilityExhausted) {
      const transition = await scheduler.enterAiRouterPollinations({
        operationId,
        fallbackMaxMs: config.pollinations.fallbackMaxMs,
        probeIntervalMs: config.pollinations.upstreamProbeIntervalMs,
        expectedStateVersion: pollDecision.stateVersion,
      });
      if (transition?.applied === false) logger?.warn?.("ai_router_v2.pollinations_transition_stale", { operationCorrelationHash, transition: "enter", applied: false });
    }
    attempts.push(safeAttempt({ providerCode: "pollinations", attemptNumber: pollAttemptNumber, fallbackLevel: "final_resort", outcome: "success", category: "final_fallback", latencyMs: Date.now() - pollStartedAt, model: result.modelUsed }));
    return { ...result, ...(typeof validateOutput === "function" ? { validatedOutput } : {}), attempts, generationSucceeded: true, providerFailure: false, invalidOutputSeen };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    const statusClass = providerStatusClass(error);
    attempts.push(safeAttempt({ providerCode: "pollinations", attemptNumber: pollAttemptNumber, fallbackLevel: "final_resort", outcome: statusClass, category: error?.policyBlocked ? "policy" : "final_fallback", latencyMs: Date.now() - pollStartedAt }));
    failures.push(`pollinations:${statusClass}`);
    if (error?.policyBlocked) {
      return { ...resultFailure({ failures, attempts, invalidOutputSeen }), policyBlocked: true };
    }
    return resultFailure({ failures, attempts, invalidOutputSeen });
  }
}
