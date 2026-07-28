import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPdfFixtureBuffer } from "./fixtures/pdfFixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

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
  await page.locator("#ai-launcher").click();
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

async function expectNoLifecycleTechnicalCopy(page, label) {
  const visibleText = await page.locator("#product-flow-shell").innerText();
  const blocked = /\b(Supabase|Groq|Pollinations|Gemini|provider|model|token|vector|embedding|chunks?|backend|storage|mock (?:mode|response|provider|data)|demo response|OAuth|connector|source-grounded|web fallback|no write scopes?|no writeback)\b/i;
  expect(visibleText, `${label} should use student-facing product copy`).not.toMatch(blocked);
}

async function expectReadableContrast(page, selector, label, { pseudo = "", minimum = 4.5 } = {}) {
  const result = await page.locator(selector).first().evaluate((element, options) => {
    function rgba(value) {
      const parts = String(value).match(/[\d.]+/g)?.map(Number) || [];
      return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts.length > 3 ? parts[3] : 1 };
    }
    function channel(value) {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }
    function luminance(color) {
      return (0.2126 * channel(color.r)) + (0.7152 * channel(color.g)) + (0.0722 * channel(color.b));
    }
    const foregroundValue = getComputedStyle(element, options.pseudo || null).color;
    let backgroundValue = "rgb(255, 255, 255)";
    for (let node = element; node; node = node.parentElement) {
      const candidate = getComputedStyle(node).backgroundColor;
      if (rgba(candidate).a > 0.01) {
        backgroundValue = candidate;
        break;
      }
    }
    const foreground = rgba(foregroundValue);
    const background = rgba(backgroundValue);
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return { ratio: (light + 0.05) / (dark + 0.05), foregroundValue, backgroundValue };
  }, { pseudo });
  expect(result.ratio, `${label}: ${JSON.stringify(result)}`).toBeGreaterThanOrEqual(minimum);
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
let localWorkspaceReady = false;

