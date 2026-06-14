import { createHmac, timingSafeEqual } from "node:crypto";

export const OPERATOR_ROLES = Object.freeze({
  OWNER: "owner",
  SUPPORT_ADMIN: "support_admin",
  PRIVACY_REVIEWER: "privacy_reviewer",
  BILLING_OPERATOR: "billing_operator",
  READ_ONLY_AUDITOR: "read_only_auditor",
});

export const OPERATOR_PERMISSIONS = Object.freeze({
  READ_OPERATIONS: "operations:read",
  MONITORING_READ: "monitoring:read",
  EXPORT_CLEANUP: "exports:cleanup",
  DELETION_REVIEW: "deletion:review",
  DELETION_EXECUTE: "deletion:execute",
  BILLING_REVIEW: "billing:review",
  BILLING_WAIVE: "billing:waive",
});

const ROLE_PERMISSIONS = Object.freeze({
  [OPERATOR_ROLES.OWNER]: Object.values(OPERATOR_PERMISSIONS),
  [OPERATOR_ROLES.SUPPORT_ADMIN]: [
    OPERATOR_PERMISSIONS.READ_OPERATIONS,
    OPERATOR_PERMISSIONS.MONITORING_READ,
    OPERATOR_PERMISSIONS.EXPORT_CLEANUP,
  ],
  [OPERATOR_ROLES.PRIVACY_REVIEWER]: [
    OPERATOR_PERMISSIONS.READ_OPERATIONS,
    OPERATOR_PERMISSIONS.MONITORING_READ,
    OPERATOR_PERMISSIONS.DELETION_REVIEW,
  ],
  [OPERATOR_ROLES.BILLING_OPERATOR]: [
    OPERATOR_PERMISSIONS.READ_OPERATIONS,
    OPERATOR_PERMISSIONS.MONITORING_READ,
    OPERATOR_PERMISSIONS.BILLING_REVIEW,
  ],
  [OPERATOR_ROLES.READ_ONLY_AUDITOR]: [
    OPERATOR_PERMISSIONS.READ_OPERATIONS,
    OPERATOR_PERMISSIONS.MONITORING_READ,
  ],
});

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

function readBool(env, key, fallback = false) {
  const value = readValue(env, key);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readInt(env, key, fallback) {
  const raw = readValue(env, key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ""));
  const rightBytes = Buffer.from(String(right || ""));
  return leftBytes.length > 0 &&
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes);
}

function safeOperatorId(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._@-]/g, "_").slice(0, 120);
}

function parseRoster(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: safeOperatorId(item?.id),
        role: Object.values(OPERATOR_ROLES).includes(item?.role) ? item.role : OPERATOR_ROLES.READ_ONLY_AUDITOR,
        enabled: item?.enabled !== false,
        mfaMethods: Array.isArray(item?.mfaMethods)
          ? item.mfaMethods.map((method) => String(method || "").trim()).filter(Boolean).slice(0, 3)
          : [],
      }))
      .filter((item) => item.id);
  } catch {
    return [];
  }
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(value) {
  return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
}

