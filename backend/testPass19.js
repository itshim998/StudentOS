import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import {
  buildInternalOpsSnapshot,
  createDataExportWorkflow,
  createDeletionWorkflow,
  getAccountLifecycleConfig,
} from "./account/lifecycleService.js";
import {
  buildExportStoragePath,
  getDataExportConfig,
  processDataExportJob,
} from "./account/exportService.js";
import { cleanupExpiredExportPackagesForState } from "./account/exportRetentionService.js";
import { buildDeletionDryRunReport } from "./account/deletionDryRunService.js";
import {
  compareDeletionDryRuns,
  recordDeletionApprovalScaffold,
} from "./account/operatorReviewService.js";
import { buildSafeLiveExportSummary } from "../scripts/verifyExportLive.js";

const now = new Date("2026-06-01T10:00:00.000Z");
const config = getAccountLifecycleConfig({});
const exportConfig = getDataExportConfig({
  STUDENTOS_EXPORT_STORAGE_BUCKET: "studentos-data-exports",
  STUDENTOS_EXPORT_DOWNLOAD_EXPIRY_SECONDS: "300",
  STUDENTOS_EXPORT_RETENTION_HOURS: "24",
});
assert.equal(exportConfig.retentionHours, 24);

const state = createSeedState(now);
state.sourceMaterials.push({
  id: "source_keep",
  title: "Keep this private source",
  storageBucket: "studentos-source-materials",
  storagePath: `${state.studentProfile.id}/course/source/notes.txt`,
});
const workflow = createDataExportWorkflow(state, {}, config, now);
let uploaded = null;
await processDataExportJob({
  state,
  job: workflow.job,
  config: exportConfig,
  now,
  uploadPackage: async (storageObject) => {
    uploaded = storageObject;
  },
});
assert.equal(workflow.request.cleanupStatus, "retained");
assert.equal(workflow.request.retentionExpiresAt, "2026-06-02T10:00:00.000Z");

const deleted = [];
const cleanup = await cleanupExpiredExportPackagesForState({
  state,
  now: new Date("2026-06-02T10:00:01.000Z"),
  deletePackage: async (storageObject) => {
    deleted.push(storageObject);
  },
});
assert.equal(cleanup.cleaned.length, 1);
assert.equal(deleted[0].path, uploaded.path);
assert.equal(workflow.request.status, "expired");
assert.equal(workflow.request.cleanupStatus, "deleted");
assert.equal(workflow.request.storagePath, null);
assert.equal(state.sourceMaterials.find((item) => item.id === "source_keep").storagePath.includes("/source/"), true);
assert(state.auditLog.some((event) => event.action === "account.data_export.retention_cleaned"));

const unsafeState = createSeedState(now);
const unsafeWorkflow = createDataExportWorkflow(unsafeState, {}, config, now);
Object.assign(unsafeWorkflow.request, {
  status: "ready",
  storageBucket: "studentos-data-exports",
  storagePath: "other-user/exports/request/studentos-export.json",
  retentionExpiresAt: "2026-06-01T09:00:00.000Z",
});
const unsafeCleanup = await cleanupExpiredExportPackagesForState({
  state: unsafeState,
  now,
  deletePackage: async () => {
    throw new Error("must_not_run");
  },
});
assert.equal(unsafeCleanup.failed[0].error, "export_storage_path_not_owned");

const deletion = createDeletionWorkflow(state, {}, config, now);
const baseline = buildDeletionDryRunReport(state, deletion.id, now);
assert.equal(baseline.diff.baseline, true);
assert.equal(baseline.destructiveActionExecuted, false);
state.notes.push({ id: "note_after_baseline", title: "Added after first preview" });
const second = buildDeletionDryRunReport(state, deletion.id, new Date("2026-06-01T11:00:00.000Z"));
assert.equal(second.diff.baseline, false);
assert.equal(second.diff.changed, true);
assert.equal(second.diff.summaryDelta.databaseRows > 0, true);
assert.equal(compareDeletionDryRuns(baseline, second).changed, true);

assert.throws(
  () => recordDeletionApprovalScaffold(state, deletion.id, { note: "short" }, now),
  /at least 8/,
);
const approval = recordDeletionApprovalScaffold(state, deletion.id, {
  note: "Reviewed dry-run diff; approval scaffold only.",
  operatorId: "operator_test",
}, now);
assert.equal(approval.scaffoldOnly, true);
assert.equal(approval.finalDeletionExecuted, false);
assert.equal(approval.request.finalDeleteAllowed, false);
assert.equal(approval.review.decision, "approve_scaffold");

assert.throws(() => buildInternalOpsSnapshot(state, config), /disabled/);
const internal = buildInternalOpsSnapshot(state, { ...config, internalOpsEnabled: true });
assert.equal(internal.deletionReviews.length >= 3, true);
assert.equal(JSON.stringify(internal).includes("studentos-source-materials"), false);

const safeLive = buildSafeLiveExportSummary({
  route: {
    mode: "supabase",
    index: 2,
    projectNumber: 3,
    label: "data-shard-2",
    expansion: { algorithm: "sha256_modulo", shardCount: 3 },
  },
  requestStatus: "ready",
  privateDownload: true,
  exclusionsVerified: true,
  cleanupVerified: true,
});
assert.equal(safeLive.ok, true);
assert.equal(JSON.stringify(safeLive).includes("service_role"), false);

assert.equal(
  buildExportStoragePath(state.studentProfile.id, "export_safe").startsWith(`${state.studentProfile.id}/exports/`),
  true,
);
const operatorHtml = await readFile(new URL("../frontend/operator.html", import.meta.url), "utf8");
const operatorJs = await readFile(new URL("../frontend/scripts/operator.js", import.meta.url), "utf8");
for (const text of [operatorHtml, operatorJs]) {
  assert.equal(text.includes("service_role"), false);
  assert.equal(text.includes("STUDENTOS_INTERNAL_OPS_TOKEN"), false);
}
assert(operatorHtml.includes("Final account deletion is disabled"));
assert(operatorJs.includes("X-StudentOS-Internal-Token"));

console.log("PASS | StudentOS Pass 19 export retention and operator review tests passed");
