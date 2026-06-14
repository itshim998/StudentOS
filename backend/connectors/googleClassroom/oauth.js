import { createHmac, timingSafeEqual } from "node:crypto";
import {
  assertNoGoogleClassroomWriteScopes,
  validateGoogleClassroomOAuthConfig,
} from "./config.js";

function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ""));
  const rightBytes = Buffer.from(String(right || ""));
  return leftBytes.length > 0 &&
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes);
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(value) {
  return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
}

function sign(secret, payload) {
  return createHmac("sha256", secret || "studentos-classroom-state").update(payload).digest("base64url");
}

export function createClassroomOAuthState({ userId, config, now = new Date() }) {
  const payload = encode({
    sub: userId,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 600,
    typ: "studentos_google_classroom_oauth",
  });
  return `${payload}.${sign(config.stateSecret, payload)}`;
}

export function verifyClassroomOAuthState(state, { config, now = new Date() }) {
  const [payload, signature] = String(state || "").split(".");
  if (!payload || !signature || !safeEqual(sign(config.stateSecret, payload), signature)) {
    const error = new Error("Invalid Google Classroom OAuth state");
    error.status = 400;
    throw error;
  }
  let claims;
  try {
    claims = decode(payload);
  } catch {
    const error = new Error("Invalid Google Classroom OAuth state");
    error.status = 400;
    throw error;
  }
  if (claims.typ !== "studentos_google_classroom_oauth" || Number(claims.exp || 0) <= Math.floor(now.getTime() / 1000)) {
    const error = new Error("Expired Google Classroom OAuth state");
    error.status = 400;
    throw error;
  }
  return claims;
}

export function buildClassroomOAuthUrl({ config, state }) {
  assertNoGoogleClassroomWriteScopes(config.scopes);
  validateGoogleClassroomOAuthConfig(config);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeClassroomOAuthCode({ code, config, fetchImpl = fetch }) {
  validateGoogleClassroomOAuthConfig(config);
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error("Google Classroom OAuth token exchange failed");
    error.status = 502;
    throw error;
  }
  return payload;
}

export async function refreshClassroomOAuthToken({ refreshToken, config, fetchImpl = fetch }) {
  validateGoogleClassroomOAuthConfig(config);
  if (!refreshToken) {
    const error = new Error("Google Classroom refresh token is unavailable");
    error.status = 401;
    error.code = "google_classroom_refresh_token_missing";
    error.connectorState = "expired";
    throw error;
  }
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error("Google Classroom token refresh failed");
    error.status = 401;
    error.code = "google_classroom_token_refresh_failed";
    error.connectorState = "expired";
    throw error;
  }
  return payload;
}

export async function fetchGoogleOAuthProfile({ accessToken, fetchImpl = fetch } = {}) {
  if (!accessToken) return {};
  const response = await fetchImpl("https://www.googleapis.com/oauth2/v3/userinfo", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return {};
  return {
    email: payload.email || "",
    emailVerified: payload.email_verified === true,
  };
}
