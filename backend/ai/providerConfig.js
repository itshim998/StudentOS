const GROQ_NUMBERED_KEY_NAMES = [
  "GROQ_API_KEY_1",
  "GROQ_API_KEY_2",
  "GROQ_API_KEY_3",
  "GROQ_API_KEY_4",
  "GROQ_API_KEY_5",
];
const GROQ_KEY_NAMES = [...GROQ_NUMBERED_KEY_NAMES, "GROQ_API_KEY"];

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

function readPositiveInteger(env, key, fallback) {
  const value = Number.parseInt(readValue(env, key, String(fallback)), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getAiProviderConfig(env = process.env) {
  const seenGroqKeys = new Set();
  const groqKeys = [];
  for (const name of GROQ_KEY_NAMES) {
    const value = readValue(env, name);
    if (!value || seenGroqKeys.has(value)) continue;
    seenGroqKeys.add(value);
    groqKeys.push({ name, index: groqKeys.length + 1, value });
  }
  const pollinationsBaseUrl = readValue(env, "POLLINATIONS_BASE_URL", "https://gen.pollinations.ai");
  return {
    requestedMode: readValue(env, "STUDENTOS_AI_MODE", "auto").toLowerCase(),
    generation: {
      reasoningEffort: readValue(env, "STUDENTOS_AI_REASONING_EFFORT", "medium") || "medium",
      maxCompletionTokens: readPositiveInteger(env, "STUDENTOS_AI_MAX_COMPLETION_TOKENS", 3000),
    },
    groq: {
      configured: groqKeys.length > 0,
      keys: groqKeys,
      keyCount: groqKeys.length,
      model: readValue(env, "GROQ_CHAT_MODEL", "openai/gpt-oss-120b"),
      endpoint: readValue(env, "GROQ_OPENAI_ENDPOINT", "https://api.groq.com/openai/v1/chat/completions"),
      timeoutMs: Number(readValue(env, "GROQ_TIMEOUT_MS", "45000")) || 45000,
      reasoningEffort: readValue(env, "STUDENTOS_AI_REASONING_EFFORT", "medium") || "medium",
      maxCompletionTokens: readPositiveInteger(env, "STUDENTOS_AI_MAX_COMPLETION_TOKENS", 3000),
    },
    pollinations: {
      configured: Boolean(readValue(env, "POLLINATIONS_API_KEY")) || readValue(env, "POLLINATIONS_ALLOW_FREE", "false") === "true",
      apiKey: readValue(env, "POLLINATIONS_API_KEY"),
      textModel: readValue(env, "POLLINATIONS_TEXT_MODEL", "mistral-4"),
      imageModel: readValue(env, "POLLINATIONS_IMAGE_MODEL", "zimage"),
      endpoint: readValue(env, "POLLINATIONS_OPENAI_ENDPOINT", `${pollinationsBaseUrl.replace(/\/+$/, "")}/v1/chat/completions`),
      fallbackEndpoint: readValue(env, "POLLINATIONS_FALLBACK_OPENAI_ENDPOINT", "https://text.pollinations.ai/openai"),
      baseUrl: pollinationsBaseUrl,
      timeoutMs: Number(readValue(env, "POLLINATIONS_TIMEOUT_MS", "60000")) || 60000,
      maxCompletionTokens: readPositiveInteger(env, "STUDENTOS_AI_MAX_COMPLETION_TOKENS", 3000),
    },
  };
}

export function getSafeAiProviderStatus(config = getAiProviderConfig()) {
  return {
    requestedMode: config.requestedMode,
    groq: {
      configured: config.groq.configured,
      keyCount: config.groq.keyCount,
      model: config.groq.model,
    },
    pollinations: {
      configured: config.pollinations.configured,
      textModel: config.pollinations.textModel,
      imageModel: config.pollinations.imageModel,
      imageProviderScaffolded: true,
    },
    fallbackOrder: ["groq", "pollinations", "mock"],
    secretsExposed: false,
  };
}
