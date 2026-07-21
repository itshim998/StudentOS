import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const userA = { id: "user-answer-owner", email: "owner@studentos.test" };
const userB = { id: "user-answer-other", email: "other@studentos.test" };
const sessionId = "22222222-2222-4222-8222-222222222222";
const expectedAnswers = {
  "1": "Net force is the vector sum of every force.",
  "2": "Newton's second law relates net force, mass, and acceleration.",
};

let child;
let baseUrl;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  listener.close();
  await once(listener, "close");
  return port;
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Study-test hotfix E2E server did not start.");
}

async function openStudy(page) {
  await page.getByRole("button", { name: "Study and Evaluate", exact: true }).click();
  await expect(page.locator("#view-title")).toHaveText("Study and Evaluate");
}

function authSession(user) {
  return { access_token: `test-token-${user.id}`, token_type: "bearer", user };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["backend/server.js"], {
    cwd: root,
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
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  await waitForHealth();
});

test.afterAll(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(1_500)]).catch(() => {});
  if (child.exitCode === null) child.kill("SIGKILL");
});

test("preserves every typed answer through failed PATCH, refresh, retry, finish, and evaluation", async ({ page }) => {
  const [baseState, baseConfig] = await Promise.all([
    fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json()),
    fetch(`${baseUrl}/api/config`).then((response) => response.json()),
  ]);
  const today = new Date().toLocaleDateString("en-CA");
  const testSession = {
    id: sessionId,
    todoItemId: "todo_answer_preservation",
    courseId: "course_answer_preservation",
    status: "in_progress",
    testPaper: {
      test_title: "Forces check",
      course: "Physics",
      topic: "Forces",
      total_marks: 6,
      estimated_minutes: 20,
      instructions: ["Answer every question.", "Show your reasoning."],
      questions: [
        { question_number: 1, type: "short_answer", prompt: "Define net force.", marks: 2 },
        { question_number: 2, type: "long_answer", prompt: "Explain Newton's second law.", marks: 4 },
      ],
    },
    answerMode: "typed",
    answers: {},
    durationMinutes: 20,
    startedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    lastSavedAt: null,
    academicContextIncluded: true,
  };
  const serverState = {
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
    },
    planAccess: { ...(baseState.planAccess || {}), activePlanKey: "starter", dashboardAccess: true },
    courses: [{ id: "course_answer_preservation", title: "Physics", source: "manual", academicContextIncluded: true }],
    todayPlan: {
      date: today,
      generated_at: new Date().toISOString(),
      summary: "Complete the active Physics check.",
      items: [{
        id: "todo_answer_preservation",
        title: "Review forces",
        related_course: "Physics",
        related_context: "Forces",
        reason: "Confirm this topic before the exam.",
        time_hint: "20 minutes",
        priority: "high",
        study_status: "done",
      }],
    },
    testSessions: [testSession],
  };

  let patchAvailable = false;
  let finishAvailable = false;
  let evaluationAvailable = false;
  let successfulFinishCount = 0;
  let successfulEvaluationCount = 0;
  const patchBodies = [];
  const finishKeys = [];
  const evaluationKeys = [];

  await page.addInitScript((initialSession) => {
    if (!sessionStorage.getItem("studentos.auth.session")) {
      sessionStorage.setItem("studentos.auth.session", JSON.stringify(initialSession));
    }
  }, authSession(userA));
  await page.route("**/api/config", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...baseConfig, auth: { ...(baseConfig.auth || {}), enabled: false } }),
  }));
  await page.route("**/api/bootstrap", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(serverState),
  }));
  await page.route("**/api/account", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) }));
  await page.route("**/api/classroom/status", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) }));
  await page.route("**/api/study/tests/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "PATCH") {
      patchBodies.push(request.postDataJSON());
      if (!patchAvailable) {
        await route.abort("failed");
        return;
      }
      testSession.answers = { ...request.postDataJSON().answers };
      testSession.lastSavedAt = new Date().toISOString();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ testSession, state: serverState, message: "Answers saved." }),
      });
      return;
    }
    if (pathname.endsWith("/finish")) {
      finishKeys.push(request.headers()["idempotency-key"] || "");
      await delay(120);
      if (!finishAvailable) {
        await route.abort("failed");
        return;
      }
      successfulFinishCount += 1;
      testSession.status = "submitted_pending_evaluation";
      testSession.submittedAt = new Date().toISOString();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ testSession, state: serverState, message: "Submitted for evaluation." }),
      });
      return;
    }
    if (pathname.endsWith("/evaluate")) {
      evaluationKeys.push(request.headers()["idempotency-key"] || "");
      await delay(120);
      if (!evaluationAvailable) {
        await route.abort("failed");
        return;
      }
      successfulEvaluationCount += 1;
      testSession.status = "evaluated";
      testSession.evaluation = {
        total_marks: 6,
        scored_marks: 6,
        percentage: 100,
        question_results: [
          { question_number: 1, marks_awarded: 2, max_marks: 2, feedback: "Correct.", correction: "No correction needed." },
          { question_number: 2, marks_awarded: 4, max_marks: 4, feedback: "Correct.", correction: "No correction needed." },
        ],
        strengths: ["Clear reasoning"],
        weak_topics: [],
        next_steps: ["Continue to the next topic"],
        short_revision_plan: "Review once before the exam.",
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ evaluated: true, testSession, evaluation: testSession.evaluation, state: serverState, message: "Your result is ready." }),
      });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ testSession, state: serverState }) });
  });

  await page.goto(baseUrl);
  await openStudy(page);
  const firstAnswer = page.locator('[data-study-test-answer="1"]');
  const secondAnswer = page.locator('[data-study-test-answer="2"]');
  await firstAnswer.fill(expectedAnswers["1"]);
  await secondAnswer.fill(expectedAnswers["2"]);

  await page.locator(".study-queue-item").click();
  await expect(page.locator('[data-study-test-answer="1"]')).toHaveValue(expectedAnswers["1"]);
  await expect(page.locator('[data-study-test-answer="2"]')).toHaveValue(expectedAnswers["2"]);

  await expect(page.locator("[data-study-test-save-state]")).toContainText("Your answers remain on this device", { timeout: 3_000 });
  expect(patchBodies.length).toBeGreaterThan(0);
  expect(patchBodies.at(-1).answers).toEqual(expectedAnswers);

  await page.getByRole("button", { name: "Submit for evaluation" }).click();
  await expect(page.locator("[data-study-test-recovery]")).toBeVisible();
  await expect(page.locator("[data-study-test-recovery]")).toContainText("They are still on this device");
  await expect(page.locator('[data-study-test-answer="1"]')).toHaveValue(expectedAnswers["1"]);
  await expect(page.locator('[data-study-test-answer="2"]')).toHaveValue(expectedAnswers["2"]);
  await expect(page.locator("body")).not.toContainText(/Failed to fetch|CORS|PATCH|backend|server stack/i);
  expect(finishKeys).toHaveLength(0);
  expect(patchBodies.at(-1).answers).toEqual(expectedAnswers);

  const draftPrefixA = `studentos.study-test-draft.v1:${encodeURIComponent(userA.id)}:`;
  await expect.poll(() => page.evaluate((prefix) => [...Array(sessionStorage.length)].map((_, index) => sessionStorage.key(index)).filter((key) => key?.startsWith(prefix)).length, draftPrefixA)).toBe(1);

  await page.reload();
  await openStudy(page);
  await expect(page.locator('[data-study-test-answer="1"]')).toHaveValue(expectedAnswers["1"]);
  await expect(page.locator('[data-study-test-answer="2"]')).toHaveValue(expectedAnswers["2"]);

  await page.evaluate((nextSession) => sessionStorage.setItem("studentos.auth.session", JSON.stringify(nextSession)), authSession(userB));
  await page.reload();
  await openStudy(page);
  await expect(page.locator('[data-study-test-answer="1"]')).toHaveValue("");
  await expect(page.locator('[data-study-test-answer="2"]')).toHaveValue("");

  await page.evaluate((nextSession) => sessionStorage.setItem("studentos.auth.session", JSON.stringify(nextSession)), authSession(userA));
  await page.reload();
  await openStudy(page);
  await expect(page.locator('[data-study-test-answer="1"]')).toHaveValue(expectedAnswers["1"]);
  await expect(page.locator('[data-study-test-answer="2"]')).toHaveValue(expectedAnswers["2"]);

  patchAvailable = true;
  const submitButton = page.getByRole("button", { name: "Submit for evaluation" });
  expect(await submitButton.evaluate((button) => {
    button.click();
    const disabled = button.disabled;
    button.click();
    return disabled;
  })).toBe(true);
  await expect(page.locator("[data-study-test-recovery]")).toBeVisible();
  expect(finishKeys).toHaveLength(1);
  expect(successfulFinishCount).toBe(0);

  finishAvailable = true;
  const retryFinish = page.getByRole("button", { name: "Try submission again" });
  expect(await retryFinish.evaluate((button) => {
    button.click();
    const disabled = button.disabled;
    button.click();
    return disabled;
  })).toBe(true);
  await expect(page.locator(".study-test-closed")).toBeVisible();
  expect(successfulFinishCount).toBe(1);
  expect(new Set(finishKeys).size).toBe(1);
  expect(patchBodies.at(-1).answers).toEqual(expectedAnswers);
  await expect.poll(() => page.evaluate((prefix) => [...Array(sessionStorage.length)].map((_, index) => sessionStorage.key(index)).some((key) => key?.startsWith(prefix)), draftPrefixA)).toBe(false);

  const evaluateButton = page.getByRole("button", { name: "Evaluate my test" });
  expect(await evaluateButton.evaluate((button) => {
    button.click();
    const disabled = button.disabled;
    button.click();
    return disabled;
  })).toBe(true);
  await expect(page.locator("[data-study-test-action-recovery]")).toBeVisible();
  await expect(page.locator("[data-study-test-action-recovery]")).toContainText("Your answers are safe");
  expect(successfulEvaluationCount).toBe(0);

  evaluationAvailable = true;
  const retryEvaluation = page.getByRole("button", { name: "Retry evaluation" });
  expect(await retryEvaluation.evaluate((button) => {
    button.click();
    const disabled = button.disabled;
    button.click();
    return disabled;
  })).toBe(true);
  await expect(page.locator(".study-test-result")).toContainText("6 / 6");
  expect(successfulEvaluationCount).toBe(1);
  expect(new Set(evaluationKeys).size).toBe(1);
  await expect(page.locator("body")).not.toContainText(/Failed to fetch|CORS|PATCH|backend|server stack/i);

  const dummyDraftKey = `${draftPrefixA}signout-check`;
  await page.evaluate((key) => sessionStorage.setItem(key, JSON.stringify({ version: 1 })), dummyDraftKey);
  await page.locator("#logout-btn").evaluate((button) => button.click());
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), dummyDraftKey)).toBeNull();
});
