import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const liveSpec = await readFile(new URL("../tests/e2e/studentos-supabase-live.spec.js", import.meta.url), "utf8");
const reportScript = await readFile(new URL("../scripts/runSupabaseE2EReport.js", import.meta.url), "utf8");
const cleanupScript = await readFile(new URL("../scripts/cleanupSupabaseE2EUsers.js", import.meta.url), "utf8");
const liveDoc = await readFile(new URL("../docs/E2E_SUPABASE_LIVE.md", import.meta.url), "utf8");
const runbook = await readFile(new URL("../docs/E2E_SUPABASE_LIVE_RUNBOOK.md", import.meta.url), "utf8");
const qa = await readFile(new URL("../docs/QA_CHECKLIST.md", import.meta.url), "utf8");
const server = await readFile(new URL("./server.js", import.meta.url), "utf8");
const app = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");

assert.equal(pkg.scripts["test:e2e:supabase:report"], "node scripts/runSupabaseE2EReport.js");
assert.equal(pkg.scripts["cleanup:e2e:supabase-users"], "node scripts/cleanupSupabaseE2EUsers.js");
assert.equal(pkg.scripts["test:pass30"], "node backend/testPass30.js");
assert(server.includes('const STUDENTOS_APP_PASS = "30";'));

for (const marker of [
  "STUDENTOS_E2E_SUPABASE_REPORT",
  "REPORT_JSON_PATH",
  "REPORT_SUMMARY_PATH",
  "test-results",
  "maskEmail",
  "maskId",
  "DISPOSABLE_E2E_EMAIL_RE",
  "not_disposable_test_user",
  "rowCounts.routedShard",
  "rowCounts.otherShards",
  "secretsPrinted: false",
]) {
  assert(liveSpec.includes(marker), `live E2E spec missing ${marker}`);
}

for (const marker of [
  "STUDENTOS_E2E_SUPABASE_LIVE: \"true\"",
  "STUDENTOS_E2E_SUPABASE_REPORT: \"true\"",
  "test-results",
  "latest.json",
  "latest.md",
  "redact(chunk)",
]) {
  assert(reportScript.includes(marker), `report runner missing ${marker}`);
}

for (const marker of [
  "DISPOSABLE_E2E_EMAIL_RE",
  "STUDENTOS_E2E_DELETE_STALE_USERS",
  "MIN_AGE_HOURS",
  "isDisposableUser",
  "not_disposable_test_user",
  "routeUserToShard",
  "deleteRows",
  "adminDeleteUser",
]) {
  assert(cleanupScript.includes(marker), `cleanup helper missing ${marker}`);
}

assert(cleanupScript.includes("DELETE_ENABLED") && cleanupScript.includes("delete_flag_not_set"));
assert.equal(cleanupScript.includes("@gmail.com"), false, "cleanup helper must not target real personal domains");
assert.equal(cleanupScript.includes("DELETE FROM auth"), false, "cleanup helper must use Auth API boundary");
assert.equal(reportScript.includes("console.log(process.env"), false, "report runner must not dump env");

for (const marker of [
  "test:e2e:supabase:report",
  "test-results/supabase-live/latest.json",
  "cleanup:e2e:supabase-users",
  "studentos.e2e.*@example.com",
  "Troubleshooting",
]) {
  assert(runbook.includes(marker), `runbook missing ${marker}`);
}
assert(liveDoc.includes("Pass 30 adds optional report artifacts"));
assert(liveDoc.includes("test:e2e:supabase:report"));
assert(qa.includes("test:e2e:supabase:report"));

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

console.log("PASS | StudentOS Pass 30 live E2E reporting and cleanup guard tests passed");
