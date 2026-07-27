from pathlib import Path
import json


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match for {label}, found {count}")
    return text.replace(old, new, 1)


def replace_between(text, start, end, replacement, label):
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f"Missing start marker for {label}: {start}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f"Missing end marker for {label}: {end}")
    return text[:start_index] + replacement + text[end_index:]


# Domain retrieval: compare vectors only when their complete identities match, and fuse
# compatible semantic and lexical rankings with reciprocal rank fusion.
domain_path = Path("backend/domain/studentosDomain.js")
domain = domain_path.read_text(encoding="utf-8")
domain = replace_once(
    domain,
    'import { confidenceLabel, cosineSimilarity, createDeterministicEmbedding } from "../embeddings/embeddingService.js";',
    '''import {
  areEmbeddingIdentitiesCompatible,
  confidenceLabel,
  cosineSimilarity,
  createDeterministicEmbedding,
  deterministicEmbeddingIdentity,
  embeddingIdentityFromChunk,
  isEmbeddingIdentityComplete,
  normalizeEmbeddingIdentity,
} from "../embeddings/embeddingService.js";''',
    "embedding imports",
)

retrieval_block = r'''export function retrieveGroundedSources({
  state,
  message = "",
  topic,
  course,
  limit = 4,
  queryEmbedding = null,
  embeddingIdentity = null,
  allowAutoDeterministic = true,
}) {
  const tokens = uniqueStrings([
    ...keywordTokens(message),
    ...keywordTokens(topic?.title || ""),
    ...keywordTokens(course?.title || ""),
    ...(topic?.weakSignals || []).flatMap(keywordTokens),
  ]);
  const queryText = [
    message,
    topic?.title || "",
    course?.title || "",
    ...(topic?.weakSignals || []),
  ].join(" ").trim();
  const scoreText = (value) => {
    const text = String(value || "").toLowerCase();
    return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
  };
  const recencyBoost = (value) => {
    const created = toDate(value);
    if (!created) return 0;
    const ageMs = Date.now() - created.getTime();
    if (ageMs < 0) return 0.5;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (ageDays <= 7) return 1.5;
    if (ageDays <= 30) return 0.75;
    return 0;
  };

  let activeIdentity = normalizeEmbeddingIdentity(embeddingIdentity || {});
  let activeQueryVector = Array.isArray(queryEmbedding) ? queryEmbedding.map((value) => Number(value) || 0) : null;
  if (
    !activeQueryVector ||
    !isEmbeddingIdentityComplete(activeIdentity) ||
    activeQueryVector.length !== activeIdentity.dimensions
  ) {
    activeQueryVector = null;
    activeIdentity = normalizeEmbeddingIdentity({});
  }
  if (!activeQueryVector && allowAutoDeterministic) {
    activeIdentity = deterministicEmbeddingIdentity();
    activeQueryVector = createDeterministicEmbedding(queryText, activeIdentity.dimensions);
  }

  const sourceById = new Map(readySourceMaterials(state).map((source) => [source.id, source]));
  let incompatibleEmbeddingCount = 0;
  let retryRequiredCount = 0;
  const rawChunkMatches = readySourceChunks(state)
    .map((chunk) => {
      const source = sourceById.get(chunk.sourceMaterialId);
      if (!source || source.deletedAt) return null;
      const text = [
        chunk.text || chunk.chunkText,
        chunk.citationLabel,
        source.title,
        source.filename,
        source.citationLabel,
        chunk.courseId === course?.id ? course?.title : "",
      ].join(" ");
      const keywordScore = scoreText(text);
      const chunkIdentity = embeddingIdentityFromChunk(chunk);
      const primaryEmbedded = chunk.embeddingStatus === "embedded" &&
        chunk.embeddingRetryRequired !== true &&
        Array.isArray(chunk.embeddingVector);
      const semanticEligible = Boolean(
        activeQueryVector &&
        primaryEmbedded &&
        isEmbeddingIdentityComplete(chunkIdentity) &&
        areEmbeddingIdentitiesCompatible(activeIdentity, chunkIdentity) &&
        chunk.embeddingVector.length === activeIdentity.dimensions,
      );
      if (primaryEmbedded && activeQueryVector && !semanticEligible) {
        incompatibleEmbeddingCount += 1;
        return null;
      }
      if (
        chunk.embeddingRetryRequired === true ||
        ["degraded_fallback", "retry_required", "failed_embedding"].includes(chunk.embeddingStatus)
      ) {
        retryRequiredCount += 1;
      }
      const semanticRaw = semanticEligible
        ? Math.max(0, cosineSimilarity(activeQueryVector, chunk.embeddingVector))
        : 0;
      const metadataScore =
        (chunk.courseId === course?.id ? 5 : 0) +
        (chunk.topicId === topic?.id ? 4 : 0) +
        (source.status === "indexed" ? 1.5 : 0) +
        (source.sourceType === "uploaded_file" ? 2 : 0) +
        recencyBoost(chunk.createdAt || source.createdAt);
      return {
        ...chunk,
        source,
        keywordScore,
        semanticRaw,
        semanticEligible,
        metadataScore,
        chunkIdentity,
        groundingType: source.sourceType === "uploaded_file" ? "uploaded_chunk" : "academic_context_chunk",
        snippet: String(chunk.text || chunk.chunkText || "").slice(0, 420),
      };
    })
    .filter(Boolean);

  const lexicalRank = new Map(
    rawChunkMatches
      .filter((chunk) => chunk.keywordScore > 0)
      .sort((left, right) => right.keywordScore - left.keywordScore || right.metadataScore - left.metadataScore)
      .map((chunk, index) => [chunk.id, index + 1]),
  );
  const semanticRank = new Map(
    rawChunkMatches
      .filter((chunk) => chunk.semanticEligible && chunk.semanticRaw > 0)
      .sort((left, right) => right.semanticRaw - left.semanticRaw)
      .map((chunk, index) => [chunk.id, index + 1]),
  );
  const chunkMatches = rawChunkMatches
    .map((chunk) => {
      const lexicalPosition = lexicalRank.get(chunk.id) || null;
      const semanticPosition = semanticRank.get(chunk.id) || null;
      const rrfScore =
        (lexicalPosition ? 1 / (60 + lexicalPosition) : 0) +
        (semanticPosition ? 1 / (60 + semanticPosition) : 0);
      const lexicalConfidence = Math.min(chunk.keywordScore, 4) / 4;
      const confidenceScore = Math.min(
        1,
        (chunk.semanticEligible ? chunk.semanticRaw * 0.65 : 0) +
        lexicalConfidence * 0.3 +
        (chunk.source.sourceType === "uploaded_file" ? 0.05 : 0),
      );
      return {
        ...chunk,
        score: rrfScore * 1000 + chunk.metadataScore,
        rrfScore: Number(rrfScore.toFixed(6)),
        lexicalRank: lexicalPosition,
        semanticRank: semanticPosition,
        semanticScore: Number(chunk.semanticRaw.toFixed(4)),
        confidenceScore: Number(confidenceScore.toFixed(4)),
        confidenceLabel: confidenceLabel(confidenceScore),
      };
    })
    .filter((chunk) => chunk.rrfScore > 0)
    .sort((left, right) =>
      right.rrfScore - left.rrfScore ||
      right.confidenceScore - left.confidenceScore ||
      right.metadataScore - left.metadataScore);

  const materialMatches = readySourceMaterials(state)
    .map((source) => {
      const text = [
        source.title,
        source.filename,
        source.citationLabel,
        source.extractedText,
        source.extractionSummary,
        source.courseId === course?.id ? course?.title : "",
        topic?.sourceMaterialIds?.includes(source.id) ? topic?.title : "",
      ].join(" ");
      const keywordScore = scoreText(text);
      const metadataScore =
        (source.courseId === course?.id ? 2 : 0) +
        (topic?.sourceMaterialIds?.includes(source.id) ? 3 : 0) +
        (source.sourceType === "uploaded_file" ? 1 : 0);
      return {
        ...source,
        keywordScore,
        score: keywordScore * 10 + metadataScore,
        groundingType: source.sourceType === "uploaded_file" ? "uploaded_material" : "student_material",
      };
    })
    .filter((source) => source.keywordScore > 0);

  const memoryMatches = (state.memoryItems || [])
    .filter((item) => !item.deletedAt)
    .map((item) => {
      const text = [item.title, item.body, item.courseTitle, ...(item.sourceLabels || [])].join(" ");
      const keywordScore = scoreText(text);
      const score = keywordScore * 10 + (item.courseId === course?.id ? 2 : 0) + (item.topicId === topic?.id ? 3 : 0);
      return { ...item, keywordScore, score, groundingType: "memory_extraction" };
    })
    .filter((item) => item.keywordScore > 0);

  const sources = materialMatches
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
  const chunks = chunkMatches
    .filter((chunk) => chunk.confidenceScore >= MIN_GROUNDING_CONFIDENCE)
    .slice(0, limit);
  const memories = memoryMatches
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
  const chunkLabels = chunks.map((chunk) => ({
    label: chunk.citationLabel || chunk.source?.citationLabel || chunk.source?.title,
    type: chunk.groundingType,
    sourceId: chunk.sourceMaterialId,
    chunkId: chunk.id,
    snippet: chunk.snippet,
    confidenceLabel: chunk.confidenceLabel,
    confidenceScore: chunk.confidenceScore,
  }));
  const sourceLabels = sources.map((source) => ({
    label: source.citationLabel || source.title,
    type: source.groundingType,
    sourceId: source.id,
  }));
  const memoryLabels = memories.flatMap((item) =>
    (item.sourceLabels || [item.title]).map((label) => ({
      label,
      type: item.groundingType,
      memoryId: item.id,
    })));
  const fallbackKeywordScore = Math.max(
    sources[0]?.keywordScore || 0,
    memories[0]?.keywordScore || 0,
  );
  const fallbackConfidence = fallbackKeywordScore
    ? Math.min(0.65, 0.2 + Math.min(fallbackKeywordScore, 4) * 0.1)
    : 0;
  const bestConfidence = chunks[0]?.confidenceScore ?? fallbackConfidence;
  const semanticAvailable = chunks.some((chunk) => chunk.semanticEligible && chunk.semanticScore > 0);
  return {
    chunks,
    sources,
    memories,
    labels: [...chunkLabels, ...sourceLabels, ...memoryLabels]
      .filter((item, index, items) => item.label && items.findIndex((other) => other.type === item.type && other.label === item.label) === index),
    hasUploadedMaterial: chunks.some((chunk) => chunk.source?.sourceType === "uploaded_file") || sources.some((source) => source.sourceType === "uploaded_file") || memories.some((item) => item.kind === "source_extraction"),
    retrievalMode: semanticAvailable ? "local-rrf" : "keyword-fallback",
    confidence: {
      score: Number(bestConfidence.toFixed(4)),
      label: confidenceLabel(bestConfidence),
      lowConfidence: bestConfidence < MIN_GROUNDING_CONFIDENCE,
      semanticAvailable,
      incompatibleEmbeddingCount,
      retryRequiredCount,
      retrievalDegraded: incompatibleEmbeddingCount > 0 || retryRequiredCount > 0,
    },
  };
}

'''
domain = replace_between(
    domain,
    "export function retrieveGroundedSources",
    "function latestTestForTopic",
    retrieval_block,
    "compatible local RRF retrieval",
)
domain_path.write_text(domain, encoding="utf-8")


