import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getGoogleClassroomConfig,
  getMaskedGoogleClientIdStatus,
  validateGoogleClassroomOAuthConfig,
} from "./connectors/googleClassroom/config.js";
import { buildClassroomOAuthUrl, createClassroomOAuthState } from "./connectors/googleClassroom/oauth.js";
import { verifyGoogleClassroomConfig } from "../scripts/verifyGoogleClassroomConfig.js";

const validEnv = {
  STUDENTOS_GOOGLE_CLASSROOM_MODE: "oauth",
  GOOGLE_CLIENT_ID: "1234567890-studentos.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:3101/api/classroom/oauth/callback",
  STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET: "token-secret",
};

const validConfig = getGoogleClassroomConfig(validEnv);
assert.equal(validateGoogleClassroomOAuthConfig(validConfig), true);
assert.equal(getMaskedGoogleClientIdStatus(validConfig.clientId).malformed, false);

const state = createClassroomOAuthState({ userId: "pass245", config: validConfig });
const authorizationUrl = buildClassroomOAuthUrl({ config: validConfig, state });
const parsed = new URL(authorizationUrl);
assert.equal(parsed.searchParams.get("client_id"), validEnv.GOOGLE_CLIENT_ID);
assert.equal(parsed.searchParams.get("client_id").startsWith("https://"), false);
assert.equal(parsed.searchParams.get("redirect_uri"), validEnv.GOOGLE_REDIRECT_URI);

const invalidConfig = getGoogleClassroomConfig({
  ...validEnv,
  GOOGLE_CLIENT_ID: "https://1234567890-studentos.apps.googleusercontent.com/",
});
assert.equal(getMaskedGoogleClientIdStatus(invalidConfig.clientId).startsWithHttp, true);
assert.throws(() => validateGoogleClassroomOAuthConfig(invalidConfig), /GOOGLE_CLIENT_ID/);
assert.throws(() => buildClassroomOAuthUrl({ config: invalidConfig, state }), /GOOGLE_CLIENT_ID/);

const tempRoot = await mkdtemp(join(tmpdir(), "studentos-classroom-config-"));
await writeFile(join(tempRoot, ".env"), [
  "STUDENTOS_GOOGLE_CLASSROOM_MODE=oauth",
  "GOOGLE_WORKSPACE_CONNECTOR_MODE=mock",
  "GOOGLE_CLIENT_ID=1234567890-studentos.apps.googleusercontent.com",
  "GOOGLE_CLIENT_SECRET=client-secret",
  "GOOGLE_REDIRECT_URI=http://localhost:3101/api/classroom/oauth/callback",
  "STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET=token-secret",
].join("\n"));
const verifierOk = verifyGoogleClassroomConfig(validEnv, { cwd: tempRoot });
assert.equal(verifierOk.ok, true);
assert.equal(verifierOk.oauthUrl.clientIdParamMatchesLoadedConfig, true);
assert.equal(verifierOk.oauthUrl.clientIdParamStartsWithHttps, false);
assert.equal(JSON.stringify(verifierOk).includes("client-secret"), false);
assert.equal(JSON.stringify(verifierOk).includes("token-secret"), false);

const staleEnv = {
  ...validEnv,
  GOOGLE_CLIENT_ID: "9999999999-stale.apps.googleusercontent.com",
};
const staleResult = verifyGoogleClassroomConfig(staleEnv, { cwd: tempRoot });
assert.equal(staleResult.ok, false);
assert.equal(staleResult.processEnvOverridesDotEnv, true);
assert(staleResult.problems.some((problem) => problem.includes("differs from .env")));

const duplicateRoot = await mkdtemp(join(tmpdir(), "studentos-classroom-config-dupe-"));
await writeFile(join(duplicateRoot, ".env"), [
  "STUDENTOS_GOOGLE_CLASSROOM_MODE=oauth",
  "GOOGLE_CLIENT_ID=1234567890-studentos.apps.googleusercontent.com",
  "GOOGLE_CLIENT_ID=1234567890-studentos.apps.googleusercontent.com",
  "GOOGLE_CLIENT_SECRET=client-secret",
  "GOOGLE_REDIRECT_URI=http://localhost:3101/api/classroom/oauth/callback",
  "STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET=token-secret",
].join("\n"));
const duplicateResult = verifyGoogleClassroomConfig(validEnv, { cwd: duplicateRoot });
assert.equal(duplicateResult.ok, false);
assert(duplicateResult.duplicateEnvKeys.includes("GOOGLE_CLIENT_ID"));

console.log("PASS | StudentOS Pass 24.5/24.6 Classroom config verifier tests passed");
