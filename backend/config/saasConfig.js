import { getSafeAiProviderStatus } from "../ai/providerConfig.js";
import { getSafeEmbeddingStatus } from "../embeddings/embeddingService.js";
import { getPlan, getPublicPlanCatalog, USER_ROLES } from "../saas/plans.js";
import { getSafeBillingProviderStatus, getPublicBillingProviderStatus } from "../billing/providerConfig.js";
import { normalizePlanKey } from "../domain/planEntitlementService.js";

const DEFAULT_CORS_ORIGINS = [
  "https://studentos.sentiqlabs.com",
  "https://studentos-39s.pages.dev",
  "http://localhost:3101",
  "http://localhost:3102",
  "http://127.0.0.1:3101",
  "http://127.0.0.1:3102",
].join(",");
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

export function getDeploymentEnvironment(env = process.env) {
  const explicit = readValue(env, "STUDENTOS_ENV") || readValue(env, "NODE_ENV") || "development";
  const normalized = explicit.toLowerCase();
  if (["production", "prod"].includes(normalized)) return "production";
  if (["staging", "stage", "preview"].includes(normalized)) return "staging";
  return "development";
}

export function isDemoSeedAllowed() {
  return false;
}

export function getSaasConfig({
  env = process.env,
  supabaseConfig,
  aiConfig,
  embeddingConfig,
  billingConfig,
} = {}) {
  const deployment = getDeploymentEnvironment(env);
  const defaultPlan = normalizePlanKey(readValue(env, "STUDENTOS_DEFAULT_PLAN", "starter"));
  return {
    product: {
      name: "StudentOS",
      ownerBrand: "SentIQ AI Labs",
      displayName: "StudentOS by SentIQ AI Labs",
    },
    deployment,
    environmentStrategy: {
      environments: ["development", "staging", "production"],
      topology: "1 auth project + 3 data shards per environment",
      activeEnvironment: deployment,
    },
    corsOrigins: readValue(env, "CORS_ORIGINS", DEFAULT_CORS_ORIGINS)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    demoSeedEnabled: isDemoSeedAllowed({ env, supabaseConfig }),
    roles: {
      active: [USER_ROLES.STUDENT],
      future: [USER_ROLES.PARENT_GUARDIAN, USER_ROLES.TEACHER_INSTITUTION, USER_ROLES.ADMIN_INTERNAL],
    },
    billing: {
      defaultPlan,
      plans: getPublicPlanCatalog(),
      provider: billingConfig ? getSafeBillingProviderStatus(billingConfig) : null,
      paymentIntegrationEnabled: Boolean(billingConfig?.checkoutRedirectEnabled),
    },
    quotas: {
      enforcementEnabled: readBool(env, "STUDENTOS_QUOTA_ENFORCEMENT", false),
      defaultPlan: getPlan(defaultPlan),
    },
    rateLimit: {
      enabled: readBool(env, "STUDENTOS_RATE_LIMIT_ENABLED", deployment === "production"),
      windowMs: readInt(env, "STUDENTOS_RATE_LIMIT_WINDOW_MS", 60_000),
      maxRequests: readInt(env, "STUDENTOS_RATE_LIMIT_MAX_REQUESTS", deployment === "production" ? 120 : 600),
    },
    security: {
      frontendReceivesServiceKeys: false,
      shardAccessBackendOnly: true,
      privateStorageDefault: true,
      rlsRequired: true,
      realSubmissionEnabled: false,
      sourceCitationStrict: true,
    },
    providers: {
      ai: aiConfig ? getSafeAiProviderStatus(aiConfig) : null,
      embeddings: embeddingConfig ? getSafeEmbeddingStatus(embeddingConfig) : null,
    },
  };
}

function duplicateValues(values = []) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function containsLocalhost(value = "") {
  return /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(String(value || ""));
}