async function prepareLocalWorkspace() {
  if (localWorkspaceReady) return;
  const post = async (action, payload = {}) => {
    const response = await fetch(`${baseUrl}/api/product-flow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    if (!response.ok) throw new Error(`E2E setup action ${action} failed: ${await response.text()}`);
  };
  await post("save_onboarding_step", { step: "about_you", answers: { displayName: "E2E Student" } });
  await post("save_onboarding_step", { step: "education_system", answers: { level: "Undergraduate", stream: "Engineering", yearSemester: "Semester 2" } });
  await post("select_plan", { planId: "plus" });
  await post("choose_access", { accessMode: "trial" });
  await post("verify_payment_method_placeholder");
  await post("complete_legal", {
    ageGate: "adult",
    consents: Object.fromEntries([
      "termsOfService", "privacyPolicy", "trialBilling", "trialLimits", "paymentMandate",
      "cancellationWindow", "academicDataUse", "noOutcomeGuarantee", "responsibleUse", "aiAccuracy",
    ].map((key) => [key, true])),
  });
  await post("save_onboarding_step", { step: "daily_schedule", answers: { schedule: "Weekdays after 6 PM" } });
  await post("save_onboarding_step", { step: "exam_pattern", answers: { examPattern: "Monthly assessments and one semester exam" } });
  await post("save_onboarding_step", { step: "academic_context", answers: { subjects: "Physics|2026-07-04|Motion graphs", syllabusNotes: "Mechanics and motion graphs" } });
  await post("choose_classroom_path", { choice: "manual" });
  await post("save_materials", { materialIds: [], materialLabels: [] });
  await post("confirm_setup_summary");
  await post("prepare_workspace");
  await post("choose_tutorial", { choice: "skip" });
  localWorkspaceReady = true;
}

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
  await page.addInitScript(() => {
    localStorage.setItem("studentos.profile", JSON.stringify({ displayName: "Aarav", stream: "Science", classLevel: "Grade 10" }));
    localStorage.setItem("studentos.sample.workspace", JSON.stringify({ title: "Quadratics worksheet" }));
  });
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
  await expect(page.locator("#product-flow-shell")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What is your name?" })).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();
  await expect(page.locator("body")).not.toContainText(/Aarav|Grade 10|Quadratics worksheet|Load sample profile|Plan Free/);
  expect(await page.evaluate(() => localStorage.getItem("studentos.profile"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("studentos.sample.workspace"))).toBeNull();
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
    legalConsentDraft: {},
    onboarding: { currentStep: "about_you", completedSteps: [], answers: {}, stepCount: 5, completedStepCount: 0, progressPercent: 0 },
    classroomChoice: null,
    classroomConnectedAt: null,
    manualSetupSelectedAt: null,
    selectedMaterialIds: [],
    selectedMaterialLabels: [],
    materialsDraft: { materialIds: [], materialLabels: [] },
    materialsSelectedAt: null,
    setupSummaryReadyAt: null,
    workspacePreparationStartedAt: null,
    workspaceReadyAt: null,
    tutorialOfferedAt: null,
    tutorialChoice: null,
    dashboardActivatedAt: null,
    navigationStep: null,
    navigationHistory: [],
    nextStep: "about_you",
    derivedNextStep: "about_you",
    canGoPrevious: false,
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
    classroomItems: [],
    roadmap: [],
    timetable: [],
    productLifecycle: lifecycle,
  };
  const onboardingSteps = ["about_you", "education_system", "daily_schedule", "exam_pattern", "academic_context"];
  const flowSteps = [
    "about_you", "education_system", "pricing", "trial_choice", "payment_method", "legal_consent",
    "daily_schedule", "exam_pattern", "academic_context", "classroom_setup", "materials", "setup_summary",
    "workspace_preparation", "tutorial",
  ];

  function derivedStep() {
    if (lifecycle.dashboardActivatedAt) return "dashboard";
    if (!lifecycle.onboarding.completedSteps.includes("about_you")) return "about_you";
    if (!lifecycle.onboarding.completedSteps.includes("education_system")) return "education_system";
    if (!lifecycle.selectedPlanId) return "pricing";
    if (!lifecycle.accessMode) return "trial_choice";
    if (!lifecycle.paymentMethodVerifiedAt) return "payment_method";
    if (!lifecycle.legalConsentCompleteAt) return "legal_consent";
    const remainingOnboarding = onboardingSteps.slice(2).find((step) => !lifecycle.onboarding.completedSteps.includes(step));
    if (remainingOnboarding) return remainingOnboarding;
    if (!lifecycle.classroomChoice || (lifecycle.classroomChoice === "classroom" && !lifecycle.classroomConnectedAt)) return "classroom_setup";
    if (!lifecycle.materialsSelectedAt) return "materials";
    if (!lifecycle.setupSummaryReadyAt) return "setup_summary";
    if (lifecycle.workspaceReadyAt) return "tutorial";
    return "workspace_preparation";
  }

  function previousStep(currentStep) {
    const index = flowSteps.indexOf(currentStep);
    if (index <= 0) return null;
    const previous = flowSteps[index - 1];
    if (lifecycle.paymentMethodVerifiedAt && flowSteps.indexOf(previous) < flowSteps.indexOf("payment_method")) return null;
    return previous;
  }

  function refreshLifecycle() {
    lifecycle.derivedNextStep = derivedStep();
    lifecycle.nextStep = lifecycle.navigationStep || lifecycle.derivedNextStep;
    lifecycle.canGoPrevious = Boolean(previousStep(lifecycle.nextStep));
    lifecycle.paymentMethodVerified = Boolean(lifecycle.paymentMethodVerifiedAt);
    lifecycle.legalConsentComplete = Boolean(lifecycle.legalConsentCompleteAt);
    lifecycle.workspaceReady = Boolean(lifecycle.workspaceReadyAt);
    lifecycle.dashboardActive = Boolean(lifecycle.dashboardActivatedAt);
    lifecycle.onboarding.completedStepCount = lifecycle.onboarding.completedSteps.length;
    lifecycle.onboarding.progressPercent = Math.round((lifecycle.onboarding.completedSteps.length / onboardingSteps.length) * 100);
  }

  function finishStep(step) {
    if (lifecycle.navigationStep === step) {
      const [returnStep, ...remaining] = lifecycle.navigationHistory;
      lifecycle.navigationStep = returnStep || null;
      lifecycle.navigationHistory = remaining;
    }
    refreshLifecycle();
  }

  refreshLifecycle();
  const persistenceOrder = [];
  let releaseDailySave;
  const dailySaveGate = new Promise((resolve) => { releaseDailySave = resolve; });
  let dailySaveReleased = false;
  let examSaveAttempts = 0;
  let failAcademicSaves = false;
  let academicFailureAttempts = 0;
  let classroomSyncCalls = 0;
  const selectedPlanPayloads = [];
  const selectedAccessModes = [];

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
  await page.route("**/api/sources/upload", async (route) => {
    const material = {
      id: "src_onboarding_syllabus",
      courseId: "academic-context",
      title: "semester-syllabus.txt",
      filename: "semester-syllabus.txt",
      status: "indexed",
      sourceType: "uploaded_file",
    };
    if (!newUserState.sourceMaterials.some((item) => item.id === material.id)) newUserState.sourceMaterials.push(material);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ material, state: newUserState, secretsPrinted: false }),
    });
  });
  await page.route("**/api/classroom/oauth/start", async (route) => {
    const timestamp = "2026-06-27T10:00:00.000Z";
    lifecycle.classroomConnectedAt = timestamp;
    lifecycle.state = "classroom_connected";
    finishStep("classroom_setup");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        authorizationUrl: null,
        connector: { connected: true, state: "connected", actions: { sync: true } },
        secretsPrinted: false,
      }),
    });
  });
  await page.route("**/api/classroom/sync", async (route) => {
    classroomSyncCalls += 1;
    newUserState.classroomItems = [
      { id: "assignment_old", itemType: "assignment", title: "Older Classroom assignment", courseTitle: "Current Semester", source: "google_classroom", selectionState: "discovered", academicContextIncluded: false, providerUpdatedAt: "2026-05-01T09:00:00.000Z" },
      { id: "assignment_new", itemType: "assignment", title: "Newest Classroom assignment", courseTitle: "Current Semester", source: "google_classroom", selectionState: "discovered", academicContextIncluded: false, providerUpdatedAt: "2026-06-20T09:00:00.000Z" },
      { id: "material_current", itemType: "material", title: "Current Classroom notes", courseTitle: "Current Semester", source: "google_classroom", selectionState: "discovered", academicContextIncluded: false, providerUpdatedAt: "2026-06-10T09:00:00.000Z" },
    ];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        state: newUserState,
        connector: { connected: true, state: "connected", actions: { sync: true } },
        summary: { discoveredAssignments: 2, discoveredMaterials: 1 },
        secretsPrinted: false,
      }),
    });
  });
  await page.route("**/api/product-flow", async (route) => {
    const request = route.request().postDataJSON();
    const payload = request.payload || {};
    const timestamp = "2026-06-27T10:00:00.000Z";
    if (request.action === "save_step_draft") {
      if (onboardingSteps.includes(payload.step)) lifecycle.onboarding.answers[payload.step] = payload.answers || {};
      else if (payload.step === "legal_consent") lifecycle.legalConsentDraft = payload;
      else if (payload.step === "materials") lifecycle.materialsDraft = payload;
      refreshLifecycle();
    } else if (request.action === "navigate_previous") {
      const previous = previousStep(lifecycle.nextStep);
      lifecycle.navigationHistory = [lifecycle.nextStep, ...lifecycle.navigationHistory];
      lifecycle.navigationStep = previous;
      refreshLifecycle();
    } else if (request.action === "select_plan") {
      selectedPlanPayloads.push(payload.planId);
      lifecycle.selectedPlanId = payload.planId;
      newUserState.planAccess = {
        ...(newUserState.planAccess || {}),
        selectedPlanKey: payload.planId,
        academicContext: { status: "available", canAdd: true, message: "You can add academic material." },
      };
      lifecycle.state = "plan_selected";
      lifecycle.accessMode = null;
      finishStep("pricing");
    } else if (request.action === "choose_access") {
      selectedAccessModes.push(payload.accessMode);
      lifecycle.accessMode = payload.accessMode;
      lifecycle.state = payload.accessMode === "trial" ? "trial_selected" : "paid_plan_selected";
      finishStep("trial_choice");
    } else if (request.action === "verify_payment_method_placeholder") {
      lifecycle.paymentMethodVerifiedAt = timestamp;
      lifecycle.state = "payment_method_verified";
      finishStep("payment_method");
    } else if (request.action === "complete_legal") {
      lifecycle.legalConsentCompleteAt = timestamp;
      lifecycle.legalConsentDraft = {};
      lifecycle.state = "legal_consent_complete";
      finishStep("legal_consent");
    } else if (request.action === "save_onboarding_step") {
      if (payload.step === "academic_context" && failAcademicSaves) {
        academicFailureAttempts += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Please try again." }),
        });
        return;
      }
      if (payload.step === "exam_pattern") {
        examSaveAttempts += 1;
        if (examSaveAttempts === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Please try again." }),
          });
          return;
        }
      }
      persistenceOrder.push({ step: payload.step, answers: payload.answers || {} });
      if (payload.step === "daily_schedule" && !dailySaveReleased) await dailySaveGate;
      lifecycle.onboarding.answers[payload.step] = payload.answers || {};
      if (!lifecycle.onboarding.completedSteps.includes(payload.step)) lifecycle.onboarding.completedSteps.push(payload.step);
      if (payload.step === "about_you") newUserState.studentProfile.displayName = payload.answers.displayName;
      const next = onboardingSteps.find((step) => !lifecycle.onboarding.completedSteps.includes(step));
      lifecycle.onboarding.currentStep = next || "complete";
      lifecycle.state = next ? "onboarding_progress_saved" : "classroom_choice_pending";
      finishStep(payload.step);
    } else if (request.action === "choose_classroom_path") {
      lifecycle.classroomChoice = payload.choice;
      lifecycle.state = payload.choice === "manual" ? "manual_setup_selected" : "classroom_choice_pending";
      if (payload.choice === "manual") lifecycle.manualSetupSelectedAt = timestamp;
      finishStep("classroom_setup");
    } else if (request.action === "save_materials") {
      lifecycle.selectedMaterialIds = payload.materialIds || [];
      lifecycle.selectedMaterialLabels = payload.materialLabels || [];
      lifecycle.materialsSelectedAt = timestamp;
      lifecycle.materialsDraft = { materialIds: [], materialLabels: [] };
      lifecycle.state = "materials_selected";
      finishStep("materials");
    } else if (request.action === "confirm_setup_summary") {
      lifecycle.setupSummaryReadyAt = timestamp;
      lifecycle.state = "setup_summary_ready";
      finishStep("setup_summary");
    } else if (request.action === "edit_setup") {
      const targetIndex = onboardingSteps.indexOf("academic_context");
      lifecycle.onboarding.completedSteps = lifecycle.onboarding.completedSteps.filter((step) => onboardingSteps.indexOf(step) < targetIndex);
      lifecycle.onboarding.currentStep = "academic_context";
      lifecycle.classroomChoice = null;
      lifecycle.classroomConnectedAt = null;
      lifecycle.manualSetupSelectedAt = null;
      lifecycle.materialsSelectedAt = null;
      lifecycle.setupSummaryReadyAt = null;
      lifecycle.navigationStep = null;
      lifecycle.navigationHistory = [];
      lifecycle.state = "onboarding_progress_saved";
      refreshLifecycle();
    } else if (request.action === "start_workspace_preparation") {
      lifecycle.workspacePreparationStartedAt = timestamp;
      lifecycle.state = "workspace_preparing";
      finishStep("workspace_preparation");
    } else if (request.action === "complete_workspace_preparation") {
      lifecycle.workspaceReadyAt = timestamp;
      lifecycle.tutorialOfferedAt = timestamp;
      lifecycle.state = "tutorial_offered";
      finishStep("workspace_preparation");
    } else if (request.action === "prepare_workspace") {
      lifecycle.workspacePreparationStartedAt = timestamp;
      lifecycle.workspaceReadyAt = timestamp;
      lifecycle.tutorialOfferedAt = timestamp;
      lifecycle.state = "tutorial_offered";
      finishStep("workspace_preparation");
    } else if (request.action === "choose_tutorial") {
      lifecycle.tutorialChoice = payload.choice;
      if (payload.choice === "skip") {
        lifecycle.dashboardActivatedAt = timestamp;
        lifecycle.state = "dashboard_active";
      }
      finishStep("tutorial");
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

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(baseUrl);
  await expect(page.locator("#product-flow-shell")).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();
  await expect(page.getByRole("heading", { name: "What is your name?" })).toBeVisible();
  await expect(page.locator("#product-flow-progress")).toContainText("Step 1 of 14");
  await expect(page.locator("#product-flow-content")).not.toContainText("Choose your plan");
  await expect(page.getByRole("button", { name: "Previous" })).toHaveCount(0);
  await expect(page.locator("#product-flow-message")).toBeHidden();
  await expectNoHorizontalOverflow(page, "1366px lifecycle name");
  await expectNoLifecycleTechnicalCopy(page, "name page");
  await expect(page.locator("#product-flow-content")).not.toContainText(/storage|tokens|model|provider|Supabase|Groq|Gemini/i);
  await expect(page.getByRole("button", { name: "Ask StudentOS" })).toHaveCount(1);
  const nameInput = page.locator("#product-display-name");
  await nameInput.fill("");
  await expectReadableContrast(page, "#product-display-name", "name placeholder", { pseudo: "::placeholder" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What is your name?" })).toBeVisible();
  await nameInput.fill("Lifecycle Student");
  await expectReadableContrast(page, "#product-display-name", "entered name");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Academic identity" })).toBeVisible();
  await expect(page.locator("#product-flow-progress")).toContainText("Step 2 of 14");
  await expect(page.locator("#product-flow-content")).toContainText("Every field on this page is optional");
  await page.locator("#product-flow-content input[name='institution']").fill("Example University");
  await page.locator("#product-flow-content input[name='level']").fill("Undergraduate");
  await page.locator("#product-flow-content input[name='stream']").fill("Science");
  await page.locator("#product-flow-content input[name='yearSemester']").fill("Semester 2");
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByRole("heading", { name: "What is your name?" })).toBeVisible();
  await expect(page.locator("#product-display-name")).toHaveValue("Lifecycle Student");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#product-flow-content input[name='institution']")).toHaveValue("Example University");
  await expect(page.locator("#product-flow-content input[name='yearSemester']")).toHaveValue("Semester 2");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: "Build your academic workspace" })).toBeVisible();
  await expect(page.locator("#product-flow-progress")).toContainText("Step 3 of 14");
  await expect(page.locator(".product-plan-card")).toHaveCount(4);
  await expect(page.locator(".product-plan-card h3")).toHaveText([/99.*month/, /159.*month/, /259.*month/, /549.*month/]);
  const starterCard = page.locator('.product-plan-card[data-plan-key="starter"]');
  const essentialCard = page.locator('.product-plan-card[data-plan-key="essential"]');
  const plusCard = page.locator('.product-plan-card[data-plan-key="plus"]');
  const proCard = page.locator('.product-plan-card[data-plan-key="pro"]');
  await expect(starterCard).toContainText("Daily study plan from your syllabus");
  await expect(starterCard).toContainText("Adaptive To-Do list");
  await expect(starterCard).toContainText("Manual material upload");
  await expect(starterCard).toContainText("Basic tests and revision");
  await expect(starterCard).toContainText("Ask StudentOS for guided help");
  await expect(essentialCard).toContainText("Recommended");
  await expect(essentialCard).toContainText("Weekly Classroom coursework checks");
  await expect(essentialCard).toContainText("Flashcards for active subjects");
  await expect(essentialCard).toContainText("Visual notes with simple diagrams");
  await expect(essentialCard).toContainText("More room for your academic context");
  await expect(plusCard).toContainText("More frequent Classroom checks");
  await expect(plusCard).toContainText("Learning Level");
  await expect(plusCard).toContainText("Deeper explanations and stronger planning");
  await expect(proCard).toContainText("Consistency Points");
  await expect(proCard).toContainText("Priority roadmap and assignment preparation");
  await expect(proCard).toContainText("Advanced assignment checking");
  await expect(page.locator(".product-plan-card.recommended")).toHaveCount(1);
  await expect(page.locator(".product-plan-card.recommended")).toHaveAttribute("data-plan-key", "essential");
  await expect(page.locator(".product-plan-card .plan-best-for")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /^Choose (Starter|Essential|Plus|Pro)$/ })).toHaveCount(4);
  await expect(page.locator(".product-pricing-grid")).not.toContainText(/\b(storage|GB|MB|tokens?|model|provider|Groq|Gemini|Pollinations|Supabase|backend|database|embeddings?|vectors?|chunks?|writeback|OAuth|API|rate limit|auto-submit)\b/i);
  await page.setViewportSize({ width: 390, height: 820 });
  await expectNoHorizontalOverflow(page, "390px lifecycle pricing");
  await expectNoLifecycleTechnicalCopy(page, "pricing page");
  await page.getByRole("button", { name: "Ask StudentOS" }).click();
  await expect(page.locator("#product-flow-ask-response")).toContainText("Finish the current setup step");

  const blankDarkArtifacts = await page.locator("#product-flow-shell *").evaluateAll((elements) => elements.filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const rgb = style.backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
    const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 30 && rect.height > 20;
    return visible && rgb.length >= 3 && rgb[0] < 35 && rgb[1] < 35 && rgb[2] < 35 && !element.textContent.trim();
  }).map((element) => ({ tag: element.tagName, id: element.id, className: element.className })));
  expect(blankDarkArtifacts, "onboarding should not contain an unexplained dark rectangle").toEqual([]);

  await page.getByRole("button", { name: "Choose Plus" }).click();
  expect(selectedPlanPayloads.at(-1)).toBe("plus");
  expect(lifecycle.selectedPlanId).toBe("plus");
  await expect(page.locator("#product-flow-ask-response")).toBeHidden();
  await expect(page.locator("#product-flow-content")).toContainText("Trial features are different from Plus");
  await expect(page.locator("#product-flow-content")).toContainText("Your selected Plus plan stays saved while Trial Mode is active");
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByRole("heading", { name: "Build your academic workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Choose Plus" }).click();
  await page.getByRole("button", { name: "Start with Trial Mode" }).click();
  expect(selectedPlanPayloads.at(-1)).toBe("plus");
  expect(selectedAccessModes.at(-1)).toBe("trial");
  expect(lifecycle.selectedPlanId).toBe("plus");
  expect(lifecycle.accessMode).toBe("trial");
  await expect(page.locator("#product-flow-content")).toContainText("does not claim that a payment has been completed");
  await expect(page.locator("#product-flow-content")).toContainText("No charge is created here");
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.locator("#product-flow-content")).toContainText("Trial features are different from Plus");
  await page.getByRole("button", { name: "Start with Trial Mode" }).click();
  await page.getByRole("button", { name: "Continue setup" }).click();

  await expect(page.getByRole("heading", { name: "Review before we build your workspace" })).toBeVisible();
  await expectNoLifecycleTechnicalCopy(page, "legal page");
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByRole("heading", { name: "Verify your payment method" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue setup" }).click();
  await page.getByRole("button", { name: "Agree and continue" }).click();
  await expect(page.getByRole("heading", { name: "Review before we build your workspace" })).toBeVisible();
  for (const checkbox of await page.locator("#product-legal-form .legal-check-list input[type='checkbox']").all()) await checkbox.check();
  await expectReadableContrast(page, "#product-legal-form .check-row span", "legal checkbox label");
  await page.locator("#product-legal-form input[name='ageGate'][value='adult']").check();
  await page.getByRole("button", { name: "Agree and continue" }).click();

  await expect(page.getByRole("heading", { name: "Daily Schedule" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("heading", { name: "Exam and Assessment Pattern" })).toBeVisible();
  expect(dailySaveReleased, "daily save should still be pending while the next page is already visible").toBe(false);
  await expect(page.locator("#product-save-status")).toContainText("Saving your setup");
  await expect(page.locator("#product-flow-content")).toContainText("how exams and assessments work in your institution");
  await expect(page.locator("#product-flow-content")).toContainText("Continuous Internal Assessments");
  await expect(page.locator("#product-flow-content")).toContainText("one per month");
  const examPattern = page.locator("textarea[name='examPattern']");
  await examPattern.fill("We have monthly internals.");
  await examPattern.fill("We have four monthly internals, practicals, a viva, and a semester exam.");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: "Syllabus and Academic Context" })).toBeVisible();
  await expect(page.locator("#product-flow-content")).toContainText("PDF uploads become available in Academic Context after Setup");
  await expect(page.getByText("Available after Setup", { exact: true })).toBeVisible();
  await expect(page.locator("#product-academic-files")).toHaveAttribute("accept", /\.pdf/);
  await expect(page.locator("#product-academic-files")).not.toHaveAttribute("accept", /\.xlsx|image/);
  expect(persistenceOrder.filter((item) => ["daily_schedule", "exam_pattern", "academic_context"].includes(item.step)).map((item) => item.step)).toEqual(["daily_schedule"]);
  dailySaveReleased = true;
  releaseDailySave();
  await expect.poll(() => persistenceOrder.filter((item) => ["daily_schedule", "exam_pattern", "academic_context"].includes(item.step)).map((item) => item.step).slice(-2)).toEqual(["daily_schedule", "exam_pattern"]);
  expect(examSaveAttempts).toBe(2);
  expect(persistenceOrder.find((item) => item.step === "exam_pattern")?.answers.examPattern).toContain("four monthly internals");

  await page.locator("textarea[name='subjects']").fill("Mathematics\nPhysics");
  await page.locator("textarea[name='syllabusNotes']").fill("Our semester covers calculus, mechanics, and weekly problem sets.");
  await expect(page.locator("#product-academic-files")).toBeDisabled();
  await expect(page.locator("#product-flow-content")).toContainText("Add a course in Setup before uploading academic context.");
  await expectNoLifecycleTechnicalCopy(page, "academic context upload page");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: "How should StudentOS find your coursework?" })).toBeVisible();
  await expectNoLifecycleTechnicalCopy(page, "Classroom choice page");
  await page.getByRole("button", { name: "Connect Google Classroom" }).click();
  await expect(page.getByRole("heading", { name: "Connect Google Classroom" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Google Classroom" }).click();
  await expect(page.getByRole("heading", { name: "Choose what belongs in your first workspace" })).toBeVisible();
  await expect.poll(() => classroomSyncCalls).toBe(1);
  await expectNoLifecycleTechnicalCopy(page, "materials page");
  await expect(page.locator("#product-flow-content")).toContainText("You can add or remove materials later from Academic Context");
  await expect(page.locator("#product-flow-content")).not.toContainText("No materials are waiting yet");
  await expect(page.locator("#product-flow-content")).toContainText("Newest Classroom assignment");
  await expect(page.locator("#product-flow-content")).toContainText("Current Classroom notes");
  const materialTitles = await page.locator(".material-choice-row strong").allTextContents();
  expect(materialTitles.indexOf("Newest Classroom assignment")).toBeLessThan(materialTitles.indexOf("Older Classroom assignment"));
  expect(materialTitles.indexOf("Newest Classroom assignment")).toBeLessThan(materialTitles.indexOf("Current Classroom notes"));
  await page.locator("#product-materials-form input[name='materialIds']").first().check();
  await page.getByRole("button", { name: "Continue to setup summary" }).click();

  await expect(page.getByRole("heading", { name: "Does this look right?" })).toBeVisible();
  await expectNoLifecycleTechnicalCopy(page, "setup summary page");
  await expect(page.locator("#product-flow-content")).toContainText("Lifecycle Student");
  await expect(page.locator("#product-flow-content")).toContainText("Example University");
  await expect(page.locator("#product-flow-content")).toContainText("Semester 2");
  await expect(page.getByRole("button", { name: "Prepare my workspace", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Edit details", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Continue with what I have" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add more details" })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Syllabus and Academic Context" })).toBeVisible();
  await expect(page.locator("textarea[name='syllabusNotes']")).toHaveValue("Our semester covers calculus, mechanics, and weekly problem sets.");
  await expect(page.locator("#product-academic-files")).toBeDisabled();
  failAcademicSaves = true;
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "How should StudentOS find your coursework?" })).toBeVisible();
  await page.getByRole("button", { name: "My institution does not use Classroom" }).click();
  await expect(page.getByRole("heading", { name: "How should StudentOS find your coursework?" })).toBeVisible();
  await expect(page.locator("#product-flow-message")).toContainText("could not save your latest setup changes");
  expect(academicFailureAttempts).toBeGreaterThanOrEqual(3);
  failAcademicSaves = false;
  await page.getByRole("button", { name: "My institution does not use Classroom" }).click();
  await page.getByRole("button", { name: "Continue to setup summary" }).click();
  await expect(page.getByRole("heading", { name: "Does this look right?" })).toBeVisible();
  await page.getByRole("button", { name: "Prepare my workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Preparing your workspace" })).toBeVisible();
  await expect(page.locator("#product-flow-content")).not.toContainText(/Ready to prepare your workspace|Your workspace is taking shape/);
  await expect(page.getByRole("button", { name: "Continue to quick tour" })).toHaveCount(1);
  await expect(page.locator("#product-flow-content")).toContainText(/building your Today view/i);
  await expectNoLifecycleTechnicalCopy(page, "workspace preparation page");
  await page.getByRole("button", { name: "Continue to quick tour" }).click();

  await expect(page.getByRole("heading", { name: "Would you like a quick tour before entering Today?" })).toBeVisible();
  await expectNoLifecycleTechnicalCopy(page, "tutorial choice page");
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.locator("#product-flow-shell")).toBeHidden();
  await expect(page.locator("#app-shell")).toBeVisible();
  await expect(page.locator("#view-title")).toHaveText("Today");
  await expect(page.locator("#plan-badge")).toHaveText("Plus");
  await expect(page.locator("body")).not.toContainText("Plan Free");
  await expect(page.locator(".verb-tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask StudentOS" })).toHaveCount(1);
});

test("Classroom status UI normalizes controls and copy", async ({ page }) => {
  await prepareLocalWorkspace();
  const revealClassroomStatusFixture = () => page.locator("#today-dashboard-panels").evaluate((element) => {
    element.hidden = false;
  });
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
        message: "Your workspace is ready. Classroom can be connected later.",
        badge: "workspace ready",
      },
      setup_required: {
        title: "Classroom setup is not active",
        message: "Your workspace is ready. Classroom can be connected later.",
        badge: "workspace ready",
      },
      disconnected: {
        title: "Classroom can be connected",
        message: "Connect when you want to choose Classroom work for your academic context.",
        badge: "optional setup",
      },
      connected: {
        title: "Classroom connected",
        message: "StudentOS can find Classroom work for you to review. You choose what gets added.",
        badge: "work ready to review",
      },
      reconnect_required: {
        title: "Reconnect Classroom",
        message: "Reconnect Classroom to check for new work and refresh selected items.",
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
  await revealClassroomStatusFixture();
  await expect(page.locator("#classroom-panel")).toContainText("Classroom setup is not active");
  await expectClassroomControls(page, {});
  await expectNoClassroomDeveloperCopy(page, "disabled Classroom state");

  connector = connectorFor("setup_required");
  await page.goto(baseUrl);
  await revealClassroomStatusFixture();
  await expect(page.locator("#classroom-panel")).toContainText("Classroom setup is not active");
  await expectClassroomControls(page, {});
  await expectNoClassroomDeveloperCopy(page, "setup-required Classroom state");

  connector = connectorFor("disconnected");
  await page.goto(baseUrl);
  await revealClassroomStatusFixture();
  await expect(page.locator("#classroom-panel")).toContainText("Classroom can be connected");
  await expectClassroomControls(page, { connectLabel: "Connect Classroom" });
  await expectNoClassroomDeveloperCopy(page, "disconnected Classroom state");

  connector = connectorFor("connected", {
    lastSyncAt: "2026-06-25T06:00:00.000Z",
    syncSummary: {
      discoveredCourses: 1,
      discoveredAssignments: 2,
      updatedAssignments: 1,
      emptyClassroom: false,
    },
  });
  await page.goto(baseUrl);
  await revealClassroomStatusFixture();
  await expect(page.locator("#classroom-panel")).toContainText("Classroom connected");
  await expectClassroomControls(page, { sync: true, disconnect: true });
  await expectNoClassroomDeveloperCopy(page, "connected Classroom state");

  connector = connectorFor("reconnect_required");
  await page.goto(baseUrl);
  await revealClassroomStatusFixture();
  await expect(page.locator("#classroom-panel")).toContainText("Reconnect Classroom");
  await expectClassroomControls(page, { connectLabel: "Reconnect Classroom" });
  await expectNoClassroomDeveloperCopy(page, "reconnect-required Classroom state");
});

test("Setup saves availability without manual roadmap or weak-topic controls", async ({ page }) => {
  await prepareLocalWorkspace();
  const pageErrors = [];
  const failedRequests = [];
  const postedPaths = [];
  page.on("pageerror", (error) => pageErrors.push(redact(error.message)));
  page.on("requestfailed", (request) => failedRequests.push(new URL(request.url()).pathname));
  page.on("request", (request) => {
    if (request.method() === "POST") postedPaths.push(new URL(request.url()).pathname);
  });

  await page.goto(baseUrl);
  await clickNav(page, "Setup");
  await expect(page.getByRole("button", { name: "Generate roadmap" })).toHaveCount(0);
  await expect(page.locator("#onboarding-form textarea[name='weakTopicsText']")).toHaveCount(0);
  await expect(page.locator("#derived-weak-topics")).toBeVisible();
  await expect(page.locator("#derived-weak-topics")).toContainText("Weak topics are identified from your test performance");
  await page.locator("#onboarding-form textarea[name='timetableText']").fill("Weekdays after 6 PM, and weekends all day.");
  await page.getByRole("button", { name: "Save setup" }).click();
  await expect(page.locator("#onboarding-result")).toContainText("Setup saved");
  await expect(page.locator("#view-title")).toHaveText("Setup");
  await page.reload();
  await clickNav(page, "Setup");
  await expect(page.locator("#onboarding-form textarea[name='timetableText']")).toHaveValue("Weekdays after 6 PM, and weekends all day.");
  expect(postedPaths.filter((path) => path === "/api/onboarding")).toHaveLength(1);
  expect(postedPaths).not.toContain("/api/today/todo");
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("desktop core flows stay usable in local mock mode", async ({ page }) => {
  await prepareLocalWorkspace();
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
  await expect(page.locator("#auth-session")).toContainText("Local preview");
  await expect(page.locator(".rail-session-card")).toHaveCount(0);
  await expect(page.locator("#profile-menu-trigger")).toHaveAccessibleName("Open account menu");
  await expect(page.locator("#connector-status")).toContainText("Local preview");
  await expect(page.locator("#dashboard-summary")).toContainText("Your academic context is ready to prepare.");
  await expect(page.getByRole("button", { name: "Prepare Academic Context" })).toBeVisible();
  await expect(page.locator("#today-dashboard-panels")).toBeHidden();
  await clickNav(page, "Setup");
  await expect(page.locator("#onboarding-form input[name='displayName']")).toHaveValue("E2E Student");
  await expect(page.locator("#onboarding-form input[name='stream']")).toHaveValue("Engineering");
  await expect(page.locator("#onboarding-form input[name='classLevel']")).toHaveValue("Undergraduate");
  await expect(page.locator("#onboarding-form textarea[name='subjectsText']")).toHaveValue(/Physics/);
  await page.reload();
  await expect(page.locator("#dashboard-summary")).toContainText("Your academic context is ready to prepare.");
  await expect(page.locator("body")).not.toContainText(/Aarav|Grade 10|Quadratics worksheet|Load sample profile|Plan Free/);
  await expectNoVisibleExternalBranding(page, "initial local workspace");

  for (const view of ["Today", "Setup", "Courses", "Academic Context", "Study and Evaluate", "Studio", "Account"]) {
    await clickNav(page, view);
  }

  await clickNav(page, "Setup");
  await expect(page.locator("#onboarding-form")).toContainText("Identity");
  await expect(page.locator("#onboarding-form")).toContainText("Academic structure");
  await expect(page.locator("#onboarding-form")).toContainText("Study rhythm");
  await page.locator("#onboarding-form input[name='displayName']").fill("E2E Student");
  await page.locator("#onboarding-form input[name='stream']").fill("Science");
  await page.locator("#onboarding-form textarea[name='subjectsText']").fill("Mathematics|2026-07-01|Quadratics, Trigonometry\nPhysics|2026-07-04|Motion graphs");
  await expect(page.getByRole("button", { name: "Generate roadmap" })).toHaveCount(0);
  await expect(page.locator("#onboarding-form textarea[name='weakTopicsText']")).toHaveCount(0);
  await expect(page.locator("#derived-weak-topics")).toContainText("Weak topics are identified from your test performance");
  await page.locator("#onboarding-form textarea[name='completedTopicsText']").fill("Mathematics: Quadratics");
  await page.locator("#onboarding-form textarea[name='timetableText']").fill("Weekdays after 6 PM, and weekends all day.");
  await page.getByRole("button", { name: "Save setup" }).click();
  await expect(page.locator("#onboarding-result")).toContainText("Setup saved");
  await expect(page.locator("#view-title")).toHaveText("Setup");
  await page.reload();
  await clickNav(page, "Setup");
  await expect(page.locator("#onboarding-form textarea[name='timetableText']")).toHaveValue("Weekdays after 6 PM, and weekends all day.");

  await clickNav(page, "Courses");
  await expect(page.locator("#courses-grid")).toContainText("Workspace preview");
  await expect(page.locator("#courses-grid")).toContainText("Materials");
  await expect(page.locator("#courses-grid")).toContainText("Next action");
  await page.locator("#courses-grid").getByRole("button", { name: "Ask about course" }).first().click();
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#ai-message")).toHaveValue(/Course workspace/i);
  await closeAiDrawer(page);

  await clickNav(page, "Academic Context");
  await expect(page.getByRole("button", { name: "Memory", exact: true })).toHaveCount(0);
  await expect(page.locator("#view-memory")).toContainText("Courses, syllabus, exam dates, assignments, and materials StudentOS can use for your semester.");
  await expect(page.locator("#view-memory")).toContainText("Exam dates");
  await expect(page.locator("#view-memory")).toContainText("PDFs");
  await expect(page.getByRole("heading", { name: "Assignments", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Study materials", exact: true })).toBeVisible();
  await expect(page.locator("#source-deadline-field")).toBeVisible();
  await expect(page.locator("#source-deadline")).toHaveAttribute("required", "");
  await expect(page.locator("#source-form")).toContainText("Set the deadline of the assignment.");
  await page.getByRole("button", { name: "Upload assignment" }).click();
  await expect(page.locator("#source-title-error")).toContainText("Add a title for this assignment.");
  await expect(page.locator("#source-course-error")).toContainText("Choose a course for this assignment.");
  await expect(page.locator("#source-deadline-error")).toContainText("Set the assignment deadline before uploading.");
  await expect(page.locator("#source-file-error")).toContainText("Choose a PDF file.");
  await page.route("**/api/sources/upload", async (route) => {
    await delay(300);
    await route.continue();
  });
  await page.locator("#source-form input[name='title']").fill("E2E motion graphs assignment");
  await page.locator("#source-course-select").selectOption({ index: 1 });
  await page.locator("#source-deadline").fill("2026-07-10");
  await page.locator("#source-file").setInputFiles({
    name: "motion-graphs-assignment.pdf",
    mimeType: "application/pdf",
    buffer: buildPdfFixtureBuffer("Motion graphs assignment for StudentOS."),
  });
  await page.getByRole("button", { name: "Upload assignment" }).click();
  await expect(page.locator("#source-result")).toContainText("Added to Academic Context.", { timeout: 15_000 });
  const assignmentCard = page.locator(".academic-context-assignment-card").filter({ hasText: "E2E motion graphs assignment" });
  await expect(assignmentCard).toContainText(/Mathematics|Physics/);
  await expect(assignmentCard).toContainText("Due");
  await expect(assignmentCard).toContainText("Manual upload");
  await expect(assignmentCard.getByRole("img", { name: "PDF document preview placeholder" })).toBeVisible();

  await page.locator("#source-kind-select").selectOption("material");
  await expect(page.locator("#source-deadline-field")).toBeHidden();
  await expect(page.locator("#source-deadline")).not.toHaveAttribute("required", "");
  await page.locator("#source-form input[name='title']").fill("E2E quadratics note");
  await page.locator("#source-course-select").selectOption({ index: 1 });
  await page.locator("#source-file").setInputFiles({
    name: "quadratics-note.pdf",
    mimeType: "application/pdf",
    buffer: buildPdfFixtureBuffer("Quadratics vertex form and worked examples for StudentOS."),
  });
  await page.getByRole("button", { name: "Upload study material" }).click();
  await expect(page.locator("#source-result")).toContainText("Adding this study material to Academic Context");
  await expect(page.locator("#source-result")).toContainText("E2E quadratics note", { timeout: 15_000 });
  await expect(page.locator("#source-result")).toContainText("Added to Academic Context.");
  await page.unroute("**/api/sources/upload");
  await expect(page.locator("#source-list")).toContainText("Study materials");
  await expect(page.locator("#source-list")).toContainText(/Ready for study/i);
  await expect(page.locator("#source-list")).toContainText("E2E quadratics note");
  const visibleAcademicCopy = await page.locator("#view-memory").innerText();
  expect(visibleAcademicCopy).not.toMatch(/\b(provider|model|token|storage|database|backend|vector|embedding|chunks?|debug|OAuth scope|source-grounded)\b/i);
  await expectNoVisibleExternalBranding(page, "academic context");
  const uploadedCard = page.locator(".academic-context-card").filter({ hasText: "E2E quadratics note" });
  await expect(uploadedCard).toContainText("Manual upload");
  await expect(uploadedCard.getByRole("img", { name: "PDF document preview placeholder" })).toBeVisible();
  await uploadedCard.getByRole("button", { name: "Open E2E quadratics note" }).click();
  await expect(page.locator("#academic-pdf-viewer")).toBeVisible();
  await expect(page.locator("#academic-pdf-viewer-title")).toHaveText("E2E quadratics note");
  await expect(page.locator("#academic-pdf-viewer-object")).toHaveAttribute("data", /^blob:/);
  await page.getByRole("button", { name: "Close document viewer" }).click();
  await expect(page.locator("#academic-pdf-viewer")).toBeHidden();
  await uploadedCard.getByRole("button", { name: /Ask StudentOS about E2E quadratics note/ }).click();
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#ai-message")).toHaveValue(/Explain this source/i);
  await closeAiDrawer(page);
  await uploadedCard.getByRole("button", { name: "Delete E2E quadratics note" }).click();
  await expect(page.locator("#academic-context-delete-dialog")).toBeVisible();
  await expect(page.locator("#academic-context-delete-dialog")).toContainText("This will permanently delete this file from StudentOS.");
  await expect(page.locator("#academic-context-delete-cancel")).toBeFocused();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(uploadedCard).toBeVisible();

  await page.route("**/api/ai/verb", async (route) => {
    await delay(250);
    await route.continue();
  });
  await openAiDrawer(page);
  await expect(page.locator(".verb-tab")).toHaveCount(0);
  await page.locator("#ai-message").fill("Hello");
  await page.locator("#ai-form").getByRole("button", { name: "Ask" }).click();
  await expect(page.locator("#ai-response")).toContainText("Preparing your answer");
  await waitForNotLoading(page.locator("#ai-response"), "Preparing your answer");
  await expect(page.locator("#ai-response")).toContainText("I’m StudentOS");
  await expect(page.locator("#ai-response")).not.toContainText(/provider|model|token|backend|storage|retrieval/i);
  await page.locator("#ai-message").fill("Use the uploaded quadratics material in one concise response.");
  await page.locator("#ai-form").getByRole("button", { name: "Ask" }).click();
  await expect(page.locator("#ai-response")).toContainText("Preparing your answer");
  await waitForNotLoading(page.locator("#ai-response"), "Preparing your answer");
  await expect(page.locator("#ai-response")).toContainText(/uploaded material|Cited snippets|source|reference/i, { timeout: 20_000 });
  await page.unroute("**/api/ai/verb");
  await page.route("**/api/ai/verb", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        verb: "Ask",
        answer: "Machine learning finds patterns in example data.",
        sourceLabels: [{ label: "Unrelated syllabus" }],
        grounding: {
          uploadedMaterialUsed: false,
          insufficientContext: false,
          insufficiencyReason: null,
          snippets: [{ citationLabel: "Unrelated syllabus", snippet: "This must remain hidden." }],
        },
      }),
    });
  });
  await page.locator("#ai-message").fill("What is Machine Learning?");
  await page.locator("#ai-form").getByRole("button", { name: "Ask" }).click();
  await expect(page.locator("#ai-response")).toContainText("Machine learning finds patterns");
  await expect(page.locator("#ai-response")).not.toContainText("Selected material");
  await expect(page.locator("#ai-response")).not.toContainText("Unrelated syllabus");
  await expect(page.locator("#ai-response")).not.toContainText("This must remain hidden");
  await page.unroute("**/api/ai/verb");
  await closeAiDrawer(page);

  await clickNav(page, "Studio");
  await expect(page.locator("#view-studio")).toContainText("Turn assignment into a study plan");
  await page.getByRole("button", { name: "Help review" }).click();
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#ai-message")).toHaveValue(/review a practice score/i);
  await closeAiDrawer(page);

  await clickNav(page, "Today");
  await page.locator("#today-dashboard-panels").evaluate((element) => {
    element.hidden = false;
  });
  await expect(page.locator("#classroom-panel")).toContainText(/work ready to review|connected|demo/i);
  await expectClassroomControls(page, { sync: true, disconnect: true });
  await page.route("**/api/classroom/sync", async (route) => {
    const current = await fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json());
    const course = current.courses[0];
    const topic = current.topics[0];
    current.assignments = [{
      id: "assignment_e2e_classroom",
      courseId: course.id,
      topicIds: [topic.id],
      title: "E2E Classroom assignment",
      dueDate: "2026-07-02",
      status: "open",
      source: "google_classroom",
      readOnly: true,
      academicContextIncluded: true,
      selectionState: "imported",
      handedIn: false,
      submissionState: "NEW",
    }];
    current.classroomItems = [{
      id: "classroom_item_e2e",
      itemType: "assignment",
      title: "E2E Classroom assignment",
      courseTitle: course.title,
      dueAt: "2026-07-02T23:59:00.000Z",
      selectionState: "imported",
      academicContextIncluded: true,
      handedIn: false,
    }];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        state: current,
        connector: { connected: true, state: "connected", actions: { sync: true, disconnect: true }, syncHistory: [] },
        summary: { discoveredAssignments: 0, updatedAssignments: 1 },
        policy: { automaticChecksEnabled: false },
      }),
    });
  });
  await page.getByRole("button", { name: "Check Classroom" }).click();
  await waitForNotLoading(page.locator("#classroom-panel"), "Checking Classroom work");
  await page.locator("#today-dashboard-panels").evaluate((element) => {
    element.hidden = false;
  });
  await expect(page.locator("#classroom-panel")).toContainText("work ready to review");
  await expectNoClassroomDeveloperCopy(page, "mock Classroom sync");
  await expect(page.locator("#assignment-list")).toContainText("Google Classroom");
  await expect(page.locator("#assignment-list")).toContainText("Prepare assignment");
  await page.route("**/api/assignment-flow", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      flow: {
        action: "mastery_roadmap_before_test",
        nextAction: "Review the selected topic before testing.",
        coverage: { status: "uncovered", topicCoverages: [{ title: "Motion graphs", status: "uncovered", reasons: ["new assignment"] }] },
        testSession: null,
        roadmapItem: { title: "Review Motion graphs", priority: "high" },
        lesson: { title: "Review Motion graphs", conceptExplanation: "Use your selected material first.", diagram: "Material -> review -> check", commonMistakes: [], practicePrompts: [], sourceLabels: [], examAdjustedStyle: "calm review" },
      },
    }),
  }));
  await page.getByRole("button", { name: "Prepare assignment" }).first().click();
  await expect(page.locator("#view-title")).toHaveText("Studio");
  await waitForNotLoading(page.locator("#flow-result"), "Checking coverage and next learning step");
  await expect(page.locator("#flow-result")).toContainText(/Mastery|Practice|Revision|Roadmap|Topic coverage/i);
  await page.unroute("**/api/classroom/sync");
  await page.unroute("**/api/assignment-flow");

  await clickNav(page, "Account");
  await expect(page.locator("#account-summary")).toContainText(/Student|local preview/i);
  await expect(page.locator("#view-account")).toContainText("Profile / Identity");
  await expect(page.locator("#view-account")).toContainText("Consent preferences");
  await expect(page.locator("#view-account")).toContainText("Your data rights");
  await expect(page.locator("#view-account")).not.toContainText(/Terms and privacy notice|Record acceptance|Acceptance recorded|Access sharing|Family access|Request withdrawal/i);
  await expect(page.locator("#consent-form .consent-option")).toHaveCount(3);
  const consentAlignment = await page.locator("#consent-form .consent-option").evaluateAll((rows) => rows.map((row) => {
    const checkbox = row.querySelector('input[type="checkbox"]')?.getBoundingClientRect();
    const copy = row.querySelector("span")?.getBoundingClientRect();
    return checkbox && copy ? {
      topDifference: Math.abs(checkbox.top - copy.top),
      checkboxLeft: Math.round(checkbox.left),
      overlapsPrevious: false,
    } : null;
  }));
  expect(consentAlignment.every((item) => item && item.topDifference <= 4)).toBe(true);
  expect(new Set(consentAlignment.map((item) => item.checkboxLeft)).size).toBe(1);
  await page.locator('#consent-form input[name="productResearch"]').check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.locator("#consent-result")).toHaveText("Preferences saved.");
  await page.locator('#consent-form input[name="productResearch"]').uncheck();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.locator("#consent-result")).toHaveText("Preferences saved.");
  await expect(page.locator("#quota-panel")).toContainText(/academic context|semester/i);
  await expect(page.locator("#quota-panel")).not.toContainText(/MB|GB|storage|tokens/i);
  await expect(page.locator("#pricing-panel")).toContainText(/Starter|Essential|Plus|Pro/i);
  await expect(page.locator("#pricing-panel")).toContainText(/₹99|₹159|₹259|₹549/);
  await expect(page.locator("#pricing-panel .pricing-card")).toHaveCount(4);
  await expect(page.locator('#pricing-panel .pricing-card[data-plan-key="essential"]')).toContainText("Recommended");
  await expect(page.locator("#pricing-panel .pricing-card.recommended")).toHaveCount(1);
  await expect(page.locator("#pricing-panel .plan-best-for")).toHaveCount(4);
  await expect(page.locator("#pricing-panel")).toContainText("Learning Level");
  await expect(page.locator("#pricing-panel")).toContainText("Consistency Points");
  await expect(page.locator("#pricing-panel")).not.toContainText(/\b(storage|GB|MB|tokens?|model|provider|Groq|Gemini|Pollinations|Supabase|backend|database|embeddings?|vectors?|chunks?|writeback|OAuth|API|rate limit|auto-submit)\b/i);
  await expect(page.locator("body")).not.toContainText("Plan Free");
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
  await page.getByRole("button", { name: "Upgrade" }).click();
  await expect(page.locator("#account-action-result")).toContainText("Pro is now your active plan");

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

test("Academic Context respects Classroom review eligibility and no-course guidance", async ({ page }) => {
  const baseState = await fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json());
  let bootstrapPayload = {
    ...structuredClone(baseState),
    productLifecycle: {
      ...structuredClone(baseState.productLifecycle || {}),
      state: "dashboard_active",
      dashboardActive: true,
      selectedPlanId: "essential",
      paymentMethodVerified: true,
      legalConsentComplete: true,
      workspaceReady: true,
      nextStep: "dashboard",
    },
    planAccess: {
      ...(baseState.planAccess || {}),
      activePlanKey: "essential",
      selectedPlanKey: "essential",
      dashboardAccess: true,
      academicContext: {
        ...(baseState.planAccess?.academicContext || {}),
        status: "available",
        canAdd: true,
        message: "Academic context is ready.",
      },
    },
  };
  let manualCourseAdds = 0;
  await page.route("**/api/bootstrap", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(bootstrapPayload),
  }));
  await page.route("**/api/courses", async (route) => {
    const request = route.request().postDataJSON();
    manualCourseAdds += 1;
    const course = {
      id: "course_manual_e2e_physics",
      title: request.courseName,
      courseCode: request.courseCode || null,
      department: request.department || "Science",
      term: request.term || null,
      source: "manual",
      subjectIds: [],
    };
    bootstrapPayload = { ...bootstrapPayload, courses: [...(bootstrapPayload.courses || []), course] };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        course,
        state: bootstrapPayload,
        message: "This course can now be used when uploading academic context.",
      }),
    });
  });

  const reviewItem = {
    id: "classroom_review_task32",
    itemType: "assignment",
    title: "Review-only lab report",
    courseTitle: "Physics",
    dueAt: "2026-07-12T12:00:00.000Z",
    source: "google_classroom",
    selectionState: "discovered",
    academicContextIncluded: false,
    handedIn: false,
    pendingClassroomWork: true,
    submissionState: "NEW",
  };
  bootstrapPayload = {
    ...bootstrapPayload,
    classroomItems: [reviewItem],
    planAccess: {
      ...(bootstrapPayload.planAccess || {}),
      entitlements: {
        ...(bootstrapPayload.planAccess?.entitlements || {}),
        classroom: { courseOnly: false, courseworkReviewEnabled: true },
      },
    },
  };
  await page.goto(baseUrl);
  await clickNav(page, "Academic Context");
  await expect(page.locator("#source-kind-select")).toContainText("Syllabus");
  await expect(page.locator("#source-kind-select")).toContainText("Exam schedule");
  await expect(page.locator("#exam-form")).toContainText("Exam name");
  await expect(page.locator("#exam-form")).toContainText("Exam date");
  await expect(page.getByRole("heading", { name: "Pending Classroom work" })).toBeVisible();
  await expect(page.locator(".academic-context-review-item")).toContainText("Review-only lab report");
  await expect(page.locator(".academic-context-review-item").getByRole("button", { name: "Add to Academic Context" })).toBeVisible();
  await expect(page.locator(".academic-context-review-item").getByRole("button", { name: "Ignore" })).toBeVisible();

  bootstrapPayload = {
    ...bootstrapPayload,
    classroomItems: [reviewItem],
    planAccess: {
      ...(bootstrapPayload.planAccess || {}),
      entitlements: {
        ...(bootstrapPayload.planAccess?.entitlements || {}),
        classroom: { courseOnly: true, courseworkReviewEnabled: false },
      },
    },
  };
  await page.goto(baseUrl);
  await clickNav(page, "Academic Context");
  await expect(page.getByRole("heading", { name: "Pending Classroom work" })).toHaveCount(0);
  await expect(page.locator("#academic-context-classroom-guidance")).toContainText("Starter uses Classroom only to help set up your course list. Upload PDFs manually to add assignments or materials.");

  bootstrapPayload = {
    ...bootstrapPayload,
    courses: [],
  };
  await page.goto(baseUrl);
  await clickNav(page, "Academic Context");
  await expect(page.locator("#source-capacity-message")).toContainText("No courses found yet.");
  await expect(page.locator("#academic-context-course-recovery")).toContainText("Refresh your Classroom course list or add a course in Setup before uploading academic context.");
  await expect(page.locator("#academic-context-course-recovery")).toContainText("StudentOS will only refresh your course names. It will not import assignments or materials.");
  await expect(page.locator("#academic-context-course-recovery").getByRole("button", { name: "Refresh course list" })).toBeVisible();
  const addCourseManually = page.locator("#academic-context-course-recovery").getByRole("button", { name: "Add course manually" });
  await expect(addCourseManually).toBeVisible();
  await expect(page.locator("#source-course-error")).toContainText("Add a course in Setup before uploading academic context.");
  await expect(page.locator("#source-submit-button")).toBeDisabled();
  await addCourseManually.click();
  await expect(page.locator("#view-title")).toHaveText("Setup");
  await expect(page.getByRole("heading", { name: "Courses", exact: true })).toBeVisible();
  await expect(page.locator("#course-name")).toBeFocused();
  await page.locator("#course-name").fill("E2E Physics");
  await page.locator("#course-code").fill("PHY 101");
  await page.locator("#course-term").fill("Semester 1");
  await page.getByRole("button", { name: "Add course", exact: true }).click();
  await expect(page.locator("#course-result")).toContainText("This course can now be used when uploading academic context.");
  await expect(page.locator("#saved-courses")).toContainText("E2E Physics");
  expect(manualCourseAdds).toBe(1);
  await clickNav(page, "Academic Context");
  await expect(page.locator("#academic-context-course-recovery")).toBeHidden();
  await expect(page.locator("#source-course-select")).toBeEnabled();
  await expect(page.locator("#source-course-select")).toContainText("E2E Physics");
  await expect(page.locator("#source-submit-button")).toBeEnabled();
  await page.unroute("**/api/courses");
  await page.unroute("**/api/bootstrap");
});

test("Starter Today follows academic context preparation before generating a structured TO-DO", async ({ page }) => {
  const baseState = await fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json());
  const starterPlanAccess = {
    ...baseState.planAccess,
    activePlanKey: "starter",
    selectedPlanKey: "starter",
    dashboardAccess: true,
    entitlements: {
      ...(baseState.planAccess?.entitlements || {}),
      classroom: {
        ...(baseState.planAccess?.entitlements?.classroom || {}),
        courseOnly: true,
        courseworkReviewEnabled: false,
        automaticChecksEnabled: false,
      },
    },
  };
  let starterState = {
    ...structuredClone(baseState),
    courses: [],
    topics: [],
    syllabi: [],
    exams: [],
    assignments: [],
    sourceMaterials: [],
    roadmap: [],
    classroomDueWork: [],
    todayNextActions: [],
    todayDoNow: null,
    todayPlan: null,
    academicContext: {
      status: "context_empty",
      hasContext: false,
      hasUsefulContext: false,
      canPrepare: false,
      canGenerateTodo: false,
      message: "Add your academic context first.",
    },
    planAccess: starterPlanAccess,
    productLifecycle: {
      ...baseState.productLifecycle,
      selectedPlanId: "starter",
      dashboardActive: true,
    },
  };
  await page.route("**/api/bootstrap", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(starterState),
  }));
  await page.route("**/api/academic-context/prepare", (route) => {
    starterState = {
      ...starterState,
      academicContext: {
        ...starterState.academicContext,
        status: "context_preparing",
        hasContext: true,
        hasUsefulContext: true,
        canPrepare: false,
        canGenerateTodo: false,
        message: "Setting things up for you.",
      },
    };
    return route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ state: starterState, academicContext: starterState.academicContext }),
    });
  });
  await page.route("**/api/academic-context/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ state: starterState, academicContext: starterState.academicContext }),
  }));

  await page.goto(baseUrl);
  await expect(page.locator("#dashboard-summary")).toContainText("Add your academic context first.");
  await expect(page.locator("#dashboard-summary")).not.toContainText(/Quadratics worksheet|Sources ready|default roadmap/i);
  await expect(page.locator("#today-dashboard-panels")).toBeHidden();

  starterState = {
    ...starterState,
    courses: [{ id: "course_starter_physics", title: "Physics", source: "manual" }],
    sourceMaterials: [{
      id: "source_starter_syllabus",
      courseId: "course_starter_physics",
      title: "Physics syllabus",
      artifactKind: "syllabus",
      status: "indexed",
      academicContextIncluded: true,
      selectionState: "imported",
    }],
    academicContext: {
      status: "context_needs_preparation",
      hasContext: true,
      hasUsefulContext: true,
      canPrepare: true,
      canGenerateTodo: false,
      message: "Your academic context is ready to prepare.",
    },
  };
  await page.reload();
  await expect(page.locator("#dashboard-summary")).toContainText("Your academic context is ready to prepare.");
  await expect(page.getByRole("button", { name: "Prepare Academic Context" })).toBeVisible();
  await page.getByRole("button", { name: "Prepare Academic Context" }).click();
  await expect(page.locator("#dashboard-summary")).toContainText("Setting things up for you.");
  await expect(page.locator("#dashboard-summary .starter-context-spinner")).toBeVisible();

  starterState = {
    ...starterState,
    academicContext: {
      ...starterState.academicContext,
      status: "context_ready",
      canPrepare: true,
      canGenerateTodo: true,
      preparedAt: "2026-07-03T12:00:00.000Z",
      message: "Your academic context is ready.",
    },
  };
  await page.reload();
  await expect(page.locator("#dashboard-summary")).toContainText("Generate a focused TO-DO list for the rest of today.");

  let generationClock = null;
  await page.route("**/api/today/todo", async (route) => {
    generationClock = route.request().postDataJSON();
    const plan = {
      date: generationClock.currentDate,
      generated_at: new Date().toISOString(),
      timezone: generationClock.timezone,
      summary: "A focused plan for the rest of today.",
      items: [{
        title: "Review motion and forces",
        time_hint: "45 minutes",
        reason: "The Physics exam is approaching.",
        related_course: "Physics",
        related_context: "Physics syllabus",
        priority: "high",
      }],
    };
    starterState = { ...starterState, todayPlan: plan };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ generated: true, plan, state: starterState }),
    });
  });
  await page.getByRole("button", { name: "Generate today’s TO-DO list" }).click();
  await expect(page.getByRole("heading", { name: "TO-DO", exact: true })).toBeVisible();
  await expect(page.locator(".journey-card")).toContainText("Review motion and forces");
  await expect(page.locator(".journey-card")).toContainText("45 minutes");
  expect(generationClock.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(generationClock.currentTime).toMatch(/^\d{2}:\d{2}$/);
  expect(generationClock.timezone).toBeTruthy();
  const visibleToday = await page.locator("#view-today").innerText();
  expect(visibleToday).not.toMatch(/\b(provider|model|token|storage|database|backend|vector|embedding|chunks?|debug|OAuth scope)\b/i);
});

test("Essential prepares selected Classroom context and generates Today in one click", async ({ page }) => {
  const baseState = await fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json());
  const essentialPlanAccess = {
    ...baseState.planAccess,
    activePlanKey: "essential",
    selectedPlanKey: "essential",
    dashboardAccess: true,
    entitlements: {
      ...(baseState.planAccess?.entitlements || {}),
      classroom: {
        ...(baseState.planAccess?.entitlements?.classroom || {}),
        courseOnly: false,
        courseworkReviewEnabled: true,
        automaticChecksEnabled: true,
      },
    },
  };
  let essentialState = {
    ...structuredClone(baseState),
    planAccess: essentialPlanAccess,
    todayPlan: null,
    academicContext: {
      status: "context_selected_metadata",
      hasContext: true,
      hasUsefulContext: true,
      canPrepare: true,
      canGenerateTodo: false,
      message: "Selected Classroom work is ready to check.",
      summary: {
        coursesReady: 1,
        assignmentsReady: 1,
        examDatesReady: 1,
        materialsReady: 0,
        selectedClassroomNeedsManualUpload: 0,
      },
    },
    productLifecycle: {
      ...baseState.productLifecycle,
      selectedPlanId: "essential",
      dashboardActive: true,
    },
  };
  let prepareCalls = 0;
  let todoCalls = 0;
  let generationClock = null;
  await page.route("**/api/bootstrap", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(essentialState),
  }));
  await page.route("**/api/academic-context/prepare", (route) => {
    prepareCalls += 1;
    essentialState = {
      ...essentialState,
      academicContext: {
        ...essentialState.academicContext,
        status: "context_ready",
        canPrepare: true,
        canGenerateTodo: true,
        lessComplete: true,
        manualUploadGuidance: "Some selected Classroom work needs a manual upload before StudentOS can use it fully.",
        message: "Your academic context is ready.",
        summary: {
          ...essentialState.academicContext.summary,
          selectedClassroomNeedsManualUpload: 1,
        },
      },
    };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        state: essentialState,
        academicContext: essentialState.academicContext,
        autoGenerateTodo: true,
        selectedContentCheck: { attempted: 1, manualUploadRequired: 1, cadenceUnchanged: true },
      }),
    });
  });
  await page.route("**/api/today/todo", async (route) => {
    todoCalls += 1;
    generationClock = route.request().postDataJSON();
    const plan = {
      date: generationClock.currentDate,
      generated_at: new Date().toISOString(),
      timezone: generationClock.timezone,
      summary: "AI first, Electronics second, with other subjects moving in parallel.",
      items: [
        {
          title: "Review AI CIA 1 topics",
          time_hint: "40 minutes",
          reason: "AI is the nearest exam.",
          related_course: "AI",
          related_context: "Topics 1-2",
          priority: "high",
        },
        {
          title: "Review Electronics CIA 1 topics",
          time_hint: "40 minutes",
          reason: "Electronics is the next exam.",
          related_course: "Electronics",
          related_context: "Topics 1-2",
          priority: "medium",
        },
      ],
    };
    essentialState = { ...essentialState, todayPlan: plan };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ generated: true, plan, state: essentialState }),
    });
  });

  await page.goto(baseUrl);
  await expect(page.locator("#today-dashboard-panels")).toBeHidden();
  await expect(page.locator("#dashboard-summary")).toContainText("Selected Classroom work is ready to check.");
  await page.getByRole("button", { name: "Prepare Academic Context" }).click();
  await expect(page.getByRole("heading", { name: "TO-DO", exact: true })).toBeVisible();
  await expect(page.locator(".journey-card").nth(0)).toContainText("AI CIA 1");
  await expect(page.locator(".journey-card").nth(1)).toContainText("Electronics CIA 1");
  await clickNav(page, "Academic Context");
  await expect(page.locator("#academic-context-preparation-status")).toContainText("Some selected Classroom work needs a manual upload");
  expect(prepareCalls).toBe(1);
  expect(todoCalls).toBe(1);
  expect(generationClock.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(generationClock.currentTime).toMatch(/^\d{2}:\d{2}$/);
  expect(generationClock.timezone).toBeTruthy();
  await page.unroute("**/api/today/todo");
  await page.unroute("**/api/academic-context/prepare");
  await page.unroute("**/api/bootstrap");
});

test("Study and Evaluate generates and runs a durable in-app test", async ({ page }) => {
  const baseState = await fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json());
  let studyState = {
    ...structuredClone(baseState),
    productLifecycle: {
      ...structuredClone(baseState.productLifecycle || {}),
      state: "dashboard_active",
      dashboardActive: true,
      selectedPlanId: "starter",
      accessMode: "paid_plan",
      paymentMethodVerified: true,
      legalConsentComplete: true,
      workspaceReady: true,
      nextStep: "dashboard",
      paymentMethodVerifiedAt: new Date().toISOString(),
      legalConsentCompleteAt: new Date().toISOString(),
      workspaceReadyAt: new Date().toISOString(),
      dashboardActivatedAt: new Date().toISOString(),
    },
    planAccess: {
      ...structuredClone(baseState.planAccess || {}),
      activePlanKey: "starter",
      dashboardAccess: true,
    },
    todayPlan: null,
    courses: [
      { id: "course_study_physics", title: "Physics", source: "manual", academicContextIncluded: true, selectionState: "imported" },
      { id: "course_study_math", title: "Mathematics", source: "manual", academicContextIncluded: true, selectionState: "imported" },
    ],
    sourceMaterials: [],
    testSessions: [],
  };
  let studyMaterialGenerationCalls = 0;
  await page.route("**/api/bootstrap", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(studyState),
  }));
  await page.goto(baseUrl);
  await clickNav(page, "Study and Evaluate");
  await expect(page.locator("#view-study")).toContainText("Generate today's TO-DO list first.");
  await expect(page.getByRole("button", { name: "Go to Today" })).toBeVisible();

  const today = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  studyState.todayPlan = {
    date: today,
    generated_at: new Date().toISOString(),
    summary: "Physics first, then Mathematics.",
    items: [
      {
        id: "todo_study_physics",
        title: "Review motion and forces",
        related_course: "Physics",
        related_context: "source_generated_1783243939043_dd617b00",
        reason: "The Physics exam is approaching.",
        time_hint: "45 minutes · During your available weekend study time",
        priority: "high",
        study_status: "not_started",
      },
      {
        id: "todo_study_math",
        title: "Review integration methods",
        related_course: "Mathematics",
        related_context: "Integration notes",
        reason: "Keep the next subject moving.",
        time_hint: "30 minutes",
        priority: "medium",
        study_status: "not_started",
      },
    ],
  };
  studyState.sourceMaterials = [{
    id: "source_math_notes",
    courseId: "course_study_math",
    title: "Integration notes",
    artifactKind: "material",
    status: "ready",
    readyForStudy: true,
    linkUrl: "https://example.com/integration-notes",
    academicContextIncluded: true,
    selectionState: "imported",
  }];
  await page.route("**/api/study/status", async (route) => {
    const body = route.request().postDataJSON();
    const item = studyState.todayPlan.items.find((entry) => entry.id === body.itemId);
    item.study_status = body.status;
    if (body.status === "done") item.study_completed_at = new Date().toISOString();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        item,
        message: body.status === "done" ? "Study marked done." : "Study started.",
        state: studyState,
        testSessionStarted: false,
      }),
    });
  });
  await page.route("**/api/study/material", async (route) => {
    studyMaterialGenerationCalls += 1;
    const generatedMaterial = {
      id: "source_generated_physics",
      courseId: "course_study_physics",
      title: "Generated study material (source_generated_1783243939043_dd617b00)",
      artifactKind: "material",
      source: "studentos_generated",
      origin: "studentos_generated",
      status: "ready",
      readyForStudy: true,
      generatedContent: `# Generated study material (source_generated_1783243939043_dd617b00)

## Core lesson

**Net force** connects force diagrams to acceleration with $F = ma$.

---

1. Draw a force diagram.
2. Link acceleration to the net force.

| Idea | Check |
| --- | --- |
| Force | direction |

<script>window.__studentosUnsafeRendered = true;</script>
[unsafe link](javascript:alert)`,
      todoItemId: "todo_study_physics",
      generatedAt: new Date().toISOString(),
      academicContextIncluded: true,
      selectionState: "imported",
    };
    studyState.sourceMaterials.push(generatedMaterial);
    const item = studyState.todayPlan.items[0];
    item.generated_material_id = generatedMaterial.id;
    item.study_status = "studying";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generated: true,
        material: generatedMaterial,
        message: "Study material created and saved to Academic Context.",
        state: studyState,
      }),
    });
  });
  await page.route("**/api/study/test", async (route) => {
    const paper = {
      test_title: "Newton's laws check",
      course: "Physics",
      topic: "Newton's laws",
      total_marks: 6,
      estimated_minutes: 20,
      instructions: ["Answer every question.", "Show your reasoning."],
      questions: [
        { question_number: 1, type: "objective", prompt: "Which statement describes net force?", marks: 2, choices: ["The vector sum of forces", "Only the largest force"] },
        { question_number: 2, type: "short_answer", prompt: "Explain Newton's second law.", marks: 4 },
      ],
    };
    const testSession = {
      id: "11111111-1111-4111-8111-111111111111",
      todoItemId: "todo_study_physics",
      courseId: "course_study_physics",
      status: "ready_to_start",
      testPaper: paper,
      questions: paper.questions,
      answerMode: null,
      answers: {},
      durationMinutes: 20,
      deadlineAt: null,
      academicContextIncluded: true,
    };
    studyState.testSessions.push(testSession);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ generated: true, testSession, state: studyState, message: "Your test is ready. Review the warning before you start." }),
    });
  });
  await page.route("**/api/study/tests/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const session = studyState.testSessions[0];
    if (path.endsWith("/evaluate")) {
      session.status = "evaluated";
      session.evaluatedAt = new Date().toISOString();
      session.evaluation = {
        total_marks: 6,
        scored_marks: 4,
        percentage: 66.67,
        question_results: [
          { question_number: 1, marks_awarded: 2, max_marks: 2, feedback: "Correctly identified net force.", correction: "Keep stating that net force combines all forces and their directions." },
          { question_number: 2, marks_awarded: 2, max_marks: 4, feedback: "The answer names the law but needs fuller reasoning.", correction: "Explain that acceleration is proportional to net force and inversely proportional to mass." },
        ],
        strengths: ["Identified the central force idea"],
        weak_topics: ["Applying Newton's second law"],
        next_steps: ["Review both corrections", "Practise one force calculation"],
        short_revision_plan: "Review the corrections for 10 minutes, then solve one fresh force problem.",
      };
      studyState.todayPlan.items[0].workflow_status = "completed";
      studyState.todayPlan.items[0].evaluation_completed_at = session.evaluatedAt;
    } else if (path.endsWith("/start")) {
      const body = request.postDataJSON();
      session.answerMode = body.answerMode;
      session.status = "in_progress";
      session.startedAt = new Date().toISOString();
      session.deadlineAt = new Date(Date.now() + session.durationMinutes * 60_000).toISOString();
    } else if (path.endsWith("/finish")) {
      session.status = session.answerMode === "handwritten" ? "ready_for_evaluation" : "submitted_pending_evaluation";
      session.submittedAt = new Date().toISOString();
    } else if (request.method() === "PATCH") {
      session.answers = { ...session.answers, ...request.postDataJSON().answers };
      session.lastSavedAt = new Date().toISOString();
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        evaluated: path.endsWith("/evaluate") ? true : undefined,
        evaluation: session.evaluation,
        testSession: session,
        state: studyState,
        message: path.endsWith("/evaluate") ? "Your result is ready." : path.endsWith("/finish") ? "Submitted for evaluation." : "Answers saved.",
      }),
    });
  });

  await page.reload();
  await clickNav(page, "Study and Evaluate");
  await expect(page.locator(".study-queue-item")).toHaveCount(2);
  await expect(page.locator(".study-queue-item").first()).toContainText("Review motion and forces");
  await expect(page.locator(".study-queue-item").first()).toContainText("45 min");
  await expect(page.locator(".study-queue-item").first()).toContainText("Weekend study time");
  await page.locator(".study-queue-item").first().click();
  await expect(page.locator(".study-queue-item").nth(1)).toBeVisible();

  for (const viewport of [
    { width: 1680, height: 945, layout: "two-pane" },
    { width: 1536, height: 864, layout: "two-pane" },
    { width: 1440, height: 900, layout: "two-pane" },
    { width: 1366, height: 768, layout: "two-pane" },
    { width: 1024, height: 768, layout: "stacked" },
    { width: 900, height: 900, layout: "stacked" },
    { width: 430, height: 932, layout: "stacked" },
    { width: 390, height: 844, layout: "stacked" },
    { width: 360, height: 800, layout: "stacked" },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(80);
    const geometry = await page.evaluate(() => {
      const rect = (selector) => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
      };
      return {
        queue: rect(".study-queue"),
        workspace: rect(".study-workspace"),
        card: rect(".study-queue-item"),
        title: rect(".study-queue-title"),
        badge: rect(".study-priority-badge"),
        description: rect(".study-queue-description"),
        metadata: rect(".study-queue-meta"),
        status: rect(".study-queue-status"),
      };
    });
    expect(geometry.title.width, `${viewport.width}px title width`).toBeGreaterThan(viewport.width <= 430 ? 120 : 170);
    expect(geometry.badge.height, `${viewport.width}px priority badge height`).toBeLessThanOrEqual(36);
    expect(geometry.badge.height, `${viewport.width}px priority badge/card ratio`).toBeLessThan(geometry.card.height * 0.45);
    expect(geometry.metadata.top, `${viewport.width}px metadata follows description`).toBeGreaterThanOrEqual(geometry.description.bottom - 1);
    expect(geometry.status.right, `${viewport.width}px status stays inside card`).toBeLessThanOrEqual(geometry.card.right + 1);
    expect(geometry.status.bottom, `${viewport.width}px status stays inside card`).toBeLessThanOrEqual(geometry.card.bottom + 1);
    if (viewport.layout === "two-pane") {
      expect(geometry.queue.width, `${viewport.width}px queue width`).toBeGreaterThanOrEqual(350);
      expect(Math.abs(geometry.queue.top - geometry.workspace.top), `${viewport.width}px pane alignment`).toBeLessThan(4);
    } else {
      expect(geometry.workspace.top, `${viewport.width}px stacked workspace`).toBeGreaterThanOrEqual(geometry.queue.bottom - 2);
    }
    await expectNoHorizontalOverflow(page, `Study and Evaluate ${viewport.width}x${viewport.height}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(80);
  await page.locator(".study-queue-item").nth(1).click();
  await expect(page.locator(".study-workspace")).toContainText("Integration notes");
  await expect(page.getByRole("link", { name: "Open material" })).toBeVisible();
  await expect(page.locator("[data-export-generated-note-pdf]")).toHaveCount(0);

  await page.locator(".study-queue-item").first().click();
  await expect(page.locator(".study-workspace")).toContainText("No study note is available yet.");
  await expect(page.locator(".study-task-details")).toContainText("Physics study material");
  await expect(page.locator("#view-study")).not.toContainText("source_generated_");
  await page.getByRole("button", { name: /Generate (?:study material|note)/ }).click();
  await expect(page.locator(".study-generated-material")).toContainText("Core lesson");
  await expect(page.locator(".study-material-heading h4")).toHaveText("Review motion and forces");
  await expect(page.locator(".study-generated-material")).not.toContainText("source_generated_");
  await expect(page.locator(".study-generated-copy")).not.toContainText("Generated study material");
  await expect(page.locator(".study-workspace")).toContainText("saved to Academic Context", { ignoreCase: true });
  const generatedCopy = page.locator(".study-generated-copy");
  await expect(generatedCopy.locator("h5")).toContainText("Core lesson");
  await expect(generatedCopy.locator("hr")).toHaveCount(1);
  await expect(generatedCopy.locator("strong")).toContainText("Net force");
  await expect(generatedCopy.locator("ol > li").first()).toContainText("Draw a force diagram");
  await expect(generatedCopy.locator(".study-math-inline")).toContainText("F = ma");
  await expect(generatedCopy.locator("script")).toHaveCount(0);
  await expect(generatedCopy.locator("a[href^='javascript']")).toHaveCount(0);
  const generatedMarkup = await generatedCopy.evaluate((element) => ({ html: element.innerHTML, text: element.textContent || "" }));
  expect(generatedMarkup.html).not.toContain("<script");
  expect(generatedMarkup.text).toContain("<script>window.__studentosUnsafeRendered = true;</script>");
  expect(await page.evaluate(() => window.__studentosUnsafeRendered === true)).toBe(false);
  await expect(page.locator("[data-export-generated-note-pdf]")).toHaveCount(1);

  await page.getByRole("button", { name: "Export as PDF" }).click();
  await expect(page.locator("#academic-pdf-viewer")).toBeVisible();
  await expect(page.locator("#academic-pdf-viewer-context")).toHaveText("StudentOS PDF Export");
  await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download PDF" })).toHaveAttribute("download", "studentos-review-motion-and-forces.pdf");
  expect(studyMaterialGenerationCalls).toBe(1);
  expect(studyState.sourceMaterials.map((source) => source.title)).toEqual(["Integration notes", "Generated study material (source_generated_1783243939043_dd617b00)"]);
  expect(studyState.sourceMaterials.some((source) => /academic context pdf|pdf export/i.test(String(source.title || source.kind || source.sourceType || "")))).toBe(false);
  await page.getByRole("button", { name: "Close document viewer" }).click();
  await expect(page.getByRole("link", { name: "Download PDF" })).toBeHidden();

  await clickNav(page, "Academic Context");
  await expect(page.locator("#source-list")).toContainText("Generated by StudentOS");
  await expect(page.locator("#source-list")).toContainText("Review motion and forces");
  await expect(page.locator("#source-list")).not.toContainText("source_generated_");
  await expect(page.locator("#source-list")).not.toContainText("StudentOS PDF Export");
  await clickNav(page, "Study and Evaluate");
  await page.getByRole("button", { name: /Mark (?:study|note) done/ }).click();
  await expect(page.locator(".study-workspace")).toContainText("Study marked done.");
  await expect(page.getByRole("button", { name: "Generate test" })).toBeVisible();
  await page.getByRole("button", { name: "Generate test" }).click();
  await expect(page.locator(".study-test-warning")).toContainText("This test cannot be paused. Start only when you can complete it in one sitting.");
  await expect(page.locator(".study-test-warning")).toContainText("20 minutes");
  await expect(page.locator(".study-test-warning [data-export-generated-note-pdf], .study-test-warning [download], .study-test-warning a")).toHaveCount(0);
  await expect(page.locator(".study-test-warning")).not.toContainText(/export|download/i);
  await expect(page.getByRole("button", { name: "Start test" })).toBeVisible();
  await page.getByRole("button", { name: "Start test" }).click();
  await expect(page.locator(".study-workspace-message")).toContainText("Choose how you will answer");
  await page.getByLabel("Type answers in StudentOS").check();
  await page.getByRole("button", { name: "Start test" }).click();
  await expect(page.locator(".study-test-timer")).toBeVisible();
  await expect(page.locator(".study-test-question")).toHaveCount(2);
  await expect(page.locator(".study-test-attempt [data-export-generated-note-pdf], .study-test-attempt [download], .study-test-attempt a")).toHaveCount(0);
  await expect(page.locator(".study-test-attempt")).not.toContainText(/export|download/i);
  await page.locator('[data-study-test-answer="1"]').fill("The vector sum of all forces.");
  await page.waitForTimeout(850);
  expect(studyState.testSessions[0].answers["1"]).toBe("The vector sum of all forces.");

  const originalDeadline = studyState.testSessions[0].deadlineAt;
  await page.reload();
  await clickNav(page, "Study and Evaluate");
  await expect(page.locator(".study-test-timer")).toBeVisible();
  expect(studyState.testSessions[0].deadlineAt).toBe(originalDeadline);
  await page.getByRole("button", { name: "Submit for evaluation" }).click();
  await expect(page.locator(".study-test-closed")).toContainText("Submitted for evaluation");
  await page.getByRole("button", { name: "Evaluate my test" }).click();
  await expect(page.locator(".study-test-result")).toContainText("Your result");
  await expect(page.locator(".study-test-result")).toContainText("4 / 6");
  await expect(page.locator(".study-result-question")).toHaveCount(2);
  await expect(page.locator(".study-test-result")).toContainText("Applying Newton's second law");
  await expect(page.locator(".study-test-result")).toContainText("Practise one force calculation");
  await expect(page.getByRole("button", { name: "Review corrections" })).toBeVisible();
  expect(studyState.todayPlan.items[0].workflow_status).toBe("completed");
  expect(await page.locator("#view-study").innerText()).not.toMatch(/\b(provider|model|token|storage|database|backend|vector|embedding|chunks?|debug|OAuth scope)\b/i);

  await page.unroute("**/api/study/tests/**");
  await page.unroute("**/api/study/test");
  await page.unroute("**/api/study/material");
  await page.unroute("**/api/study/status");
  await page.unroute("**/api/bootstrap");
});

test("profile menu is accessible, flat, and navigates to Account", async ({ page }) => {
  await prepareLocalWorkspace();
  await page.goto(baseUrl);
  const trigger = page.locator("#profile-menu-trigger");
  const menu = page.locator("#profile-menu");

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("E2E Student");
  await expect(menu).toContainText(/Local preview|studentos\.local/i);
  await expect(menu).toContainText("Plan");
  await expect(menu).toContainText("Credits");
  await expect(menu).toContainText("Rhythm");
  await expect(menu).toContainText("Eligibility");
  await expect(menu.locator(".metric-pill, .student-chip")).toHaveCount(0);
  await expect(page.locator("#profile-account-settings")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("button", { name: "Account settings" }).click();
  await expect(page.locator("#view-title")).toHaveText("Account");
  await expect(menu).toBeHidden();

  await trigger.click();
  await page.locator("#view-title").click();
  await expect(menu).toBeHidden();
  await expect(page.locator("#logout-btn")).toHaveCount(1);
});

test("authenticated profile sign out uses the existing session cleanup path", async ({ page }) => {
  await prepareLocalWorkspace();
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
      auth: { enabled: true, url: "https://example.supabase.co", anonKey: "public-anon-test-key" },
    }),
  }));
  await page.route("**/api/bootstrap", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(bootstrap) }));
  await page.route("**/api/account", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...account,
      user: { ...account.user, email: "qa@studentos.local", authenticated: true, authMode: "supabase_auth" },
    }),
  }));
  await page.route("**/api/classroom/status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(classroom) }));
  let logoutCalls = 0;
  await page.route("https://example.supabase.co/auth/v1/logout", (route) => {
    logoutCalls += 1;
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("studentos.auth.session", JSON.stringify({
      access_token: "profile-menu-test-token",
      user: { email: "qa@studentos.local" },
    }));
  });

  await page.goto(baseUrl);
  await expect(page.locator("#app-shell")).toBeVisible();
  await page.locator("#profile-menu-trigger").click();
  await expect(page.locator("#profile-email")).toHaveText("qa@studentos.local");
  await expect(page.locator("#logout-btn")).toBeVisible();
  await page.locator("#logout-btn").click();
  await expect(page.locator("#profile-menu")).toBeHidden();
  await expect(page.locator("#public-auth-shell")).toBeVisible();
  await expect.poll(() => logoutCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("studentos.auth.session"))).toBeNull();
});

