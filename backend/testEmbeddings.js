import assert from "node:assert/strict";
import { answerFromStudentMaterials, retrieveGroundedSources } from "./domain/studentosDomain.js";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import {
  RETRIEVAL_EVALUATION_SET_VERSION,
  areEmbeddingIdentitiesCompatible,
  configuredEmbeddingIdentity,
  cosineSimilarity,
  createDeterministicEmbedding,
  deterministicEmbeddingIdentity,
  embedQueryText,
  embedSourceChunks,
  embeddingIdentityFromChunk,
  getEmbeddingConfig,
  reindexSourceChunkEmbeddings,
} from "./embeddings/embeddingService.js";
import { evaluateFixedRetrievalSet } from "./retrieval/retrievalEvaluationSet.js";
import { createSourceChunks } from "./storage/sourceMaterialService.js";

const vectorA = createDeterministicEmbedding("quadratic roots vertex factors");
const vectorB = createDeterministicEmbedding("quadratic roots vertex factors");
const vectorC = createDeterministicEmbedding("chlorophyll photosynthesis light energy");
assert.equal(vectorA.length, 384);
assert.deepEqual(vectorA, vectorB);
assert(cosineSimilarity(vectorA, vectorB) > 0.99);
assert(cosineSimilarity(vectorA, vectorC) < 0.2);
assert(areEmbeddingIdentitiesCompatible(deterministicEmbeddingIdentity(), deterministicEmbeddingIdentity()));
assert.equal(areEmbeddingIdentitiesCompatible(
  deterministicEmbeddingIdentity(),
  { ...deterministicEmbeddingIdentity(), version: "2" },
), false);

const evaluation = evaluateFixedRetrievalSet();
assert.equal(evaluation.version, RETRIEVAL_EVALUATION_SET_VERSION);
assert.equal(evaluation.caseCount, 8);
assert.equal(evaluation.passed, true);
assert(evaluation.recallAtOne >= 0.75);
assert(evaluation.meanReciprocalRank >= 0.85);

const realEnv = {
  STUDENTOS_EMBEDDING_MODE: "real",
  STUDENTOS_EMBEDDING_PROVIDER: "openai_compatible",
  STUDENTOS_EMBEDDING_API_KEY: "fake-secret-key",
  STUDENTOS_EMBEDDING_ENDPOINT: "https://embedding.example.invalid",
  STUDENTOS_EMBEDDING_MODEL: "demo-embedding",
  STUDENTOS_EMBEDDING_MODEL_FAMILY: "demo-embedding-family",
  STUDENTOS_EMBEDDING_MODEL_VERSION: "2026-07-27",
  STUDENTOS_EMBEDDING_DIMENSIONS: "384",
  STUDENTOS_EMBEDDING_EVAL_SET_VERSION: RETRIEVAL_EVALUATION_SET_VERSION,
};
const unapprovedRealConfig = getEmbeddingConfig({
  ...realEnv,
  STUDENTOS_EMBEDDING_EVAL_SET_VERSION: "",
});
assert.equal(unapprovedRealConfig.realRequested, true);
assert.equal(unapprovedRealConfig.realConfigured, false);
assert.equal(unapprovedRealConfig.evaluationApproved, false);
const realConfig = getEmbeddingConfig(realEnv);
assert.equal(realConfig.realConfigured, true);
assert.equal(realConfig.evaluationApproved, true);

const state = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
state.sourceMaterials = [];
state.sourceChunks = [];
state.memoryItems = [];
const course = state.courses.find((item) => item.id === "course_alg2");
const topic = state.topics.find((item) => item.id === "topic_quadratics");
const materialMath = {
  id: "src_math",
  userId: "student_demo_001",
  courseId: course.id,
  title: "Quadratic guide",
  sourceType: "uploaded_file",
  status: "indexed",
  citationLabel: "Quadratic guide",
  createdAt: "2026-05-25T10:00:00.000Z",
};
const materialBio = {
  id: "src_bio",
  userId: "student_demo_001",
  courseId: course.id,
  title: "Photosynthesis guide",
  sourceType: "uploaded_file",
  status: "indexed",
  citationLabel: "Photosynthesis guide",
  createdAt: "2026-05-25T10:00:00.000Z",
};
state.sourceMaterials.push(materialMath, materialBio);

