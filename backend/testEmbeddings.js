import assert from "node:assert/strict";
import { answerFromStudentMaterials, retrieveGroundedSources } from "./domain/studentosDomain.js";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import {
  cosineSimilarity,
  createDeterministicEmbedding,
  embedSourceChunks,
  getEmbeddingConfig,
} from "./embeddings/embeddingService.js";
import { createSourceChunks } from "./storage/sourceMaterialService.js";

const vectorA = createDeterministicEmbedding("quadratic roots vertex factors");
const vectorB = createDeterministicEmbedding("quadratic roots vertex factors");
const vectorC = createDeterministicEmbedding("chlorophyll photosynthesis light energy");
assert.equal(vectorA.length, 384);
assert.deepEqual(vectorA, vectorB);
assert(cosineSimilarity(vectorA, vectorB) > 0.99);
assert(cosineSimilarity(vectorA, vectorC) < 0.2);

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
assert(sourceChunks.every((chunk) => Array.isArray(chunk.embeddingVector)));

const firstUpdatedAt = sourceChunks[0].embeddingUpdatedAt;
await embedSourceChunks({ sourceChunks });
assert.equal(sourceChunks[0].embeddingUpdatedAt, firstUpdatedAt);

state.sourceChunks.push(...sourceChunks);
const bioRetrieval = retrieveGroundedSources({
  state,
  message: "How does chlorophyll use light energy?",
  topic,
  course,
});
assert.equal(bioRetrieval.chunks[0].sourceMaterialId, "src_bio");
assert(["medium", "high"].includes(bioRetrieval.chunks[0].confidenceLabel));
assert.equal(bioRetrieval.confidence.semanticAvailable, true);

const lowConfidence = retrieveGroundedSources({
  state,
  message: "Explain volcanic fossils from my source",
  topic,
  course,
});
assert.equal(lowConfidence.confidence.lowConfidence, true);
const lowAnswer = answerFromStudentMaterials({
  verb: "Ask",
  message: "Explain volcanic fossils from my source",
  state,
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

const fallbackChunks = createSourceChunks({
  material: materialMath,
  chunks: [{ chunkIndex: 1, text: "Retry-safe embedding fallback test.", charCount: 36, tokenEstimate: 9 }],
});
await embedSourceChunks({
  sourceChunks: fallbackChunks,
  config: getEmbeddingConfig({
    STUDENTOS_EMBEDDING_MODE: "real",
    STUDENTOS_EMBEDDING_PROVIDER: "openai_compatible",
  }),
});
assert.equal(fallbackChunks[0].embeddingStatus, "embedded");
assert.equal(fallbackChunks[0].embeddingProvider, "mock_deterministic");

const realFailureChunks = createSourceChunks({
  material: materialMath,
  chunks: [{ chunkIndex: 2, text: "Real provider failure should fall back safely.", charCount: 46, tokenEstimate: 12 }],
});
await embedSourceChunks({
  sourceChunks: realFailureChunks,
  config: getEmbeddingConfig({
    STUDENTOS_EMBEDDING_MODE: "real",
    STUDENTOS_EMBEDDING_PROVIDER: "openai_compatible",
    STUDENTOS_EMBEDDING_API_KEY: "fake-secret-key",
    STUDENTOS_EMBEDDING_ENDPOINT: "https://embedding.example.invalid",
    STUDENTOS_EMBEDDING_MODEL: "demo-embedding",
  }),
  fetchImpl: async () => new Response(JSON.stringify({ error: "fail" }), { status: 500 }),
});
assert.equal(realFailureChunks[0].embeddingStatus, "embedded");
assert.equal(realFailureChunks[0].embeddingProvider, "mock_deterministic");
assert.equal(realFailureChunks[0].embeddingFallback, true);
assert.equal(JSON.stringify(realFailureChunks[0]).includes("fake-secret-key"), false);

console.log("PASS | StudentOS Pass 8 embedding and hybrid retrieval tests passed");
