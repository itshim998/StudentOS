import assert from "node:assert/strict";
import { createSeedState } from "./domain/studentosDomain.js";
import {
  createDataExportWorkflow,
  createDeletionWorkflow,
  getAccountLifecycleConfig,
  getLifecycleSnapshot,
} from "./account/lifecycleService.js";
import {
  authorizeExportDownload,
  buildDataExportPackage,
  buildExportStoragePath,
  getDataExportConfig,
  getPublicDataExportConfig,
  isOwnedExportStoragePath,
  processDataExportJob,
  recordExportDownloaded,
} from "./account/exportService.js";
import { buildDeletionDryRunReport } from "./account/deletionDryRunService.js";
import { runDataExportWorkerOnce } from "./account/exportWorkerRuntime.js";
import { getSupabaseEnvironment } from "./config/supabaseEnv.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";

const now = new Date("2026-05-31T10:00:00+05:30");
const lifecycleConfig = getAccountLifecycleConfig({});
const exportConfig = getDataExportConfig({
  STUDENTOS_EXPORT_STORAGE_BUCKET: "private-account-exports",
  STUDENTOS_EXPORT_DOWNLOAD_EXPIRY_SECONDS: "300",
});
assert.equal(exportConfig.privateBucket, true);
assert.equal(exportConfig.downloadExpirySeconds, 300);
assert.equal(getPublicDataExportConfig(exportConfig).publicLinksEnabled, false);
assert.equal(JSON.stringify(getPublicDataExportConfig(exportConfig)).includes("private-account-exports"), false);

const state = createSeedState(now);
state.sourceMaterials.push({
  id: "source_export_sensitive",
  title: "Private Physics Notes",
  filename: "physics.txt",
  mimeType: "text/plain",
  status: "indexed",
  storageBucket: "private-source-bucket",
  storagePath: "student_demo_001/course/source/physics.txt",
  extractedText: "Raw extracted private text must stay out of export packages.",
});
state.aiMessages = [{
  id: "ai_internal",
  role: "assistant",
  accessToken: "token_should_not_export",
  providerCustomerId: "provider_ref_should_not_export",
}];

const directWorkflow = createDataExportWorkflow(state, {}, lifecycleConfig, now);
const deliveryNow = new Date();
let uploaded = null;
const directResult = await processDataExportJob({
  state,
  job: directWorkflow.job,
  config: exportConfig,
  now: deliveryNow,
  uploadPackage: async (storageObject) => {
    uploaded = storageObject;
  },
});
assert.equal(directResult.ok, true);
assert.equal(directWorkflow.request.status, "ready");
assert.equal(directWorkflow.job.status, "completed");
assert(isOwnedExportStoragePath(state.studentProfile.id, uploaded.path));
assert.equal(uploaded.bucket, "private-account-exports");
const packageText = uploaded.bytes.toString("utf8");
for (const forbidden of [
  "Raw extracted private text",
  "student_demo_001/course/source/physics.txt",
  "private-source-bucket",
  "token_should_not_export",
  "provider_ref_should_not_export",
]) {
  assert.equal(packageText.includes(forbidden), false);
}
const packageObject = JSON.parse(packageText);
assert.equal(packageObject.product, "StudentOS by SentIQ AI Labs");
assert.equal(buildDataExportPackage(state, directWorkflow.request, deliveryNow).data.exportPolicy.secretFieldsExcluded, true);

const lifecycleSnapshot = getLifecycleSnapshot(state, lifecycleConfig);
const safeRequestJson = JSON.stringify(lifecycleSnapshot.exportRequests[0]);
assert.equal(safeRequestJson.includes(uploaded.path), false);
assert.equal(safeRequestJson.includes(uploaded.bucket), false);
assert.equal(safeRequestJson.includes(directWorkflow.request.packageSha256), false);
assert.equal(lifecycleSnapshot.exportRequests[0].downloadAvailable, true);

const authorized = authorizeExportDownload(state, directWorkflow.request.id, deliveryNow);
assert.equal(authorized.id, directWorkflow.request.id);
recordExportDownloaded(state, authorized, deliveryNow);
assert(state.auditLog.some((event) => event.action === "account.data_export.ready"));
assert(state.auditLog.some((event) => event.action === "account.data_export.downloaded"));

const expiredState = createSeedState(now);
const expiredWorkflow = createDataExportWorkflow(expiredState, {}, lifecycleConfig, now);
Object.assign(expiredWorkflow.request, {
  status: "ready",
  storageBucket: "private-account-exports",
  storagePath: buildExportStoragePath(expiredState.studentProfile.id, expiredWorkflow.request.id),
  expiresAt: "2026-05-31T04:29:59.000Z",
});
assert.throws(() => authorizeExportDownload(expiredState, expiredWorkflow.request.id, now), /expired/);
assert.equal(expiredWorkflow.request.status, "expired");

const otherState = createSeedState(now);
otherState.studentProfile.id = "other_student";
assert.throws(() => authorizeExportDownload(otherState, directWorkflow.request.id, now), /not found/);

const deletion = createDeletionWorkflow(state, {}, lifecycleConfig, now);
const sourceCountBeforeDryRun = state.sourceMaterials.length;
const chunkCountBeforeDryRun = (state.sourceChunks || []).length;
const report = buildDeletionDryRunReport(state, deletion.id, now);
assert.equal(report.destructiveActionExecuted, false);
assert.equal(report.finalDeletionEnabled, false);
assert(report.summary.storageObjects >= 2);
assert.equal(state.sourceMaterials.length, sourceCountBeforeDryRun);
assert.equal((state.sourceChunks || []).length, chunkCountBeforeDryRun);
assert.equal(JSON.stringify(report).includes("student_demo_001/course/source/physics.txt"), false);
assert(state.auditLog.some((event) => event.action === "account.deletion.dry_run_generated"));
assert.throws(() => buildDeletionDryRunReport(otherState, deletion.id, now), /not found/);

const mockConfig = getSupabaseEnvironment({ STUDENTOS_MODE: "mock" });
const repository = new StudentOsRepository({ config: mockConfig, shardClients: [] });
const session = {
  authenticated: false,
  mode: "local_demo",
  user: { id: "student_demo_001", email: "demo@studentos.local" },
};
const mockState = await repository.loadState(session);
const workerWorkflow = createDataExportWorkflow(mockState, {}, lifecycleConfig, now);
await repository.saveAccountLifecycle(session, mockState);
const workerRun = await runDataExportWorkerOnce({
  repository,
  config: mockConfig,
  exportConfig,
  limit: 1,
});
assert.equal(workerRun.claimed, 1);
assert.equal(workerRun.processed[0].ok, true);
const readyState = await repository.loadState(session);
const readyRequest = readyState.dataExportRequests.find((item) => item.id === workerWorkflow.request.id);
assert.equal(readyRequest.status, "ready");
const privateDownload = await repository.downloadExportPackage(session, {
  bucket: readyRequest.storageBucket,
  path: readyRequest.storagePath,
});
assert(privateDownload.bytes.length > 0);
await assert.rejects(
  () => repository.downloadExportPackage({
    authenticated: false,
    user: { id: "other_student", email: "other@studentos.local" },
  }, {
    bucket: readyRequest.storageBucket,
    path: readyRequest.storagePath,
  }),
  /not_owned/,
);

console.log("PASS | StudentOS Pass 18 export delivery and deletion dry-run tests passed");
