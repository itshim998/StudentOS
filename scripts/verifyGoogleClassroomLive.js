import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  GOOGLE_CLASSROOM_READONLY_SCOPES,
  assertNoGoogleClassroomWriteScopes,
  getGoogleClassroomConfig,
  getSafeGoogleClassroomStatus,
} from "../backend/connectors/googleClassroom/config.js";
import {
  buildClassroomOAuthUrl,
  createClassroomOAuthState,
} from "../backend/connectors/googleClassroom/oauth.js";
import { loadDotEnv } from "../backend/config/supabaseEnv.js";
import { redactSecrets } from "../backend/observability/logger.js";

const EXPECTED_GOOGLE_CLOUD_SCOPES = Object.freeze([
  "openid",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
  "https://www.googleapis.com/auth/classroom.course-work.readonly",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
]);

const FORBIDDEN_SCOPE_FRAGMENTS = Object.freeze([
  "classroom.coursework.me",
  "classroom.coursework.students",
  "classroom.rosters",
  "classroom.courses",
  "drive",
]);

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

function sameSet(left = [], right = []) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function forbiddenScopeMatches(scopes = []) {
  return scopes.filter((scope) => {
    const normalized = String(scope || "").toLowerCase();
    if (normalized === "https://www.googleapis.com/auth/classroom.courses.readonly") return false;
    return FORBIDDEN_SCOPE_FRAGMENTS.some((fragment) => normalized.includes(fragment));
  });
}

function apiBase(env) {
  return readValue(env, "STUDENTOS_API_BASE", `http://localhost:${readValue(env, "STUDENTOS_PORT", "3101")}`);
}

async function requestJson(base, path, { method = "GET" } = {}) {
  const response = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : "{}",
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    status: response.status,
    ok: response.ok,
    hasJson: Boolean(json),
    connectorState: json?.connector?.state || null,
    connectorMode: json?.connector?.mode || null,
    authorizationUrlReturned: Boolean(json?.authorizationUrl),
    errorType: json?.error || json?.message || null,
  };
}

async function checkLocalEndpoints(env) {
  const base = apiBase(env);
  const result = {
    apiBase: base,
    checked: true,
    status: null,
    oauthStart: null,
    sync: null,
    gracefulSyncFailureWhenDisconnected: false,
  };
  try {
    result.status = await requestJson(base, "/api/classroom/status");
    result.oauthStart = await requestJson(base, "/api/classroom/oauth/start", { method: "POST" });
    result.sync = await requestJson(base, "/api/classroom/sync", { method: "POST" });
    result.gracefulSyncFailureWhenDisconnected = [200, 401, 409].includes(result.sync.status);
  } catch (error) {
    result.checked = false;
    result.error = "local_api_unavailable";
  }
  return result;
}

export async function verifyGoogleClassroomLive(env = process.env) {
  const config = getGoogleClassroomConfig(env);
  const safeStatus = getSafeGoogleClassroomStatus(config);
  const state = createClassroomOAuthState({
    userId: "verify-google-classroom-live",
    config,
  });
  const authorizationUrl = buildClassroomOAuthUrl({ config, state });
  const parsed = new URL(authorizationUrl);
  const requestedScopes = parsed.searchParams.get("scope")?.split(/\s+/).filter(Boolean) || [];
  const forbiddenMatches = forbiddenScopeMatches(requestedScopes);
  assertNoGoogleClassroomWriteScopes(requestedScopes);
  const redirectUriMatches = parsed.searchParams.get("redirect_uri") === config.redirectUri;
  const endpointReadiness = await checkLocalEndpoints(env);
  const ok = safeStatus.mode === "oauth" &&
    safeStatus.oauthConfigured &&
    safeStatus.tokenEncryptionConfigured &&
    sameSet(requestedScopes, EXPECTED_GOOGLE_CLOUD_SCOPES) &&
    redirectUriMatches &&
    forbiddenMatches.length === 0 &&
    endpointReadiness.gracefulSyncFailureWhenDisconnected !== false;
  return redactSecrets({
    ok,
    product: "StudentOS by SentIQ AI Labs",
    mode: safeStatus.mode,
    oauthConfigured: safeStatus.oauthConfigured,
    tokenEncryptionConfigured: safeStatus.tokenEncryptionConfigured,
    driveAttachmentMetadataEnabled: safeStatus.driveAttachmentMetadataEnabled,
    requestedScopes,
    expectedGoogleCloudScopes: EXPECTED_GOOGLE_CLOUD_SCOPES,
    scopesMatchGoogleCloudSetup: sameSet(requestedScopes, EXPECTED_GOOGLE_CLOUD_SCOPES),
    forbiddenScopeMatches,
    writeScopesEnabled: false,
    redirectUri: config.redirectUri,
    redirectUriMatches,
    authorizationUrlGenerated: true,
    authorizationUrlPrinted: false,
    localEndpoints: endpointReadiness,
    endpointScopeNote: "The current local request set is aligned to the configured Cloud OAuth scopes. If Google returns insufficient_scope for coursework sync, review current Classroom API method docs before adding any additional read-only coursework scope.",
    secretsPrinted: false,
  });
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const result = await verifyGoogleClassroomLive(process.env);
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
