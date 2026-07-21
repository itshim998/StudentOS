import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { finishStudyTestSession } from "./ai/studyTestService.js";

const approvedOrigin = "https://studentos.sentiqlabs.com";
const unapprovedOrigin = "https://unapproved.example";

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  listener.close();
  await once(listener, "close");
  return port;
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(url, {
        method: "OPTIONS",
        headers: { Origin: approvedOrigin, "Access-Control-Request-Method": "PATCH" },
      });
      if (response.status === 204) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Hotfix CORS test server did not start.");
}

async function preflight(baseUrl, path, method, origin = approvedOrigin) {
  return fetch(`${baseUrl}${path}`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
    },
  });
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["backend/server.js"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    STUDENTOS_MODE: "mock",
    STUDENTOS_ENV: "production",
    NODE_ENV: "production",
    STUDENTOS_PORT: String(port),
    PORT: String(port),
    CORS_ORIGINS: approvedOrigin,
    STUDENTOS_RATE_LIMIT_ENABLED: "false",
  },
  stdio: ["ignore", "ignore", "ignore"],
});

try {
  await waitForServer(`${baseUrl}/api/health`, child);

  const patch = await preflight(baseUrl, "/api/study/tests/test-session", "PATCH");
  assert.equal(patch.status, 204);
  assert.equal(await patch.text(), "");
  assert.equal(patch.headers.get("access-control-allow-origin"), approvedOrigin);
  assert.match(patch.headers.get("vary") || "", /\bOrigin\b/i);
  const methods = new Set((patch.headers.get("access-control-allow-methods") || "").split(",").map((value) => value.trim()));
  assert.deepEqual(methods, new Set(["GET", "POST", "PATCH", "DELETE", "OPTIONS"]));
  for (const header of ["Content-Type", "Authorization", "Idempotency-Key", "X-StudentOS-Internal-Token"]) {
    assert.match(patch.headers.get("access-control-allow-headers") || "", new RegExp(header, "i"));
  }

  for (const method of ["GET", "POST", "DELETE"]) {
    const response = await preflight(baseUrl, "/api/health", method);
    assert.equal(response.status, 204);
    assert(methods.has(method));
  }

  const examPatch = await preflight(baseUrl, "/api/academic-context/exams/exam-1", "PATCH");
  assert.equal(examPatch.status, 204);
  assert.match(examPatch.headers.get("access-control-allow-methods") || "", /\bPATCH\b/);

  const rejected = await preflight(baseUrl, "/api/study/tests/test-session", "PATCH", unapprovedOrigin);
  assert.equal(rejected.status, 204);
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);

  const jsonError = await fetch(`${baseUrl}/api/not-a-route`, { headers: { Origin: approvedOrigin } });
  assert.equal(jsonError.status, 404);
  assert.equal(jsonError.headers.get("access-control-allow-origin"), approvedOrigin);
  assert.match(jsonError.headers.get("access-control-allow-methods") || "", /\bPATCH\b/);

  const submitted = {
    status: "in_progress",
    answerMode: "typed",
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  };
  finishStudyTestSession(submitted);
  const submittedAt = submitted.submittedAt;
  finishStudyTestSession(submitted);
  assert.equal(submitted.status, "submitted_pending_evaluation");
  assert.equal(submitted.submittedAt, submittedAt, "a finish retry must reuse the original transition");

  console.log(JSON.stringify({
    ok: true,
    patchPreflight: true,
    approvedOriginExact: true,
    unapprovedOriginRejected: true,
    examPatchPreflight: true,
    finishRetryIdempotent: true,
    secretsPrinted: false,
  }, null, 2));
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 1_500)),
    ]).catch(() => {});
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
