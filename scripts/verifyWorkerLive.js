import { randomUUID } from "node:crypto";
import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";
import { StudentOsRepository } from "../backend/repository/studentOsRepository.js";
import { createBackgroundJob } from "../backend/jobs/jobService.js";
import { recordJobEvent, sanitizeLogText } from "../backend/jobs/jobObservability.js";
import { runWorkerOnce } from "../backend/jobs/workerRuntime.js";
import { createSafeStoragePath } from "../backend/storage/sourceMaterialService.js";
import { buildSourceCleanupPlan } from "../backend/storage/sourceCleanupService.js";

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const config = getSupabaseEnvironment();
  assertOk(config.mode === "supabase", "STUDENTOS_MODE must resolve to supabase for live worker verification");
  const clients = createSupabaseClients(config);
  const repository = new StudentOsRepository({
    config,
    shardClients: clients.shardClients,
  });
  const userId = randomUUID();
  const session = {
    authenticated: true,
    mode: "supabase_worker_verify",
    user: { id: userId, email: "worker-verify@studentos.local" },
  };
  const state = await repository.loadState(session);
  const course = state.courses?.[0] || { id: "course_worker_verify", title: "Worker Verification" };
  const sourceId = `src_worker_verify_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const filename = "worker-verification.txt";
  const storagePath = createSafeStoragePath({
    userId,
    courseId: course.id,
    sourceId,
    filename,
  });
  const bytes = Buffer.from("Worker verification source about quadratic functions, embeddings, and retrieval.");
  const material = {
    id: sourceId,
    userId,
    courseId: course.id,
    title: "Worker verification source",
    kind: "uploaded_file",
    sourceType: "uploaded_file",
    filename,
    mimeType: "text/plain",
    sizeBytes: bytes.length,
    storageMode: "private_supabase_storage",
    storageBucket: config.storage.bucket,
    storagePath,
    status: "uploaded",
    extractionStatus: "uploaded",
    extractedText: "",
    citationLabel: "Worker verification source",
    isPrivate: true,
    publicUrlAllowed: false,
    createdAt: new Date().toISOString(),
  };
  await repository.uploadStorageObject(session, {
    bucket: material.storageBucket,
    path: material.storagePath,
    bytes,
    mimeType: material.mimeType,
  });
  const job = createBackgroundJob({
    userId,
    sourceId,
    jobType: "source_ingestion",
    payload: { verification: true },
  });
  state.sourceMaterials.push(material);
  state.backgroundJobs.push(job);
  recordJobEvent(state, {
    job,
    eventType: "queued",
    message: "Live worker verification job queued.",
    metadata: { verification: true },
  });
  await repository.saveSourceIngestion(session, state);

  const workerRun = await runWorkerOnce({
    repository,
    config,
    limit: 1,
    lockTimeoutSeconds: 600,
    workerId: "live-worker-verification",
  });
  assertOk(workerRun.claimed === 1, "Worker did not claim the verification job");

  const verifiedState = await repository.loadState(session);
  const verifiedSource = verifiedState.sourceMaterials.find((source) => source.id === sourceId);
  const chunks = verifiedState.sourceChunks.filter((chunk) => chunk.sourceMaterialId === sourceId && !chunk.deletedAt);
  assertOk(verifiedSource?.status === "indexed", "Verification source was not indexed");
  assertOk(chunks.length > 0, "Verification source did not create chunks");
  assertOk(chunks.some((chunk) => chunk.embeddingStatus === "embedded"), "Verification chunks were not embedded");
  const retrieval = await repository.retrieveGroundedChunks(session, {
    state: verifiedState,
    message: "quadratic functions retrieval",
    course,
    topic: null,
    limit: 3,
  });
  assertOk(retrieval.chunks.some((chunk) => chunk.sourceMaterialId === sourceId), "Retrieval did not return verification chunk");

  const cleanupPlan = buildSourceCleanupPlan(verifiedState, sourceId);
  if (cleanupPlan) await repository.hardDeleteSourceArtifacts(session, cleanupPlan);

  console.log(JSON.stringify({
    ok: true,
    mode: config.mode,
    sourceIndexed: verifiedSource.status,
    chunks: chunks.length,
    retrievalMode: retrieval.retrievalMode,
    cleanupRequested: Boolean(cleanupPlan),
    secretsPrinted: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: sanitizeLogText(error?.message || error),
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
