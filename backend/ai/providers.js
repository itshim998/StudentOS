import { getAiProviderConfig } from "./providerConfig.js";

const PROVIDER_CODES = Object.freeze({
  groq: "groq",
  gemini: "gemini",
  pollinations: "pollinations",
});

const runtime = {
  groq: { cursor: 0, unhealthyUntil: new Map(), disabled: new Set() },
  gemini: { cursor: 0, unhealthyUntil: new Map(), disabled: new Set() },
};

function runtimeKeyId(key, model = "") {
  return `${key.name}:${key.value}:${model}`;
}

function timeoutSignal(timeoutMs, operationDeadline = null) {
  const remaining = operationDeadline ? Math.max(1, operationDeadline - Date.now()) : timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(timeoutMs, remaining)));
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function sanitizeError(error) {
  return String(error?.message || error || "provider_error")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/api[_-]?key(?:_\d+)?\s*[:=]\s*[^\s,;]+/gi, "api_key=[redacted]")
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/gsk_[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .slice(0, 240);
}

function readRetryAfterMs(response) {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function looksLikePolicyBlock(value) {
  return /(?:safety|content[_ -]?policy|policy[_ -]?violation|blocked[_ -]?reason|prohibited|moderation)/i.test(String(value || ""));
}

function assertFinishReasonAllowed(finishReason, providerName) {
  if (!/(?:content[_ -]?filter|safety|blocked|blocklist|prohibited[_ -]?content|recitation|spii|image[_ -]?safety)/i.test(String(finishReason || ""))) return;
  const error = new Error(`${providerName}_content_policy_blocked`);
  error.policyBlocked = true;
  throw error;
}

async function parseJsonResponse(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || `provider_http_${response.status}`;
    const error = new Error(`provider_http_${response.status}:${sanitizeError(detail)}`);
    error.status = response.status;
    error.providerCode = body?.error?.code || body?.error?.status || body?.error?.type || null;
    error.retryAfterMs = readRetryAfterMs(response);
    error.policyBlocked = looksLikePolicyBlock(`${detail} ${error.providerCode || ""}`);
    throw error;
  }
  return body;
}

function normalizeOpenAiResponse(body) {
  const choice = body?.choices?.[0] || {};
  const messageContent = choice?.message?.content;
  let text = "";
  if (typeof messageContent === "string") text = messageContent.trim();
  else if (Array.isArray(messageContent)) {
    text = messageContent
      .map((part) => typeof part === "string" ? part : part?.text || "")
      .join("")
      .trim();
  } else if (typeof body?.output_text === "string") text = body.output_text.trim();
  const finishReason = choice?.finish_reason || null;
  assertFinishReasonAllowed(finishReason, "openai_compatible");
  return {
    text,
    finishReason,
    truncated: ["length", "max_tokens"].includes(String(finishReason || "").toLowerCase()),
    usage: body?.usage && typeof body.usage === "object" ? body.usage : null,
  };
}

async function parseOpenAiProviderResponse(response) {
  const contentType = String(response?.headers?.get?.("content-type") || "").toLowerCase();
  if (!response.ok || !contentType.includes("text/event-stream")) {
    return normalizeOpenAiResponse(await parseJsonResponse(response));
  }
  const raw = await response.text();
  let text = "";
  let finishReason = null;
  let usage = null;
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data);
      const choice = event?.choices?.[0] || {};
      text += choice?.delta?.content || choice?.message?.content || "";
      finishReason = choice?.finish_reason || finishReason;
      usage = event?.usage || usage;
    } catch {
      // Ignore malformed keepalive/event lines and continue parsing valid data frames.
    }
  }
  assertFinishReasonAllowed(finishReason, "openai_compatible");
  return {
    text: text.trim(),
    finishReason,
    truncated: ["length", "max_tokens"].includes(String(finishReason || "").toLowerCase()),
    usage,
  };
}

function normalizeGeminiResponse(body) {
  const candidate = body?.candidates?.[0] || null;
  const blockedReason = body?.promptFeedback?.blockReason || null;
  if (blockedReason) {
    const error = new Error("gemini_content_policy_blocked");
    error.policyBlocked = true;
    throw error;
  }
  assertFinishReasonAllowed(candidate?.finishReason, "gemini");
  const text = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts.map((part) => typeof part?.text === "string" ? part.text : "").join("").trim()
    : "";
  const finishReason = candidate?.finishReason || null;
  return {
    text,
    finishReason,
    truncated: String(finishReason || "").toUpperCase() === "MAX_TOKENS",
    usage: body?.usageMetadata && typeof body.usageMetadata === "object" ? body.usageMetadata : null,
  };
}

