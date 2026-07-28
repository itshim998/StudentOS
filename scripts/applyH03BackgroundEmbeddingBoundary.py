from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str, flags=0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return updated


# ---------------------------------------------------------------------------
# Pure, read-only embedding processing status.
# ---------------------------------------------------------------------------
status_file = ROOT / "backend/embeddings/embeddingProcessingStatus.js"
status_file.write_text('''import { contentHash } from "./embeddingService.js";

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
''', encoding="utf-8")


# ---------------------------------------------------------------------------
# Background job idempotency and controlled embedding execution.
# ---------------------------------------------------------------------------
job_path = ROOT / "backend/jobs/jobService.js"
job = job_path.read_text(encoding="utf-8")
job = replace_once(job, 'import { randomUUID } from "node:crypto";', 'import { createHash, randomUUID } from "node:crypto";', "job crypto import")
job = replace_once(
    job,
    '''export function createBackgroundJob({
  userId,
  sourceId = null,
  jobType = "source_reindex",
  status = "queued",
  payload = {},
  maxAttempts = 3,
} = {}) {''',
    '''export function createBackgroundJob({
  id = null,
  userId,
  sourceId = null,
  jobType = "source_reindex",
  status = "queued",
  payload = {},
  maxAttempts = 3,
} = {}) {''',
    "background job optional id",
)
job = replace_once(job, '    id: `job_${Date.now()}_${randomUUID().slice(0, 8)}`,', '    id: id || `job_${Date.now()}_${randomUUID().slice(0, 8)}`,', "background job id assignment")
job = replace_once(
    job,
    '''export function summarizeJobsForSource(jobs = [], sourceId) {''',
    '''function stableJobId({ userId, sourceId = null, jobType }) {
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

export function summarizeJobsForSource(jobs = [], sourceId) {''',
    "job queue helpers",
)
job = replace_once(
    job,
    '''  if (material.status === "indexed" && material.extractedText) {
    return { reExtracted: false, downloadedBytes: 0 };
  }''',
    '''  if ((material.extractionStatus === "indexed" || material.status === "indexed") && material.extractedText) {
    return { reExtracted: false, downloadedBytes: 0 };
  }''',
    "worker extraction readiness",
)
job = replace_once(
    job,
    '''  const embeddingSummary = await reindexSourceChunkEmbeddings({ sourceChunks: chunksForEmbedding });
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
  };''',
    '''  const embeddingSummary = await reindexSourceChunkEmbeddings({ sourceChunks: chunksForEmbedding });
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
  return result;''',
    "source ingestion embedding outcome",
)
job = replace_once(
    job,
    '''  upsertEmbeddingMetadata(state, sourceChunks.filter((chunk) => summary.chunkIds.includes(chunk.id)));
  return summary;''',
    '''  const changedChunks = sourceChunks.filter((chunk) => summary.chunkIds.includes(chunk.id));
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
  return summary;''',
    "reindex job embedding outcome",
)
job = replace_once(
    job,
    '''    const maxAttempts = Number(job.maxAttempts || 3);
    const retryable = job.jobType === "recovery_analysis" ? error?.retryable === true : true;
    const exhausted = retryable && Number(job.attempts || 0) >= maxAttempts;
    job.status = retryable && !exhausted ? "queued" : "failed";
    job.updatedAt = nowIso();''',
    '''    const maxAttempts = Number(job.maxAttempts || 3);
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
    job.updatedAt = nowIso();''',
    "job failure material status",
)
job_path.write_text(job, encoding="utf-8")


