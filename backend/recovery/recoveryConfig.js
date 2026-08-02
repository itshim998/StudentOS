const RECOVERY_ROLLOUT_USER_LIMIT = 25;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const RECOVERY_ROLLOUT_MODES = Object.freeze({
  OFF: "off",
  ALLOWLIST: "allowlist",
});

function readBoolean(env, key, fallback = false) {
  const value = String(env?.[key] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function readPositiveInteger(env, key, fallback) {
  const value = Number.parseInt(String(env?.[key] ?? ""), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseRolloutMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return RECOVERY_ROLLOUT_MODES.OFF;
  return Object.values(RECOVERY_ROLLOUT_MODES).includes(normalized)
    ? normalized
    : null;
}

export function parseRecoveryRolloutUserIds(value) {
  const entries = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  const userIds = [];
  const invalidIds = [];
  const duplicateIds = [];
  const seen = new Set();

  for (const entry of entries) {
    const candidate = String(entry ?? "").trim().toLowerCase();
    if (!candidate) continue;
    if (!UUID_PATTERN.test(candidate)) {
      invalidIds.push(candidate);
      continue;
    }
    if (seen.has(candidate)) {
      duplicateIds.push(candidate);
      continue;
    }
    seen.add(candidate);
    userIds.push(candidate);
  }

  return Object.freeze({
    userIds: Object.freeze(userIds),
    invalidIds: Object.freeze(invalidIds),
    duplicateIds: Object.freeze(duplicateIds),
    overLimit: userIds.length > RECOVERY_ROLLOUT_USER_LIMIT,
  });
}

export function validateRecoveryRolloutEnvironment(env = {}) {
  const configuredMode = parseRolloutMode(env.STUDENTOS_RECOVERY_ROLLOUT_MODE);
  const engineEnabled = readBoolean(env, "STUDENTOS_ADAPTIVE_RECOVERY_ENABLED", false);
  const uiEnabled = readBoolean(env, "STUDENTOS_RECOVERY_UI_ENABLED", false);
  const parsedUsers = parseRecoveryRolloutUserIds(env.STUDENTOS_RECOVERY_ROLLOUT_USER_IDS);
  const errors = [];

  if (!configuredMode) errors.push("invalid_rollout_mode");
  if (parsedUsers.invalidIds.length > 0) errors.push("invalid_rollout_user_id");
  if (parsedUsers.duplicateIds.length > 0) errors.push("duplicate_rollout_user_id");
  if (parsedUsers.overLimit) errors.push("rollout_user_limit_exceeded");

  const mode = configuredMode || RECOVERY_ROLLOUT_MODES.OFF;
  if (mode === RECOVERY_ROLLOUT_MODES.OFF) {
    if (engineEnabled || uiEnabled) errors.push("off_mode_requires_disabled_flags");
  } else if (mode === RECOVERY_ROLLOUT_MODES.ALLOWLIST) {
    if (!engineEnabled || !uiEnabled) errors.push("allowlist_requires_both_flags");
    if (parsedUsers.userIds.length === 0) errors.push("allowlist_requires_user_ids");
  }

  return Object.freeze({
    ok: errors.length === 0,
    mode,
    engineEnabled,
    uiEnabled,
    userIds: parsedUsers.userIds,
    userCount: parsedUsers.userIds.length,
    errors: Object.freeze(errors),
  });
}

export function getRecoveryConfig(env = process.env) {
  const rollout = validateRecoveryRolloutEnvironment(env);
  const rolloutMode = rollout.ok ? rollout.mode : RECOVERY_ROLLOUT_MODES.OFF;
  const rolloutUserIds = rollout.ok && rolloutMode === RECOVERY_ROLLOUT_MODES.ALLOWLIST
    ? rollout.userIds.slice(0, RECOVERY_ROLLOUT_USER_LIMIT)
    : [];

  return Object.freeze({
    // Low-level Recovery jobs still honor the dedicated engine switch so existing
    // deterministic tests and already-queued work retain their service boundary.
    // Public capability and route access additionally require a valid allowlist.
    enabled: rollout.engineEnabled,
    uiEnabled: rollout.uiEnabled,
    rolloutMode,
    rolloutUserIds: Object.freeze(rolloutUserIds),
    rolloutConfigValid: rollout.ok,
    previewTtlHours: Math.min(readPositiveInteger(env, "STUDENTOS_RECOVERY_PREVIEW_TTL_HOURS", 24), 168),
    maxEventsPerRun: Math.min(readPositiveInteger(env, "STUDENTOS_RECOVERY_MAX_EVENTS_PER_RUN", 50), 200),
    maxTopics: Math.min(readPositiveInteger(env, "STUDENTOS_RECOVERY_MAX_TOPICS", 40), 100),
    maxEvidence: Math.min(readPositiveInteger(env, "STUDENTOS_RECOVERY_MAX_EVIDENCE", 120), 300),
  });
}

export function isRecoveryRolloutUserEligible(userId, config = getRecoveryConfig()) {
  const normalizedUserId = String(userId ?? "").trim().toLowerCase();
  return config.rolloutConfigValid === true
    && config.rolloutMode === RECOVERY_ROLLOUT_MODES.ALLOWLIST
    && UUID_PATTERN.test(normalizedUserId)
    && config.rolloutUserIds.includes(normalizedUserId);
}

export function getSafeRecoveryStatus(config = getRecoveryConfig()) {
  return {
    enabled: config.enabled === true,
    uiEnabled: config.uiEnabled === true,
    rolloutMode: config.rolloutMode || RECOVERY_ROLLOUT_MODES.OFF,
    rolloutConfigValid: config.rolloutConfigValid === true,
    cohortRestricted: config.rolloutMode === RECOVERY_ROLLOUT_MODES.ALLOWLIST,
    asynchronous: true,
    reviewRequired: true,
    automaticApply: false,
    providerOutputPersisted: false,
  };
}
