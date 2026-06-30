import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runStudentOsVerb } from "./ai/studentBrainAdapter.js";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import { importClassroomSnapshotIntoState } from "./connectors/googleClassroom/mapper.js";
import { runProductionPreflight } from "../scripts/preflightProduction.js";

const BAD_AI_COPY = /Demo response|material check|limited material context|low material match|Retrieved source context|StudentOS found only|Ask: from student materials|mock\/demo|workflow arrows/i;

const originalAiMode = process.env.STUDENTOS_AI_MODE;
process.env.STUDENTOS_AI_MODE = "mock";
const state = createSeedState(new Date("2026-06-25T06:00:00.000Z"));
const aiResult = await runStudentOsVerb({
  verb: "Ask",
  message: "Explain the French Revolution from my notes.",
  state,
  retrievalOverride: {
    chunks: [],
    sources: [],
    memories: [],
    labels: [],
    hasUploadedMaterial: false,
    retrievalMode: "keyword-fallback",
    confidence: {
      score: 0.1,
      label: "low",
      lowConfidence: true,
      semanticAvailable: false,
    },
  },
});
if (originalAiMode === undefined) delete process.env.STUDENTOS_AI_MODE;
else process.env.STUDENTOS_AI_MODE = originalAiMode;

assert.match(aiResult.answer, /Not enough material yet/i);
assert.doesNotMatch(JSON.stringify({
  answer: aiResult.answer,
  grounding: aiResult.grounding,
  explanation: aiResult.explanation,
}), BAD_AI_COPY);

const frontend = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
assert(frontend.includes("activeClassroomConnector"));
assert(frontend.includes("statusPendingClassroomConnector"));
assert(frontend.includes("not enough material yet"));
assert.doesNotMatch(frontend, /Demo response|material check|limited material context|low material match/);
assert.doesNotMatch(frontend, /runtimeConfig\.classroom \|\|/);

const classroomState = createSeedState(new Date("2026-06-25T06:00:00.000Z"));
classroomState.assignments = [];
classroomState.sourceMaterials = [];
classroomState.sourceChunks = [
  { id: "chunk_old", sourceMaterialId: "classroom_material_course_1_old_work_old_mat", text: "old" },
];
const summary = importClassroomSnapshotIntoState(classroomState, {
  courses: [{
    providerCourseId: "course_1",
    title: "History",
    updateTime: "2026-06-20T08:00:00.000Z",
  }],
  courseWork: [
    {
      providerCourseId: "course_1",
      providerCourseWorkId: "old_work",
      title: "Old essay",
      dueAt: "2026-06-10T08:00:00.000Z",
      creationTime: "2026-06-01T08:00:00.000Z",
      updateTime: "2026-06-02T08:00:00.000Z",
      materials: [{ providerMaterialId: "old_mat", title: "Old material" }],
    },
    {
      providerCourseId: "course_1",
      providerCourseWorkId: "middle_work",
      title: "Middle worksheet",
      dueAt: "2026-06-20T08:00:00.000Z",
      creationTime: "2026-06-05T08:00:00.000Z",
      updateTime: "2026-06-12T08:00:00.000Z",
      materials: [{ providerMaterialId: "middle_mat", title: "Middle material" }],
    },
    {
      providerCourseId: "course_1",
      providerCourseWorkId: "new_work",
      title: "Newest project",
      dueAt: "2026-06-28T08:00:00.000Z",
      creationTime: "2026-06-15T08:00:00.000Z",
      updateTime: "2026-06-24T08:00:00.000Z",
      materials: [{ providerMaterialId: "new_mat", title: "Newest material" }],
    },
  ],
  submissions: [],
}, {
  now: new Date("2026-06-25T06:00:00.000Z"),
  retention: {
    maxImportedAssignments: 2,
    maxImportedMaterials: 1,
  },
});

assert.deepEqual(classroomState.assignments.map((assignment) => assignment.providerCourseWorkId), ["new_work", "middle_work"]);
assert.deepEqual(classroomState.sourceMaterials.map((source) => source.providerMaterialId), ["new_mat"]);
assert.equal(classroomState.sourceChunks.some((chunk) => chunk.sourceMaterialId.includes("old_work")), false);
assert.equal(summary.evictedAssignments, 1);
assert.equal(summary.evictedMaterials, 2);
assert.equal(summary.retentionApplied, true);
assert.equal(summary.googleClassroomDeleted, false);

const preflight = runProductionPreflight({
  STUDENTOS_ENV: "production",
  STUDENTOS_MODE: "mock",
  STUDENTOS_RATE_LIMIT_ENABLED: "false",
  STUDENTOS_DEMO_SEED_ENABLED: "true",
  CORS_ORIGINS: "http://localhost:3101",
  STUDENTOS_API_BASE: "http://localhost:3101",
  STUDENTOS_BILLING_PROVIDER: "none",
  RAZORPAY_KEY_ID: "present-but-not-printed",
  STUDENTOS_EMBEDDING_MODE: "mock",
  STUDENTOS_GOOGLE_CLASSROOM_MODE: "mock",
});
assert.equal(preflight.secretsPrinted, false);
assert(preflight.readiness.errors.includes("production_rate_limit_disabled"));
assert(preflight.readiness.errors.includes("production_demo_seed_must_be_disabled"));
assert(preflight.readiness.errors.includes("production_cors_origins_include_localhost"));
assert(preflight.readiness.errors.includes("production_api_base_points_to_localhost"));
assert(preflight.readiness.warnings.includes("payment_provider_keys_present_while_billing_provider_none"));
assert(preflight.readiness.warnings.includes("production_mock_embeddings_early_beta"));
assert(preflight.readiness.warnings.includes("production_google_classroom_mock_mode_should_be_disabled_or_oauth"));
assert.doesNotMatch(JSON.stringify(preflight), /present-but-not-printed/);

console.log("PASS | StudentOS Pass 34.9 AI, Classroom ordering, and env readiness tests passed");
