const GROQ_NUMBERED_KEY_NAMES = [
  "GROQ_API_KEY_1",
  "GROQ_API_KEY_2",
  "GROQ_API_KEY_3",
  "GROQ_API_KEY_4",
  "GROQ_API_KEY_5",
];

const GEMINI_NUMBERED_KEY_NAMES = [
  "GEMINI_API_KEY_1",
  "GEMINI_API_KEY_2",
  "GEMINI_API_KEY_3",
  "GEMINI_API_KEY_4",
  "GEMINI_API_KEY_5",
];

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

function readPositiveInteger(env, key, fallback) {
  const value = Number.parseInt(readValue(env, key, String(fallback)), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readPercentage(env, key, fallback = 0) {
  const value = Number(readValue(env, key, String(fallback)));
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
}

function readBoolean(env, key, fallback = false) {
  const raw = readValue(env, key);
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function readProviderKeys(env, numberedNames, legacyName) {
  const seen = new Set();
  const records = [];
  for (let slot = 1; slot <= numberedNames.length; slot += 1) {
    const numberedName = numberedNames[slot - 1];
    const legacyFallback = slot === 1 ? readValue(env, legacyName) : "";
    const numberedValue = readValue(env, numberedName);
    const value = numberedValue || legacyFallback;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    records.push({
      name: numberedValue ? numberedName : legacyName,
      index: slot,
      value,
    });
  }
  return records;
}

export function getAiProviderConfig(env = process.env) {
  const groqKeys = readProviderKeys(env, GROQ_NUMBERED_KEY_NAMES, "GROQ_API_KEY");
  const geminiKeys = readProviderKeys(env, GEMINI_NUMBERED_KEY_NAMES, "GEMINI_API_KEY");
  const pollinationsBaseUrl = readValue(env, "POLLINATIONS_BASE_URL", "https://gen.pollinations.ai");
  return {
    requestedMode: readValue(env, "STUDENTOS_AI_MODE", "auto").toLowerCase(),
    generation: {
      reasoningEffort: readValue(env, "STUDENTOS_AI_REASONING_EFFORT", "medium") || "medium",
      maxCompletionTokens: readPositiveInteger(env, "STUDENTOS_AI_MAX_COMPLETION_TOKENS", 3000),
    },
    routing: {
      enabled: readBoolean(env, "STUDENTOS_AI_PROVIDER_CYCLE_ENABLED", false),
      shadow: readBoolean(env, "STUDENTOS_AI_PROVIDER_CYCLE_SHADOW", false),
      rolloutPercent: readPercentage(env, "STUDENTOS_AI_PROVIDER_CYCLE_ROLLOUT_PERCENT", 0),
      operationTimeoutMs: readPositiveInteger(env, "STUDENTOS_AI_LOGICAL_OPERATION_TIMEOUT_MS", 120_000),
      leaseMs: readPositiveInteger(env, "STUDENTOS_AI_OPERATION_LEASE_MS", 180_000),
      concurrentWaitMs: readPositiveInteger(env, "STUDENTOS_AI_CONCURRENT_WAIT_MS", 5_000),
      replayPollMs: readPositiveInteger(env, "STUDENTOS_AI_REPLAY_POLL_MS", 125),
      providers: {
        groq: readBoolean(env, "STUDENTOS_AI_GROQ_ENABLED", true),
        gemini: readBoolean(env, "STUDENTOS_AI_GEMINI_ENABLED", true),
        pollinations: readBoolean(env, "STUDENTOS_AI_POLLINATIONS_ENABLED", true),
      },
    },
    groq: {
      configured: groqKeys.length > 0,
      enabled: readBoolean(env, "STUDENTOS_AI_GROQ_ENABLED", true),
      keys: groqKeys,
      keyCount: groqKeys.length,
      model: readValue(env, "GROQ_CHAT_MODEL", "openai/gpt-oss-120b"),
      endpoint: readValue(env, "GROQ_OPENAI_ENDPOINT", "https://api.groq.com/openai/v1/chat/completions"),
      timeoutMs: readPositiveInteger(env, "GROQ_TIMEOUT_MS", 45_000),
      keyCooldownMs: readPositiveInteger(env, "GROQ_KEY_COOLDOWN_MS", 60_000),
      rateLimitCooldownMs: readPositiveInteger(env, "GROQ_429_COOLDOWN_MS", 180_000),
      invalidKeyDisable: readBoolean(env, "GROQ_INVALID_KEY_DISABLE", true),
      reasoningEffort: readValue(env, "STUDENTOS_AI_REASONING_EFFORT", "medium") || "medium",
      maxCompletionTokens: readPositiveInteger(env, "STUDENTOS_AI_MAX_COMPLETION_TOKENS", 3000),
    },
    gemini: {
      configured: geminiKeys.length > 0,
      enabled: readBoolean(env, "STUDENTOS_AI_GEMINI_ENABLED", true),
      keys: geminiKeys,
      keyCount: geminiKeys.length,
      model: readValue(env, "GEMINI_CHAT_MODEL", "gemini-3.1-flash-lite"),
      apiBase: readValue(env, "GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta"),
      timeoutMs: readPositiveInteger(env, "GEMINI_TIMEOUT_MS", 45_000),
      keyCooldownMs: readPositiveInteger(env, "GEMINI_KEY_COOLDOWN_MS", 60_000),
      rateLimitCooldownMs: readPositiveInteger(env, "GEMINI_429_COOLDOWN_MS", 180_000),
      invalidKeyDisable: readBoolean(env, "GEMINI_INVALID_KEY_DISABLE", true),
      maxCompletionTokens: readPositiveInteger(env, "STUDENTOS_AI_MAX_COMPLETION_TOKENS", 3000),
    },
    pollinations: {
      configured: Boolean(readValue(env, "POLLINATIONS_API_KEY")) || readBoolean(env, "POLLINATIONS_ALLOW_FREE", false),
      enabled: readBoolean(env, "STUDENTOS_AI_POLLINATIONS_ENABLED", true),
      apiKey: readValue(env, "POLLINATIONS_API_KEY"),
      textModel: readValue(env, "POLLINATIONS_TEXT_MODEL", "mistral-4"),
      imageModel: readValue(env, "POLLINATIONS_IMAGE_MODEL", "zimage"),
      endpoint: readValue(env, "POLLINATIONS_OPENAI_ENDPOINT", `${pollinationsBaseUrl.replace(/\/+$/, "")}/v1/chat/completions`),
      fallbackEndpoint: readValue(env, "POLLINATIONS_FALLBACK_OPENAI_ENDPOINT", "https://text.pollinations.ai/openai"),
      baseUrl: pollinationsBaseUrl,
      timeoutMs: readPositiveInteger(env, "POLLINATIONS_TIMEOUT_MS", 60_000),
      maxCompletionTokens: readPositiveInteger(env, "STUDENTOS_AI_MAX_COMPLETION_TOKENS", 3000),
    },
  };
}

export function getSafeAiProviderStatus(config = getAiProviderConfig()) {
  return {
    requestedMode: config.requestedMode,
    routing: {
      enabled: config.routing.enabled,
      shadow: config.routing.shadow,
      rolloutPercent: config.routing.rolloutPercent,
    },
    groq: {
      configured: config.groq.configured,
      enabled: config.groq.enabled,
      keyCount: config.groq.keyCount,
      model: config.groq.model,
    },
    gemini: {
      configured: config.gemini.configured,
      enabled: config.gemini.enabled,
      keyCount: config.gemini.keyCount,
      model: config.gemini.model,
    },
    pollinations: {
      configured: config.pollinations.configured,
      enabled: config.pollinations.enabled,
      textModel: config.pollinations.textModel,
      imageModel: config.pollinations.imageModel,
      imageProviderScaffolded: true,
    },
    fallbackOrder: ["groq", "gemini", "pollinations", "mock"],
    secretsExposed: false,
  };
}
