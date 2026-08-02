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
  throw new Error("StudentOS auth redesign E2E server did not become healthy.");
}

async function fulfillPublicAuthConfig(route) {
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

test.beforeEach(async ({ page }) => {
  await page.route("**/api/config", fulfillPublicAuthConfig);
});

test("presents the new brand-led sign-in and sign-up states", async ({ page }) => {
  const requestedUrls = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  const logoResponsePromise = page.waitForResponse((response) => response.url() === `${baseUrl}/assets/studentos-logo.png`);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const logoResponse = await logoResponsePromise;

  const shell = page.locator("#public-auth-shell");
  await expect(shell).toBeVisible({ timeout: 5000 });
  await expect(shell).toHaveAttribute("data-auth-redesign-ready", "true");
  await expect(page.getByRole("heading", { name: "Know what to study next." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  const logo = page.locator(".auth-logo-image");
  await expect(logo).toHaveAttribute("src", "/assets/studentos-logo.png");
  await expect(logo.locator("xpath=..")).toHaveClass(/has-image/);
  expect(logoResponse.ok()).toBe(true);
  expect(new URL(logoResponse.url()).origin).toBe(new URL(baseUrl).origin);
  expect(requestedUrls.some((url) => new URL(url).hostname === "i.ibb.co")).toBe(false);

  const signInTab = page.getByRole("tab", { name: "Sign in" });
  const signUpTab = page.getByRole("tab", { name: "Create account" });
  await expect(signInTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#signin-btn")).toHaveText("Sign in");
  await expect(page.getByText("Ready to sign in", { exact: true })).toBeHidden();

  await signUpTab.click();
  await expect(page).toHaveURL(/#signup$/);
  await expect(signUpTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Create your StudentOS account" })).toBeVisible();
  await expect(page.locator("#signin-btn")).toHaveText("Create account");
  await expect(page.locator("#auth-password")).toHaveAttribute("autocomplete", "new-password");

  await signInTab.click();
  await expect(page).toHaveURL(/#login$/);
  await expect(page.locator("#auth-password")).toHaveAttribute("autocomplete", "current-password");
});

test("keeps the local logo fallback safe when the asset is unavailable", async ({ page }) => {
  await page.route(`${baseUrl}/assets/studentos-logo.png`, (route) => route.fulfill({
    status: 404,
    contentType: "text/plain",
    body: "Not found",
  }));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const logoFrame = page.locator(".auth-logo-frame");
  await expect(logoFrame).toHaveClass(/image-failed/);
  await expect(logoFrame).not.toHaveClass(/has-image/);
  await expect(page.locator(".auth-logo-fallback")).toBeVisible();
});

test("supports password reveal, inline validation, and mobile restraint", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const shell = page.locator("#public-auth-shell");
  await expect(shell).toBeVisible({ timeout: 5000 });
  await expect(shell).toHaveAttribute("data-auth-redesign-ready", "true");

  const password = page.locator("#auth-password");
  const toggle = page.locator(".auth-password-toggle");
  await expect(toggle).toHaveAttribute("aria-label", "Show password");
  await expect(password).toHaveAttribute("type", "password");
  await toggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(toggle).toHaveAttribute("aria-label", "Hide password");

  await page.locator("#signin-btn").click();
  await expect(page.locator("#auth-email-error")).toHaveText("Enter your email address.");
  await expect(page.locator("#auth-password-error")).toHaveText("Enter your password.");
  await expect(page.locator("#auth-email")).toHaveAttribute("aria-invalid", "true");

  await expect(page.locator(".auth-capability-list")).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
