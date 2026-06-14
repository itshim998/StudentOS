import assert from "node:assert/strict";
import { answerFromStudentMaterials, retrieveGroundedSources } from "./domain/studentosDomain.js";
import { getSupabaseEnvironment } from "./config/supabaseEnv.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import {
  createMemoryItemForSource,
  createSafeStoragePath,
  createSourceMaterialRecord,
  extractSourceText,
  MAX_SOURCE_UPLOAD_BYTES,
  validateSourceUpload,
} from "./storage/sourceMaterialService.js";

const valid = validateSourceUpload({
  filename: "quadratics-notes.md",
  mimeType: "text/markdown",
  sizeBytes: 120,
});
assert.equal(valid.ok, true);

const badType = validateSourceUpload({
  filename: "unsafe.exe",
  mimeType: "application/x-msdownload",
  sizeBytes: 120,
});
assert.equal(badType.ok, false);
assert(badType.errors.includes("unsupported_file_type"));

const tooLarge = validateSourceUpload({
  filename: "large.txt",
  mimeType: "text/plain",
  sizeBytes: MAX_SOURCE_UPLOAD_BYTES + 1,
});
assert.equal(tooLarge.ok, false);
assert(tooLarge.errors.includes("file_too_large"));

const path = createSafeStoragePath({
  userId: "00000000-0000-4000-8000-000000000001",
  courseId: "../course_alg2",
  sourceId: "src_upload_test",
  filename: "../Quadratics Notes.md",
});
assert.equal(path.includes(".."), false);
assert.match(path, /^00000000-0000-4000-8000-000000000001\/-course_alg2\/src_upload_test\/Quadratics-Notes.md$/);

const repository = new StudentOsRepository({
  config: getSupabaseEnvironment({ STUDENTOS_MODE: "mock" }),
  shardClients: [],
});
const session = {
  mode: "local_demo",
  authenticated: false,
  user: {
    id: "student_demo_001",
    email: "demo@studentos.local",
  },
};
const state = await repository.loadState(session);
const course = state.courses.find((item) => item.id === "course_alg2");
const extraction = await extractSourceText({
  bytes: Buffer.from("Quadratic equations use roots, factors, and vertex form for exam questions.", "utf8"),
  mimeType: "text/plain",
  filename: "quadratics.txt",
});
assert.equal(extraction.status, "indexed");
assert.match(extraction.extractedText, /Quadratic equations/);

const material = createSourceMaterialRecord({
  session,
  course,
  courseId: course.id,
  title: "Uploaded quadratics notes",
  file: {
    filename: "quadratics.txt",
    mimeType: "text/plain",
    bytes: Buffer.from("Quadratic equations use roots, factors, and vertex form for exam questions.", "utf8"),
  },
  config: {
    storage: {
      bucket: "studentos-source-materials",
    },
  },
  extraction,
});
const memory = createMemoryItemForSource({ material, course, topicId: "topic_quadratics" });
state.sourceMaterials.push(material);
state.memoryItems.push(memory);
await repository.saveSourceIngestion(session, state);

const persisted = await repository.loadState(session);
assert(persisted.sourceMaterials.some((source) => source.id === material.id));
assert(persisted.memoryItems.some((item) => item.id === memory.id));

const retrieved = retrieveGroundedSources({
  state: persisted,
  message: "Explain quadratic roots from uploaded notes",
  topic: persisted.topics.find((topic) => topic.id === "topic_quadratics"),
  course,
});
assert.equal(retrieved.hasUploadedMaterial, true);
assert(retrieved.labels.some((label) => label.type === "uploaded_material" && /Uploaded quadratics notes/.test(label.label)));

const answer = answerFromStudentMaterials({
  verb: "Ask",
  message: "Explain quadratic roots from uploaded notes",
  state: persisted,
});
assert.equal(answer.grounding.uploadedMaterialUsed, true);
assert(answer.sourceLabels.some((label) => label.type === "uploaded_material"));
assert.match(answer.explanation.concept, /Uploaded\/source note/);

const sourceToDelete = persisted.sourceMaterials.find((source) => source.id === material.id);
sourceToDelete.deletedAt = new Date().toISOString();
sourceToDelete.status = "deleted";
for (const item of persisted.memoryItems) {
  if (item.sourceMaterialIds?.includes(material.id)) {
    item.deletedAt = sourceToDelete.deletedAt;
    item.status = "deleted";
  }
}
await repository.saveSourceIngestion(session, persisted);
const afterDelete = await repository.loadState(session);
const deletedRetrieval = retrieveGroundedSources({
  state: afterDelete,
  message: "Explain quadratic roots from uploaded notes",
  topic: afterDelete.topics.find((topic) => topic.id === "topic_quadratics"),
  course,
});
assert.equal(deletedRetrieval.hasUploadedMaterial, false);

console.log("PASS | StudentOS Pass 5 source upload and retrieval tests passed");