# Repository: create query vectors through the active provider, invoke the identity-aware
# pgvector/FTS RRF RPC, and fail closed to lexical retrieval if the RPC is unavailable.
repo_path = Path("backend/repository/studentOsRepository.js")
repo = repo_path.read_text(encoding="utf-8")
repo = replace_once(
    repo,
    'import { confidenceLabel, createDeterministicEmbedding } from "../embeddings/embeddingService.js";',
    '''import {
  buildEmbeddingQueryText,
  confidenceLabel,
  embedQueryText,
  getEmbeddingConfig,
  normalizeEmbeddingIdentity,
} from "../embeddings/embeddingService.js";''',
    "repository embedding imports",
)
repo = replace_once(
    repo,
    '''      embedding_status: item.embeddingStatus || "pending_embedding",
      embedding_provider: item.embeddingProvider || null,
      embedding_model: item.embeddingModel || null,
      embedding_hash: item.embeddingHash || null,
      embedding_dimensions: item.embeddingDimensions ?? null,
      embedding_values: item.embeddingVector || null,
      embedding_updated_at: item.embeddingUpdatedAt || null,
      embedding_error: item.embeddingError || null,
      deleted_at: item.deletedAt || null,''',
    '''      embedding_status: item.embeddingStatus || "pending_embedding",
      embedding_provider: item.embeddingProvider || null,
      embedding_family: item.embeddingFamily || null,
      embedding_model: item.embeddingModel || null,
      embedding_version: item.embeddingVersion || null,
      embedding_hash: item.embeddingHash || null,
      embedding_dimensions: item.embeddingDimensions ?? null,
      embedding_values: item.embeddingVector || null,
      embedding_updated_at: item.embeddingUpdatedAt || null,
      embedding_error: item.embeddingError || null,
      embedding_retry_required: item.embeddingRetryRequired === true,
      embedding_fallback: item.embeddingFallback === true,
      embedding_target_provider: item.embeddingTargetProvider || null,
      embedding_target_family: item.embeddingTargetFamily || null,
      embedding_target_model: item.embeddingTargetModel || null,
      embedding_target_version: item.embeddingTargetVersion || null,
      embedding_target_dimensions: item.embeddingTargetDimensions ?? null,
      deleted_at: item.deletedAt || null,''',
    "source chunk embedding persistence",
)
repo = replace_once(
    repo,
    '''      provider: item.provider || "pending",
      model: item.model || "pending",
      vector_table: item.vectorTable || null,
      vector_ref: item.vectorRef || null,
      chunk_index: item.chunkIndex ?? null,
      dimensions: item.dimensions ?? null,
      embedding_hash: item.embeddingHash || null,
      embedding_values: item.embeddingValues || null,
      embedding_status: item.embeddingStatus || item.status || "pending_embedding",
      error: item.error || null,
      status: item.status || item.embeddingStatus || "pending",''',
    '''      provider: item.provider || "pending",
      embedding_family: item.embeddingFamily || item.family || null,
      model: item.model || "pending",
      embedding_version: item.embeddingVersion || item.version || null,
      vector_table: item.vectorTable || null,
      vector_ref: item.vectorRef || null,
      chunk_index: item.chunkIndex ?? null,
      dimensions: item.dimensions ?? null,
      embedding_hash: item.embeddingHash || null,
      embedding_values: item.embeddingValues || null,
      embedding_status: item.embeddingStatus || item.status || "pending_embedding",
      retry_required: item.retryRequired === true || item.embeddingRetryRequired === true,
      fallback: item.fallback === true || item.embeddingFallback === true,
      error: item.error || null,
      status: item.status || item.embeddingStatus || "pending",''',
    "embedding metadata persistence",
)

