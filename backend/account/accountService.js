import { resolveEntitlements } from "../billing/billingService.js";
import {
  createDataExportWorkflow,
  createDeletionWorkflow,
  getAccountLifecycleConfig,
  getLifecycleSnapshot,
  updateVersionedConsents,
} from "./lifecycleService.js";

function nowIso(now = new Date()) {
  return now.toISOString();
}

function requestId(prefix = "acct") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function activeSources(state) {
  return (state.sourceMaterials || []).filter((source) => !source.deletedAt);
}

function storageBytesUsed(state) {
  return activeSources(state).reduce((total, source) => total + Number(source.sizeBytes || 0), 0);
}

function aiRequestCount(state) {
  return (state.aiMessages || []).filter((message) => message.role === "user").length;
}

function workerJobCount(state) {
  return (state.backgroundJobs || []).length;
}

function accountPreferences(state) {
  state.studentProfile.preferences = state.studentProfile.preferences || {};
  state.studentProfile.preferences.accountManagement = state.studentProfile.preferences.accountManagement || {};
  state.studentProfile.preferences.consent = {
    externalProgressSharing: false,
    guardianSharingFuture: false,
    productResearch: false,
    aiPersonalization: true,
    ...(state.studentProfile.preferences.consent || {}),
  };
  return state.studentProfile.preferences;
}

export function getAccountPlan(state, saasConfig) {
  return resolveEntitlements(state, saasConfig?.billing?.defaultPlan || "free");
}

export function getQuotaUsage(state, saasConfig) {
  const entitlements = getAccountPlan(state, saasConfig);
  return {
    plan: {
      id: entitlements.plan.id,
      label: entitlements.plan.label,
      features: entitlements.features,
    },
    subscription: entitlements.subscription,
    usage: {
      aiRequestsToday: aiRequestCount(state),
      uploadsToday: activeSources(state).length,
      sourceCount: activeSources(state).length,
      courses: (state.courses || []).length,
      workerJobsToday: workerJobCount(state),
      reindexJobsToday: (state.backgroundJobs || []).filter((job) => job.jobType === "source_reindex").length,
      storageBytes: storageBytesUsed(state),
    },
    quotas: entitlements.quotas,
    enforcementEnabled: saasConfig?.quotas?.enforcementEnabled === true,
    upgradeAvailable: true,
    paymentsEnabled: saasConfig?.billing?.paymentIntegrationEnabled === true,
  };
}

export function getAccountSnapshot({ session, state, saasConfig, lifecycleConfig = getAccountLifecycleConfig() }) {
  const preferences = accountPreferences(state);
  const accountManagement = preferences.accountManagement;
  const lifecycle = getLifecycleSnapshot(state, lifecycleConfig);
  return {
    user: {
      id: session?.user?.id || state.studentProfile.id,
      email: session?.user?.email || "demo@studentos.local",
      authenticated: Boolean(session?.authenticated),
      authMode: session?.mode || "local_demo",
      emailVerificationReady: true,
      emailVerified: Boolean(session?.user?.emailConfirmedAt || session?.user?.email_confirmed_at),
    },
    profile: {
      displayName: state.studentProfile.displayName,
      role: "student",
      visibility: state.studentProfile.visibility,
      consent: preferences.consent,
    },
    quota: getQuotaUsage(state, saasConfig),
    requests: {
      exportRequests: lifecycle.exportRequests.length ? lifecycle.exportRequests : accountManagement.exportRequests || [],
      deletionRequests: lifecycle.deletionRequests.length ? lifecycle.deletionRequests : accountManagement.deletionRequests || [],
    },
    lifecycle,
    actions: {
      passwordResetAvailable: true,
      dataExportRequestAvailable: true,
      accountDeletionRequestAvailable: true,
      directDeletionEnabled: false,
      paymentsEnabled: saasConfig?.billing?.paymentIntegrationEnabled === true,
    },
    secretsPrinted: false,
  };
}

export async function requestPasswordReset({ email, authClient, supabaseConfig, redirectTo = "" }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    const error = new Error("Enter a valid email for password reset");
    error.status = 400;
    throw error;
  }
  const response = {
    ok: true,
    email: normalizedEmail,
    emailVerificationReady: true,
    resetEmailRequested: false,
    mode: supabaseConfig?.mode === "supabase" ? "supabase_auth_project" : "local_scaffold",
    message: "If an account exists for this email, a reset link can be sent by the StudentOS Auth project.",
    secretsPrinted: false,
  };
  if (supabaseConfig?.mode === "supabase" && authClient?.isConfigured?.() && typeof authClient.recoverPassword === "function") {
    await authClient.recoverPassword(normalizedEmail, redirectTo);
    response.resetEmailRequested = true;
  }
  return response;
}

export async function requestVerificationResend({ email, authClient, supabaseConfig }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    const error = new Error("Enter a valid email for verification");
    error.status = 400;
    throw error;
  }
  const response = {
    ok: true,
    email: normalizedEmail,
    verificationEmailRequested: false,
    mode: supabaseConfig?.mode === "supabase" ? "supabase_auth_project" : "local_scaffold",
    message: "If an unverified account exists for this email, StudentOS will send a fresh verification link.",
    secretsPrinted: false,
  };
  if (supabaseConfig?.mode === "supabase" && authClient?.isConfigured?.() && typeof authClient.resendVerification === "function") {
    await authClient.resendVerification(normalizedEmail);
    response.verificationEmailRequested = true;
  }
  return response;
}

export function updateConsentPreferences(state, payload = {}, now = new Date(), lifecycleConfig = getAccountLifecycleConfig()) {
  const preferences = accountPreferences(state);
  const consent = preferences.consent;
  const allowedKeys = ["externalProgressSharing", "guardianSharingFuture", "productResearch", "aiPersonalization"];
  for (const key of allowedKeys) {
    if (key in payload) consent[key] = Boolean(payload[key]);
  }
  consent.updatedAt = nowIso(now);
  state.auditLog.push({
    id: requestId("audit_consent"),
    actorId: state.studentProfile.id,
    action: "account.consent_preferences.updated",
    targetType: "student_profile",
    targetId: state.studentProfile.id,
    riskLevel: "low",
    metadata: {
      externalProgressSharing: consent.externalProgressSharing,
      guardianSharingFuture: consent.guardianSharingFuture,
      productResearch: consent.productResearch,
      aiPersonalization: consent.aiPersonalization,
    },
    createdAt: nowIso(now),
  });
  updateVersionedConsents(state, payload, lifecycleConfig, now);
  return consent;
}

export function createDataExportRequest(state, payload = {}, now = new Date()) {
  const preferences = accountPreferences(state);
  const { request } = createDataExportWorkflow(state, payload, getAccountLifecycleConfig(), now);
  preferences.accountManagement.exportRequests = [
    request,
    ...(preferences.accountManagement.exportRequests || []),
  ].slice(0, 10);
  return request;
}

export function createAccountDeletionRequest(state, payload = {}, now = new Date()) {
  const preferences = accountPreferences(state);
  const request = createDeletionWorkflow(state, payload, getAccountLifecycleConfig(), now);
  preferences.accountManagement.deletionRequests = [
    request,
    ...(preferences.accountManagement.deletionRequests || []),
  ].slice(0, 10);
  return request;
}