# ---------------------------------------------------------------------------
# Repository read purity and narrow job persistence.
# ---------------------------------------------------------------------------
repo_path = ROOT / "backend/repository/studentOsRepository.js"
repo = repo_path.read_text(encoding="utf-8")
repo = replace_once(
    repo,
    '''  async loadState(session) {
    const user = session?.user || { id: "student_local_001" };
    if (!this.states.has(user.id)) {
      this.states.set(user.id, ensureStateShape(initialStateForUser(user)));
    }
    const state = clone(this.states.get(user.id));
    return markRecoveryPersistenceVersion(state);
  }''',
    '''  async loadState(session) {
    const user = session?.user || { id: "student_local_001" };
    const stored = this.states.get(user.id);
    const state = stored ? clone(stored) : ensureStateShape(initialStateForUser(user));
    return markRecoveryPersistenceVersion(state);
  }''',
    "mock read purity",
)
repo = replace_once(
    repo,
    '''  async saveBackgroundJobs(session, state) {
    await this.saveState(session, state);
  }

  async saveAccountLifecycle(session, state) {''',
    '''  async saveJobQueue(session, state) {
    const userId = session?.user?.id || state.studentProfile.id;
    const current = ensureStateShape(clone(this.states.get(userId) || initialStateForUser(session?.user || { id: userId })));
    current.backgroundJobs = clone(state.backgroundJobs || []);
    current.jobEvents = clone(state.jobEvents || []);
    this.states.set(userId, current);
  }

  async saveBackgroundJobs(session, state) {
    await this.saveState(session, state);
  }

  async saveAccountLifecycle(session, state) {''',
    "mock job queue persistence",
)
repo = replace_once(
    repo,
    '''    if (!profileRows.length) {
      const initialState = ensureStateShape(initialStateForUser(user));
      await this.saveProfile(session, initialState);
      return markRecoveryPersistenceVersion(scopedClone(initialState, normalizedScope, entityId));
    }''',
    '''    if (!profileRows.length) {
      const initialState = ensureStateShape(initialStateForUser(user));
      return markRecoveryPersistenceVersion(scopedClone(initialState, normalizedScope, entityId));
    }''',
    "supabase read purity",
)
repo = replace_once(
    repo,
    '''  async saveBackgroundJobs(session, state) {
    await this.saveChangedCollections(session, state, ["backgroundJobs", "jobEvents", "sourceChunks", "embeddingsMetadata", "sourceMaterials", "memoryItems", "auditLog"]);
  }

  async saveAccountLifecycle(session, state) {''',
    '''  async saveJobQueue(session, state) {
    await this.saveChangedCollections(session, state, ["backgroundJobs", "jobEvents"]);
  }

  async saveBackgroundJobs(session, state) {
    await this.saveChangedCollections(session, state, ["backgroundJobs", "jobEvents", "sourceChunks", "embeddingsMetadata", "sourceMaterials", "memoryItems", "auditLog"]);
  }

  async saveAccountLifecycle(session, state) {''',
    "supabase job queue persistence",
)
repo = replace_once(
    repo,
    '''  async saveBackgroundJobs(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveBackgroundJobs(session, state)
      : this.mock.saveBackgroundJobs(session, state);
  }

  async saveAccountLifecycle(session, state) {''',
    '''  async saveJobQueue(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveJobQueue(session, state)
      : this.mock.saveJobQueue(session, state);
  }

  async saveBackgroundJobs(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveBackgroundJobs(session, state)
      : this.mock.saveBackgroundJobs(session, state);
  }

  async saveAccountLifecycle(session, state) {''',
    "repository job queue wrapper",
)
repo_path.write_text(repo, encoding="utf-8")


# ---------------------------------------------------------------------------
# Worker owns document/chunk embedding execution and persists its outputs.
# ---------------------------------------------------------------------------
worker_path = ROOT / "backend/jobs/workerRuntime.js"
worker = worker_path.read_text(encoding="utf-8")
worker = replace_once(
    worker,
    '''  const session = sessionForJob(config, listedJob);
  const state = await repository.loadState(session);''',
    '''  const session = sessionForJob(config, listedJob);
  const state = listedJob.jobType === "recovery_analysis"
    ? await repository.loadRecoveryState(session)
    : await repository.loadAcademicContext(session);''',
    "worker scoped state load",
)
worker = replace_once(
    worker,
    '''  await repository.saveBackgroundJobForUser(session.user, job, state);''',
    '''  if (job.jobType === "recovery_analysis") await repository.saveJobQueue(session, state);
  else await repository.saveBackgroundJobs(session, state);''',
    "worker controlled persistence",
)
worker_path.write_text(worker, encoding="utf-8")


