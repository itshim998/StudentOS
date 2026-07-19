import { runRecoveryEvaluationCases } from "../backend/recovery/recoveryEvaluationCases.js";
import { mkdir, writeFile } from "node:fs/promises";

const cases = await runRecoveryEvaluationCases();
const categories = {};
for (const test of cases) {
  const bucket = categories[test.category] || { passed: 0, failed: 0 };
  bucket[test.passed ? "passed" : "failed"] += 1;
  categories[test.category] = bucket;
}
const failed = cases.filter((test) => !test.passed);
const summary = {
  ok: failed.length === 0,
  generatedAt: new Date().toISOString(),
  required: cases.length,
  passed: cases.length - failed.length,
  failed: failed.length,
  categories,
  cases,
  secretsPrinted: false,
};
await mkdir("test-results", { recursive: true });
await writeFile("test-results/recovery-evaluation-summary.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, outputPath: "test-results/recovery-evaluation-summary.json" }, null, 2));
if (failed.length) process.exitCode = 1;
