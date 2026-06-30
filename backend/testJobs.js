import assert from "node:assert/strict";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import {
  createBackgroundJob,
  processBackgroundJob,
  retryFailedJobs,
  summarizeJobsForSource,
} from "./jobs/jobService.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { getSupabaseEnvironment } from "./config/supabaseEnv.js";
import { chunkExtractedText, createSourceChunks } from "./storage/sourceMaterialService.js";

const state = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
state.sourceMaterials = [{
  id: "src_job_test",
  userId: "student_demo_001",
  courseId: "course_alg2",
  title: "Job source",
  sourceType: "uploaded_file",
  status: "indexed",
  extractedText: "Quadratic roots and vertex form are both useful for exam questions.",
  citationLabel: "Job source",
}];
state.sourceChunks = createSourceChunks({
  material: state.sourceMaterials[0],
  chunks: chunkExtractedText(state.sourceMaterials[0].extractedText),
});
state.memoryItems = [];
state.embeddingsMetadata = [];
state.backgroundJobs = [];

const reindexJob = createBackgroundJob({
  userId: state.studentProfile.id,
  sourceId: "src_job_test",
  jobType: "source_reindex",
});
state.backgroundJobs.push(reindexJob);
const reindexResult = await processBackgroundJob({ state, job: reindexJob });
assert.equal(reindexResult.ok, true);
assert.equal(reindexJob.status, "completed");
assert(state.sourceChunks.every((chunk) => chunk.embeddingStatus === "embedded"));
assert.equal(state.embeddingsMetadata.length, state.sourceChunks.length);

const existingChunkCount = state.sourceChunks.length;
const ingestionJob = createBackgroundJob({
  userId: state.studentProfile.id,
  sourceId: "src_job_test",
  jobType: "source_ingestion",
});
const ingestionResult = await processBackgroundJob({ state, job: ingestionJob });
assert.equal(ingestionResult.ok, true);
assert.equal(ingestionResult.result.createdChunks, 0);
assert.equal(state.sourceChunks.length, existingChunkCount);

state.sourceMaterials.push({
  id: "src_missing_text",
  userId: "student_demo_001",
  courseId: "course_alg2",
  title: "Missing text source",
  sourceType: "uploaded_file",
  status: "indexed",
  extractedText: "",
  citationLabel: "Missing text source",
});
const failingJob = createBackgroundJob({
  userId: state.studentProfile.id,
  sourceId: "src_missing_text",
  jobType: "source_ingestion",
  maxAttempts: 2,
});
failingJob.attempts = 1;
const failingResult = await processBackgroundJob({ state, job: failingJob });
assert.equal(failingResult.ok, false);
assert.equal(failingJob.status, "failed");
assert.match(failingJob.lastError, /source_extraction/);
const retried = retryFailedJobs([failingJob]);
assert.equal(retried.length, 0);

const retryableJob = createBackgroundJob({
  userId: state.studentProfile.id,
  sourceId: "src_missing_text",
  jobType: "source_ingestion",
  maxAttempts: 3,
});
retryableJob.status = "failed";
retryableJob.attempts = 1;
const retryable = retryFailedJobs([retryableJob]);
assert.equal(retryable.length, 1);
assert.equal(retryableJob.status, "queued");

const summary = summarizeJobsForSource([reindexJob, failingJob, retryableJob], "src_missing_text");
assert.equal(summary.count, 2);
assert.equal(summary.queued, 1);
assert.equal(summary.failed, 1);

const repository = new StudentOsRepository({
  config: getSupabaseEnvironment({ STUDENTOS_MODE: "mock" }),
  shardClients: [],
});
const session = {
  authenticated: false,
  mode: "local_demo",
  user: { id: "student_demo_001", email: "demo@studentos.local" },
};
const loaded = await repository.loadState(session);
loaded.backgroundJobs.push(createBackgroundJob({
  userId: session.user.id,
  sourceId: "src_mock",
  jobType: "source_reindex",
}));
await repository.saveBackgroundJobs(session, loaded);
const runnable = await repository.listRunnableJobs({ limit: 5 });
assert(runnable.some((job) => job.sourceId === "src_mock"));

console.log("PASS | StudentOS Pass 10 background job reliability tests passed");