# ---------------------------------------------------------------------------
# Public DTO reports processing without exposing vectors.
# ---------------------------------------------------------------------------
dto_path = ROOT / "backend/presentation/publicStudentWorkspaceDto.js"
dto = dto_path.read_text(encoding="utf-8")
dto = replace_once(dto, '  "queueHealth",\n', '  "queueHealth",\n  "embeddingProcessing",\n', "public embedding processing key")
dto_path.write_text(dto, encoding="utf-8")


# ---------------------------------------------------------------------------
# Server: common reads are side-effect-free; upload/reindex only enqueue jobs.
# ---------------------------------------------------------------------------
server_path = ROOT / "backend/server.js"
server = server_path.read_text(encoding="utf-8")
server = replace_once(
    server,
    '''import {
  contentHash,
  embedSourceChunks,
  getEmbeddingConfig,
  getSafeEmbeddingStatus,
  reindexSourceChunkEmbeddings,
} from "./embeddings/embeddingService.js";''',
    '''import {
  getEmbeddingConfig,
  getSafeEmbeddingStatus,
} from "./embeddings/embeddingService.js";
import {
  buildEmbeddingProcessingStatus,
  buildSourceEmbeddingProcessing,
} from "./embeddings/embeddingProcessingStatus.js";''',
    "server embedding imports",
)
server = replace_once(
    server,
    '''import {
  createBackgroundJob,
  retryFailedJobs,
  summarizeJobsForSource,
} from "./jobs/jobService.js";''',
    '''import {
  createBackgroundJob,
  queueEmbeddingReindexJob,
  queueSourceIngestionJob,
  retryFailedJobs,
  summarizeJobsForSource,
} from "./jobs/jobService.js";''',
    "server job imports",
)
server = replace_once(
    server,
    '''import {
  createMemoryItemForSource,
  createEmbeddingMetadataForChunks,
  createSourceMaterialRecord,
  createSourceChunks,
  chunkExtractedText,
  extractSourceText,
  MAX_SOURCE_UPLOAD_BYTES,
  validateAcademicContextPdfUpload,
} from "./storage/sourceMaterialService.js";''',
    '''import {
  createSourceMaterialRecord,
  MAX_SOURCE_UPLOAD_BYTES,
  validateAcademicContextPdfUpload,
} from "./storage/sourceMaterialService.js";''',
    "server source imports",
)
server = regex_once(
    server,
    r'''async function getStateContext\(req, \{ scope = null, entityId = null \} = \{\}\) \{.*?\n\}\n\nasync function ensureIndexedChunkEmbeddings\(session, state\) \{.*?\n\}\n''',
    '''async function getStateContext(req, { scope = null, entityId = null } = {}) {
  const session = await getRequestSession(req, {
    config: supabaseConfig,
    authClient: supabaseClients.authClient,
  });
  const resolvedScope = scope || requestStateScope(req);
  const state = await loadRequestState(session, resolvedScope, entityId);
  const onboardingHydrationPending = hydrateSavedProductOnboarding(state);
  return {
    session,
    state,
    stateScope: resolvedScope,
    readStatus: {
      sideEffectsPerformed: false,
      embeddingBackfillPerformed: false,
      onboardingHydrationPending,
    },
    persistence: repository.getInfo(session),
  };
}
''',
    "side-effect-free state context",
    flags=re.S,
)
server = replace_once(
    server,
    '''  const dueWork = getClassroomDueWork(state, {
    includeDiscoveredReview: classroomPolicy.courseworkReviewEnabled === true && classroomPolicy.autoCheckEnabled === true,
  });''',
    '''  const dueWork = getClassroomDueWork(state, {
    includeDiscoveredReview: classroomPolicy.courseworkReviewEnabled === true && classroomPolicy.autoCheckEnabled === true,
  });
  const embeddingProcessing = buildEmbeddingProcessingStatus(state);''',
    "public embedding status setup",
)
server = replace_once(
    server,
    '''      return {
        ...safeSource,
        isPrivate: Boolean(storageBucket || storagePath),
        readyForStudy: source.status === "indexed" || source.status === "ready" || Number(chunkCount || 0) > 0,
        extractedSnippet: extractedText ? String(extractedText).slice(0, 180) : "",
      };''',
    '''      const processing = buildSourceEmbeddingProcessing(state, source);
      return {
        ...safeSource,
        isPrivate: Boolean(storageBucket || storagePath),
        readyForStudy: processing.status === "ready",
        processing,
        extractedSnippet: extractedText ? String(extractedText).slice(0, 180) : "",
      };''',
    "source processing status",
)
server = replace_once(server, '    queueHealth: buildQueueHealth(state.backgroundJobs || []),\n', '    queueHealth: buildQueueHealth(state.backgroundJobs || []),\n    embeddingProcessing,\n', "public processing summary")

