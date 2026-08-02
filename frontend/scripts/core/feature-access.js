const RECOVERY_STATUSES = new Set(["disabled", "plan_unavailable", "setup_required", "available"]);

export function getRecoveryAccess(workspace = {}) {
  const projected = workspace?.planAccess?.capabilities?.recovery;
  const status = RECOVERY_STATUSES.has(projected?.status) ? projected.status : "disabled";
  return Object.freeze({
    status,
    available: status === "available" && projected?.available === true,
    reviewRequired: projected?.reviewRequired !== false,
    automaticApply: false,
  });
}
