import { createHash, randomUUID } from "node:crypto";
import {
  chunkExtractedText,
  createEmbeddingMetadataForChunks,
  createMemoryItemForSource,
  createSourceChunks,
  extractSourceText,
} from "../storage/sourceMaterialService.js";
import { reindexSourceChunkEmbeddings } from "../embeddings/embeddingService.js";

export const JOB_STATUSES = Object.freeze(["queued", "processing", "completed", "failed", "cancelled"]);
export const JOB_TYPES = Object.freeze(["source_ingestion", "source_reindex", "embedding_reindex", "recovery_analysis"]);

function nowIso() {
  return new Date().toISOString();
}

function sanitizeJobError(error) {
  return String(error?.message || error || "job_failed")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .replace(/apikey[A-Za-z0-9._:= -]*/gi, "apikey=[redacted]")
    .slice(0, 180);
}

export function createBackgroundJob({
  id = null,
  userId,
  sourceId = null,
  jobType = "source_reindex",
  status = "queued",
  payload = {},
  maxAttempts = 3,
} = {}) {
  if (!userId) throw new Error("background_job_user_required");
  if (!JOB_TYPES.includes(jobType)) throw new Error("unsupported_background_job_type");
  if (!JOB_STATUSES.includes(status)) throw new Error("unsupported_background_job_status");
  const timestamp = nowIso();
  return {
    id: id || `job_${Date.now()}_${randomUUID().slice(0, 8)}`,
    userId,
    sourceId,
    jobType,
    status,
    attempts: 0,
    maxAttempts,
    lastError: null,
    lockedAt: null,
    processedAt: status === "completed" ? timestamp : null,
    payload,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function stableJobId({ userId, sourceId = null, jobType }) {
  const digest = createHash("sha256").update(`${userId}:${jobType}:${sourceId || "all"}`).digest("hex").slice(0, 20);
  return `job_${jobType}_${digest}`;
}

function queueUniqueJob(state, { userId, sourceId = null, jobType, payload = {}, maxAttempts = 3 }) {
  state.backgroundJobs = state.backgroundJobs || [];
  const id = stableJobId({ userId, sourceId, jobType });
  const existing = state.backgroundJobs.find((job) => job.id === id)
    || state.backgroundJobs.find((job) => job.userId === userId && job.sourceId === sourceId && job.jobType === jobType && ["queued", "processing"].includes(job.status));
  if (existing && ["queued", "processing"].includes(existing.status)) {
    return { job: existing, reused: true, requeued: false };
  }
  const timestamp = nowIso();
  if (existing) {
    Object.assign(existing, {
      status: "queued",
      attempts: 0,
      maxAttempts,
      lastError: null,
      lockedAt: null,
      processedAt: null,
      result: null,
      payload: { ...(existing.payload || {}), ...payload },
      updatedAt: timestamp,
    });
    return { job: existing, reused: false, requeued: true };
  }
  const created = createBackgroundJob({ id, userId, sourceId, jobType, payload, maxAttempts });
  state.backgroundJobs.push(created);
  return { job: created, reused: false, requeued: false };
}

export function queueSourceIngestionJob(state, { userId, sourceId, payload = {}, maxAttempts = 3 } = {}) {
  if (!sourceId) throw new Error("source_ingestion_job_source_required");
  return queueUniqueJob(state, { userId, sourceId, jobType: "source_ingestion", payload, maxAttempts });
}

export function queueEmbeddingReindexJob(state, { userId, sourceId = null, limit = 50, force = false, maxAttempts = 3 } = {}) {
  return queueUniqueJob(state, {
    userId,
    sourceId,
    jobType: "embedding_reindex",
    payload: { limit: Math.min(Math.max(Number(limit) || 50, 1), 250), force: force === true },
    maxAttempts,
  });
}

export function summarizeJobsForSource(jobs = [], sourceId) {
  const related = jobs
    .filter((job) => !sourceId || job.sourceId === sourceId)
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || "") - Date.parse(left.updatedAt || left.createdAt || ""));
  return {
    count: related.length,
    latest: related[0] || null,
    queued: related.filter((job) => job.status === "queued").length,
    processing: related.filter((job) => job.status === "processing").length,
    completed: related.filter((job) => job.status === "completed").length,
    failed: related.filter((job) => job.status === "failed").length,
  };
}

