import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("./server.js", import.meta.url), "utf8");
const app = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const smoke = await readFile(new URL("../scripts/smokeCoreFlows.js", import.meta.url), "utf8");
const qa = await readFile(new URL("../docs/QA_CHECKLIST.md", import.meta.url), "utf8");
const playwrightConfig = await readFile(new URL("../playwright.config.js", import.meta.url), "utf8");
const e2eSpec = await readFile(new URL("../tests/e2e/studentos-desktop.spec.js", import.meta.url), "utf8");
const e2eFixture = await readFile(new URL("../tests/e2e/fixtures/quadratics-note.txt", import.meta.url), "utf8");
const liveClassroomDoc = await readFile(new URL("../docs/E2E_CLASSROOM_LIVE_MANUAL.md", import.meta.url), "utf8");
const connectorFiles = [
  await readFile(new URL("./connectors/googleClassroom/config.js", import.meta.url), "utf8"),
  await readFile(new URL("./connectors/googleClassroom/apiClient.js", import.meta.url), "utf8"),
  await readFile(new URL("./connectors/googleClassroom/syncService.js", import.meta.url), "utf8"),
  app,
].join("\n");

assert(server.includes('const STUDENTOS_APP_PASS = "30";'));
assert.equal(pkg.scripts["smoke:core"], "node scripts/smokeCoreFlows.js");
assert.equal(pkg.scripts["test:e2e"], "playwright test");
assert.equal(pkg.scripts["test:e2e:headed"], "playwright test --headed");
assert(smoke.includes("/api/health"));
assert(smoke.includes("/api/config"));
assert(smoke.includes("/api/onboarding"));
assert(smoke.includes("/api/sources/upload"));
assert(smoke.includes("/api/ai/verb"));
assert(smoke.includes("/api/assignment-flow"));
assert(smoke.includes("/api/classroom/sync"));
assert(smoke.includes("/api/account/export-request"));
assert(smoke.includes("/api/billing/status"));
assert(smoke.includes("STUDENTOS_MODE: \"mock\""));
assert(smoke.includes("STUDENTOS_GOOGLE_CLASSROOM_MODE: \"mock\""));

assert(app.includes("Assignment flow unavailable"));
assert(app.includes("Classroom import unavailable"));
assert(app.includes("Classroom sync needs the approved read-only scopes"));
assert(app.includes("Classroom access expired or was revoked"));
assert(app.includes("Google Classroom is rate-limiting this sync"));
assert(app.includes("connectClassroom().catch(renderClassroomError)"));
assert(app.includes("syncClassroom().catch(renderClassroomError)"));
assert(app.includes("disconnectClassroom().catch(renderClassroomError)"));

for (const forbidden of [
  "GOOGLE_CLIENT_SECRET",
  "STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET",
  "SUPABASE_SERVICE_ROLE",
  "GROQ_API_KEY",
  "POLLINATIONS_API_KEY",
  "refresh_token",
  "encryptedRefreshToken",
]) {
  assert.equal(app.includes(forbidden), false, `frontend exposes forbidden token/key marker ${forbidden}`);
}

for (const forbidden of [
  "turnIn",
  "modifyAttachments",
  "reclaimSubmission",
  "/turnIn",
  "/modifyAttachments",
  "/reclaim",
  "classroom.announcements",
]) {
  assert.equal(connectorFiles.includes(forbidden), false, `Classroom write action marker found: ${forbidden}`);
}

const frontendProductionCopy = app.toLowerCase();
assert.equal(frontendProductionCopy.includes("hack" + "athon"), false);
assert.equal(frontendProductionCopy.includes("proto" + "type"), false);
assert.equal(frontendProductionCopy.includes("demo" + "-only"), false);

assert(qa.includes("Startup QA"));
assert(qa.includes("Classroom QA"));
assert(qa.includes("UI Loading and Error QA"));
assert(qa.includes("Launch-Risk Review"));
assert(qa.includes("npm.cmd run test:e2e"));
assert(playwrightConfig.includes("trace: \"off\""));
assert(playwrightConfig.includes("screenshot: \"off\""));
assert(e2eSpec.includes("STUDENTOS_GOOGLE_CLASSROOM_MODE: \"mock\""));
assert(e2eSpec.includes("Connect Classroom") === false);
assert(e2eSpec.includes("Google password") === false);
assert(e2eSpec.includes("no write scopes"));
assert(e2eSpec.includes("Assignment flow unavailable"));
assert(e2eFixture.includes("Quadratics study note"));
assert(liveClassroomDoc.includes("Do not automate Google credentials"));
assert(liveClassroomDoc.includes("Do Not Automate"));

console.log("PASS | StudentOS Pass 27 QA stability sweep tests passed");
