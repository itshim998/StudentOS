import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const userA = { id: "result-owner", email: "result-owner@studentos.test" };
const userB = { id: "result-other", email: "result-other@studentos.test" };
const sessionId = "33333333-3333-4333-8333-333333333333";

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
  throw new Error("Study-test result hotfix E2E server did not start.");
}

function authSession(user) {
  return { access_token: `test-token-${user.id}`, token_type: "bearer", user };
}

async function openStudy(page) {
  await page.getByRole("button", { name: "Study and Evaluate", exact: true }).click();
  await expect(page.locator("#view-title")).toHaveText("Study and Evaluate");
}

function evaluatedResult() {
  return {
    total_marks: 10,
    scored_marks: 7,
    percentage: 70,
    question_results: [
      { question_number: 1, marks_awarded: 3, max_marks: 4, feedback: "The definition is accurate.", correction: "Include the direction of each force." },
      { question_number: 2, marks_awarded: 4, max_marks: 6, feedback: "The equation is correct.", correction: "Explain how mass changes acceleration." },
    ],
    strengths: ["Used Newton's second law correctly"],
    weak_topics: ["Force direction"],
    next_steps: ["Practise one free-body diagram"],
    short_revision_plan: "Review both corrections, then draw one fresh force diagram.",
  };
}

function masteryQueue(activeTopicId = "topic_forces") {
  return {
    activeTopicId,
    courseTitle: "Physics",
    examName: "Mechanics test",
    topics: [
      {
        id: "topic_forces",
        order: 1,
        title: "Forces and Newton's laws",
        status: activeTopicId === "topic_forces" ? "studying" : "done",
        subparts: [{ index: 1, title: "Free-body diagrams", status: "done" }],
      },
      {
        id: "topic_momentum",
        order: 2,
        title: "Momentum and impulse",
        status: activeTopicId === "topic_momentum" ? "studying" : "pending",
        subparts: [{ index: 1, title: "Conservation of momentum", status: "pending" }],
      },
    ],
  };
}

function dashboardState(baseState, today) {
  const testSession = {
    id: sessionId,
    todoItemId: "todo_mechanics",
    courseId: "course_physics",
    parentTopicId: "topic_forces",
    parentSyllabusTopic: "Forces and Newton's laws",
    status: "submitted_pending_evaluation",
    generatedAt: "2026-07-21T08:00:00.000Z",
    submittedAt: "2026-07-21T08:30:00.000Z",
    answerMode: "typed",
    answers: { 1: "Net force includes direction.", 2: "F = ma." },
    testPaper: {
      test_title: "Forces and Newton's laws check",
      course: "Physics",
      topic: "Forces and Newton's laws",
      total_marks: 10,
      estimated_minutes: 20,
      instructions: ["Answer both questions."],
      questions: [
        { question_number: 1, type: "short_answer", prompt: "Define net force.", marks: 4 },
        { question_number: 2, type: "long_answer", prompt: "Explain Newton's second law.", marks: 6 },
      ],
    },
  };
  return {
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
    courses: [{ id: "course_physics", title: "Physics", source: "manual", academicContextIncluded: true }],
    todayPlan: {
      date: today,
      generated_at: new Date().toISOString(),
      summary: "Finish the Mechanics sequence.",
      items: [{
        id: "todo_mechanics",
        title: "Prepare Mechanics",
        related_course: "Physics",
        related_context: "Mechanics test",
        reason: "Complete each syllabus topic in order.",
        time_hint: "45 minutes",
        priority: "high",
        study_status: "done",
        test_session_id: sessionId,
        topic_mastery_queue: masteryQueue(),
      }],
    },
    testSessions: [testSession],
    testResults: [],
    recoveryEvents: [],
  };
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

test("pins a multi-topic test result until Continue acknowledges it", async ({ page }) => {
  const [baseState, baseConfig] = await Promise.all([
    fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json()),
    fetch(`${baseUrl}/api/config`).then((response) => response.json()),
  ]);
  const today = new Date().toLocaleDateString("en-CA");
  const serverState = dashboardState(baseState, today);
  const testSession = serverState.testSessions[0];
  const item = serverState.todayPlan.items[0];
  let evaluationRequests = 0;
  let successfulEvaluations = 0;
  let allowanceCharges = 0;
  let failNextEvaluation = true;

  await page.addInitScript((initialSession) => {
    if (!sessionStorage.getItem("studentos.auth.session")) sessionStorage.setItem("studentos.auth.session", JSON.stringify(initialSession));
  }, authSession(userA));
  await page.route("**/api/config", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...baseConfig, auth: { ...(baseConfig.auth || {}), enabled: false } }),
  }));
  await page.route("**/api/bootstrap", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(serverState) }));
  await page.route("**/api/account", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) }));
  await page.route("**/api/classroom/status", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) }));
  await page.route(`**/api/study/tests/${sessionId}/evaluate`, async (route) => {
    evaluationRequests += 1;
    if (failNextEvaluation) {
      failNextEvaluation = false;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ evaluated: false, testSession, state: serverState }),
      });
      return;
    }
    successfulEvaluations += 1;
    allowanceCharges += 1;
    testSession.status = "evaluated";
    testSession.evaluatedAt = "2026-07-21T08:35:00.000Z";
    testSession.evaluation = evaluatedResult();
    item.topic_mastery_queue = masteryQueue("topic_momentum");
    item.study_status = "studying";
    item.workflow_status = "in_progress";
    item.evaluation_completed_at = testSession.evaluatedAt;
    item.test_session_id = testSession.id;
    serverState.testResults.push({ id: "result_forces", testSessionId: testSession.id });
    serverState.recoveryEvents.push({ id: "recovery_forces", testSessionId: testSession.id });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ evaluated: true, testSession: structuredClone(testSession), evaluation: testSession.evaluation, state: serverState, message: "Your result is ready." }),
    });
  });

  await page.goto(baseUrl);
  await openStudy(page);
  await page.locator(".study-queue-item").click();
  await page.getByRole("button", { name: "Evaluate my test" }).click();
  await expect(page.locator("[data-study-test-action-recovery]")).toContainText("Your answers are safe");
  await expect(page.locator(".study-test-closed")).toBeVisible();

  await page.getByRole("button", { name: "Retry evaluation" }).click();
  const result = page.locator(".study-test-result");
  await expect(result).toContainText("Your result");
  await expect(result).toContainText("7 / 10");
  await expect(result).toContainText("70%");
  await expect(result).toContainText("What went well");
  await expect(result).toContainText("What to revise");
  await expect(result).toContainText("Question-by-question feedback");
  await expect(result).toContainText("Include the direction of each force");
  await expect(result).toContainText("Next steps");
  await expect(result).toContainText("Short revision plan");
  await expect(page.locator(".study-material-empty")).toHaveCount(0);
  await expect(page.locator(".study-result-progress")).toContainText("Momentum and impulse");
  expect(await page.locator(".study-workspace-ready").evaluate((workspace) => {
    const resultPanel = workspace.querySelector(".study-test-result");
    const progress = workspace.querySelector(".study-result-progress");
    return Boolean(resultPanel && progress && (resultPanel.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  expect(item.topic_mastery_queue.activeTopicId).toBe("topic_momentum");
  expect(evaluationRequests).toBe(2);
  expect(successfulEvaluations).toBe(1);
  expect(allowanceCharges).toBe(1);

  await page.getByRole("button", { name: "Review corrections" }).click();
  await expect(result).toBeVisible();
  await expect(page.locator(".study-result-questions")).toBeFocused();

  await page.getByRole("button", { name: "Back to Today" }).click();
  await expect(page.locator("#view-title")).toHaveText("Today");
  await openStudy(page);
  await expect(result).toBeVisible();

  await page.reload();
  await openStudy(page);
  await expect(page.locator(".study-test-result")).toContainText("7 / 10");

  const requestsBeforeContinue = evaluationRequests;
  await page.getByRole("button", { name: "Continue Study and Evaluate" }).click();
  await expect(page.locator(".study-test-result")).toHaveCount(0);
  await expect(page.locator(".study-material-empty h4")).toHaveText("Conservation of momentum");
  const acknowledgementKey = `studentos.study-test-result-ack.v1:${encodeURIComponent(userA.id)}:${encodeURIComponent(sessionId)}`;
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), acknowledgementKey)).toBe("acknowledged");
  expect(evaluationRequests).toBe(requestsBeforeContinue);
  expect(successfulEvaluations).toBe(1);
  expect(allowanceCharges).toBe(1);
  expect(serverState.testResults).toHaveLength(1);
  expect(serverState.recoveryEvents).toHaveLength(1);

  await page.reload();
  await openStudy(page);
  await expect(page.locator(".study-test-result")).toHaveCount(0);
  await page.locator(".study-queue-item").click();
  await expect(page.locator(".study-material-empty h4")).toHaveText("Conservation of momentum");

  await page.evaluate((nextSession) => sessionStorage.setItem("studentos.auth.session", JSON.stringify(nextSession)), authSession(userB));
  await page.reload();
  await openStudy(page);
  await expect(page.locator(".study-test-result")).toContainText("7 / 10");
  const otherUserAcknowledgementKey = `studentos.study-test-result-ack.v1:${encodeURIComponent(userB.id)}:${encodeURIComponent(sessionId)}`;
  expect(await page.evaluate((key) => sessionStorage.getItem(key), otherUserAcknowledgementKey)).toBeNull();
});

