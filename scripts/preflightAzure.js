import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  AZURE_GROQ_SECRET_MAPPINGS,
  AZURE_GROQ_SECRET_NAMES,
  isAzureContainerAppSafeSecretName,
  validateAzureGroqSecrets,
} from "./validateAzureGroqSecrets.js";
import {
  AZURE_GEMINI_SECRET_MAPPINGS,
  AZURE_GEMINI_SECRET_NAMES,
  AZURE_NVIDIA_SECRET_MAPPINGS,
  validateAzureAiProviderSecrets,
} from "./validateAzureAiProviderSecrets.js";

const ROOT = process.cwd();
const checks = [];

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return existsSync(path.join(ROOT, relativePath));
}

function addCheck(name, ok, details = {}) {
  checks.push({ name, ok: Boolean(ok), ...details });
}

function listFiles(dir, files = []) {
  if (!exists(dir)) return files;
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, entry).replace(/\\/g, "/");
    const full = path.join(ROOT, rel);
    const stat = statSync(full);
    if (stat.isDirectory()) listFiles(rel, files);
    else files.push(rel);
  }
  return files;
}

function gitLsFiles() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function containsAny(text, patterns) {
  return patterns.filter((pattern) => pattern.test(text));
}

function includesAll(text, values) {
  return values.every((value) => text.includes(value));
}

const dockerfile = exists("Dockerfile") ? read("Dockerfile") : "";
const dockerignore = exists(".dockerignore") ? read(".dockerignore") : "";
const pkg = JSON.parse(read("package.json"));
const server = read("backend/server.js");
const workflow = exists(".github/workflows/azure-container-apps-studentos.yml")
  ? read(".github/workflows/azure-container-apps-studentos.yml")
  : "";
const recoveryRolloutWorkflow = exists(".github/workflows/adaptive-recovery-rollout.yml")
  ? read(".github/workflows/adaptive-recovery-rollout.yml")
  : "";
const envExample = exists(".env.example") ? read(".env.example") : "";
const envTemplate = exists(".env.template") ? read(".env.template") : "";
const frontendText = listFiles("frontend")
  .map((file) => read(file))
  .join("\n");
const classroomText = [
  ...listFiles("backend/connectors/googleClassroom"),
  ...listFiles("frontend/scripts"),
].map((file) => read(file)).join("\n");

addCheck("Dockerfile exists", exists("Dockerfile"));
addCheck("Dockerfile excludes env copy", dockerfile && !/COPY\s+\.env/i.test(dockerfile) && !dockerfile.includes(".env "));
addCheck("Dockerfile production install", /npm\s+ci\s+--omit=dev/.test(dockerfile));
addCheck("Dockerfile exposes 3101", /EXPOSE\s+3101/.test(dockerfile));
addCheck("Dockerfile runs npm start", dockerfile.includes('CMD ["npm", "start"]'));
addCheck("Dockerfile does not copy frontend", !/^COPY\s+frontend\b/im.test(dockerfile));

for (const pattern of [".env", ".env.*", "node_modules", "frontend/", "test-results", "playwright-report", ".playwright", "uploads", "local_uploads", "*.log", "secrets", "*.key", "*.pem"]) {
  addCheck(`.dockerignore protects ${pattern}`, dockerignore.includes(pattern));
}

