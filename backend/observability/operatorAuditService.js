function nowIso(now = new Date()) {
  return now.toISOString();
}

function auditId(prefix, now = new Date()) {
  return `${prefix}_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeText(value, fallback = "", maxLength = 300) {
  return String(redactSecrets(String(value || fallback))).trim().slice(0, maxLength);
}

function isBlockedMetadataKey(key) {
  return /(authorization|bearer|token|secret|password|api[_-]?key|service[_-]?role|raw|content|text|path|bucket)/i
    .test(String(key || ""));
}

function safeMetadata(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => safeMetadata(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !isBlockedMetadataKey(key))
      .slice(0, 40)
      .map(([key, item]) => [safeText(key, "", 80), safeMetadata(item, depth + 1)]));
  }
  if (typeof value === "string") return safeText(value, "", 240);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return safeText(value, "", 240);
}

export function buildOperatorAuditEvent({
  requestId,
  operator,
  targetUserId = null,
  action,
  note,
  metadata = {},
  now = new Date(),
} = {}) {
  if (!requestId || !operator?.sub || !operator?.role || !action) {
    throw new Error("operator_audit_context_required");
  }
  const safeNote = safeText(note);
  if (safeNote.length < 8) throw new Error("operator_audit_note_requires_8_characters");
  return {
    id: auditId("operator_audit", now),
    requestId: safeText(requestId, "", 160),
    operatorId: safeText(operator.sub, "", 120),
    operatorRole: safeText(operator.role, "", 60),
    targetUserId: targetUserId ? safeText(targetUserId, "", 160) : null,
    action: safeText(action, "", 160),
    note: safeNote,
    metadata: {
      ...safeMetadata(metadata),
      secretsIncluded: false,
      rawExtractedContentIncluded: false,
    },
    createdAt: nowIso(now),
  };
}

export function buildBillingCancellationEvent({
  requestId,
  operator,
  targetUserId,
  deletionRequestId,
  cancellation,
  note,
  now = new Date(),
} = {}) {
  return {
    id: auditId("billing_cancel", now),
    requestId: safeText(requestId, "", 160),
    operatorId: safeText(operator?.sub, "", 120),
    targetUserId: safeText(targetUserId, "", 160),
    deletionRequestId: safeText(deletionRequestId, "", 160) || null,
    provider: safeText(cancellation?.provider, "none", 40),
    status: safeText(cancellation?.status, "failed", 80),
    note: safeText(note, "Billing cancellation safety evaluated.", 300),
    metadata: {
      providerCallExecuted: cancellation?.providerCallExecuted === true,
      waived: cancellation?.waived === true,
      subscriptionIdPresent: cancellation?.subscriptionIdPresent === true,
      secretsIncluded: false,
    },
    createdAt: nowIso(now),
  };
}
import { redactSecrets } from "./logger.js";
