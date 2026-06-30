import assert from "node:assert/strict";
import { validateGeneratedCitations } from "./ai/studentBrainAdapter.js";
import { getGroundingContext, answerFromStudentMaterials } from "./domain/studentosDomain.js";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import { embedSourceChunks, reindexSourceChunkEmbeddings } from "./embeddings/embeddingService.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { createSourceChunks } from "./storage/sourceMaterialService.js";

function repositoryWithClient(client) {
  return new StudentOsRepository({
    config: { mode: "supabase" },
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
await embedSourceChunks({ sourceChunks: state.sourceChunks });

const { topic, course } = getGroundingContext(state, "Explain quadratic roots");
let rpcPayload = null;
const rpcRepository = repositoryWithClient({
  isConfigured: () => true,
  async rpc(name, payload) {
    assert.equal(name, "match_source_chunks");
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
      confidence_score: 0.83,
      confidence_label: "high",
      embedding_status: "embedded",
      retrieval_mode: "rpc-vector",
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
assert.equal(rpcRetrieval.retrievalMode, "rpc-vector");
assert.equal(rpcRetrieval.chunks[0].id, "chunk_rpc_001");
assert.equal(rpcRetrieval.confidence.label, "high");

const fallbackRepository = repositoryWithClient({
  isConfigured: () => true,
  async rpc() {
    throw new Error("function match_source_chunks does not exist");
  },
});
const fallbackRetrieval = await fallbackRepository.retrieveGroundedChunks(session, {
  state,
  message: "Explain quadratic roots",
  topic,
  course,
  limit: 5,
});
assert(["local-json", "keyword-fallback"].includes(fallbackRetrieval.retrievalMode));
assert.match(fallbackRetrieval.rpcFallbackReason, /match_source_chunks|function/);
assert(fallbackRetrieval.chunks.length > 0);

const reindexChunks = createSourceChunks({
  material: state.sourceMaterials[0],
  chunks: [
    { chunkIndex: 1, text: "Pending embedding chunk about factoring.", charCount: 39, tokenEstimate: 10 },
    { chunkIndex: 2, text: "Failed embedding chunk about vertex form.", charCount: 39, tokenEstimate: 10 },
  ],
});
reindexChunks[1].embeddingStatus = "failed_embedding";
const reindexSummary = await reindexSourceChunkEmbeddings({ sourceChunks: reindexChunks });
assert.equal(reindexSummary.selected, 2);
assert.equal(reindexSummary.embedded, 2);
assert(reindexChunks.every((chunk) => chunk.embeddingStatus === "embedded"));
const noDuplicateSummary = await reindexSourceChunkEmbeddings({ sourceChunks: reindexChunks });
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

console.log("PASS | StudentOS Pass 9 RPC retrieval, reindex, and citation validation tests passed");
