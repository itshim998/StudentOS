import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import {
  OPERATOR_PERMISSIONS,
  createOperatorSession,
  getOperatorRbacConfig,
  getSafeOperatorRbacStatus,
  verifyOperatorSession,
} from "./security/operatorRbac.js";
import {
  evaluateBillingCancellation,
  getBillingCancellationConfig,
  getSafeBillingCancellationStatus,
} from "./billing/cancellationService.js";
import { buildOperatorAuditEvent } from "./observability/operatorAuditService.js";
import { redactSecrets } from "./observability/logger.js";
import { validateProductionReadiness } from "./config/saasConfig.js";

const now = new Date("2026-06-01T00:00:00.000Z");
const rbacEnv = {
  STUDENTOS_INTERNAL_OPS_ENABLED: "true",
  STUDENTOS_INTERNAL_OPS_TOKEN: "bootstrap-pass21-token",
  STUDENTOS_OPERATOR_SESSION_SECRET: "session-pass21-secret",
  STUDENTOS_OPERATOR_SESSION_TTL_SECONDS: "120",
  STUDENTOS_OPERATOR_ROSTER_JSON: JSON.stringify([
    { id: "owner-one", role: "owner" },
    { id: "privacy-one", role: "privacy_reviewer" },
    { id: "auditor-one", role: "read_only_auditor" },
  ]),
};

assert.equal(getOperatorRbacConfig({}).enabled, false);
assert.equal(getSafeOperatorRbacStatus(getOperatorRbacConfig({})).publicAccess, false);
assert.throws(() => createOperatorSession({
  operatorId: "owner-one",
  bootstrapToken: "bootstrap-pass21-token",
  config: getOperatorRbacConfig({}),
}), /disabled/);

const rbacConfig = getOperatorRbacConfig(rbacEnv);
const ownerSession = createOperatorSession({
  operatorId: "owner-one",
  bootstrapToken: rbacEnv.STUDENTOS_INTERNAL_OPS_TOKEN,
  config: rbacConfig,
  now,
});
const owner = verifyOperatorSession(ownerSession.token, {
  config: rbacConfig,
  permission: OPERATOR_PERMISSIONS.DELETION_EXECUTE,
  now: new Date("2026-06-01T00:01:00.000Z"),
});
assert.equal(owner.role, "owner");
assert(owner.permissions.includes(OPERATOR_PERMISSIONS.BILLING_WAIVE));
assert.throws(() => verifyOperatorSession(ownerSession.token, {
  config: rbacConfig,
  now: new Date("2026-06-01T00:03:00.000Z"),
}), /expired/);

const privacySession = createOperatorSession({
  operatorId: "privacy-one",
  bootstrapToken: rbacEnv.STUDENTOS_INTERNAL_OPS_TOKEN,
  config: rbacConfig,
  now,
});
assert.throws(() => verifyOperatorSession(privacySession.token, {
  config: rbacConfig,
  permission: OPERATOR_PERMISSIONS.DELETION_EXECUTE,
  now,
}), /permission denied/);
assert.equal(verifyOperatorSession(privacySession.token, {
  config: rbacConfig,
  permission: OPERATOR_PERMISSIONS.DELETION_REVIEW,
  now,
}).role, "privacy_reviewer");

const state = createSeedState(now);
const noBilling = evaluateBillingCancellation({ state });
assert.equal(noBilling.satisfied, true);
assert.equal(noBilling.status, "not_required");
state.billingSubscriptions = [{
  id: "billing-active",
  userId: state.studentProfile.id,
  planId: "pro",
  provider: "stripe",
  status: "active",
  providerSubscriptionId: "safe-provider-reference",
  updatedAt: now.toISOString(),
}];
const adapter = {
  prepareCancellation: () => ({
    provider: "stripe",
    status: "scaffold_only",
    providerCallExecuted: false,
    secretsPrinted: false,
  }),
};
const blockedCancellation = evaluateBillingCancellation({
  state,
  adapter,
  config: getBillingCancellationConfig({}),
});
assert.equal(blockedCancellation.blocksExecution, true);
assert.equal(blockedCancellation.providerCallExecuted, false);
const waivedCancellation = evaluateBillingCancellation({
  state,
  adapter,
  config: getBillingCancellationConfig({
    STUDENTOS_BILLING_CANCELLATION_MANUAL_WAIVER_ENABLED: "true",
  }),
  canWaive: true,
  waiver: {
    acknowledged: true,
    note: "Provider cancellation evidence reviewed manually.",
  },
});
assert.equal(waivedCancellation.satisfied, true);
assert.equal(waivedCancellation.status, "manually_waived_with_evidence");
assert.equal(getSafeBillingCancellationStatus().liveCancellationImplemented, false);

const audit = buildOperatorAuditEvent({
  requestId: "request-pass21",
  operator: owner,
  targetUserId: state.studentProfile.id,
  action: "account.deletion.execution.requested",
  note: "Reviewed safely with secret=should-never-appear.",
  metadata: {
    result: "blocked",
    storagePath: "private/path/material.pdf",
    extractedText: "raw extracted content",
    nested: { apiKey: "should-not-appear", count: 2 },
  },
  now,
});
const auditText = JSON.stringify(audit);
assert.equal(auditText.includes("should-never-appear"), false);
assert.equal(auditText.includes("private/path"), false);
assert.equal(auditText.includes("raw extracted"), false);
assert.equal(auditText.includes("should-not-appear"), false);
assert.equal(audit.metadata.nested.count, 2);

const safeLog = JSON.stringify(redactSecrets({
  STUDENTOS_OPERATOR_SESSION_SECRET: "not-for-output",
  authorization: `Bearer ${ownerSession.token}`,
}));
assert.equal(safeLog.includes("not-for-output"), false);
assert.equal(safeLog.includes(ownerSession.token), false);

const productionReadiness = validateProductionReadiness({
  env: {
    STUDENTOS_ENV: "production",
    STUDENTOS_STORAGE_BUCKET: "private-source",
    CORS_ORIGINS: "https://studentos.example",
    STUDENTOS_INTERNAL_OPS_ENABLED: "true",
    STUDENTOS_INTERNAL_OPS_TOKEN: "configured",
    STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED: "true",
    STUDENTOS_AUTH_ADMIN_DELETE_ENABLED: "true",
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
assert(productionReadiness.errors.includes("production_operator_session_secret_missing"));
assert(productionReadiness.errors.includes("production_operator_roster_missing"));
assert(productionReadiness.errors.includes("production_final_deletion_requires_billing_cancellation_safeguard"));

const operatorJs = await readFile(new URL("../frontend/scripts/operator.js", import.meta.url), "utf8");
const operatorHtml = await readFile(new URL("../frontend/operator.html", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/202605250018_studentos_pass21_operator_rbac_monitoring.sql", import.meta.url), "utf8");
for (const frontend of [operatorJs, operatorHtml]) {
  assert.equal(frontend.includes("service_role"), false);
  assert.equal(frontend.includes("STUDENTOS_OPERATOR_SESSION_SECRET"), false);
  assert.equal(frontend.includes("adminDeleteUser"), false);
}
assert(operatorJs.includes("/api/internal/operator/session"));
assert(operatorJs.includes("Authorization: `Bearer ${operatorSession.token}`"));
assert(migration.includes("operator_audit_events"));
assert(migration.includes("billing_cancellation_events"));
assert(migration.includes("operator_audit_events_append_only_update"));
assert(migration.includes("billing_cancellation_events_append_only_delete"));

console.log("PASS | StudentOS Pass 21 operator RBAC, monitoring, and billing cancellation safety tests passed");
