import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabaseEnvironment, loadDotEnv } from "../../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../../backend/supabase/clients.js";
import { routeUserToShard } from "../../backend/supabase/shardRouter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FIXTURE_DIR = path.join(__dirname, "fixtures");
function truthy(value) {
  return ["1", "true", "yes"].includes(String(value || "").toLowerCase());
}

const LIVE_ENABLED = truthy(process.env.STUDENTOS_E2E_SUPABASE_LIVE);
const REPORT_ENABLED = truthy(process.env.STUDENTOS_E2E_SUPABASE_REPORT);
const DELETE_AUTH_USER_ENABLED = truthy(process.env.STUDENTOS_E2E_SUPABASE_DELETE_AUTH_USER);
const DISPOSABLE_E2E_EMAIL_RE = /^studentos\.e2e\.[^@]+@example\.com$/i;
const REPORT_DIR = path.join(ROOT, "test-results", "supabase-live");
const REPORT_JSON_PATH = path.join(REPORT_DIR, "latest.json");
const REPORT_SUMMARY_PATH = path.join(REPORT_DIR, "latest.md");

const USER_TABLES_FOR_CLEANUP = [
  "monitoring_alert_events",
  "billing_cancellation_events",
  "operator_audit_events",
  "deletion_execution_evidence",
  "data_export_jobs",
  "data_export_requests",
  "account_deletion_reviews",
  "account_deletion_requests",
  "role_invitations",
  "legal_acceptances",
  "user_consents",
  "consent_versions",
  "billing_webhook_events",
  "billing_subscriptions",
  "job_events",
  "background_jobs",
  "embeddings_metadata",
  "memory_items",
  "ai_messages",
  "ai_conversations",
  "audit_logs",
  "assignment_automation_contracts",
  "tutor_lessons",
  "revision_events",
  "roadmap_items",
  "credit_ledger",
  "test_results",
  "test_sessions",
  "source_chunks",
  "source_materials",
  "notes",
  "timetable_events",
  "assignments",
  "exams",
  "syllabi",
  "topics",
  "courses",
  "student_profiles",
];

const REQUIRED_ROW_TABLES = [
  "student_profiles",
  "courses",
  "roadmap_items",
  "source_materials",
  "source_chunks",
  "ai_messages",
  "data_export_requests",
];

const LEAK_CHECK_TABLES = [
  "student_profiles",
  "courses",
  "source_materials",
  "source_chunks",
  "ai_messages",
  "data_export_requests",
];

function maskEmail(email) {
  const value = String(email || "");
  const match = value.match(/^([^@]+)@(.+)$/);
  if (!match) return "[masked-email]";
  const [local, domain] = [match[1], match[2]];
  const prefix = local.slice(0, 15);
  const suffix = local.slice(-4);
  return `${prefix}...[${Math.max(local.length - prefix.length - suffix.length, 0)}]...${suffix}@${domain}`;
}