function sign(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function getOperatorRbacConfig(env = process.env) {
  const ttlSeconds = Math.min(900, Math.max(60, readInt(env, "STUDENTOS_OPERATOR_SESSION_TTL_SECONDS", 300)));
  return {
    enabled: readBool(env, "STUDENTOS_INTERNAL_OPS_ENABLED", false),
    bootstrapToken: readValue(env, "STUDENTOS_INTERNAL_OPS_TOKEN"),
    sessionSecret: readValue(env, "STUDENTOS_OPERATOR_SESSION_SECRET"),
    sessionVersion: readValue(env, "STUDENTOS_OPERATOR_SESSION_VERSION", "v1"),
    ttlSeconds,
    roster: parseRoster(readValue(env, "STUDENTOS_OPERATOR_ROSTER_JSON")),
  };
}

export function getSafeOperatorRbacStatus(config = getOperatorRbacConfig()) {
  return {
    enabled: config.enabled,
    bootstrapConfigured: Boolean(config.bootstrapToken),
    sessionSigningConfigured: Boolean(config.sessionSecret),
    configuredOperators: config.roster.filter((item) => item.enabled).length,
    roles: Object.values(OPERATOR_ROLES),
    sessionTtlSeconds: config.ttlSeconds,
    sessionVersionConfigured: Boolean(config.sessionVersion),
    publicAccess: false,
    secretsExposed: false,
  };
}

export function permissionsForRole(role) {
  return [...(ROLE_PERMISSIONS[role] || [])];
}

export function operatorHasPermission(operator, permission) {
  return Boolean(operator?.permissions?.includes(permission));
}

export function createOperatorSession({
  operatorId,
  bootstrapToken,
  config = getOperatorRbacConfig(),
  now = new Date(),
  mfa = null,
} = {}) {
  if (!config.enabled) {
    const error = new Error("Internal account operations are disabled");
    error.status = 404;
    throw error;
  }
  if (!safeEqual(config.bootstrapToken, bootstrapToken)) {
    const error = new Error("Operator bootstrap authorization failed");
    error.status = 403;
    throw error;
  }
  if (!config.sessionSecret) {
    const error = new Error("Operator session signing is not configured");
    error.status = 503;
    throw error;
  }
  const operator = config.roster.find((item) => item.id === safeOperatorId(operatorId) && item.enabled);
  if (!operator) {
    const error = new Error("Operator is not authorized");
    error.status = 403;
    throw error;
  }
  const issuedAt = Math.floor(now.getTime() / 1000);
  const claims = {
    sub: operator.id,
    role: operator.role,
    permissions: permissionsForRole(operator.role),
    mfa: mfa || null,
    iat: issuedAt,
    exp: issuedAt + config.ttlSeconds,
    ver: config.sessionVersion,
    typ: "studentos_operator_session",
  };
  const payload = encode(claims);
  return {
    token: `${payload}.${sign(config.sessionSecret, payload)}`,
    operator: claims,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

export function refreshOperatorSession({
  operator,
  config = getOperatorRbacConfig(),
  now = new Date(),
  mfa = null,
} = {}) {
  if (!config.enabled) {
    const error = new Error("Internal account operations are disabled");
    error.status = 404;
    throw error;
  }
  if (!config.sessionSecret) {
    const error = new Error("Operator session signing is not configured");
    error.status = 503;
    throw error;
  }
  const rosterEntry = config.roster.find((item) => item.id === safeOperatorId(operator?.sub) && item.role === operator?.role && item.enabled);
  if (!rosterEntry) {
    const error = new Error("Operator session is no longer authorized");
    error.status = 403;
    throw error;
  }
  const issuedAt = Math.floor(now.getTime() / 1000);
  const claims = {
    sub: rosterEntry.id,
    role: rosterEntry.role,
    permissions: permissionsForRole(rosterEntry.role),
    mfa: mfa || operator?.mfa || null,
    iat: issuedAt,
    exp: issuedAt + config.ttlSeconds,
    ver: config.sessionVersion,
    typ: "studentos_operator_session",
  };
  const payload = encode(claims);
  return {
    token: `${payload}.${sign(config.sessionSecret, payload)}`,
    operator: claims,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

export function verifyOperatorSession(token, {
  config = getOperatorRbacConfig(),
  permission = null,
  now = new Date(),
} = {}) {
  if (!config.enabled) {
    const error = new Error("Not found");
    error.status = 404;
    throw error;
  }
  if (!config.sessionSecret) {
    const error = new Error("Operator session signing is not configured");
    error.status = 503;
    throw error;
  }
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || !safeEqual(sign(config.sessionSecret, payload), signature)) {
    const error = new Error("Operator session authorization failed");
    error.status = 403;
    throw error;
  }
  let claims;
  try {
    claims = decode(payload);
  } catch {
    const error = new Error("Operator session authorization failed");
    error.status = 403;
    throw error;
  }
  if (claims.typ !== "studentos_operator_session" || Number(claims.exp || 0) <= Math.floor(now.getTime() / 1000)) {
    const error = new Error("Operator session has expired");
    error.status = 401;
    throw error;
  }
  if (claims.ver !== config.sessionVersion) {
    const error = new Error("Operator session version has expired");
    error.status = 401;
    throw error;
  }
  const rosterEntry = config.roster.find((item) => item.id === claims.sub && item.role === claims.role && item.enabled);
  if (!rosterEntry) {
    const error = new Error("Operator session is no longer authorized");
    error.status = 403;
    throw error;
  }
  if (permission && !operatorHasPermission(claims, permission)) {
    const error = new Error("Operator permission denied");
    error.status = 403;
    throw error;
  }
  return claims;
}
