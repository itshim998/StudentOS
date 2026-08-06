import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";

const ACTIVE_RUN_FILTER = "in.(building_state,reasoning,validating,planning)";
const DEFAULT_STALE_JOB_SECONDS = 600;

function safeError(error) {
  return String(error?.message || error || "Unknown error")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted.jwt]")
    .replace(/service[_-]?role[A-Za-z0-9._-]*/gi, "[redacted.service-role]")
    .replace(/apikey[A-Za-z0-9._:= -]*/gi, "apikey=[redacted]")
    .slice(0, 240);
}

function parseExactCount(contentRange) {
  const match = String(contentRange || "").match(/\/(\d+)$/);
  if (!match) throw new Error("Recovery aggregate query did not return an exact count");
  return Number(match[1]);
}

async function exactCount(client, table, filters = {}) {
  const url = new URL(`${client.url}/rest/v1/${table}`);
  url.searchParams.set("select", "id");
  url.searchParams.set("limit", "1");
  for (const [column, filter] of Object.entries(filters)) url.searchParams.set(column, filter);
  const response = await fetch(url, {
    method: "GET",
    headers: client.headers({ Prefer: "count=exact", Range: "0-0" }),
  });
  const contentRange = response.headers.get("content-range");
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`Recovery aggregate query failed for ${table} with ${response.status}`);
  return parseExactCount(contentRange);
}

export function buildRecoveryOperationalVerdict(counts = {}) {
  const normalized = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value || 0)]));
  const activeRecordCount = [
    "queuedRuns",
    "retryingRuns",
    "runningRuns",
    "applyingRuns",
    "queuedJobs",
    "retryingJobs",
    "claimedOrRunningJobs",
    "activeMutationLeases",
    "staleMutationLeases",
    "orphanedMutationLeases",
  ].reduce((total, key) => total + (normalized[key] || 0), 0);
  return Object.freeze({
    ...normalized,
    activeRecordCount,
    unexpectedActiveWork: activeRecordCount > 0,
  });
}

async function countShardOperationalState(shard, { now = new Date(), staleJobSeconds = DEFAULT_STALE_JOB_SECONDS } = {}) {
  const staleBefore = new Date(now.getTime() - staleJobSeconds * 1000).toISOString();
  const nowIso = now.toISOString();
  const recoveryJob = { job_type: "eq.recovery_analysis" };
  const [
    queuedRuns,
    retryingRuns,
    runningRuns,
    applyingRuns,
    readyForReviewPreviews,
    queuedJobs,
    retryingJobs,
    claimedOrRunningJobs,
    staleProcessingJobs,
    activeMutationLeases,
    staleMutationLeases,
    orphanedMutationLeases,
  ] = await Promise.all([
    exactCount(shard.client, "recovery_runs", { "payload->>status": "eq.queued" }),
    exactCount(shard.client, "recovery_runs", { "payload->>status": "eq.retrying" }),
    exactCount(shard.client, "recovery_runs", { "payload->>status": ACTIVE_RUN_FILTER }),
    exactCount(shard.client, "recovery_runs", { "payload->>status": "eq.applying" }),
    exactCount(shard.client, "recovery_previews", { "payload->>status": "eq.ready_for_review" }),
    exactCount(shard.client, "background_jobs", { ...recoveryJob, status: "eq.queued", attempts: "eq.0" }),
    exactCount(shard.client, "background_jobs", { ...recoveryJob, status: "eq.queued", attempts: "gt.0" }),
    exactCount(shard.client, "background_jobs", { ...recoveryJob, status: "eq.processing" }),
    exactCount(shard.client, "background_jobs", { ...recoveryJob, status: "eq.processing", locked_at: `lte.${staleBefore}` }),
    exactCount(shard.client, "recovery_user_state", {
      "payload->>mutationLeaseToken": "not.is.null",
      "payload->>mutationLeaseExpiresAt": `gt.${nowIso}`,
    }),
    exactCount(shard.client, "recovery_user_state", {
      "payload->>mutationLeaseToken": "not.is.null",
      "payload->>mutationLeaseExpiresAt": `lte.${nowIso}`,
    }),
    exactCount(shard.client, "recovery_user_state", {
      "payload->>mutationLeaseToken": "not.is.null",
      "payload->>mutationLeaseExpiresAt": "is.null",
    }),
  ]);
  return {
    shard: shard.label,
    projectNumber: shard.projectNumber,
    counts: buildRecoveryOperationalVerdict({
      queuedRuns,
      retryingRuns,
      runningRuns,
      applyingRuns,
      readyForReviewPreviews,
      queuedJobs,
      retryingJobs,
      claimedOrRunningJobs,
      staleProcessingJobs,
      activeMutationLeases,
      staleMutationLeases,
      orphanedMutationLeases,
    }),
  };
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const config = getSupabaseEnvironment();
  if (!config.shardsConfigured) throw new Error("StudentOS Supabase shard configuration is incomplete");
  const requestedStaleJobSeconds = Number(process.env.STUDENTOS_RECOVERY_JOB_STALE_SECONDS || DEFAULT_STALE_JOB_SECONDS);
  const staleJobSeconds = Number.isFinite(requestedStaleJobSeconds)
    ? Math.max(60, Math.min(requestedStaleJobSeconds, 3600))
    : DEFAULT_STALE_JOB_SECONDS;
  const clients = createSupabaseClients(config);
  const shards = [];
  for (const shard of clients.shardClients) shards.push(await countShardOperationalState(shard, { staleJobSeconds }));
  const unexpectedActiveWork = shards.some((shard) => shard.counts.unexpectedActiveWork);
  console.log(JSON.stringify({
    ok: !unexpectedActiveWork,
    readOnly: true,
    staleJobThresholdSeconds: staleJobSeconds,
    unexpectedActiveWork,
    shards,
    identifiersPrinted: false,
    payloadsPrinted: false,
    secretsPrinted: false,
  }, null, 2));
  if (unexpectedActiveWork) process.exitCode = 1;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: safeError(error), identifiersPrinted: false, payloadsPrinted: false, secretsPrinted: false }, null, 2));
    process.exit(1);
  });
}
