import assert from "node:assert/strict";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import { createBackgroundJob } from "./jobs/jobService.js";
import {
  buildQueueHealth,
  recordJobEvent,
  sanitizeLogText,
} from "./jobs/jobObservability.js";
import { runWorkerDaemon } from "./jobs/workerRuntime.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { getSupabaseEnvironment } from "./config/supabaseEnv.js";
import {
  buildSourceCleanupPlan,
  hardDeleteSourceState,
} from "./storage/sourceCleanupService.js";
import {
  chunkExtractedText,
  createEmbeddingMetadataForChunks,
  createMemoryItemForSource,
  createSourceChunks,
  needsOcrForPdfText,
} from "./storage/sourceMaterialService.js";

assert.equal(sanitizeLogText("Bearer abcdef12345 api_key: secret service_role_key=private").includes("abcdef12345"), false);
assert.equal(sanitizeLogText("Bearer abcdef12345 api_key: secret service_role_key=private").includes("secret"), false);

const state = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
state.jobEvents = [];
const job = createBackgroundJob({
  userId: state.studentProfile.id,
  sourceId: "src_obs",
  jobType: "source_reindex",
});
recordJobEvent(state, {
  job,
  eventType: "failed",
  severity: "warn",
  message: "Failure included Bearer abcdef12345",
  metadata: { apiKey: "secret-value", note: "apikey=another-secret" },
});
assert.equal(state.jobEvents.length, 1);
assert.equal(JSON.stringify(state.jobEvents[0]).includes("abcdef12345"), false);
assert.equal(JSON.stringify(state.jobEvents[0]).includes("secret-value"), false);

const health = buildQueueHealth([
  {
    ...job,
    status: "processing",
    lockedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  },
  {
    ...createBackgroundJob({ userId: state.studentProfile.id, sourceId: "src_failed", jobType: "source_reindex" }),
    status: "failed",
    lastError: "source_private_storage_download_empty",
  },
], { stuckTimeoutSeconds: 60 });
assert.equal(health.counts.processing, 1);
assert.equal(health.stuckJobsCount, 1);
assert.equal(health.failedReasons.source_private_storage_download_empty, 1);

const cleanupState = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
const material = {
  id: "src_cleanup",
  userId: cleanupState.studentProfile.id,
  courseId: "course_alg2",
  title: "Cleanup source",
  filename: "cleanup.txt",
  mimeType: "text/plain",
  sourceType: "uploaded_file",
  status: "indexed",
  extractedText: "Cleanup source text about derivatives and quadratic review.",
  citationLabel: "Cleanup source",
  storageBucket: "studentos-private-sources",
  storagePath: "student_demo_001/course_alg2/src_cleanup/cleanup.txt",
};
cleanupState.sourceMaterials = [material];
cleanupState.sourceChunks = createSourceChunks({
  material,
  chunks: chunkExtractedText(material.extractedText),
});
cleanupState.memoryItems = [createMemoryItemForSource({ material, course: cleanupState.courses[0] })];
cleanupState.embeddingsMetadata = createEmbeddingMetadataForChunks({
  material,
  sourceChunks: cleanupState.sourceChunks,
});
cleanupState.backgroundJobs = [createBackgroundJob({
  userId: cleanupState.studentProfile.id,
  sourceId: material.id,
  jobType: "source_reindex",
})];
cleanupState.jobEvents = [];
recordJobEvent(cleanupState, {
  job: cleanupState.backgroundJobs[0],
  eventType: "queued",
  message: "Queued for cleanup test.",
});
const plan = buildSourceCleanupPlan(cleanupState, material.id);
assert.equal(plan.sourceChunkIds.length, 1);
assert.equal(plan.memoryItemIds.length, 1);
assert.equal(plan.embeddingIds.length, 1);
assert.equal(plan.jobIds.length, 1);
assert.equal(plan.jobEventIds.length, 1);
hardDeleteSourceState(cleanupState, material.id);
assert.equal(cleanupState.sourceMaterials.length, 0);
assert.equal(cleanupState.sourceChunks.length, 0);
assert.equal(cleanupState.memoryItems.length, 0);
assert.equal(cleanupState.embeddingsMetadata.length, 0);
assert.equal(cleanupState.backgroundJobs.length, 0);
assert.equal(cleanupState.jobEvents.length, 0);

assert.equal(needsOcrForPdfText(""), true);
assert.equal(needsOcrForPdfText("tiny"), true);
assert.equal(needsOcrForPdfText("This PDF has enough selectable academic text for normal extraction."), false);

const repository = new StudentOsRepository({
  config: getSupabaseEnvironment({ STUDENTOS_MODE: "mock" }),
  shardClients: [],
});
const session = {
  authenticated: false,
  mode: "local_demo",
  user: { id: "student_demo_001", email: "demo@studentos.local" },
};
const daemonState = await repository.loadState(session);
daemonState.backgroundJobs = [];
await repository.saveBackgroundJobs(session, daemonState);
const logs = [];
const daemonResult = await runWorkerDaemon({
  repository,
  config: getSupabaseEnvironment({ STUDENTOS_MODE: "mock" }),
  maxLoops: 1,
  intervalMs: 250,
  logger: { log: (line) => logs.push(line) },
});
assert.equal(daemonResult.ok, true);
assert.equal(daemonResult.loops, 1);
assert.equal(daemonResult.claimed, 0);
assert.equal(logs.length, 1);
assert.equal(JSON.stringify(logs).includes("abcdef12345"), false);
assert.equal(JSON.stringify(logs).includes("secret-value"), false);

console.log("PASS | StudentOS Pass 12 worker operations tests passed");
