import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildEmbeddingProcessingStatus, buildSourceEmbeddingProcessing } from "./embeddings/embeddingProcessingStatus.js";
import { processBackgroundJob, queueEmbeddingReindexJob, queueSourceIngestionJob } from "./jobs/jobService.js";
import { STATE_SCOPE_COLLECTIONS } from "./repository/stateScopes.js";

const userId = "student_h03";
const material = {
  id: "source_h03",
  userId,
  courseId: "course_h03",
  title: "H-03 source",
  sourceType: "uploaded_file",
  status: "processing",
  extractionStatus: "indexed",
  extractedText: "Gradient descent updates model parameters in the direction opposite to the gradient.",
  citationLabel: "H-03 source",
  embeddingStatus: "pending_embedding",
};
const state = {
  studentProfile: { id: userId, preferences: {} },
  courses: [{ id: "course_h03", userId, title: "Machine Learning" }],
  sourceMaterials: [material],
  sourceChunks: [],
  memoryItems: [],
  embeddingsMetadata: [],
  backgroundJobs: [],
  jobEvents: [],
  auditLog: [],
};

const before = JSON.stringify(state);
const initialStatus = buildEmbeddingProcessingStatus(state);
assert.equal(initialStatus.processingPerformed, false);
assert.equal(initialStatus.readPathProcessing, false);
assert.equal(initialStatus.executionBoundary, "background_jobs_only");
assert.equal(JSON.stringify(state), before, "status reads must not mutate state");
assert(STATE_SCOPE_COLLECTIONS.recovery.includes("exams"));
assert(STATE_SCOPE_COLLECTIONS.recovery.includes("creditLedger"));
assert(STATE_SCOPE_COLLECTIONS.recovery.includes("billingSubscriptions"));

const firstQueue = queueEmbeddingReindexJob(state, { userId, limit: 25, force: false });
const secondQueue = queueEmbeddingReindexJob(state, { userId, limit: 25, force: false });
assert.equal(firstQueue.job.id, secondQueue.job.id);
assert.equal(secondQueue.reused, true);
assert.equal(state.backgroundJobs.filter((job) => job.jobType === "embedding_reindex").length, 1);

state.backgroundJobs.length = 0;
const ingestion = queueSourceIngestionJob(state, { userId, sourceId: material.id });
assert.equal(ingestion.job.status, "queued");
assert.equal(buildSourceEmbeddingProcessing(state, material).status, "queued");
const result = await processBackgroundJob({ state, job: ingestion.job });
assert.equal(result.ok, true);
assert.equal(ingestion.job.status, "completed");
assert(state.sourceChunks.length > 0);
assert(state.sourceChunks.every((chunk) => chunk.embeddingStatus === "embedded"));
assert.equal(material.embeddingStatus, "embedded");
assert.equal(material.status, "indexed");
assert.equal(buildSourceEmbeddingProcessing(state, material).status, "ready");

const server = await readFile(new URL("./server.js", import.meta.url), "utf8");
const contextBlock = server.slice(server.indexOf("async function getStateContext"), server.indexOf("function publicState"));
assert.doesNotMatch(contextBlock, /embedSourceChunks|reindexSourceChunkEmbeddings|ensureIndexedChunkEmbeddings/);
assert.doesNotMatch(contextBlock, /repository\.(?:save|persist)/);
assert.match(contextBlock, /sideEffectsPerformed: false/);
assert.match(server, /queueSourceIngestionJob/);
assert.match(server, /queueEmbeddingReindexJob/);
assert.doesNotMatch(server, /uploadStage = "chunk_embed"/);
assert.doesNotMatch(server, /await reindexSourceChunkEmbeddings/);

const worker = await readFile(new URL("./jobs/workerRuntime.js", import.meta.url), "utf8");
assert.match(worker, /repository\.loadAcademicContext/);
assert.match(worker, /repository\.loadRecoveryState/);
assert.match(worker, /repository\.saveBackgroundJobs/);
assert.match(worker, /repository\.saveJobQueue/);

const repository = await readFile(new URL("./repository/studentOsRepository.js", import.meta.url), "utf8");
const missingProfileBlock = repository.slice(repository.indexOf("if (!profileRows.length)"), repository.indexOf("const state = {", repository.indexOf("if (!profileRows.length)")));
assert.doesNotMatch(missingProfileBlock, /saveProfile/);
assert.match(repository, /async saveJobQueue/);

const dto = await readFile(new URL("./presentation/publicStudentWorkspaceDto.js", import.meta.url), "utf8");
assert.match(dto, /"embeddingProcessing"/);
const h02Migration = await readFile(new URL("../supabase/migrations/202607280001_h02_narrow_state_repositories.sql", import.meta.url), "utf8");
assert.match(h02Migration, /when 'recovery' then scope_keys := array\[[^\n]*'exams'[^\n]*'creditLedger'[^\n]*'billingSubscriptions'/);

console.log("PASS | H-03 background-only embedding boundary tests passed");
