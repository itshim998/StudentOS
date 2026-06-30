import assert from "node:assert/strict";
import { initialStateForUser } from "./repository/studentOsRepository.js";
import {
  createAccountDeletionRequest,
  createDataExportRequest,
  getAccountSnapshot,
  getQuotaUsage,
  requestPasswordReset,
  updateConsentPreferences,
} from "./account/accountService.js";
import { getPublicAuthConfig, getSupabaseEnvironment } from "./config/supabaseEnv.js";
import { getPublicSaasStatus, getSaasConfig, isDemoSeedAllowed } from "./config/saasConfig.js";

const now = new Date("2026-05-27T10:00:00+05:30");
const state = initialStateForUser({ id: "student_account_test", email: "account@studentos.local" });
state.aiMessages = [
  { id: "msg_1", role: "user", content: "help" },
  { id: "msg_2", role: "assistant", content: "ok" },
];
state.sourceMaterials.push({
  id: "src_quota",
  title: "Quota source",
  sizeBytes: 2048,
  status: "indexed",
});

const supabaseConfig = getSupabaseEnvironment({ STUDENTOS_MODE: "mock" });
const saasConfig = getSaasConfig({ env: { STUDENTOS_DEFAULT_PLAN: "starter" }, supabaseConfig });
const session = {
  authenticated: false,
  mode: "local_demo",
  user: { id: "student_demo_001", email: "demo@studentos.local" },
};

const snapshot = getAccountSnapshot({ session, state, saasConfig });
assert.equal(snapshot.user.emailVerificationReady, true);
assert.equal(snapshot.actions.directDeletionEnabled, false);
assert.equal(snapshot.actions.paymentsEnabled, false);
assert.equal(snapshot.profile.role, "student");
assert.equal(snapshot.quota.plan.id, "unselected");
assert.equal(snapshot.quota.plan.access.planKey, null);
assert.equal("usage" in snapshot.quota, false);
assert.equal("quotas" in snapshot.quota, false);
assert.equal(JSON.stringify(snapshot).includes("service_role"), false);

const usage = getQuotaUsage(state, saasConfig);
assert.equal(usage.paymentsEnabled, false);
assert.equal(usage.upgradeAvailable, true);
assert.equal(usage.academicContext.status, "unavailable");
assert.doesNotMatch(JSON.stringify(usage), /storageBytes|aiRequestsPerDay|maxSources/);

const consent = updateConsentPreferences(state, {
  aiPersonalization: false,
  productResearch: true,
  externalProgressSharing: false,
  guardianSharingFuture: true,
}, now);
assert.equal(consent.aiPersonalization, false);
assert.equal(consent.productResearch, true);
assert.equal(consent.externalProgressSharing, false);
assert.equal(consent.guardianSharingFuture, true);
assert(state.auditLog.some((event) => event.action === "account.consent_preferences.updated"));

const exportRequest = createDataExportRequest(state, { scope: "student_owned_data" }, now);
assert.equal(exportRequest.status, "queued");
assert.equal(exportRequest.delivery, "manual_review_required");
assert(state.auditLog.some((event) => event.action === "account.data_export.requested"));

const courseCountBeforeDeletionRequest = state.courses.length;
const deletionRequest = createAccountDeletionRequest(state, { reason: "privacy request" }, now);
assert.equal(deletionRequest.status, "requested");
assert.equal(deletionRequest.safety, "manual_review_no_immediate_deletion");
assert.equal(state.courses.length, courseCountBeforeDeletionRequest);
assert(state.auditLog.some((event) => event.action === "account.deletion.requested" && event.metadata.directDeletion === false));

const mockReset = await requestPasswordReset({
  email: "Student@Example.com",
  supabaseConfig,
});
assert.equal(mockReset.email, "student@example.com");
assert.equal(mockReset.resetEmailRequested, false);
assert.equal(mockReset.message, "If an account exists for this email, a reset link has been sent. Please check your inbox.");
assert.equal(mockReset.secretsPrinted, false);

let recoverCalled = false;
const supabaseReset = await requestPasswordReset({
  email: "student@example.com",
  supabaseConfig: { mode: "supabase" },
  authClient: {
    isConfigured: () => true,
    recoverPassword: async (email) => {
      recoverCalled = email === "student@example.com";
      return {};
    },
  },
});
assert.equal(recoverCalled, true);
assert.equal(supabaseReset.resetEmailRequested, true);
assert.equal(supabaseReset.message, "If an account exists for this email, a reset link has been sent. Please check your inbox.");

const fakeProdEnv = {
  STUDENTOS_ENV: "production",
  STUDENTOS_MODE: "supabase",
  CORS_ORIGINS: "https://studentos.example.com",
  STUDENTOS_SUPABASE_URL_1: "https://auth.example.test",
  STUDENTOS_SUPABASE_ANON_KEY_1: "anon_public_value",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1: "auth_service_should_not_appear",
  STUDENTOS_SUPABASE_URL_2: "https://shard1.example.test",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2: "shard1_service_should_not_appear",
  STUDENTOS_SUPABASE_URL_3: "https://shard2.example.test",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3: "shard2_service_should_not_appear",
  STUDENTOS_SUPABASE_URL_4: "https://shard3.example.test",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4: "shard3_service_should_not_appear",
  STUDENTOS_SUPABASE_JWT_SECRET: "jwt_should_not_appear",
  STUDENTOS_STORAGE_BUCKET: "studentos-private-sources",
  STUDENTOS_DEMO_SEED_ENABLED: "true",
  STUDENTOS_RATE_LIMIT_ENABLED: "true",
  STUDENTOS_QUOTA_ENFORCEMENT: "true",
};
const prodSupabase = getSupabaseEnvironment(fakeProdEnv);
const publicAuth = getPublicAuthConfig(prodSupabase);
const prodSaas = getPublicSaasStatus(getSaasConfig({ env: fakeProdEnv, supabaseConfig: prodSupabase }));
const uiConfigJson = JSON.stringify({ publicAuth, prodSaas });
for (const secret of [
  "auth_service_should_not_appear",
  "shard1_service_should_not_appear",
  "shard2_service_should_not_appear",
  "shard3_service_should_not_appear",
  "jwt_should_not_appear",
]) {
  assert.equal(uiConfigJson.includes(secret), false);
}
assert.equal(publicAuth.anonKey, "anon_public_value");
assert.equal(publicAuth.signupRedirectPath, "/auth/callback");
assert.equal(isDemoSeedAllowed({ env: fakeProdEnv, supabaseConfig: prodSupabase }), false);

await assert.rejects(
  () => requestPasswordReset({ email: "not-an-email", supabaseConfig }),
  /valid email/,
);

console.log("PASS | StudentOS Pass 15 account management and UI safety tests passed");