function upsertEmbeddingMetadata(state, chunks) {
  const metadataById = new Map((state.embeddingsMetadata || []).map((item) => [item.id, item]));
  for (const row of createEmbeddingMetadataForChunks({
    material: { id: null, userId: state.studentProfile.id },
    sourceChunks: chunks,
  })) {
    const existing = metadataById.get(row.id);
    if (existing) Object.assign(existing, row);
    else state.embeddingsMetadata.push(row);
  }
}

function updateExtractionFields(material, extraction) {
  const timestamp = nowIso();
  material.status = extraction.status;
  material.extractionStatus = extraction.status;
  material.extractedText = extraction.extractedText || "";
  material.extractionSummary = extraction.extractionSummary || null;
  material.extractionError = extraction.extractionError || null;
  material.extractionPages = extraction.extractionPages ?? null;
  material.extractionProvider = extraction.extractionProvider || null;
  material.indexedAt = extraction.status === "indexed" ? timestamp : material.indexedAt || null;
  material.failedAt = extraction.status === "failed" || extraction.status === "needs_ocr" ? timestamp : null;
  material.ocrRequired = extraction.ocrRequired === true || extraction.status === "needs_ocr";
}

async function ensureExtractedText({ material, downloadSourceBytes }) {
  if ((material.extractionStatus === "indexed" || material.status === "indexed") && material.extractedText) {
    return { reExtracted: false, downloadedBytes: 0 };
  }
  if (!downloadSourceBytes || !material.storageBucket || !material.storagePath) {
    throw new Error("source_extraction_unavailable_for_worker");
  }
  material.status = "extracting";
  material.extractionStatus = "extracting";
  material.extractionError = null;
  const download = await downloadSourceBytes(material);
  const bytes = Buffer.from(download?.bytes || download || []);
  if (!bytes.length) throw new Error("source_private_storage_download_empty");
  const extraction = await extractSourceText({
    bytes,
    mimeType: material.mimeType,
    filename: material.filename || material.title,
  });
  updateExtractionFields(material, extraction);
  if (extraction.status !== "indexed" || !extraction.extractedText) {
    throw new Error(`source_reextraction_failed:${extraction.extractionError || "no_text"}`);
  }
  return { reExtracted: true, downloadedBytes: bytes.length };
}

function syncSourceChunks(state, material) {
  const generated = createSourceChunks({
    material,
    chunks: chunkExtractedText(material.extractedText),
  });
  const existingById = new Map((state.sourceChunks || [])
    .filter((chunk) => chunk.sourceMaterialId === material.id)
    .map((chunk) => [chunk.id, chunk]));
  const generatedIds = new Set(generated.map((chunk) => chunk.id));
  const chunksForEmbedding = [];
  let createdChunks = 0;
  let updatedChunks = 0;
  for (const chunk of generated) {
    const existing = existingById.get(chunk.id);
    if (!existing) {
      state.sourceChunks.push(chunk);
      chunksForEmbedding.push(chunk);
      createdChunks += 1;
      continue;
    }
    const textChanged = existing.text !== chunk.text;
    Object.assign(existing, {
      ...chunk,
      createdAt: existing.createdAt || chunk.createdAt,
      embeddingStatus: textChanged ? "pending_embedding" : existing.embeddingStatus || "pending_embedding",
      embeddingProvider: textChanged ? "pending" : existing.embeddingProvider || "pending",
      embeddingModel: textChanged ? "pending" : existing.embeddingModel || "pending",
      embeddingHash: textChanged ? null : existing.embeddingHash || null,
      embeddingDimensions: textChanged ? null : existing.embeddingDimensions ?? null,
      embeddingVector: textChanged ? null : existing.embeddingVector || null,
      embeddingUpdatedAt: textChanged ? null : existing.embeddingUpdatedAt || null,
      embeddingError: textChanged ? null : existing.embeddingError || null,
      deletedAt: null,
    });
    if (textChanged) {
      chunksForEmbedding.push(existing);
      updatedChunks += 1;
    } else if (existing.embeddingStatus !== "embedded") {
      chunksForEmbedding.push(existing);
    }
  }
  for (const chunk of state.sourceChunks || []) {
    if (chunk.sourceMaterialId === material.id && !generatedIds.has(chunk.id) && !chunk.deletedAt) {
      chunk.deletedAt = nowIso();
      chunk.status = "deleted";
      updatedChunks += 1;
    }
  }
  return {
    chunksForEmbedding,
    createdChunks,
    updatedChunks,
  };
}

