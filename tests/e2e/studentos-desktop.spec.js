import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FIXTURE_DIR = path.join(__dirname, "fixtures");

function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(access[_-]?token|refresh[_-]?token|service[_-]?role|client[_-]?secret|api[_-]?key)([=:]\s*)[^\s"']+/gi, "$1$2[redacted]")
    .slice(0, 2000);
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
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`StudentOS E2E server did not become healthy. ${redact(logs.join("\n"))}`);
}

async function waitForNotLoading(locator, loadingText) {
  await expect(locator).not.toContainText(loadingText, { timeout: 15_000 });
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

let serverProcess;
let baseUrl;
let serverLogs = [];

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
      STUDENTOS_RATE_LIMIT_ENABLED: "false",
      STUDENTOS_QUOTA_ENFORCEMENT: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (chunk) => serverLogs.push(redact(chunk)));
  serverProcess.stderr.on("data", (chunk) => serverLogs.push(redact(chunk)));
  await waitForHealth(baseUrl, serverProcess, serverLogs);
});

test.afterAll(async () => {
  if (!serverProcess) return;
  serverProcess.kill("SIGTERM");
  await Promise.race([
    once(serverProcess, "exit"),
    delay(1500).then(() => serverProcess.kill("SIGKILL")),
  ]).catch(() => {});
});

