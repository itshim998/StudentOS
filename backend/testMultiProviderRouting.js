import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getAiProviderConfig } from "./ai/providerConfig.js";
import {
  GeminiTextProvider,
  buildGeminiRequestBody,
  providerForOrdinal,
  providerOrderForOrdinal,
  resetProviderRuntimeForTests,
  runProviderFallback,
  streamProviderFallback,
} from "./ai/providers.js";
import {
  executeAuthorizedAiOperation,
  fingerprintAiOperation,
  getAiOperationId,
} from "./ai/authorizedAiExecutionService.js";
import { AI_CREDIT_COSTS, AI_WEEKLY_ALLOWANCE_DEFAULTS, getAiWeeklyPeriod } from "./ai/aiWeeklyAllowanceService.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { redactSecrets } from "./observability/logger.js";
import { validateAzureAiProviderSecrets } from "../scripts/validateAzureAiProviderSecrets.js";

function response(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    json: async () => body,
  };
}

function providerEnv(overrides = {}) {
  return {
    STUDENTOS_AI_PROVIDER_CYCLE_ENABLED: "true",
    STUDENTOS_AI_PROVIDER_CYCLE_ROLLOUT_PERCENT: "100",
    STUDENTOS_AI_CONCURRENT_WAIT_MS: "20",
    STUDENTOS_AI_REPLAY_POLL_MS: "2",
    GROQ_API_KEY_1: "groq-test-key-1",
    GEMINI_API_KEY_1: "gemini-test-key-1",
    POLLINATIONS_API_KEY: "pollinations-test-key-1",
    ...overrides,
  };
}

function openAiSuccess(text = "ok") {
  return response({
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 2, completion_tokens: 1 },
  });
}

const expectedOrdinals = new Map([
  [1, "groq"], [8, "groq"], [9, "gemini"], [30, "gemini"], [31, "pollinations"],
  [50, "pollinations"], [51, "groq"], [100, "pollinations"], [101, "groq"],
]);
for (const [ordinal, provider] of expectedOrdinals) assert.equal(providerForOrdinal(ordinal), provider, `ordinal ${ordinal}`);
assert.deepEqual(providerOrderForOrdinal(8), ["groq", "gemini", "pollinations"]);
assert.deepEqual(providerOrderForOrdinal(9), ["gemini", "pollinations", "groq"]);
assert.deepEqual(providerOrderForOrdinal(31), ["pollinations", "groq", "gemini"]);

assert.deepEqual(AI_WEEKLY_ALLOWANCE_DEFAULTS, { trial: 15, starter: 35, essential: 90, plus: 220, pro: 500 });
assert.deepEqual(AI_CREDIT_COSTS, {
  deterministic_help: 0,
  general_ask: 1,
  academic_context_answer: 2,
  tutoring_explanation: 3,
  planning: 5,
  assignment_analysis: 8,
});
assert.equal(getAiWeeklyPeriod(new Date("2026-07-13T00:00:00.000Z")).periodKey, "week_2026-07-13");
assert.equal(getAiWeeklyPeriod(new Date("2026-07-12T23:59:59.999Z")).periodKey, "week_2026-07-06");

const keyConfig = getAiProviderConfig({
  GROQ_API_KEY: " legacy-groq ",
  GEMINI_API_KEY: " legacy-gemini ",
  GEMINI_API_KEY_2: " gemini-two ",
  GEMINI_API_KEY_3: "gemini-two",
});
assert.deepEqual(keyConfig.groq.keys.map(({ name, index }) => ({ name, index })), [{ name: "GROQ_API_KEY", index: 1 }]);
assert.deepEqual(keyConfig.gemini.keys.map(({ name, index }) => ({ name, index })), [
  { name: "GEMINI_API_KEY", index: 1 },
  { name: "GEMINI_API_KEY_2", index: 2 },
]);
assert.equal(keyConfig.gemini.model, "gemini-3.1-flash-lite");
assert.equal(getAiProviderConfig({ GROQ_API_KEY: "legacy", GROQ_API_KEY_1: "numbered" }).groq.keyCount, 1);
const redacted = redactSecrets("GEMINI_API_KEY_3=AIzaabcdefghijklmnopqrstuvwxyz123456 https://example.test?key=AIzaabcdefghijklmnopqrstuvwxyz123456 gsk_abcdefghijklmnopqrstuvwxyz");
assert.doesNotMatch(redacted, /AIza|gsk_|abcdefghijklmnopqrstuvwxyz/);
assert.doesNotMatch(redactSecrets("GEMINI_API_KEY_4: structured-secret-value"), /structured-secret-value/);
assert.equal(redactSecrets({ GEMINI_API_KEY_5: "object-secret-value" }).GEMINI_API_KEY_5, "[redacted]");

