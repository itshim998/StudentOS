import { performance } from "node:perf_hooks";

const REQUIRED_ENV = "STUDENTOS_AZURE_API_URL";
const SECRET_MARKERS = [
  /service[_-]?role/i,
  /supabase[_-]?service/i,
  /GOOGLE_CLIENT_SECRET/i,
  /GROQ_API_KEY/i,
  /GEMINI_API_KEY/i,
  /NVIDIA_API_KEY/i,
  /nvapi-/i,
  /POLLINATIONS_API_KEY/i,
  /TOKEN_ENCRYPTION_SECRET/i,
  /AZURE_CREDENTIALS/i,
  /PRIVATE KEY/i,
  /BEGIN RSA/i,
];
const JWT_SECRET_MARKER = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error(`${REQUIRED_ENV} is required`);
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${REQUIRED_ENV} must be http or https`);
  return url.toString().replace(/\/+$/, "");
}

async function getJson(baseUrl, path) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: "application/json" },
  });
  const elapsedMs = Math.round(performance.now() - started);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${path} did not return JSON`);
  }
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}`);
  return { status: response.status, elapsedMs, body, raw: text };
}

function assertNoSecrets(label, raw, { publicAnonKey = "" } = {}) {
  const hits = SECRET_MARKERS.filter((pattern) => pattern.test(raw));
  const jwtScanTarget = publicAnonKey
    ? raw.split(publicAnonKey).join("[redacted.public-anon-key]")
    : raw;
  if (JWT_SECRET_MARKER.test(jwtScanTarget)) hits.push(JWT_SECRET_MARKER);
  if (hits.length) throw new Error(`${label} response contains secret-like markers`);
}

function dangerousToggles(config) {
  const findings = [];
  const account = config.account || {};
  const billing = config.billing || config.saas?.billing?.provider || {};
  const classroom = config.classroom || {};
  if (account.directDeletionEnabled) findings.push("direct deletion enabled");
  if (account.operatorConsoleEnabled) findings.push("operator console enabled");
  if (billing.liveChargesEnabled || billing.checkoutRedirectEnabled) findings.push("billing live charge or checkout enabled");
  if (classroom.writeScopesEnabled || classroom.postingEnabled || classroom.submissionEnabled) findings.push("Classroom write capability enabled");
  return findings;
}

const baseUrl = normalizeBaseUrl(process.env[REQUIRED_ENV]);
const started = new Date().toISOString();
const health = await getJson(baseUrl, "/api/health");
const config = await getJson(baseUrl, "/api/config");

assertNoSecrets("/api/health", health.raw);
assertNoSecrets("/api/config", config.raw, { publicAnonKey: config.body?.auth?.anonKey });

const errors = [];
if (health.body?.ok !== true) errors.push("/api/health did not return ok=true");
if (config.body?.deploymentTarget !== "azure-container-apps") errors.push("/api/config deploymentTarget is not azure-container-apps");
if (config.body?.aiProviders?.configured !== true) errors.push("/api/config reports no configured production AI provider");
if (config.body?.aiProviders?.fallbackAvailable !== true || Number(config.body?.aiProviders?.configuredProviderCount || 0) < 2) {
  errors.push("/api/config reports fewer than two configured production AI providers");
}
if (!["private_cloud_sync", "supabase", "mock"].includes(config.body?.persistence?.mode || config.body?.supabase?.mode || "")) {
  errors.push("/api/config persistence mode is not an expected private persistence mode");
}
const toggles = dangerousToggles(config.body || {});
errors.push(...toggles);

const result = {
  ok: errors.length === 0,
  checkedAt: started,
  baseUrlHost: new URL(baseUrl).host,
  coldStartProbe: {
    healthMs: health.elapsedMs,
    configMs: config.elapsedMs,
  },
  health: {
    ok: health.body?.ok === true,
    deploymentTarget: health.body?.deploymentTarget || null,
    mode: health.body?.mode || null,
  },
  config: {
    deploymentTarget: config.body?.deploymentTarget || null,
    persistenceMode: config.body?.persistence?.mode || config.body?.supabase?.mode || null,
    aiConfigured: config.body?.aiProviders?.configured === true,
    aiConfiguredProviderCount: Number(config.body?.aiProviders?.configuredProviderCount || 0),
    aiFallbackAvailable: config.body?.aiProviders?.fallbackAvailable === true,
    classroomWriteScopesEnabled: Boolean(config.body?.classroom?.writeScopesEnabled),
    realSubmissionEnabled: Boolean(config.body?.realSubmissionEnabled),
  },
  errors,
  secretsPrinted: false,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
