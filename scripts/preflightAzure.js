import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

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

const dockerfile = exists("Dockerfile") ? read("Dockerfile") : "";
const dockerignore = exists(".dockerignore") ? read(".dockerignore") : "";
const pkg = JSON.parse(read("package.json"));
const server = read("backend/server.js");
const workflow = exists(".github/workflows/azure-container-apps-studentos.yml")
  ? read(".github/workflows/azure-container-apps-studentos.yml")
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

for (const pattern of [".env", ".env.*", "node_modules", "test-results", "playwright-report", ".playwright", "uploads", "local_uploads", "*.log", "secrets", "*.key", "*.pem"]) {
  addCheck(`.dockerignore protects ${pattern}`, dockerignore.includes(pattern));
}

addCheck("package start exists", pkg.scripts?.start === "node backend/server.js");
addCheck("package preflight:azure exists", pkg.scripts?.["preflight:azure"] === "node scripts/preflightAzure.js");
addCheck("server reads PORT", /process\.env\.PORT/.test(server));
addCheck("health route exists", server.includes('url.pathname === "/api/health"'));
addCheck("config route exists", server.includes('url.pathname === "/api/config"'));

const healthBlock = server.slice(server.indexOf('url.pathname === "/api/health"'), server.indexOf('url.pathname === "/api/status"'));
addCheck("health route avoids state/database/provider calls", !/getStateContext|repository\.|fetch\(|runStudentOsVerb|syncGoogleClassroom|embedSourceChunks/.test(healthBlock));

const tracked = gitLsFiles();
addCheck(".env is not tracked", !tracked.includes(".env"), { trackedEnvFiles: tracked.filter((file) => /(^|\/)\.env/.test(file)) });

const frontendSecretMarkers = [
  /STUDENTOS_SUPABASE_SERVICE_ROLE_KEY/i,
  /SUPABASE_SERVICE_ROLE/i,
  /GOOGLE_CLIENT_SECRET/i,
  /GROQ_API_KEY/i,
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
  ".github/workflows/azure-container-apps-studentos.yml",
]) {
  addCheck(`${file} exists`, exists(file));
}

addCheck("workflow is manual-only", workflow.includes("workflow_dispatch:") && !/^  push:/m.test(workflow) && !/^  pull_request:/m.test(workflow));
addCheck("workflow uses GHCR", workflow.includes("ghcr.io") && workflow.includes("docker/build-push-action"));
addCheck("workflow does not use secret build args", !/build-args:|--build-arg|STUDENTOS_SUPABASE_SERVICE_ROLE_KEY|GOOGLE_CLIENT_SECRET|GROQ_API_KEY|POLLINATIONS_API_KEY/.test(workflow));
addCheck("Container Apps scale to zero configured", read("infra/azure/containerapp.bicep").includes("param minReplicas int = 0") && read("infra/azure/containerapp.bicep").includes("param maxReplicas int = 1"));

const failed = checks.filter((check) => !check.ok);
const result = {
  ok: failed.length === 0,
  product: "StudentOS",
  target: "Azure Container Apps Consumption",
  workflow: "Azure Container Apps - StudentOS API",
  scale: { minReplicas: 0, maxReplicas: 1 },
  checkedAt: new Date().toISOString(),
  checks,
  failed: failed.map((check) => check.name),
  secretsPrinted: false,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
