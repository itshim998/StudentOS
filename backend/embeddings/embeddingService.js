import { createHash } from "node:crypto";

export const DEFAULT_EMBEDDING_DIMENSIONS = 384;
export const DETERMINISTIC_EMBEDDING_FAMILY = "studentos_deterministic_hash";
export const DETERMINISTIC_EMBEDDING_MODEL = "studentos-hash-embedding";
export const DETERMINISTIC_EMBEDDING_VERSION = "1";
export const RETRIEVAL_EVALUATION_SET_VERSION = "c02-v1";

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
  const safeDimensions = positiveInteger(dimensions, DEFAULT_EMBEDDING_DIMENSIONS);
  const vector = Array.from({ length: safeDimensions }, () => 0);
  const tokens = tokensForEmbedding(text);
  for (const token of tokens) {
    const hash = hashToken(token);
    const primary = hash % safeDimensions;
    const secondary = (hash >>> 8) % safeDimensions;
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

export function deterministicEmbeddingIdentity(dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
  return {
    provider: "mock_deterministic",
    family: DETERMINISTIC_EMBEDDING_FAMILY,
    model: DETERMINISTIC_EMBEDDING_MODEL,
    version: DETERMINISTIC_EMBEDDING_VERSION,
    dimensions: positiveInteger(dimensions, DEFAULT_EMBEDDING_DIMENSIONS),
  };
}

export function normalizeEmbeddingIdentity(identity = {}) {
  return {
    provider: String(identity.provider || identity.embeddingProvider || "").trim(),
    family: String(identity.family || identity.embeddingFamily || "").trim(),
    model: String(identity.model || identity.embeddingModel || "").trim(),
    version: String(identity.version || identity.embeddingVersion || "").trim(),
    dimensions: positiveInteger(identity.dimensions ?? identity.embeddingDimensions, 0),
  };
}

export function embeddingIdentityKey(identity = {}) {
  const normalized = normalizeEmbeddingIdentity(identity);
  return [normalized.provider, normalized.family, normalized.model, normalized.version, normalized.dimensions].join("|");
}

export function isEmbeddingIdentityComplete(identity = {}) {
  const normalized = normalizeEmbeddingIdentity(identity);
  return Boolean(
    normalized.provider &&
    normalized.family &&
    normalized.model &&
    normalized.version &&
    normalized.dimensions > 0,
  );
}

export function areEmbeddingIdentitiesCompatible(left, right) {
  if (!isEmbeddingIdentityComplete(left) || !isEmbeddingIdentityComplete(right)) return false;
  return embeddingIdentityKey(left) === embeddingIdentityKey(right);
}

export function embeddingIdentityFromChunk(chunk = {}) {
  return normalizeEmbeddingIdentity({
    provider: chunk.embeddingProvider,
    family: chunk.embeddingFamily,
    model: chunk.embeddingModel,
    version: chunk.embeddingVersion,
    dimensions: chunk.embeddingDimensions,
  });
}

export function getEmbeddingConfig(env = process.env) {
  const mode = readValue(env, "STUDENTOS_EMBEDDING_MODE", "mock").toLowerCase();
  const provider = readValue(env, "STUDENTOS_EMBEDDING_PROVIDER", mode === "real" ? "openai_compatible" : "mock").toLowerCase();
  const dimensions = positiveInteger(
    readValue(env, "STUDENTOS_EMBEDDING_DIMENSIONS", String(DEFAULT_EMBEDDING_DIMENSIONS)),
    DEFAULT_EMBEDDING_DIMENSIONS,
  );
  const model = readValue(env, "STUDENTOS_EMBEDDING_MODEL");
  const family = readValue(env, "STUDENTOS_EMBEDDING_MODEL_FAMILY", model ? `openai_compatible:${model}` : "");
  const version = readValue(env, "STUDENTOS_EMBEDDING_MODEL_VERSION");
  const evaluationSetVersion = readValue(env, "STUDENTOS_EMBEDDING_EVAL_SET_VERSION");
  const realRequested = mode === "real" && provider === "openai_compatible";
  const credentialsConfigured = Boolean(
    readValue(env, "STUDENTOS_EMBEDDING_API_KEY") &&
    readValue(env, "STUDENTOS_EMBEDDING_ENDPOINT") &&
    model,
  );
  const identityConfigured = Boolean(family && version && dimensions > 0);
  const evaluationApproved = evaluationSetVersion === RETRIEVAL_EVALUATION_SET_VERSION;
  const realConfigured = realRequested && credentialsConfigured && identityConfigured && evaluationApproved;

  return {
    mode,
    provider,
    dimensions,
    realRequested,
    credentialsConfigured,
    identityConfigured,
    evaluationSetVersion,
    evaluationApproved,
    realConfigured,
    openaiCompatible: {
      endpoint: readValue(env, "STUDENTOS_EMBEDDING_ENDPOINT"),
      apiKey: readValue(env, "STUDENTOS_EMBEDDING_API_KEY"),
      model,
      family,
      version,
      timeoutMs: positiveInteger(readValue(env, "STUDENTOS_EMBEDDING_TIMEOUT_MS", "45000"), 45000),
    },
  };
}

export function configuredEmbeddingIdentity(config = getEmbeddingConfig()) {
  if (config.realRequested) {
    return normalizeEmbeddingIdentity({
      provider: "openai_compatible",
      family: config.openaiCompatible.family,
      model: config.openaiCompatible.model,
      version: config.openaiCompatible.version,
      dimensions: config.dimensions,
    });
  }
  return deterministicEmbeddingIdentity(config.dimensions);
}

export function getSafeEmbeddingStatus(config = getEmbeddingConfig()) {
  const identity = configuredEmbeddingIdentity(config);
  return {
    mode: config.mode,
    provider: config.realConfigured ? config.provider : (config.realRequested ? "real_not_ready" : "mock_deterministic"),
    family: identity.family || null,
    model: identity.model || null,
    version: identity.version || null,
    dimensions: config.dimensions,
    realRequested: config.realRequested,
    realConfigured: config.realConfigured,
    evaluationSetVersion: RETRIEVAL_EVALUATION_SET_VERSION,
    evaluationApproved: config.evaluationApproved,
    pgvectorReady: true,
    secretsExposed: false,
  };
}

class MockEmbeddingProvider {
  constructor(config) {
    const identity = deterministicEmbeddingIdentity(config.dimensions);
    Object.assign(this, identity);
  }

  async embed(text) {
    return createDeterministicEmbedding(text, this.dimensions);
  }
}

class OpenAiCompatibleEmbeddingProvider {
  constructor(config, fetchImpl = globalThis.fetch) {
    const identity = configuredEmbeddingIdentity(config);
    Object.assign(this, identity);
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
      const normalized = vector.map((value) => Number(value) || 0);
      if (normalized.length !== this.dimensions) {
        throw new Error(`embedding_dimension_mismatch_expected_${this.dimensions}_received_${normalized.length}`);
      }
      return normalized;
    } finally {
      clearTimeout(timer);
    }
  }
}

