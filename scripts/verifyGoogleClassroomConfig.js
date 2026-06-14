import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getGoogleClassroomConfig,
  getMaskedGoogleClientIdStatus,
  validateGoogleClassroomOAuthConfig,
} from "../backend/connectors/googleClassroom/config.js";
import {
  buildClassroomOAuthUrl,
  createClassroomOAuthState,
} from "../backend/connectors/googleClassroom/oauth.js";
import { loadDotEnv } from "../backend/config/supabaseEnv.js";
import { redactSecrets } from "../backend/observability/logger.js";

const WATCHED_KEYS = Object.freeze([
  "STUDENTOS_GOOGLE_CLASSROOM_MODE",
  "GOOGLE_WORKSPACE_CONNECTOR_MODE",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET",
]);

function stripQuotes(value = "") {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function readDotEnvEntries(cwd = process.cwd()) {
  const envPath = resolve(cwd, ".env");
  const entries = [];
  if (!existsSync(envPath)) return entries;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = stripQuotes(trimmed.slice(separator + 1));
    if (WATCHED_KEYS.includes(key)) entries.push({ key, value });
  }
  return entries;
}

function countByKey(entries) {
  return WATCHED_KEYS.reduce((acc, key) => {
    acc[key] = entries.filter((entry) => entry.key === key).length;
    return acc;
  }, {});
}

function valueFor(entries, key) {
  return entries.find((entry) => entry.key === key)?.value || "";
}

function maskedValueShape(value = "") {
  return getMaskedGoogleClientIdStatus(value);
}

export function verifyGoogleClassroomConfig(env = process.env, { cwd = process.cwd() } = {}) {
  const entries = readDotEnvEntries(cwd);
  const dotenvClientId = valueFor(entries, "GOOGLE_CLIENT_ID");
  const config = getGoogleClassroomConfig(env);
  const modeSource = env.STUDENTOS_GOOGLE_CLASSROOM_MODE
    ? "STUDENTOS_GOOGLE_CLASSROOM_MODE"
    : env.GOOGLE_WORKSPACE_CONNECTOR_MODE
      ? "GOOGLE_WORKSPACE_CONNECTOR_MODE"
      : "default_mock";
  const result = {
    ok: false,
    classroomMode: config.mode,
    authoritativeModeKey: modeSource,
    authoritativeNotes: {
      classroomMode: "STUDENTOS_GOOGLE_CLASSROOM_MODE is authoritative. GOOGLE_WORKSPACE_CONNECTOR_MODE is legacy fallback only when the StudentOS-specific key is unset.",
      clientId: "GOOGLE_CLIENT_ID must be the Web OAuth Client ID only. It must not include https://, a path, or a trailing slash.",
      redirectUri: "GOOGLE_REDIRECT_URI is used exactly as the OAuth redirect URI.",
    },
    dotenvLoaded: entries.length > 0,
    duplicateEnvKeyCounts: countByKey(entries),
    duplicateEnvKeys: Object.entries(countByKey(entries)).filter(([, count]) => count > 1).map(([key]) => key),
    clientId: maskedValueShape(config.clientId),
    dotenvClientId: maskedValueShape(dotenvClientId),
    processEnvOverridesDotEnv: Boolean(dotenvClientId && config.clientId && dotenvClientId !== config.clientId),
    clientSecretExists: Boolean(config.clientSecret),
    tokenEncryptionSecretExists: Boolean(config.tokenEncryptionSecret),
    redirectUri: config.redirectUri,
    requestedScopes: config.scopes,
    oauthUrl: {
      generated: false,
      printed: false,
      clientIdParamMatchesLoadedConfig: false,
      clientIdParamShape: null,
      clientIdParamStartsWithHttps: null,
      redirectUriMatches: false,
      clientIdIsUrlEncodedByURLSearchParams: true,
    },
    problems: [],
    secretsPrinted: false,
  };

  try {
    validateGoogleClassroomOAuthConfig(config);
    const state = createClassroomOAuthState({ userId: "verify-classroom-config", config });
    const authorizationUrl = buildClassroomOAuthUrl({ config, state });
    const parsed = new URL(authorizationUrl);
    const clientIdParam = parsed.searchParams.get("client_id") || "";
    result.oauthUrl.generated = true;
    result.oauthUrl.clientIdParamMatchesLoadedConfig = clientIdParam === config.clientId;
    result.oauthUrl.clientIdParamShape = maskedValueShape(clientIdParam);
    result.oauthUrl.clientIdParamStartsWithHttps = /^https?:\/\//i.test(clientIdParam);
    result.oauthUrl.redirectUriMatches = parsed.searchParams.get("redirect_uri") === config.redirectUri;
  } catch (error) {
    result.problems.push(error?.message || String(error));
  }

  if (result.duplicateEnvKeys.length) result.problems.push(`Duplicate env keys found: ${result.duplicateEnvKeys.join(", ")}`);
  if (result.processEnvOverridesDotEnv) result.problems.push("Current process environment GOOGLE_CLIENT_ID differs from .env. Restart the server/shell or clear the stale shell variable.");
  result.ok = result.problems.length === 0 &&
    result.classroomMode === "oauth" &&
    result.clientSecretExists &&
    result.clientId.exists &&
    !result.clientId.malformed &&
    result.oauthUrl.generated &&
    result.oauthUrl.clientIdParamMatchesLoadedConfig &&
    result.oauthUrl.redirectUriMatches &&
    result.oauthUrl.clientIdParamStartsWithHttps === false;
  return redactSecrets(result);
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const result = verifyGoogleClassroomConfig(process.env, { cwd: process.cwd() });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(JSON.stringify(redactSecrets({
      ok: false,
      error: error?.message || String(error),
      secretsPrinted: false,
    }), null, 2));
    process.exit(1);
  });
}
