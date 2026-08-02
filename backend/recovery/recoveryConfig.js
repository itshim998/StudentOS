function readBoolean(env, key, fallback = false) {
  const value = String(env?.[key] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function readPositiveInteger(env, key, fallback) {
  const value = Number.parseInt(String(env?.[key] ?? ""), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getRecoveryConfig(env = process.env) {
  return Object.freeze({
    enabled: readBoolean(env, "STUDENTOS_ADAPTIVE_RECOVERY_ENABLED", false),
    uiEnabled: readBoolean(env, "STUDENTOS_RECOVERY_UI_ENABLED", false),
    previewTtlHours: Math.min(readPositiveInteger(env, "STUDENTOS_RECOVERY_PREVIEW_TTL_HOURS", 24), 168),
    maxEventsPerRun: Math.min(readPositiveInteger(env, "STUDENTOS_RECOVERY_MAX_EVENTS_PER_RUN", 50), 200),
    maxTopics: Math.min(readPositiveInteger(env, "STUDENTOS_RECOVERY_MAX_TOPICS", 40), 100),
    maxEvidence: Math.min(readPositiveInteger(env, "STUDENTOS_RECOVERY_MAX_EVIDENCE", 120), 300),
  });
}

export function getSafeRecoveryStatus(config = getRecoveryConfig()) {
  return {
    enabled: config.enabled === true,
    uiEnabled: config.uiEnabled === true,
    asynchronous: true,
    reviewRequired: true,
    automaticApply: false,
    providerOutputPersisted: false,
  };
}