function selectPrimaryEmbeddingProvider(config, fetchImpl) {
  if (config.realRequested) {
    return config.realConfigured ? new OpenAiCompatibleEmbeddingProvider(config, fetchImpl) : null;
  }
  return new MockEmbeddingProvider(config);
}

function identityForProvider(provider) {
  return normalizeEmbeddingIdentity(provider || {});
}

function applyEmbeddingIdentity(chunk, identity) {
  const normalized = normalizeEmbeddingIdentity(identity);
  chunk.embeddingProvider = normalized.provider;
  chunk.embeddingFamily = normalized.family;
  chunk.embeddingModel = normalized.model;
  chunk.embeddingVersion = normalized.version;
  chunk.embeddingDimensions = normalized.dimensions;
}

function clearEmbeddingTarget(chunk) {
  chunk.embeddingTargetProvider = null;
  chunk.embeddingTargetFamily = null;
  chunk.embeddingTargetModel = null;
  chunk.embeddingTargetVersion = null;
  chunk.embeddingTargetDimensions = null;
}

function setEmbeddingTarget(chunk, identity) {
  const normalized = normalizeEmbeddingIdentity(identity);
  chunk.embeddingTargetProvider = normalized.provider || null;
  chunk.embeddingTargetFamily = normalized.family || null;
  chunk.embeddingTargetModel = normalized.model || null;
  chunk.embeddingTargetVersion = normalized.version || null;
  chunk.embeddingTargetDimensions = normalized.dimensions || null;
}

