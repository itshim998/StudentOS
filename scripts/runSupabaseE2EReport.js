import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "test-results", "supabase-live");

function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(access[_-]?token|refresh[_-]?token|service[_-]?role|client[_-]?secret|api[_-]?key|password)([=:]\s*)[^\s"']+/gi, "$1$2[redacted]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted.jwt]")
    .replace(/studentos\.e2e\.[^@\s]+@example\.com/gi, "studentos.e2e.[masked]@example.com");
}

await mkdir(REPORT_DIR, { recursive: true });

const env = {
  ...process.env,
  STUDENTOS_E2E_SUPABASE_LIVE: "true",
  STUDENTOS_E2E_SUPABASE_REPORT: "true",
};

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["playwright", "test", "tests/e2e/studentos-supabase-live.spec.js"];
console.log("Running live Supabase E2E report mode. Secrets are redacted from process output.");

const child = spawn(command, args, {
  cwd: ROOT,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => process.stdout.write(redact(chunk)));
child.stderr.on("data", (chunk) => process.stderr.write(redact(chunk)));

const exitCode = await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));

const jsonPath = path.join("test-results", "supabase-live", "latest.json");
const summaryPath = path.join("test-results", "supabase-live", "latest.md");
console.log(`\nReport JSON: ${jsonPath}`);
console.log(`Report summary: ${summaryPath}`);
if (!existsSync(path.join(ROOT, jsonPath))) {
  console.log("Report artifact was not created. Check whether the live E2E reached cleanup/report finalization.");
}
process.exit(exitCode);
