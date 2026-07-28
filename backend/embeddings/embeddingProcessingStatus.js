import { contentHash } from "./embeddingService.js";

const EMBEDDING_JOB_TYPES = new Set(["source_ingestion", "source_reindex", "embedding_reindex"]);
const ACTIVE_JOB_STATUSES = new Set(["queued", "processing"]);
const RETRY_STATUSES = new Set(["degraded_fallback", "failed_embedding", "retry_required"]);

function activeChunks(state, sourceId = null) {
  return (state?.sourceChunks || []).filter((chunk) => {
    if (!chunk || chunk.deletedAt || chunk.status === "deleted") return false;
    return !sourceId || chunk.sourceMaterialId === sourceId || chunk.sourceId === sourceId;
  });
}

function relevantJobs(state, sourceId = null) {
  return (state?.backgroundJobs || [])
    .filter((job) => job && EMBEDDING_JOB_TYPES.has(job.jobType))
    .filter((job) => !sourceId || job.sourceId === sourceId)
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0));
}

function chunkCounts(chunks) {
  let embedded = 0;
  let pending = 0;
  let retryRequired = 0;
  let stale = 0;
  for (const chunk of chunks) {
    const text = chunk.text || chunk.chunkText || "";
    const hashStale = Boolean(text) && chunk.embeddingHash !== contentHash(text);
    const retry = chunk.embeddingRetryRequired === true || RETRY_STATUSES.has(chunk.embeddingStatus);
    const current = chunk.embeddingStatus === "embedded" && Array.isArray(chunk.embeddingVector) && !hashStale && !retry;
    if (current) embedded += 1;
    else pending += 1;
    if (retry) retryRequired += 1;
    if (hashStale) stale += 1;
  }
  return { total: chunks.length, embedded, pending, retryRequired, stale };
}

function statusFor({ material = null, counts, jobs }) {
  const processingJob = jobs.find((job) => job.status === "processing");
  if (processingJob) return "processing";
  const queuedJob = jobs.find((job) => job.status === "queued");
  if (queuedJob) return "queued";
  const latest = jobs[0] || null;
  if (["failed", "cancelled"].includes(latest?.status)) return "needs_attention";
  if (["failed", "needs_ocr", "embedding_failed"].includes(material?.status) || ["failed", "needs_ocr"].includes(material?.extractionStatus)) {
    return "needs_attention";
  }
  if (counts.total > 0 && counts.pending === 0) return "ready";
  if (material?.extractionStatus === "indexed" || material?.status === "indexed") return "awaiting_worker";
  if (material?.status === "processing" || material?.extractionStatus === "queued" || material?.extractionStatus === "extracting") return "queued";
  return counts.pending > 0 ? "awaiting_worker" : "idle";
}

export function buildEmbeddingProcessingStatus(state = {}, { sourceId = null } = {}) {
  const chunks = activeChunks(state, sourceId);
  const jobs = relevantJobs(state, sourceId);
  const counts = chunkCounts(chunks);
  const queuedJobs = jobs.filter((job) => job.status === "queued").length;
  const processingJobs = jobs.filter((job) => job.status === "processing").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const material = sourceId ? (state.sourceMaterials || []).find((source) => source.id === sourceId) || null : null;
  return Object.freeze({
    status: statusFor({ material, counts, jobs }),
    executionBoundary: "background_jobs_only",
    readPathProcessing: false,
    processingPerformed: false,
    totalChunks: counts.total,
    embeddedChunks: counts.embedded,
    pendingChunks: counts.pending,
    retryRequiredChunks: counts.retryRequired,
    staleChunks: counts.stale,
    queuedJobs,
    processingJobs,
    failedJobs,
    activeJobId: jobs.find((job) => ACTIVE_JOB_STATUSES.has(job.status))?.id || null,
    latestJobStatus: jobs[0]?.status || null,
    latestJobType: jobs[0]?.jobType || null,
  });
}

export function buildSourceEmbeddingProcessing(state = {}, source = {}) {
  return buildEmbeddingProcessingStatus(state, { sourceId: source?.id || null });
}