function safeEmbeddingError(error) {
  return String(error?.message || error || "embedding_failed")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .slice(0, 180);
}

function embeddedChunkIsCurrent(chunk, { hash, identity }) {
  return chunk.embeddingStatus === "embedded" &&
    chunk.embeddingHash === hash &&
    Array.isArray(chunk.embeddingVector) &&
    chunk.embeddingVector.length === normalizeEmbeddingIdentity(identity).dimensions &&
    chunk.embeddingRetryRequired !== true &&
    areEmbeddingIdentitiesCompatible(embeddingIdentityFromChunk(chunk), identity);
}

function markDegradedFallback(chunk, { config, error }) {
  const fallback = new MockEmbeddingProvider(config);
  const fallbackIdentity = identityForProvider(fallback);
  applyEmbeddingIdentity(chunk, fallbackIdentity);
  setEmbeddingTarget(chunk, configuredEmbeddingIdentity(config));
  chunk.embeddingStatus = "degraded_fallback";
  chunk.embeddingRetryRequired = true;
  chunk.embeddingFallback = true;
  chunk.embeddingError = safeEmbeddingError(error);
  return fallback;
}

export function buildEmbeddingQueryText({ message = "", topic, course } = {}) {
  return [
    message,
    topic?.title || "",
    course?.title || "",
    ...(topic?.weakSignals || []),
  ].join(" ").trim();
}

export async function embedQueryText({ text, config = getEmbeddingConfig(), fetchImpl = globalThis.fetch } = {}) {
  const provider = selectPrimaryEmbeddingProvider(config, fetchImpl);
  if (!provider) {
    return {
      status: "retry_required",
      vector: null,
      identity: configuredEmbeddingIdentity(config),
      error: config.evaluationApproved ? "real_embedding_not_configured" : "retrieval_evaluation_not_approved",
    };
  }
  try {
    const vector = await provider.embed(text);
    return {
      status: "embedded",
      vector,
      identity: identityForProvider(provider),
      error: null,
    };
  } catch (error) {
    return {
      status: "retry_required",
      vector: null,
      identity: identityForProvider(provider),
      error: safeEmbeddingError(error),
    };
  }
}

export async function embedSourceChunks({ sourceChunks, config = getEmbeddingConfig(), fetchImpl = globalThis.fetch }) {
  const primaryProvider = selectPrimaryEmbeddingProvider(config, fetchImpl);
  const primaryIdentity = configuredEmbeddingIdentity(config);
  const updated = [];
  for (const chunk of sourceChunks) {
    const text = chunk.text || chunk.chunkText || "";
    const hash = contentHash(text);
    if (primaryProvider && embeddedChunkIsCurrent(chunk, { hash, identity: primaryIdentity })) {
      updated.push(chunk);
      continue;
    }

    chunk.embeddingStatus = "pending_embedding";
    chunk.embeddingHash = hash;
    chunk.embeddingError = null;
    chunk.embeddingRetryRequired = false;
    chunk.embeddingFallback = false;
    clearEmbeddingTarget(chunk);

    if (!primaryProvider) {
      const fallback = markDegradedFallback(chunk, {
        config,
        error: config.evaluationApproved ? "real_embedding_not_configured" : "retrieval_evaluation_not_approved",
      });
      chunk.embeddingVector = await fallback.embed(text);
      chunk.embeddingUpdatedAt = new Date().toISOString();
      updated.push(chunk);
      continue;
    }

    applyEmbeddingIdentity(chunk, primaryIdentity);
    try {
      chunk.embeddingVector = await primaryProvider.embed(text);
      chunk.embeddingStatus = "embedded";
      chunk.embeddingRetryRequired = false;
      chunk.embeddingFallback = false;
      chunk.embeddingError = null;
      clearEmbeddingTarget(chunk);
      chunk.embeddingUpdatedAt = new Date().toISOString();
    } catch (error) {
      if (config.realRequested) {
        const fallback = markDegradedFallback(chunk, { config, error });
        chunk.embeddingVector = await fallback.embed(text);
        chunk.embeddingUpdatedAt = new Date().toISOString();
      } else {
        chunk.embeddingVector = null;
        chunk.embeddingStatus = "retry_required";
        chunk.embeddingRetryRequired = true;
        chunk.embeddingError = safeEmbeddingError(error);
      }
    }
    updated.push(chunk);
  }
  return updated;
}