repository_retrieval_helpers = r'''function rpcRowsToRetrieval(rows = [], { fallbackMode = "rpc-fts-rrf", queryResult = null } = {}) {
  const chunks = rows.map((row) => {
    const confidenceScore = Number(row.confidence_score ?? row.similarity ?? 0) || 0;
    const semanticScore = Number(row.similarity || 0) || 0;
    const source = {
      id: row.source_id,
      title: row.source_title,
      sourceType: "uploaded_file",
      citationLabel: row.citation_label || row.source_title,
      status: "indexed",
    };
    return {
      id: row.chunk_id,
      sourceMaterialId: row.source_id,
      courseId: row.course_id || null,
      topicId: row.topic_id || null,
      chunkIndex: row.chunk_index ?? null,
      text: row.snippet || "",
      snippet: row.snippet || "",
      citationLabel: row.citation_label || row.source_title,
      source,
      score: Number(row.rrf_score || 0) * 1000,
      semanticScore,
      lexicalScore: Number(row.lexical_score || 0) || 0,
      rrfScore: Number(row.rrf_score || 0) || 0,
      confidenceScore,
      confidenceLabel: row.confidence_label || confidenceLabel(confidenceScore),
      groundingType: "uploaded_chunk",
      embeddingStatus: row.embedding_status || "pending_embedding",
      embeddingProvider: row.embedding_provider || null,
      embeddingFamily: row.embedding_family || null,
      embeddingModel: row.embedding_model || null,
      embeddingVersion: row.embedding_version || null,
      embeddingDimensions: Number(row.embedding_dimensions || 0) || null,
      retrievalMode: row.retrieval_mode || fallbackMode,
    };
  }).filter((chunk) => chunk.confidenceScore >= MIN_GROUNDING_CONFIDENCE);
  const bestConfidence = chunks[0]?.confidenceScore || 0;
  const semanticAvailable = chunks.some((chunk) =>
    chunk.semanticScore > 0 && chunk.retrievalMode === "rpc-pgvector-rrf");
  return {
    chunks,
    sources: [],
    memories: [],
    labels: chunks.map((chunk) => ({
      label: chunk.citationLabel,
      type: chunk.groundingType,
      sourceId: chunk.sourceMaterialId,
      chunkId: chunk.id,
      snippet: chunk.snippet,
      confidenceLabel: chunk.confidenceLabel,
      confidenceScore: chunk.confidenceScore,
    })),
    hasUploadedMaterial: chunks.length > 0,
    retrievalMode: chunks[0]?.retrievalMode || fallbackMode,
    queryEmbeddingStatus: queryResult?.status || "unknown",
    queryEmbeddingError: queryResult?.error || null,
    confidence: {
      score: Number(bestConfidence.toFixed(4)),
      label: confidenceLabel(bestConfidence),
      lowConfidence: bestConfidence < MIN_GROUNDING_CONFIDENCE,
      semanticAvailable,
      incompatibleEmbeddingCount: 0,
      retryRequiredCount: 0,
      retrievalDegraded: queryResult?.status !== "embedded" || !semanticAvailable,
    },
  };
}

async function localRetrieval({
  state,
  message,
  topic,
  course,
  limit,
  fallbackReason = null,
  embeddingConfig = getEmbeddingConfig(),
  embeddingFetch = globalThis.fetch,
  allowSemantic = true,
}) {
  const queryText = buildEmbeddingQueryText({ message, topic, course });
  const queryResult = allowSemantic
    ? await embedQueryText({ text: queryText, config: embeddingConfig, fetchImpl: embeddingFetch })
    : { status: "disabled", vector: null, identity: null, error: "semantic_fallback_disabled" };
  const retrieval = retrieveGroundedSources({
    state,
    message,
    topic,
    course,
    limit,
    queryEmbedding: queryResult.status === "embedded" ? queryResult.vector : null,
    embeddingIdentity: queryResult.status === "embedded" ? queryResult.identity : null,
    allowAutoDeterministic: false,
  });
  retrieval.queryEmbeddingStatus = queryResult.status;
  retrieval.queryEmbeddingError = queryResult.error || null;
  if (queryResult.status !== "embedded") {
    retrieval.confidence = {
      ...retrieval.confidence,
      semanticAvailable: false,
      retrievalDegraded: true,
    };
  }
  if (fallbackReason) retrieval.rpcFallbackReason = fallbackReason;
  return retrieval;
}

class MockStudentOsRepository {
'''
repo = replace_between(
    repo,
    "function rpcRowsToRetrieval",
    "class MockStudentOsRepository {",
    repository_retrieval_helpers,
    "repository retrieval helpers",
)
repo = replace_once(
    repo,
    '''  constructor() {
    this.states = new Map();''',
    '''  constructor({ embeddingConfig = getEmbeddingConfig(), embeddingFetch = globalThis.fetch } = {}) {
    this.embeddingConfig = embeddingConfig;
    this.embeddingFetch = embeddingFetch;
    this.states = new Map();''',
    "mock repository constructor",
)
repo = replace_once(
    repo,
    '''  async retrieveGroundedChunks(session, args) {
    return localRetrieval(args);
  }''',
    '''  async retrieveGroundedChunks(session, args) {
    return localRetrieval({
      ...args,
      embeddingConfig: this.embeddingConfig,
      embeddingFetch: this.embeddingFetch,
      allowSemantic: true,
    });
  }''',
    "mock repository retrieval",
)
repo = replace_once(
    repo,
    '''  constructor({ config, shardClients }) {
    this.config = config;
    this.shardClients = shardClients;
  }''',
    '''  constructor({ config, shardClients, embeddingConfig = getEmbeddingConfig(), embeddingFetch = globalThis.fetch }) {
    this.config = config;
    this.shardClients = shardClients;
    this.embeddingConfig = embeddingConfig;
    this.embeddingFetch = embeddingFetch;
  }''',
    "Supabase repository constructor",
)

