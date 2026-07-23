import { getAiProviderConfig, getSafeAiProviderStatus } from "../backend/ai/providerConfig.js";
import { validateAzureAiProviderSecrets } from "./validateAzureAiProviderSecrets.js";
import { getEmbeddingConfig } from "../backend/embeddings/embeddingService.js";
import { getSaasConfig, validateProductionReadiness } from "../backend/config/saasConfig.js";
import { getSafeSupabaseStatus, getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { redactSecrets } from "../backend/observability/logger.js";
import { getBillingProviderConfig, getSafeBillingProviderStatus } from "../backend/billing/providerConfig.js";
import { getAccountLifecycleConfig, getPublicLifecycleConfig } from "../backend/account/lifecycleService.js";
import { getDataExportConfig, getPublicDataExportConfig } from "../backend/account/exportService.js";
import { getFinalDeletionSafetyConfig, getPublicFinalDeletionSafetyStatus } from "../backend/account/deletionExecutionService.js";
import { getOperatorRbacConfig, getSafeOperatorRbacStatus } from "../backend/security/operatorRbac.js";
import { getOperatorMfaConfig, getSafeOperatorMfaStatus } from "../backend/security/operatorMfa.js";
import { getBillingCancellationConfig, getSafeBillingCancellationStatus } from "../backend/billing/cancellationService.js";
import { getMonitoringAlertConfig, getSafeMonitoringAlertStatus } from "../backend/monitoring/alertService.js";
import { getGoogleClassroomConfig, getSafeGoogleClassroomStatus } from "../backend/connectors/googleClassroom/config.js";
import { getProductFlowConfig } from "../backend/domain/productLifecycleService.js";
import { getRecoveryConfig, getSafeRecoveryStatus } from "../backend/recovery/recoveryConfig.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const PAYMENT_SECRET_KEYS = Object.freeze([
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
]);

function hasAny(env, keys = []) {
  return keys.some((key) => String(env[key] || "").trim());
}

function containsLocalhost(value = "") {
  return /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(String(value || ""));
}

function containsWrongStudentOsAuthPort(value = "") {
  return /(?:localhost|127\.0\.0\.1):3000(?:\b|\/)/i.test(String(value || ""));
}

export function runProductionPreflight(env = process.env) {
  const supabaseConfig = getSupabaseEnvironment(env);
  const aiConfig = getAiProviderConfig(env);
  const embeddingConfig = getEmbeddingConfig(env);
  const billingConfig = getBillingProviderConfig(env);
  const lifecycleConfig = getAccountLifecycleConfig(env);
  const dataExportConfig = getDataExportConfig(env, supabaseConfig);
  const finalDeletionConfig = getFinalDeletionSafetyConfig(env);
  const operatorRbacConfig = getOperatorRbacConfig(env);
  const operatorMfaConfig = getOperatorMfaConfig(env);
  const billingCancellationConfig = getBillingCancellationConfig(env);
  const monitoringAlertConfig = getMonitoringAlertConfig(env);
  const classroomConfig = getGoogleClassroomConfig(env);
  const recoveryConfig = getRecoveryConfig(env);
  const saasConfig = getSaasConfig({
    env,
    supabaseConfig,
    aiConfig,
    embeddingConfig,
    billingConfig,
  });
  const productFlowConfig = getProductFlowConfig(env, saasConfig.deployment);
  const readiness = validateProductionReadiness({ env, supabaseConfig, saasConfig });
  const aiProviderValidation = validateAzureAiProviderSecrets(env);
  const authRedirectUsesWrongLocalPort = [
    env.STUDENTOS_AUTH_REDIRECT_URL,
    env.STUDENTOS_PUBLIC_FRONTEND_URL,
  ].some(containsWrongStudentOsAuthPort);
  if (authRedirectUsesWrongLocalPort) {
    readiness.errors.push("studentos_auth_redirect_uses_wrong_local_port");
    readiness.ok = false;
  }
  if (saasConfig.deployment === "production" &&
      classroomConfig.mode === "oauth" &&
      !classroomConfig.tokenEncryptionSecret) {
    readiness.warnings.push("production_google_classroom_token_encryption_secret_missing");
  }
  if (saasConfig.deployment === "production") {
    if (aiConfig.routing.v2.enabled) {
      if (!supabaseConfig.auth.serviceRoleKey) readiness.errors.push("ai_router_v2_requires_auth_project_service_role");
      if (!aiProviderValidation.ok) readiness.errors.push(`ai_router_v2_provider_configuration_invalid:${aiProviderValidation.errorCode}`);
      if (aiConfig.pollinations.textModel !== "gpt-oss") readiness.errors.push("pollinations_required_model_must_be_gpt_oss");
      if (readiness.errors.length) readiness.ok = false;
    }
    if (recoveryConfig.enabled && String(env.STUDENTOS_BACKGROUND_WORKERS_ENABLED || "").toLowerCase() !== "true") {
      readiness.errors.push("adaptive_recovery_requires_background_workers");
      readiness.ok = false;
    }
    if (classroomConfig.mode === "mock") {
      readiness.warnings.push("production_google_classroom_mock_mode_should_be_disabled_or_oauth");
    }
    if (classroomConfig.mode === "oauth" && containsLocalhost(classroomConfig.redirectUri)) {
      readiness.errors.push("production_google_classroom_redirect_points_to_localhost");
      readiness.ok = false;
    }
    if (billingConfig.provider === "none" && hasAny(env, PAYMENT_SECRET_KEYS)) {
      readiness.warnings.push("payment_provider_keys_present_while_billing_provider_none");
    }
    if (embeddingConfig.mode !== "real") {
      readiness.warnings.push("production_mock_embeddings_early_beta");
    }
  }
  return redactSecrets({
    ok: readiness.ok,
    product: saasConfig.product.displayName,
    deployment: saasConfig.deployment,
    environmentStrategy: saasConfig.environmentStrategy,
    readiness,
    supabase: getSafeSupabaseStatus(supabaseConfig),
    rateLimit: saasConfig.rateLimit,
    quotas: {
      enforcementEnabled: saasConfig.quotas.enforcementEnabled,
      defaultPlan: saasConfig.quotas.defaultPlan.id,
    },
    demoSeedEnabled: saasConfig.demoSeedEnabled,
    billing: getSafeBillingProviderStatus(billingConfig),
    accountLifecycle: getPublicLifecycleConfig(lifecycleConfig),
    dataExports: getPublicDataExportConfig(dataExportConfig),
    finalDeletionSafety: getPublicFinalDeletionSafetyStatus(finalDeletionConfig),
    operatorRbac: getSafeOperatorRbacStatus(operatorRbacConfig),
    operatorMfa: getSafeOperatorMfaStatus(operatorMfaConfig),
    billingCancellationSafety: getSafeBillingCancellationStatus(billingCancellationConfig),
    monitoringAlerts: getSafeMonitoringAlertStatus(monitoringAlertConfig),
    googleClassroom: getSafeGoogleClassroomStatus(classroomConfig),
    adaptiveRecovery: getSafeRecoveryStatus(recoveryConfig),
    aiProviders: getSafeAiProviderStatus(aiConfig),
    aiProviderValidation,
    productFlow: productFlowConfig,
    authRedirects: {
      signupCallbackPath: "/auth/callback",
      wrongLocalPortDetected: authRedirectUsesWrongLocalPort,
    },
    secretsPrinted: false,
  });
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const result = runProductionPreflight(process.env);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: redactSecrets(error?.message || error),
      secretsPrinted: false,
    }, null, 2));
    process.exit(1);
  });
}
