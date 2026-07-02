import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  addManualCourse,
  archiveManualCourse,
  updateManualCourse,
} from "./domain/courseManagementService.js";
import { applyStudentOnboarding } from "./domain/onboardingService.js";
import { isAcademicContextRecord } from "./connectors/googleClassroom/mapper.js";
import {
  CLASSROOM_WRITE_ACTIONS,
  FEATURE_KEYS,
  canUseClassroomAction,
  canUseFeature,
  getClassroomSyncPolicy,
} from "./domain/planEntitlementService.js";
import {
  assertNoGoogleClassroomWriteScopes,
  getGoogleClassroomConfig,
} from "./connectors/googleClassroom/config.js";
import { getProductFlowConfig } from "./domain/productLifecycleService.js";
import { classifyAiTask, getDeterministicAiResponse } from "./ai/aiWeeklyAllowanceService.js";
import { getAiProviderConfig } from "./ai/providerConfig.js";
import {
  GroqGroundedProvider,
  PollinationsTextProvider,
  groqSupportsReasoningEffort,
  resetProviderRuntimeForTests,
} from "./ai/providers.js";
import { runStudentOsVerb } from "./ai/studentBrainAdapter.js";
import { initialStateForUser, StudentOsRepository } from "./repository/studentOsRepository.js";

const now = new Date("2026-07-02T08:00:00.000Z");

const courseState = initialStateForUser({ id: "task34_courses" });
courseState.studentProfile.preferences.stream = "Science";
const manualCourse = addManualCourse(courseState, {
  courseName: "Physics",
  courseCode: "PHY 101",
  term: "Semester 1",
}, { now, idFactory: () => "12345678-test" });
assert.equal(manualCourse.id, "course_manual_physics_12345678");
assert.equal(manualCourse.department, "Science");
assert.equal(manualCourse.source, "manual");
assert.equal(isAcademicContextRecord(manualCourse), true);
assert.throws(() => addManualCourse(courseState, { courseName: "Physics" }, { now }), /already in your saved courses/i);
const editedCourse = updateManualCourse(courseState, manualCourse.id, {
  courseName: "Applied Physics",
  courseCode: "PHY 102",
  department: "Engineering",
  term: "Year 1",
}, { now: new Date("2026-07-02T09:00:00.000Z") });
assert.equal(editedCourse.title, "Applied Physics");
assert.equal(editedCourse.courseCode, "PHY 102");
courseState.sourceMaterials.push({ id: "source_physics", courseId: manualCourse.id, title: "Notes" });
assert.throws(() => archiveManualCourse(courseState, manualCourse.id, { now }), /assignments and materials/i);
courseState.sourceMaterials = [];
archiveManualCourse(courseState, manualCourse.id, { now });
assert.equal(isAcademicContextRecord(manualCourse), false);

const onboardingState = initialStateForUser({ id: "task34_onboarding_merge" });
const preservedManual = addManualCourse(onboardingState, { courseName: "Design" }, { now, idFactory: () => "abcdefgh-test" });
applyStudentOnboarding(onboardingState, { displayName: "Student", subjectsText: "Mathematics" }, { now });
assert(onboardingState.courses.some((course) => course.id === preservedManual.id));
assert(onboardingState.courses.some((course) => course.title === "Mathematics" && course.source === "onboarding"));

assert.equal(getDeterministicAiResponse("Hello").actionType, "deterministic_help");
assert.equal(groqSupportsReasoningEffort("openai/gpt-oss-120b"), true);
assert.equal(groqSupportsReasoningEffort("llama-3.3-70b-versatile"), false);

