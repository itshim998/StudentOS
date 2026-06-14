const GROQ_KEY_NAMES = [
  "GROQ_API_KEY",
  "GROQ_API_KEY_2",
  "GROQ_API_KEY_3",
  "GROQ_API_KEY_4",
  "GROQ_API_KEY_5",
];

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

export function getAiProviderConfig(env = process.env) {
  const groqKeys = GROQ_KEY_NAMES
    .map((name, index) => ({
      name,
      index: index + 1,
      value: readValue(env, name),
    }))
    .filter((item) => item.value);
  const pollinationsBaseUrl = readValue(env, "POLLINATIONS_BASE_URL", "https://gen.pollinations.ai");
  return {
    requestedMode: readValue(env, "STUDENTOS_AI_MODE", "auto").toLowerCase(),
    groq: {
      configured: groqKeys.length > 0,
      keys: groqKeys,
      keyCount: groqKeys.length,
      model: readValue(env, "GROQ_CHAT_MODEL", "openai/gpt-oss-120b"),
      endpoint: readValue(env, "GROQ_OPENAI_ENDPOINT", "https://api.groq.com/openai/v1/chat/completions"),
      timeoutMs: Number(readValue(env, "GROQ_TIMEOUT_MS", "45000")) || 45000,
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