test("desktop core flows stay usable in local mock mode", async ({ page }) => {
  const pageErrors = [];
  let expectingAssignmentFlowFailure = false;
  page.on("pageerror", (error) => pageErrors.push(redact(error.message)));
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      !(expectingAssignmentFlowFailure && text.includes("Failed to load resource") && text.includes("500"))
    ) {
      pageErrors.push(redact(text));
    }
  });

  await page.goto(baseUrl);
  await expect(page).toHaveTitle(/StudentOS/);
  await expect(page.getByRole("heading", { name: "StudentOS" })).toBeVisible();
  await expect(page.locator("#public-auth-shell")).toBeHidden();
  await expect(page.locator("#auth-session")).toContainText("Local demo");
  await expect(page.locator("#rail-session-status")).toContainText("Demo session");
  await expect(page.locator("#connector-status")).toContainText("Demo mode");
  await expect(page.locator("#dashboard-summary")).toContainText("Do now");
  await expect(page.locator("#dashboard-summary")).toContainText("Goal");
  await page.getByRole("button", { name: "Plan today" }).click();
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#ai-message")).toHaveValue(/Plan today from my study queue/i);
  await closeAiDrawer(page);

  for (const view of ["Today", "Setup", "Courses", "Memory", "Studio", "Account"]) {
    await clickNav(page, view);
  }

  await clickNav(page, "Setup");
  await expect(page.locator("#onboarding-form")).toContainText("Identity");
  await expect(page.locator("#onboarding-form")).toContainText("Academic structure");
  await expect(page.locator("#onboarding-form")).toContainText("Study rhythm");
  await page.locator("#onboarding-form input[name='displayName']").fill("E2E Student");
  await page.locator("#onboarding-form input[name='stream']").fill("Science");
  await page.locator("#onboarding-form textarea[name='subjectsText']").fill("Mathematics|2026-07-01|Quadratics, Trigonometry\nPhysics|2026-07-04|Motion graphs");
  await page.locator("#onboarding-form textarea[name='weakTopicsText']").fill("Mathematics: Trigonometry");
  await page.locator("#onboarding-form textarea[name='completedTopicsText']").fill("Mathematics: Quadratics");
  await page.getByRole("button", { name: "Generate roadmap" }).click();
  await expect(page.locator("#onboarding-result")).toContainText("course roadmap generated");
  await expect(page.locator("#view-title")).toHaveText("Today");

  await clickNav(page, "Courses");
  await expect(page.locator("#courses-grid")).toContainText("Workspace preview");
  await expect(page.locator("#courses-grid")).toContainText("Source coverage");
  await expect(page.locator("#courses-grid")).toContainText("Next action");
  await page.locator("#courses-grid").getByRole("button", { name: "Ask about course" }).first().click();
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#ai-message")).toHaveValue(/Course workspace/i);
  await closeAiDrawer(page);

  await clickNav(page, "Memory");
  await expect(page.locator("#view-memory")).toContainText("Your academic memory");
  await expect(page.locator("#view-memory")).toContainText("Search your academic memory");
  await expect(page.locator("#view-memory")).toContainText("Upload private source");
  await page.locator("#source-form input[name='title']").fill("E2E quadratics note");
  await page.locator("#source-file").setInputFiles(path.join(FIXTURE_DIR, "quadratics-note.txt"));
  await page.getByRole("button", { name: "Upload private source" }).click();
  await expect(page.locator("#source-result")).toContainText("E2E quadratics note", { timeout: 15_000 });
  await expect(page.locator("#source-result")).toContainText(/indexed section/i);
  await expect(page.locator("#source-result")).toContainText("Private");
  await expect(page.locator("#source-list")).toContainText("Library status");
  await expect(page.locator("#source-list")).toContainText("uses your materials");
  await expect(page.locator("#source-list")).toContainText("E2E quadratics note");
  await page.locator("#source-search-input").fill("E2E quadratics");
  await expect(page.locator("#source-list")).toContainText("E2E quadratics note");
  await page.locator("#source-search-input").fill("missing-memory-source");
  await expect(page.locator("#source-list")).toContainText("No matching sources");
  await page.locator("#source-search-input").fill("");
  await page.locator("#source-list").getByRole("button", { name: "Explain source" }).first().click();
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#ai-message")).toHaveValue(/Explain this source/i);
  await closeAiDrawer(page);

  await openAiDrawer(page);
  for (const verb of ["Ask", "Plan", "Make", "Review"]) {
    await page.locator(`.verb-tab[data-verb='${verb}']`).click();
    await page.locator("#ai-message").fill(`${verb}: use the uploaded quadratics source in one concise response.`);
    await page.locator("#ai-form").getByRole("button", { name: "Run" }).click();
    await waitForNotLoading(page.locator("#ai-response"), "Checking your materials");
    await expect(page.locator("#ai-response")).toContainText(/uploaded material|Cited snippets|source|fallback/i, { timeout: 20_000 });
  }
  await closeAiDrawer(page);

  await clickNav(page, "Studio");
  await expect(page.locator("#view-studio")).toContainText("Focused academic workflows");
  await page.getByRole("button", { name: "Review workflow" }).click();
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#ai-message")).toHaveValue(/current Studio workflow/i);
  await closeAiDrawer(page);
  await page.getByRole("button", { name: "Check readiness" }).click();
  await waitForNotLoading(page.locator("#flow-result"), "Checking coverage and next learning step");
  await expect(page.locator("#flow-result")).toContainText("Topic coverage");
  await expect(page.locator("#flow-result")).toContainText("Study queue update");
  await expect(page.locator("#flow-result")).toContainText("No submission");

  await clickNav(page, "Today");
  await expect(page.locator("#classroom-panel")).toContainText(/read only|connected|mock/i);
  await page.getByRole("button", { name: "Sync Classroom" }).click();
  await waitForNotLoading(page.locator("#classroom-panel"), "Syncing Classroom in read-only mode");
  await expect(page.locator("#classroom-panel")).toContainText("no write scopes");
  await expect(page.locator("#assignment-list")).toContainText("Google Classroom");
  await expect(page.locator("#assignment-list")).toContainText("Analyze assignment");
  await page.getByRole("button", { name: "Analyze assignment" }).first().click();
  await expect(page.locator("#view-title")).toHaveText("Studio");
  await waitForNotLoading(page.locator("#flow-result"), "Checking coverage and next learning step");
  await expect(page.locator("#flow-result")).toContainText(/Mastery|Practice|Revision|Roadmap|Topic coverage/i);

  await clickNav(page, "Account");
  await expect(page.locator("#account-summary")).toContainText(/Student|local demo/i);
  await expect(page.locator("#view-account")).toContainText("Profile / Identity");
  await expect(page.locator("#view-account")).toContainText("Privacy and consent");
  await expect(page.locator("#view-account")).toContainText("Your data rights");
  await expect(page.locator("#view-account")).toContainText("Access sharing");
  await expect(page.locator("#quota-panel")).toContainText(/sources|AI|storage/i);
  await expect(page.locator("#quota-panel")).toContainText("Limits are visible here, but relaxed for this preview.");
  await expect(page.locator("#pricing-panel")).toContainText(/Free|Pro|Institution/i);
  await expect(page.locator("#pricing")).toContainText("Payments are not active yet");
  await page.evaluate(() => { window.location.hash = "pricing"; });
  await expect(page.locator("#view-title")).toHaveText("Account");
  await expect(page.locator("#pricing")).toBeVisible();
  await page.getByRole("button", { name: "Request data export" }).click();
  await expect(page.locator("#account-action-result")).toContainText("Export request created");
  await expect(page.locator("#account-action-result")).toContainText("Reference");
  await page.getByRole("button", { name: "Request account deletion" }).click();
  await expect(page.locator("#account-action-result")).toContainText("Deletion request recorded");
  await expect(page.locator("#account-action-result")).toContainText("Grace period active");
  await page.locator("#account-lifecycle-status").getByRole("button", { name: "Preview deletion review" }).click();
  await expect(page.locator("#account-action-result")).toContainText("Deletion review preview ready");
  await expect(page.locator("#account-action-result")).toContainText("No data was deleted");
  await page.getByRole("button", { name: "Preview sharing safeguards" }).click();
  await expect(page.locator("#invitation-result")).toContainText(/Access inactive|Safeguards previewed|Consent required/i);
  await page.getByRole("button", { name: "Upgrade" }).click();
  await expect(page.locator("#account-action-result")).toContainText(/Preview|redirect|payment|checkout/i);

  expectingAssignmentFlowFailure = true;
  await page.route("**/api/assignment-flow", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "StudentOS could not analyze this assignment flow. Refresh synced data and try again." }),
  }));
  await clickNav(page, "Studio");
  await page.getByRole("button", { name: "Check readiness" }).click();
  await waitForNotLoading(page.locator("#flow-result"), "Checking coverage and next learning step");
  await expect(page.locator("#flow-result")).toContainText("Assignment flow unavailable");
  await expect(page.locator("#flow-result")).toContainText("try again");
  await page.unroute("**/api/assignment-flow");

  expect(pageErrors).toEqual([]);
});