export function validateProductionReadiness({ env = process.env, supabaseConfig, saasConfig } = {}) {
  const config = saasConfig || getSaasConfig({ env, supabaseConfig });
  const errors = [];
  const warnings = [];
  if (config.deployment === "production") {
    if (supabaseConfig?.mode !== "supabase") errors.push("production_requires_supabase_mode");
    if (!supabaseConfig?.authConfigured) errors.push("production_auth_project_missing");
    if (!supabaseConfig?.shardsConfigured) errors.push("production_data_shards_missing");
    if (!supabaseConfig?.jwtSecretPresent) errors.push("production_jwt_secret_missing");
    if (!readValue(env, "STUDENTOS_STORAGE_BUCKET")) errors.push("production_storage_bucket_missing");
    if (!readValue(env, "STUDENTOS_EXPORT_STORAGE_BUCKET")) warnings.push("production_export_bucket_falls_back_to_source_bucket");
    if (!readValue(env, "CORS_ORIGINS")) errors.push("production_cors_origins_missing");
    if (!config.rateLimit.enabled) errors.push("production_rate_limit_disabled");
    if (Number(config.rateLimit.maxRequests || 0) > 240) warnings.push("production_rate_limit_threshold_high");
    if (!config.quotas.enforcementEnabled) warnings.push("production_quota_enforcement_disabled");
    if (config.demoSeedEnabled || readBool(env, "STUDENTOS_DEMO_SEED_ENABLED", false)) {
      errors.push("production_demo_seed_must_be_disabled");
    }
    if (containsLocalhost(readValue(env, "CORS_ORIGINS"))) errors.push("production_cors_origins_include_localhost");
    if (containsLocalhost(readValue(env, "STUDENTOS_API_BASE"))) errors.push("production_api_base_points_to_localhost");
    if (containsLocalhost(readValue(env, "STUDENTOS_PUBLIC_API_BASE_URL"))) errors.push("production_public_api_base_points_to_localhost");
    if (config.billing.provider?.liveChargesRequested && !config.billing.provider?.configured) {
      errors.push("production_billing_provider_misconfigured");
    }
    if (config.billing.provider?.provider === "mock") errors.push("production_mock_billing_provider_forbidden");
    if (config.billing.paymentIntegrationEnabled) warnings.push("production_billing_launch_review_required");
    if (readBool(env, "STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED", false)) {
      warnings.push("production_final_deletion_launch_review_required");
      if (!readBool(env, "STUDENTOS_INTERNAL_OPS_ENABLED", false)) {
        errors.push("production_final_deletion_requires_internal_ops");
      }
      if (!readBool(env, "STUDENTOS_AUTH_ADMIN_DELETE_ENABLED", false)) {
        errors.push("production_final_deletion_requires_auth_admin_delete_boundary");
      }
      if (!readBool(env, "STUDENTOS_DELETION_DUAL_CONTROL_REQUIRED", true)) {
        errors.push("production_final_deletion_requires_dual_control");
      }
      if (!readBool(env, "STUDENTOS_DELETION_EVIDENCE_ENABLED", true)) {
        errors.push("production_final_deletion_requires_immutable_evidence");
      }
      if (!readBool(env, "STUDENTOS_BILLING_CANCELLATION_PROVIDER_CALLS_ENABLED", false) &&
          !readBool(env, "STUDENTOS_BILLING_CANCELLATION_MANUAL_WAIVER_ENABLED", false)) {
        errors.push("production_final_deletion_requires_billing_cancellation_safeguard");
      }
      if (!readBool(env, "STUDENTOS_OPERATOR_MFA_REQUIRED", false)) {
        errors.push("production_final_deletion_requires_operator_mfa");
      }
    }
    if (readBool(env, "STUDENTOS_AUTH_ADMIN_DELETE_ENABLED", false) &&
        !readBool(env, "STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED", false)) {
      warnings.push("auth_admin_delete_boundary_enabled_while_final_deletion_disabled");
    }
    if (readBool(env, "STUDENTOS_INTERNAL_OPS_ENABLED", false)) {
      if (!readValue(env, "STUDENTOS_INTERNAL_OPS_TOKEN")) errors.push("production_internal_ops_token_missing");
      if (!readValue(env, "STUDENTOS_OPERATOR_SESSION_SECRET")) errors.push("production_operator_session_secret_missing");
      if (!readValue(env, "STUDENTOS_OPERATOR_ROSTER_JSON")) errors.push("production_operator_roster_missing");
    }
    if (readBool(env, "STUDENTOS_OPERATOR_MFA_REQUIRED", false) && !readValue(env, "STUDENTOS_OPERATOR_MFA_METHODS")) {
      errors.push("production_operator_mfa_methods_missing");
    }
    if (readBool(env, "STUDENTOS_OPERATOR_MFA_MOCK_ENABLED", false)) {
      errors.push("production_operator_mfa_mock_forbidden");
    }
    if (readBool(env, "STUDENTOS_BILLING_CANCELLATION_PROVIDER_CALLS_ENABLED", false)) {
      warnings.push("production_billing_cancellation_provider_launch_review_required");
    }
    if (readBool(env, "STUDENTOS_BILLING_CANCELLATION_MANUAL_WAIVER_ENABLED", false)) {
      warnings.push("production_billing_cancellation_manual_waiver_review_required");
    }
  }
  const urls = [
    supabaseConfig?.auth?.url,
    ...(supabaseConfig?.shards || []).map((shard) => shard.url),
  ];
  if (duplicateValues(urls).length) errors.push("supabase_project_urls_must_be_distinct");
  const shardServiceKeys = (supabaseConfig?.shards || []).map((shard) => shard.serviceRoleKey);
  if (duplicateValues(shardServiceKeys).length) warnings.push("data_shard_service_keys_reused");
  return {
    ok: errors.length === 0,
    deployment: config.deployment,
    errors,
    warnings,
    secretsPrinted: false,
  };
}

export function getPublicSaasStatus(config) {
  return {
    product: config.product,
    deployment: config.deployment,
    environmentStrategy: config.environmentStrategy,
    roles: config.roles,
    billing: {
      ...config.billing,
      provider: getPublicBillingProviderStatus({
        provider: config.billing?.provider?.provider || "none",
        providers: {
          [config.billing?.provider?.provider || "none"]: {
            configured: config.billing?.provider?.configured === true,
          },
        },
        liveChargesRequested: config.billing?.provider?.liveChargesRequested === true,
        liveChargesEnabled: config.billing?.provider?.liveChargesEnabled === true,
        checkoutRedirectEnabled: config.billing?.provider?.checkoutRedirectEnabled === true,
      }),
    },
    quotas: {
      enforcementEnabled: config.quotas.enforcementEnabled,
      defaultPlan: {
        id: config.quotas.defaultPlan.id,
        label: config.quotas.defaultPlan.label,
      },
    },
    rateLimit: config.rateLimit,
    security: config.security,
  };
}