supabase_retrieval = r'''  async retrieveGroundedChunks(session, { state, message, topic, course, limit = 4 }) {
    if (!this.canUseSupabase(session)) {
      return localRetrieval({
        state,
        message,
        topic,
        course,
        limit,
        embeddingConfig: this.embeddingConfig,
        embeddingFetch: this.embeddingFetch,
      });
    }
    const route = this.route(session);
    if (!route.client?.rpc) {
      return localRetrieval({
        state,
        message,
        topic,
        course,
        limit,
        fallbackReason: "rpc_client_unavailable",
        embeddingConfig: this.embeddingConfig,
        embeddingFetch: this.embeddingFetch,
        allowSemantic: false,
      });
    }
    const queryText = buildEmbeddingQueryText({ message, topic, course });
    const queryResult = await embedQueryText({
      text: queryText,
      config: this.embeddingConfig,
      fetchImpl: this.embeddingFetch,
    });
    const identity = normalizeEmbeddingIdentity(queryResult.identity || {});
    try {
      const rows = await route.client.rpc("match_source_chunks_v2", {
        p_user_id: session.user.id,
        p_query_text: queryText,
        p_query_embedding: queryResult.status === "embedded" ? queryResult.vector : null,
        p_embedding_provider: identity.provider || null,
        p_embedding_family: identity.family || null,
        p_embedding_model: identity.model || null,
        p_embedding_version: identity.version || null,
        p_embedding_dimensions: identity.dimensions || null,
        p_course_id: course?.id || null,
        p_topic_id: topic?.id || null,
        p_match_count: limit,
        p_min_similarity: MIN_GROUNDING_CONFIDENCE,
      });
      return rpcRowsToRetrieval(rows, {
        fallbackMode: rows?.[0]?.retrieval_mode || "rpc-fts-rrf",
        queryResult,
      });
    } catch (error) {
      return localRetrieval({
        state,
        message,
        topic,
        course,
        limit,
        fallbackReason: safeErrorLabel(error),
        embeddingConfig: this.embeddingConfig,
        embeddingFetch: this.embeddingFetch,
        allowSemantic: false,
      });
    }
  }

'''
repo = replace_between(
    repo,
    "  async retrieveGroundedChunks(session, { state, message, topic, course, limit = 4 }) {",
    "  async listRunnableJobs",
    supabase_retrieval + "  async listRunnableJobs",
    "Supabase compatible RRF retrieval",
)
repo = replace_once(
    repo,
    '''  constructor({ config, shardClients, routerClient = null, aiRouterCoordinator = null }) {
    this.mock = new MockStudentOsRepository();
    this.supabase = new SupabaseStudentOsRepository({ config, shardClients });''',
    '''  constructor({
    config,
    shardClients,
    routerClient = null,
    aiRouterCoordinator = null,
    embeddingConfig = getEmbeddingConfig(),
    embeddingFetch = globalThis.fetch,
  }) {
    this.mock = new MockStudentOsRepository({ embeddingConfig, embeddingFetch });
    this.supabase = new SupabaseStudentOsRepository({ config, shardClients, embeddingConfig, embeddingFetch });''',
    "repository facade constructor",
)
repo_path.write_text(repo, encoding="utf-8")


