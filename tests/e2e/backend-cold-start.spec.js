import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

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
  throw new Error("StudentOS cold-start E2E server did not become healthy.");
}

async function fulfillPublicAuthConfig(route, waitMs = 0) {
  if (waitMs) await delay(waitMs);
  const response = await route.fetch();
  const config = await response.json();
  config.auth = {
    enabled: true,
    url: "https://studentos-auth.invalid",
    anonKey: "e2e-public-anon-key",
    signupRedirectPath: "/auth/callback",
  };
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(config),
  });
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
      STUDENTOS_RATE_LIMIT_ENABLED: "false",
      STUDENTOS_QUOTA_ENFORCEMENT: "false",
      STUDENTOS_TIER_OPERATIONAL: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth(baseUrl, serverProcess);
});

test.afterAll(async () => {
  if (!serverProcess) return;
  serverProcess.kill("SIGTERM");
  await Promise.race([
    once(serverProcess, "exit"),
    delay(1500).then(() => serverProcess.kill("SIGKILL")),
  ]).catch(() => {});
});

test("shows the calm boot screen while the backend is waking, then reveals sign-in", async ({ page }) => {
  await page.route("**/api/config", (route) => fulfillPublicAuthConfig(route, 1250));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const bootScreen = page.locator("#studentos-backend-boot");
  await expect(bootScreen).toBeVisible({ timeout: 1100 });
  await expect(bootScreen.locator(".studentos-backend-boot-copy")).toHaveText("Just a moment...");
  await expect(bootScreen.locator(".studentos-backend-boot-dots span")).toHaveCount(8);
  await expect(page.locator("#public-auth-shell")).toBeHidden();

  await expect(page.locator("#public-auth-shell")).toBeVisible({ timeout: 6000 });
  await expect(page.getByRole("heading", { name: "Sign in to StudentOS" })).toBeVisible();
  await expect(bootScreen).toHaveCount(0, { timeout: 3000 });
});

test("does not show the boot screen when the backend responds promptly", async ({ page }) => {
  await page.route("**/api/config", (route) => fulfillPublicAuthConfig(route));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#public-auth-shell")).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole("heading", { name: "Sign in to StudentOS" })).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.locator("#studentos-backend-boot")).toHaveCount(0);
});
