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

async function expectNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        if (element.closest(".nav-stack, .diagram-box")) return false;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || element.hasAttribute("hidden")) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return false;
        return rect.left < -1 || rect.right > viewportWidth + 1;
      })
      .slice(0, 6)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || "",
          className: String(element.className || "").slice(0, 90),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        };
      });
    return { viewportWidth, documentWidth, offenders };
  });
  expect(metrics.documentWidth, `${label} document width ${metrics.documentWidth} exceeded ${metrics.viewportWidth}`).toBeLessThanOrEqual(metrics.viewportWidth + 12);
  expect(metrics.offenders, `${label} overflow offenders: ${JSON.stringify(metrics.offenders)}`).toEqual([]);
}

async function expectAiDrawerWithinViewport(page, label) {
  await expect.poll(async () => page.locator("#ai-panel").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight;
  }), { message: `${label} drawer should settle inside viewport` }).toBe(true);
  const rect = await page.locator("#ai-panel").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: Math.round(bounds.left),
      right: Math.round(bounds.right),
      top: Math.round(bounds.top),
      bottom: Math.round(bounds.bottom),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(rect.left, `${label} drawer left`).toBeGreaterThanOrEqual(0);
  expect(rect.top, `${label} drawer top`).toBeGreaterThanOrEqual(0);
  expect(rect.right, `${label} drawer right`).toBeLessThanOrEqual(rect.viewportWidth);
  expect(rect.bottom, `${label} drawer bottom`).toBeLessThanOrEqual(rect.viewportHeight);
}

async function expectNoVisibleExternalBranding(page, label) {
  const visibleText = await page.locator("body").innerText();
  const blocked = /\b(Supabase|Groq|Pollinations|Gemini|GPT|gpt-oss|OpenAI|Anthropic|Claude)\b/i;
  expect(visibleText, `${label} should not expose external provider branding`).not.toMatch(blocked);
}

const CLASSROOM_DEVELOPER_COPY = /Classroom import unavailable|Google Classroom import is disabled|no write scopes|no writeback|try again|Read-only Classroom import|Token storage|Scopes:/i;

async function expectNoClassroomDeveloperCopy(page, label) {
  const text = await page.evaluate(() => [
    document.querySelector("#classroom-panel")?.innerText || "",
    document.querySelector("#assignment-list")?.innerText || "",
    document.querySelector("#view-courses")?.innerText || "",
  ].join("\n"));
  expect(text, `${label} should not expose Classroom developer copy`).not.toMatch(CLASSROOM_DEVELOPER_COPY);
}

async function expectClassroomControls(page, { connectLabel = "", sync = false, disconnect = false } = {}) {
  const connectButton = page.locator("#classroom-connect-btn");
  if (connectLabel) {
    await expect(connectButton).toBeVisible();
    await expect(connectButton).toHaveText(connectLabel);
  } else {
    await expect(connectButton).toBeHidden();
  }
  if (sync) {
    await expect(page.locator("#classroom-sync-btn")).toBeVisible();
  } else {
    await expect(page.locator("#classroom-sync-btn")).toBeHidden();
  }
  if (disconnect) {
    await expect(page.locator("#classroom-disconnect-btn")).toBeVisible();
  } else {
    await expect(page.locator("#classroom-disconnect-btn")).toBeHidden();
  }
}

