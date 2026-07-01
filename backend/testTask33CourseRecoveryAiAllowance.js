import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AI_CREDIT_COSTS,
  AI_WEEKLY_ALLOWANCE_DEFAULTS,
  classifyAiTask,
  getAiWeeklyAllowance,
  getAiWeeklyAllowanceConfig,
  getAiWeeklyPeriod,
  getDeterministicAiResponse,
} from "./ai/aiWeeklyAllowanceService.js";
import { getAiProviderConfig } from "./ai/providerConfig.js";
import { GroqGroundedProvider } from "./ai/providers.js";
import { runStudentOsVerb } from "./ai/studentBrainAdapter.js";
import {
  getClassroomDueWork,
  syncClassroomCoursesIntoState,
} from "./connectors/googleClassroom/mapper.js";
import { MockGoogleClassroomReadOnlyConnector } from "./connectors/googleClassroom/mockConnector.js";
import {
  assertNoGoogleClassroomWriteScopes,
  getGoogleClassroomConfig,
} from "./connectors/googleClassroom/config.js";
import { initialStateForUser, StudentOsRepository } from "./repository/studentOsRepository.js";
import {
  CLASSROOM_WRITE_ACTIONS,
  canUseClassroomAction,
  getClassroomSyncPolicy,
} from "./domain/planEntitlementService.js";
import { getProductFlowConfig } from "./domain/productLifecycleService.js";

const now = new Date("2026-07-01T08:00:00.000Z");

const seed = initialStateForUser({ id: "task33_course_seed" });
seed.courses.push({ id: "course_existing", title: "Existing course", providerCourseId: "existing", source: "google_classroom" });
seed.assignments.push({
  id: "assignment_existing",
  courseId: "course_existing",
  title: "Existing selected work",
  source: "google_classroom",
  selectionState: "imported",
  academicContextIncluded: true,
  dueAt: "2026-07-04T12:00:00.000Z",
  submissionState: "ASSIGNED",
});
seed.classroomItems.push({
  id: "classroom_existing",
  itemType: "assignment",
  externalId: "existing_work",
  title: "Existing review item",
  selectionState: "discovered",
  academicContextIncluded: false,
});
const courseSnapshot = await new MockGoogleClassroomReadOnlyConnector(seed).fetchCourseSnapshot();
assert.equal(courseSnapshot.courses.length, 1);
assert.deepEqual(courseSnapshot.courseWork, []);
assert.deepEqual(courseSnapshot.courseWorkMaterials, []);
assert.deepEqual(courseSnapshot.submissions, []);

const recovered = initialStateForUser({ id: "task33_course_recovered" });
recovered.classroomItems.push({ ...seed.classroomItems[0] });
const beforeToday = getClassroomDueWork(recovered);
const recoveredSummary = syncClassroomCoursesIntoState(recovered, courseSnapshot, { now });
assert.equal(recoveredSummary.courseOnly, true);
assert.equal(recovered.courses.length, 1);
assert.equal(recovered.assignments.length, 0);
assert.equal(recovered.sourceMaterials.length, 0);
assert.deepEqual(recovered.classroomItems, [seed.classroomItems[0]]);
assert.deepEqual(getClassroomDueWork(recovered), beforeToday);
for (const plan of ["starter", "essential", "plus", "pro"]) {
  const policy = getClassroomSyncPolicy(plan);
  assert.equal(policy.readOnly, true);
  if (plan === "starter") {
    assert.equal(policy.courseOnly, true);
    assert.equal(policy.courseworkReviewEnabled, false);
    assert.equal(policy.autoCheckEnabled, false);
  } else {
    assert.equal(policy.courseworkReviewEnabled, true);
  }
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(plan, action), false);
}
const classroomConfig = getGoogleClassroomConfig({ STUDENTOS_GOOGLE_CLASSROOM_MODE: "mock" });
assert.doesNotThrow(() => assertNoGoogleClassroomWriteScopes(classroomConfig.scopes));