function upsertMemoryItemForMaterial(state, material) {
  const course = (state.courses || []).find((item) => item.id === material.courseId) || state.courses?.[0];
  const memory = createMemoryItemForSource({ material, course });
  const index = (state.memoryItems || []).findIndex((item) => item.id === memory.id);
  if (index >= 0) {
    state.memoryItems[index] = {
      ...state.memoryItems[index],
      ...memory,
      createdAt: state.memoryItems[index].createdAt || memory.createdAt,
      deletedAt: null,
    };
  } else {
    state.memoryItems.push(memory);
  }
}

async function processSourceIngestionJob({ state, job, downloadSourceBytes }) {
  const material = (state.sourceMaterials || []).find((source) => source.id === job.sourceId && !source.deletedAt);
  if (!material) throw new Error("source_material_not_found");
  const extractionResult = await ensureExtractedText({ material, downloadSourceBytes });
  const { chunksForEmbedding, createdChunks, updatedChunks } = syncSourceChunks(state, material);
  const embeddingSummary = await reindexSourceChunkEmbeddings({ sourceChunks: chunksForEmbedding });
  const activeChunks = (state.sourceChunks || []).filter((chunk) => chunk.sourceMaterialId === material.id && !chunk.deletedAt);
  upsertMemoryItemForMaterial(state, material);
  upsertEmbeddingMetadata(state, activeChunks);
  material.chunkCount = activeChunks.length;
  const result = {
    createdChunks,
    updatedChunks,
    totalChunks: material.chunkCount,
    embeddedChunks: embeddingSummary.embedded,
    degradedChunks: embeddingSummary.degraded,
    retryRequiredChunks: embeddingSummary.retryRequired,
    failedChunks: embeddingSummary.failed,
    reExtracted: extractionResult.reExtracted,
    downloadedBytes: extractionResult.downloadedBytes,
    chunkIds: embeddingSummary.chunkIds,
  };
  material.embeddingStatus = embeddingSummary.retryRequired || embeddingSummary.degraded || embeddingSummary.failed
    ? "retry_required"
    : "embedded";
  material.embeddingError = material.embeddingStatus === "embedded" ? null : "source_embedding_retry_required";
  material.status = material.embeddingStatus === "embedded" ? "indexed" : "processing";
  material.updatedAt = nowIso();
  if (material.embeddingStatus !== "embedded") {
    job.result = result;
    const error = new Error("source_embedding_retry_required");
    error.retryable = true;
    throw error;
  }
  return result;
}