old_reindex = '''  if (req.method === "POST" && url.pathname === "/api/embeddings/reindex") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    requireUploadSession(session);
    const summary = await reindexSourceChunkEmbeddings({
      sourceChunks: state.sourceChunks,
      limit: Math.min(Number(body.limit) || 50, 250),
      includeEmbedded: body.force === true,
    });
    const metadataById = new Map((state.embeddingsMetadata || []).map((item) => [item.id, item]));
    for (const row of createEmbeddingMetadataForChunks({
      material: { id: null, userId: state.studentProfile.id },
      sourceChunks: state.sourceChunks.filter((chunk) => summary.chunkIds.includes(chunk.id)),
    })) {
      const existing = metadataById.get(row.id);
      if (existing) Object.assign(existing, row);
      else state.embeddingsMetadata.push(row);
    }
    state.auditLog.push({
      id: `audit_reindex_${Date.now()}`,
      actorId: state.studentProfile.id,
      action: "source_embeddings.reindexed",
      targetType: "source_chunks",
      riskLevel: "low",
      metadata: {
        selected: summary.selected,
        embedded: summary.embedded,
        failed: summary.failed,
        mode: summary.mode,
      },
      createdAt: new Date().toISOString(),
    });
    await repository.saveSourceIngestion(session, state);
    sendJson(res, 200, {
      summary,
      retrievalModeStatus: publicRetrievalStatus(repository.getInfo(session)),
      secretsPrinted: false,
    });
    return;
  }'''
new_reindex = '''  if (req.method === "POST" && url.pathname === "/api/embeddings/reindex") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    requireUploadSession(session);
    const queued = queueEmbeddingReindexJob(state, {
      userId: session.user.id,
      sourceId: body.sourceId || null,
      limit: Math.min(Number(body.limit) || 50, 250),
      force: body.force === true,
    });
    if (!queued.reused) {
      recordJobEvent(state, {
        job: queued.job,
        eventType: queued.requeued ? "retry" : "queued",
        message: queued.requeued ? "Embedding reindex job returned to the worker queue." : "Embedding reindex job queued for background processing.",
        metadata: { sourceId: queued.job.sourceId, force: queued.job.payload?.force === true },
      });
      await repository.saveJobQueue(session, state);
    }
    sendJson(res, 200, {
      queued: true,
      reused: queued.reused,
      requeued: queued.requeued,
      job: {
        id: queued.job.id,
        sourceId: queued.job.sourceId,
        jobType: queued.job.jobType,
        status: queued.job.status,
        attempts: queued.job.attempts,
      },
      embeddingProcessing: buildEmbeddingProcessingStatus(state, { sourceId: queued.job.sourceId }),
      retrievalModeStatus: publicRetrievalStatus(repository.getInfo(session)),
      secretsPrinted: false,
    });
    return;
  }'''