assert.deepEqual(getAiWeeklyAllowanceConfig({}), AI_WEEKLY_ALLOWANCE_DEFAULTS);
assert.equal(getAiWeeklyAllowance("trial", {}), 15);
assert.equal(getAiWeeklyAllowance("starter", {}), 35);
assert.equal(getAiWeeklyAllowance("essential", {}), 90);
assert.equal(getAiWeeklyAllowance("plus", {}), 220);
assert.equal(getAiWeeklyAllowance("pro", {}), 500);
assert.equal(getAiWeeklyAllowance("unknown", {}), 0);
assert.equal(getAiWeeklyAllowance("starter", { STUDENTOS_AI_WEEKLY_ALLOWANCE_STARTER: "41" }), 41);
assert.deepEqual(getAiWeeklyPeriod(new Date("2026-07-01T23:59:59.000Z")), {
  periodKey: "week_2026-06-29",
  startsAt: "2026-06-29T00:00:00.000Z",
  refreshesAt: "2026-07-06T00:00:00.000Z",
});
assert.equal(getAiWeeklyPeriod(new Date("2026-07-06T00:00:00.000Z")).periodKey, "week_2026-07-06");

assert.equal(getDeterministicAiResponse("Hello").actionType, "deterministic_help");
assert.equal(AI_CREDIT_COSTS.deterministic_help, 0);
assert.equal(classifyAiTask({ verb: "Ask", message: "What is spaced repetition?" }).creditCost, 1);
assert.equal(classifyAiTask({ verb: "Ask", message: "Use my selected notes", retrieval: { chunks: [{}] } }).creditCost, 2);
assert.equal(classifyAiTask({ verb: "Ask", message: "Explain photosynthesis" }).creditCost, 3);
assert.equal(classifyAiTask({ verb: "Plan", message: "Plan my week" }).creditCost, 5);
assert.equal(classifyAiTask({ verb: "Review", message: "Check my assignment and give feedback" }).creditCost, 8);

const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const session = { authenticated: true, mode: "test", user: { id: "task33_allowance", email: "task33@student.example" } };
const baseReservation = {
  planTier: "starter",
  periodKey: "week_2026-06-29",
  allowance: 35,
  actionType: "planning",
  creditCost: 5,
};
const first = await repository.reserveAiWeeklyAllowance(session, { ...baseReservation, requestId: "request_success" });
assert.equal(first.allowed, true);
assert.equal(first.used, 5);
const charged = await repository.settleAiWeeklyAllowance(session, { requestId: "request_success", status: "charged" });
assert.equal(charged.status, "charged");
assert.equal(charged.used, 5);
const failed = await repository.reserveAiWeeklyAllowance(session, { ...baseReservation, requestId: "request_failed", creditCost: 8 });
assert.equal(failed.allowed, true);
const refunded = await repository.settleAiWeeklyAllowance(session, { requestId: "request_failed", status: "refunded" });
assert.equal(refunded.status, "refunded");
assert.equal(refunded.used, 5);
const blocked = await repository.reserveAiWeeklyAllowance(session, { ...baseReservation, requestId: "request_blocked", creditCost: 31 });
assert.equal(blocked.allowed, false);
assert.equal(blocked.remaining, 30);
const newWeek = await repository.reserveAiWeeklyAllowance(session, { ...baseReservation, periodKey: "week_2026-07-06", requestId: "request_new_week", creditCost: 35 });
assert.equal(newWeek.allowed, true);

const mockProviderConfig = getAiProviderConfig({ STUDENTOS_AI_MODE: "mock" });
const emptyState = initialStateForUser({ id: "task33_empty_ai" });
const general = await runStudentOsVerb({
  verb: "Ask",
  message: "How can I build a better revision habit?",
  state: emptyState,
  providerConfig: mockProviderConfig,
});
assert.equal(general.generationSucceeded, true);
assert.match(general.answer, /answer generally for now/i);
assert.equal(general.courseId, null);
assert.equal(general.topicId, null);

const incompleteTopicState = initialStateForUser({ id: "task33_missing_ids" });
incompleteTopicState.courses.push({ id: "course_biology", title: "Biology" });
incompleteTopicState.topics.push({ id: "topic_cells", courseId: "course_biology", title: "Cell division", weakSignals: [] });
const missingIds = await runStudentOsVerb({
  verb: "Ask",
  message: "Explain cell division",
  state: incompleteTopicState,
  providerConfig: mockProviderConfig,
});
assert.equal(typeof missingIds.answer, "string");
assert(missingIds.answer.length > 0);

