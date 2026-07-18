import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import {
  requestPasswordReset,
  requestVerificationResend,
} from "./account/accountService.js";
import {
  buildInternalOpsSnapshot,
  buildSafeExportPreview,
  createConsentWithdrawalRequest,
  createDataExportWorkflow,
  createDeletionWorkflow,
  createFinalDeletionScaffold,
  createRoleInvitationGroundwork,
  ensureCurrentConsentVersion,
  getAccountLifecycleConfig,
  getLifecycleSnapshot,
  recordLegalAcceptance,
  updateVersionedConsents,
} from "./account/lifecycleService.js";
import { getSupabaseEnvironment } from "./config/supabaseEnv.js";
import { getSaasConfig, isDemoSeedAllowed } from "./config/saasConfig.js";
import { redactSecrets } from "./observability/logger.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";

const now = new Date("2026-05-31T10:00:00+05:30");
const state = createSeedState(now);
const config = getAccountLifecycleConfig({});

assert.equal(config.deletionGracePeriodDays, 14);
assert.equal(config.internalOpsEnabled, false);
assert.equal(config.finalDeletionEnabled, false);
assert.equal(config.roleInvitationsEnabled, false);

const consentVersion = ensureCurrentConsentVersion(state, config, now);
assert.equal(consentVersion.privacyVersion, "privacy-2026-05");
assert.equal(consentVersion.status, "active");

const versioned = updateVersionedConsents(state, {
  aiPersonalization: true,
  guardianSharingFuture: false,
}, config, now);
assert.equal(versioned.updated.aiPersonalization, true);
assert(state.userConsents.some((item) => item.consentKey === "guardianSharingFuture" && item.granted === false));

const acceptance = recordLegalAcceptance(state, {
  accepted: true,
  acceptanceSource: "account_settings",
}, config, now);
assert.equal(acceptance.termsVersion, "terms-2026-05");
assert.equal(getLifecycleSnapshot(state, config).legal.accepted, true);
assert.throws(() => recordLegalAcceptance(state, { accepted: false }, config, now), /explicit/);

const withdrawal = createConsentWithdrawalRequest(state, {
  consentKey: "externalProgressSharing",
}, config, now);
assert.equal(withdrawal.status, "withdrawal_requested");
assert.equal(withdrawal.granted, false);
assert.equal(withdrawal.withdrawnAt, now.toISOString());

state.sourceMaterials.push({
  id: "source_sensitive",
  title: "Uploaded private notes",
  filename: "notes.txt",
  status: "indexed",
  storagePath: "user/private/path.txt",
  storageBucket: "private-bucket",
  extractedText: "Private extracted text must not appear in account export preview.",
});
state.aiMessages = [{
  id: "message_internal",
  role: "assistant",
  providerCustomerId: "provider_internal_reference",
  accessToken: "token_should_not_appear",
}];
const exportWorkflow = createDataExportWorkflow(state, { scope: "student_owned_data" }, config, now);
assert.equal(exportWorkflow.request.status, "queued");
assert.equal(exportWorkflow.job.status, "queued");
assert.equal(exportWorkflow.job.exportRequestId, exportWorkflow.request.id);
const exportJson = JSON.stringify(buildSafeExportPreview(state));
for (const forbidden of [
  "user/private/path.txt",
  "private-bucket",
  "Private extracted text",
  "provider_internal_reference",
  "token_should_not_appear",
]) {
  assert.equal(exportJson.includes(forbidden), false);
}

const deletion = createDeletionWorkflow(state, { reason: "privacy request" }, config, now);
assert.equal(deletion.status, "requested");
assert.equal(deletion.finalDeleteAllowed, false);
assert.equal(deletion.gracePeriodEndsAt, "2026-06-14T04:30:00.000Z");
const reviewed = createFinalDeletionScaffold(state, deletion.id, config, new Date("2026-06-15T00:00:00.000Z"));
assert.equal(reviewed.scaffoldOnly, true);
assert.equal(reviewed.finalDeleteExecuted, false);
assert.equal(reviewed.request.finalDeleteAllowed, false);

