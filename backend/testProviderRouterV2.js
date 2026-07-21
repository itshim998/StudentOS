import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getAiProviderConfig, getSafeAiProviderStatus } from "./ai/providerConfig.js";
import { executeAuthorizedAiOperation, fingerprintAiOperation, isRouterV2EnabledForUser } from "./ai/authorizedAiExecutionService.js";
import { cooldownForProviderFailure, createRouterV2Session, PRIMARY_KEY_RING, runProviderRouterV2 } from "./ai/providerRouterV2.js";
import { AiRouterV2Coordinator, createMockRouterV2Store } from "./ai/routerV2State.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { redactSecrets } from "./observability/logger.js";

function providerEnv(overrides = {}) {
  return {
    STUDENTOS_AI_MODE: "auto",
    STUDENTOS_AI_ROUTER_V2_ENABLED: "true",
    STUDENTOS_AI_ROUTER_V2_ROLLOUT_PERCENT: "100",
    STUDENTOS_AI_NVIDIA_ENABLED: "true",
    STUDENTOS_AI_GROQ_ENABLED: "true",
    STUDENTOS_AI_GEMINI_ENABLED: "true",
    STUDENTOS_AI_POLLINATIONS_ENABLED: "true",
    STUDENTOS_AI_LOGICAL_OPERATION_TIMEOUT_MS: "120000",
    GROQ_API_KEY_1: "test-groq-1",
    GROQ_API_KEY_2: "test-groq-2",
    GROQ_API_KEY_3: "test-groq-3",
    GROQ_API_KEY_4: "test-groq-4",
    GROQ_API_KEY_5: "test-groq-5",
    GEMINI_API_KEY_1: "test-gemini-1",
    GEMINI_API_KEY_2: "test-gemini-2",
    GEMINI_API_KEY_3: "test-gemini-3",
    GEMINI_API_KEY_4: "test-gemini-4",
    GEMINI_API_KEY_5: "test-gemini-5",
    GEMINI_API_KEY_6: "test-gemini-6",
    NVIDIA_API_KEY_1: "test-nvidia-1",
    NVIDIA_API_KEY_2: "test-nvidia-2",
    NVIDIA_API_KEY_3: "test-nvidia-3",
    POLLINATIONS_API_KEY: "test-pollinations-1",
    POLLINATIONS_TEXT_MODEL: "gpt-oss",
    POLLINATIONS_FALLBACK_MAX_MS: "3600000",
    POLLINATIONS_UPSTREAM_PROBE_INTERVAL_MS: "300000",
    ...overrides,
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function successResponse(url) {
  if (String(url).includes("generativelanguage")) {
    return jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 2 } });
  }
  return jsonResponse({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { total_tokens: 2 } });
}

function calledSlot(url, options = {}) {
  const auth = String(options?.headers?.Authorization || "");
  const bearer = auth.replace(/^Bearer\s+/i, "");
  if (bearer.startsWith("test-groq-")) return `G${bearer.at(-1)}`;
  if (bearer.startsWith("test-nvidia-")) return `N${bearer.at(-1)}`;
  if (bearer.startsWith("test-pollinations")) return "P1";
  const key = new URL(String(url)).searchParams.get("key") || "";
  if (key.startsWith("test-gemini-")) return `M${key.at(-1)}`;
  return "unknown";
}

function repositoryWithCoordinator(coordinator) {
  return new StudentOsRepository({ config: { mode: "mock" }, shardClients: [], aiRouterCoordinator: coordinator });
}

async function directRouterOperation({ repository, config, operationId, fetchImpl, responseMode = "text", validateOutput = null, signal = null }) {
  const claim = await repository.claimAiRouterPrimary({ operationId, leaseMs: 180_000 });
  try {
    return await runProviderRouterV2({
      scheduler: repository,
      operationId,
      routerSession: createRouterV2Session({ primarySlotOrdinal: claim.slotOrdinal }),
      messages: [{ role: "user", content: "test" }],
      responseMode,
      validateOutput,
      operationDeadline: Date.now() + 120_000,
      config,
      fetchImpl,
      signal,
      random: () => 0.5,
    });
  } finally {
    await repository.completeAiRouterOperation({ operationId });
  }
}

