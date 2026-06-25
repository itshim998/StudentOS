import { getAiProviderConfig } from "../backend/ai/providerConfig.js";
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
  const saasConfig = getSaasConfig({
    env,
    supabaseConfig,
    aiConfig,
    embeddingConfig,
    billingConfig,
  });
  const readiness = validateProductionReadiness({ env, supabaseConfig, saasConfig });
  if (saasConfig.deployment === "production" &&
      classroomConfig.mode === "oauth" &&
      !classroomConfig.tokenEncryptionSecret) {
    readiness.warnings.push("production_google_classroom_token_encryption_secret_missing");
  }
  if (saasConfig.deployment === "production") {
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
