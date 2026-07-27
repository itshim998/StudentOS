import assert from "node:assert/strict";
import { validateGeneratedCitations } from "./ai/studentBrainAdapter.js";
import { getGroundingContext, answerFromStudentMaterials } from "./domain/studentosDomain.js";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import {
  deterministicEmbeddingIdentity,
  embedSourceChunks,
  getEmbeddingConfig,
  reindexSourceChunkEmbeddings,
} from "./embeddings/embeddingService.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { createSourceChunks } from "./storage/sourceMaterialService.js";

const deterministicConfig = getEmbeddingConfig({
  STUDENTOS_EMBEDDING_MODE: "mock",
  STUDENTOS_EMBEDDING_PROVIDER: "mock",
  STUDENTOS_EMBEDDING_DIMENSIONS: "384",
});

function repositoryWithClient(client) {
  return new StudentOsRepository({
    config: { mode: "supabase" },
    embeddingConfig: deterministicConfig,
    shardClients: [{
      index: 1,
      projectNumber: 2,
      label: "test-shard",
      client,
    }],
  });
}

const session = {
  authenticated: true,
  user: {
    id: "00000000-0000-4000-8000-000000000009",
    email: "pass9@studentos.local",
  },
};

const state = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
state.sourceMaterials = [{
  id: "src_rpc",
  userId: session.user.id,
  courseId: "course_alg2",
  title: "RPC Quadratics",
  sourceType: "uploaded_file",
  status: "indexed",
  citationLabel: "RPC Quadratics",
}];
state.sourceChunks = createSourceChunks({
  material: state.sourceMaterials[0],
  chunks: [{
    chunkIndex: 0,
    text: "Quadratic roots are values where an expression equals zero.",
    charCount: 60,
    tokenEstimate: 15,
  }],
});
await embedSourceChunks({ sourceChunks: state.sourceChunks, config: deterministicConfig });

const { topic, course } = getGroundingContext(state, "Explain quadratic roots");
const deterministicIdentity = deterministicEmbeddingIdentity(384);
let rpcPayload = null;
const rpcRepository = repositoryWithClient({
  isConfigured: () => true,
  async rpc(name, payload) {
    assert.equal(name, "match_source_chunks_v2");
    rpcPayload = payload;
    return [{
      chunk_id: "chunk_rpc_001",
      source_id: "src_rpc",
      source_title: "RPC Quadratics",
      citation_label: "RPC Quadratics #1",
      course_id: "course_alg2",
      topic_id: "topic_quadratics",
      chunk_index: 0,
      snippet: "Quadratic roots are values where an expression equals zero.",
      similarity: 0.83,
      lexical_score: 0.54,
      rrf_score: 0.0325,
      confidence_score: 0.83,
      confidence_label: "high",
      embedding_status: "embedded",
      embedding_provider: deterministicIdentity.provider,
      embedding_family: deterministicIdentity.family,
      embedding_model: deterministicIdentity.model,
      embedding_version: deterministicIdentity.version,
      embedding_dimensions: deterministicIdentity.dimensions,
      retrieval_mode: "rpc-pgvector-rrf",
    }];
  },
});
const rpcRetrieval = await rpcRepository.retrieveGroundedChunks(session, {
  state,
  message: "Explain quadratic roots",
  topic,
  course,
  limit: 5,
});
assert.equal(rpcPayload.p_user_id, session.user.id);
assert.equal(rpcPayload.p_embedding_provider, deterministicIdentity.provider);
assert.equal(rpcPayload.p_embedding_family, deterministicIdentity.family);
assert.equal(rpcPayload.p_embedding_model, deterministicIdentity.model);
assert.equal(rpcPayload.p_embedding_version, deterministicIdentity.version);
assert.equal(rpcPayload.p_embedding_dimensions, 384);
assert.equal(rpcPayload.p_query_embedding.length, 384);
assert.match(rpcPayload.p_query_text, /quadratic roots/i);
assert.equal(rpcRetrieval.retrievalMode, "rpc-pgvector-rrf");
assert.equal(rpcRetrieval.chunks[0].id, "chunk_rpc_001");
assert.equal(rpcRetrieval.chunks[0].embeddingFamily, deterministicIdentity.family);
assert.equal(rpcRetrieval.chunks[0].rrfScore, 0.0325);
assert.equal(rpcRetrieval.confidence.label, "high");
assert.equal(rpcRetrieval.confidence.semanticAvailable, true);

