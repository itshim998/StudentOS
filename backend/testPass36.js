import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CLASSROOM_WRITE_ACTIONS,
  FEATURE_KEYS,
  canUseClassroomAction,
  canUseFeature,
  getClassroomSyncPolicy,
  getPublicEntitlementSummary,
  getPublicPlanSummaries,
  normalizePlanKey,
} from "./domain/planEntitlementService.js";
import {
  ACADEMIC_CONTEXT_COPY,
  assertAcademicContextCanAdd,
  assertAcademicContextSelection,
  assertProductFeatureAccess,
  countAcademicContextMaterials,
  getAcademicContextCapacity,
  getAssistantExecutionPolicy,
  getPublicAcademicContextCapacity,
  getPublicProductCapabilities,
} from "./domain/productFeatureAccessService.js";
import { createInitialProductLifecycle } from "./domain/productLifecycleService.js";
import { importClassroomSnapshotIntoState } from "./connectors/googleClassroom/mapper.js";
import { getAccountSnapshot } from "./account/accountService.js";
import { initialStateForUser } from "./repository/studentOsRepository.js";

function readyState(planKey = "starter", accessMode = "paid_plan") {
  const state = initialStateForUser({ id: `student_pass36_${planKey}_${accessMode}`, email: `${planKey}@student.example` });
  state.studentProfile.productLifecycle = {
    ...createInitialProductLifecycle({ ready: true }),
    selectedPlanId: planKey,
    accessMode,
  };
  return state;
}

function source(id, { classroom = false, createdAt = "2025-01-01T00:00:00.000Z" } = {}) {
  return {
    id,
    title: id,
    source: classroom ? "google_classroom" : "student_upload",
    provider: classroom ? "google_classroom" : null,
    sourceType: classroom ? "google_classroom_attachment_metadata" : "uploaded_file",
    createdAt,
    importedAt: createdAt,
  };
}

assert.equal(normalizePlanKey(" FREE "), null);
assert.equal(normalizePlanKey("unknown"), null);
assert.equal(normalizePlanKey(undefined), null);
assert.equal(getPublicEntitlementSummary("free").planKey, null);
assert.equal(getPublicEntitlementSummary("free").displayName, "Setup required");

const publicPlans = getPublicPlanSummaries();
assert.equal(publicPlans.filter((plan) => plan.recommended).length, 1);
assert.equal(publicPlans.find((plan) => plan.recommended)?.planKey, "essential");

const trialState = readyState("pro", "trial");
const trialCapabilities = getPublicProductCapabilities(trialState);
assert.equal(trialCapabilities.workspaceReady, true);
assert.equal(trialCapabilities.features.consistencyPoints, false);
assert.equal(getPublicEntitlementSummary("trial").trialMode, true);
assert.equal(trialState.studentProfile.productLifecycle.selectedPlanId, "pro");

assert.equal(getClassroomSyncPolicy("starter").autoCheckEnabled, false);
assert.equal(getClassroomSyncPolicy("starter").intervalDays, null);
assert.equal(getClassroomSyncPolicy("essential").intervalDays, 7);
assert.equal(getClassroomSyncPolicy("plus").intervalDays, 5);
assert.equal(getClassroomSyncPolicy("pro").intervalDays, 3);
assert.equal(getClassroomSyncPolicy("trial").oncePerTrial, true);
for (const planKey of ["trial", "starter", "essential", "plus", "pro"]) {
  const classroomPolicy = getClassroomSyncPolicy(planKey);
  assert.equal(classroomPolicy.metadataOnly, true);
  assert.equal(classroomPolicy.readOnly, true);
  assert.equal(canUseFeature(planKey, FEATURE_KEYS.ASSIGNMENT_WRITEBACK), false);
  for (const action of CLASSROOM_WRITE_ACTIONS) assert.equal(canUseClassroomAction(planKey, action), false);
}

assert.equal(canUseFeature("starter", FEATURE_KEYS.FLASHCARDS), false);
assert.equal(canUseFeature("essential", FEATURE_KEYS.FLASHCARDS), true);
assert.equal(canUseFeature("essential", FEATURE_KEYS.NOTES_VISUALS), true);
assert.equal(canUseFeature("essential", FEATURE_KEYS.LEARNING_LEVEL), false);
assert.equal(canUseFeature("plus", FEATURE_KEYS.LEARNING_LEVEL), true);
assert.equal(canUseFeature("pro", FEATURE_KEYS.LEARNING_LEVEL), true);
assert.equal(canUseFeature("plus", FEATURE_KEYS.CONSISTENCY_POINTS), false);
assert.equal(canUseFeature("pro", FEATURE_KEYS.CONSISTENCY_POINTS), true);

const pendingState = initialStateForUser({ id: "student_pass36_pending", email: "pending@student.example" });
assert.equal(getPublicProductCapabilities(pendingState).status, "plan_setup_pending");
assert.equal(getPublicProductCapabilities(pendingState).assistant.enabled, false);
assert.equal(getPublicAcademicContextCapacity(pendingState).status, "unavailable");
assert.throws(() => assertAcademicContextCanAdd(pendingState), /Plan setup pending/);
assert.throws(() => assertProductFeatureAccess(pendingState, FEATURE_KEYS.ASSISTANT), /Plan setup pending/);