export function selectChunksForReindex(
  sourceChunks = [],
  { limit = 50, includeEmbedded = false, config = getEmbeddingConfig() } = {},
) {
  const selected = [];
  const targetIdentity = configuredEmbeddingIdentity(config);
  for (const chunk of sourceChunks) {
    if (!chunk || chunk.deletedAt || chunk.status === "deleted" || chunk.status !== "indexed") continue;
    const text = chunk.text || chunk.chunkText || "";
    if (!text.trim()) continue;
    const hash = contentHash(text);
    const staleContent = chunk.embeddingHash !== hash;
    const pending = !chunk.embeddingStatus || chunk.embeddingStatus === "pending_embedding";
    const retryRequired = chunk.embeddingRetryRequired === true || [
      "failed_embedding",
      "retry_required",
      "degraded_fallback",
    ].includes(chunk.embeddingStatus);
    const missingVector = chunk.embeddingStatus === "embedded" && !Array.isArray(chunk.embeddingVector);
    const identityMismatch = chunk.embeddingStatus === "embedded" && !areEmbeddingIdentitiesCompatible(
      embeddingIdentityFromChunk(chunk),
      targetIdentity,
    );
    if (includeEmbedded || pending || retryRequired || staleContent || missingVector || identityMismatch) {
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
  const candidates = selectChunksForReindex(sourceChunks, { limit, includeEmbedded, config });
  const before = new Map(candidates.map((chunk) => [chunk.id, `${chunk.embeddingStatus || "pending_embedding"}:${embeddingIdentityKey(embeddingIdentityFromChunk(chunk))}`]));
  await embedSourceChunks({ sourceChunks: candidates, config, fetchImpl });
  const embedded = candidates.filter((chunk) => chunk.embeddingStatus === "embedded").length;
  const degraded = candidates.filter((chunk) => chunk.embeddingStatus === "degraded_fallback").length;
  const retryRequired = candidates.filter((chunk) => chunk.embeddingRetryRequired === true).length;
  const failed = candidates.filter((chunk) => ["failed_embedding", "retry_required"].includes(chunk.embeddingStatus)).length;
  return {
    scanned: sourceChunks.length,
    selected: candidates.length,
    embedded,
    degraded,
    retryRequired,
    failed,
    skipped: Math.max(0, sourceChunks.length - candidates.length),
    changed: candidates.filter((chunk) => before.get(chunk.id) !== `${chunk.embeddingStatus}:${embeddingIdentityKey(embeddingIdentityFromChunk(chunk))}`).length,
    chunkIds: candidates.map((chunk) => chunk.id),
    provider: config.realConfigured ? config.provider : (config.realRequested ? "real_not_ready" : "mock_deterministic"),
    mode: config.realConfigured ? "real" : (config.realRequested ? "degraded_retry_required" : "mock"),
    identity: configuredEmbeddingIdentity(config),
  };
}