test("responsive surfaces, account menu, and AI drawer avoid horizontal overflow", async ({ page }) => {
  test.setTimeout(120_000);
  await prepareLocalWorkspace();
  const viewports = [
    { width: 1680, height: 945 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
    { width: 900, height: 900 },
    { width: 430, height: 932 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ];
  const views = ["Today", "Setup", "Courses", "Academic Context", "Study and Evaluate", "Studio", "Account"];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(baseUrl);
    await expect(page.locator("#public-auth-shell")).toBeHidden();

    for (const view of views) {
      await clickNav(page, view);
      await expectNoHorizontalOverflow(page, `${viewport.width}x${viewport.height} ${view}`);
      if (view === "Account" && [1440, 390].includes(viewport.width)) {
        const rows = page.locator("#consent-form .consent-option");
        const rowGeometry = await rows.evaluateAll((options) => options.map((option) => {
          const checkbox = option.querySelector('input[type="checkbox"]')?.getBoundingClientRect();
          const copy = option.querySelector("span")?.getBoundingClientRect();
          const row = option.getBoundingClientRect();
          return checkbox && copy ? {
            checkboxTop: checkbox.top,
            copyTop: copy.top,
            checkboxLeft: checkbox.left,
            copyHeight: copy.height,
            rowTop: row.top,
            rowBottom: row.bottom,
          } : null;
        }));
        expect(rowGeometry.every((item) => item && Math.abs(item.checkboxTop - item.copyTop) <= 4)).toBe(true);
        expect(new Set(rowGeometry.map((item) => Math.round(item.checkboxLeft))).size).toBe(1);
        expect(rowGeometry.slice(1).every((item, index) => item.rowTop >= rowGeometry[index].rowBottom - 1)).toBe(true);
        if (viewport.width === 390) expect(rowGeometry[2].copyHeight).toBeGreaterThan(30);

        const preferenceInputs = page.locator("#consent-form input[type='checkbox']");
        const before = await preferenceInputs.evaluateAll((inputs) => inputs.map((input) => input.checked));
        await rows.nth(1).locator("span").click();
        const after = await preferenceInputs.evaluateAll((inputs) => inputs.map((input) => input.checked));
        expect(after.filter((value, index) => value !== before[index])).toHaveLength(1);
        await rows.nth(1).locator("span").click();
        await page.getByRole("button", { name: "Save preferences" }).focus();
        await page.keyboard.press("Shift+Tab");
        await expect(preferenceInputs.nth(2)).toBeFocused();
        const focusStyle = await preferenceInputs.nth(2).evaluate((input) => {
          const style = getComputedStyle(input);
          return { outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle };
        });
        expect(focusStyle.outlineStyle).not.toBe("none");
        expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0);
      }
      if (view === "Academic Context" && viewport.width <= 768) {
        const stacked = await page.evaluate(() => {
          const content = document.querySelector(".academic-context-content-panel")?.getBoundingClientRect();
          const support = document.querySelector(".academic-context-support-column")?.getBoundingClientRect();
          return Boolean(content && support && support.top >= content.bottom - 1);
        });
        expect(stacked, `${viewport.width}px Academic Context support column should stack after included work`).toBe(true);
        await page.locator("#source-submit-button").scrollIntoViewIfNeeded();
        const overlapsLauncher = await page.evaluate(() => {
          const submit = document.querySelector("#source-submit-button")?.getBoundingClientRect();
          const launcher = document.querySelector("#ai-launcher")?.getBoundingClientRect();
          if (!submit || !launcher) return false;
          return submit.left < launcher.right && submit.right > launcher.left && submit.top < launcher.bottom && submit.bottom > launcher.top;
        });
        expect(overlapsLauncher, `${viewport.width}px Ask StudentOS launcher should not cover upload`).toBe(false);
      }
      await openAiDrawer(page);
      await expectAiDrawerWithinViewport(page, `${viewport.width}px ${view}`);
      await closeAiDrawer(page);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("#profile-menu-trigger").click();
    await expect(page.locator("#profile-menu")).toBeVisible();
    const menuBounds = await page.locator("#profile-menu").evaluate((element) => {
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
    expect(menuBounds.left, `${viewport.width}x${viewport.height} menu bounds ${JSON.stringify(menuBounds)}`).toBeGreaterThanOrEqual(0);
    expect(menuBounds.right, `${viewport.width}x${viewport.height} menu bounds ${JSON.stringify(menuBounds)}`).toBeLessThanOrEqual(menuBounds.viewportWidth);
    expect(menuBounds.top, `${viewport.width}x${viewport.height} menu bounds ${JSON.stringify(menuBounds)}`).toBeGreaterThanOrEqual(0);
    expect(menuBounds.bottom, `${viewport.width}x${viewport.height} menu bounds ${JSON.stringify(menuBounds)}`).toBeLessThanOrEqual(menuBounds.viewportHeight);
    await expectNoHorizontalOverflow(page, `${viewport.width}x${viewport.height} account menu`);
    await page.keyboard.press("Escape");

    await page.evaluate(() => { window.location.hash = "pricing"; });
    await expect(page.locator("#view-title")).toHaveText("Account");
    await expect(page.locator("#pricing")).toBeVisible();
    await expectNoHorizontalOverflow(page, `${viewport.width}x${viewport.height} pricing`);
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

  let signupRedirect = "";
  await page.route("https://example.supabase.co/auth/v1/signup**", async (route) => {
    signupRedirect = new URL(route.request().url()).searchParams.get("redirect_to") || "";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ user: { id: "signup-test-user", email: "qa@studentos.local" } }),
    });
  });
  await page.locator("#auth-email").fill("qa@studentos.local");
  await page.locator("#auth-password").fill("studentos-test-password");
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page.locator("#auth-session")).toContainText("Check your email");
  expect(signupRedirect).toBe(`${baseUrl}/auth/callback`);
  expect(signupRedirect).not.toContain("localhost:3000");
  await page.unroute("https://example.supabase.co/auth/v1/signup**");

  await page.evaluate(() => { window.location.hash = "login"; });
  await expect(page.locator("#auth-shell-title")).toHaveText("Welcome back");
  await page.locator("#auth-email").fill("qa@studentos.local");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.locator("#auth-message")).toContainText("If an account exists for this email, a reset link has been sent. Please check your inbox.");
  await expect(page.locator("#auth-message")).not.toContainText("Supabase Auth Project");
  await expect(page.locator("#auth-message")).not.toContainText("reset email requested");
  await expect(page.locator("#auth-message")).not.toContainText("protected request");
  await expectNoVisibleExternalBranding(page, "public auth reset");
  await page.evaluate(() => { window.location.hash = "signup"; });
  await expect(page.locator("#auth-shell-title")).toHaveText("Create your StudentOS account");

  await page.evaluate(() => {
    sessionStorage.setItem("studentos.auth.session", JSON.stringify({
      access_token: "local-test-token",
      user: { email: "qa@studentos.local" },
    }));
  });
  await page.goto(baseUrl);
  await expect(page.locator("#public-auth-shell")).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const setup = document.getElementById("product-flow-shell");
    const app = document.getElementById("app-shell");
    return Boolean((setup && !setup.hidden) || (app && !app.hidden));
  })).toBe(true);
});

