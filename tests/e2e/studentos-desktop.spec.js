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
  await page.getByRole("button", { name }).click();
  await expect(page.locator("#view-title")).toHaveText(name);
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
  await expect(page.locator("#auth-session")).toContainText("Local demo");
  await expect(page.locator("#connector-status")).toContainText("Mock mode");
  await expect(page.locator("#dashboard-summary")).toContainText("Goal");

  for (const view of ["Today", "Setup", "Courses", "Memory", "Studio", "Account"]) {
    await clickNav(page, view);
  }

  await clickNav(page, "Setup");
  await page.locator("#onboarding-form input[name='displayName']").fill("E2E Student");
  await page.locator("#onboarding-form input[name='stream']").fill("Science");
  await page.locator("#onboarding-form textarea[name='subjectsText']").fill("Mathematics|2026-07-01|Quadratics, Trigonometry\nPhysics|2026-07-04|Motion graphs");
  await page.locator("#onboarding-form textarea[name='weakTopicsText']").fill("Mathematics: Trigonometry");
  await page.locator("#onboarding-form textarea[name='completedTopicsText']").fill("Mathematics: Quadratics");
  await page.getByRole("button", { name: "Generate roadmap" }).click();
  await expect(page.locator("#onboarding-result")).toContainText("course roadmap generated");
  await expect(page.locator("#view-title")).toHaveText("Today");

  await clickNav(page, "Memory");
  await page.locator("#source-form input[name='title']").fill("E2E quadratics note");
  await page.locator("#source-file").setInputFiles(path.join(FIXTURE_DIR, "quadratics-note.txt"));
  await page.getByRole("button", { name: "Upload private source" }).click();
  await expect(page.locator("#source-result")).toContainText("E2E quadratics note", { timeout: 15_000 });
  await expect(page.locator("#source-result")).toContainText("chunks");
  await expect(page.locator("#source-result")).toContainText("not public");
  await expect(page.locator("#source-list")).toContainText("E2E quadratics note");

  for (const verb of ["Ask", "Plan", "Make", "Review"]) {
    await page.locator(`.verb-tab[data-verb='${verb}']`).click();
    await page.locator("#ai-message").fill(`${verb}: use the uploaded quadratics source in one concise response.`);
    await page.locator("#ai-form").getByRole("button", { name: "Run" }).click();
    await waitForNotLoading(page.locator("#ai-response"), "Thinking with source context");
    await expect(page.locator("#ai-response")).toContainText(/uploaded material|Cited snippets|source|fallback/i, { timeout: 20_000 });
  }

  await clickNav(page, "Studio");
  await page.getByRole("button", { name: "Analyze flow" }).click();
  await waitForNotLoading(page.locator("#flow-result"), "Checking coverage and next learning step");
  await expect(page.locator("#flow-result")).toContainText("Topic coverage");
  await expect(page.locator("#flow-result")).toContainText("Roadmap update");
  await expect(page.locator("#flow-result")).toContainText("no real submission");

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
  await expect(page.locator("#quota-panel")).toContainText(/sources|AI|storage/i);
  await expect(page.locator("#pricing-panel")).toContainText(/Free|Pro|Institution/i);
  await page.getByRole("button", { name: "Request data export" }).click();
  await expect(page.locator("#account-action-result")).toContainText("Export request created");
  await page.getByRole("button", { name: "Upgrade" }).click();
  await expect(page.locator("#account-action-result")).toContainText(/Preview|redirect|provider|checkout/i);

  expectingAssignmentFlowFailure = true;
  await page.route("**/api/assignment-flow", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "StudentOS could not analyze this assignment flow. Refresh synced data and try again." }),
  }));
  await clickNav(page, "Studio");
  await page.getByRole("button", { name: "Analyze flow" }).click();
  await waitForNotLoading(page.locator("#flow-result"), "Checking coverage and next learning step");
  await expect(page.locator("#flow-result")).toContainText("Assignment flow unavailable");
  await expect(page.locator("#flow-result")).toContainText("safe error");
  await page.unroute("**/api/assignment-flow");

  expect(pageErrors).toEqual([]);
});