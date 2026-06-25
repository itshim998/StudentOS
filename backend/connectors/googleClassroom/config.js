export const GOOGLE_CLASSROOM_READONLY_SCOPES = Object.freeze([
  "openid",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
  "https://www.googleapis.com/auth/classroom.course-work.readonly",
  "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
]);

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

function stripOuterQuotes(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function normalizeMode(value) {
  const mode = String(value || "").toLowerCase();
  if (["oauth", "disabled", "mock"].includes(mode)) return mode;
  return "mock";
}

function readBool(env, key, fallback = false) {
  const value = readValue(env, key);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readInt(env, key, fallback) {
  const value = Number(readValue(env, key));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function getGoogleClassroomConfig(env = process.env) {
  const mode = normalizeMode(readValue(env, "STUDENTOS_GOOGLE_CLASSROOM_MODE", readValue(env, "GOOGLE_WORKSPACE_CONNECTOR_MODE", "mock")));
  const tokenEncryptionSecret = readValue(env, "STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET") ||
    readValue(env, "STUDENTOS_CLASSROOM_TOKEN_ENCRYPTION_SECRET");
  const driveAttachmentMetadataEnabled = readBool(env, "STUDENTOS_GOOGLE_CLASSROOM_DRIVE_METADATA_ENABLED", false);
  return {
    mode,
    clientId: stripOuterQuotes(readValue(env, "GOOGLE_CLIENT_ID")),
    clientSecret: stripOuterQuotes(readValue(env, "GOOGLE_CLIENT_SECRET")),
    redirectUri: stripOuterQuotes(readValue(env, "GOOGLE_REDIRECT_URI")),
    stateSecret: readValue(env, "STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET") ||
      readValue(env, "STUDENTOS_SUPABASE_JWT_SECRET") ||
      readValue(env, "GOOGLE_CLIENT_SECRET") ||
      "studentos-classroom-local-state",
    tokenEncryptionSecret,
    tokenEncryptionKeyId: readValue(env, "STUDENTOS_GOOGLE_CLASSROOM_TOKEN_KEY_ID", "studentos-google-classroom-token-v1"),
    tokenPersistence: tokenEncryptionSecret ? "encrypted_shard_storage" : "session_memory_only",
    driveAttachmentMetadataEnabled,
    retention: {
      maxImportedAssignments: readInt(env, "STUDENTOS_GOOGLE_CLASSROOM_MAX_IMPORTED_ASSIGNMENTS", 200),
      maxImportedMaterials: readInt(env, "STUDENTOS_GOOGLE_CLASSROOM_MAX_IMPORTED_MATERIALS", 400),
    },
    scopes: GOOGLE_CLASSROOM_READONLY_SCOPES,
  };
}

export function getMaskedGoogleClientIdStatus(clientId = "") {
  const value = stripOuterQuotes(clientId);
  return {
    exists: value.length > 0,
    length: value.length,
    first6: value ? value.slice(0, 6) : "",
    last10: value ? value.slice(-10) : "",
    endsWithAppsGoogleusercontentCom: value.endsWith(".apps.googleusercontent.com"),
    startsWithHttp: /^https?:\/\//i.test(value),
    containsSlash: value.includes("/"),
    malformed: Boolean(value) && (
      !value.endsWith(".apps.googleusercontent.com") ||
      /^https?:\/\//i.test(value) ||
      value.includes("/")
    ),
  };
}

export function validateGoogleClassroomOAuthConfig(config = getGoogleClassroomConfig()) {
  const clientIdStatus = getMaskedGoogleClientIdStatus(config.clientId);
  const problems = [];
  if (config.mode !== "oauth") problems.push("STUDENTOS_GOOGLE_CLASSROOM_MODE must be oauth for live Google OAuth.");
  if (!config.clientId) problems.push("GOOGLE_CLIENT_ID is missing.");
  if (clientIdStatus.malformed) {
    problems.push("GOOGLE_CLIENT_ID must be the Web OAuth client ID only, ending in .apps.googleusercontent.com, with no https:// prefix or trailing slash.");
  }
  if (!config.clientSecret) problems.push("GOOGLE_CLIENT_SECRET is missing.");
  if (!config.redirectUri) problems.push("GOOGLE_REDIRECT_URI is missing.");
  if (config.redirectUri && !/^https?:\/\//i.test(config.redirectUri)) problems.push("GOOGLE_REDIRECT_URI must be an absolute http(s) URL.");
  if (problems.length) {
    const error = new Error(`Google Classroom OAuth config invalid: ${problems.join(" ")}`);
    error.status = 503;
    error.code = "GOOGLE_CLASSROOM_OAUTH_CONFIG_INVALID";
    error.clientIdStatus = clientIdStatus;
    error.redirectUri = config.redirectUri || "";
    throw error;
  }
  return true;
}

export function getSafeGoogleClassroomStatus(config = getGoogleClassroomConfig()) {
  const clientIdStatus = getMaskedGoogleClientIdStatus(config.clientId);
  return {
    provider: "google_classroom",
    mode: config.mode,
    oauthConfigured: Boolean(config.clientId && !clientIdStatus.malformed && config.clientSecret && config.redirectUri),
    clientIdConfigured: Boolean(config.clientId),
    clientIdValid: Boolean(config.clientId && !clientIdStatus.malformed),
    readOnlyImport: true,
    writeScopesEnabled: false,
    postingEnabled: false,
    submissionEnabled: false,
    tokenPersistence: config.tokenPersistence,
    tokenEncryptionConfigured: Boolean(config.tokenEncryptionSecret),
    driveAttachmentMetadataEnabled: config.driveAttachmentMetadataEnabled === true,
    retention: {
      maxImportedAssignments: config.retention?.maxImportedAssignments || 200,
      maxImportedMaterials: config.retention?.maxImportedMaterials || 400,
    },
    scopes: config.scopes,
    secretsExposed: false,
  };
}

export function assertNoGoogleClassroomWriteScopes(scopes = GOOGLE_CLASSROOM_READONLY_SCOPES) {
  const allowed = new Set(GOOGLE_CLASSROOM_READONLY_SCOPES);
  const forbidden = scopes.filter((scope) => {
    const value = String(scope || "").toLowerCase();
    if (["openid", "email", "profile"].includes(value)) return false;
    if (value.includes("googleapis.com/auth/userinfo.")) return false;
    if (!value.includes("googleapis.com/auth/classroom")) return false;
    return !allowed.has(scope);
  });
  if (forbidden.length) {
    const error = new Error("Google Classroom write scopes are not allowed in StudentOS");
    error.status = 500;
    error.forbiddenScopes = forbidden;
    throw error;
  }
  return true;
}
