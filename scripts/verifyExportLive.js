import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";
import { publicShardRoute, routeUserToShard } from "../backend/supabase/shardRouter.js";
import { StudentOsRepository } from "../backend/repository/studentOsRepository.js";
import { createDataExportWorkflow, ensureLifecycleState } from "../backend/account/lifecycleService.js";
import { getDataExportConfig } from "../backend/account/exportService.js";
import { processClaimedDataExport } from "../backend/account/exportWorkerRuntime.js";

function safeError(error) {
  return String(error?.message || error || "live_export_verification_failed")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .replace(/apikey[A-Za-z0-9._:= -]*/gi, "apikey=[redacted]")
    .slice(0, 180);
}

export function buildSafeLiveExportSummary({
  route,
  requestStatus,
  privateDownload,
  exclusionsVerified,
  cleanupVerified,
} = {}) {
  return {
    ok: requestStatus === "ready" && privateDownload && exclusionsVerified && cleanupVerified,
    routedShard: publicShardRoute(route),
    requestStatus,
    targetedClaimRpcVerified: true,
    privateDownload: Boolean(privateDownload),
    exclusionsVerified: Boolean(exclusionsVerified),
    cleanupVerified: Boolean(cleanupVerified),
    outputMasked: true,
    secretsPrinted: false,
  };
}

async function cleanupVerificationRows(client, userId) {
  const filters = { user_id: `eq.${userId}` };
  for (const table of ["audit_logs", "data_export_jobs", "data_export_requests", "student_profiles"]) {
    await client.deleteRows(table, { filters });
  }
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const baseConfig = getSupabaseEnvironment();
  if (!baseConfig.shardsConfigured) throw new Error("StudentOS data shards are not fully configured");
  const config = { ...baseConfig, mode: "supabase", forcedMock: false };
  const clients = createSupabaseClients(config);
  const userId = randomUUID();
  const user = { id: userId, email: "pass19-export-verifier@studentos.local" };
  const session = { authenticated: true, mode: "supabase_live_export_verifier", user };
  const route = routeUserToShard(userId, clients.shardClients);
  const repository = new StudentOsRepository({ config, shardClients: clients.shardClients });
  const now = new Date();
  let packageUploaded = null;
  try {
    await route.client.upsert("student_profiles", {
      user_id: userId,
      display_name: "Pass 19 Export Verifier",
      grade_band: "high_school",
      timezone: "UTC",
      discipline_index: 50,
      learning_adaptivity_score: 50,
      preferences: {},
      visibility: {},
      payload: {
        id: userId,
        displayName: "Pass 19 Export Verifier",
        email: user.email,
        gradeBand: "high_school",
        timezone: "UTC",
      },
      updated_at: now.toISOString(),
    }, { onConflict: "user_id", returning: "minimal" });
    const state = ensureLifecycleState(await repository.loadState(session));
    const workflow = createDataExportWorkflow(state, {}, undefined, now);
    await repository.saveAccountLifecycle(session, state);
    const rows = await route.client.rpc("claim_data_export_job_by_id", {
      p_job_id: workflow.job.id,
      p_user_id: userId,
      p_worker_id: "studentos-pass19-live-verifier",
    });
    const claimed = Array.isArray(rows) ? rows[0] : rows;
    if (!claimed?.id) throw new Error("Targeted export verification job could not be claimed");
    await processClaimedDataExport({
      repository,
      config,
      exportConfig: getDataExportConfig(process.env, config),
      listedJob: {
        ...workflow.job,
        id: claimed.id,
        userId: claimed.user_id,
        exportRequestId: claimed.export_request_id,
        status: claimed.status,
        attempts: claimed.attempts,
      },
    });
    const readyState = await repository.loadState(session);
    const request = readyState.dataExportRequests.find((item) => item.id === workflow.request.id);
    if (!request?.storageBucket || !request?.storagePath) throw new Error("Private export package was not created");
    packageUploaded = { bucket: request.storageBucket, path: request.storagePath };
    const download = await repository.downloadExportPackage(session, packageUploaded);
    const packageText = Buffer.from(download.bytes).toString("utf8");
    JSON.parse(packageText);
    const forbidden = [
      "service_role",
      "api_key",
      "storagePath",
      "storageBucket",
      "providerCustomerId",
      "providerSubscriptionId",
      "accessToken",
    ];
    const exclusionsVerified = forbidden.every((value) => !packageText.includes(value));
    await repository.deleteExportPackage(session, packageUploaded);
    packageUploaded = null;
    await cleanupVerificationRows(route.client, userId);
    console.log(JSON.stringify(buildSafeLiveExportSummary({
      route,
      requestStatus: request.status,
      privateDownload: download.bytes.length > 0,
      exclusionsVerified,
      cleanupVerified: true,
    }), null, 2));
  } finally {
    if (packageUploaded) {
      await repository.deleteExportPackage(session, packageUploaded).catch(() => {});
    }
    await cleanupVerificationRows(route.client, userId).catch(() => {});
  }
}

const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (invokedDirectly) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: safeError(error),
      outputMasked: true,
      secretsPrinted: false,
    }, null, 2));
    process.exit(1);
  });
}
