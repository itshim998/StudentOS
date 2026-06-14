import { randomUUID } from "node:crypto";

export const ALERT_TYPES = Object.freeze({
  HIGH_RISK_OPERATOR_ACTION: "high_risk_operator_action",
  BILLING_CANCELLATION_FAILURE: "billing_cancellation_failure",
  DELETION_APPROVAL_RECORDED: "deletion_approval_recorded",
  EXPORT_DOWNLOAD_ANOMALY: "export_download_anomaly",
});

function nowIso(now = new Date()) {
  return now.toISOString();
}

function safeText(value, fallback = "", maxLength = 240) {
  return String(value || fallback).trim().slice(0, maxLength);
}

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

function readBool(env, key, fallback = true) {
  const value = readValue(env, key);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function safeMetadata(metadata = {}) {
  const blocked = /(token|secret|password|api[_-]?key|service[_-]?role|path|bucket|content|text|authorization)/i;
  return Object.fromEntries(Object.entries(metadata || {})
    .filter(([key]) => !blocked.test(key))
    .slice(0, 30)
    .map(([key, value]) => [
      safeText(key, "", 80),
      typeof value === "number" || typeof value === "boolean" ? value : safeText(value, "", 180),
    ]));
}

export function getMonitoringAlertConfig(env = process.env) {
  return {
    enabled: readBool(env, "STUDENTOS_MONITORING_ALERTS_ENABLED", true),
    provider: readValue(env, "STUDENTOS_MONITORING_ALERT_PROVIDER", "log"),
    externalProviderEnabled: false,
  };
}

export function getSafeMonitoringAlertStatus(config = getMonitoringAlertConfig()) {
  return {
    enabled: config.enabled,
    provider: config.provider,
    externalProviderEnabled: false,
    supportedAlertTypes: Object.values(ALERT_TYPES),
    secretsExposed: false,
  };
}

export function createMonitoringAlert({
  targetUserId = null,
  requestId,
  alertType,
  severity = "warn",
  source = "studentos-api",
  message,
  metadata = {},
  now = new Date(),
} = {}) {
  if (!Object.values(ALERT_TYPES).includes(alertType)) {
    throw new Error("unsupported_monitoring_alert_type");
  }
  return {
    id: `alert_${Date.now()}_${randomUUID().slice(0, 8)}`,
    targetUserId: targetUserId ? safeText(targetUserId, "", 160) : null,
    requestId: safeText(requestId, "", 160),
    alertType,
    severity: ["info", "warn", "error", "critical"].includes(severity) ? severity : "warn",
    source: safeText(source, "studentos-api", 80),
    message: safeText(message, alertType, 300),
    metadata: {
      ...safeMetadata(metadata),
      secretsIncluded: false,
      rawContentIncluded: false,
    },
    createdAt: nowIso(now),
  };
}

export function createLogAlertSink(logger) {
  return {
    async emit(alert) {
      logger?.warn?.("monitoring.alert", {
        requestId: alert.requestId,
        targetUserId: alert.targetUserId,
        alertType: alert.alertType,
        severity: alert.severity,
        source: alert.source,
      });
      return { emitted: true, provider: "log", externalProviderCalled: false };
    },
  };
}

export async function emitMonitoringAlert({
  repository,
  session = null,
  sink,
  alert,
  config = getMonitoringAlertConfig(),
} = {}) {
  if (!config.enabled || !alert) {
    return { emitted: false, disabled: true, externalProviderCalled: false };
  }
  if (repository?.insertMonitoringAlertEvent) {
    await repository.insertMonitoringAlertEvent(session, alert);
  }
  const sinkResult = await sink?.emit?.(alert);
  return {
    emitted: true,
    provider: sinkResult?.provider || config.provider,
    externalProviderCalled: false,
  };
}