async function routePublicHostToLocal(page, hostname = "studentos.sentiqlabs.com", options = {}) {
  await page.route(`https://${hostname}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/runtime-config.js") {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `window.StudentOSRuntimeConfig = { apiBase: ${JSON.stringify(`https://${hostname}`)} };\n`,
      });
      return;
    }
    if (options.configBody && url.pathname === "/api/config") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(options.configBody),
      });
      return;
    }
    const headers = { ...request.headers() };
    delete headers.host;
    const data = request.postDataBuffer();
    const response = await page.request.fetch(`${baseUrl}${url.pathname}${url.search}`, {
      method: request.method(),
      headers,
      data: data || undefined,
    });
    await route.fulfill({ response });
  });
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

test("initial workspace loading state appears and clears", async ({ page }) => {
  let releaseBootstrap;
  const bootstrapRelease = new Promise((resolve) => {
    releaseBootstrap = resolve;
  });
  await page.setViewportSize({ width: 390, height: 820 });
  await page.route("**/api/bootstrap", async (route) => {
    await bootstrapRelease;
    await route.continue();
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#public-auth-shell")).toBeHidden();
  await expect(page.locator("#app-shell")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#dashboard-summary")).toContainText(/Preparing StudentOS|Loading your workspace/);
  await expect(page.locator("#roadmap-list")).toContainText("Loading your study list");
  await expect(page.locator("#classroom-panel")).toContainText("Checking Classroom status");
  await expectNoHorizontalOverflow(page, "390px loading state");

  releaseBootstrap();
  await expect(page.locator("#dashboard-summary")).toContainText("Do now");
  await expect(page.locator("#dashboard-summary")).not.toContainText(/Preparing StudentOS|Loading your workspace/);
  await expect(page.locator("#app-shell")).not.toHaveAttribute("aria-busy", "true");
  await page.unroute("**/api/bootstrap");
});

test("new signed-in student follows lifecycle gates before Today", async ({ page }) => {
  const [config, bootstrap, account, classroom] = await Promise.all([
    fetch(`${baseUrl}/api/config`).then((response) => response.json()),
    fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json()),
    fetch(`${baseUrl}/api/account`).then((response) => response.json()),
    fetch(`${baseUrl}/api/classroom/status`).then((response) => response.json()),
  ]);
  const lifecycle = {
    version: 1,
    state: "signed_up",
    selectedPlanId: null,
    accessMode: null,
    paymentMethodVerifiedAt: null,
    legalConsentCompleteAt: null,
    onboarding: { currentStep: "about_you", completedSteps: [], answers: {}, stepCount: 5, completedStepCount: 0, progressPercent: 0 },
    classroomChoice: null,
    classroomConnectedAt: null,
    manualSetupSelectedAt: null,
    selectedMaterialIds: [],
    selectedMaterialLabels: [],
    materialsSelectedAt: null,
    setupSummaryReadyAt: null,
    workspacePreparationStartedAt: null,
    workspaceReadyAt: null,
    tutorialOfferedAt: null,
    tutorialChoice: null,
    dashboardActivatedAt: null,
    nextStep: "pricing",
    paymentMethodVerified: false,
    legalConsentComplete: false,
    workspaceReady: false,
    dashboardActive: false,
    realPaymentCompleted: false,
  };
  const newUserState = {
    ...bootstrap,
    studentProfile: { ...bootstrap.studentProfile, displayName: "New Student" },
    courses: [],
    assignments: [],
    sourceMaterials: [],
    roadmap: [],
    timetable: [],
    productLifecycle: lifecycle,
  };
  const onboardingSteps = ["about_you", "education_system", "daily_schedule", "exam_pattern", "academic_context"];

  await page.addInitScript(() => {
    sessionStorage.setItem("studentos.auth.session", JSON.stringify({
      access_token: "pass35-browser-session",
      user: { email: "new@student.example" },
    }));
  });
  await page.route("**/api/config", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...config,
      auth: { enabled: true, url: "https://example.supabase.co", anonKey: "public-test-key" },
      productFlow: {
        ...config.productFlow,
        paymentPlaceholderEnabled: true,
        workspacePreparationSimulationEnabled: true,
        realPaymentEnabled: false,
      },
    }),
  }));
  await page.route("**/api/bootstrap", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(newUserState) }));
  await page.route("**/api/account", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(account) }));
  await page.route("**/api/classroom/status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(classroom) }));
  await page.route("**/api/product-flow", async (route) => {
    const request = route.request().postDataJSON();
    const payload = request.payload || {};
    const timestamp = "2026-06-27T10:00:00.000Z";
    if (request.action === "select_plan") {
      lifecycle.selectedPlanId = payload.planId;
      lifecycle.state = "plan_selected";
      lifecycle.nextStep = "trial_choice";
    } else if (request.action === "reset_plan") {
      lifecycle.selectedPlanId = null;
      lifecycle.state = "signed_up";
      lifecycle.nextStep = "pricing";
    } else if (request.action === "choose_access") {
      lifecycle.accessMode = payload.accessMode;
      lifecycle.state = payload.accessMode === "trial" ? "trial_selected" : "paid_plan_selected";
      lifecycle.nextStep = "payment_method";
    } else if (request.action === "verify_payment_method_placeholder") {
      lifecycle.paymentMethodVerifiedAt = timestamp;
      lifecycle.paymentMethodVerified = true;
      lifecycle.state = "payment_method_verified";
      lifecycle.nextStep = "legal_consent";
    } else if (request.action === "complete_legal") {
      lifecycle.legalConsentCompleteAt = timestamp;
      lifecycle.legalConsentComplete = true;
      lifecycle.state = "legal_consent_complete";
      lifecycle.nextStep = "about_you";
    } else if (request.action === "save_onboarding_step") {
      lifecycle.onboarding.answers[payload.step] = payload.answers || {};
      if (!lifecycle.onboarding.completedSteps.includes(payload.step)) lifecycle.onboarding.completedSteps.push(payload.step);
      if (payload.step === "about_you") newUserState.studentProfile.displayName = payload.answers.displayName;
      const next = onboardingSteps.find((step) => !lifecycle.onboarding.completedSteps.includes(step));
      lifecycle.onboarding.currentStep = next || "complete";
      lifecycle.onboarding.completedStepCount = lifecycle.onboarding.completedSteps.length;
      lifecycle.onboarding.progressPercent = Math.round((lifecycle.onboarding.completedSteps.length / onboardingSteps.length) * 100);
      lifecycle.state = next ? "onboarding_progress_saved" : "classroom_choice_pending";
      lifecycle.nextStep = next || "classroom_setup";
    } else if (request.action === "choose_classroom_path") {
      lifecycle.classroomChoice = payload.choice;
      lifecycle.state = payload.choice === "manual" ? "manual_setup_selected" : "classroom_choice_pending";
      if (payload.choice === "manual") lifecycle.manualSetupSelectedAt = timestamp;
      lifecycle.nextStep = payload.choice === "manual" ? "materials" : "classroom_setup";
    } else if (request.action === "save_materials") {
      lifecycle.selectedMaterialIds = payload.materialIds || [];
      lifecycle.selectedMaterialLabels = payload.materialLabels || [];
      lifecycle.materialsSelectedAt = timestamp;
      lifecycle.state = "materials_selected";
      lifecycle.nextStep = "setup_summary";
    } else if (request.action === "confirm_setup_summary") {
      lifecycle.setupSummaryReadyAt = timestamp;
      lifecycle.state = "setup_summary_ready";
      lifecycle.nextStep = "workspace_preparation";
    } else if (request.action === "start_workspace_preparation") {
      lifecycle.workspacePreparationStartedAt = timestamp;
      lifecycle.state = "workspace_preparing";
      lifecycle.nextStep = "workspace_preparation";
    } else if (request.action === "complete_workspace_preparation") {
      lifecycle.workspaceReadyAt = timestamp;
      lifecycle.workspaceReady = true;
      lifecycle.tutorialOfferedAt = timestamp;
      lifecycle.state = "tutorial_offered";
      lifecycle.nextStep = "tutorial";
    } else if (request.action === "choose_tutorial") {
      lifecycle.tutorialChoice = payload.choice;
      if (payload.choice === "skip") {
        lifecycle.dashboardActivatedAt = timestamp;
        lifecycle.dashboardActive = true;
        lifecycle.state = "dashboard_active";
        lifecycle.nextStep = "dashboard";
      }
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        lifecycle,
        state: newUserState,
        payment: { realPaymentCompleted: false, chargeCreated: false, mandateCreated: false },
        secretsPrinted: false,
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto(baseUrl);
  await expect(page.locator("#product-flow-shell")).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();
  for (const price of ["₹99", "₹159", "₹259", "₹549"]) await expect(page.locator("#product-flow-content")).toContainText(price);
  await expectNoHorizontalOverflow(page, "390px lifecycle pricing");
  await expect(page.locator("#product-flow-content")).not.toContainText(/storage|tokens|model|provider|Supabase|Groq|Gemini/i);
  await expect(page.getByRole("button", { name: "Ask StudentOS" })).toHaveCount(1);
  await page.getByRole("button", { name: "Ask StudentOS" }).click();
  await expect(page.locator("#product-flow-ask-response")).toContainText("Finish the current setup step");

  await page.getByRole("button", { name: "Choose Plus" }).click();
  await expect(page.locator("#product-flow-content")).toContainText("Trial features are not the same as Plus");
  await page.getByRole("button", { name: "Start with Trial Mode" }).click();
  await expect(page.locator("#product-flow-content")).toContainText("does not claim that a payment has been completed");
  await expect(page.locator("#product-flow-content")).toContainText("No charge is created here");
  await page.getByRole("button", { name: "Continue in development mode" }).click();

  await expect(page.getByRole("heading", { name: "Review before we build your workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Agree and continue" }).click();
  await expect(page.getByRole("heading", { name: "Review before we build your workspace" })).toBeVisible();
  for (const checkbox of await page.locator("#product-legal-form .legal-check-list input[type='checkbox']").all()) await checkbox.check();
  await page.locator("#product-legal-form input[name='ageGate'][value='adult']").check();
  await page.getByRole("button", { name: "Agree and continue" }).click();

  await expect(page.getByRole("heading", { name: "About You" })).toBeVisible();
  await page.locator("#product-onboarding-form input[name='displayName']").fill("Lifecycle Student");
  await page.getByRole("button", { name: "Save and continue" }).click();
  for (const heading of ["Education System", "Daily Schedule", "Exam and Assessment Pattern", "Syllabus and Academic Context"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();
  }

  await expect(page.getByRole("heading", { name: "How should StudentOS find your coursework?" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Google Classroom" }).click();
  await expect(page.getByRole("heading", { name: "Connect Google Classroom" })).toBeVisible();
  await page.getByRole("button", { name: "My institution does not use Classroom" }).click();
  await expect(page.getByRole("heading", { name: "Choose what belongs in your first workspace" })).toBeVisible();
  await expect(page.locator("#product-flow-content")).toContainText("You can add or remove materials later from Academic Context");
  await page.locator("#product-materials-form textarea[name='materialLabels']").fill("Calculus syllabus");
  await page.getByRole("button", { name: "Continue to setup summary" }).click();

  await expect(page.getByRole("heading", { name: "Does this look right?" })).toBeVisible();
  await expect(page.locator("#product-flow-content")).toContainText("Lifecycle Student");
  await expect(page.getByRole("button", { name: "Yes, prepare my workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit summary" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add more details" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with what I have" }).click();
  await page.getByRole("button", { name: "Prepare workspace" }).click();
  await expect(page.locator("#product-flow-content")).toContainText(/building your Today view/i);
  await page.getByRole("button", { name: "Continue when ready" }).click();

  await expect(page.getByRole("heading", { name: "Would you like a quick tour before entering Today?" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.locator("#product-flow-shell")).toBeHidden();
  await expect(page.locator("#app-shell")).toBeVisible();
  await expect(page.locator("#view-title")).toHaveText("Today");
  await expect(page.locator(".verb-tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask StudentOS" })).toHaveCount(1);
});

test("Classroom status UI normalizes controls and copy", async ({ page }) => {
  function connectorFor(state, overrides = {}) {
    const connected = state === "connected";
    const actions = {
      connect: state === "disconnected",
      reconnect: state === "reconnect_required",
      sync: connected,
      disconnect: connected,
    };
    const copy = {
      disabled: {
        title: "Classroom setup is not active",
        message: "Your workspace is ready. Classroom importing can be turned on later.",
        badge: "workspace ready",
      },
      setup_required: {
        title: "Classroom setup is not active",
        message: "Your workspace is ready. Classroom importing can be turned on later.",
        badge: "workspace ready",
      },
      disconnected: {
        title: "Classroom can be connected",
        message: "Connect when you want StudentOS to include Classroom coursework in your study plan.",
        badge: "optional setup",
      },
      connected: {
        title: "Classroom connected",
        message: "StudentOS can refresh coursework for your study plan. You stay in control of submissions.",
        badge: "planning import active",
      },
      reconnect_required: {
        title: "Reconnect Classroom",
        message: "Reconnect Classroom to refresh imported assignments.",
        badge: "reconnect needed",
      },
    }[state];
    return {
      provider: "google_classroom",
      mode: state === "disabled" ? "disabled" : "oauth",
      state,
      status: state,
      connected,
      available: !["disabled", "setup_required"].includes(state),
      enabled: !["disabled", "setup_required"].includes(state),
      setupRequired: state === "setup_required",
      reconnectRequired: state === "reconnect_required",
      readOnlyImport: true,
      writeScopesEnabled: false,
      postingEnabled: false,
      submissionEnabled: false,
      actions,
      ui: copy,
      syncHistory: [],
      ...overrides,
    };
  }

  let connector = connectorFor("disabled");
  await page.route("**/api/classroom/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      connector,
      readOnly: true,
      writebackEnabled: false,
      secretsPrinted: false,
    }),
  }));

  await page.goto(baseUrl);
  await expect(page.locator("#classroom-panel")).toContainText("Classroom setup is not active");
  await expectClassroomControls(page, {});
  await expectNoClassroomDeveloperCopy(page, "disabled Classroom state");

  connector = connectorFor("setup_required");
  await page.goto(baseUrl);
  await expect(page.locator("#classroom-panel")).toContainText("Classroom setup is not active");
  await expectClassroomControls(page, {});
  await expectNoClassroomDeveloperCopy(page, "setup-required Classroom state");

  connector = connectorFor("disconnected");
  await page.goto(baseUrl);
  await expect(page.locator("#classroom-panel")).toContainText("Classroom can be connected");
  await expectClassroomControls(page, { connectLabel: "Connect Classroom" });
  await expectNoClassroomDeveloperCopy(page, "disconnected Classroom state");

  connector = connectorFor("connected", {
    lastSyncAt: "2026-06-25T06:00:00.000Z",
    syncSummary: {
      importedCourses: 1,
      importedAssignments: 2,
      updatedAssignments: 1,
      emptyClassroom: false,
    },
  });
  await page.goto(baseUrl);
  await expect(page.locator("#classroom-panel")).toContainText("Classroom connected");
  await expectClassroomControls(page, { sync: true, disconnect: true });
  await expectNoClassroomDeveloperCopy(page, "connected Classroom state");

  connector = connectorFor("reconnect_required");
  await page.goto(baseUrl);
  await expect(page.locator("#classroom-panel")).toContainText("Reconnect Classroom");
  await expectClassroomControls(page, { connectLabel: "Reconnect Classroom" });
  await expectNoClassroomDeveloperCopy(page, "reconnect-required Classroom state");
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
  await expectNoVisibleExternalBranding(page, "initial local workspace");
  await page.getByRole("button", { name: "Plan today" }).click();
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#ai-message")).toHaveValue(/Plan today from my tasks/i);
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
  await expect(page.locator("#courses-grid")).toContainText("Materials");
  await expect(page.locator("#courses-grid")).toContainText("Next action");
  await page.locator("#courses-grid").getByRole("button", { name: "Ask about course" }).first().click();
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#ai-message")).toHaveValue(/Course workspace/i);
  await closeAiDrawer(page);

  await clickNav(page, "Memory");
  await expect(page.locator("#view-memory")).toContainText("Your academic memory");
  await expect(page.locator("#view-memory")).toContainText("Search your academic memory");
  await expect(page.locator("#view-memory")).toContainText("Upload private source");
  await page.route("**/api/sources/upload", async (route) => {
    await delay(300);
    await route.continue();
  });
  await page.locator("#source-form input[name='title']").fill("E2E quadratics note");
  await page.locator("#source-file").setInputFiles(path.join(FIXTURE_DIR, "quadratics-note.txt"));
  await page.getByRole("button", { name: "Upload private source" }).click();
  await expect(page.locator("#source-result")).toContainText("Uploading to private source library");
  await expect(page.locator("#source-result")).toContainText("E2E quadratics note", { timeout: 15_000 });
  await expect(page.locator("#source-result")).toContainText(/source section/i);
  await expect(page.locator("#source-result")).toContainText("Private");
  await page.unroute("**/api/sources/upload");
  await expect(page.locator("#source-list")).toContainText("Sources ready");
  await expect(page.locator("#source-list")).toContainText(/Uses your materials/i);
  await expect(page.locator("#source-list")).toContainText("E2E quadratics note");
  await expectNoVisibleExternalBranding(page, "source library");
  await page.locator("#source-search-input").fill("E2E quadratics");
  await expect(page.locator("#source-list")).toContainText("E2E quadratics note");
  await page.locator("#source-search-input").fill("missing-memory-source");
  await expect(page.locator("#source-list")).toContainText("No matching sources");
  await page.locator("#source-search-input").fill("");
  await page.locator("#source-list").getByRole("button", { name: "Explain source" }).first().click();
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#ai-message")).toHaveValue(/Explain this source/i);
  await closeAiDrawer(page);

  await page.route("**/api/ai/verb", async (route) => {
    await delay(250);
    await route.continue();
  });
  await openAiDrawer(page);
  await expect(page.locator(".verb-tab")).toHaveCount(0);
  await page.locator("#ai-message").fill("Use the uploaded quadratics material in one concise response.");
  await page.locator("#ai-form").getByRole("button", { name: "Ask" }).click();
  await expect(page.locator("#ai-response")).toContainText("Checking your materials");
  await waitForNotLoading(page.locator("#ai-response"), "Checking your materials");
  await expect(page.locator("#ai-response")).toContainText(/uploaded material|Cited snippets|source|reference/i, { timeout: 20_000 });
  await page.unroute("**/api/ai/verb");
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
  await expect(page.locator("#classroom-panel")).toContainText(/planning import active|connected|demo/i);
  await expectClassroomControls(page, { sync: true, disconnect: true });
  await page.getByRole("button", { name: "Sync Classroom" }).click();
  await waitForNotLoading(page.locator("#classroom-panel"), "Syncing Classroom assignments");
  await expect(page.locator("#classroom-panel")).toContainText("planning import active");
  await expectNoClassroomDeveloperCopy(page, "mock Classroom sync");
  await expect(page.locator("#assignment-list")).toContainText("Google Classroom");
  await expect(page.locator("#assignment-list")).toContainText("Analyze assignment");
  await page.getByRole("button", { name: "Analyze assignment" }).first().click();
  await expect(page.locator("#view-title")).toHaveText("Studio");
  await waitForNotLoading(page.locator("#flow-result"), "Checking coverage and next learning step");
  await expect(page.locator("#flow-result")).toContainText(/Mastery|Practice|Revision|Roadmap|Topic coverage/i);

  await clickNav(page, "Account");
  await expect(page.locator("#account-summary")).toContainText(/Student|local preview/i);
  await expect(page.locator("#view-account")).toContainText("Profile / Identity");
  await expect(page.locator("#view-account")).toContainText("Privacy and consent");
  await expect(page.locator("#view-account")).toContainText("Your data rights");
  await expect(page.locator("#view-account")).toContainText("Access sharing");
  await expect(page.locator("#quota-panel")).toContainText(/academic context|semester/i);
  await expect(page.locator("#quota-panel")).not.toContainText(/MB|GB|storage|tokens/i);
  await expect(page.locator("#pricing-panel")).toContainText(/Starter|Essential|Plus|Pro/i);
  await expect(page.locator("#pricing-panel")).toContainText(/₹99|₹159|₹259|₹549/);
  await expect(page.locator("#pricing-panel")).not.toContainText(/storage|tokens|model|provider/i);
  await expectNoVisibleExternalBranding(page, "account and pricing");
  await page.evaluate(() => { window.location.hash = "pricing"; });
  await expect(page.locator("#view-title")).toHaveText("Account");
  await expect(page.locator("#pricing")).toBeVisible();
  await page.route("**/api/account/export-request", async (route) => {
    await delay(300);
    await route.continue();
  });
  await page.getByRole("button", { name: "Request data export" }).click();
  await expect(page.locator("#account-action-result")).toContainText("Preparing your data export request");
  await expect(page.locator("#account-action-result")).toContainText("Export request created");
  await expect(page.locator("#account-action-result")).toContainText("Reference");
  await page.unroute("**/api/account/export-request");
  await page.route("**/api/account/deletion-request", async (route) => {
    await delay(300);
    await route.continue();
  });
  await page.getByRole("button", { name: "Request account deletion" }).click();
  await expect(page.locator("#account-action-result")).toContainText("Preparing account deletion request");
  await expect(page.locator("#account-action-result")).toContainText("Deletion request recorded");
  await expect(page.locator("#account-action-result")).toContainText("Grace period active");
  await page.unroute("**/api/account/deletion-request");
  await page.route("**/api/account/deletion-requests/*/dry-run", async (route) => {
    await delay(300);
    await route.continue();
  });
  await page.locator("#account-lifecycle-status").getByRole("button", { name: "Preview deletion safety" }).click();
  await expect(page.locator("#account-action-result")).toContainText("Preparing a deletion safety preview");
  await expect(page.locator("#account-action-result")).toContainText("Deletion safety preview ready");
  await expect(page.locator("#account-action-result")).toContainText("No data has been deleted yet");
  await page.unroute("**/api/account/deletion-requests/*/dry-run");
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

test("responsive surfaces and AI drawer avoid horizontal overflow", async ({ page }) => {
  test.setTimeout(75_000);
  const widths = [1440, 1280, 1024, 768, 430, 390, 360];
  const views = ["Today", "Setup", "Courses", "Memory", "Studio", "Account"];

  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 430 ? 820 : 900 });
    await page.goto(baseUrl);
    await expect(page.locator("#public-auth-shell")).toBeHidden();

    for (const view of views) {
      await clickNav(page, view);
      await expectNoHorizontalOverflow(page, `${width}px ${view}`);
      await openAiDrawer(page);
      await expectAiDrawerWithinViewport(page, `${width}px ${view}`);
      await closeAiDrawer(page);
    }

    await page.evaluate(() => { window.location.hash = "pricing"; });
    await expect(page.locator("#view-title")).toHaveText("Account");
    await expect(page.locator("#pricing")).toBeVisible();
    await expectNoHorizontalOverflow(page, `${width}px pricing`);
  }
});

test("public auth shell gates the app when auth is enabled", async ({ page }) => {
  const [config, bootstrap, account, classroom] = await Promise.all([
    fetch(`${baseUrl}/api/config`).then((response) => response.json()),
    fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json()),
    fetch(`${baseUrl}/api/account`).then((response) => response.json()),
    fetch(`${baseUrl}/api/classroom/status`).then((response) => response.json()),
  ]);
  await page.route("**/api/config", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...config,
      auth: {
        enabled: true,
        url: "https://example.supabase.co",
        anonKey: "public-anon-test-key",
      },
    }),
  }));
  await page.route("**/api/bootstrap", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(bootstrap),
  }));
  await page.route("**/api/account", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(account),
  }));
  await page.route("**/api/classroom/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(classroom),
  }));

  await page.goto(`${baseUrl}/#signup`);
  await expect(page.locator("#public-auth-shell")).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();
  await expect(page.locator("#auth-shell-title")).toHaveText("Create your StudentOS account");
  await expect(page.locator("#password-reset-btn")).toBeVisible();

  await page.getByRole("button", { name: "Existing account" }).click();
  await expect(page.locator("#auth-shell-title")).toHaveText("Sign in to StudentOS");
  await page.locator("#auth-email").fill("qa@studentos.local");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.locator("#auth-message")).toContainText("If an account exists for this email, a reset link has been sent. Please check your inbox.");
  await expect(page.locator("#auth-message")).not.toContainText("Supabase Auth Project");
  await expect(page.locator("#auth-message")).not.toContainText("reset email requested");
  await expect(page.locator("#auth-message")).not.toContainText("protected request");
  await expectNoVisibleExternalBranding(page, "public auth reset");
  await page.getByRole("button", { name: "New account" }).click();
  await expect(page.locator("#auth-shell-title")).toHaveText("Create your StudentOS account");

  await page.evaluate(() => {
    sessionStorage.setItem("studentos.auth.session", JSON.stringify({
      access_token: "local-test-token",
      user: { email: "qa@studentos.local" },
    }));
  });
  await page.goto(baseUrl);
  await expect(page.locator("#public-auth-shell")).toBeHidden();
  await expect(page.locator("#app-shell")).toBeVisible();
});

