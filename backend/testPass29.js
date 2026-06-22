import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const server = await readFile(new URL("./server.js", import.meta.url), "utf8");
const pass27 = await readFile(new URL("./testPass27.js", import.meta.url), "utf8");
const liveSpec = await readFile(new URL("../tests/e2e/studentos-supabase-live.spec.js", import.meta.url), "utf8");
const mockSpec = await readFile(new URL("../tests/e2e/studentos-desktop.spec.js", import.meta.url), "utf8");
const playwrightConfig = await readFile(new URL("../playwright.config.js", import.meta.url), "utf8");
const liveDoc = await readFile(new URL("../docs/E2E_SUPABASE_LIVE.md", import.meta.url), "utf8");
const classroomDoc = await readFile(new URL("../docs/E2E_CLASSROOM_LIVE_MANUAL.md", import.meta.url), "utf8");
const qa = await readFile(new URL("../docs/QA_CHECKLIST.md", import.meta.url), "utf8");
const smoke = await readFile(new URL("../scripts/smokeCoreFlows.js", import.meta.url), "utf8");
const app = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
const restClient = await readFile(new URL("./supabase/restClient.js", import.meta.url), "utf8");

assert.equal(pkg.scripts["test:e2e:supabase"], "playwright test tests/e2e/studentos-supabase-live.spec.js");
assert.equal(pkg.scripts["test:e2e"], "playwright test");
assert.equal(pkg.scripts["test:e2e:headed"], "playwright test --headed");
assert(server.includes('const STUDENTOS_APP_PASS = "30";'));
assert(smoke.includes('assert.equal(config.pass, "30");'));
assert(pass27.includes('const STUDENTOS_APP_PASS = "30";'));

assert(liveSpec.includes("STUDENTOS_E2E_SUPABASE_LIVE"));
assert(liveSpec.includes("test.skip(!LIVE_ENABLED"));
assert(liveSpec.includes('STUDENTOS_MODE: "supabase"'));
assert(liveSpec.includes('STUDENTOS_GOOGLE_CLASSROOM_MODE: "disabled"'));
assert(liveSpec.includes('STUDENTOS_AI_MODE: "mock"'));
assert(liveSpec.includes("adminCreateUser"));
assert(liveSpec.includes("/auth/v1/admin/users"));
assert(liveSpec.includes("STUDENTOS_E2E_SUPABASE_DELETE_AUTH_USER"));
assert(liveSpec.includes("adminDeleteUser"));
assert(liveSpec.includes("cleanupShardData"));
assert(liveSpec.includes("deleteStorageObjects"));
assert(liveSpec.includes("routeUserToShard"));
assert(liveSpec.includes("REQUIRED_ROW_TABLES"));
assert(liveSpec.includes("LEAK_CHECK_TABLES"));
assert(liveSpec.includes("assertNoServiceSecretsInFrontend"));
assert(liveSpec.includes("waitForUploadSettled"));
assert(liveSpec.includes("masked-source-upload-response"));
assert(liveSpec.includes("/api/sources/upload"));
assert(server.includes("SOURCE_UPLOAD_STAGE_TIMEOUT_MS"));
assert(server.includes("runUploadStage"));
assert(server.includes("source_upload.stage.failed"));
assert(server.includes("uploadStage"));
assert(server.includes("StudentOS request did not finish"));
assert(app.includes("Source upload unavailable"));
assert(app.includes("Uploading to private source library"));
assert(app.includes("AI response unavailable"));
assert(restClient.includes("DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS"));
assert(restClient.includes("fetchWithTimeout"));
assert(restClient.includes("StudentOS data request timed out"));
assert(liveSpec.includes("test.setTimeout(120_000)"));
assert(liveSpec.includes("GOOGLE_CLIENT_SECRET"));
assert(liveSpec.includes("SUPABASE_SERVICE_ROLE"));
assert(liveSpec.includes("GROQ_API_KEY"));
assert(liveSpec.includes("POLLINATIONS_API_KEY"));
assert(liveSpec.includes("Request data export"));
assert(liveSpec.includes("Logout"));
assert(liveSpec.includes("Live E2E quadratics note"));

for (const forbidden of [
  "Google password",
  "accounts.google.com",
  "Connect Classroom",
  "turnIn",
  "modifyAttachments",
  "classroom.coursework.students",
  "classroom.rosters",
]) {
  assert.equal(liveSpec.includes(forbidden), false, `live Supabase E2E must not automate Classroom/write flow: ${forbidden}`);
}

assert(mockSpec.includes('STUDENTOS_MODE: "mock"'));
assert(mockSpec.includes('STUDENTOS_GOOGLE_CLASSROOM_MODE: "mock"'));
assert(playwrightConfig.includes('trace: "off"'));
assert(playwrightConfig.includes('screenshot: "off"'));
assert(playwrightConfig.includes('video: "off"'));
assert(liveDoc.includes("disabled by default"));
assert(liveDoc.includes("STUDENTOS_E2E_SUPABASE_LIVE=true"));
assert(liveDoc.includes("STUDENTOS_E2E_SUPABASE_DELETE_AUTH_USER"));
assert(liveDoc.includes("exactly one routed data shard"));
assert(liveDoc.includes("Do not automate Google login"));
assert(classroomDoc.includes("Do not automate Google credentials"));
assert(qa.includes("npm.cmd run test:e2e:supabase"));

for (const forbidden of [
  "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_CLIENT_SECRET",
  "GROQ_API_KEY",
  "POLLINATIONS_API_KEY",
  "refresh_token",
  "encryptedRefreshToken",
]) {
  assert.equal(app.includes(forbidden), false, `frontend exposes forbidden marker ${forbidden}`);
}

console.log("PASS | StudentOS Pass 29 live Supabase E2E guard tests passed");