const sourceChunks = createSourceChunks({
  material: materialMath,
  chunks: [{ chunkIndex: 0, text: "Quadratic roots are values where the expression equals zero.", charCount: 64, tokenEstimate: 16 }],
}).concat(createSourceChunks({
  material: materialBio,
  chunks: [{ chunkIndex: 0, text: "Photosynthesis uses chlorophyll to convert light energy into chemical energy.", charCount: 76, tokenEstimate: 19 }],
}));
await embedSourceChunks({ sourceChunks });
assert(sourceChunks.every((chunk) => chunk.embeddingStatus === "embedded"));
assert(sourceChunks.every((chunk) => chunk.embeddingProvider === "mock_deterministic"));
assert(sourceChunks.every((chunk) => chunk.embeddingFamily === "studentos_deterministic_hash"));
assert(sourceChunks.every((chunk) => chunk.embeddingVersion === "1"));
assert(sourceChunks.every((chunk) => chunk.embeddingRetryRequired === false));
assert(sourceChunks.every((chunk) => Array.isArray(chunk.embeddingVector)));

const firstUpdatedAt = sourceChunks[0].embeddingUpdatedAt;
await embedSourceChunks({ sourceChunks });
assert.equal(sourceChunks[0].embeddingUpdatedAt, firstUpdatedAt);

state.sourceChunks.push(...sourceChunks);
const queryText = "How does chlorophyll use light energy?";
const queryIdentity = deterministicEmbeddingIdentity();
const queryVector = createDeterministicEmbedding(queryText);
const bioRetrieval = retrieveGroundedSources({
  state,
  message: queryText,
  topic,
  course,
  queryEmbedding: queryVector,
  embeddingIdentity: queryIdentity,
});
assert.equal(bioRetrieval.chunks[0].sourceMaterialId, "src_bio");
assert(["medium", "high"].includes(bioRetrieval.chunks[0].confidenceLabel));
assert.equal(bioRetrieval.confidence.semanticAvailable, true);
assert.equal(bioRetrieval.retrievalMode, "local-rrf");

const incompatible = {
  ...structuredClone(sourceChunks[0]),
  id: "chunk_incompatible_real",
  sourceMaterialId: "src_math",
  embeddingProvider: "openai_compatible",
  embeddingFamily: "unrelated-real-family",
  embeddingModel: "unrelated-model",
  embeddingVersion: "v9",
  embeddingDimensions: 384,
  embeddingVector: queryVector,
  embeddingStatus: "embedded",
};
state.sourceChunks.unshift(incompatible);
const compatibilityRetrieval = retrieveGroundedSources({
  state,
  message: queryText,
  topic,
  course,
  queryEmbedding: queryVector,
  embeddingIdentity: queryIdentity,
});
assert.equal(compatibilityRetrieval.chunks.some((chunk) => chunk.id === incompatible.id), false);
assert(compatibilityRetrieval.confidence.incompatibleEmbeddingCount >= 1);
state.sourceChunks.shift();

const lowConfidence = retrieveGroundedSources({
  state,
  message: "Explain volcanic fossils from my source",
  topic,
  course,
  queryEmbedding: createDeterministicEmbedding("Explain volcanic fossils from my source"),
  embeddingIdentity: queryIdentity,
});
assert.equal(lowConfidence.confidence.lowConfidence, true);
const lowAnswer = answerFromStudentMaterials({
  verb: "Ask",
  message: "Explain volcanic fossils from my source",
  state,
  retrievalOverride: lowConfidence,
});
assert.equal(lowAnswer.grounding.confidence.lowConfidence, true);
assert.match(lowAnswer.explanation.concept, /Not enough material yet/);

const emptyState = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
emptyState.sourceMaterials = [];
emptyState.sourceChunks = [];
emptyState.memoryItems = [];
const noCitationAnswer = answerFromStudentMaterials({
  verb: "Ask",
  message: "Cite an uploaded source that does not exist",
  state: emptyState,
});
assert.equal(noCitationAnswer.sourceLabels.length, 0);
assert.equal(noCitationAnswer.grounding.snippets.length, 0);