server = replace_once(server, old_reindex, new_reindex, "queue-only reindex endpoint")
server = replace_once(server, '    await repository.saveBackgroundJobs(session, state);\n    sendJson(res, 200, {\n      retried:', '    await repository.saveJobQueue(session, state);\n    sendJson(res, 200, {\n      retried:', "narrow retry persistence")
server = replace_once(
    server,
    '''    sendJson(res, 200, {
      queueHealth: buildQueueHealth(state.backgroundJobs || []),
      retrievalModeStatus: publicRetrievalStatus(repository.getInfo(session)),''',
    '''    sendJson(res, 200, {
      queueHealth: buildQueueHealth(state.backgroundJobs || []),
      embeddingProcessing: buildEmbeddingProcessingStatus(state),
      retrievalModeStatus: publicRetrievalStatus(repository.getInfo(session)),''',
    "job health processing status",
)
server = replace_once(
    server,
    '''      storagePlan: getSourceStoragePlan(supabaseConfig),
    });''',
    '''      embeddingProcessing: buildEmbeddingProcessingStatus(state),
      storagePlan: getSourceStoragePlan(supabaseConfig),
    });''',
    "source status processing summary",
)

upload_pattern = r'''      uploadStage = "text_extraction";.*?      recordJobEvent\(state, \{\n        job: completedUploadJob,\n        eventType: material\.status === "indexed" \? "completed" : "failed",.*?      \}\);'''
upload_replacement = '''      const material = createSourceMaterialRecord({
        session,
        course,
        courseId: course?.id || null,
        title: contract.title,
        file: {
          ...file,
          filename: validation.filename,
          mimeType: validation.mimeType,
        },
        config: supabaseConfig,
        extraction: {
          status: "queued",
          extractedText: "",
          extractionSummary: "Stored privately. StudentOS is processing this material in the background.",
          extractionError: null,
          extractionPages: null,
          extractionProvider: null,
        },
        artifactKind: contract.kind,
        contextKind: contract.kind === "material" ? "study_material" : contract.kind,
      });
      uploadStage = "storage_upload";
      await runUploadStage(req, uploadStage, () => repository.uploadStorageObject(session, {
        bucket: material.storageBucket,
        path: material.storagePath,
        bytes: file.bytes,
        mimeType: material.mimeType,
      }), {
        timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
      });

      material.status = "processing";
      material.extractionStatus = "queued";
      material.embeddingStatus = "pending_embedding";
      material.chunkCount = 0;
      material.indexedAt = null;
      material.failedAt = null;
      const sourceChunks = [];
      const memoryItem = null;
      const { assignment, syllabus } = linkManualAcademicContextUpload(state, material, contract);
      state.sourceMaterials.push(material);
      markAcademicContextNeedsPreparation(state, `${contract.kind}_uploaded`);
      const queuedUpload = queueSourceIngestionJob(state, {
        userId: session.user.id,
        sourceId: material.id,
        payload: {
          filename: material.filename,
          mimeType: material.mimeType,
          storageBucket: material.storageBucket,
          storagePath: material.storagePath,
        },
      });
      const ingestionJob = queuedUpload.job;
      recordJobEvent(state, {
        job: ingestionJob,
        eventType: "queued",
        message: "Source ingestion queued for background extraction, chunking, and embedding.",
        metadata: { immediate: false, sourceId: material.id },
      });'''
server = regex_once(server, upload_pattern, upload_replacement, "background-only source ingestion", flags=re.S)
server = replace_once(server, '          status: material.status,\n          chunkCount: material.chunkCount,', '          status: material.status,\n          processing: buildSourceEmbeddingProcessing(state, material),\n          chunkCount: material.chunkCount,', "upload material processing response")
server = replace_once(server, '        status: material.status,\n        chunkCount: material.chunkCount,', '        status: material.status,\n        processing: buildSourceEmbeddingProcessing(state, material),\n        ingestionJob: { id: ingestionJob.id, status: ingestionJob.status, jobType: ingestionJob.jobType },\n        chunkCount: material.chunkCount,', "upload processing response")
server_path.write_text(server, encoding="utf-8")