const geminiBody = buildGeminiRequestBody({
  messages: [
    { role: "system", content: "Use course context." },
    { role: "user", content: "Explain this." },
    { role: "assistant", content: "Earlier answer." },
  ],
  maxTokens: 500,
  responseMode: "json",
});
assert.equal(geminiBody.system_instruction.parts[0].text, "Use course context.");
assert.deepEqual(geminiBody.contents.map((item) => item.role), ["user", "model"]);
assert.equal(geminiBody.generationConfig.responseMimeType, "application/json");
assert.equal(buildGeminiRequestBody({ messages: [{ role: "system", content: "Rules" }, { role: "user", content: "Question" }], maxTokens: 20, safeRewrite: true }).contents[0].parts[0].text, "Rules\n\nQuestion");

resetProviderRuntimeForTests();
const autoFallbackCalls = [];
const autoFallback = await runProviderFallback({
  messages: [{ role: "user", content: "auto fallback" }],
  config: getAiProviderConfig({
    STUDENTOS_AI_MODE: "auto",
    GROQ_API_KEY_1: "groq-test-key-1",
    GEMINI_API_KEY: "gemini-test-key-1",
    POLLINATIONS_API_KEY: "pollinations-test-key-1",
  }),
  fetchImpl: async (url) => {
    const provider = url.includes("groq") ? "groq" : url.includes("googleapis") ? "gemini" : "pollinations";
    autoFallbackCalls.push(provider);
    if (provider === "groq") return response({ error: { message: "temporary" } }, 503);
    return response({ candidates: [{ content: { parts: [{ text: "Gemini auto fallback" }] }, finishReason: "STOP" }] });
  },
});
assert.equal(autoFallback.providerCode, "gemini");
assert.deepEqual(autoFallbackCalls, ["groq", "gemini"]);

resetProviderRuntimeForTests();
const geminiBodies = [];
const geminiProvider = new GeminiTextProvider({
  config: getAiProviderConfig(providerEnv()),
  fetchImpl: async (url, options) => {
    assert.match(url, /generateContent\?key=/);
    geminiBodies.push(JSON.parse(options.body));
    return response({ candidates: [{ content: { parts: [{ text: "Gemini answer" }] }, finishReason: "STOP" }] });
  },
});
const geminiResult = await geminiProvider.generate({ messages: [{ role: "system", content: "Rules" }, { role: "user", content: "Question" }], responseMode: "json" });
assert.equal(geminiResult.text, "Gemini answer");
assert.equal(geminiResult.providerCode, "gemini");
assert.equal(geminiBodies[0].generationConfig.responseMimeType, "application/json");

resetProviderRuntimeForTests();
const disableCalls = [];
const rotatingGemini = new GeminiTextProvider({
  config: getAiProviderConfig(providerEnv({ GEMINI_API_KEY_2: "gemini-test-key-2" })),
  fetchImpl: async (url) => {
    disableCalls.push(url);
    if (url.includes("gemini-test-key-1")) return response({ error: { message: "invalid credential" } }, 401);
    return response({ candidates: [{ content: { parts: [{ text: "second slot" }] }, finishReason: "STOP" }] });
  },
});
assert.equal((await rotatingGemini.generate({ messages: [{ role: "user", content: "hello" }] })).keyIndexUsed, 2);
assert.equal((await rotatingGemini.generate({ messages: [{ role: "user", content: "hello again" }] })).keyIndexUsed, 2);
assert.equal(disableCalls.filter((url) => url.includes("gemini-test-key-1")).length, 1);

