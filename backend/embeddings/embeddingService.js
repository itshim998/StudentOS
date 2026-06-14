import { createHash } from "node:crypto";

export const DEFAULT_EMBEDDING_DIMENSIONS = 384;

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

export function contentHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function tokensForEmbedding(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 3);
}

function hashToken(token) {
  const digest = createHash("sha256").update(token).digest();
  return digest.readUInt32BE(0);
}

function normalizeVector(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return vector;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

export function createDeterministicEmbedding(text, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = tokensForEmbedding(text);
  for (const token of tokens) {
    const hash = hashToken(token);
    const primary = hash % dimensions;
    const secondary = (hash >>> 8) % dimensions;
    vector[primary] += 1;
    vector[secondary] += 0.35;
  }
  return normalizeVector(vector);
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) {
    return 0;
  }
  let dot = 0;
  let leftMag = 0;
  let rightMag = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index]) || 0;
    const rightValue = Number(right[index]) || 0;
    dot += leftValue * rightValue;
    leftMag += leftValue * leftValue;
    rightMag += rightValue * rightValue;
  }
  if (!leftMag || !rightMag) return 0;
  return dot / (Math.sqrt(leftMag) * Math.sqrt(rightMag));
}

export function confidenceLabel(score) {
  if (score >= 0.6) return "high";
  if (score >= 0.42) return "medium";
  return "low";
}

export function getEmbeddingConfig(env = process.env) {
  const mode = readValue(env, "STUDENTOS_EMBEDDING_MODE", "mock").toLowerCase();
  const provider = readValue(env, "STUDENTOS_EMBEDDING_PROVIDER", mode === "real" ? "openai_compatible" : "mock");
  const dimensions = Number(readValue(env, "STUDENTOS_EMBEDDING_DIMENSIONS", String(DEFAULT_EMBEDDING_DIMENSIONS))) || DEFAULT_EMBEDDING_DIMENSIONS;
  return {
    mode,
    provider,
    dimensions,
    realConfigured: mode === "real" &&
      provider === "openai_compatible" &&
      Boolean(readValue(env, "STUDENTOS_EMBEDDING_API_KEY")) &&
      Boolean(readValue(env, "STUDENTOS_EMBEDDING_ENDPOINT")) &&
      Boolean(readValue(env, "STUDENTOS_EMBEDDING_MODEL")),
    openaiCompatible: {
      endpoint: readValue(env, "STUDENTOS_EMBEDDING_ENDPOINT"),
      apiKey: readValue(env, "STUDENTOS_EMBEDDING_API_KEY"),
      model: readValue(env, "STUDENTOS_EMBEDDING_MODEL"),
      timeoutMs: Number(readValue(env, "STUDENTOS_EMBEDDING_TIMEOUT_MS", "45000")) || 45000,
    },
  };
}

export function getSafeEmbeddingStatus(config = getEmbeddingConfig()) {
  return {
    mode: config.mode,
    provider: config.realConfigured ? config.provider : "mock_deterministic",
    dimensions: config.dimensions,
    realConfigured: config.realConfigured,
    pgvectorReady: true,
    secretsExposed: false,
  };
}

class MockEmbeddingProvider {
  constructor(config) {
    this.name = "mock_deterministic";
    this.model = "studentos-hash-embedding-v1";
    this.dimensions = config.dimensions;
  }

  async embed(text) {
    return createDeterministicEmbedding(text, this.dimensions);
  }
}

class OpenAiCompatibleEmbeddingProvider {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.name = "openai_compatible";
    this.model = config.openaiCompatible.model;
    this.dimensions = config.dimensions;
    this.endpoint = config.openaiCompatible.endpoint;
    this.apiKey = config.openaiCompatible.apiKey;
    this.timeoutMs = config.openaiCompatible.timeoutMs;
    this.fetch = fetchImpl;
  }

  async embed(text) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`embedding_http_${response.status}`);
      const vector = body?.data?.[0]?.embedding;
      if (!Array.isArray(vector) || !vector.length) throw new Error("embedding_empty_response");
      return vector.map((value) => Number(value) || 0);
    } finally {
      clearTimeout(timer);
    }
  }
}