test("verification callbacks capture the session and start new-user setup", async ({ page }) => {
  const [config, bootstrap] = await Promise.all([
    fetch(`${baseUrl}/api/config`).then((response) => response.json()),
    fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json()),
  ]);
  const newUserState = {
    ...bootstrap,
    courses: [{ id: "stale_demo_course", title: "Stale demo course" }],
    roadmap: [{ id: "stale_demo_roadmap", title: "Stale demo roadmap" }],
    productLifecycle: {
      version: 1,
      state: "signed_up",
      selectedPlanId: null,
      onboarding: { currentStep: "about_you", completedSteps: [], answers: {}, completedStepCount: 0, progressPercent: 0 },
      nextStep: "about_you",
      derivedNextStep: "about_you",
      canGoPrevious: false,
      paymentMethodVerified: false,
      legalConsentComplete: false,
      workspaceReady: false,
      dashboardActive: false,
    },
  };
  const authorizationHeaders = [];
  let accountCalls = 0;
  await page.route("**/api/config", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...config,
      auth: {
        enabled: true,
        url: "https://example.supabase.co",
        anonKey: "public-anon-test-key",
        signupRedirectPath: "/auth/callback",
      },
    }),
  }));
  await page.route("**/api/bootstrap", (route) => {
    authorizationHeaders.push(route.request().headers().authorization || "");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(newUserState) });
  });
  await page.route("**/api/account", (route) => {
    accountCalls += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({}) });
  });

  const variants = [
    `/#access_token=callback-token-root&refresh_token=refresh-root&type=signup`,
    `/auth/callback#access_token=callback-token-hash&refresh_token=refresh-hash&type=signup`,
    `/auth/callback?access_token=callback-token-query&refresh_token=refresh-query&type=signup`,
  ];
  await page.goto(baseUrl);
  await page.evaluate(() => sessionStorage.removeItem("studentos.auth.session"));
  for (const [index, variant] of variants.entries()) {
    await page.goto(`${baseUrl}${variant}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#product-flow-shell"), `callback variant ${variant}`).toBeVisible();
    await expect(page.locator("#app-shell")).toBeHidden();
    await expect(page.getByRole("heading", { name: "What is your name?" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Stale demo course");
    await expect(page.locator("body")).not.toContainText("Stale demo roadmap");
    await expect(page.locator("body")).not.toContainText("Plan Free");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    expect(page.url()).not.toContain("access_token");
    if (index < variants.length - 1) {
      await page.evaluate(() => sessionStorage.removeItem("studentos.auth.session"));
    }
  }
  expect(authorizationHeaders).toHaveLength(3);
  expect(authorizationHeaders.every((header) => header.startsWith("Bearer callback-token-"))).toBe(true);
  expect(accountCalls).toBe(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "What is your name?" })).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();
});

test("authenticated bootstrap without lifecycle data fails closed", async ({ page }) => {
  const [config, bootstrap] = await Promise.all([
    fetch(`${baseUrl}/api/config`).then((response) => response.json()),
    fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json()),
  ]);
  const { productLifecycle: ignoredLifecycle, ...missingLifecycleState } = bootstrap;
  await page.addInitScript(() => {
    sessionStorage.setItem("studentos.auth.session", JSON.stringify({
      access_token: "missing-lifecycle-session",
      user: { email: "new@student.example" },
    }));
  });
  await page.route("**/api/config", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...config,
      auth: { enabled: true, url: "https://example.supabase.co", anonKey: "public-anon-test-key" },
    }),
  }));
  await page.route("**/api/bootstrap", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(missingLifecycleState),
  }));

  await page.goto(baseUrl);
  await expect(page.locator("#public-auth-shell")).toBeHidden();
  await expect(page.locator("#product-flow-shell")).toBeVisible();
  await expect(page.locator("#app-shell")).toBeHidden();
  await expect(page.locator("#product-flow-content")).toContainText("workspace will stay closed");
  await expect(page.locator("body")).not.toContainText("Plan Free");
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