function orderedKeys(providerCode, keys, model = "") {
  const state = runtime[providerCode];
  if (!state || !keys.length) return [];
  const now = Date.now();
  const candidates = keys.filter((key) => !state.disabled.has(runtimeKeyId(key, model)) && (state.unhealthyUntil.get(runtimeKeyId(key, model)) || 0) <= now);
  if (!candidates.length) return [];
  const start = state.cursor % candidates.length;
  state.cursor = (state.cursor + 1) % candidates.length;
  return [...candidates.slice(start), ...candidates.slice(0, start)];
}

function markKeyFailure(providerCode, key, error, config) {
  const state = runtime[providerCode];
  if (!state) return;
  const keyId = runtimeKeyId(key, config.model);
  const status = Number(error?.status || 0);
  if ([401, 403].includes(status) && config.invalidKeyDisable && !error?.policyBlocked) {
    state.disabled.add(keyId);
    return;
  }
  const retryAfter = Number(error?.retryAfterMs || 0);
  const cooldownMs = status === 429
    ? Math.max(config.rateLimitCooldownMs, retryAfter)
    : config.keyCooldownMs;
  state.unhealthyUntil.set(keyId, Date.now() + cooldownMs);
}

function providerFailure(providerName, lastError, prefix) {
  const failure = new Error(`${prefix}:${sanitizeError(lastError)}`);
  failure.status = lastError?.status || null;
  failure.providerCode = lastError?.providerCode || null;
  failure.policyBlocked = Boolean(lastError?.policyBlocked);
  failure.retryAfterMs = lastError?.retryAfterMs || null;
  failure.provider = providerName;
  return failure;
}

function isRequestCompatibilityError(error) {
  return [400, 404, 422].includes(Number(error?.status || 0)) && !error?.policyBlocked;
}

function safeFailureCode(providerName, error) {
  const status = Number(error?.status || 0);
  if (error?.policyBlocked) return `${providerName}:policy_blocked`;
  if (status) return `${providerName}:http_${status}`;
  if (error?.name === "AbortError" || /abort|timeout/i.test(String(error?.message || ""))) return `${providerName}:timeout`;
  if (/cooling|not_configured|disabled/i.test(String(error?.message || ""))) return `${providerName}:unavailable`;
  return `${providerName}:request_failed`;
}

function providerStatusClass(error) {
  if (error?.policyBlocked) return "policy_blocked";
  const status = Number(error?.status || 0);
  if ([401, 403].includes(status)) return "credential_rejected";
  if (status === 429) return "rate_limited";
  if ([400, 404, 422].includes(status)) return "request_incompatible";
  if (status === 408 || status >= 500 || error?.name === "AbortError") return "transient_failure";
  return "request_failed";
}

export function groqSupportsReasoningEffort(model) {
  return /^openai\/gpt-oss-(?:20b|120b)$/i.test(String(model || "").trim());
}

export function buildGroqRequestBody({ model, messages, maxTokens, reasoningEffort, responseMode = "text", includeReasoningEffort = groqSupportsReasoningEffort(model), strictJson = true }) {
  return {
    model,
    messages: Array.isArray(messages) ? messages : [],
    temperature: 0.45,
    top_p: 0.9,
    max_completion_tokens: maxTokens,
    ...(strictJson && responseMode === "json" ? { response_format: { type: "json_object" } } : {}),
    ...(includeReasoningEffort && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    stream: false,
  };
}

export function buildGeminiRequestBody({ messages, maxTokens, responseMode = "text", safeRewrite = false }) {
  const normalized = Array.isArray(messages) ? messages : [];
  const systemText = normalized
    .filter((message) => message?.role === "system")
    .map((message) => String(message?.content || "").trim())
    .filter(Boolean)
    .join("\n\n");
  const contents = normalized
    .filter((message) => message?.role !== "system")
    .map((message) => ({
      role: message?.role === "assistant" ? "model" : "user",
      parts: [{ text: String(message?.content || "") }],
    }))
    .filter((message) => message.parts[0].text.trim());
  if (safeRewrite && systemText) {
    if (!contents.length) contents.push({ role: "user", parts: [{ text: systemText }] });
    else contents[0].parts[0].text = `${systemText}\n\n${contents[0].parts[0].text}`;
  }
  return {
    ...(!safeRewrite && systemText ? { system_instruction: { parts: [{ text: systemText }] } } : {}),
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.45,
      topP: 0.9,
      ...(!safeRewrite && responseMode === "json" ? { responseMimeType: "application/json" } : {}),
    },
  };
}