# Source chunk records and metadata carry complete identity and retry/fallback state.
source_path = Path("backend/storage/sourceMaterialService.js")
source = source_path.read_text(encoding="utf-8")
source = replace_once(
    source,
    '''    embeddingStatus: "pending_embedding",
    embeddingProvider: "pending",
    embeddingModel: "pending",
    embeddingHash: null,
    embeddingDimensions: null,
    embeddingVector: null,
    embeddingUpdatedAt: null,
    embeddingError: null,''',
    '''    embeddingStatus: "pending_embedding",
    embeddingProvider: "pending",
    embeddingFamily: null,
    embeddingModel: "pending",
    embeddingVersion: null,
    embeddingHash: null,
    embeddingDimensions: null,
    embeddingVector: null,
    embeddingUpdatedAt: null,
    embeddingError: null,
    embeddingRetryRequired: false,
    embeddingFallback: false,
    embeddingTargetProvider: null,
    embeddingTargetFamily: null,
    embeddingTargetModel: null,
    embeddingTargetVersion: null,
    embeddingTargetDimensions: null,''',
    "new source chunk embedding state",
)
source = replace_once(
    source,
    '''    embeddingStatus: chunk.embeddingStatus || "pending_embedding",
    provider: chunk.embeddingProvider || "pending",
    model: chunk.embeddingModel || "pending",
    status: chunk.embeddingStatus || "pending_embedding",
    error: chunk.embeddingError || null,''',
    '''    embeddingStatus: chunk.embeddingStatus || "pending_embedding",
    provider: chunk.embeddingProvider || "pending",
    embeddingFamily: chunk.embeddingFamily || null,
    model: chunk.embeddingModel || "pending",
    embeddingVersion: chunk.embeddingVersion || null,
    retryRequired: chunk.embeddingRetryRequired === true,
    fallback: chunk.embeddingFallback === true,
    status: chunk.embeddingStatus || "pending_embedding",
    error: chunk.embeddingError || null,''',
    "embedding metadata identity state",
)
source_path.write_text(source, encoding="utf-8")