const config = getAiProviderConfig(providerEnv());
assert.equal(config.groq.keyCount, 5);
assert.equal(config.gemini.keyCount, 6);
assert.equal(config.nvidia.keyCount, 3);
assert.equal(config.pollinations.textModel, "gpt-oss");
assert.equal(config.routing.v2.enabled, true);
assert.equal(getSafeAiProviderStatus(config).secretsExposed, false);

const duplicateConfig = getAiProviderConfig(providerEnv({ GROQ_API_KEY_2: "test-groq-1" }));
assert.equal(duplicateConfig.groq.keyCount, 4);
assert.equal(duplicateConfig.groq.duplicateKeyDetected, true);
assert.equal(JSON.stringify(getSafeAiProviderStatus(duplicateConfig)).includes("test-groq"), false);

const exactStore = createMockRouterV2Store();
const exactCoordinator = new AiRouterV2Coordinator({ store: exactStore });
const exactClaims = [];
for (let index = 1; index <= 12; index += 1) exactClaims.push(await exactCoordinator.claimPrimary({ operationId: `sequence-${index}`, leaseMs: 10_000 }));
assert.deepEqual(exactClaims.map((claim) => {
  const slot = PRIMARY_KEY_RING[claim.slotOrdinal - 1];
  return `${slot.providerCode === "groq" ? "G" : "M"}${slot.slotNumber}`;
}), ["G1", "G2", "G3", "G4", "G5", "M1", "M2", "M3", "M4", "M5", "M6", "G1"]);

const globalUserClaims = await Promise.all([
  exactCoordinator.claimPrimary({ operationId: "user-a-operation", leaseMs: 10_000 }),
  exactCoordinator.claimPrimary({ operationId: "user-b-operation", leaseMs: 10_000 }),
]);
assert.deepEqual(globalUserClaims.map((claim) => claim.ordinal), [13, 14], "cursor must be global rather than per user");
const replayClaim = await exactCoordinator.claimPrimary({ operationId: "user-a-operation", leaseMs: 20_000, nowMs: 50_000 });
assert.equal(replayClaim.ordinal, 13, "same logical operation must retain its global ordinal");
assert.equal(exactStore.primaryCursor, 14, "replay must not advance the global cursor");

const atomicStore = createMockRouterV2Store();
const apiCoordinator = new AiRouterV2Coordinator({ store: atomicStore });
const workerCoordinator = new AiRouterV2Coordinator({ store: atomicStore });
const concurrentClaims = await Promise.all(Array.from({ length: 40 }, (_, index) => (
  (index % 2 ? apiCoordinator : workerCoordinator).claimPrimary({ operationId: `concurrent-${index}`, leaseMs: 10_000 })
)));
assert.equal(new Set(concurrentClaims.map((claim) => claim.ordinal)).size, 40);
assert.deepEqual(concurrentClaims.map((claim) => claim.ordinal).sort((a, b) => a - b), Array.from({ length: 40 }, (_, index) => index + 1));

