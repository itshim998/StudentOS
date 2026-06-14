import { processDataExportJob } from "./exportService.js";

function safeWorkerError(error) {
  return String(error?.message || error || "export_worker_failed")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .replace(/apikey[A-Za-z0-9._:= -]*/gi, "apikey=[redacted]")
    .slice(0, 180);
}

function sessionForExportJob(config, job) {
  return {
    authenticated: config.mode === "supabase",
    mode: config.mode === "supabase" ? "supabase_export_worker" : "local_export_worker",
    user: {
      id: job.userId,
      email: "export-worker@studentos.local",
    },
  };
}

export async function processClaimedDataExport({ repository, config, exportConfig, listedJob }) {
  const session = sessionForExportJob(config, listedJob);
  const state = await repository.loadState(session);
  const job = (state.dataExportJobs || []).find((item) => item.id === listedJob.id) || listedJob;
  Object.assign(job, listedJob);
  if (!state.dataExportJobs.some((item) => item.id === job.id)) state.dataExportJobs.push(job);
  const result = await processDataExportJob({
    state,
    job,
    config: exportConfig,
    alreadyClaimed: true,
    uploadPackage: (storageObject) => repository.uploadExportPackage(session, storageObject),
  });
  await repository.saveDataExportState(session, state);
  return {
    id: job.id,
    exportRequestId: job.exportRequestId,
    status: job.status,
    attempts: job.attempts,
    ok: result.ok === true,
    willRetry: result.willRetry === true,
  };
}

export async function runDataExportWorkerOnce({
  repository,
  config,
  exportConfig,
  limit = 10,
  lockTimeoutSeconds = 600,
  workerId = `export_worker_${process.pid}_${Date.now()}`,
} = {}) {
  const processed = [];
  while (processed.length < limit) {
    const listedJob = await repository.claimNextDataExportJob({ workerId, lockTimeoutSeconds });
    if (!listedJob) break;
    try {
      processed.push(await processClaimedDataExport({ repository, config, exportConfig, listedJob }));
    } catch (error) {
      processed.push({
        id: listedJob.id,
        exportRequestId: listedJob.exportRequestId,
        status: "failed",
        ok: false,
        error: safeWorkerError(error),
      });
    }
  }
  return {
    ok: true,
    mode: config.mode,
    claimed: processed.length,
    processed,
    secretsPrinted: false,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDataExportWorkerDaemon({
  repository,
  config,
  exportConfig,
  intervalMs = 5000,
  limit = 10,
  lockTimeoutSeconds = 600,
  workerId = `export_daemon_${process.pid}_${Date.now()}`,
  maxLoops = Infinity,
  shouldStop = () => false,
  logger = console,
} = {}) {
  let loops = 0;
  let claimed = 0;
  while (!shouldStop() && loops < maxLoops) {
    const run = await runDataExportWorkerOnce({
      repository,
      config,
      exportConfig,
      limit,
      lockTimeoutSeconds,
      workerId,
    });
    claimed += run.claimed;
    loops += 1;
    logger.log(JSON.stringify({
      ok: true,
      exportDaemon: true,
      loop: loops,
      mode: config.mode,
      claimed: run.claimed,
      secretsPrinted: false,
    }));
    if (shouldStop() || loops >= maxLoops) break;
    await sleep(Math.max(250, intervalMs));
  }
  return { ok: true, exportDaemon: true, loops, claimed, secretsPrinted: false };
}

export { safeWorkerError as safeExportWorkerError };