const supportedConfig = getAiProviderConfig({
  STUDENTOS_AI_MODE: "auto",
  GROQ_API_KEY: "test-key",
  GROQ_CHAT_MODEL: "openai/gpt-oss-120b",
});
let compatibilityCalls = 0;
const compatibilityBodies = [];
resetProviderRuntimeForTests();
const compatibilityProvider = new GroqGroundedProvider({
  config: supportedConfig,
  fetchImpl: async (_url, options) => {
    compatibilityCalls += 1;
    compatibilityBodies.push(JSON.parse(options.body));
    if (compatibilityCalls === 1) {
      return new Response(JSON.stringify({ error: { message: "reasoning_effort is not supported for this deployment" } }), { status: 400 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "A compatible answer" } }] }), { status: 200 });
  },
});
const compatibilityResult = await compatibilityProvider.generate({ messages: [{ role: "user", content: "What is AI?" }] });
assert.equal(compatibilityResult.text, "A compatible answer");
assert.equal(compatibilityCalls, 2);
assert.equal(compatibilityBodies[0].reasoning_effort, "medium");
assert.equal("reasoning_effort" in compatibilityBodies[1], false);
assert.equal(compatibilityBodies[1].max_completion_tokens, 3000);

const unsupportedConfig = getAiProviderConfig({
  STUDENTOS_AI_MODE: "auto",
  GROQ_API_KEY: "test-key",
  GROQ_CHAT_MODEL: "llama-3.3-70b-versatile",
});
let unsupportedBody = null;
resetProviderRuntimeForTests();
await new GroqGroundedProvider({
  config: unsupportedConfig,
  fetchImpl: async (_url, options) => {
    unsupportedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "General answer" } }] }), { status: 200 });
  },
}).generate({ messages: [{ role: "user", content: "Explain photosynthesis simply" }] });
assert.equal("reasoning_effort" in unsupportedBody, false);
assert.equal(unsupportedBody.max_completion_tokens, 3000);
assert(Array.isArray(unsupportedBody.messages));

const pollinationsConfig = getAiProviderConfig({
  STUDENTOS_AI_MODE: "pollinations",
  POLLINATIONS_API_KEY: "test-key",
});
let fallbackBody = null;
await new PollinationsTextProvider({
  config: pollinationsConfig,
  fetchImpl: async (_url, options) => {
    fallbackBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "Fallback answer" } }] }), { status: 200 });
  },
}).generate({ messages: [{ role: "user", content: "What is AI?" }] });
assert.equal(fallbackBody.max_tokens, 3000);
assert.equal("reasoning_effort" in fallbackBody, false);

const emptyState = initialStateForUser({ id: "task34_empty_context" });
delete emptyState.sourceMaterials;
delete emptyState.sourceChunks;
emptyState.courses = [];
emptyState.topics = [{ id: "topic_without_sources", title: "Empty topic", sourceMaterialIds: undefined }];
let generalProviderCalls = 0;
const generalResult = await runStudentOsVerb({
  verb: "Ask",
  message: "What is AI",
  state: emptyState,
  providerConfig: supportedConfig,
  fetchImpl: async (_url, options) => {
    generalProviderCalls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
    return new Response(JSON.stringify({ choices: [{ message: { content: "AI helps computers learn patterns and solve problems." } }] }), { status: 200 });
  },
});
assert.equal(generalProviderCalls, 1);
assert.equal(generalResult.generationSucceeded, true);
assert.match(generalResult.answer, /AI helps computers learn patterns/i);
assert.match(generalResult.answer, /answer generally for now/i);
assert.equal(generalResult.courseId, null);

for (const message of ["Explain photosynthesis simply", "Make a study plan"]) {
  resetProviderRuntimeForTests();
  const result = await runStudentOsVerb({
    verb: message.includes("study plan") ? "Plan" : "Ask",
    message,
    state: initialStateForUser({ id: `task34_${message.length}` }),
    providerConfig: supportedConfig,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "Here is a useful general answer with a simple next step." } }] }), { status: 200 }),
  });
  assert.equal(result.generationSucceeded, true);
  assert.doesNotMatch(result.answer, /provider|model|token|backend|raw error/i);
}

resetProviderRuntimeForTests();
const missingMaterial = await runStudentOsVerb({
  verb: "Ask",
  message: "Explain the selected PDF",
  state: initialStateForUser({ id: "task34_missing_material" }),
  providerConfig: supportedConfig,
  fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "Should not replace missing-material guidance." } }] }), { status: 200 }),
});
assert.match(missingMaterial.answer, /do not have that material|don.t have that material|not enough material/i);