test("production host does not fall back to demo when auth config is unavailable", async ({ page }) => {
  await routePublicHostToLocal(page);

  await page.goto("https://studentos.sentiqlabs.com/#pricing", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#public-auth-shell")).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();
  await expect(page.locator("#auth-shell-title")).toHaveText("StudentOS sign-in is not available yet");
  await expect(page.locator("#auth-session")).toContainText("Configuration required");
  await expect(page.locator("#auth-help")).toContainText("StudentOS deployment");
  await expect(page.locator("#auth-form")).toBeHidden();
  await expect(page.locator("[data-auth-mode='signin']")).toBeDisabled();
  await expect(page.locator("#public-auth-shell")).not.toContainText("Local demo");
  await expect(page.locator("#public-auth-shell")).not.toContainText("demo@studentos.local");
  await expect(page.locator("#pricing")).not.toBeVisible();
  await expectNoVisibleExternalBranding(page, "production auth unavailable");
});

test("production host stays on public auth shell when auth is enabled and signed out", async ({ page }) => {
  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
  await routePublicHostToLocal(page, "studentos.sentiqlabs.com", {
    configBody: {
      ...config,
      auth: {
        enabled: true,
        url: "https://example.supabase.co",
        anonKey: "public-anon-test-key",
      },
    },
  });

  await page.goto("https://studentos.sentiqlabs.com/#signup", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#public-auth-shell")).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();
  await expect(page.locator("#auth-shell-title")).toHaveText("Create your StudentOS account");
  await expect(page.locator("#auth-form")).toBeVisible();
  await expect(page.locator("[data-auth-mode='signin']")).not.toBeDisabled();
  await expect(page.locator("#public-auth-shell")).not.toContainText("Local demo");
  await expectNoVisibleExternalBranding(page, "production auth shell");
});

test("auth completion route loads styled recovery UI and scrubs token fragments", async ({ page }) => {
  await routePublicHostToLocal(page);
  const recoveryToken = ["fake", "recovery", "token"].join("-");
  const fragment = new URLSearchParams({
    type: "recovery",
    access_token: recoveryToken,
  }).toString();

  await page.goto(`https://studentos.sentiqlabs.com/auth/complete#${fragment}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveClass(/auth-complete-page/);
  await expect(page.locator("#recovery-complete-form")).toBeVisible();
  await expect(page.locator("#completion-copy")).toContainText("Choose a new password");
  await expect(page.locator("#app-shell")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Demo session");
  expect(page.url()).not.toContain("access_token");
  expect(page.url()).not.toContain(recoveryToken);
  await expect.poll(async () => page.evaluate(() => [...document.styleSheets].some((sheet) => sheet.href?.includes("/styles/main.css")))).toBe(true);
});
