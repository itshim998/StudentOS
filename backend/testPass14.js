import assert from "node:assert/strict";
import { getSupabaseEnvironment } from "./config/supabaseEnv.js";
import {
  getDeploymentEnvironment,
  getPublicSaasStatus,
  getSaasConfig,
  isDemoSeedAllowed,
  validateProductionReadiness,
} from "./config/saasConfig.js";
import { getPlan, getRole, USER_ROLES } from "./saas/plans.js";
import { InMemoryRateLimiter } from "./security/rateLimiter.js";
import { checkUsagePolicy } from "./security/usagePolicy.js";
import { redactSecrets } from "./observability/logger.js";
import { runProductionPreflight } from "../scripts/preflightProduction.js";
import { createSeedState } from "./domain/studentosDomain.js";

const fakeProdEnv = {
  STUDENTOS_ENV: "production",
  STUDENTOS_MODE: "supabase",
  CORS_ORIGINS: "https://studentos.example.com",
  STUDENTOS_SUPABASE_URL_1: "https://auth-project.example.test",
  STUDENTOS_SUPABASE_ANON_KEY_1: "anon_project_1_value",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1: "service_role_auth_should_not_print",
  STUDENTOS_SUPABASE_URL_2: "https://data-shard-1.example.test",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2: "service_role_shard_1_should_not_print",
  STUDENTOS_SUPABASE_URL_3: "https://data-shard-2.example.test",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3: "service_role_shard_2_should_not_print",
  STUDENTOS_SUPABASE_URL_4: "https://data-shard-3.example.test",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4: "service_role_shard_3_should_not_print",
  STUDENTOS_SUPABASE_JWT_SECRET: "jwt_secret_should_not_print",
  STUDENTOS_STORAGE_BUCKET: "studentos-private-sources",
  STUDENTOS_DEMO_SEED_ENABLED: "true",
  STUDENTOS_RATE_LIMIT_ENABLED: "true",
  STUDENTOS_QUOTA_ENFORCEMENT: "true",
};

assert.equal(getDeploymentEnvironment({ STUDENTOS_ENV: "prod" }), "production");
assert.equal(getDeploymentEnvironment({ STUDENTOS_ENV: "preview" }), "staging");
assert.equal(getDeploymentEnvironment({ NODE_ENV: "test" }), "development");

const missingProdSupabase = getSupabaseEnvironment({
  STUDENTOS_ENV: "production",
  STUDENTOS_MODE: "mock",
});
const missingProdConfig = getSaasConfig({ env: { STUDENTOS_ENV: "production", STUDENTOS_MODE: "mock" }, supabaseConfig: missingProdSupabase });
const missingProdReadiness = validateProductionReadiness({
  env: { STUDENTOS_ENV: "production", STUDENTOS_MODE: "mock" },
  supabaseConfig: missingProdSupabase,
  saasConfig: missingProdConfig,
});
assert.equal(missingProdReadiness.ok, false);
assert(missingProdReadiness.errors.includes("production_requires_supabase_mode"));
assert(missingProdReadiness.errors.includes("production_storage_bucket_missing"));

const prodSupabase = getSupabaseEnvironment(fakeProdEnv);
const prodConfig = getSaasConfig({ env: fakeProdEnv, supabaseConfig: prodSupabase });
const prodReadiness = validateProductionReadiness({
  env: fakeProdEnv,
  supabaseConfig: prodSupabase,
  saasConfig: prodConfig,
});
assert.equal(prodReadiness.ok, true);
assert.equal(prodReadiness.secretsPrinted, false);
assert.equal(prodConfig.demoSeedEnabled, false);
assert.equal(isDemoSeedAllowed({ env: fakeProdEnv, supabaseConfig: prodSupabase }), false);

const blankNumericConfig = getSaasConfig({
  env: { STUDENTOS_RATE_LIMIT_WINDOW_MS: "", STUDENTOS_RATE_LIMIT_MAX_REQUESTS: "" },
  supabaseConfig: getSupabaseEnvironment({ STUDENTOS_MODE: "mock" }),
});
assert.equal(blankNumericConfig.rateLimit.windowMs, 60_000);
assert.equal(blankNumericConfig.rateLimit.maxRequests, 600);

const publicStatus = getPublicSaasStatus(prodConfig);
assert.equal(publicStatus.product.displayName, "StudentOS by SentIQ AI Labs");
assert.equal(publicStatus.security.frontendReceivesServiceKeys, false);
assert.equal(publicStatus.security.shardAccessBackendOnly, true);
assert.equal(JSON.stringify(publicStatus).includes("service_role"), false);

assert.equal(getRole(USER_ROLES.STUDENT), "student");
assert.equal(getRole(USER_ROLES.PARENT_GUARDIAN), "student");
assert.equal(getPlan("pro").quotas.aiRequestsPerDay > getPlan("free").quotas.aiRequestsPerDay, true);
assert.equal(getPlan("institution").features.parentTeacherViews, true);

let now = 1_000;
const limiter = new InMemoryRateLimiter({
  enabled: true,
  windowMs: 100,
  maxRequests: 2,
  now: () => now,
});
assert.equal(limiter.check("student_1").allowed, true);
assert.equal(limiter.check("student_1").allowed, true);
assert.equal(limiter.check("student_1").allowed, false);
now += 150;
assert.equal(limiter.check("student_1").allowed, true);

const redactedString = redactSecrets([
  "Authorization: Bearer token_should_not_print",
  "GROQ_API_KEY=groq_secret_should_not_print",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2=supabase_secret_should_not_print",
  "apikey: pollinations_secret_should_not_print",
].join("\n"));
assert.equal(redactedString.includes("token_should_not_print"), false);
assert.equal(redactedString.includes("groq_secret_should_not_print"), false);
assert.equal(redactedString.includes("supabase_secret_should_not_print"), false);
assert.equal(redactedString.includes("pollinations_secret_should_not_print"), false);

const preflight = runProductionPreflight(fakeProdEnv);
const preflightJson = JSON.stringify(preflight);
assert.equal(preflight.ok, true);
assert.equal(preflight.secretsPrinted, false);
for (const secret of [
  "service_role_auth_should_not_print",
  "service_role_shard_1_should_not_print",
  "service_role_shard_2_should_not_print",
  "service_role_shard_3_should_not_print",
  "jwt_secret_should_not_print",
]) {
  assert.equal(preflightJson.includes(secret), false);
}

const state = createSeedState(new Date("2026-05-27T10:00:00+05:30"));
const relaxedPolicy = checkUsagePolicy({
  saasConfig: { ...prodConfig, quotas: { ...prodConfig.quotas, enforcementEnabled: false } },
  state,
  action: "ai_call",
});
assert.equal(relaxedPolicy.allowed, true);

const enforcedState = createSeedState(new Date("2026-05-27T10:00:00+05:30"));
enforcedState.aiMessages = Array.from({ length: getPlan("free").quotas.aiRequestsPerDay }, (_, index) => ({
  id: `msg_${index}`,
  role: "user",
  content: "test",
}));
const enforcedPolicy = checkUsagePolicy({
  saasConfig: prodConfig,
  state: enforcedState,
  action: "ai_call",
});
assert.equal(enforcedPolicy.allowed, false);
assert(enforcedPolicy.violations.includes("ai_request_quota_exceeded"));

console.log("PASS | StudentOS Pass 14 SaaS foundation tests passed");
