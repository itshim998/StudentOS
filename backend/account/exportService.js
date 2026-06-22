import { createHash } from "node:crypto";
import { buildSafeExportPreview, ensureLifecycleState, recordLifecycleAudit } from "./lifecycleService.js";

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

function readInt(env, key, fallback) {
  const raw = readValue(env, key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function nowIso(now = new Date()) {
  return now.toISOString();
}

function safeError(error) {
  return String(error?.message || error || "export_failed")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .replace(/apikey[A-Za-z0-9._:= -]*/gi, "apikey=[redacted]")
    .slice(0, 180);
}

function safeSegment(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 180);
}

function addSeconds(now, seconds) {
  return new Date(now.getTime() + seconds * 1000);
}

export function getDataExportConfig(env = process.env, supabaseConfig = null) {
  return {
    bucket: readValue(env, "STUDENTOS_EXPORT_STORAGE_BUCKET") ||
      supabaseConfig?.storage?.bucket ||
      readValue(env, "STUDENTOS_STORAGE_BUCKET", "studentos-source-materials"),
    privateBucket: true,
    downloadExpirySeconds: Math.min(3600, Math.max(60, readInt(env, "STUDENTOS_EXPORT_DOWNLOAD_EXPIRY_SECONDS", 900))),
    retentionHours: Math.min(2160, Math.max(1, readInt(env, "STUDENTOS_EXPORT_RETENTION_HOURS", 48))),
    packageFormat: "studentos-json-v1",
    deliveryMode: "authenticated_backend_stream",
  };
}

export function getPublicDataExportConfig(config = getDataExportConfig()) {
  return {
    privateBucket: true,
    bucketConfigured: Boolean(config.bucket),
    downloadExpirySeconds: config.downloadExpirySeconds,
    retentionHours: config.retentionHours,
    packageFormat: config.packageFormat,
    deliveryMode: config.deliveryMode,
    publicLinksEnabled: false,
    secretsExposed: false,
  };
}

export function buildExportStoragePath(userId, requestId) {
  const user = safeSegment(userId);
  const request = safeSegment(requestId);
  if (!user || !request) throw new Error("export_storage_path_requires_user_and_request");
  return `${user}/exports/${request}/studentos-export.json`;
}

export function isOwnedExportStoragePath(userId, path) {
  return String(path || "").startsWith(`${safeSegment(userId)}/exports/`);
}

export function buildDataExportPackage(state, request, now = new Date()) {
  const data = buildSafeExportPreview(state);
  return {
    product: "StudentOS by SentIQ AI Labs",
    format: "studentos-json-v1",
    exportRequestId: request.id,
    exportedAt: nowIso(now),
    ownerUserId: state.studentProfile.id,
    data,
  };
}

export async function processDataExportJob({
  state,
  job,
  config = getDataExportConfig(),
  uploadPackage,
  alreadyClaimed = false,
  now = new Date(),
} = {}) {
  ensureLifecycleState(state);
  const request = state.dataExportRequests.find((item) => item.id === job?.exportRequestId);
  if (!job || !request) throw new Error("export_request_or_job_not_found");
  if (!alreadyClaimed) job.attempts = Number(job.attempts || 0) + 1;
  job.status = "processing";
  job.updatedAt = nowIso(now);
  request.status = "processing";
  request.updatedAt = nowIso(now);
  try {
    const packageObject = buildDataExportPackage(state, request, now);
    const bytes = Buffer.from(`${JSON.stringify(packageObject, null, 2)}\n`, "utf8");
    const path = buildExportStoragePath(state.studentProfile.id, request.id);
    if (typeof uploadPackage !== "function") throw new Error("export_private_storage_upload_unavailable");
    await uploadPackage({
      bucket: config.bucket,
      path,
      bytes,
      mimeType: "application/json; charset=utf-8",
    });
    const readyAt = nowIso(now);
    Object.assign(request, {
      status: "ready",
      delivery: config.deliveryMode,
      storageBucket: config.bucket,
      storagePath: path,
      packageSizeBytes: bytes.length,
      packageSha256: createHash("sha256").update(bytes).digest("hex"),
      readyAt,
      expiresAt: nowIso(addSeconds(now, config.downloadExpirySeconds)),
      retentionExpiresAt: nowIso(addSeconds(now, config.retentionHours * 60 * 60)),
      cleanupStatus: "retained",
      updatedAt: readyAt,
    });
    Object.assign(job, {
      status: "completed",
      lastError: null,
      processedAt: readyAt,
      updatedAt: readyAt,
    });
    recordLifecycleAudit(state, {
      action: "account.data_export.ready",
      targetType: "data_export_request",
      targetId: request.id,
      riskLevel: "medium",
      metadata: {
        packageSizeBytes: bytes.length,
        privateStorage: true,
        storagePathExposed: false,
        expiresAt: request.expiresAt,
      },
      now,
    });
    return { ok: true, request, job, bytesWritten: bytes.length };
  } catch (error) {
    const message = safeError(error);
    const retry = Number(job.attempts || 0) < Number(job.maxAttempts || 3);
    Object.assign(job, {
      status: retry ? "queued" : "failed",
      lastError: message,
      processedAt: nowIso(now),
      updatedAt: nowIso(now),
    });
    Object.assign(request, {
      status: retry ? "queued" : "failed",
      updatedAt: nowIso(now),
    });
    recordLifecycleAudit(state, {
      action: retry ? "account.data_export.retry_queued" : "account.data_export.failed",
      targetType: "data_export_request",
      targetId: request.id,
      riskLevel: "medium",
      metadata: { retry, error: message },
      now,
    });
    return { ok: false, request, job, error: message, willRetry: retry };
  }
}

export function authorizeExportDownload(state, requestId, now = new Date()) {
  ensureLifecycleState(state);
  const request = state.dataExportRequests.find((item) => item.id === requestId);
  if (!request || request.userId !== state.studentProfile.id) {
    const error = new Error("Export package not found");
    error.status = 404;
    throw error;
  }
  if (request.status !== "ready" || !request.storageBucket || !request.storagePath) {
    const error = new Error("Export package is not ready");
    error.status = 409;
    throw error;
  }
  if (!isOwnedExportStoragePath(state.studentProfile.id, request.storagePath)) {
    const error = new Error("Export storage ownership check failed");
    error.status = 403;
    throw error;
  }
  if (request.expiresAt && Date.parse(request.expiresAt) <= now.getTime()) {
    request.status = "expired";
    request.updatedAt = nowIso(now);
    const error = new Error("Export package download window has expired");
    error.status = 410;
    throw error;
  }
  return request;
}

export function recordExportDownloaded(state, request, now = new Date()) {
  request.downloadedAt = nowIso(now);
  request.updatedAt = nowIso(now);
  recordLifecycleAudit(state, {
    action: "account.data_export.downloaded",
    targetType: "data_export_request",
    targetId: request.id,
    riskLevel: "medium",
    metadata: {
      privateBackendStream: true,
      storagePathExposed: false,
    },
    now,
  });
  return request;
}
