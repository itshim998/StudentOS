import { resolveEntitlements } from "../billing/billingService.js";

function activeSources(state) {
  return (state.sourceMaterials || []).filter((source) => !source.deletedAt);
}

function activeJobs(state, type = null) {
  return (state.backgroundJobs || []).filter((job) => !type || job.jobType === type);
}

function aiRequestCount(state) {
  return (state.aiMessages || []).filter((message) => message.role === "user").length;
}

export function checkUsagePolicy({
  saasConfig,
  state,
  action,
  context = {},
} = {}) {
  const entitlements = resolveEntitlements(state, saasConfig?.billing?.defaultPlan || "free");
  const quotas = entitlements.quotas;
  const enforcementEnabled = saasConfig?.quotas?.enforcementEnabled === true;
  const violations = [];
  if (action === "ai_call" && aiRequestCount(state) >= quotas.aiRequestsPerDay) {
    violations.push("ai_request_quota_exceeded");
  }
  if (action === "upload") {
    if (Number(context.fileSizeBytes || 0) > quotas.maxFileBytes) violations.push("file_size_quota_exceeded");
    if (activeSources(state).length >= quotas.maxSources) violations.push("source_count_quota_exceeded");
  }
  if (action === "course_create" && (state.courses || []).length >= quotas.maxCourses) {
    violations.push("course_quota_exceeded");
  }
  if (action === "reindex_job" && activeJobs(state, "source_reindex").length >= quotas.reindexJobsPerDay) {
    violations.push("reindex_job_quota_exceeded");
  }
  if (action === "worker_retry" && activeJobs(state).length >= quotas.workerJobsPerDay) {
    violations.push("worker_job_quota_exceeded");
  }
  return {
    allowed: !enforcementEnabled || violations.length === 0,
    enforcementEnabled,
    plan: {
      id: entitlements.plan.id,
      label: entitlements.plan.label,
    },
    subscription: entitlements.subscription,
    features: entitlements.features,
    violations,
    quotas,
  };
}

export function assertUsageAllowed(policyResult) {
  if (policyResult.allowed) return;
  const error = new Error(`Usage limit reached: ${policyResult.violations.join(", ")}`);
  error.status = 429;
  error.policy = policyResult;
  throw error;
}