addCheck("package start exists", pkg.scripts?.start === "node backend/server.js");
addCheck("package preflight exists", pkg.scripts?.preflight === "npm run preflight:azure && npm run preflight:production");
addCheck("package preflight:azure exists", pkg.scripts?.["preflight:azure"] === "node scripts/preflightAzure.js");
addCheck("package verify:azure-deployment exists", pkg.scripts?.["verify:azure-deployment"] === "node scripts/verifyAzureDeployment.js");
addCheck("package verify:recovery-rollout exists", pkg.scripts?.["verify:recovery-rollout"] === "node scripts/verifyRecoveryRolloutConfig.js");
addCheck("package repository syntax check exists", pkg.scripts?.["check:syntax"] === "node scripts/checkNodeSyntax.js");
addCheck("package Router V2 database concurrency test exists", pkg.scripts?.["test:router-v2-db"] === "node scripts/testAiRouterV2DatabaseConcurrency.js");
addCheck("package cloudflare:config exists", pkg.scripts?.["cloudflare:config"] === "node scripts/writeCloudflareFrontendConfig.js");
addCheck("package cloudflare:build vendors and verifies KaTeX", pkg.scripts?.["cloudflare:build"] === "node scripts/vendorKatex.js && node scripts/writeCloudflareFrontendConfig.js && node scripts/verifyCloudflareBuild.js");
addCheck("package verify:cloudflare-azure exists", pkg.scripts?.["verify:cloudflare-azure"] === "node scripts/verifyCloudflareAzureWiring.js");
addCheck("server reads PORT", /process\.env\.PORT/.test(server));
addCheck("health route exists", server.includes('url.pathname === "/api/health"'));
addCheck("config route exists", server.includes('url.pathname === "/api/config"'));
addCheck("config exposes safe deployment target", server.includes("deploymentTarget: DEPLOYMENT_TARGET"));
addCheck("Azure disables backend frontend serving", server.includes("const SERVE_FRONTEND") && server.includes("DEPLOYMENT_TARGET !== \"azure-container-apps\"") && server.includes("frontendServedByBackend: SERVE_FRONTEND"));
addCheck("Cloudflare runtime config scaffold exists", exists("frontend/runtime-config.js") && exists("scripts/writeCloudflareFrontendConfig.js"));
addCheck("Cloudflare KaTeX build verification exists", exists("scripts/vendorKatex.js") && exists("scripts/verifyCloudflareBuild.js"));
addCheck("frontend API config reads runtime config", read("frontend/scripts/config.js").includes("StudentOSRuntimeConfig") && read("frontend/index.html").includes("runtime-config.js"));
const frontendApp = read("frontend/scripts/app.js");
const frontendApiClient = exists("frontend/scripts/core/api-client.js")
  ? read("frontend/scripts/core/api-client.js")
  : "";
addCheck(
  "frontend detects Cloudflare API base misconfiguration",
  frontendApp.includes("API_BASE_MISCONFIGURED_MESSAGE") &&
    frontendApp.includes("apiBaseMisconfiguredError") &&
    frontendApp.includes('from "./core/api-client.js"') &&
    frontendApp.includes("requestJson({") &&
    frontendApp.includes("error?.invalidResponse") &&
    frontendApp.includes("throw apiBaseMisconfiguredError()") &&
    frontendApiClient.includes("text/html") &&
    frontendApiClient.includes("looksHtml") &&
    frontendApiClient.includes("invalidResponse: true"),
);
const redirects = exists("frontend/_redirects") ? read("frontend/_redirects") : "";
const authCompleteHtml = read("frontend/auth-complete.html");
addCheck("Cloudflare auth routes exist", redirects.includes("/auth/complete /auth-complete 200") && redirects.includes("/auth/complete/ /auth-complete 200") && redirects.includes("/auth/callback /index.html 200") && redirects.includes("/auth/callback/ /index.html 200"));
addCheck("auth completion assets are root absolute", authCompleteHtml.includes('href="/styles/main.css"') && authCompleteHtml.includes('src="/runtime-config.js"') && authCompleteHtml.includes('src="/scripts/config.js"') && authCompleteHtml.includes('src="/scripts/auth-complete.js"'));

