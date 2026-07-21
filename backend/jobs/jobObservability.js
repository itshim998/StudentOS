import { randomUUID } from "node:crypto";

export const JOB_EVENT_TYPES = Object.freeze([
  "queued",
  "claimed",
  "retry",
  "failed",
  "completed",
  "cancelled",
  "cleanup",
]);

export function sanitizeLogText(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .replace(/nvapi-[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/apikey[A-Za-z0-9._:= -]*/gi, "apikey=[redacted]")
    .replace(/service[_-]?role[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "service_role_key=[redacted]")
    .slice(0, 220);
}

function sanitizeMetadata(value) {
  const json = JSON.parse(JSON.stringify(value || {}));
  for (const key of Object.keys(json)) {
    if (/key|secret|token|authorization|bearer/i.test(key)) {
      json[key] = "[redacted]";
    } else if (typeof json[key] === "string") {
      json[key] = sanitizeLogText(json[key]);
    }
  }
  return json;
}

export function createJobEvent({
  userId,
  jobId,
  sourceId = null,
  eventType,
  severity = "info",
  message = "",
  metadata = {},
} = {}) {
  if (!userId) throw new Error("job_event_user_required");
  if (!JOB_EVENT_TYPES.includes(eventType)) throw new Error("unsupported_job_event_type");
  const createdAt = new Date().toISOString();
  return {
    id: `evt_${Date.now()}_${randomUUID().slice(0, 8)}`,
    userId,
    jobId,
    sourceId,
    eventType,
    severity,
    message: sanitizeLogText(message || eventType),
    metadata: sanitizeMetadata(metadata),
    createdAt,
  };
}

export function recordJobEvent(state, eventInput) {
  state.jobEvents = state.jobEvents || [];
  const event = createJobEvent({
    userId: state.studentProfile?.id || eventInput.job?.userId || eventInput.userId,
    jobId: eventInput.job?.id || eventInput.jobId,
    sourceId: eventInput.job?.sourceId || eventInput.sourceId || null,
    eventType: eventInput.eventType,
    severity: eventInput.severity,
    message: eventInput.message,
    metadata: eventInput.metadata,
  });
  state.jobEvents.push(event);
  return event;
}

export function buildQueueHealth(jobs = [], { stuckTimeoutSeconds = 600 } = {}) {
  const counts = {
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  const now = Date.now();
  const processingAges = [];
  const failedReasons = {};
  let stuckJobsCount = 0;
  for (const job of jobs) {
    const status = job.status || "queued";
    counts[status] = (counts[status] || 0) + 1;
    if (status === "processing" && job.lockedAt) {
      const ageSeconds = Math.max(0, Math.round((now - Date.parse(job.lockedAt)) / 1000));
      processingAges.push(ageSeconds);
      if (ageSeconds > stuckTimeoutSeconds) stuckJobsCount += 1;
    }
    if (status === "failed") {
      const reason = sanitizeLogText(job.lastError || "unknown");
      failedReasons[reason] = (failedReasons[reason] || 0) + 1;
    }
  }
  const summarize = (job) => ({
    id: job.id,
    sourceId: job.sourceId,
    jobType: job.jobType,
    status: job.status,
    attempts: job.attempts || 0,
    maxAttempts: job.maxAttempts || 3,
    lastError: sanitizeLogText(job.lastError || ""),
    lockedAt: job.lockedAt || null,
    updatedAt: job.updatedAt || job.createdAt || null,
  });
  return {
    counts,
    failedJobs: jobs.filter((job) => job.status === "failed").map(summarize),
    processingJobs: jobs.filter((job) => job.status === "processing").map(summarize),
    retryableFailed: jobs.filter((job) => job.status === "failed" && Number(job.attempts || 0) < Number(job.maxAttempts || 3)).length,
    averageProcessingAgeSeconds: processingAges.length
      ? Math.round(processingAges.reduce((sum, value) => sum + value, 0) / processingAges.length)
      : 0,
    stuckJobsCount,
    failedReasons,
  };
}
