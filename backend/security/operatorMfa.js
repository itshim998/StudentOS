import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { OPERATOR_PERMISSIONS } from "./operatorRbac.js";

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

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function signChallenge(secret, payload) {
  return createHmac("sha256", secret || "studentos-operator-mfa-scaffold")
    .update(payload)
    .digest("base64url");
}

export function getOperatorMfaConfig(env = process.env) {
  const defaultPermissions = [
    OPERATOR_PERMISSIONS.DELETION_EXECUTE,
    OPERATOR_PERMISSIONS.BILLING_WAIVE,
    OPERATOR_PERMISSIONS.EXPORT_CLEANUP,
  ];
  const requiredPermissions = splitList(readValue(env, "STUDENTOS_OPERATOR_MFA_REQUIRED_PERMISSIONS"))
    .filter((permission) => Object.values(OPERATOR_PERMISSIONS).includes(permission));
  return {
    required: readBool(env, "STUDENTOS_OPERATOR_MFA_REQUIRED", false),
    requiredPermissions: requiredPermissions.length ? requiredPermissions : defaultPermissions,
    methods: splitList(readValue(env, "STUDENTOS_OPERATOR_MFA_METHODS", "totp,phone")),
    mockEnabled: readBool(env, "STUDENTOS_OPERATOR_MFA_MOCK_ENABLED", false),
    mockCode: readValue(env, "STUDENTOS_OPERATOR_MFA_MOCK_CODE"),
    challengeTtlSeconds: Math.min(600, Math.max(60, readInt(env, "STUDENTOS_OPERATOR_MFA_CHALLENGE_TTL_SECONDS", 300))),
    verificationTtlSeconds: Math.min(900, Math.max(60, readInt(env, "STUDENTOS_OPERATOR_MFA_VERIFICATION_TTL_SECONDS", 300))),
    challengeSecret: readValue(env, "STUDENTOS_OPERATOR_SESSION_SECRET"),
  };
}

export function getSafeOperatorMfaStatus(config = getOperatorMfaConfig()) {
  return {
    required: config.required,
    requiredPermissions: config.requiredPermissions,
    methods: config.methods,
    mockEnabled: config.mockEnabled,
    challengeTtlSeconds: config.challengeTtlSeconds,
    verificationTtlSeconds: config.verificationTtlSeconds,
    providersReady: {
      totp: true,
      phone: true,
    },
    realDeliveryEnabled: false,
    publicAccess: false,
    secretsExposed: false,
  };
}

export function operatorMfaRequiredForPermission(permission, config = getOperatorMfaConfig()) {
  return Boolean(config.required && config.requiredPermissions.includes(permission));
}

export function assertOperatorMfaSatisfied({
  operator,
  permission,
  config = getOperatorMfaConfig(),
  now = new Date(),
} = {}) {
  if (!operatorMfaRequiredForPermission(permission, config)) return true;
  const expiresAt = Date.parse(operator?.mfa?.expiresAt || "");
  if (operator?.mfa?.verified === true && Number.isFinite(expiresAt) && expiresAt > now.getTime()) {
    return true;
  }
  const error = new Error("Operator MFA is required for this action");
  error.status = 403;
  error.mfaRequired = true;
  throw error;
}

export function createOperatorMfaChallenge({
  operator,
  config = getOperatorMfaConfig(),
  now = new Date(),
} = {}) {
  if (!operator?.sub) {
    const error = new Error("Operator session is required for MFA");
    error.status = 401;
    throw error;
  }
  const challengeId = `operator_mfa_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const expiresAt = new Date(now.getTime() + config.challengeTtlSeconds * 1000).toISOString();
  const payload = `${operator.sub}.${challengeId}.${expiresAt}`;
  return {
    challengeId,
    methods: config.methods,
    expiresAt,
    status: config.mockEnabled ? "mock_verification_ready" : "delivery_scaffold_only",
    signature: signChallenge(config.challengeSecret, payload),
    realDeliveryEnabled: false,
    secretsPrinted: false,
  };
}

export function verifyOperatorMfaChallenge({
  operator,
  challengeId,
  code,
  config = getOperatorMfaConfig(),
  now = new Date(),
} = {}) {
  if (!operator?.sub) {
    const error = new Error("Operator session is required for MFA verification");
    error.status = 401;
    throw error;
  }
  if (!String(challengeId || "").startsWith("operator_mfa_")) {
    const error = new Error("Invalid MFA challenge");
    error.status = 400;
    throw error;
  }
  if (!config.mockEnabled) {
    const error = new Error("Operator MFA delivery is scaffolded only");
    error.status = 409;
    throw error;
  }
  if (!safeEqual(config.mockCode, code)) {
    const error = new Error("Operator MFA verification failed");
    error.status = 403;
    throw error;
  }
  const verifiedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + config.verificationTtlSeconds * 1000).toISOString();
  return {
    verified: true,
    challengeId: String(challengeId).slice(0, 120),
    methods: config.methods,
    verifiedAt,
    expiresAt,
    mockVerified: true,
  };
}