# Fix migration details found during implementation review.
migration_path = Path("supabase/migrations/202607270001_c02_embedding_space_integrity.sql")
migration = migration_path.read_text(encoding="utf-8")
migration = replace_once(
    migration,
    '''          sc.embedding_status,
          sc.embedding_provider,''',
    '''          sc.embedding_status,
          sc.embedding_retry_required,
          sc.embedding_provider,''',
    "dynamic RRF retry column",
)
migration = replace_once(
    migration,
    "execute 'create trigger studentos_source_chunks_embedding_sync before insert or update of embedding_values, embedding_status, embedding_retry_required, embedding_dimensions on public.source_chunks for each row execute function public.studentos_sync_source_chunk_embedding()';",
    "execute 'create trigger studentos_source_chunks_embedding_sync before insert or update on public.source_chunks for each row execute function public.studentos_sync_source_chunk_embedding()';",
    "embedding sync trigger syntax",
)
migration_path.write_text(migration, encoding="utf-8")


# Live RPC verifier now exercises v2 identity filtering and RRF.
verify_path = Path("scripts/verifyRpcLive.js")
verify = verify_path.read_text(encoding="utf-8")
verify = replace_once(
    verify,
    'import { createDeterministicEmbedding, contentHash } from "../backend/embeddings/embeddingService.js";',
    '''import {
  contentHash,
  createDeterministicEmbedding,
  deterministicEmbeddingIdentity,
} from "../backend/embeddings/embeddingService.js";''',
    "RPC verifier embedding import",
)
verify = replace_once(
    verify,
    '''  const embedding = createDeterministicEmbedding(text);
  const now = new Date().toISOString();''',
    '''  const embedding = createDeterministicEmbedding(text);
  const identity = deterministicEmbeddingIdentity(embedding.length);
  const now = new Date().toISOString();''',
    "RPC verifier identity",
)
verify = verify.replace('embeddingModel: "studentos-hash-embedding-v1",', 'embeddingFamily: identity.family,\n    embeddingModel: identity.model,\n    embeddingVersion: identity.version,', 1)
verify = replace_once(
    verify,
    '''    embedding_provider: "mock_deterministic",
    embedding_model: "studentos-hash-embedding-v1",
    embedding_hash: chunkPayload.embeddingHash,''',
    '''    embedding_provider: identity.provider,
    embedding_family: identity.family,
    embedding_model: identity.model,
    embedding_version: identity.version,
    embedding_hash: chunkPayload.embeddingHash,''',
    "RPC verifier persisted identity",
)
old_rpc = '''  const rows = await shard.client.rpc("match_source_chunks", {
    p_user_id: userId,
    p_query_embedding: embedding,
    p_course_id: "course_rpc_verify",
    p_topic_id: null,
    p_match_count: 3,
    p_min_similarity: 0,
  });'''
