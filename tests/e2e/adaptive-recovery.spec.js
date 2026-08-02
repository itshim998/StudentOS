import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TODAY = new Date().toISOString().slice(0, 10);

function delay(ms) {
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

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await delay(200);
    }
  }
  throw new Error("StudentOS Recovery E2E server did not become healthy.");
}

async function preparePlusWorkspace(baseUrl) {
  const post = async (action, payload = {}) => {
    const response = await fetch(`${baseUrl}/api/product-flow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    if (!response.ok) throw new Error(`Recovery E2E setup action ${action} failed.`);
  };
  await post("save_onboarding_step", { step: "about_you", answers: { displayName: "Recovery Student" } });
  await post("save_onboarding_step", { step: "education_system", answers: { level: "Undergraduate", stream: "Engineering", yearSemester: "Semester 2" } });
  await post("select_plan", { planId: "plus" });
  await post("choose_access", { accessMode: "paid_plan" });
  await post("verify_payment_method_placeholder");
  await post("complete_legal", {
    ageGate: "adult",
    consents: Object.fromEntries([
      "termsOfService", "privacyPolicy", "trialBilling", "trialLimits", "paymentMandate",
      "cancellationWindow", "academicDataUse", "noOutcomeGuarantee", "responsibleUse", "aiAccuracy",
    ].map((key) => [key, true])),
  });
  await post("save_onboarding_step", { step: "daily_schedule", answers: { schedule: "Weekdays after 6 PM" } });
  await post("save_onboarding_step", { step: "exam_pattern", answers: { examPattern: "Monthly assessments" } });
  await post("save_onboarding_step", { step: "academic_context", answers: { subjects: "Mathematics|2026-08-20|Algebra", syllabusNotes: "Algebra and calculus" } });
  await post("choose_classroom_path", { choice: "manual" });
  await post("save_materials", { materialIds: [], materialLabels: [] });
  await post("confirm_setup_summary");
  await post("prepare_workspace");
  await post("choose_tutorial", { choice: "skip" });
}

function recoveryCapability(status) {
  return {
    status,
    available: status === "available",
    reviewRequired: true,
    automaticApply: false,
  };
}

async function routeBootstrap(page, { status = "available", planKey = "plus", applied = null } = {}) {
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.planAccess = body.planAccess || {};
    body.planAccess.activePlanKey = planKey;
    body.planAccess.capabilities = body.planAccess.capabilities || {};
    body.planAccess.capabilities.recovery = recoveryCapability(status);
    if (applied?.value) {
      body.academicContext = {
        ...(body.academicContext || {}),
        status: "context_ready",
        hasContext: true,
        hasUsefulContext: true,
        canPrepare: false,
        canGenerateTodo: true,
      };
      body.todayPlan = {
        date: TODAY,
        summary: "Adjusted plan approved for today.",
        items: [{ id: "approved_task", title: "Focused algebra review", duration_minutes: 30, priority: "high", study_status: "not_started" }],
      };
    }
    await route.fulfill({ response, body: JSON.stringify(body), contentType: "application/json" });
  });
}

function previewFixture(status = "ready_for_review") {
  return {
    id: "preview_e2e",
    runId: "run_e2e",
    status,
    summary: "A shorter algebra review can protect the rest of today’s work.",
    evidenceSummary: { topicCount: 2, courseCount: 1, supportingItemCount: 3 },
    currentPlan: { date: TODAY, summary: "Current plan", taskCount: 3, completedTaskCount: 1, totalMinutes: 100 },
    proposedPlan: { date: TODAY, summary: "Proposed plan", taskCount: 4, completedTaskCount: 1, totalMinutes: 110 },
    changes: {
      added: [{ type: "task_added", title: "Algebra practice", before: null, after: { title: "Algebra practice", durationMinutes: 30, priority: "high" }, explanation: "Recent test evidence supports a focused review.", supportingEvidenceCount: 2 }],
      moved: [{ type: "task_moved", title: "Calculus reading", before: { title: "Calculus reading", scheduledStart: "18:00" }, after: { title: "Calculus reading", scheduledStart: "19:00" }, explanation: "Moved to keep the urgent review first.", supportingEvidenceCount: 0 }],
      adjusted: [{ type: "duration_changed", title: "Formula recap", before: { title: "Formula recap", durationMinutes: 40 }, after: { title: "Formula recap", durationMinutes: 25 }, explanation: "A shorter recap fits the available time.", supportingEvidenceCount: 1 }],
      reassessments: [{ type: "reassessment_added", title: "Algebra check", before: null, after: { title: "Algebra check", durationMinutes: 20 }, explanation: "A short check can confirm progress.", supportingEvidenceCount: 1 }],
      deferred: [{ type: "task_deferred", title: "Optional reading", before: null, after: { title: "Optional reading", durationMinutes: 30 }, explanation: "Deferred to protect today’s available time.", supportingEvidenceCount: 0 }],
      warnings: [],
    },
    expiresAt: "2099-08-03T10:00:00.000Z",
    createdAt: "2026-08-02T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    applyAvailable: status === "ready_for_review",
    rejectAvailable: status === "ready_for_review",
    correlationId: "correlation_e2e",
  };
}

async function routeRecovery(page, {
  runStatuses = ["ready_for_review"],
  previewStatus = "ready_for_review",
  applied = null,
  applyDelayMs = 0,
} = {}) {
  const calls = { analyze: 0, run: 0, preview: 0, apply: 0, reject: 0, idempotency: [] };
  await page.route("**/api/recovery/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const idempotencyKey = request.headers()["idempotency-key"];
    if (idempotencyKey) calls.idempotency.push(idempotencyKey);
    if (request.method() === "POST" && url.pathname === "/api/recovery/analyze") {
      calls.analyze += 1;
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ runId: "run_e2e", run: { id: "run_e2e", status: "queued", previewId: null }, replayed: false }) });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/api/recovery/runs/run_e2e") {
      const status = runStatuses[Math.min(calls.run, runStatuses.length - 1)];
      calls.run += 1;
      const failed = status === "failed";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        run: {
          id: "run_e2e",
          status,
          progressStage: ["queued", "preparing", "reviewing", "planning"].includes(status) ? status : null,
          previewId: status === "ready_for_review" ? "preview_e2e" : null,
          error: failed ? { code: "RECOVERY_PROVIDER_FAILED", retryable: true } : null,
        },
      }) });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/api/recovery/previews/preview_e2e") {
      calls.preview += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ preview: previewFixture(previewStatus) }) });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/api/recovery/previews/preview_e2e/apply") {
      calls.apply += 1;
      if (applyDelayMs) await delay(applyDelayMs);
      if (applied) applied.value = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ preview: { ...previewFixture("applied"), applyAvailable: false, rejectAvailable: false }, replayed: calls.apply > 1 }) });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/api/recovery/previews/preview_e2e/reject") {
      calls.reject += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ preview: { ...previewFixture("rejected"), applyAvailable: false, rejectAvailable: false }, replayed: calls.reject > 1 }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found" }) });
  });
  return calls;
}

let serverProcess;
let baseUrl;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["backend/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      STUDENTOS_MODE: "mock",
      STUDENTOS_GOOGLE_CLASSROOM_MODE: "mock",
      STUDENTOS_PORT: String(port),
      PORT: String(port),
      STUDENTOS_ENV: "development",
      NODE_ENV: "development",
      STUDENTOS_AI_MODE: "mock",
      STUDENTOS_BACKGROUND_WORKERS_ENABLED: "false",
      STUDENTOS_ADAPTIVE_RECOVERY_ENABLED: "true",
      STUDENTOS_RECOVERY_UI_ENABLED: "true",
      STUDENTOS_RATE_LIMIT_ENABLED: "false",
      STUDENTOS_QUOTA_ENFORCEMENT: "false",
      STUDENTOS_TIER_OPERATIONAL: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth(baseUrl, serverProcess);
  await preparePlusWorkspace(baseUrl);
});

test.afterAll(async () => {
  if (!serverProcess) return;
  serverProcess.kill("SIGTERM");
  await Promise.race([once(serverProcess, "exit"), delay(1500).then(() => serverProcess.kill("SIGKILL"))]).catch(() => {});
});

for (const status of ["disabled", "plan_unavailable", "setup_required"]) {
  test(`keeps the Recovery entry hidden when capability is ${status}`, async ({ page }) => {
    await routeBootstrap(page, { status });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#app-shell")).toBeVisible();
    await expect(page.locator("#recovery-entry")).toBeHidden();
  });
}

for (const planKey of ["plus", "pro"]) {
  test(`shows Recovery from the server capability for ${planKey}`, async ({ page }) => {
    await routeBootstrap(page, { status: "available", planKey });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Adjust today’s plan/i })).toBeVisible();
  });
}

test("reviews, confirms, applies once, refreshes Today, and restores focus", async ({ page }) => {
  const applied = { value: false };
  await routeBootstrap(page, { applied });
  const calls = await routeRecovery(page, { runStatuses: ["queued", "reviewing", "ready_for_review"], applied, applyDelayMs: 120 });
  const failedRequests = [];
  const requestedUrls = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const openButton = page.getByRole("button", { name: /Adjust today’s plan/i });
  await expect(openButton).toBeVisible();
  await delay(250);
  expect(calls.analyze).toBe(0);
  await openButton.click();
  await expect(page.getByRole("heading", { name: "Review what needs adjusting" })).toBeVisible();
  expect(calls.analyze).toBe(0);
  await page.getByRole("button", { name: "Review my plan" }).click();
  await expect(page.getByRole("heading", { name: "Preparing your plan review" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reviewing your study evidence and planning" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "Review the proposed plan" })).toBeVisible({ timeout: 5000 });

  const recoveryDialog = page.locator("#recovery-dialog");
  await expect(recoveryDialog.getByText("Current plan", { exact: true })).toBeVisible();
  await expect(recoveryDialog.getByText("Proposed plan", { exact: true })).toBeVisible();
  await expect(recoveryDialog.getByText("Added tasks", { exact: false })).toBeVisible();
  await expect(recoveryDialog.getByText("Moved tasks", { exact: false })).toBeVisible();
  await expect(recoveryDialog.getByText("Duration or priority changes", { exact: false })).toBeVisible();
  await expect(recoveryDialog.getByText("Reassessments", { exact: false })).toBeVisible();
  await expect(recoveryDialog.getByText("Deferred for later", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByText("This will update only your StudentOS plan for Today.", { exact: false })).toBeVisible();
  expect(calls.apply).toBe(0);
  await page.getByRole("button", { name: "Update Today’s plan" }).evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.getByRole("heading", { name: "Plan updated" })).toBeVisible();
  expect(calls.analyze).toBe(1);
  expect(calls.apply).toBe(1);
  expect(new Set(calls.idempotency).size).toBe(2);
  await expect(page.getByText("Adjusted plan approved for today.")).toBeVisible();
  await page.getByRole("button", { name: "Close plan review" }).click();
  await expect(openButton).toBeFocused();
  expect(requestedUrls.some((url) => new URL(url).hostname === "i.ibb.co")).toBe(false);
  expect(failedRequests).toEqual([]);
});

test("keeps the current plan when the proposal is rejected", async ({ page }) => {
  await routeBootstrap(page);
  const calls = await routeRecovery(page);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboard-summary")).toContainText("Your academic context is ready");
  const before = await page.locator("#dashboard-summary").textContent();
  await page.getByRole("button", { name: /Adjust today’s plan/i }).click();
  await page.getByRole("button", { name: "Review my plan" }).click();
  await expect(page.getByRole("heading", { name: "Review the proposed plan" })).toBeVisible();
  await page.getByRole("button", { name: "Keep current plan" }).evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.getByRole("heading", { name: "Current plan kept" })).toBeVisible();
  expect(calls.reject).toBe(1);
  expect(await page.locator("#dashboard-summary").textContent()).toBe(before);
  await expect(page.getByRole("button", { name: "Start a fresh review" })).toBeVisible();
});

for (const previewStatus of ["superseded", "expired"]) {
  test(`prevents applying a ${previewStatus} plan review`, async ({ page }) => {
    await routeBootstrap(page);
    await routeRecovery(page, { previewStatus });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Adjust today’s plan/i }).click();
    await page.getByRole("button", { name: "Review my plan" }).click();
    await expect(page.getByRole("heading", { name: previewStatus === "expired" ? "This plan review expired" : "This plan review is no longer current" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply changes" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start a fresh review" })).toBeVisible();
  });
}

test("shows a safe retry state and preserves Today when analysis fails", async ({ page }) => {
  await routeBootstrap(page);
  await routeRecovery(page, { runStatuses: ["failed"] });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboard-summary")).toContainText("Your academic context is ready");
  const before = await page.locator("#dashboard-summary").textContent();
  await page.getByRole("button", { name: /Adjust today’s plan/i }).click();
  await page.getByRole("button", { name: "Review my plan" }).click();
  await expect(page.getByRole("heading", { name: "StudentOS could not finish this plan review" })).toBeVisible();
  expect(await page.locator("#dashboard-summary").textContent()).toBe(before);
  await expect(page.getByRole("button", { name: "Start a fresh review" })).toBeVisible();
});

test("resumes safely after refresh, stops when closed, and fits a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeBootstrap(page);
  const calls = await routeRecovery(page, { runStatuses: ["queued", "ready_for_review"] });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Adjust today’s plan/i }).click();
  await page.getByRole("button", { name: "Review my plan" }).click();
  await expect.poll(() => calls.run).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Close plan review" }).click();
  const closedRunCount = calls.run;
  await delay(1800);
  expect(calls.run).toBe(closedRunCount);

  await page.reload({ waitUntil: "domcontentloaded" });
  const continueButton = page.getByRole("button", { name: /Continue plan review/i });
  await expect(continueButton).toBeVisible();
  await continueButton.click();
  await expect(page.getByRole("heading", { name: "Review the proposed plan" })).toBeVisible({ timeout: 5000 });
  const overflow = await page.locator("#recovery-dialog").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(continueButton).toBeFocused();
});