const invitation = createRoleInvitationGroundwork(state, {
  role: "guardian_future",
  email: "guardian@example.com",
  explicitStudentConsent: true,
}, config, now);
assert.equal(invitation.enabled, false);
assert.equal(invitation.status, "disabled");
assert.equal(invitation.studentConsentRequired, true);

assert.throws(() => buildInternalOpsSnapshot(state, config), /disabled/);
const internalSnapshot = buildInternalOpsSnapshot(state, {
  ...config,
  internalOpsEnabled: true,
});
assert.equal(internalSnapshot.secretsPrinted, false);
assert.equal(JSON.stringify(internalSnapshot).includes("token_should_not_appear"), false);

const mockSupabaseConfig = getSupabaseEnvironment({ STUDENTOS_MODE: "mock" });
const repository = new StudentOsRepository({ config: mockSupabaseConfig, shardClients: [] });
const session = { authenticated: false, mode: "local_demo", user: { id: "student_demo_001", email: "demo@studentos.local" } };
const mockState = await repository.loadState(session);
createDataExportWorkflow(mockState, {}, config, now);
createDeletionWorkflow(mockState, {}, config, now);
await repository.saveAccountLifecycle(session, mockState);
const reloaded = await repository.loadState(session);
assert.equal(reloaded.dataExportJobs.length, 1);
assert.equal(reloaded.accountDeletionRequests.length, 1);

let recoveredWithRedirect = "";
const reset = await requestPasswordReset({
  email: "Student@Example.com",
  supabaseConfig: { mode: "supabase" },
  redirectTo: "https://studentos.example.com/auth/complete",
  authClient: {
    isConfigured: () => true,
    recoverPassword: async (_email, redirectTo) => {
      recoveredWithRedirect = redirectTo;
    },
  },
});
assert.equal(reset.resetEmailRequested, true);
assert.equal(recoveredWithRedirect, "https://studentos.example.com/auth/complete");

let resendCalled = false;
const resend = await requestVerificationResend({
  email: "Student@Example.com",
  supabaseConfig: { mode: "supabase" },
  authClient: {
    isConfigured: () => true,
    resendVerification: async () => {
      resendCalled = true;
    },
  },
});
assert.equal(resendCalled, true);
assert.equal(resend.verificationEmailRequested, true);

const completionHtml = await readFile(new URL("../frontend/auth-complete.html", import.meta.url), "utf8");
const completionJs = await readFile(new URL("../frontend/scripts/auth-complete.js", import.meta.url), "utf8");
const cloudflareRedirects = await readFile(new URL("../frontend/_redirects", import.meta.url), "utf8");
assert(completionHtml.includes("recovery-complete-form"));
assert(completionHtml.includes('href="/styles/main.css"'));
assert(completionHtml.includes('src="/runtime-config.js"'));
assert(completionHtml.includes('src="/scripts/config.js"'));
assert(completionHtml.includes('src="/scripts/auth-complete.js"'));
assert(completionJs.includes("history.replaceState"));
assert(completionJs.includes("scrubAuthFragment"));
assert.equal(completionJs.includes("service_role"), false);
assert(cloudflareRedirects.includes("/auth/complete /auth-complete 200"));
assert(cloudflareRedirects.includes("/auth/complete/ /auth-complete 200"));
assert(cloudflareRedirects.includes("/auth/callback /index.html 200"));
assert(cloudflareRedirects.includes("/auth/callback/ /index.html 200"));

const prodEnv = { STUDENTOS_ENV: "production", STUDENTOS_DEMO_SEED_ENABLED: "true" };
assert.equal(isDemoSeedAllowed({ env: prodEnv, supabaseConfig: mockSupabaseConfig }), false);
assert.equal(getSaasConfig({ env: prodEnv, supabaseConfig: mockSupabaseConfig }).demoSeedEnabled, false);

const redacted = redactSecrets("STUDENTOS_INTERNAL_OPS_TOKEN=internal_token_should_not_print");
assert.equal(redacted.includes("internal_token_should_not_print"), false);

console.log("PASS | StudentOS Pass 17 identity, consent, export, and deletion tests passed");
