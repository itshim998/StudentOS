import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_AUTH_KEYS = [
  "STUDENTOS_SUPABASE_URL_1",
  "STUDENTOS_SUPABASE_ANON_KEY_1",
];

const REQUIRED_SHARD_KEYS = [
  "STUDENTOS_SUPABASE_URL_2",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2",
  "STUDENTOS_SUPABASE_URL_3",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3",
  "STUDENTOS_SUPABASE_URL_4",
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4",
];

function stripQuotes(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadDotEnv({ cwd = process.cwd(), env = process.env } = {}) {
  const envPath = join(cwd, ".env");
  if (!existsSync(envPath)) return false;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = stripQuotes(trimmed.slice(separator + 1));
    if (!(key in env)) {
      env[key] = value;
    }
  }
  return true;
}

function readValue(env, key) {
  return String(env[key] || "").trim();
}

function hasValue(env, key) {
  return readValue(env, key).length > 0;
}

function missingKeys(env, keys) {
  return keys.filter((key) => !hasValue(env, key));
}

export function getSupabaseEnvironment(env = process.env) {
  const missingAuth = missingKeys(env, REQUIRED_AUTH_KEYS);
  const missingShard = missingKeys(env, REQUIRED_SHARD_KEYS);
  const jwtSecretPresent = hasValue(env, "STUDENTOS_SUPABASE_JWT_SECRET");
  const authConfigured = missingAuth.length === 0;
  const shardsConfigured = missingShard.length === 0;
  const supabaseConfigured = authConfigured && shardsConfigured;
  const requestedMode = readValue(env, "STUDENTOS_MODE") || "auto";
  const forcedMock = requestedMode === "mock";

  return {
    mode: forcedMock ? "mock" : supabaseConfigured ? "supabase" : "mock",
    requestedMode,
    forcedMock,
    authConfigured,
    shardsConfigured,
    jwtSecretPresent,
    missing: {
      auth: missingAuth,
      shards: missingShard,
      jwtSecret: jwtSecretPresent ? [] : ["STUDENTOS_SUPABASE_JWT_SECRET"],
    },
    auth: {
      projectLabel: "auth-project-1",
      url: readValue(env, "STUDENTOS_SUPABASE_URL_1"),
      anonKey: readValue(env, "STUDENTOS_SUPABASE_ANON_KEY_1"),
      serviceRoleKey: readValue(env, "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1"),
    },
    shards: [
      {
        index: 1,
        projectNumber: 2,
        label: "data-shard-1",
        url: readValue(env, "STUDENTOS_SUPABASE_URL_2"),
        serviceRoleKey: readValue(env, "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2"),
      },
      {
        index: 2,
        projectNumber: 3,
        label: "data-shard-2",
        url: readValue(env, "STUDENTOS_SUPABASE_URL_3"),
        serviceRoleKey: readValue(env, "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3"),
      },
      {
        index: 3,
        projectNumber: 4,
        label: "data-shard-3",
        url: readValue(env, "STUDENTOS_SUPABASE_URL_4"),
        serviceRoleKey: readValue(env, "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4"),
      },
    ],
    jwtSecret: readValue(env, "STUDENTOS_SUPABASE_JWT_SECRET"),
    storage: {
      bucket: readValue(env, "STUDENTOS_STORAGE_BUCKET") || "studentos-source-materials",
      publicBucket: false,
    },
  };
}

export function getSafeSupabaseStatus(config) {
  return {
    mode: config.mode,
    requestedMode: config.requestedMode,
    forcedMock: config.forcedMock,
    authConfigured: config.authConfigured,
    shardsConfigured: config.shardsConfigured,
    jwtConfigured: config.jwtSecretPresent,
    missing: {
      auth: config.missing.auth,
      shards: config.missing.shards,
      jwt: config.missing.jwtSecret,
    },
    shards: config.shards.map((shard) => ({
      index: shard.index,
      projectNumber: shard.projectNumber,
      label: shard.label,
      configured: Boolean(shard.url && shard.serviceRoleKey),
    })),
    storage: config.storage,
  };
}

export function getPublicAuthConfig(config) {
  if (config.mode !== "supabase") {
    return {
      enabled: false,
      mode: "mock",
      reason: "persistence_mock_mode",
    };
  }
  if (!config.authConfigured) {
    return {
      enabled: false,
      mode: "mock",
      reason: "auth_project_env_missing",
    };
  }
  return {
    enabled: true,
    mode: "supabase_auth_project",
    url: config.auth.url,
    anonKey: config.auth.anonKey,
  };
}
