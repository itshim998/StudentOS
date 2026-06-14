import { randomUUID } from "node:crypto";
import {
  chunkExtractedText,
  createEmbeddingMetadataForChunks,
  createMemoryItemForSource,
  createSourceChunks,
  extractSourceText,
} from "../storage/sourceMaterialService.js";
import { reindexSourceChunkEmbeddings } from "../embeddings/embeddingService.js";

export const JOB_STATUSES = Object.freeze(["queued", "processing", "completed", "failed", "cancelled"]);
export const JOB_TYPES = Object.freeze(["source_ingestion", "source_reindex", "embedding_reindex"]);

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
    id: `job_${Date.now()}_${randomUUID().slice(0, 8)}`,
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
  if (material.status === "indexed" && material.extractedText) {
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
  material.chunkCount = (state.sourceChunks || []).filter((chunk) => chunk.sourceMaterialId === material.id && !chunk.deletedAt).length;
  return {
    createdChunks,
    updatedChunks,
    totalChunks: material.chunkCount,
    embeddedChunks: embeddingSummary.embedded,
    reExtracted: extractionResult.reExtracted,
    downloadedBytes: extractionResult.downloadedBytes,
  };
}

async function processReindexJob({ state, job }) {
  const sourceChunks = (state.sourceChunks || [])
    .filter((chunk) => !job.sourceId || chunk.sourceMaterialId === job.sourceId);
  const summary = await reindexSourceChunkEmbeddings({
    sourceChunks,
    limit: Number(job.payload?.limit) || 100,
    includeEmbedded: job.payload?.force === true,
  });
  upsertEmbeddingMetadata(state, sourceChunks.filter((chunk) => summary.chunkIds.includes(chunk.id)));
  return summary;
}

export async function processBackgroundJob({
  state,
  job,
  alreadyClaimed = false,
  downloadSourceBytes = null,
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
      : await processReindexJob({ state, job });
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
    job.status = job.attempts >= Number(job.maxAttempts || 3) ? "failed" : "queued";
    job.updatedAt = nowIso();
    return { ok: false, error: job.lastError, willRetry: job.status === "queued" };
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