const unapprovedChunks = createSourceChunks({
  material: materialMath,
  chunks: [{ chunkIndex: 1, text: "Evaluation approval is required before real embeddings.", charCount: 55, tokenEstimate: 14 }],
});
await embedSourceChunks({ sourceChunks: unapprovedChunks, config: unapprovedRealConfig });
assert.equal(unapprovedChunks[0].embeddingStatus, "degraded_fallback");
assert.equal(unapprovedChunks[0].embeddingRetryRequired, true);
assert.equal(unapprovedChunks[0].embeddingProvider, "mock_deterministic");
assert.equal(unapprovedChunks[0].embeddingTargetProvider, "openai_compatible");
assert.match(unapprovedChunks[0].embeddingError, /retrieval_evaluation_not_approved/);

const realFailureChunks = createSourceChunks({
  material: materialMath,
  chunks: [{ chunkIndex: 2, text: "Real provider failure must remain retryable.", charCount: 45, tokenEstimate: 12 }],
});
await embedSourceChunks({
  sourceChunks: realFailureChunks,
  config: realConfig,
  fetchImpl: async () => new Response(JSON.stringify({ error: "fail" }), { status: 500 }),
});
assert.equal(realFailureChunks[0].embeddingStatus, "degraded_fallback");
assert.equal(realFailureChunks[0].embeddingProvider, "mock_deterministic");
assert.equal(realFailureChunks[0].embeddingFallback, true);
assert.equal(realFailureChunks[0].embeddingRetryRequired, true);
assert.equal(realFailureChunks[0].embeddingTargetFamily, "demo-embedding-family");
assert.equal(JSON.stringify(realFailureChunks[0]).includes("fake-secret-key"), false);

const failedQuery = await embedQueryText({
  text: "quadratic roots",
  config: realConfig,
  fetchImpl: async () => new Response(JSON.stringify({ error: "fail" }), { status: 500 }),
});
assert.equal(failedQuery.status, "retry_required");
assert.equal(failedQuery.vector, null);
assert.equal(failedQuery.identity.family, "demo-embedding-family");

const realVectorFor = (text) => createDeterministicEmbedding(`real-space:${text}`);
const recoverySummary = await reindexSourceChunkEmbeddings({
  sourceChunks: realFailureChunks,
  config: realConfig,
  fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body);
    return new Response(JSON.stringify({ data: [{ embedding: realVectorFor(body.input) }] }), { status: 200 });
  },
});
assert.equal(recoverySummary.selected, 1);
assert.equal(recoverySummary.embedded, 1);
assert.equal(recoverySummary.degraded, 0);
assert.equal(realFailureChunks[0].embeddingStatus, "embedded");
assert.equal(realFailureChunks[0].embeddingProvider, "openai_compatible");
assert.equal(realFailureChunks[0].embeddingFamily, "demo-embedding-family");
assert.equal(realFailureChunks[0].embeddingVersion, "2026-07-27");
assert.equal(realFailureChunks[0].embeddingRetryRequired, false);
assert.equal(realFailureChunks[0].embeddingFallback, false);
assert.equal(realFailureChunks[0].embeddingTargetProvider, null);
assert(areEmbeddingIdentitiesCompatible(embeddingIdentityFromChunk(realFailureChunks[0]), configuredEmbeddingIdentity(realConfig)));

const wrongDimensionChunks = createSourceChunks({
  material: materialMath,
  chunks: [{ chunkIndex: 3, text: "Wrong dimensions cannot be accepted.", charCount: 36, tokenEstimate: 9 }],
});
await embedSourceChunks({
  sourceChunks: wrongDimensionChunks,
  config: realConfig,
  fetchImpl: async () => new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 }),
});
assert.equal(wrongDimensionChunks[0].embeddingStatus, "degraded_fallback");
assert.equal(wrongDimensionChunks[0].embeddingRetryRequired, true);
assert.match(wrongDimensionChunks[0].embeddingError, /dimension_mismatch/);

console.log("PASS | C-02 embedding identity, fallback retry, RRF retrieval, and fixed evaluation tests passed");
