import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import {
  OPERATOR_PERMISSIONS,
  createOperatorSession,
  getOperatorRbacConfig,
  refreshOperatorSession,
  verifyOperatorSession,
} from "./security/operatorRbac.js";
import {
  assertOperatorMfaSatisfied,
  createOperatorMfaChallenge,
  getOperatorMfaConfig,
  getSafeOperatorMfaStatus,
  verifyOperatorMfaChallenge,
} from "./security/operatorMfa.js";
import {
  evaluateBillingCancellation,
  getBillingCancellationConfig,
  normalizeProviderCancellationState,
} from "./billing/cancellationService.js";
import {
  ALERT_TYPES,
  createMonitoringAlert,
  getSafeMonitoringAlertStatus,
} from "./monitoring/alertService.js";
import { redactSecrets } from "./observability/logger.js";
import { validateProductionReadiness } from "./config/saasConfig.js";

const now = new Date("2026-06-04T00:00:00.000Z");
const rbacEnv = {
  STUDENTOS_INTERNAL_OPS_ENABLED: "true",
  STUDENTOS_INTERNAL_OPS_TOKEN: "bootstrap-pass22",
  STUDENTOS_OPERATOR_SESSION_SECRET: "session-secret-pass22",
  STUDENTOS_OPERATOR_SESSION_VERSION: "v1",
  STUDENTOS_OPERATOR_SESSION_TTL_SECONDS: "120",
  STUDENTOS_OPERATOR_ROSTER_JSON: JSON.stringify([
    { id: "owner-pass22", role: "owner", mfaMethods: ["totp", "phone"] },
  ]),
};

const rbacConfig = getOperatorRbacConfig(rbacEnv);
const issued = createOperatorSession({
  operatorId: "owner-pass22",
  bootstrapToken: "bootstrap-pass22",
  config: rbacConfig,
  now,
});
const operator = verifyOperatorSession(issued.token, {
  config: rbacConfig,
  permission: OPERATOR_PERMISSIONS.DELETION_EXECUTE,
  now,
});

const mfaConfig = getOperatorMfaConfig({
  STUDENTOS_OPERATOR_MFA_REQUIRED: "true",
  STUDENTOS_OPERATOR_MFA_REQUIRED_PERMISSIONS: "deletion:execute,billing:waive",
  STUDENTOS_OPERATOR_MFA_METHODS: "totp,phone",
  STUDENTOS_OPERATOR_MFA_MOCK_ENABLED: "true",
  STUDENTOS_OPERATOR_MFA_MOCK_CODE: "123456",
  STUDENTOS_OPERATOR_MFA_CHALLENGE_TTL_SECONDS: "120",
  STUDENTOS_OPERATOR_MFA_VERIFICATION_TTL_SECONDS: "120",
  STUDENTOS_OPERATOR_SESSION_SECRET: "session-secret-pass22",
});
assert.equal(getSafeOperatorMfaStatus(mfaConfig).required, true);
assert.throws(() => assertOperatorMfaSatisfied({
  operator,
  permission: OPERATOR_PERMISSIONS.DELETION_EXECUTE,
  config: mfaConfig,
  now,
}), /MFA is required/);
const challenge = createOperatorMfaChallenge({ operator, config: mfaConfig, now });
assert.equal(challenge.realDeliveryEnabled, false);
assert.throws(() => verifyOperatorMfaChallenge({
  operator,
  challengeId: challenge.challengeId,
  code: "000000",
  config: mfaConfig,
  now,
}), /verification failed/);
const mfa = verifyOperatorMfaChallenge({
  operator,
  challengeId: challenge.challengeId,
  code: "123456",
  config: mfaConfig,
  now,
});
const refreshed = refreshOperatorSession({ operator, config: rbacConfig, mfa, now });
const verifiedOperator = verifyOperatorSession(refreshed.token, {
  config: rbacConfig,
  permission: OPERATOR_PERMISSIONS.DELETION_EXECUTE,
  now,
});
assert.equal(assertOperatorMfaSatisfied({
  operator: verifiedOperator,
  permission: OPERATOR_PERMISSIONS.DELETION_EXECUTE,
  config: mfaConfig,
  now,
}), true);
assert.throws(() => verifyOperatorSession(issued.token, {
  config: getOperatorRbacConfig({ ...rbacEnv, STUDENTOS_OPERATOR_SESSION_VERSION: "v2" }),
  now,
}), /version has expired/);

assert.equal(normalizeProviderCancellationState({ provider: "stripe", status: "canceled" }).status, "provider_cancelled");
assert.equal(normalizeProviderCancellationState({ provider: "paddle", status: "deleted" }).satisfied, true);
assert.equal(normalizeProviderCancellationState({ provider: "razorpay", status: "cancelled" }).satisfied, true);
assert.equal(normalizeProviderCancellationState({
  provider: "stripe",
  status: "active",
  cancelAtPeriodEnd: true,
}, getBillingCancellationConfig({ STUDENTOS_BILLING_CANCELLATION_POLICY: "immediate" })).satisfied, false);
assert.equal(normalizeProviderCancellationState({
  provider: "stripe",
  status: "active",
  cancelAtPeriodEnd: true,
}, getBillingCancellationConfig({ STUDENTOS_BILLING_CANCELLATION_POLICY: "cycle_end" })).satisfied, true);