function maskId(id) {
  const value = String(id || "");
  if (value.length <= 10) return value ? "[masked-id]" : "";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function isDisposableTestUser(user) {
  return Boolean(user?.id && DISPOSABLE_E2E_EMAIL_RE.test(String(user?.email || "")));
}

function newReportState() {
  return {
    reportVersion: "pass30-live-supabase-e2e",
    generatedAt: new Date().toISOString(),
    status: "running",
    secretsPrinted: false,
    testUser: { emailMasked: "", userIdMasked: "", disposablePatternMatched: false },
    shard: { label: "", index: null },
    rowCounts: { routedShard: {}, otherShards: {} },
    cleanup: {
      dataShard: { attempted: false, skipped: false, reason: "not_started", rowTablesAttempted: 0, storage: [], errors: [] },
      auth: { attempted: false, deleted: false, skippedReason: "flag_not_enabled", error: null },
    },
    failures: [],
    notes: [],
  };
}

function summarizeStorage(storage = []) {
  return storage.map((item) => ({
    bucket: item.bucket || "[unknown]",
    count: Number(item.count || 0),
    deleted: Boolean(item.deleted),
    error: item.error ? safeError(item.error) : null,
  }));
}

function buildReadableReport(report) {
  const lines = [
    "# StudentOS Live Supabase E2E Report",
    "",
    `- Status: ${report.status}`,
    `- Generated: ${report.generatedAt}`,
    `- Shard: ${report.shard.label || "unknown"}`,
    `- Test email: ${report.testUser.emailMasked || "unknown"}`,
    `- User id: ${report.testUser.userIdMasked || "unknown"}`,
    `- Disposable pattern matched: ${report.testUser.disposablePatternMatched}`,
    `- Auth cleanup: ${report.cleanup.auth.deleted ? "deleted" : report.cleanup.auth.skippedReason || "not deleted"}`,
    "",
    "## Routed Shard Row Counts",
    "",
  ];
  for (const [table, count] of Object.entries(report.rowCounts.routedShard || {})) {
    lines.push(`- ${table}: ${count}`);
  }
  lines.push("", "## Other Shard Row Counts", "");
  for (const [label, counts] of Object.entries(report.rowCounts.otherShards || {})) {
    const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
    lines.push(`- ${label}: ${total}`);
  }
  lines.push("", "## Cleanup", "");
  lines.push(`- Data shard attempted: ${report.cleanup.dataShard.attempted}`);
  lines.push(`- Data shard skipped: ${report.cleanup.dataShard.skipped}`);
  lines.push(`- Data shard reason: ${report.cleanup.dataShard.reason || "none"}`);
  lines.push(`- Row tables attempted: ${report.cleanup.dataShard.rowTablesAttempted || 0}`);
  for (const item of report.cleanup.dataShard.storage || []) {
    lines.push(`- Storage ${item.bucket}: ${item.count} object(s), deleted=${item.deleted}`);
  }
  if ((report.cleanup.dataShard.errors || []).length) {
    lines.push("", "## Cleanup Errors", "");
    for (const error of report.cleanup.dataShard.errors) lines.push(`- ${safeError(error)}`);
  }
  if ((report.failures || []).length) {
    lines.push("", "## Failures", "");
    for (const failure of report.failures) lines.push(`- ${safeError(failure)}`);
  }
  return `${lines.join("\n")}\n`;
}

async function writeE2EReport(report) {
  if (!REPORT_ENABLED) return;
  const safeReport = {
    ...report,
    generatedAt: new Date().toISOString(),
    cleanup: {
      ...report.cleanup,
      dataShard: {
        ...report.cleanup.dataShard,
        storage: summarizeStorage(report.cleanup.dataShard.storage),
        errors: (report.cleanup.dataShard.errors || []).map(safeError),
      },
      auth: {
        ...report.cleanup.auth,
        error: report.cleanup.auth.error ? safeError(report.cleanup.auth.error) : null,
      },
    },
    failures: (report.failures || []).map(safeError),
  };
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT_JSON_PATH, `${JSON.stringify(safeReport, null, 2)}\n`, "utf8");
  await writeFile(REPORT_SUMMARY_PATH, buildReadableReport(safeReport), "utf8");
}

function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(access[_-]?token|refresh[_-]?token|service[_-]?role|client[_-]?secret|api[_-]?key|password)([=:]\s*)[^\s"']+/gi, "$1$2[redacted]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted.jwt]")
    .slice(0, 2000);
}

function safeError(error) {
  return redact(error?.message || error || "unknown_error");
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForHealth(baseUrl, child, logs) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`StudentOS live E2E server did not become healthy. ${redact(logs.join("\n"))}`);
}

async function waitForNotLoading(locator, loadingText) {
  await expect(locator).not.toContainText(loadingText, { timeout: 20_000 });
}

async function waitForUploadSettled(page) {
  const locator = page.locator("#source-result");
  await expect.poll(async () => locator.innerText(), {
    timeout: 35_000,
    message: "source upload should render success or safe error",
  }).toMatch(/Live E2E quadratics note|Source upload unavailable|Invalid source upload|Source upload did not finish|Source upload failed/i);
  return locator.innerText();
}
async function waitForExportSettled(page) {
  const locator = page.locator("#account-action-result");
  await expect.poll(async () => locator.innerText(), {
    timeout: 35_000,
    message: "export request should render success or safe error",
  }).toMatch(/Export request created|Export request unavailable|StudentOS request did not finish/i);
  return locator.innerText();
}
async function clickNav(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator("#view-title")).toHaveText(name);
}

async function openAiDrawer(page) {
  await page.getByRole("button", { name: /Ask StudentOS/i }).click();
  await expect(page.locator("#ai-panel")).toBeVisible();
}