# ---------------------------------------------------------------------------
# Focused regression tests.
# ---------------------------------------------------------------------------
test_path = ROOT / "backend/testH03BackgroundEmbeddings.js"
test_path.write_text('''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildEmbeddingProcessingStatus, buildSourceEmbeddingProcessing } from "./embeddings/embeddingProcessingStatus.js";
import { processBackgroundJob, queueEmbeddingReindexJob, queueSourceIngestionJob } from "./jobs/jobService.js";

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
assert.doesNotMatch(contextBlock, /repository\\.(?:save|persist)/);
assert.match(contextBlock, /sideEffectsPerformed: false/);
assert.match(server, /queueSourceIngestionJob/);
assert.match(server, /queueEmbeddingReindexJob/);
assert.doesNotMatch(server, /uploadStage = "chunk_embed"/);
assert.doesNotMatch(server, /await reindexSourceChunkEmbeddings/);

const worker = await readFile(new URL("./jobs/workerRuntime.js", import.meta.url), "utf8");
assert.match(worker, /repository\\.loadAcademicContext/);
assert.match(worker, /repository\\.loadRecoveryState/);
assert.match(worker, /repository\\.saveBackgroundJobs/);
assert.match(worker, /repository\\.saveJobQueue/);

const repository = await readFile(new URL("./repository/studentOsRepository.js", import.meta.url), "utf8");
const missingProfileBlock = repository.slice(repository.indexOf("if (!profileRows.length)"), repository.indexOf("const state = {", repository.indexOf("if (!profileRows.length)")));
assert.doesNotMatch(missingProfileBlock, /saveProfile/);
assert.match(repository, /async saveJobQueue/);

const dto = await readFile(new URL("./presentation/publicStudentWorkspaceDto.js", import.meta.url), "utf8");
assert.match(dto, /"embeddingProcessing"/);

console.log("PASS | H-03 background-only embedding boundary tests passed");
''', encoding="utf-8")


# ---------------------------------------------------------------------------
# Package scripts and documentation.
# ---------------------------------------------------------------------------
package_path = ROOT / "package.json"
package_data = json.loads(package_path.read_text(encoding="utf-8"))
scripts = package_data["scripts"]
scripts["test:h03-background-embeddings"] = "node backend/testH03BackgroundEmbeddings.js"
needle = "npm run test:h02-state-repositories &&"
if needle not in scripts["test"]:
    raise RuntimeError("package test chain missing H-02 anchor")
scripts["test"] = scripts["test"].replace(needle, f"{needle} npm run test:h03-background-embeddings &&", 1)
package_path.write_text(json.dumps(package_data, indent=2) + "\n", encoding="utf-8")

doc_path = ROOT / "docs/H03_BACKGROUND_EMBEDDING_BOUNDARY.md"
doc_path.write_text('''# H-03 background embedding boundary

Document and chunk embeddings are no longer generated or repaired while ordinary API state is being loaded.

## Execution boundary

Persisted document embeddings may be created or changed only by the background worker while processing:

- `source_ingestion` jobs;
- explicit `embedding_reindex` or `source_reindex` jobs;
- a separately controlled recovery job if a future recovery policy explicitly schedules one.

Ephemeral query vectors used by an intentional Ask StudentOS retrieval request are not persistence backfills. They are never written to source chunks or embedding metadata.

## Read behaviour

`getStateContext()` authenticates and loads the selected repository scope. It does not call an embedding provider and does not persist onboarding compatibility hydration. A missing profile is returned as an initial in-memory state and is first persisted by an explicit mutation.

Public workspace and source-status responses expose a read-only `embeddingProcessing` summary and per-source `processing` status. These values report queued, processing, awaiting-worker, ready, or needs-attention states without doing the work.

## Upload and reindex behaviour

Upload requests validate the file, store it privately, create the source record and enqueue one deterministic `source_ingestion` job. Extraction, chunking, embedding and embedding-metadata persistence happen in the worker.

`POST /api/embeddings/reindex` only creates or reuses one deterministic `embedding_reindex` job. Concurrent or repeated requests for the same scope converge on the same job ID instead of duplicating provider work.

## Persistence

The worker loads only academic-context state for ingestion and reindex work, or recovery state for recovery work. Source/chunk/metadata/job results are persisted through the H-02 transactional state-patch boundary. Queue-only changes use a narrow background-jobs and job-events patch.
''', encoding="utf-8")

print("Applied H-03 background embedding boundary remediation")
