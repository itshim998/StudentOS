import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseRecoveryReasoningJson, RecoveryAnalyzeInputSchema, RecoveryReasoningOutputSchema } from "./recovery/recoverySchemas.js";
import { RECOVERY_FAILURES, RecoveryError } from "./recovery/recoveryErrors.js";
import { runRecoveryEvaluationCases } from "./recovery/recoveryEvaluationCases.js";

assert.equal(RecoveryReasoningOutputSchema.safeParse({ topicRecommendations: [], replanRequired: false, urgency: "none", summary: "No change.", extra: true }).success, false);
assert.equal(RecoveryReasoningOutputSchema.safeParse({
  topicRecommendations: [
    { syllabusTopicId: "topic", evidenceIds: [], evidenceStrength: "insufficient", priorityChange: "none", reasonCode: "NONE", explanation: "No evidence." },
    { syllabusTopicId: "topic", evidenceIds: [], evidenceStrength: "insufficient", priorityChange: "none", reasonCode: "NONE", explanation: "Duplicate." },
  ], replanRequired: false, urgency: "none", summary: "No change.",
}).success, false);
assert.equal(RecoveryAnalyzeInputSchema.safeParse({ timezone: "Asia/Kolkata", currentDate: "2026-07-19", currentTime: "12:00" }).success, true);
assert.equal(RecoveryAnalyzeInputSchema.safeParse({ timezone: "Mars/Olympus" }).success, false);
assert.equal(RecoveryReasoningOutputSchema.safeParse({
  topicRecommendations: [{ syllabusTopicId: "topic", evidenceIds: ["evidence"], evidenceStrength: "weak", priorityChange: "increase", activityType: "targeted_practice", recommendedMinutes: 61, reasonCode: "GAP", explanation: "Mapped gap." }],
  replanRequired: true, urgency: "medium", summary: "Recovery needed.",
}).success, false);
assert.throws(() => parseRecoveryReasoningJson('```json\n{"topicRecommendations":[],"replanRequired":false,"urgency":"none","summary":"No change."}\n```'));

const cases = await runRecoveryEvaluationCases();
for (const test of cases) assert.equal(test.passed, true, `${test.name}: ${test.error || "failed"}`);

const migration = await readFile(new URL("../supabase/migrations/202607190001_studentos_adaptive_recovery_engine.sql", import.meta.url), "utf8");
for (const marker of ["recovery_user_state", "academic_events", "academic_state_snapshots", "topic_recovery_states", "topic_recovery_state_history", "recovery_runs", "recovery_previews", "plan_versions", "acquire_recovery_mutation_lease", "release_recovery_mutation_lease", "apply_recovery_preview", "pg_advisory_xact_lock", "recovery_analysis", "recovery_previews_user_mutation_idempotency_idx", "RECOVERY_IDEMPOTENCY_CONFLICT", "enable row level security", "service_role"]) assert.match(migration, new RegExp(marker, "i"));
assert.doesNotMatch(migration, /grant execute[^;]+to authenticated/is);

const unauthorized = new RecoveryError(RECOVERY_FAILURES.UNAUTHORIZED, "Denied");
assert.equal(unauthorized.status, 403);
assert.equal(unauthorized.retryable, false);

const server = await readFile(new URL("./server.js", import.meta.url), "utf8");
for (const marker of ["/api/recovery/analyze", "recoveryRunMatch", "recoveryPreviewMatch", "recoveryApplyMatch", "recoveryRejectMatch"]) assert.ok(server.includes(marker));
assert.doesNotMatch(server, /classroom.*(?:submit|turnIn|modifyAttachments)/i);

console.log(`PASS | Adaptive Recovery Engine ${cases.length} evaluation-backed cases and schema/API safeguards passed`);
