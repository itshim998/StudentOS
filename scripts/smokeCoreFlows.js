import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { buildPdfFixtureBuffer } from "../tests/e2e/fixtures/pdfFixture.js";

const ROOT = new URL("..", import.meta.url);
const SECRET_PATTERNS = [
  /service[_-]?role/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
  /google_client_secret/i,
  /groq_api_key/i,
  /supabase_service_role/i,
  /studentos_google_classroom_token_encryption_secret/i,
];

function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(access[_-]?token|refresh[_-]?token|service[_-]?role|client[_-]?secret|api[_-]?key)([=:]\s*)[^\s"']+/gi, "$1$2[redacted]")
    .slice(0, 2000);
}

function assertNoSensitiveOutput(label, value) {
  const text = JSON.stringify(value || {});
  for (const pattern of SECRET_PATTERNS) {
    assert.equal(pattern.test(text), false, `${label} exposed sensitive field matching ${pattern}`);
  }
}

function assertNoClassroomInternals(label, connector = {}) {
  assert.equal(Object.hasOwn(connector, "scopes"), false, `${label} exposed Classroom scopes`);
  assert.equal(Object.hasOwn(connector, "tokenMetadata"), false, `${label} exposed Classroom token metadata`);
  assert.equal(Object.hasOwn(connector, "tokenPersistence"), false, `${label} exposed Classroom token storage mode`);
  assert.equal(Object.hasOwn(connector, "tokenEncryptionConfigured"), false, `${label} exposed Classroom token encryption config`);
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

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, child, logs) {
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
  throw new Error(`StudentOS smoke server did not become ready. Logs: ${redact(logs.join("\n"))}`);
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed ${response.status}: ${redact(JSON.stringify(payload))}`);
  }
  assertNoSensitiveOutput(path, payload);
  return payload;
}

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["backend/server.js"], {
    cwd: new URL(".", ROOT),
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
  child.stdout.on("data", (chunk) => logs.push(redact(chunk)));
  child.stderr.on("data", (chunk) => logs.push(redact(chunk)));

  try {
    await waitForServer(baseUrl, child, logs);

    const health = await request(baseUrl, "/api/health");
    assert.equal(health.ok, true);
    assert.equal(health.sourceSystemsReadOnly, true);

    const config = await request(baseUrl, "/api/config");
    assert.equal(config.pass, "30");
    assert.equal(config.auth.enabled, false);
    assert.equal(config.classroom.writeScopesEnabled, false);
    assertNoClassroomInternals("/api/config classroom", config.classroom);
    assert.equal(config.realSubmissionEnabled, false);
    assert.deepEqual(config.billing.plans.map((plan) => plan.priceMonthlyInr), [99, 159, 259, 549]);
    assert.equal(config.billing.plans.find((plan) => plan.planKey === "essential")?.recommended, true);
    assert.equal(config.billing.trialMode.planKey, "trial");
    assert.doesNotMatch(
      JSON.stringify(config.billing.plans),
      /storage|tokens?|models?|providers?|backend|supabase|groq|gemini|pollinations|vectors?|embeddings?|chunks?/i,
    );

    const account = await request(baseUrl, "/api/account");
    assert.equal(account.user.authMode, "local_preview");
    assert.equal(account.secretsPrinted, false);
    assert.equal(account.planAccess.plan.access.assignmentWritebackEnabled, false);
    assert.equal("usage" in account.planAccess, false);
    assert.equal("quotas" in account.planAccess, false);

    const reset = await request(baseUrl, "/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "smoke@studentos.local" }),
    });
    assert.equal(reset.mode, "local_preview");

    const productAction = (action, payload = {}) => request(baseUrl, "/api/product-flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    await productAction("save_onboarding_step", { step: "about_you", answers: { displayName: "Smoke Student" } });
    await productAction("save_onboarding_step", { step: "education_system", answers: { level: "Grade 10", stream: "Science" } });
    await productAction("select_plan", { planId: "starter" });
    await productAction("choose_access", { accessMode: "paid_plan" });
    await productAction("verify_payment_method_placeholder");
    await productAction("complete_legal", {
      ageGate: "adult",
      consents: Object.fromEntries([
        "termsOfService", "privacyPolicy", "trialBilling", "trialLimits", "paymentMandate",
        "cancellationWindow", "academicDataUse", "noOutcomeGuarantee", "responsibleUse", "aiAccuracy",
      ].map((key) => [key, true])),
    });
    await productAction("save_onboarding_step", { step: "daily_schedule", answers: { schedule: "Weekdays after 6 PM" } });
    await productAction("save_onboarding_step", { step: "exam_pattern", answers: { examPattern: "Monthly tests and a semester exam" } });
    await productAction("save_onboarding_step", { step: "academic_context", answers: { subjects: "Mathematics|2026-07-01|Quadratics, Trigonometry\nPhysics|2026-07-04|Motion graphs" } });
    await productAction("choose_classroom_path", { choice: "manual" });
    await productAction("save_materials", { materialIds: [], materialLabels: [] });
    await productAction("confirm_setup_summary");
    await productAction("prepare_workspace");
    await productAction("choose_tutorial", { choice: "skip" });

    const onboarding = await request(baseUrl, "/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "Smoke Student",
        stream: "Science",
        classLevel: "Grade 10",
        academicGoal: "exam_prep",
        dailyStudyAvailabilityMinutes: 90,
        studyBreakPattern: "25/5",
        subjectsText: "Mathematics|2026-07-01|Quadratics, Trigonometry\nPhysics|2026-07-04|Motion graphs",
        weakTopicsText: "Mathematics: Trigonometry",
        completedTopicsText: "Mathematics: Quadratics",
        timetableText: "Mon|18:00|Math review|Mathematics",
      }),
    });
    assert(onboarding.state.courses.length >= 2);

    let bootstrap = await request(baseUrl, "/api/bootstrap");
    assert.equal(bootstrap.planAccess.selectedPlanKey, "starter");
    assert.equal(bootstrap.planAccess.activePlanKey, "starter");
    assert.equal(bootstrap.planAccess.entitlements.assignmentWritebackEnabled, false);
    const courseId = bootstrap.courses[0].id;
    const topicId = bootstrap.topics[0].id;
    assert.equal(bootstrap.assignments.length, 0, "fresh workspaces must not contain placeholder assignments");

    const form = new FormData();
    form.set("artifactKind", "material");
    form.set("courseId", courseId);
    form.set("title", "Smoke source note");
    form.set("file", new Blob([
      buildPdfFixtureBuffer("Quadratics use factoring, graphing, roots, and vertex form for exam questions."),
    ], { type: "application/pdf" }), "smoke-source.pdf");
    const upload = await request(baseUrl, "/api/sources/upload", {
      method: "POST",
      body: form,
    });
    assert(["indexed", "ready"].includes(upload.material.status));
    assert(upload.chunkCount >= 1);

    const sourceStatus = await request(baseUrl, "/api/sources/status");
    assert(sourceStatus.sources.some((source) => source.id === upload.material.id));

    const assignmentForm = new FormData();
    assignmentForm.set("artifactKind", "assignment");
    assignmentForm.set("courseId", courseId);
    assignmentForm.set("title", "Smoke assignment PDF");
    assignmentForm.set("deadline", "2026-12-01");
    assignmentForm.set("file", new Blob([
      buildPdfFixtureBuffer("Complete the smoke assignment before its deadline."),
    ], { type: "application/pdf" }), "smoke-assignment.pdf");
    const assignmentUpload = await request(baseUrl, "/api/sources/upload", {
      method: "POST",
      body: assignmentForm,
    });
    assert.equal(assignmentUpload.assignment.title, "Smoke assignment PDF");
    assert.equal(assignmentUpload.assignment.courseId, courseId);
    assert.equal(assignmentUpload.assignment.dueDate, "2026-12-01");
    assert.equal(assignmentUpload.assignment.handedIn, false);
    assert(assignmentUpload.state.assignments.some((assignment) => assignment.id === assignmentUpload.assignment.id));

    for (const verb of ["Ask", "Plan", "Make", "Review"]) {
      const ai = await request(baseUrl, "/api/ai/verb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verb, message: "Use the uploaded quadratics note for a short response." }),
      });
      assert.equal(ai.verb, verb);
      assert(ai.response || ai.answer || ai.output || ai.content);
    }

    const deletedMaterial = await request(
      baseUrl,
      `/api/academic-context/items/${encodeURIComponent(upload.material.id)}?kind=material`,
      { method: "DELETE" },
    );
    assert.equal(deletedMaterial.hardDeleted, true);
    assert.equal(deletedMaterial.classroomUnchanged, true);
    assert.equal(deletedMaterial.state.sourceMaterials.some((source) => source.id === upload.material.id), false);
    const deletedAssignment = await request(
      baseUrl,
      `/api/academic-context/items/${encodeURIComponent(assignmentUpload.assignment.id)}?kind=assignment`,
      { method: "DELETE" },
    );
    assert.equal(deletedAssignment.hardDeleted, true);
    assert.equal(deletedAssignment.state.assignments.some((assignment) => assignment.id === assignmentUpload.assignment.id), false);

    const score = await request(baseUrl, "/api/tests/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, scorePercent: 82, answers: [{ isCorrect: true, concept: "Quadratics" }] }),
    });
    assert.equal(score.result.creditsAwarded, 2);
    assert.equal(score.creditEntry.amount, 2);

    const classroomStatus = await request(baseUrl, "/api/classroom/status");
    assert.equal(classroomStatus.readOnly, true);
    assert.equal(classroomStatus.writebackEnabled, false);
    assertNoClassroomInternals("/api/classroom/status connector", classroomStatus.connector);

    const classroomSync = await request(baseUrl, "/api/classroom/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(classroomSync.connector.writeScopesEnabled, false);
    assert.equal(classroomSync.writebackEnabled ?? false, false);
    assert.equal(classroomSync.summary.courseOnly, true);
    assert.equal(classroomSync.state.classroomItems.length, 0);
    assertNoClassroomInternals("/api/classroom/sync connector", classroomSync.connector);
    assert.equal(Object.hasOwn(classroomSync.syncRun || {}, "payload"), false);

    bootstrap = await request(baseUrl, "/api/bootstrap");
    assert.equal(bootstrap.assignments.length, 0, "Classroom preview must not invent assignments");

    const exportRequest = await request(baseUrl, "/api/account/export-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "student_owned_data" }),
    });
    assert.equal(exportRequest.request.status, "queued");

    const billing = await request(baseUrl, "/api/billing/status");
    assert(billing.plan || billing.subscription || billing.quota);
    assert.equal(billing.entitlements.access.assignmentWritebackEnabled, false);
    assert.equal("quotas" in billing.entitlements, false);
    assert.equal("features" in billing.entitlements, false);

    const status = await request(baseUrl, "/api/status");
    assert.equal(status.secretsPrinted, false);
    assert(status.workerQueue);

    const combinedLogs = logs.join("\n");
    assertNoSensitiveOutput("server logs", combinedLogs);
    console.log(`PASS | StudentOS core smoke flows passed on ${baseUrl}`);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      delay(1500).then(() => child.kill("SIGKILL")),
    ]).catch(() => {});
  }
}

main().catch((error) => {
  console.error(`FAIL | ${redact(error?.message || error)}`);
  process.exitCode = 1;
});