new_rpc = '''  const rows = await shard.client.rpc("match_source_chunks_v2", {
    p_user_id: userId,
    p_query_text: text,
    p_query_embedding: embedding,
    p_embedding_provider: identity.provider,
    p_embedding_family: identity.family,
    p_embedding_model: identity.model,
    p_embedding_version: identity.version,
    p_embedding_dimensions: identity.dimensions,
    p_course_id: "course_rpc_verify",
    p_topic_id: null,
    p_match_count: 3,
    p_min_similarity: 0,
  });'''
verify = replace_once(verify, old_rpc, new_rpc, "primary v2 live RPC")
old_isolated = '''  const isolatedRows = await shard.client.rpc("match_source_chunks", {
    p_user_id: otherUserId,
    p_query_embedding: embedding,
    p_course_id: "course_rpc_verify",
    p_topic_id: null,
    p_match_count: 3,
    p_min_similarity: 0,
  });'''
new_isolated = '''  const isolatedRows = await shard.client.rpc("match_source_chunks_v2", {
    p_user_id: otherUserId,
    p_query_text: text,
    p_query_embedding: embedding,
    p_embedding_provider: identity.provider,
    p_embedding_family: identity.family,
    p_embedding_model: identity.model,
    p_embedding_version: identity.version,
    p_embedding_dimensions: identity.dimensions,
    p_course_id: "course_rpc_verify",
    p_topic_id: null,
    p_match_count: 3,
    p_min_similarity: 0,
  });'''