const healthBlock = server.slice(server.indexOf('url.pathname === "/api/health"'), server.indexOf('url.pathname === "/api/status"'));
addCheck("health route avoids state/database/provider calls", !/getStateContext|repository\.|fetch\(|runStudentOsVerb|syncGoogleClassroom|embedSourceChunks/.test(healthBlock));

const tracked = gitLsFiles();
addCheck(".env is not tracked", !tracked.includes(".env"), { trackedEnvFiles: tracked.filter((file) => /(^|\/)\.env/.test(file)) });

const frontendSecretMarkers = [
  /STUDENTOS_SUPABASE_SERVICE_ROLE_KEY/i,
  /SUPABASE_SERVICE_ROLE/i,
  /GOOGLE_CLIENT_SECRET/i,
  /GROQ_API_KEY/i,
  /GEMINI_API_KEY/i,
  /NVIDIA_API_KEY/i,
  /POLLINATIONS_API_KEY/i,
  /AZURE_CREDENTIALS/i,
  /TOKEN_ENCRYPTION_SECRET/i,
  /PRIVATE KEY/i,
];
addCheck("frontend has no secret markers", containsAny(frontendText, frontendSecretMarkers).length === 0);

const classroomWriteMarkers = [
  /turnIn/i,
  /modifyAttachments/i,
  /reclaimSubmission/i,
  /classroom\.announcements/i,
  /classroom\.coursework\.students/i,
  /classroom\.rosters/i,
  /\/turnIn/i,
  /\/modifyAttachments/i,
  /\/reclaim/i,
];
addCheck("no Classroom write scopes or actions", containsAny(classroomText, classroomWriteMarkers).length === 0);

const dangerousDefaults = [
  ["STUDENTOS_DEMO_SEED_ENABLED=false", envExample, envTemplate],
  ["STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED=false", envExample, envTemplate],
  ["STUDENTOS_AUTH_ADMIN_DELETE_ENABLED=false", envExample, envTemplate],
  ["STUDENTOS_INTERNAL_OPS_ENABLED=false", envExample, envTemplate],
  ["STUDENTOS_BILLING_LIVE_CHARGES_ENABLED=false", envExample, envTemplate],
  ["STUDENTOS_BACKGROUND_WORKERS_ENABLED=false", envExample, envTemplate],
  ["STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false", envExample, envTemplate],
  ["STUDENTOS_RECOVERY_UI_ENABLED=false", envExample, envTemplate],
  ["STUDENTOS_RECOVERY_ROLLOUT_MODE=off", envExample, envTemplate],
  ["STUDENTOS_AI_PROVIDER_CYCLE_ENABLED=false", envExample, envTemplate],
  ["STUDENTOS_AI_PROVIDER_CYCLE_ROLLOUT_PERCENT=0", envExample, envTemplate],
  ["STUDENTOS_AI_ROUTER_V2_ENABLED=false", envExample, envTemplate],
  ["STUDENTOS_AI_ROUTER_V2_ROLLOUT_PERCENT=0", envExample, envTemplate],
];
for (const [line, ...texts] of dangerousDefaults) {
  addCheck(`dangerous default ${line}`, texts.every((text) => text.includes(line)));
}

for (const file of [
  "infra/azure/containerapp.bicep",
  "infra/azure/deploy-containerapp.ps1",
  "infra/azure/deploy-containerapp.sh",
  "docs/AZURE_CONTAINER_APPS_DEPLOYMENT.md",
  "docs/AZURE_COST_SAVER_RUNBOOK.md",
  "docs/AZURE_FIRST_DEPLOY_CHECKLIST.md",
  "infra/azure/containerapp-secrets.example.ps1",
  "scripts/verifyAzureDeployment.js",
  "scripts/verifyRecoveryRolloutConfig.js",
  ".github/workflows/azure-container-apps-studentos.yml",
  ".github/workflows/adaptive-recovery-rollout.yml",
]) {
  addCheck(`${file} exists`, exists(file));
}

addCheck("workflow is manual-only", workflow.includes("workflow_dispatch:") && !/^  push:/m.test(workflow) && !/^  pull_request:/m.test(workflow));
addCheck("workflow uses GHCR", workflow.includes("ghcr.io") && workflow.includes("docker/build-push-action"));
addCheck("workflow selects Azure subscription", workflow.includes("AZURE_SUBSCRIPTION_ID") && workflow.includes("az account set"));
addCheck("workflow passes existing ACA environment resource group", workflow.includes("AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP") && workflow.includes("useExistingEnvironment=true"));
addCheck("workflow requires dedicated worker name", workflow.includes("AZURE_WORKER_CONTAINER_APP_NAME is required") && workflow.includes("workerContainerAppName=\"${{ secrets.AZURE_WORKER_CONTAINER_APP_NAME }}\""));
addCheck("workflow does not create a second Central India ACA environment", !workflow.includes("cae-studentos-dev") && workflow.includes("Validate existing ACA environment settings"));
const buildWorkflowStart = workflow.indexOf("- name: Build and push image");
const azureLoginStart = workflow.indexOf("- name: Azure login");
const buildWorkflowBlock = buildWorkflowStart >= 0 && azureLoginStart > buildWorkflowStart
  ? workflow.slice(buildWorkflowStart, azureLoginStart)
  : workflow;
addCheck("workflow does not use secret build args", !/build-args:|--build-arg|STUDENTOS_SUPABASE_SERVICE_ROLE_KEY|GOOGLE_CLIENT_SECRET|GROQ_API_KEY|GEMINI_API_KEY|NVIDIA_API_KEY|POLLINATIONS_API_KEY/.test(buildWorkflowBlock));
const requiredAzureSupabaseSecrets = [
  "STUDENTOS_SUPABASE_URL_1",
  "STUDENTOS_SUPABASE_ANON_KEY_1",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1",
  "STUDENTOS_SUPABASE_URL_2",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2",
  "STUDENTOS_SUPABASE_URL_3",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3",
  "STUDENTOS_SUPABASE_URL_4",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4",
  "STUDENTOS_SUPABASE_JWT_SECRET",
];
const requiredAzureSecretRefs = [
  "STUDENTOS_SUPABASE_URL_1=secretref:studentos-supabase-url-1",
  "STUDENTOS_SUPABASE_ANON_KEY_1=secretref:studentos-supabase-anon-key-1",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1=secretref:studentos-supabase-service-role-key-1",
  "STUDENTOS_SUPABASE_URL_2=secretref:studentos-supabase-url-2",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2=secretref:studentos-supabase-service-role-key-2",
  "STUDENTOS_SUPABASE_URL_3=secretref:studentos-supabase-url-3",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3=secretref:studentos-supabase-service-role-key-3",
  "STUDENTOS_SUPABASE_URL_4=secretref:studentos-supabase-url-4",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4=secretref:studentos-supabase-service-role-key-4",
  "STUDENTOS_SUPABASE_JWT_SECRET=secretref:studentos-supabase-jwt-secret",
];
addCheck("workflow validates Supabase backend secrets", requiredAzureSupabaseSecrets.every((name) => workflow.includes(`${name}: \${{ secrets.${name} }}`)) && workflow.includes("Missing required Azure backend secret"));
addCheck("workflow maps Supabase backend secrets to ACA secret refs", includesAll(workflow, requiredAzureSecretRefs));
addCheck("Router V2 live migration verification is forced into Supabase mode", workflow.includes("STUDENTOS_MODE: supabase") && workflow.includes("verifyAiRouterV2Migrations.js --live"));
addCheck("Router V2 database concurrency is a disabled-traffic pre-enable gate", workflow.includes("Confirm Router V2 production traffic is disabled before live gates") && workflow.includes("STUDENTOS_AI_ROUTER_V2_LIVE_TEST=true npm run test:router-v2-db"));
addCheck(
  "workflow validates either legacy or numbered Groq secrets",
  AZURE_GROQ_SECRET_NAMES.every((name) => workflow.includes(`${name}: \${{ secrets.${name} }}`)) &&
    workflow.includes("node scripts/validateAzureAiProviderSecrets.js") &&
    workflow.includes("STUDENTOS_AI_MODE=auto"),
);
const optionalAzureAiSecrets = [
  ...AZURE_GROQ_SECRET_MAPPINGS.map((item) => [item.envName, item.secretName]),
  ...AZURE_GEMINI_SECRET_MAPPINGS.map((item) => [item.envName, item.secretName]),
  ...AZURE_NVIDIA_SECRET_MAPPINGS.map((item) => [item.envName, item.secretName]),
  ["POLLINATIONS_API_KEY", "pollinations-api-key"],
];
addCheck(
  "workflow conditionally maps optional AI provider secrets",
  workflow.includes("add_optional_provider_secret") && optionalAzureAiSecrets.every(([name, secret]) =>
    workflow.includes(`${name}: \${{ secrets.${name} }}`) &&
      workflow.includes(`add_optional_provider_secret ${name} ${secret}`)),
);
addCheck(
  "Groq runtime env names map to ACA-safe secret refs",
  AZURE_GROQ_SECRET_MAPPINGS.every(({ envName, secretName }) =>
    /^GROQ_API_KEY(?:_[1-5])?$/.test(envName) &&
      isAzureContainerAppSafeSecretName(secretName) &&
      !/[A-Z_]/.test(secretName)),
);
addCheck(
  "Gemini runtime env names map to ACA-safe secret refs",
  AZURE_GEMINI_SECRET_MAPPINGS.every(({ envName, secretName }) =>
    /^GEMINI_API_KEY(?:_[1-6])?$/.test(envName) &&
      isAzureContainerAppSafeSecretName(secretName) &&
      !/[A-Z_]/.test(secretName)),
);
addCheck(
  "workflow accepts legacy and all six Gemini secrets",
  AZURE_GEMINI_SECRET_NAMES.every((name) => workflow.includes(`${name}: \${{ secrets.${name} }}`)),
);
addCheck(
  "workflow exposes independent provider kill switches",
  ["GROQ", "GEMINI", "POLLINATIONS"].every((provider) =>
    workflow.includes(`STUDENTOS_AI_${provider}_ENABLED: \${{ vars.STUDENTOS_AI_${provider}_ENABLED || 'true' }}`) &&
    workflow.includes(`STUDENTOS_AI_${provider}_ENABLED=\"$STUDENTOS_AI_${provider}_ENABLED\"`)),
);
addCheck(
  "workflow exposes NVIDIA fallback kill switch disabled by default",
  workflow.includes("STUDENTOS_AI_NVIDIA_ENABLED: ${{ vars.STUDENTOS_AI_NVIDIA_ENABLED || 'false' }}")
    && workflow.includes('STUDENTOS_AI_NVIDIA_ENABLED="$STUDENTOS_AI_NVIDIA_ENABLED"'),
);
addCheck(
  "NVIDIA runtime env names map to ACA-safe secret refs",
  AZURE_NVIDIA_SECRET_MAPPINGS.every(({ envName, secretName }) =>
    /^NVIDIA_API_KEY(?:_[1-3])?$/.test(envName)
      && isAzureContainerAppSafeSecretName(secretName)
      && !/[A-Z_]/.test(secretName)),
);
addCheck(
  "workflow tolerates empty optional provider secrets",
  workflow.includes('value="$(printenv "$env_name" 2>/dev/null || true)"'),
);
addCheck(
  "workflow emits redacted Azure CLI failure categories",
  workflow.includes('run_redacted_az_step "containerapp_secret_set_${app_name}"') &&
    workflow.includes('run_redacted_az_step "containerapp_env_update_${app_name}"') &&
    workflow.includes("Raw CLI output was withheld to protect secret values.") &&
    !/cat\s+["']?\$?log_path/.test(workflow) &&
    !/echo[^\n]*\$value/.test(workflow),
);
const legacyGroqValidation = validateAzureGroqSecrets({ GROQ_API_KEY: "legacy-probe-key" });
const numberedGroqValidation = validateAzureGroqSecrets({
  GROQ_API_KEY_1: "pool-probe-key-1",
  GROQ_API_KEY_4: "pool-probe-key-4",
});
const missingGroqValidation = validateAzureGroqSecrets({});
addCheck("Azure Groq validation accepts GROQ_API_KEY", legacyGroqValidation.ok && legacyGroqValidation.keyCount === 1);
addCheck("Azure Groq validation accepts a numbered pool", numberedGroqValidation.ok && numberedGroqValidation.keyCount === 2);
addCheck("Azure Groq validation fails without keys", !missingGroqValidation.ok && missingGroqValidation.errorCode === "groq_backend_key_missing");
addCheck(
  "Azure Groq validation never prints secret values",
  !JSON.stringify([legacyGroqValidation, numberedGroqValidation, missingGroqValidation]).includes("probe-key"),
);
const cycleProviderValidation = validateAzureAiProviderSecrets({
  STUDENTOS_AI_PROVIDER_CYCLE_ENABLED: "true",
  GROQ_API_KEY_1: "groq-slot-1",
  GEMINI_API_KEY_1: "gemini-slot-1",
  GEMINI_API_KEY_2: "gemini-slot-2",
  GEMINI_API_KEY_3: "gemini-slot-3",
  GEMINI_API_KEY_4: "gemini-slot-4",
  GEMINI_API_KEY_5: "gemini-slot-5",
  POLLINATIONS_API_KEY: "pollinations-slot-1",
});
const incompleteCycleProviderValidation = validateAzureAiProviderSecrets({
  STUDENTOS_AI_PROVIDER_CYCLE_ENABLED: "true",
  GROQ_API_KEY_1: "groq-slot-1",
  GEMINI_API_KEY_1: "duplicate-gemini-slot",
  GEMINI_API_KEY_2: "duplicate-gemini-slot",
  POLLINATIONS_API_KEY: "pollinations-slot-1",
});
const routerV2ProviderValidation = validateAzureAiProviderSecrets({
  STUDENTOS_AI_ROUTER_V2_ENABLED: "true",
  STUDENTOS_AI_NVIDIA_ENABLED: "true",
  ...Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`GROQ_API_KEY_${index + 1}`, `v2-groq-${index + 1}`])),
  ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`GEMINI_API_KEY_${index + 1}`, `v2-gemini-${index + 1}`])),
  ...Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`NVIDIA_API_KEY_${index + 1}`, `v2-nvidia-${index + 1}`])),
  POLLINATIONS_API_KEY: "v2-pollinations-1",
});
const incompleteRouterV2ProviderValidation = validateAzureAiProviderSecrets({
  STUDENTOS_AI_ROUTER_V2_ENABLED: "true",
  GROQ_API_KEY_1: "v2-duplicate",
  GROQ_API_KEY_2: "v2-duplicate",
  GEMINI_API_KEY_1: "v2-gemini-1",
  POLLINATIONS_API_KEY: "v2-pollinations-1",
});
addCheck("Azure cyclic provider validation requires five distinct Gemini slots", cycleProviderValidation.ok && !incompleteCycleProviderValidation.ok);
addCheck("Azure Router V2 validation requires exact distinct key rings", routerV2ProviderValidation.ok && !incompleteRouterV2ProviderValidation.ok);
addCheck("Azure cyclic provider validation requires Pollinations authentication", !validateAzureAiProviderSecrets({
  STUDENTOS_AI_PROVIDER_CYCLE_ENABLED: "true",
  GROQ_API_KEY_1: "groq-slot-1",
  GEMINI_API_KEY_1: "gemini-slot-1",
  GEMINI_API_KEY_2: "gemini-slot-2",
  GEMINI_API_KEY_3: "gemini-slot-3",
  GEMINI_API_KEY_4: "gemini-slot-4",
  GEMINI_API_KEY_5: "gemini-slot-5",
}).ok);
const redundantAutoProviderValidation = validateAzureAiProviderSecrets({
  STUDENTOS_AI_MODE: "auto",
  GROQ_API_KEY_1: "groq-slot-1",
  GEMINI_API_KEY: "gemini-slot-1",
});
const singleAutoProviderValidation = validateAzureAiProviderSecrets({
  STUDENTOS_AI_MODE: "auto",
  GROQ_API_KEY_1: "groq-slot-1",
});
addCheck("Azure auto provider validation requires redundant provider families", redundantAutoProviderValidation.ok && !singleAutoProviderValidation.ok && singleAutoProviderValidation.errorCode === "provider_redundancy_required");
addCheck("Azure provider validation never returns secret values", !JSON.stringify([cycleProviderValidation, incompleteCycleProviderValidation, routerV2ProviderValidation, incompleteRouterV2ProviderValidation]).includes("v2-groq"));
addCheck("workflow configures production storage buckets", workflow.includes("STUDENTOS_STORAGE_BUCKET=studentos-source-materials") && workflow.includes("STUDENTOS_EXPORT_STORAGE_BUCKET=studentos-data-exports"));
const runtimeConfigText = `${read("frontend/runtime-config.js")}\n${read("scripts/writeCloudflareFrontendConfig.js")}`;
addCheck("frontend runtime config remains public-only", !/STUDENTOS_SUPABASE|SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|JWT_SECRET/i.test(runtimeConfigText));
const bicep = read("infra/azure/containerapp.bicep");
const requiredCorsOrigins = [
  "https://studentos.sentiqlabs.com",
  "https://studentos-39s.pages.dev",
  "http://localhost:3101",
  "http://localhost:3102",
];
addCheck("Cloudflare production CORS origins configured", requiredCorsOrigins.every((origin) => bicep.includes(origin) && read("backend/config/saasConfig.js").includes(origin)));
addCheck("Azure CORS does not use wildcard", !/CORS_ORIGINS[^\n]*\*/.test(bicep) && !/corsOrigins string = '\*/.test(bicep));
addCheck("Container Apps scale to zero configured", bicep.includes("param minReplicas int = 0") && bicep.includes("param maxReplicas int = 1"));
addCheck("Dedicated worker uses the API image without ingress", bicep.includes("resource workerContainerApp") && bicep.includes("name: 'studentos-worker'") && bicep.includes("image: image") && !bicep.slice(bicep.indexOf("resource workerContainerApp")).includes("ingress: {"));
addCheck("Dedicated worker command and fixed scale configured", bicep.includes("'jobs:dev'") && bicep.slice(bicep.indexOf("resource workerContainerApp")).includes("minReplicas: 1") && bicep.slice(bicep.indexOf("resource workerContainerApp")).includes("maxReplicas: 1"));
addCheck("Dedicated worker has constrained resources", bicep.slice(bicep.indexOf("resource workerContainerApp")).includes("cpu: json('0.25')") && bicep.slice(bicep.indexOf("resource workerContainerApp")).includes("memory: '0.5Gi'"));
addCheck("Bicep disables backend frontend serving", bicep.includes("name: 'STUDENTOS_SERVE_FRONTEND'") && bicep.includes("value: 'false'"));
addCheck("Bicep keeps Recovery dark for API and worker", (bicep.match(/name: 'STUDENTOS_RECOVERY_UI_ENABLED'/g) || []).length === 2 && (bicep.match(/name: 'STUDENTOS_RECOVERY_ROLLOUT_MODE'/g) || []).length === 2);
addCheck("Bicep can reuse existing ACA environment", bicep.includes("param useExistingEnvironment bool = true") && bicep.includes("existingEnvironmentResourceGroup") && bicep.includes("resourceId(existingEnvironmentResourceGroup") && bicep.includes("if (!useExistingEnvironment)"));
const psDeploy = read("infra/azure/deploy-containerapp.ps1");
const shDeploy = read("infra/azure/deploy-containerapp.sh");
addCheck("deploy scripts refuse unsafe replica settings", psDeploy.includes("MinReplicas=0") && psDeploy.includes("MaxReplicas=1") && shDeploy.includes("MIN_REPLICAS=0") && shDeploy.includes("MAX_REPLICAS=1"));
addCheck("deploy scripts include the dedicated worker", psDeploy.includes("WorkerContainerAppName") && psDeploy.includes("min=1 max=1") && shDeploy.includes("WORKER_CONTAINER_APP_NAME") && shDeploy.includes("min=1 max=1"));
addCheck("deploy scripts show safe final URL summary", psDeploy.includes("Safe deployment summary") && shDeploy.includes("Safe deployment summary"));
addCheck("deploy scripts support existing ACA environment", psDeploy.includes("ExistingEnvironmentResourceGroup") && psDeploy.includes("useExistingEnvironment=$UseExistingEnvironment") && shDeploy.includes("EXISTING_ENVIRONMENT_RESOURCE_GROUP") && shDeploy.includes("useExistingEnvironment=\"$USE_EXISTING_ENVIRONMENT\""));
addCheck("deployment workflow validates dark worker topology", workflow.includes("Validate dedicated worker resource") && workflow.includes("latestReadyRevisionName") && workflow.includes(".properties.configuration.ingress == null") && !workflow.includes("enable_adaptive_recovery:"));
addCheck("deployment workflow maps dark Recovery state to both apps", workflow.includes('for app_name in "${{ secrets.AZURE_CONTAINER_APP_NAME }}" "${{ secrets.AZURE_WORKER_CONTAINER_APP_NAME }}"') && workflow.includes("STUDENTOS_BACKGROUND_WORKERS_ENABLED: 'true'") && workflow.includes("STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: 'false'") && workflow.includes("STUDENTOS_RECOVERY_UI_ENABLED: 'false'") && workflow.includes("STUDENTOS_RECOVERY_ROLLOUT_MODE: 'off'"));
addCheck("Recovery rollout workflow is manual-only", recoveryRolloutWorkflow.includes("workflow_dispatch:") && !/^  push:/m.test(recoveryRolloutWorkflow) && !/^  pull_request:/m.test(recoveryRolloutWorkflow));
addCheck("Recovery rollout workflow requires explicit confirmations", recoveryRolloutWorkflow.includes("ENABLE-RECOVERY-ALLOWLIST") && recoveryRolloutWorkflow.includes("DISABLE-RECOVERY"));
addCheck("Recovery rollout workflow passes free-form confirmation through env", recoveryRolloutWorkflow.includes("REQUEST_CONFIRMATION: ${{ inputs.confirmation }}") && !recoveryRolloutWorkflow.includes('confirmation="${{ inputs.confirmation }}"'));
addCheck("Recovery rollout workflow verifies schema and allowlist", recoveryRolloutWorkflow.includes("verifyAdaptiveRecoverySchemaLive.js") && recoveryRolloutWorkflow.includes("verifyRecoveryRolloutConfig.js") && recoveryRolloutWorkflow.includes("STUDENTOS_RECOVERY_ROLLOUT_USER_IDS"));
addCheck("Recovery rollout workflow verifies both apps are dark and ready before enable", recoveryRolloutWorkflow.includes('for json in "$api_json" "$worker_json"') && recoveryRolloutWorkflow.includes('STUDENTOS_RECOVERY_UI_ENABLED" and .value == "false"') && recoveryRolloutWorkflow.includes('STUDENTOS_RECOVERY_ROLLOUT_MODE" and .value == "off"'));
addCheck("Recovery rollout workflow supports paired enable and disable", recoveryRolloutWorkflow.includes("STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=true") && recoveryRolloutWorkflow.includes("STUDENTOS_RECOVERY_UI_ENABLED=true") && recoveryRolloutWorkflow.includes("STUDENTOS_RECOVERY_ROLLOUT_MODE=allowlist") && recoveryRolloutWorkflow.includes("STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false") && recoveryRolloutWorkflow.includes("STUDENTOS_RECOVERY_UI_ENABLED=false") && recoveryRolloutWorkflow.includes("STUDENTOS_RECOVERY_ROLLOUT_MODE=off"));
addCheck("Recovery rollout workflow hides raw Azure output", recoveryRolloutWorkflow.includes("Raw CLI output was withheld") && !/cat\s+["']?\$?log_path/.test(recoveryRolloutWorkflow));
const verifier = read("scripts/verifyAzureDeployment.js");
const cloudflareVerifier = read("scripts/verifyCloudflareAzureWiring.js");
addCheck("verify script checks health and config", verifier.includes("/api/health") && verifier.includes("/api/config"));
addCheck("verify script checks AI JSON wiring", cloudflareVerifier.includes("/api/ai/verb") && cloudflareVerifier.includes("aiReturnedHtml"));
addCheck("verify script rejects missing Azure URL", verifier.includes("STUDENTOS_AZURE_API_URL"));
addCheck("verify script checks deployment target", verifier.includes("azure-container-apps"));
addCheck("verify script requires configured production AI", verifier.includes("aiProviders?.configured !== true"));

const failed = checks.filter((check) => !check.ok);
const result = {
  ok: failed.length === 0,
  product: "StudentOS",
  target: "Azure Container Apps Consumption",
  workflow: "Azure Container Apps deployment plus controlled Recovery rollout",
  scale: { api: { minReplicas: 0, maxReplicas: 1 }, worker: { minReplicas: 1, maxReplicas: 1 } },
  checkedAt: new Date().toISOString(),
  checks,
  failed: failed.map((check) => check.name),
  secretsPrinted: false,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
