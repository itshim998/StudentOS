import { ensureLifecycleState, recordLifecycleAudit } from "./lifecycleService.js";
import { isOwnedExportStoragePath } from "./exportService.js";

function nowIso(now = new Date()) {
  return now.toISOString();
}

function isExpired(request, now = new Date()) {
  return Boolean(request?.retentionExpiresAt) &&
    Date.parse(request.retentionExpiresAt) <= now.getTime();
}

export function findExpiredExportRequests(state, now = new Date()) {
  ensureLifecycleState(state);
  return state.dataExportRequests.filter((request) =>
    request.storageBucket &&
    request.storagePath &&
    !request.packageDeletedAt &&
    isExpired(request, now));
}

export async function cleanupExpiredExportPackagesForState({
  state,
  deletePackage,
  now = new Date(),
  limit = 100,
} = {}) {
  ensureLifecycleState(state);
  if (typeof deletePackage !== "function") throw new Error("export_retention_delete_unavailable");
  const cleaned = [];
  const failed = [];
  for (const request of findExpiredExportRequests(state, now).slice(0, limit)) {
    if (!isOwnedExportStoragePath(state.studentProfile.id, request.storagePath)) {
      request.cleanupStatus = "failed";
      request.updatedAt = nowIso(now);
      failed.push({ id: request.id, error: "export_storage_path_not_owned" });
      continue;
    }
    try {
      await deletePackage({ bucket: request.storageBucket, path: request.storagePath });
      Object.assign(request, {
        status: "expired",
        cleanupStatus: "deleted",
        packageDeletedAt: nowIso(now),
        storageBucket: null,
        storagePath: null,
        packageSha256: null,
        updatedAt: nowIso(now),
      });
      recordLifecycleAudit(state, {
        action: "account.data_export.retention_cleaned",
        targetType: "data_export_request",
        targetId: request.id,
        riskLevel: "medium",
        metadata: {
          privateStorageDelete: true,
          exportPackageOnly: true,
          storagePathExposed: false,
        },
        now,
      });
      cleaned.push({ id: request.id, status: request.status });
    } catch {
      request.cleanupStatus = "failed";
      request.updatedAt = nowIso(now);
      failed.push({ id: request.id, error: "export_package_cleanup_failed" });
    }
  }
  return {
    cleaned,
    failed,
    scanned: cleaned.length + failed.length,
    secretsPrinted: false,
  };
}

export async function runExportRetentionCleanup({
  repository,
  config,
  limit = 100,
  now = new Date(),
} = {}) {
  const candidates = await repository.listExpiredExportRequests({ now, limit });
  const cleaned = [];
  const failed = [];
  for (const candidate of candidates) {
    const session = {
      authenticated: config.mode === "supabase",
      mode: config.mode === "supabase" ? "supabase_export_cleanup" : "local_export_cleanup",
      user: { id: candidate.userId, email: "export-cleanup@studentos.local" },
    };
    const state = await repository.loadState(session);
    const result = await cleanupExpiredExportPackagesForState({
      state,
      now,
      limit: 1,
      deletePackage: (storageObject) => repository.deleteExportPackage(session, storageObject),
    });
    await repository.saveDataExportState(session, state);
    cleaned.push(...result.cleaned);
    failed.push(...result.failed);
  }
  return {
    ok: failed.length === 0,
    mode: config.mode,
    cleaned,
    failed,
    scanned: candidates.length,
    secretsPrinted: false,
  };
}