const restartStore = createMockRouterV2Store();
const beforeRestart = new AiRouterV2Coordinator({ store: restartStore });
await beforeRestart.claimPrimary({ operationId: "restart-before", leaseMs: 10_000, nowMs: 1_000 });
await beforeRestart.claimSlot({ operationId: "restart-before", providerCode: "groq", slotNumber: 1, credentialFingerprint: "fp-g1", nowMs: 1_000 });
await beforeRestart.recordFailure({ operationId: "restart-before", providerCode: "groq", slotNumber: 1, statusClass: "rate_limited", cooldownMs: 60_000, nowMs: 1_000 });
const afterRestart = new AiRouterV2Coordinator({ store: restartStore });
assert.equal((await afterRestart.claimSlot({ operationId: "restart-after", providerCode: "groq", slotNumber: 1, credentialFingerprint: "fp-g1", nowMs: 2_000 })).eligible, false);
assert.equal((await afterRestart.claimSlot({ operationId: "restart-after", providerCode: "groq", slotNumber: 2, credentialFingerprint: "fp-g2", nowMs: 2_000 })).eligible, true);
assert.equal((await afterRestart.claimSlot({ operationId: "restart-after", providerCode: "gemini", slotNumber: 1, credentialFingerprint: "fp-m1", nowMs: 2_000 })).eligible, true);
assert.equal((await afterRestart.claimSlot({ operationId: "restart-after", providerCode: "nvidia", slotNumber: 1, credentialFingerprint: "fp-n1", nowMs: 2_000 })).eligible, true);
await afterRestart.recordFailure({ operationId: "restart-after", providerCode: "gemini", slotNumber: 1, statusClass: "credential_rejected", disable: true, nowMs: 2_000 });
assert.equal((await afterRestart.claimSlot({ operationId: "later", providerCode: "gemini", slotNumber: 1, credentialFingerprint: "fp-m1", nowMs: 100_000 })).healthState, "disabled");

const retryError = Object.assign(new Error("rate limit"), { status: 429, retryAfterMs: 12_345 });
assert.equal(cooldownForProviderFailure(retryError, { failureCount: 4, providerConfig: config.groq, random: () => 0 }), 12_345);
const transientCooldown = cooldownForProviderFailure(Object.assign(new Error("temporary"), { status: 503 }), { providerConfig: { keyCooldownMs: 10_000 }, random: () => 0 });
assert.ok(transientCooldown >= 9_000 && transientCooldown <= 11_000);
const exponentialCooldown = cooldownForProviderFailure(Object.assign(new Error("limit"), { status: 429 }), { failureCount: 4, providerConfig: config.groq, random: () => 0.5 });
assert.equal(exponentialCooldown, 3_600_000);

const sequenceCalls = [];
const sequenceRepo = repositoryWithCoordinator(new AiRouterV2Coordinator());
for (let index = 1; index <= 12; index += 1) {
  const result = await directRouterOperation({
    repository: sequenceRepo,
    config,
    operationId: `network-sequence-${index}`,
    fetchImpl: async (url, options) => {
      sequenceCalls.push(calledSlot(url, options));
      return successResponse(url);
    },
  });
  assert.equal(result.generationSucceeded, true);
}
assert.deepEqual(sequenceCalls, ["G1", "G2", "G3", "G4", "G5", "M1", "M2", "M3", "M4", "M5", "M6", "G1"]);
assert.equal(sequenceCalls.includes("N1"), false, "NVIDIA must not receive scheduled primary traffic");
assert.equal(sequenceCalls.includes("P1"), false, "Pollinations must not receive scheduled traffic");

const repairRepo = repositoryWithCoordinator(new AiRouterV2Coordinator());
const repairClaim = await repairRepo.claimAiRouterPrimary({ operationId: "repair-continuation", leaseMs: 180_000 });
const repairSession = createRouterV2Session({ primarySlotOrdinal: repairClaim.slotOrdinal });
const repairCalls = [];
for (let index = 0; index < 2; index += 1) {
  await runProviderRouterV2({
    scheduler: repairRepo,
    operationId: "repair-continuation",
    routerSession: repairSession,
    messages: [{ role: "user", content: "repair" }],
    operationDeadline: Date.now() + 120_000,
    config,
    fetchImpl: async (url, options) => {
      repairCalls.push(calledSlot(url, options));
      return successResponse(url);
    },
  });
}
await repairRepo.completeAiRouterOperation({ operationId: "repair-continuation" });
assert.deepEqual(repairCalls, ["G1", "G2"], "repair calls in one logical operation must continue without retrying a slot");
assert.equal(repairSession.attempts.length, 2);