async function closeAiDrawer(page) {
  await page.getByRole("button", { name: "Close AI drawer" }).click();
  await expect(page.locator("#ai-panel")).not.toBeVisible();
}

function requireLiveSupabaseConfig(config) {
  const missing = [];
  if (config.mode !== "supabase") missing.push("complete Supabase auth + shard configuration");
  if (!config.auth.serviceRoleKey) missing.push("STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1");
  if (!config.auth.url) missing.push("STUDENTOS_SUPABASE_URL_1");
  if (!config.auth.anonKey) missing.push("STUDENTOS_SUPABASE_ANON_KEY_1");
  for (const shard of config.shards) {
    if (!shard.url || !shard.serviceRoleKey) missing.push(`${shard.label} URL/service role key`);
  }
  if (missing.length) {
    throw new Error(`Live Supabase E2E is enabled but required configuration is missing: ${missing.join(", ")}`);
  }
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.msg || body?.message || body?.error_description || body?.error || `HTTP ${response.status}`;
    throw new Error(`${label} failed: ${redact(message)}`);
  }
  return body;
}

async function adminCreateUser(config) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = `studentos.e2e.${suffix}@example.com`;
  const password = `StOS-${randomUUID()}-29!`;
  const response = await fetch(`${config.auth.url.replace(/\/+$/, "")}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: config.auth.serviceRoleKey,
      Authorization: `Bearer ${config.auth.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        source: "studentos_live_e2e",
        disposable: true,
      },
    }),
  });
  const body = await parseJsonResponse(response, "create disposable Supabase user");
  const id = body?.id || body?.user?.id;
  if (!id) throw new Error("create disposable Supabase user failed: no user id returned");
  const user = { id, email, password };
  if (!isDisposableTestUser(user)) throw new Error("create disposable Supabase user failed: unsafe disposable email pattern");
  return user;
}

async function safeSelect(client, table, userId, columns = "id", limit = 1000) {
  try {
    return await client.select(table, {
      columns,
      filters: { user_id: `eq.${userId}` },
      limit,
    });
  } catch (error) {
    return { error: safeError(error), rows: [] };
  }
}

async function countUserRows(client, table, userId) {
  const rows = await client.select(table, {
    columns: table === "student_profiles" ? "user_id" : "id",
    filters: { user_id: `eq.${userId}` },
    limit: 1000,
  });
  return Array.isArray(rows) ? rows.length : 0;
}

async function deleteStorageObjects(client, rows) {
  const byBucket = new Map();
  for (const row of rows) {
    if (!row?.storage_bucket || !row?.storage_path) continue;
    const paths = byBucket.get(row.storage_bucket) || [];
    paths.push(row.storage_path);
    byBucket.set(row.storage_bucket, paths);
  }
  const results = [];
  for (const [bucket, paths] of byBucket.entries()) {
    try {
      await client.deleteObjects(bucket, paths);
      results.push({ bucket, count: paths.length, deleted: true });
    } catch (error) {
      results.push({ bucket, count: paths.length, deleted: false, error: safeError(error) });
    }
  }
  return results;
}

async function cleanupShardData(route, user) {
  if (!isDisposableTestUser(user)) {
    return { attempted: false, skipped: true, reason: "not_disposable_test_user", rowTablesAttempted: 0, storage: [], errors: [] };
  }
  const userId = user.id;
  const client = route?.client;
  if (!client) return { attempted: false, skipped: true, reason: "missing_shard_client", rowTablesAttempted: 0, storage: [], errors: ["missing_shard_client"] };
  const sourceRows = await safeSelect(client, "source_materials", userId, "id,storage_bucket,storage_path", 500);
  const exportRows = await safeSelect(client, "data_export_requests", userId, "id,storage_bucket,storage_path", 500);
  const storageRows = [
    ...(Array.isArray(sourceRows) ? sourceRows : []),
    ...(Array.isArray(exportRows) ? exportRows : []),
  ];
  const storage = await deleteStorageObjects(client, storageRows);
  const errors = [];
  for (const table of USER_TABLES_FOR_CLEANUP) {
    const column = ["operator_audit_events", "monitoring_alert_events", "billing_cancellation_events", "deletion_execution_evidence"].includes(table) ? "target_user_id" : "user_id";
    try {
      await client.deleteRows(table, { filters: { [column]: `eq.${userId}` } });
    } catch (error) {
      errors.push(`${table}:${safeError(error)}`);
    }
  }
  return {
    attempted: true,
    skipped: false,
    reason: errors.length ? "completed_with_errors" : "completed",
    rowTablesAttempted: USER_TABLES_FOR_CLEANUP.length,
    storage,
    errors: errors.slice(0, 8),
  };
}