function selectEmbeddingProvider(config, fetchImpl) {
  if (config.realConfigured) {
    return new OpenAiCompatibleEmbeddingProvider(config, fetchImpl);
  }
  return new MockEmbeddingProvider(config);
}

function safeEmbeddingError(error) {
  return String(error?.message || error || "embedding_failed")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .slice(0, 180);
}

export async function embedSourceChunks({ sourceChunks, config = getEmbeddingConfig(), fetchImpl = globalThis.fetch }) {
  const provider = selectEmbeddingProvider(config, fetchImpl);
  const updated = [];
  for (const chunk of sourceChunks) {
    const text = chunk.text || chunk.chunkText || "";
    const hash = contentHash(text);
    if (chunk.embeddingStatus === "embedded" && chunk.embeddingHash === hash && Array.isArray(chunk.embeddingVector)) {
      updated.push(chunk);
      continue;
    }
    chunk.embeddingStatus = "pending_embedding";
    chunk.embeddingProvider = provider.name;
    chunk.embeddingModel = provider.model;
    chunk.embeddingHash = hash;
    chunk.embeddingDimensions = config.dimensions;
    chunk.embeddingError = null;
    try {
      chunk.embeddingVector = await provider.embed(text);
      chunk.embeddingDimensions = chunk.embeddingVector.length;
      chunk.embeddingStatus = "embedded";
      chunk.embeddingUpdatedAt = new Date().toISOString();
    } catch (error) {
      if (config.realConfigured) {
        const fallback = new MockEmbeddingProvider(config);
        chunk.embeddingProvider = fallback.name;
        chunk.embeddingModel = fallback.model;
        chunk.embeddingVector = await fallback.embed(text);
        chunk.embeddingDimensions = chunk.embeddingVector.length;
        chunk.embeddingStatus = "embedded";
        chunk.embeddingFallback = true;
        chunk.embeddingError = safeEmbeddingError(error);
        chunk.embeddingUpdatedAt = new Date().toISOString();
      } else {
        chunk.embeddingStatus = "failed_embedding";
        chunk.embeddingError = safeEmbeddingError(error);
      }
    }
    updated.push(chunk);
  }
  return updated;
}

export function selectChunksForReindex(sourceChunks = [], { limit = 50, includeEmbedded = false } = {}) {
  const selected = [];
  for (const chunk of sourceChunks) {
    if (!chunk || chunk.deletedAt || chunk.status === "deleted" || chunk.status !== "indexed") continue;
    const text = chunk.text || chunk.chunkText || "";
    if (!text.trim()) continue;
    const hash = contentHash(text);
    const stale = chunk.embeddingHash !== hash;
    const pending = !chunk.embeddingStatus || chunk.embeddingStatus === "pending_embedding";
    const failed = chunk.embeddingStatus === "failed_embedding";
    const missingVector = chunk.embeddingStatus === "embedded" && !Array.isArray(chunk.embeddingVector);
    if (includeEmbedded || pending || failed || stale || missingVector) {
      selected.push(chunk);
    }
    if (selected.length >= limit) break;
  }
  return selected;
}

export async function reindexSourceChunkEmbeddings({
  sourceChunks = [],
  limit = 50,
  includeEmbedded = false,
  config = getEmbeddingConfig(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const candidates = selectChunksForReindex(sourceChunks, { limit, includeEmbedded });
  const before = new Map(candidates.map((chunk) => [chunk.id, chunk.embeddingStatus || "pending_embedding"]));
  await embedSourceChunks({ sourceChunks: candidates, config, fetchImpl });
  const embedded = candidates.filter((chunk) => chunk.embeddingStatus === "embedded").length;
  const failed = candidates.filter((chunk) => chunk.embeddingStatus === "failed_embedding").length;
  return {
    scanned: sourceChunks.length,
    selected: candidates.length,
    embedded,
    failed,
    skipped: Math.max(0, sourceChunks.length - candidates.length),
    changed: candidates.filter((chunk) => before.get(chunk.id) !== chunk.embeddingStatus).length,
    chunkIds: candidates.map((chunk) => chunk.id),
    provider: config.realConfigured ? config.provider : "mock_deterministic",
    mode: config.realConfigured ? "real_with_mock_fallback" : "mock",
  };
}