test("an in-progress session wins over an older evaluated result from another topic", async ({ page }) => {
  const [baseState, baseConfig] = await Promise.all([
    fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json()),
    fetch(`${baseUrl}/api/config`).then((response) => response.json()),
  ]);
  const serverState = dashboardState(baseState, new Date().toLocaleDateString("en-CA"));
  const oldResult = serverState.testSessions[0];
  oldResult.status = "evaluated";
  oldResult.evaluation = evaluatedResult();
  oldResult.evaluatedAt = "2026-07-20T08:35:00.000Z";
  serverState.todayPlan.items[0].topic_mastery_queue = masteryQueue("topic_momentum");
  serverState.testSessions.push({
    ...structuredClone(oldResult),
    id: "44444444-4444-4444-8444-444444444444",
    parentTopicId: "topic_momentum",
    parentSyllabusTopic: "Momentum and impulse",
    status: "in_progress",
    evaluation: undefined,
    evaluatedAt: undefined,
    startedAt: "2026-07-21T09:00:00.000Z",
    deadlineAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    answers: {},
    testPaper: {
      ...structuredClone(oldResult.testPaper),
      test_title: "Momentum and impulse check",
      topic: "Momentum and impulse",
    },
  });

  await page.addInitScript((initialSession) => sessionStorage.setItem("studentos.auth.session", JSON.stringify(initialSession)), authSession(userA));
  await page.route("**/api/config", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...baseConfig, auth: { ...(baseConfig.auth || {}), enabled: false } }),
  }));
  await page.route("**/api/bootstrap", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(serverState) }));
  await page.route("**/api/account", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) }));
  await page.route("**/api/classroom/status", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) }));

  await page.goto(baseUrl);
  await openStudy(page);
  await expect(page.locator(".study-test-attempt")).toHaveAttribute("data-study-test-session", "44444444-4444-4444-8444-444444444444");
  await expect(page.locator(".study-test-attempt")).toContainText("Momentum and impulse check");
  await expect(page.locator(".study-test-result")).toHaveCount(0);
});