const fallbackCalls = [];
const fallbackRepo = repositoryWithCoordinator(new AiRouterV2Coordinator());
const fallbackFetch = async (url, options) => {
  const slot = calledSlot(url, options);
  fallbackCalls.push(slot);
  return slot.startsWith("N") ? successResponse(url) : jsonResponse({ error: { message: "temporary" } }, 503);
};
for (let index = 1; index <= 3; index += 1) {
  const result = await directRouterOperation({ repository: fallbackRepo, config, operationId: `nvidia-rotation-${index}`, fetchImpl: fallbackFetch });
  assert.equal(result.providerCode, "nvidia");
}
assert.deepEqual(fallbackCalls.filter((slot) => slot.startsWith("N")), ["N1", "N2", "N3"]);
assert.equal(fallbackCalls.indexOf("N1") > fallbackCalls.indexOf("M6"), true, "NVIDIA must follow every primary slot");

const pollCalls = [];
const pollRepo = repositoryWithCoordinator(new AiRouterV2Coordinator());
const pollResult = await directRouterOperation({
  repository: pollRepo,
  config,
  operationId: "poll-final-resort",
  fetchImpl: async (url, options) => {
    const slot = calledSlot(url, options);
    pollCalls.push(slot);
    return slot === "P1" ? successResponse(url) : jsonResponse({ error: { message: "temporary" } }, 503);
  },
});
assert.equal(pollResult.providerCode, "pollinations");
assert.equal(pollCalls.at(-1), "P1");
assert.deepEqual(pollCalls.filter((slot) => slot.startsWith("N")), ["N1", "N2", "N3"]);

const pollStateStore = createMockRouterV2Store();
const pollState = new AiRouterV2Coordinator({ store: pollStateStore });
await pollState.enterPollinations({ operationId: "poll-enter", fallbackMaxMs: 3_600_000, probeIntervalMs: 300_000, nowMs: 1_000 });
assert.equal((await pollState.getPollinationsDecision({ operationId: "too-early", probeIntervalMs: 300_000, nowMs: 200_000 })).probe, false);
assert.equal((await pollState.getPollinationsDecision({ operationId: "probe-due", probeIntervalMs: 300_000, nowMs: 301_001 })).probe, true);
await pollState.leavePollinations({ operationId: "probe-due" });
assert.equal((await pollState.getPollinationsDecision({ operationId: "recovered", probeIntervalMs: 300_000, nowMs: 302_000 })).active, false);
await pollState.enterPollinations({ operationId: "poll-expire", fallbackMaxMs: 3_600_000, probeIntervalMs: 300_000, nowMs: 1_000 });
assert.equal((await pollState.getPollinationsDecision({ operationId: "after-hour", probeIntervalMs: 300_000, nowMs: 3_601_001 })).active, false);

const structuredConfig = getAiProviderConfig(providerEnv({ NVIDIA_STRUCTURED_MODEL: "" }));
const structuredCalls = [];
const structuredResult = await directRouterOperation({
  repository: repositoryWithCoordinator(new AiRouterV2Coordinator()),
  config: structuredConfig,
  operationId: "structured-skip-kimi",
  responseMode: "json",
  validateOutput: (result) => JSON.parse(result.text),
  fetchImpl: async (url, options) => {
    const slot = calledSlot(url, options);
    structuredCalls.push(slot);
    if (slot === "P1") return jsonResponse({ choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }] });
    return jsonResponse({ error: { message: "temporary" } }, 503);
  },
});
assert.equal(structuredResult.providerCode, "pollinations");
assert.equal(structuredCalls.some((slot) => slot.startsWith("N")), false);
assert.equal(structuredResult.attempts.some((attempt) => attempt.provider === "nvidia" && attempt.skipReason === "structured_model_not_configured"), true);

const malformedCalls = [];
const malformedResult = await directRouterOperation({
  repository: repositoryWithCoordinator(new AiRouterV2Coordinator()),
  config: structuredConfig,
  operationId: "strict-json-rejects-prose",
  responseMode: "json",
  validateOutput: (result) => JSON.parse(result.text),
  fetchImpl: async (url, options) => {
    const slot = calledSlot(url, options);
    malformedCalls.push(slot);
    const content = slot === "G1" ? "prose {\"ok\":true}" : "{\"ok\":true}";
    return jsonResponse({ choices: [{ message: { content }, finish_reason: "stop" }] });
  },
});
assert.equal(malformedResult.generationSucceeded, true);
assert.deepEqual(malformedCalls, ["G1", "G2"]);
assert.equal(malformedResult.attempts[0].outcome, "invalid_output");

