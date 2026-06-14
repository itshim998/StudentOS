import { processBackgroundJob } from "./jobService.js";
import { recordJobEvent, sanitizeLogText } from "./jobObservability.js";

export function safeWorkerError(error) {
  return sanitizeLogText(error?.message || error || "worker_failed");
}

function sessionForJob(config, job) {
  return {
    authenticated: config.mode === "supabase",
    mode: config.mode === "supabase" ? "supabase_worker" : "local_worker",
    user: {
      id: job.userId,
      email: job.payload?.email || "worker@studentos.local",
    },
  };
}

export async function processClaimedJob({ repository, config, listedJob }) {
  const session = sessionForJob(config, listedJob);
  const state = await repository.loadState(session);
  const job = (state.backgroundJobs || []).find((item) => item.id === listedJob.id) || listedJob;
  Object.assign(job, listedJob);
  if (!state.backgroundJobs.some((item) => item.id === job.id)) {
    state.backgroundJobs.push(job);
  }
  recordJobEvent(state, {
    job,
    eventType: "claimed",
    message: "Background job claimed by worker.",
    metadata: {
      claimMode: job.payload?.claimMode || "local",
      attempt: job.attempts,
    },
  });
  const result = await processBackgroundJob({
    state,
    job,
    alreadyClaimed: true,
    downloadSourceBytes: async (material) => repository.downloadStorageObject(session, {
      bucket: material.storageBucket,
      path: material.storagePath,
    }),
  });
  recordJobEvent(state, {
    job,
    eventType: result.ok ? "completed" : "failed",
    severity: result.ok ? "info" : "warn",
    message: result.ok ? "Background job completed." : "Background job failed or will retry.",
    metadata: {
      willRetry: result.willRetry === true,
      error: result.error,
    },
  });
  await repository.saveBackgroundJobForUser(session.user, job, state);
  return {
    id: job.id,
    sourceId: job.sourceId,
    jobType: job.jobType,
    status: job.status,
    attempts: job.attempts,
    ok: result.ok === true,
    willRetry: result.willRetry === true,
  };
}

export async function runWorkerOnce({
  repository,
  config,
  limit = 25,
  lockTimeoutSeconds = 600,
  workerId = `worker_${process.pid}_${Date.now()}`,
} = {}) {
  const processed = [];
  while (processed.length < limit) {
    const listedJob = await repository.claimNextBackgroundJob({
      workerId,
      lockTimeoutSeconds,
    });
    if (!listedJob) break;
    processed.push(await processClaimedJob({ repository, config, listedJob }));
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

export async function runWorkerDaemon({
  repository,
  config,
  intervalMs = 5000,
  limit = 10,
  lockTimeoutSeconds = 600,
  workerId = `daemon_${process.pid}_${Date.now()}`,
  maxLoops = Infinity,
  shouldStop = () => false,
  logger = console,
} = {}) {
  let loops = 0;
  const runs = [];
  while (!shouldStop() && loops < maxLoops) {
    const run = await runWorkerOnce({
      repository,
      config,
      limit,
      lockTimeoutSeconds,
      workerId,
    });
    runs.push(run);
    logger.log(JSON.stringify({
      ok: true,
      daemon: true,
      loop: loops + 1,
      mode: config.mode,
      claimed: run.claimed,
      secretsPrinted: false,
    }));
    loops += 1;
    if (shouldStop() || loops >= maxLoops) break;
    await sleep(Math.max(250, intervalMs));
  }
  return {
    ok: true,
    daemon: true,
    loops,
    claimed: runs.reduce((sum, run) => sum + run.claimed, 0),
    secretsPrinted: false,
  };
}