const lexicalOnlyRepository = repositoryWithClient({
  isConfigured: () => true,
  async rpc(name, payload) {
    assert.equal(name, "match_source_chunks_v2");
    assert(Array.isArray(payload.p_query_embedding));
    return [{
      chunk_id: "chunk_rpc_fts",
      source_id: "src_rpc",
      source_title: "RPC Quadratics",
      citation_label: "RPC Quadratics #1",
      course_id: "course_alg2",
      topic_id: "topic_quadratics",
      chunk_index: 0,
      snippet: "Quadratic roots are values where an expression equals zero.",
      similarity: 0,
      lexical_score: 0.4,
      rrf_score: 0.0164,
      confidence_score: 0.8,
      confidence_label: "high",
      embedding_status: "retry_required",
      embedding_provider: "openai_compatible",
      embedding_family: "another-family",
      embedding_model: "another-model",
      embedding_version: "v2",
      embedding_dimensions: 384,
      retrieval_mode: "rpc-fts-rrf",
    }];
  },
});
const lexicalRetrieval = await lexicalOnlyRepository.retrieveGroundedChunks(session, {
  state,
  message: "Explain quadratic roots",
  topic,
  course,
  limit: 5,
});
assert.equal(lexicalRetrieval.retrievalMode, "rpc-fts-rrf");
assert.equal(lexicalRetrieval.confidence.semanticAvailable, false);
assert.equal(lexicalRetrieval.chunks[0].semanticScore, 0);

const fallbackRepository = repositoryWithClient({
  isConfigured: () => true,
  async rpc() {
    throw new Error("function match_source_chunks_v2 does not exist");
  },
});
const fallbackRetrieval = await fallbackRepository.retrieveGroundedChunks(session, {
  state,
  message: "Explain quadratic roots",
  topic,
  course,
  limit: 5,
});
assert.equal(fallbackRetrieval.retrievalMode, "keyword-fallback");
assert.equal(fallbackRetrieval.confidence.semanticAvailable, false);
assert.match(fallbackRetrieval.rpcFallbackReason, /match_source_chunks_v2|function/);
assert(fallbackRetrieval.chunks.length > 0);

const reindexChunks = createSourceChunks({
  material: state.sourceMaterials[0],
  chunks: [
    { chunkIndex: 1, text: "Pending embedding chunk about factoring.", charCount: 39, tokenEstimate: 10 },
    { chunkIndex: 2, text: "Retry-required embedding chunk about vertex form.", charCount: 51, tokenEstimate: 13 },
  ],
});
reindexChunks[1].embeddingStatus = "degraded_fallback";
reindexChunks[1].embeddingRetryRequired = true;
const reindexSummary = await reindexSourceChunkEmbeddings({ sourceChunks: reindexChunks, config: deterministicConfig });
assert.equal(reindexSummary.selected, 2);
assert.equal(reindexSummary.embedded, 2);
assert(reindexChunks.every((chunk) => chunk.embeddingStatus === "embedded"));
assert(reindexChunks.every((chunk) => chunk.embeddingRetryRequired === false));
const noDuplicateSummary = await reindexSourceChunkEmbeddings({ sourceChunks: reindexChunks, config: deterministicConfig });
assert.equal(noDuplicateSummary.selected, 0);

const citationValidation = validateGeneratedCitations(
  "Use [S1] and ignore [S99] plus [chunk_fake] while keeping [chunk_rpc_001].",
  [{ chunkId: "chunk_rpc_001", citationLabel: "RPC Quadratics #1" }],
);
assert.equal(citationValidation.strippedInventedCitations, true);
assert.match(citationValidation.text, /\[S1\]/);
assert.doesNotMatch(citationValidation.text, /\[S99\]|chunk_fake/);
assert.match(citationValidation.text, /\[chunk_rpc_001\]/);

const emptyState = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
emptyState.sourceMaterials = [];
emptyState.sourceChunks = [];
emptyState.memoryItems = [];
const lowAnswer = answerFromStudentMaterials({
  verb: "Ask",
  message: "Explain an uploaded source about volcanic fossils",
  state: emptyState,
});
assert.equal(lowAnswer.grounding.confidence.lowConfidence, true);
assert.equal(lowAnswer.grounding.snippets.length, 0);

console.log("PASS | C-02 compatible pgvector/FTS RRF retrieval, reindex, and citation tests passed");