const groundedState = initialStateForUser({ id: "task33_grounded" });
groundedState.courses.push({ id: "course_math", title: "Mathematics" });
groundedState.topics.push({ id: "topic_quadratic", courseId: "course_math", title: "Quadratic roots", weakSignals: [], sourceMaterialIds: ["source_quad"] });
groundedState.sourceMaterials.push({
  id: "source_quad",
  courseId: "course_math",
  title: "Quadratic notes",
  sourceType: "uploaded_file",
  status: "indexed",
  extractedText: "Quadratic roots can be found by factorisation or the quadratic formula.",
  citationLabel: "Quadratic notes",
});
const grounded = await runStudentOsVerb({
  verb: "Ask",
  message: "Explain quadratic roots from my notes",
  state: groundedState,
  providerConfig: mockProviderConfig,
});
assert.equal(grounded.grounding.uploadedMaterialUsed, true);
assert(grounded.sourceLabels.some((label) => label.label === "Quadratic notes"));

const failingProviderConfig = getAiProviderConfig({
  STUDENTOS_AI_MODE: "auto",
  GROQ_API_KEY: "test-only-key",
  GROQ_CHAT_MODEL: "test-model",
});
const providerFailure = await runStudentOsVerb({
  verb: "Ask",
  message: "What is active recall?",
  state: emptyState,
  providerConfig: failingProviderConfig,
  fetchImpl: async () => { throw new Error("raw_provider_failure"); },
});
assert.equal(providerFailure.generationSucceeded, false);
assert.equal(providerFailure.answer, "I could not complete that answer right now. Please try again.");
assert.doesNotMatch(providerFailure.answer, /provider|model|token|backend|raw_provider_failure/i);

let providerBody = null;
const provider = new GroqGroundedProvider({
  config: failingProviderConfig,
  fetchImpl: async (_url, options) => {
    providerBody = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "A safe response" } }] }) };
  },
});
await provider.generate({ messages: [{ role: "user", content: "Hello" }] });
assert.equal(providerBody.reasoning_effort, "medium");
assert.equal(providerBody.max_completion_tokens, 3000);

const app = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
const server = await readFile(new URL("./server.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/202607010002_studentos_task33_ai_weekly_allowance.sql", import.meta.url), "utf8");
const connectorSource = [
  await readFile(new URL("./connectors/googleClassroom/apiClient.js", import.meta.url), "utf8"),
  await readFile(new URL("./connectors/googleClassroom/syncService.js", import.meta.url), "utf8"),
].join("\n");
assert.match(`${html}\n${app}`, /No courses found yet\./);
assert.match(app, /Refresh your Classroom course list or add a course in Setup before uploading academic context\./);
assert.match(app, /StudentOS will only refresh your course names\. It will not import assignments or materials\./);
assert.match(server, /\/api\/classroom\/courses\/refresh/);
assert.match(server, /courseOnly: true/);
assert.match(migration, /create table if not exists public\.ai_usage_ledger/i);
assert.match(migration, /reserve_ai_weekly_allowance/);
assert.match(migration, /Apply to all three StudentOS data shards only/i);
assert.doesNotMatch(migration, /auth\.users|student_profiles/i);
assert.doesNotMatch(connectorSource, /turnIn|modifyAttachments|reclaimSubmission|studentSubmissions\/[^"'`]*:(?:turnIn|reclaim)/i);
assert.equal(getProductFlowConfig({}, "development").realPaymentEnabled, false);
assert.doesNotMatch(`${app}\n${html}`, /Plan Free/i);
assert.doesNotMatch(
  [
    "You have used this week’s AI help for your current plan. Your weekly AI help refreshes soon.",
    "I could not complete that answer right now. Please try again.",
  ].join(" "),
  /provider|model|token|database|backend|storage|retrieval/i,
);

console.log("PASS | StudentOS Task 3.3 course recovery and weekly AI allowance tests passed");