for (const [order, expectedProvider] of [
  [["groq", "gemini", "pollinations"], "gemini"],
  [["gemini", "pollinations", "groq"], "pollinations"],
  [["pollinations", "groq", "gemini"], "groq"],
]) {
  resetProviderRuntimeForTests();
  const primary = order[0];
  const result = await runProviderFallback({
    messages: [{ role: "user", content: "route" }],
    providerOrder: order,
    config: getAiProviderConfig(providerEnv()),
    fetchImpl: async (url) => {
      const code = url.includes("groq") ? "groq" : url.includes("googleapis") ? "gemini" : "pollinations";
      if (code === primary) return response({ error: { message: "temporary" } }, 503);
      if (code === "gemini") return response({ candidates: [{ content: { parts: [{ text: "gemini fallback" }] }, finishReason: "STOP" }] });
      return openAiSuccess(`${code} fallback`);
    },
  });
  assert.equal(result.providerCode, expectedProvider);
  assert.equal(result.attempts.length, 2);
}

resetProviderRuntimeForTests();
let policyCalls = 0;
const policyResult = await runProviderFallback({
  messages: [{ role: "user", content: "blocked" }],
  providerOrder: ["groq", "gemini", "pollinations"],
  config: getAiProviderConfig(providerEnv()),
  fetchImpl: async () => {
    policyCalls += 1;
    return response({ error: { message: "content policy violation" } }, 400);
  },
});
assert.equal(policyResult.policyBlocked, true);
assert.equal(policyCalls, 1, "Safety rejection must not trigger a payload rewrite or cross-provider fallback");

for (const [providerOrder, blockedBody] of [
  [["groq", "gemini", "pollinations"], { choices: [{ message: { content: "" }, finish_reason: "content_filter" }] }],
  [["gemini", "pollinations", "groq"], { candidates: [{ content: { parts: [] }, finishReason: "RECITATION" }] }],
]) {
  resetProviderRuntimeForTests();
  let finishBlockCalls = 0;
  const finishBlock = await runProviderFallback({
    messages: [{ role: "user", content: "blocked finish" }],
    providerOrder,
    config: getAiProviderConfig(providerEnv()),
    fetchImpl: async () => {
      finishBlockCalls += 1;
      return response(blockedBody);
    },
  });
  assert.equal(finishBlock.policyBlocked, true);
  assert.equal(finishBlockCalls, 1, "Policy finish reasons must stop the cyclic traversal");
}

resetProviderRuntimeForTests();
const streamChunks = [];
for await (const chunk of streamProviderFallback({
  messages: [{ role: "user", content: "stream" }],
  providerOrder: ["groq", "gemini", "pollinations"],
  config: getAiProviderConfig(providerEnv()),
  fetchImpl: async (url) => url.includes("groq")
    ? response({ error: { message: "temporary" } }, 503)
    : response({ candidates: [{ content: { parts: [{ text: "buffered fallback" }] }, finishReason: "STOP" }] }),
})) streamChunks.push(chunk);
assert.equal(streamChunks.length, 1);
assert.equal(streamChunks[0].delta, "buffered fallback");
assert.equal(streamChunks[0].providerCode, "gemini");

const pollinationsSse = await runProviderFallback({
  messages: [{ role: "user", content: "sse" }],
  providerOrder: ["pollinations"],
  config: getAiProviderConfig(providerEnv()),
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "text/event-stream" : null },
    text: async () => 'data: {"choices":[{"delta":{"content":"SSE "}}]}\n\ndata: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n',
  }),
});
assert.equal(pollinationsSse.text, "SSE answer");
assert.equal(pollinationsSse.finishReason, "stop");

resetProviderRuntimeForTests();
const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const session = { authenticated: false, user: { id: "routing-user" } };
const config = getAiProviderConfig(providerEnv());
const periodKey = "week_2026-07-13";
let providerCalls = 0;
const execute = (requestId, requestFingerprint, options = {}) => executeAuthorizedAiOperation({
  repository,
  session,
  config,
  workflow: options.workflow || "assistant",
  responseMode: "text",
  requestFingerprint,
  fetchImpl: options.fetchImpl || (async () => {
    providerCalls += 1;
    return openAiSuccess("coordinated result");
  }),
  allowanceRequest: {
    planTier: "plus",
    periodKey,
    allowance: 220,
    actionType: "tutoring_explanation",
    creditCost: 3,
    requestId,
    metadata: { workflow: options.workflow || "assistant" },
  },
  run: options.run || (async ({ providerExecutor }) => {
    const provider = await providerExecutor({ messages: [{ role: "user", content: "coordinate" }] });
    return { generationSucceeded: !provider.providerFailure, answer: provider.text };
  }),
  isLogicalSuccess: options.isLogicalSuccess || ((result) => result?.generationSucceeded === true && Boolean(result?.answer)),
});