const compatibilityRepo = repositoryWithCoordinator(new AiRouterV2Coordinator());
const compatibilityResult = await directRouterOperation({
  repository: compatibilityRepo,
  config: getAiProviderConfig(providerEnv({ STUDENTOS_AI_NVIDIA_ENABLED: "false", STUDENTOS_AI_POLLINATIONS_ENABLED: "false" })),
  operationId: "compatibility-no-cooldown",
  fetchImpl: async () => jsonResponse({ error: { message: "unsupported payload" } }, 400),
});
assert.equal(compatibilityResult.providerFailure, true);
assert.equal(compatibilityRepo.getSafeAiRouterState().slots.every((slot) => slot.healthState === "healthy"), true);
assert.equal(compatibilityRepo.getSafeAiRouterState().pollinationsFallbackActive, false, "an unavailable Pollinations provider must not activate final-resort mode");

const retryRepo = repositoryWithCoordinator(new AiRouterV2Coordinator());
const retryResult = await directRouterOperation({
  repository: retryRepo,
  config,
  operationId: "retry-after",
  fetchImpl: async (url, options) => calledSlot(url, options) === "G1"
    ? jsonResponse({ error: { message: "rate limited" } }, 429, { "Retry-After": "120" })
    : successResponse(url),
});
assert.equal(retryResult.generationSucceeded, true);
const retrySlot = retryRepo.getSafeAiRouterState().slots.find((slot) => slot.providerCode === "groq" && slot.slotNumber === 1);
assert.equal(retrySlot.healthState, "cooling");
assert.ok(Date.parse(retrySlot.cooldownUntil) - Date.now() > 115_000);

const policyCalls = [];
const policyResult = await directRouterOperation({
  repository: repositoryWithCoordinator(new AiRouterV2Coordinator()),
  config,
  operationId: "policy-stop",
  fetchImpl: async (url, options) => {
    policyCalls.push(calledSlot(url, options));
    return jsonResponse({ error: { message: "content policy violation", type: "safety" } }, 400);
  },
});
assert.equal(policyResult.policyBlocked, true);
assert.deepEqual(policyCalls, ["G1"]);

const allowanceStore = createMockRouterV2Store();
const allowanceRepo = repositoryWithCoordinator(new AiRouterV2Coordinator({ store: allowanceStore }));
const session = { authenticated: false, user: { id: "router-v2-user", email: "test@example.invalid" } };
const periodKey = "2026-W30";
const execution = await executeAuthorizedAiOperation({
  repository: allowanceRepo,
  session,
  config,
  workflow: "router_v2_allowance",
  requestFingerprint: fingerprintAiOperation({ workflow: "router_v2_allowance", input: "one" }),
  allowanceRequest: { planTier: "plus", periodKey, allowance: 220, actionType: "general_ask", creditCost: 1, requestId: "router-v2-one-charge" },
  fetchImpl: async (url, options) => calledSlot(url, options) === "G1" ? jsonResponse({ error: { message: "temporary" } }, 503) : successResponse(url),
  run: async ({ providerExecutor }) => providerExecutor({ messages: [{ role: "user", content: "one operation" }] }),
  isLogicalSuccess: (result) => result?.generationSucceeded === true,
});
assert.equal(execution.success, true);
assert.equal(execution.routerV2, true);
assert.equal(await allowanceRepo.getAiWeeklySuccessfulRequestCount(session, { periodKey }), 1);
const ledgerEntry = allowanceRepo.mock.aiUsageLedger.find((entry) => entry.requestId === "router-v2-one-charge");
assert.equal(ledgerEntry.routingAttempts.length, 2);
assert.equal(ledgerEntry.creditCost, 1);