export class GroqGroundedProvider {
  constructor({ config = getAiProviderConfig(), fetchImpl = globalThis.fetch } = {}) {
    this.code = PROVIDER_CODES.groq;
    this.name = "groq_grounded";
    this.config = config.groq;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.config.enabled !== false && this.config.configured && this.fetch);
  }

  async generate({ messages, maxTokens = this.config.maxCompletionTokens, reasoningEffort = this.config.reasoningEffort, responseMode = "text", operationDeadline = null }) {
    if (!this.isConfigured()) throw new Error("groq_not_configured");
    const keys = orderedKeys(this.code, this.config.keys, this.config.model);
    if (!keys.length) throw new Error("groq_cooling_or_disabled");
    let lastError = null;
    const includeReasoningEffort = groqSupportsReasoningEffort(this.config.model);
    for (const key of keys) {
      const request = async (body) => {
        const timeout = timeoutSignal(this.config.timeoutMs, operationDeadline);
        try {
          const response = await this.fetch(this.config.endpoint, {
            method: "POST",
            signal: timeout.signal,
            headers: { Authorization: `Bearer ${key.value}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const normalized = await parseOpenAiProviderResponse(response);
          if (!normalized.text) throw new Error("groq_empty_response");
          return normalized;
        } finally {
          timeout.clear();
        }
      };
      try {
        const initialBody = buildGroqRequestBody({ model: this.config.model, messages, maxTokens, reasoningEffort, responseMode, includeReasoningEffort });
        let normalized;
        try {
          normalized = await request(initialBody);
        } catch (error) {
          if (!isRequestCompatibilityError(error)) throw error;
          normalized = await request(buildGroqRequestBody({
            model: this.config.model,
            messages,
            maxTokens,
            reasoningEffort,
            responseMode,
            includeReasoningEffort: false,
            strictJson: false,
          }));
        }
        return { provider: this.name, providerCode: this.code, modelUsed: this.config.model, keyIndexUsed: key.index, ...normalized };
      } catch (error) {
        lastError = error;
        if (error?.policyBlocked) throw providerFailure(this.name, error, "groq_failed");
        if (isRequestCompatibilityError(error)) break;
        markKeyFailure(this.code, key, error, this.config);
      }
    }
    throw providerFailure(this.name, lastError, "groq_failed");
  }

  async *stream(request) {
    const result = await this.generate(request);
    yield { ...result, delta: result.text, firstChunk: true, done: true };
  }
}

export class GeminiTextProvider {
  constructor({ config = getAiProviderConfig(), fetchImpl = globalThis.fetch } = {}) {
    this.code = PROVIDER_CODES.gemini;
    this.name = "gemini_text";
    this.config = config.gemini;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.config.enabled !== false && this.config.configured && this.fetch);
  }

  async generate({ messages, maxTokens = this.config.maxCompletionTokens, responseMode = "text", operationDeadline = null }) {
    if (!this.isConfigured()) throw new Error("gemini_not_configured");
    const keys = orderedKeys(this.code, this.config.keys, this.config.model);
    if (!keys.length) throw new Error("gemini_cooling_or_disabled");
    let lastError = null;
    for (const key of keys) {
      const request = async (safeRewrite) => {
        const timeout = timeoutSignal(this.config.timeoutMs, operationDeadline);
        const base = this.config.apiBase.replace(/\/+$/, "");
        const endpoint = `${base}/models/${encodeURIComponent(this.config.model)}:generateContent?key=${encodeURIComponent(key.value)}`;
        try {
          const response = await this.fetch(endpoint, {
            method: "POST",
            signal: timeout.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildGeminiRequestBody({ messages, maxTokens, responseMode, safeRewrite })),
          });
          const normalized = normalizeGeminiResponse(await parseJsonResponse(response));
          if (!normalized.text) throw new Error("gemini_empty_response");
          return normalized;
        } finally {
          timeout.clear();
        }
      };
      try {
        let normalized;
        try {
          normalized = await request(false);
        } catch (error) {
          if (!isRequestCompatibilityError(error)) throw error;
          normalized = await request(true);
        }
        return { provider: this.name, providerCode: this.code, modelUsed: this.config.model, keyIndexUsed: key.index, ...normalized };
      } catch (error) {
        lastError = error;
        if (error?.policyBlocked) throw providerFailure(this.name, error, "gemini_failed");
        if (isRequestCompatibilityError(error)) break;
        markKeyFailure(this.code, key, error, this.config);
      }
    }
    throw providerFailure(this.name, lastError, "gemini_failed");
  }

  async *stream(request) {
    const result = await this.generate(request);
    yield { ...result, delta: result.text, firstChunk: true, done: true };
  }
}

export class PollinationsTextProvider {
  constructor({ config = getAiProviderConfig(), fetchImpl = globalThis.fetch } = {}) {
    this.code = PROVIDER_CODES.pollinations;
    this.name = "pollinations_text_fallback";
    this.config = config.pollinations;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.config.enabled !== false && this.config.configured && this.fetch);
  }

  async generate({ messages, maxTokens = this.config.maxCompletionTokens, responseMode = "text", operationDeadline = null }) {
    if (!this.isConfigured()) throw new Error("pollinations_not_configured");
    const headers = { "Content-Type": "application/json" };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    const endpoints = [...new Set([this.config.endpoint, this.config.fallbackEndpoint].filter(Boolean))];
    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const timeout = timeoutSignal(this.config.timeoutMs, operationDeadline);
        try {
          const response = await this.fetch(endpoint, {
            method: "POST",
            signal: timeout.signal,
            headers,
            body: JSON.stringify({
              model: this.config.textModel,
              messages,
              temperature: 0.4,
              max_tokens: maxTokens,
              ...(responseMode === "json" ? { response_format: { type: "json_object" } } : {}),
              stream: false,
            }),
          });
          const normalized = await parseOpenAiProviderResponse(response);
          if (!normalized.text) throw new Error("pollinations_empty_response");
          return { provider: this.name, providerCode: this.code, modelUsed: this.config.textModel, ...normalized };
        } finally {
          timeout.clear();
        }
      } catch (error) {
        lastError = error;
        if (error?.policyBlocked) break;
        if (isRequestCompatibilityError(error)) break;
      }
    }
    throw providerFailure(this.name, lastError, "pollinations_failed");
  }

  async *stream(request) {
    const result = await this.generate(request);
    yield { ...result, delta: result.text, firstChunk: true, done: true };
  }
}

export class PollinationsImageProviderScaffold {
  constructor({ config = getAiProviderConfig() } = {}) {
    this.name = "pollinations_image_scaffold";
    this.model = config.pollinations.imageModel;
    this.baseUrl = config.pollinations.baseUrl;
    this.configured = Boolean(config.pollinations.apiKey) || config.pollinations.configured;
  }

  getSafeStatus() {
    return { provider: this.name, model: this.model, configured: this.configured, routeEnabled: false, frontendEnabled: false };
  }
}

export function providerForOrdinal(ordinal) {
  const normalized = ((Math.max(1, Number.parseInt(ordinal, 10) || 1) - 1) % 50) + 1;
  if (normalized <= 8) return PROVIDER_CODES.groq;
  if (normalized <= 30) return PROVIDER_CODES.gemini;
  return PROVIDER_CODES.pollinations;
}

export function providerOrderForOrdinal(ordinal) {
  const primary = providerForOrdinal(ordinal);
  if (primary === PROVIDER_CODES.groq) return [PROVIDER_CODES.groq, PROVIDER_CODES.gemini, PROVIDER_CODES.pollinations];
  if (primary === PROVIDER_CODES.gemini) return [PROVIDER_CODES.gemini, PROVIDER_CODES.pollinations, PROVIDER_CODES.groq];
  return [PROVIDER_CODES.pollinations, PROVIDER_CODES.groq, PROVIDER_CODES.gemini];
}

function legacyProviderOrder(config) {
  const requested = config.requestedMode;
  if (requested === "groq") return [PROVIDER_CODES.groq];
  if (requested === "gemini") return [PROVIDER_CODES.gemini];
  if (requested === "pollinations") return [PROVIDER_CODES.pollinations];
  if (requested === "mock") return [];
  return [PROVIDER_CODES.groq, PROVIDER_CODES.gemini, PROVIDER_CODES.pollinations];
}

function createProvider(code, options) {
  if (!options?.config?.[code]) return null;
  if (code === PROVIDER_CODES.groq) return new GroqGroundedProvider(options);
  if (code === PROVIDER_CODES.gemini) return new GeminiTextProvider(options);
  if (code === PROVIDER_CODES.pollinations) return new PollinationsTextProvider(options);
  return null;
}

export async function runProviderFallback({
  messages,
  responseMode = "text",
  maxTokens,
  reasoningEffort,
  providerOrder = null,
  operationDeadline = null,
  validateOutput = null,
  config = getAiProviderConfig(),
  fetchImpl = globalThis.fetch,
}) {
  const order = Array.isArray(providerOrder) ? [...new Set(providerOrder)] : legacyProviderOrder(config);
  const providers = order
    .filter((code) => config.routing?.providers?.[code] !== false)
    .map((code) => createProvider(code, { config, fetchImpl }))
    .filter(Boolean);
  let lastError = null;
  let configuredProviderCount = 0;
  const failures = [];
  const attempts = [];
  let invalidOutputSeen = false;
  for (const provider of providers) {
    if (!provider.isConfigured()) continue;
    configuredProviderCount += 1;
    if (operationDeadline && Date.now() >= operationDeadline) {
      failures.push(`${provider.name}:deadline_exceeded`);
      break;
    }
    const startedAt = Date.now();
    try {
      const result = await provider.generate({ messages, responseMode, maxTokens, reasoningEffort, operationDeadline });
      let validatedOutput = null;
      if (typeof validateOutput === "function") {
        try {
          validatedOutput = await validateOutput(result, { provider: provider.code });
        } catch {
          invalidOutputSeen = true;
          failures.push(`${provider.name}:invalid_output`);
          attempts.push({ provider: provider.code, outcome: "invalid_output", latencyMs: Date.now() - startedAt });
          continue;
        }
      }
      attempts.push({ provider: provider.code, outcome: "success", latencyMs: Date.now() - startedAt });
      return {
        ...result,
        ...(typeof validateOutput === "function" ? { validatedOutput } : {}),
        attempts,
        generationSucceeded: true,
        providerFailure: false,
        invalidOutputSeen,
      };
    } catch (error) {
      lastError = error;
      const code = safeFailureCode(provider.name, error);
      failures.push(code);
      attempts.push({ provider: provider.code, outcome: providerStatusClass(error), latencyMs: Date.now() - startedAt });
      if (error?.policyBlocked) {
        return {
          provider: "none",
          providerCode: null,
          modelUsed: null,
          text: "",
          fallbackReason: code,
          attempts,
          policyBlocked: true,
          generationSucceeded: false,
          providerFailure: true,
        };
      }
    }
  }
  if (configuredProviderCount === 0) {
    return {
      provider: "none",
      providerCode: null,
      modelUsed: null,
      text: "",
      fallbackReason: "no_provider_configured",
      attempts,
      generationSucceeded: false,
      providerFailure: true,
      invalidOutputSeen,
    };
  }
  return {
    provider: "none",
    providerCode: null,
    modelUsed: null,
    text: "",
    fallbackReason: failures.join(",") || sanitizeError(lastError || "provider_unavailable"),
    attempts,
    generationSucceeded: false,
    providerFailure: true,
    invalidOutputSeen,
  };
}

export async function* streamProviderFallback(options) {
  const result = await runProviderFallback(options);
  if (result.providerFailure || !result.text) return;
  yield { ...result, delta: result.text, firstChunk: true, done: true };
}

export function resetProviderRuntimeForTests() {
  for (const state of Object.values(runtime)) {
    state.cursor = 0;
    state.unhealthyUntil.clear();
    state.disabled.clear();
  }
}