const fingerprint = fingerprintAiOperation({ workflow: "assistant", message: "same" });
const first = await execute("idem:first", fingerprint);
assert.equal(first.success, true);
assert.equal(first.ordinal, 1);
assert.equal(first.settlement.successfulCount, 1);
assert.equal(first.settlement.used, 3);
const providerCallsAfterFirst = providerCalls;
const replay = await execute("idem:first", fingerprint);
assert.equal(replay.replay, true);
assert.equal(replay.result.answer, "coordinated result");
assert.ok(providerCallsAfterFirst > 0);
assert.equal(providerCalls, providerCallsAfterFirst, "completed replay must not call a provider again");
assert.equal(await repository.getAiWeeklySuccessfulRequestCount(session, { periodKey }), 1);
await assert.rejects(() => execute("idem:first", fingerprintAiOperation({ workflow: "assistant", message: "changed" })), /changed while it was being retried/);

const fallback = await execute("idem:fallback", fingerprintAiOperation({ workflow: "assistant", message: "fallback" }), {
  fetchImpl: async (url) => url.includes("groq")
    ? response({ error: { message: "temporary" } }, 503)
    : response({ candidates: [{ content: { parts: [{ text: "fallback success" }] }, finishReason: "STOP" }] }),
});
assert.equal(fallback.success, true);
assert.equal(fallback.ordinal, 2);
assert.equal(fallback.settlement.successfulCount, 2);
assert.equal(repository.mock.aiUsageLedger.find((entry) => entry.requestId === "idem:fallback").routingAttempts.length, 2);

let failureCalls = 0;
const failureFingerprint = fingerprintAiOperation({ workflow: "assistant", message: "failure" });
const totalFailure = await execute("idem:failure", failureFingerprint, {
  fetchImpl: async () => {
    failureCalls += 1;
    return response({ error: { message: "temporary" } }, 503);
  },
});
assert.equal(totalFailure.success, false);
assert.equal(totalFailure.settlement.status, "refunded");
assert.equal(await repository.getAiWeeklySuccessfulRequestCount(session, { periodKey }), 2);
const failureCallsAfterCompletion = failureCalls;
const failureReplay = await execute("idem:failure", failureFingerprint);
assert.equal(failureReplay.replay, true);
assert.equal(failureReplay.success, false);
assert.equal(failureCalls, failureCallsAfterCompletion, "completed failure replay must not call a provider again");

const duplicateCompletion = await repository.completeRoutedAiOperation(session, {
  requestId: "idem:fallback",
  succeeded: true,
  primaryProvider: "groq",
  finalProvider: "gemini",
  attempts: [],
  outcome: { answer: "duplicate" },
});
assert.equal(duplicateCompletion.changed, false);
assert.equal(duplicateCompletion.successfulCount, 2);

let releaseFirst;
const gate = new Promise((resolve) => { releaseFirst = resolve; });
const held = execute("idem:held", fingerprintAiOperation({ workflow: "assistant", message: "held" }), {
  run: async () => {
    await gate;
    return { generationSucceeded: true, answer: "released" };
  },
});
await new Promise((resolve) => setTimeout(resolve, 2));
setTimeout(releaseFirst, 2);
const busy = await execute("idem:other", fingerprintAiOperation({ workflow: "assistant", message: "other" }));
assert.equal(busy.busy, true);
assert.equal(repository.mock.aiUsageLedger.some((entry) => entry.requestId === "idem:other"), false, "busy operation must not reserve");
await held;

let releaseDuplicate;
const duplicateGate = new Promise((resolve) => { releaseDuplicate = resolve; });
const concurrentFingerprint = fingerprintAiOperation({ workflow: "assistant", message: "concurrent duplicate" });
const originalDuplicate = execute("idem:concurrent-duplicate", concurrentFingerprint, {
  run: async () => {
    await duplicateGate;
    return { generationSucceeded: true, answer: "one durable result" };
  },
});
await new Promise((resolve) => setTimeout(resolve, 2));
setTimeout(releaseDuplicate, 2);
const concurrentReplay = await execute("idem:concurrent-duplicate", concurrentFingerprint);
assert.equal(concurrentReplay.replay, true);
assert.equal(concurrentReplay.result.answer, "one durable result");
await originalDuplicate;

