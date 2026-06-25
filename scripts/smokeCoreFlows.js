import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";

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

    const account = await request(baseUrl, "/api/account");
    assert.equal(account.user.authMode, "local_demo");
    assert.equal(account.secretsPrinted, false);

    const reset = await request(baseUrl, "/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "smoke@studentos.local" }),
    });
    assert.equal(reset.mode, "local_preview");

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
    const courseId = bootstrap.courses[0].id;
    const topicId = bootstrap.topics[0].id;
    const assignmentId = bootstrap.assignments[0].id;

    const form = new FormData();
    form.set("courseId", courseId);
    form.set("title", "Smoke source note");
    form.set("file", new Blob(["Quadratics use factoring, graphing, roots, and vertex form for exam questions."], { type: "text/plain" }), "smoke-source.txt");
    const upload = await request(baseUrl, "/api/sources/upload", {
      method: "POST",
      body: form,
    });
    assert(["indexed", "ready"].includes(upload.material.status));
    assert(upload.chunkCount >= 1);

    const sourceStatus = await request(baseUrl, "/api/sources/status");
    assert(sourceStatus.sources.some((source) => source.id === upload.material.id));

    for (const verb of ["Ask", "Plan", "Make", "Review"]) {
      const ai = await request(baseUrl, "/api/ai/verb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verb, message: "Use the uploaded quadratics note for a short response." }),
      });
      assert.equal(ai.verb, verb);
      assert(ai.response || ai.answer || ai.output || ai.content);
    }

    const score = await request(baseUrl, "/api/tests/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, scorePercent: 82, answers: [{ isCorrect: true, concept: "Quadratics" }] }),
    });
    assert.equal(score.result.creditsAwarded, 2);
    assert.equal(score.creditEntry.amount, 2);

    const flow = await request(baseUrl, "/api/assignment-flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });
    assert(flow.flow.action);
    assert.equal(flow.flow.realSubmissionAllowed, false);

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
    assertNoClassroomInternals("/api/classroom/sync connector", classroomSync.connector);
    assert.equal(Object.hasOwn(classroomSync.syncRun || {}, "payload"), false);

    bootstrap = await request(baseUrl, "/api/bootstrap");
    const classroomAssignment = bootstrap.assignments.find((assignment) => assignment.source === "google_classroom") || bootstrap.assignments[0];
    const classroomFlow = await request(baseUrl, "/api/assignment-flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId: classroomAssignment.id }),
    });
    assert(classroomFlow.flow.action);
    assert.equal(classroomFlow.flow.studentReviewRequired, true);

    const exportRequest = await request(baseUrl, "/api/account/export-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "student_owned_data" }),
    });
    assert.equal(exportRequest.request.status, "queued");

    const billing = await request(baseUrl, "/api/billing/status");
    assert(billing.plan || billing.subscription || billing.quota);

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