async function assertNoServiceSecretsInFrontend(page, baseUrl, secrets) {
  const configResponse = await page.request.get(`${baseUrl}/api/config`);
  const configText = await configResponse.text();
  const pageText = await page.content();
  const browserStorage = await page.evaluate(() => JSON.stringify({
    localStorage: { ...window.localStorage },
    sessionStorage: { ...window.sessionStorage },
  })).catch(() => "{}");
  const combined = `${configText}\n${pageText}\n${browserStorage}`;
  for (const secret of secrets.filter((value) => value && String(value).length >= 12)) {
    expect(combined.includes(secret)).toBe(false);
  }
  for (const forbiddenMarker of [
    "STUDENTOS_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE",
    "GOOGLE_CLIENT_SECRET",
    "GROQ_API_KEY",
    "POLLINATIONS_API_KEY",
  ]) {
    expect(combined.includes(forbiddenMarker)).toBe(false);
  }
}

let liveEnv;
let config;
let clients;
let disposableUser;
let selectedRoute;
let serverProcess;
let baseUrl;
let serverLogs = [];
let cleanupSummary = null;
let testCompleted = false;
const reportState = newReportState();

test.describe.configure({ mode: "serial" });

test.describe("StudentOS live Supabase E2E", () => {
  test.skip(!LIVE_ENABLED, "Set STUDENTOS_E2E_SUPABASE_LIVE=true to run the disposable live Supabase E2E.");

  test.beforeAll(async () => {
    if (!LIVE_ENABLED) return;
    loadDotEnv({ cwd: ROOT });
    liveEnv = {
      ...process.env,
      STUDENTOS_MODE: "supabase",
      STUDENTOS_GOOGLE_CLASSROOM_MODE: "disabled",
      STUDENTOS_AI_MODE: "mock",
      STUDENTOS_RATE_LIMIT_ENABLED: "false",
      STUDENTOS_QUOTA_ENFORCEMENT: "false",
      STUDENTOS_ENV: "development",
      NODE_ENV: "development",
    };
    config = getSupabaseEnvironment(liveEnv);
    requireLiveSupabaseConfig(config);
    clients = createSupabaseClients(config);
    disposableUser = await adminCreateUser(config);
    selectedRoute = routeUserToShard(disposableUser.id, clients.shardClients);
    reportState.testUser = {
      emailMasked: maskEmail(disposableUser.email),
      userIdMasked: maskId(disposableUser.id),
      disposablePatternMatched: isDisposableTestUser(disposableUser),
    };
    reportState.shard = { label: selectedRoute?.label || "unknown", index: selectedRoute?.index ?? null };

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...liveEnv,
        STUDENTOS_PORT: String(port),
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess.stdout.on("data", (chunk) => serverLogs.push(redact(chunk)));
    serverProcess.stderr.on("data", (chunk) => serverLogs.push(redact(chunk)));
    await waitForHealth(baseUrl, serverProcess, serverLogs);
  });

  test.afterEach(async ({}, testInfo) => {
    if (!LIVE_ENABLED) return;
    if (testInfo.status !== testInfo.expectedStatus) {
      reportState.failures.push(testInfo.error?.message || `${testInfo.title}: ${testInfo.status}`);
    }
  });

  test.afterAll(async () => {
    if (!LIVE_ENABLED) return;
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await Promise.race([
        once(serverProcess, "exit"),
        delay(1500).then(() => serverProcess.kill("SIGKILL")),
      ]).catch(() => {});
    }
    if (selectedRoute?.client && disposableUser?.id) {
      cleanupSummary = await cleanupShardData(selectedRoute, disposableUser);
      reportState.cleanup.dataShard = cleanupSummary;
    }
    if (DELETE_AUTH_USER_ENABLED && clients?.authClient && isDisposableTestUser(disposableUser)) {
      reportState.cleanup.auth.attempted = true;
      try {
        await clients.authClient.adminDeleteUser(disposableUser.id);
        reportState.cleanup.auth.deleted = true;
        reportState.cleanup.auth.skippedReason = null;
      } catch (error) {
        reportState.cleanup.auth.error = safeError(error);
        reportState.cleanup.auth.skippedReason = "delete_failed";
      }
    } else if (!isDisposableTestUser(disposableUser)) {
      reportState.cleanup.auth.skippedReason = "not_disposable_test_user";
    }
    reportState.status = testCompleted ? "passed" : "failed_or_interrupted";
    await writeE2EReport(reportState);
  });

  test("browser flows persist to exactly one data shard", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors = [];
    const uploadResponses = [];
    const exportResponses = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/api/sources/upload") && !response.url().includes("/api/account/export-request")) return;
      const body = await response.text().catch(() => "[unavailable]");
      const item = { status: response.status(), body: redact(body) };
      if (response.url().includes("/api/sources/upload")) uploadResponses.push(item);
      if (response.url().includes("/api/account/export-request")) exportResponses.push(item);
    });
    page.on("pageerror", (error) => pageErrors.push(redact(error.message)));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(redact(message.text()));
    });

    await page.goto(baseUrl);
    await expect(page).toHaveTitle(/StudentOS/);

    const publicConfig = await (await page.request.get(`${baseUrl}/api/config`)).json();
    expect(publicConfig.pass).toBe("30");
    expect(publicConfig.storageMode).toBe("supabase");
    expect(publicConfig.auth?.enabled).toBe(true);
    expect(publicConfig.auth?.anonKey).toBeTruthy();
    expect(publicConfig.auth?.anonKey).not.toBe(config.auth.serviceRoleKey);
    await expect(page.locator("#public-auth-shell")).toBeVisible();
    await expect(page.locator("#app-shell")).toBeHidden();

    await page.locator("#auth-email").fill(disposableUser.email);
    await page.locator("#auth-password").fill(disposableUser.password);
    const firstBootstrapAfterSignIn = page.waitForResponse((response) => response.url().includes("/api/bootstrap") && response.status() === 200);
    await page.getByRole("button", { name: "Sign in" }).click();
    await firstBootstrapAfterSignIn;
    await expect(page.locator("#public-auth-shell")).toBeHidden();
    await expect(page.locator("#app-shell")).toBeVisible();
    await expect(page.locator("#auth-session")).toContainText(disposableUser.email, { timeout: 15_000 });
    await expect(page.locator("#auth-help")).toContainText("Session active");

    await clickNav(page, "Setup");
    await page.locator("#onboarding-form input[name='displayName']").fill("Live Supabase E2E Student");
    await page.locator("#onboarding-form input[name='stream']").fill("Science");
    await page.locator("#onboarding-form textarea[name='subjectsText']").fill("Mathematics|2026-07-01|Quadratics, Trigonometry\nPhysics|2026-07-04|Motion graphs");
    await page.locator("#onboarding-form textarea[name='weakTopicsText']").fill("Mathematics: Trigonometry");
    await page.locator("#onboarding-form textarea[name='completedTopicsText']").fill("Mathematics: Quadratics");
    await page.getByRole("button", { name: "Generate roadmap" }).click();
    await expect(page.locator("#onboarding-result")).toContainText("course roadmap generated", { timeout: 15_000 });
    await expect(page.locator("#view-title")).toHaveText("Today");

    await clickNav(page, "Memory");
    await page.locator("#source-form input[name='title']").fill("Live E2E quadratics note");
    await page.locator("#source-file").setInputFiles(path.join(FIXTURE_DIR, "quadratics-note.txt"));
    await page.getByRole("button", { name: "Upload private source" }).click();
    const uploadResultText = await waitForUploadSettled(page);
    if (!uploadResultText.includes("Live E2E quadratics note")) {
      await testInfo.attach("masked-source-upload-response", {
        body: Buffer.from(JSON.stringify(uploadResponses, null, 2)),
        contentType: "application/json",
      });
    }
    expect(uploadResultText).toContain("Live E2E quadratics note");
    await expect(page.locator("#source-result")).toContainText(/source section/i);
    await expect(page.locator("#source-result")).toContainText("Private");

    await clickNav(page, "Studio");
    await openAiDrawer(page);
    for (const verb of ["Ask", "Plan", "Make", "Review"]) {
      await page.locator(`.verb-tab[data-verb='${verb}']`).click();
      await page.locator("#ai-message").fill(`${verb}: answer from the uploaded quadratics note with citations.`);
      await page.locator("#ai-form").getByRole("button", { name: "Run" }).click();
      await waitForNotLoading(page.locator("#ai-response"), "Checking your materials");
      await expect(page.locator("#ai-response")).toContainText(`${verb} result`, { timeout: 20_000 });
      await expect(page.locator("#ai-response")).toContainText(/Cited snippets|uploaded material|source|materials/i);
    }
    await closeAiDrawer(page);

    await page.getByRole("button", { name: "Check readiness" }).click();
    await waitForNotLoading(page.locator("#flow-result"), "Checking coverage and next learning step");
    await expect(page.locator("#flow-result")).toContainText("Topic coverage", { timeout: 20_000 });
    await expect(page.locator("#flow-result")).toContainText("Study queue update");
    await expect(page.locator("#flow-result")).toContainText("No submission");

    await clickNav(page, "Account");
    await expect(page.locator("#pricing-panel")).toContainText(/Starter|Essential|Plus|Pro/i, { timeout: 15_000 });
    await expect(page.locator("#quota-panel")).toContainText(/academic context|semester/i);
    await expect(page.locator("#quota-panel")).not.toContainText(/MB|GB|storage|tokens/i);
    await page.getByRole("button", { name: "Request data export" }).click();
    const exportResultText = await waitForExportSettled(page);
    if (!exportResultText.includes("Export request created")) {
      await testInfo.attach("masked-export-request-response", {
        body: Buffer.from(JSON.stringify(exportResponses, null, 2)),
        contentType: "application/json",
      });
    }
    expect(exportResultText).toContain("Export request created");

    const bootstrapAfterLogout = page.waitForResponse((response) => response.url().includes("/api/bootstrap") && response.status() === 200);
    await page.getByRole("button", { name: "Logout" }).click();
    await bootstrapAfterLogout;
    await expect(page.locator("#auth-session")).toContainText(/Auth ready|Sign in again/i, { timeout: 15_000 });
    await page.locator("#auth-email").fill(disposableUser.email);
    await page.locator("#auth-password").fill(disposableUser.password);
    const secondBootstrapAfterSignIn = page.waitForResponse((response) => response.url().includes("/api/bootstrap") && response.status() === 200);
    await page.getByRole("button", { name: "Sign in" }).click();
    await secondBootstrapAfterSignIn;
    await expect(page.locator("#auth-session")).toContainText(disposableUser.email, { timeout: 15_000 });
    await clickNav(page, "Memory");
    await expect(page.locator("#source-list")).toContainText("Live E2E quadratics note", { timeout: 15_000 });

    await assertNoServiceSecretsInFrontend(page, baseUrl, [
      config.auth.serviceRoleKey,
      ...config.shards.map((shard) => shard.serviceRoleKey),
      config.jwtSecret,
      process.env.GROQ_API_KEY,
      process.env.POLLINATIONS_API_KEY,
      process.env.GOOGLE_CLIENT_SECRET,
    ]);

    const selectedCounts = {};
    for (const table of REQUIRED_ROW_TABLES) {
      selectedCounts[table] = await countUserRows(selectedRoute.client, table, disposableUser.id);
      expect(selectedCounts[table], `${table} should exist on routed shard`).toBeGreaterThan(0);
    }
    reportState.rowCounts.routedShard = selectedCounts;

    let shardsWithRows = 0;
    for (const shard of clients.shardClients) {
      let rowsOnShard = 0;
      const tableCounts = {};
      for (const table of LEAK_CHECK_TABLES) {
        const count = await countUserRows(shard.client, table, disposableUser.id);
        tableCounts[table] = count;
        rowsOnShard += count;
      }
      if (shard.label !== selectedRoute.label) {
        reportState.rowCounts.otherShards[shard.label] = tableCounts;
      }
      if (rowsOnShard > 0) shardsWithRows += 1;
      if (shard.label !== selectedRoute.label) {
        expect(rowsOnShard, `${shard.label} should not contain disposable user rows`).toBe(0);
      }
    }
    expect(shardsWithRows).toBe(1);
    expect(selectedRoute.label).toMatch(/^data-shard-/);
    expect(pageErrors).toEqual([]);
    testCompleted = true;
  });
});