const stale = await repository.beginRoutedAiOperation(session, {
  planTier: "plus",
  periodKey,
  allowance: 220,
  actionType: "general_ask",
  creditCost: 1,
  requestId: "idem:stale",
  requestFingerprint: "stale-fingerprint",
  leaseMs: 1000,
});
assert.equal(stale.allowed, true);
repository.mock.aiUsageLedger.find((entry) => entry.requestId === "idem:stale").routingLeaseExpiresAt = new Date(Date.now() - 1).toISOString();
const afterStale = await repository.beginRoutedAiOperation(session, {
  planTier: "plus",
  periodKey,
  allowance: 220,
  actionType: "general_ask",
  creditCost: 1,
  requestId: "idem:after-stale",
  requestFingerprint: "after-stale-fingerprint",
  leaseMs: 1000,
});
assert.equal(afterStale.allowed, true);
assert.equal(repository.mock.aiUsageLedger.find((entry) => entry.requestId === "idem:stale").status, "refunded");
await repository.completeRoutedAiOperation(session, { requestId: "idem:after-stale", succeeded: false, attempts: [] });

assert.equal(getAiOperationId({ idempotencyKey: "client-action-1", requestId: "request" }), "idem:client-action-1");
assert.equal(getAiOperationId({ requestId: "request-fallback" }), "request-fallback");
assert.throws(() => getAiOperationId({ idempotencyKey: "contains spaces", requestId: "request" }), /new request/);

const azureCycleReady = validateAzureAiProviderSecrets({
  ...providerEnv({
    GEMINI_API_KEY_2: "gemini-test-key-2",
    GEMINI_API_KEY_3: "gemini-test-key-3",
    GEMINI_API_KEY_4: "gemini-test-key-4",
    GEMINI_API_KEY_5: "gemini-test-key-5",
  }),
});
assert.equal(azureCycleReady.ok, true);
assert.equal(azureCycleReady.geminiDistinctKeyCount, 5);
assert.equal(JSON.stringify(azureCycleReady).includes("test-key"), false);
const azureAutoRedundant = validateAzureAiProviderSecrets({
  STUDENTOS_AI_MODE: "auto",
  GROQ_API_KEY_1: "groq-test-key-1",
  GEMINI_API_KEY: "gemini-test-key-1",
});
assert.equal(azureAutoRedundant.ok, true);
assert.equal(azureAutoRedundant.fallbackReady, true);
assert.deepEqual(azureAutoRedundant.configuredProviders, ["groq", "gemini"]);
const azureAutoSingleProvider = validateAzureAiProviderSecrets({ STUDENTOS_AI_MODE: "auto", GROQ_API_KEY_1: "groq-test-key-1" });
assert.equal(azureAutoSingleProvider.ok, false);
assert.equal(azureAutoSingleProvider.errorCode, "provider_redundancy_required");

const migration = await readFile(new URL("../supabase/migrations/202607130001_studentos_multi_provider_routing.sql", import.meta.url), "utf8");
for (const marker of [
  "begin_routed_ai_operation",
  "complete_routed_ai_operation",
  "pg_advisory_xact_lock",
  "ai_usage_ledger_one_running_operation_idx",
  "where routing_status = 'running'",
  "status = 'charged'",
  "grant execute",
  "service_role",
]) assert.ok(migration.toLowerCase().includes(marker.toLowerCase()), `migration marker ${marker}`);
assert.equal(/grant execute[^;]+to authenticated/is.test(migration), false);

const serverSource = await readFile(new URL("./server.js", import.meta.url), "utf8");
const frontendSource = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
assert.ok((serverSource.match(/providerConfig: routed \? \{ \.\.\.aiProviderConfig, requestedMode: "auto" \}/g) || []).length >= 5);
assert.match(serverSource, /Idempotency-Key/);
assert.ok((frontendSource.match(/providerBackedApi\(/g) || []).length >= 6, "helper plus five provider-backed user actions expected");
assert.doesNotMatch(frontendSource, /GEMINI_API_KEY|GROQ_API_KEY|POLLINATIONS_API_KEY/);

console.log("PASS | StudentOS multi-provider routing, exact settlement, idempotency, and deployment guard tests passed");