async function processReindexJob({ state, job }) {
  const sourceChunks = (state.sourceChunks || [])
    .filter((chunk) => !job.sourceId || chunk.sourceMaterialId === job.sourceId);
  const summary = await reindexSourceChunkEmbeddings({
    sourceChunks,
    limit: Number(job.payload?.limit) || 100,
    includeEmbedded: job.payload?.force === true,
  });
  const changedChunks = sourceChunks.filter((chunk) => summary.chunkIds.includes(chunk.id));
  upsertEmbeddingMetadata(state, changedChunks);
  const touchedSourceIds = new Set(changedChunks.map((chunk) => chunk.sourceMaterialId).filter(Boolean));
  for (const material of state.sourceMaterials || []) {
    if (!touchedSourceIds.has(material.id)) continue;
    const active = (state.sourceChunks || []).filter((chunk) => chunk.sourceMaterialId === material.id && !chunk.deletedAt && chunk.status !== "deleted");
    const pending = active.filter((chunk) => chunk.embeddingStatus !== "embedded" || chunk.embeddingRetryRequired === true).length;
    material.chunkCount = active.length;
    material.embeddingStatus = pending ? "retry_required" : "embedded";
    material.embeddingError = pending ? "source_embedding_retry_required" : null;
    if (material.extractionStatus === "indexed" || material.extractedText) material.status = pending ? "processing" : "indexed";
    material.updatedAt = nowIso();
  }
  if (summary.retryRequired || summary.degraded || summary.failed) {
    job.result = summary;
    const error = new Error("source_embedding_retry_required");
    error.retryable = true;
    throw error;
  }
  return summary;
}

export async function processBackgroundJob({
  state,
  job,
  alreadyClaimed = false,
  downloadSourceBytes = null,
  processRecovery = null,
} = {}) {
  if (!job || job.status === "cancelled") {
    return { skipped: true, reason: "job_not_runnable" };
  }
  if (!alreadyClaimed) {
    job.attempts = Number(job.attempts || 0) + 1;
    job.lockedAt = nowIso();
  }
  job.status = "processing";
  job.updatedAt = nowIso();
  try {
    const result = job.jobType === "source_ingestion"
      ? await processSourceIngestionJob({ state, job, downloadSourceBytes })
      : job.jobType === "recovery_analysis"
        ? await processRecovery?.({ state, job })
        : await processReindexJob({ state, job });
    if (job.jobType === "recovery_analysis" && typeof processRecovery !== "function") throw new Error("recovery_job_processor_unavailable");
    job.status = "completed";
    job.lastError = null;
    job.processedAt = nowIso();
    job.lockedAt = null;
    job.result = result;
    job.updatedAt = nowIso();
    return { ok: true, result };
  } catch (error) {
    job.lastError = sanitizeJobError(error);
    job.lockedAt = null;
    job.processedAt = nowIso();
    const maxAttempts = Number(job.maxAttempts || 3);
    const retryable = job.jobType === "recovery_analysis" ? error?.retryable === true : error?.retryable !== false;
    const exhausted = retryable && Number(job.attempts || 0) >= maxAttempts;
    job.status = retryable && !exhausted ? "queued" : "failed";
    if (job.jobType !== "recovery_analysis") {
      const touchedIds = new Set([job.sourceId, ...(job.result?.chunkIds || []).map((chunkId) => (state.sourceChunks || []).find((chunk) => chunk.id === chunkId)?.sourceMaterialId)].filter(Boolean));
      for (const material of state.sourceMaterials || []) {
        if (!touchedIds.has(material.id) || material.extractionStatus !== "indexed") continue;
        material.embeddingStatus = exhausted ? "failed" : "retry_required";
        material.embeddingError = job.lastError;
        material.status = exhausted ? "embedding_failed" : "processing";
        material.updatedAt = nowIso();
      }
    }
    job.updatedAt = nowIso();
    return {
      ok: false,
      error: job.lastError,
      retryable,
      exhausted,
      willRetry: job.status === "queued",
    };
  }
}

export function retryFailedJobs(jobs = [], { sourceId = null } = {}) {
  const retried = [];
  for (const job of jobs) {
    if (job.status !== "failed") continue;
    if (sourceId && job.sourceId !== sourceId) continue;
    if (Number(job.attempts || 0) >= Number(job.maxAttempts || 3)) continue;
    job.status = "queued";
    job.lockedAt = null;
    job.processedAt = null;
    job.updatedAt = nowIso();
    retried.push(job);
  }
  return retried;
}