const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const session = { authenticated: true, mode: "test", user: { id: "task34_allowance" } };
const task = classifyAiTask({ verb: "Ask", message: "What is AI" });
const reservation = await repository.reserveAiWeeklyAllowance(session, {
  planTier: "starter",
  periodKey: "week_2026-06-29",
  allowance: 35,
  actionType: task.actionType,
  creditCost: task.creditCost,
  requestId: "task34_success",
});
assert.equal(reservation.allowed, true);
const charged = await repository.settleAiWeeklyAllowance(session, { requestId: "task34_success", status: "charged" });
assert.equal(charged.used, task.creditCost);
const failedReservation = await repository.reserveAiWeeklyAllowance(session, {
  planTier: "starter",
  periodKey: "week_2026-06-29",
  allowance: 35,
  actionType: task.actionType,
  creditCost: task.creditCost,
  requestId: "task34_failed",
});
assert.equal(failedReservation.allowed, true);
const refunded = await repository.settleAiWeeklyAllowance(session, { requestId: "task34_failed", status: "refunded" });
assert.equal(refunded.used, task.creditCost);
const exhausted = await repository.reserveAiWeeklyAllowance(session, {
  planTier: "unknown",
  periodKey: "week_2026-06-29",
  allowance: 0,
  actionType: task.actionType,
  creditCost: task.creditCost,
  requestId: "task34_exhausted",
});
assert.equal(exhausted.allowed, false);

const [app, html, server, allowancePermissionsMigration] = await Promise.all([
  readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8"),
  readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
  readFile(new URL("./server.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607020001_studentos_task34_ai_allowance_permissions.sql", import.meta.url), "utf8"),
]);
const courseMarkup = html.slice(html.indexOf('id="setup-courses"'), html.indexOf('id="onboarding-form"'));
for (const copy of ["Courses", "Add course", "Course name", "Course code", "Saved courses", "Add your courses so StudentOS can organize assignments and materials."]) {
  assert.match(courseMarkup, new RegExp(copy));
}
assert.match(app, /Add course manually/);
assert.match(app, /Refresh course list/);
assert.match(app, /Connect Classroom/);
assert.match(app, /Reconnect Classroom/);
assert.match(app, /This course can now be used when uploading academic context\./);
assert.match(server, /POST[^\n]+\/api\/courses|req\.method === "POST" && url\.pathname === "\/api\/courses"/);
assert.match(server, /status: generated \? "charged" : "refunded"/);
assert.match(allowancePermissionsMigration, /grant select, insert, update, delete on table public\.ai_usage_ledger to service_role/i);
assert.match(allowancePermissionsMigration, /grant execute on function public\.reserve_ai_weekly_allowance[\s\S]*to service_role/i);
assert.match(allowancePermissionsMigration, /grant execute on function public\.settle_ai_weekly_allowance[\s\S]*to service_role/i);
assert.match(allowancePermissionsMigration, /revoke all on table public\.ai_usage_ledger from public, anon, authenticated/i);
assert.doesNotMatch(allowancePermissionsMigration, /grant\s+(?:all|execute|select|insert|update|delete)[^;]*\bto\s+(?:anon|authenticated)\b/i);
assert.match(allowancePermissionsMigration, /Apply to all three StudentOS data shards only/i);
assert.doesNotMatch(courseMarkup, /\b(table|row|shard|backend|database|debug|schema)\b/i);
assert.doesNotMatch(`${html}\n${app}`, /Plan Free/i);

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
  assert.equal(canUseFeature(plan, FEATURE_KEYS.ASSIGNMENT_WRITEBACK), false);
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(plan, action), false);
}
assert.doesNotThrow(() => assertNoGoogleClassroomWriteScopes(getGoogleClassroomConfig({ STUDENTOS_GOOGLE_CLASSROOM_MODE: "mock" }).scopes));
assert.equal(getProductFlowConfig({}, "development").realPaymentEnabled, false);

console.log("PASS | StudentOS Task 3.4 course management and AI reliability tests passed");