await assert.rejects(() => executeAuthorizedAiOperation({
  repository: allowanceRepo,
  session,
  config,
  workflow: "router_v2_cancel",
  requestFingerprint: fingerprintAiOperation({ workflow: "router_v2_cancel" }),
  allowanceRequest: { planTier: "plus", periodKey, allowance: 220, actionType: "general_ask", creditCost: 1, requestId: "router-v2-cancel" },
  run: async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); },
  isLogicalSuccess: () => false,
}), /cancelled/);
assert.equal(allowanceRepo.mock.aiUsageLedger.find((entry) => entry.requestId === "router-v2-cancel").status, "refunded");
assert.equal([...allowanceStore.operations.values()].every((operation) => operation.completed), true);

const propagatedCancelStore = createMockRouterV2Store();
const propagatedCancelRepo = repositoryWithCoordinator(new AiRouterV2Coordinator({ store: propagatedCancelStore }));
const propagatedController = new AbortController();
const propagatedPromise = directRouterOperation({
  repository: propagatedCancelRepo,
  config,
  operationId: "provider-signal-cancel",
  signal: propagatedController.signal,
  fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("provider request aborted"), { name: "AbortError" })), { once: true });
  }),
});
setTimeout(() => propagatedController.abort(), 5);
await assert.rejects(propagatedPromise, /ai_operation_aborted/);
assert.equal([...propagatedCancelStore.operations.values()].every((operation) => operation.completed), true);

const legacyConfig = getAiProviderConfig(providerEnv({ STUDENTOS_AI_ROUTER_V2_ENABLED: "false", STUDENTOS_AI_PROVIDER_CYCLE_ENABLED: "false" }));
const legacyRepo = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const legacyExecution = await executeAuthorizedAiOperation({
  repository: legacyRepo,
  session,
  config: legacyConfig,
  workflow: "legacy_unchanged",
  requestFingerprint: "legacy",
  allowanceRequest: { planTier: "plus", periodKey, allowance: 220, actionType: "general_ask", creditCost: 1, requestId: "legacy-unchanged" },
  run: async ({ routed }) => ({ generationSucceeded: true, routed }),
  isLogicalSuccess: (result) => result?.generationSucceeded === true,
});
assert.equal(legacyExecution.routed, false);
assert.equal(legacyExecution.result.routed, false);
assert.equal(isRouterV2EnabledForUser(legacyConfig, session.user.id), false);
const percentageConfig = getAiProviderConfig(providerEnv({ STUDENTOS_AI_ROUTER_V2_ROLLOUT_PERCENT: "37" }));
assert.equal(isRouterV2EnabledForUser(percentageConfig, "stable-user"), isRouterV2EnabledForUser(percentageConfig, "stable-user"));

const redacted = redactSecrets({
  GEMINI_API_KEY_6: "AIzaThisShouldNeverAppear1234567890",
  NVIDIA_API_KEY_1: "nvapi-this-should-never-appear",
  message: "NVIDIA_API_KEY_3=nvapi-also-secret-value",
});
assert.equal(JSON.stringify(redacted).includes("nvapi-"), false);
assert.equal(JSON.stringify(redacted).includes("AIza"), false);

const centralMigration = await readFile(new URL("../supabase/migrations/202607210001_studentos_ai_router_v2_central.sql", import.meta.url), "utf8");
const shardMigration = await readFile(new URL("../supabase/migrations/202607210002_studentos_ai_router_v2_shards.sql", import.meta.url), "utf8");
for (const marker of ["claim_ai_router_primary", "claim_ai_router_nvidia", "claim_ai_router_slot", "record_ai_router_failure", "claim_ai_router_pollinations_probe", "pg_advisory_xact_lock", "service_role"]) assert.match(centralMigration, new RegExp(marker, "i"));
assert.match(shardMigration, /'nvidia'/i);
assert.doesNotMatch(centralMigration, /grant execute[^;]+to authenticated/is);

console.log("PASS | Provider Router V2 global key ring, shared health, fallback, settlement, security, and migration tests passed");