verify = replace_once(verify, old_isolated, new_isolated, "isolated v2 live RPC")
verify = replace_once(verify, 'retrievalMode: rows[0]?.retrieval_mode || "rpc-json",', 'retrievalMode: rows[0]?.retrieval_mode || "rpc-fts-rrf",', "RPC verifier mode")
verify_path.write_text(verify, encoding="utf-8")


# Include C-02 migration in the explicit shard plan.
plan_path = Path("scripts/printMigrationPlan.js")
plan = plan_path.read_text(encoding="utf-8")
plan = replace_once(
    plan,
    '  "supabase/migrations/202607210002_studentos_ai_router_v2_shards.sql",',
    '  "supabase/migrations/202607210002_studentos_ai_router_v2_shards.sql",\n  "supabase/migrations/202607270001_c02_embedding_space_integrity.sql",',
    "C-02 migration plan",
)
plan_path.write_text(plan, encoding="utf-8")


# Real mode is gated by explicit model identity and the checked-in evaluation-set version.
for env_name in [".env.example", ".env.template"]:
    env_path = Path(env_name)
    env_text = env_path.read_text(encoding="utf-8")
    env_text = replace_once(
        env_text,
        "STUDENTOS_EMBEDDING_MODEL=",
        "STUDENTOS_EMBEDDING_MODEL=\nSTUDENTOS_EMBEDDING_MODEL_FAMILY=\nSTUDENTOS_EMBEDDING_MODEL_VERSION=\n# Real embedding retrieval remains disabled unless this exactly matches the checked-in fixed evaluation set.\nSTUDENTOS_EMBEDDING_EVAL_SET_VERSION=\nSTUDENTOS_EMBEDDING_TIMEOUT_MS=45000",
        f"{env_name} embedding identity variables",
    )
    env_path.write_text(env_text, encoding="utf-8")


# Make embedding integrity and RPC/RRF tests part of every complete validation run.
package_path = Path("package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
main_test = package["scripts"]["test"]
marker = "npm run test:c01-assessment-integrity && "
insert = "npm run test:c01-assessment-integrity && npm run test:embeddings && npm run test:pass9 && "
if "npm run test:embeddings" not in main_test:
    if marker not in main_test:
        raise SystemExit("Could not locate package test insertion marker")
    package["scripts"]["test"] = main_test.replace(marker, insert, 1)
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
