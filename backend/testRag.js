import assert from "node:assert/strict";
import { answerFromStudentMaterials, retrieveGroundedSources } from "./domain/studentosDomain.js";
import { createSeedState } from "./domain/studentosDomain.js";
import {
  chunkExtractedText,
  createEmbeddingMetadataForChunks,
  createMemoryItemForSource,
  createSourceChunks,
  createSourceMaterialRecord,
  extractSourceText,
} from "./storage/sourceMaterialService.js";

const session = {
  user: {
    id: "student_demo_001",
  },
};
const state = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
state.sourceChunks = [];
state.memoryItems = [];
state.embeddingsMetadata = [];
const course = state.courses.find((item) => item.id === "course_alg2");
const topic = state.topics.find((item) => item.id === "topic_quadratics");

const extraction = await extractSourceText({
  bytes: Buffer.from("Quadratic roots are solutions where the expression equals zero. Vertex form helps graph parabolas. Factoring helps find roots quickly for exams. ".repeat(20), "utf8"),
  mimeType: "text/plain",
  filename: "quadratic-roots.txt",
});
assert.equal(extraction.status, "indexed");

const chunks = chunkExtractedText(extraction.extractedText, { maxChars: 220, overlapChars: 30 });
assert(chunks.length > 2);
assert.equal(chunks[0].chunkIndex, 0);
assert(chunks[0].charCount > 0);
assert(chunks[0].tokenEstimate > 0);

const material = createSourceMaterialRecord({
  session,
  course,
  courseId: course.id,
  title: "Uploaded roots guide",
  file: {
    filename: "quadratic-roots.txt",
    mimeType: "text/plain",
    bytes: Buffer.from(extraction.extractedText, "utf8"),
  },
  config: {
    storage: {
      bucket: "studentos-source-materials",
    },
  },
  extraction: {
    ...extraction,
    status: "extracting",
  },
});
material.status = extraction.status;
material.extractionStatus = extraction.status;
material.extractedText = extraction.extractedText;
material.chunkCount = chunks.length;

const sourceChunks = createSourceChunks({ material, chunks });
const embeddingRows = createEmbeddingMetadataForChunks({ material, sourceChunks });
assert.equal(sourceChunks.length, chunks.length);
assert.equal(embeddingRows.length, chunks.length);
assert.equal(embeddingRows[0].status, "pending_embedding");
assert.equal(embeddingRows[0].sourceChunkId, sourceChunks[0].id);

const memoryItem = createMemoryItemForSource({ material, course, topicId: topic.id });
state.sourceMaterials.push(material);
state.sourceChunks.push(...sourceChunks);
state.embeddingsMetadata.push(...embeddingRows);
state.memoryItems.push(memoryItem);

const retrieved = retrieveGroundedSources({
  state,
  message: "How do quadratic roots help factoring for exams?",
  topic,
  course,
});
assert(retrieved.chunks.length > 0);
assert.equal(retrieved.chunks[0].sourceMaterialId, material.id);
assert.equal(retrieved.labels[0].type, "uploaded_chunk");
assert.match(retrieved.chunks[0].snippet, /Quadratic roots|Factoring/i);

const answer = answerFromStudentMaterials({
  verb: "Ask",
  message: "How do quadratic roots help factoring for exams?",
  state,
});
assert.equal(answer.grounding.uploadedMaterialUsed, true);
assert(answer.grounding.snippets.length > 0);
assert(answer.sourceLabels.some((label) => label.type === "uploaded_chunk"));

const emptyState = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
emptyState.sourceMaterials = [];
emptyState.sourceChunks = [];
emptyState.memoryItems = [];
const noCitationAnswer = answerFromStudentMaterials({
  verb: "Ask",
  message: "Explain a completely unrelated uploaded chapter",
  state: emptyState,
});
assert.equal(noCitationAnswer.sourceLabels.length, 0);
assert.equal(noCitationAnswer.grounding.uploadedMaterialUsed, false);

material.status = "deleted";
material.deletedAt = new Date().toISOString();
for (const chunk of state.sourceChunks) {
  chunk.status = "deleted";
  chunk.deletedAt = material.deletedAt;
}
for (const item of state.memoryItems) {
  if (item.sourceMaterialIds?.includes(material.id)) {
    item.status = "deleted";
    item.deletedAt = material.deletedAt;
  }
}
const afterDelete = retrieveGroundedSources({
  state,
  message: "quadratic roots",
  topic,
  course,
});
assert.equal(afterDelete.chunks.length, 0);
assert.equal(afterDelete.hasUploadedMaterial, false);

console.log("PASS | StudentOS Pass 6 RAG chunking and retrieval tests passed");