const state = createSeedState(now);
state.billingSubscriptions = [{
  id: "billing-pass22",
  userId: state.studentProfile.id,
  planId: "pro",
  provider: "stripe",
  status: "active",
  providerSubscriptionId: "safe-provider-reference",
  updatedAt: now.toISOString(),
}];
const blocked = evaluateBillingCancellation({
  state,
  adapter: { prepareCancellation: () => ({ status: "scaffold_only", providerCallExecuted: false }) },
  config: getBillingCancellationConfig({ STUDENTOS_BILLING_CANCELLATION_POLICY: "immediate" }),
});
assert.equal(blocked.blocksExecution, true);
assert.equal(blocked.status, "provider_cancellation_required");
state.billingSubscriptions[0].status = "canceled";
const reconciled = evaluateBillingCancellation({
  state,
  config: getBillingCancellationConfig({ STUDENTOS_BILLING_CANCELLATION_POLICY: "immediate" }),
});
assert.equal(reconciled.satisfied, true);
assert.equal(reconciled.status, "provider_cancelled");

const alert = createMonitoringAlert({
  targetUserId: state.studentProfile.id,
  requestId: "req-pass22",
  alertType: ALERT_TYPES.BILLING_CANCELLATION_FAILURE,
  severity: "error",
  message: "Billing cancellation failed safely.",
  metadata: {
    storagePath: "private/path/export.json",
    extractedText: "raw content",
    provider: "stripe",
  },
  now,
});
const alertText = JSON.stringify(alert);
assert.equal(alertText.includes("private/path"), false);
assert.equal(alertText.includes("raw content"), false);
assert.equal(alert.metadata.provider, "stripe");
assert.equal(getSafeMonitoringAlertStatus().externalProviderEnabled, false);

const productionReadiness = validateProductionReadiness({
  env: {
    STUDENTOS_ENV: "production",
    STUDENTOS_STORAGE_BUCKET: "private-source",
    CORS_ORIGINS: "https://studentos.example",
    STUDENTOS_INTERNAL_OPS_ENABLED: "true",
    STUDENTOS_INTERNAL_OPS_TOKEN: "configured",
    STUDENTOS_OPERATOR_SESSION_SECRET: "configured",
    STUDENTOS_OPERATOR_ROSTER_JSON: "[]",
    STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED: "true",
    STUDENTOS_AUTH_ADMIN_DELETE_ENABLED: "true",
    STUDENTOS_BILLING_CANCELLATION_MANUAL_WAIVER_ENABLED: "true",
    STUDENTOS_OPERATOR_MFA_MOCK_ENABLED: "true",
  },
  supabaseConfig: {
    mode: "supabase",
    authConfigured: true,
    shardsConfigured: true,
    jwtSecretPresent: true,
    auth: { url: "https://auth.example" },
    shards: [
      { url: "https://shard-1.example", serviceRoleKey: "key-1" },
      { url: "https://shard-2.example", serviceRoleKey: "key-2" },
      { url: "https://shard-3.example", serviceRoleKey: "key-3" },
    ],
  },
  saasConfig: {
    deployment: "production",
    rateLimit: { enabled: true },
    quotas: { enforcementEnabled: true },
    demoSeedEnabled: false,
    billing: { provider: { provider: "none" }, paymentIntegrationEnabled: false },
  },
});
assert(productionReadiness.errors.includes("production_final_deletion_requires_operator_mfa"));
assert(productionReadiness.errors.includes("production_operator_mfa_mock_forbidden"));

const safeLog = JSON.stringify(redactSecrets({
  STUDENTOS_OPERATOR_MFA_MOCK_CODE: "123456",
  authorization: `Bearer ${refreshed.token}`,
}));
assert.equal(safeLog.includes("123456"), false);
assert.equal(safeLog.includes(refreshed.token), false);

const operatorJs = await readFile(new URL("../frontend/scripts/operator.js", import.meta.url), "utf8");
const operatorHtml = await readFile(new URL("../frontend/operator.html", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/202605250019_studentos_pass22_mfa_billing_alerts.sql", import.meta.url), "utf8");
for (const frontend of [operatorJs, operatorHtml]) {
  assert.equal(frontend.includes("STUDENTOS_OPERATOR_MFA_MOCK_CODE"), false);
  assert.equal(frontend.includes("STUDENTOS_OPERATOR_SESSION_SECRET"), false);
  assert.equal(frontend.includes("service_role"), false);
  assert.equal(frontend.includes("adminDeleteUser"), false);
}
assert(operatorJs.includes("/api/internal/operator/mfa/challenge"));
assert(operatorJs.includes("/api/internal/operator/mfa/verify"));
assert(migration.includes("monitoring_alert_events"));
assert(migration.includes("provider_cancelled_at_period_end"));

console.log("PASS | StudentOS Pass 22 operator MFA, billing reconciliation, and monitoring alert tests passed");