const starterState = readyState("starter");
starterState.sourceMaterials = Array.from({ length: 27 }, (_, index) => source(`uploaded_${index}`));
const almostFull = getAcademicContextCapacity(starterState);
assert.equal(almostFull.status, "almost_full");
assert.equal(almostFull.message, ACADEMIC_CONTEXT_COPY.almostFull);
assert.equal(getPublicAcademicContextCapacity(starterState).message, "Your academic context is almost full. Remove older material or upgrade to add more.");
assert.equal("used" in getPublicAcademicContextCapacity(starterState), false);
assert.equal("limit" in getPublicAcademicContextCapacity(starterState), false);

starterState.sourceMaterials.push(...Array.from({ length: 3 }, (_, index) => source(`uploaded_full_${index}`)));
const full = getAcademicContextCapacity(starterState);
assert.equal(full.status, "full");
assert.equal(full.message, "Your academic context is full. Upgrade or remove older material to add this.");
assert.throws(() => assertAcademicContextCanAdd(starterState), /academic context is full/);

const selectionState = readyState("starter", "trial");
selectionState.sourceMaterials = Array.from({ length: 7 }, (_, index) => source(`classroom_${index}`, { classroom: true }));
assert.equal(countAcademicContextMaterials(selectionState), 0, "unselected Classroom metadata must not consume academic context");
assert.throws(
  () => assertAcademicContextSelection(selectionState, selectionState.sourceMaterials.slice(0, 6).map((item) => item.id)),
  /academic context is full/,
);
assert.equal(assertAcademicContextSelection(selectionState, selectionState.sourceMaterials.slice(0, 5).map((item) => item.id)).status, "full");

const retentionState = readyState("plus");
retentionState.classroomItems = [
  { id: "selected_old", itemType: "material", selectionState: "imported", academicContextIncluded: true, lastSeenAt: "2024-01-01T00:00:00.000Z" },
  { id: "unselected_middle", itemType: "material", selectionState: "discovered", academicContextIncluded: false, lastSeenAt: "2025-01-01T00:00:00.000Z" },
  { id: "unselected_new", itemType: "material", selectionState: "discovered", academicContextIncluded: false, lastSeenAt: "2026-01-01T00:00:00.000Z" },
];
retentionState.studentProfile.productLifecycle.selectedMaterialIds = ["selected_old"];
importClassroomSnapshotIntoState(retentionState, { courses: [], courseWork: [], courseWorkMaterials: [], submissions: [] }, {
  retention: { maxImportedAssignments: 10, maxImportedMaterials: 1 },
});
assert.equal(retentionState.classroomItems.find((item) => item.id === "selected_old")?.selectionState, "imported", "selected Classroom material must never be silently evicted");
assert.equal(retentionState.classroomItems.filter((item) => item.selectionState !== "archived").length, 1);

assert.equal(getAssistantExecutionPolicy(readyState("starter")).depth, "guided");
assert.equal(getAssistantExecutionPolicy(readyState("starter")).retrievalLimit, 3);
assert.equal(getAssistantExecutionPolicy(readyState("essential")).flashcardsEnabled, true);
assert(getAssistantExecutionPolicy(readyState("pro")).retrievalLimit > getAssistantExecutionPolicy(readyState("starter")).retrievalLimit);

const account = getAccountSnapshot({
  session: { authenticated: true, mode: "studentos_sign_in", user: { id: starterState.studentProfile.id, email: "starter@student.example" } },
  state: starterState,
  saasConfig: { quotas: { enforcementEnabled: true }, billing: { paymentIntegrationEnabled: false } },
});
const publicAccountText = JSON.stringify(account.planAccess);
assert.doesNotMatch(publicAccountText, /provider|storageBytes|maxSources|aiRequestsPerDay|dailyBudget|heavyActionBudget|retrievalLimit/i);
assert.doesNotMatch(publicAccountText, /"displayName":"Free"|"label":"Free"/i);

const app = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
function functionSlice(start, end) {
  const startIndex = app.indexOf(start);
  const endIndex = app.indexOf(end, startIndex + start.length);
  assert(startIndex >= 0 && endIndex > startIndex, `missing visible-copy slice ${start}`);
  return app.slice(startIndex, endIndex);
}
const visibleCopy = [
  functionSlice("function academicContextUploadMarkup", "const PAID_PRODUCT_PLAN_KEYS"),
  functionSlice("function materialsStepMarkup", "function summaryValue"),
  functionSlice("function renderAccount", "function renderLifecycle"),
  functionSlice("function renderAiPayload", "async function runAi"),
  html.slice(html.indexOf('<section class="view" id="view-account"'), html.indexOf('<div id="ai-scrim"')),
].join("\n");
assert.doesNotMatch(
  visibleCopy,
  /\b(provider|model|token|vector|embedding|chunks?|Supabase|database|backend|mock|demo|source-grounded|web fallback|writeback|OAuth|scopes?|storage)\b/i,
);
assert.doesNotMatch(visibleCopy, />\s*Free\s*</i);
assert(app.includes("Assignment Coach is available with Plus or Pro"));

console.log(JSON.stringify({
  pass: "36.0",
  planNormalizationFailClosed: true,
  classroomReadOnly: true,
  selectedMaterialRetentionProtected: true,
  hiddenBudgetsExposed: false,
  realPaymentEnabled: false,
  secretsPrinted: false,
}, null, 2));
