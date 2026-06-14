import { getAiProviderConfig } from "./providerConfig.js";

const GROQ_FAILED_COOLDOWN_MS = 60_000;
let groqRotationCursor = 0;
const groqUnhealthyUntil = new Map();

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function sanitizeError(error) {
  return String(error?.message || error || "provider_error")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/key=([A-Za-z0-9._-]+)/gi, "key=[redacted]")
    .replace(/api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .slice(0, 240);
}

async function parseProviderText(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`provider_http_${response.status}`);
  }
  const messageContent = body?.choices?.[0]?.message?.content;
  if (typeof messageContent === "string") return messageContent.trim();
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => typeof part === "string" ? part : part?.text || "")
      .join("")
      .trim();
  }
  if (typeof body?.output_text === "string") return body.output_text.trim();
  return "";
}

function orderedGroqKeys(keys) {
  if (!keys.length) return [];
  const now = Date.now();
  const healthy = keys.filter((key) => (groqUnhealthyUntil.get(key.name) || 0) <= now);
  const candidates = healthy.length ? healthy : keys;
  const start = groqRotationCursor % candidates.length;
  groqRotationCursor = (groqRotationCursor + 1) % Math.max(candidates.length, 1);
  return [...candidates.slice(start), ...candidates.slice(0, start)];
}

function markGroqKeyUnhealthy(keyName) {
  groqUnhealthyUntil.set(keyName, Date.now() + GROQ_FAILED_COOLDOWN_MS);
}

export class GroqGroundedProvider {
  constructor({ config = getAiProviderConfig(), fetchImpl = globalThis.fetch } = {}) {
    this.name = "groq_grounded";
    this.config = config.groq;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.config.configured && this.fetch);
  }

  async generate({ messages, maxTokens = 900 }) {
    if (!this.isConfigured()) {
      throw new Error("groq_not_configured");
    }
    const keys = orderedGroqKeys(this.config.keys);
    let lastError = null;
    for (const key of keys) {
      try {
        const timeout = timeoutSignal(this.config.timeoutMs);
        try {
          const response = await this.fetch(this.config.endpoint, {
            method: "POST",
            signal: timeout.signal,
            headers: {
              Authorization: `Bearer ${key.value}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: this.config.model,
              messages,
              temperature: 0.45,
              top_p: 0.9,
              max_completion_tokens: maxTokens,
              reasoning_effort: "medium",
              stream: false,
            }),
          });
          const text = await parseProviderText(response);
          if (!text) throw new Error("groq_empty_response");
          return {
            provider: this.name,
            modelUsed: this.config.model,
            keyIndexUsed: key.index,
            text,
          };
        } finally {
          timeout.clear();
        }
      } catch (error) {
        lastError = error;
        markGroqKeyUnhealthy(key.name);
      }
    }
    throw new Error(`groq_failed:${sanitizeError(lastError)}`);
  }
}

export class PollinationsTextProvider {
  constructor({ config = getAiProviderConfig(), fetchImpl = globalThis.fetch } = {}) {
    this.name = "pollinations_text_fallback";
    this.config = config.pollinations;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.config.configured && this.fetch);
  }

  async generate({ messages, maxTokens = 900 }) {
    if (!this.isConfigured()) {
      throw new Error("pollinations_not_configured");
    }
    const headers = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    const endpoints = [this.config.endpoint, this.config.fallbackEndpoint].filter(Boolean);
    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const timeout = timeoutSignal(this.config.timeoutMs);
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
              stream: false,
            }),
          });
          const text = await parseProviderText(response);
          if (!text) throw new Error("pollinations_empty_response");
          return {
            provider: this.name,
            modelUsed: this.config.textModel,
            text,
          };
        } finally {
          timeout.clear();
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`pollinations_failed:${sanitizeError(lastError)}`);
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
    return {
      provider: this.name,
      model: this.model,
      configured: this.configured,
      routeEnabled: false,
      frontendEnabled: false,
    };
  }
}

export async function runProviderFallback({ messages, config = getAiProviderConfig(), fetchImpl = globalThis.fetch }) {
  const requested = config.requestedMode;
  const providers = [];
  if (requested !== "pollinations" && requested !== "mock") {
    providers.push(new GroqGroundedProvider({ config, fetchImpl }));
  }
  if (requested !== "groq" && requested !== "mock") {
    providers.push(new PollinationsTextProvider({ config, fetchImpl }));
  }
  let lastError = null;
  for (const provider of providers) {
    if (!provider.isConfigured()) continue;
    try {
      return await provider.generate({ messages });
    } catch (error) {
      lastError = error;
    }
  }
  return {
    provider: "mock",
    modelUsed: "local_studentos_policy",
    text: "",
    fallbackReason: sanitizeError(lastError || "no_provider_configured"),
  };
}

export function resetProviderRuntimeForTests() {
  groqRotationCursor = 0;
  groqUnhealthyUntil.clear();
}
