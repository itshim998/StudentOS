import { resolveEntitlements } from "../billing/billingService.js";
import { getProductLifecycleSnapshot } from "./productLifecycleService.js";
import {
  FEATURE_KEYS,
  canUseFeature,
  getAssistantPolicy,
  getClassroomSyncPolicy,
  getPlanEntitlements,
  getPublicEntitlementSummary,
} from "./planEntitlementService.js";
import { isAcademicContextRecord, isClassroomRecord } from "../connectors/googleClassroom/mapper.js";

export const ACADEMIC_CONTEXT_COPY = Object.freeze({
  pending: "Plan setup pending. Finish setup before adding academic material.",
  available: "You have room for more material.",
  almostFull: "Your academic context is almost full.",
  full: "Your academic context is full. Remove older material or upgrade to add more.",
});

function productError(message, status = 403, code = "feature_unavailable") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function activeSources(state = {}) {
  return (state.sourceMaterials || []).filter((source) => isAcademicContextRecord(source) && !source.deletedAt);
}

function selectedContextIds(state = {}, overrideIds = null) {
  const values = overrideIds === null
    ? state.studentProfile?.productLifecycle?.selectedMaterialIds || []
    : overrideIds;
  return new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean));
}

export function countAcademicContextMaterials(state = {}, { selectedMaterialIds = null } = {}) {
  const selectedIds = selectedContextIds(state, selectedMaterialIds);
  const knownClassroomIds = new Set([
    ...(state.classroomItems || []).map((item) => String(item.id)),
    ...(state.assignments || []).filter(isClassroomRecord).map((item) => String(item.id)),
    ...(state.sourceMaterials || []).filter(isClassroomRecord).map((item) => String(item.id)),
  ]);
  const importedClassroomIds = (state.classroomItems || [])
    .filter((item) => item.academicContextIncluded === true && item.selectionState === "imported")
    .map((item) => String(item.id));
  const uploadedIds = activeSources(state)
    .filter((source) => !isClassroomRecord(source))
    .map((source) => String(source.id));
  const selectedKnownIds = [...selectedIds].filter((id) => knownClassroomIds.has(id));
  return new Set([
    ...uploadedIds,
    ...(selectedMaterialIds === null ? importedClassroomIds : selectedKnownIds),
  ]).size;
}

export function getResolvedProductAccess(state = {}) {
  const entitlements = resolveEntitlements(state);
  const lifecycle = getProductLifecycleSnapshot(state);
  const activePlanKey = entitlements.activePlanKey || null;
  return {
    entitlements,
    lifecycle,
    activePlanKey,
    planReady: Boolean(activePlanKey),
    workspaceReady: lifecycle.dashboardActive === true && Boolean(activePlanKey),
  };
}

export function getAcademicContextCapacity(state = {}, { selectedMaterialIds = null } = {}) {
  const access = getResolvedProductAccess(state);
  const limit = Number(getPlanEntitlements(access.activePlanKey).hiddenLimits.maxSources || 0);
  const used = countAcademicContextMaterials(state, { selectedMaterialIds });
  const warningPercent = Number(getPlanEntitlements(access.activePlanKey).academicContext.capacityWarningAtPercent || 90);
  const ratio = limit > 0 ? used / limit : 1;
  const status = !access.planReady
    ? "unavailable"
    : ratio >= 1
      ? "full"
      : ratio >= warningPercent / 100
        ? "almost_full"
        : "available";
  const message = status === "unavailable"
    ? ACADEMIC_CONTEXT_COPY.pending
    : status === "full"
      ? ACADEMIC_CONTEXT_COPY.full
      : status === "almost_full"
        ? ACADEMIC_CONTEXT_COPY.almostFull
        : ACADEMIC_CONTEXT_COPY.available;
  return {
    status,
    message,
    canAdd: status === "available" || status === "almost_full",
    used,
    limit,
    planReady: access.planReady,
  };
}

export function getPublicAcademicContextCapacity(state = {}) {
  const capacity = getAcademicContextCapacity(state);
  return {
    status: capacity.status,
    message: capacity.message,
    canAdd: capacity.canAdd,
  };
}

export function assertAcademicContextCanAdd(state = {}) {
  const capacity = getAcademicContextCapacity(state);
  if (!capacity.planReady) throw productError(ACADEMIC_CONTEXT_COPY.pending, 403, "plan_setup_pending");
  if (!capacity.canAdd) throw productError(ACADEMIC_CONTEXT_COPY.full, 409, "academic_context_full");
  return capacity;
}

export function assertAcademicContextSelection(state = {}, selectedMaterialIds = []) {
  const current = getAcademicContextCapacity(state);
  if (!current.planReady) throw productError(ACADEMIC_CONTEXT_COPY.pending, 403, "plan_setup_pending");
  const proposed = getAcademicContextCapacity(state, { selectedMaterialIds });
  if (proposed.used > proposed.limit) {
    throw productError(ACADEMIC_CONTEXT_COPY.full, 409, "academic_context_full");
  }
  return proposed;
}

export function assertProductFeatureAccess(state = {}, featureKey, {
  message = "This feature is available on a different StudentOS plan. Review plans to continue.",
  requireWorkspace = true,
} = {}) {
  const access = getResolvedProductAccess(state);
  if (!access.planReady) throw productError("Plan setup pending. Finish setup before using this feature.", 403, "plan_setup_pending");
  if (requireWorkspace && !access.workspaceReady) {
    throw productError("Complete StudentOS setup before using the academic workspace.", 403, "workspace_setup_pending");
  }
  if (!canUseFeature(access.activePlanKey, featureKey)) {
    throw productError(message, 403, "plan_upgrade_available");
  }
  return access;
}

export function getAssistantExecutionPolicy(state = {}) {
  const access = getResolvedProductAccess(state);
  const policy = getAssistantPolicy(access.activePlanKey);
  const retrievalLimitByDepth = { guided: 3, expanded: 4, deep: 5, strongest: 6 };
  const responseGuidanceByDepth = {
    guided: "Keep the response compact, guided, and focused on one clear next step.",
    expanded: "Give a clear explanation with a short study structure and practical next steps.",
    deep: "Allow a deeper explanation and a stronger study plan while staying concise.",
    strongest: "Give the strongest available explanation, planning detail, and review guidance without unnecessary repetition.",
  };
  return {
    enabled: access.workspaceReady && policy.enabled === true,
    depth: policy.depth,
    responseGuidance: responseGuidanceByDepth[policy.depth] || responseGuidanceByDepth.guided,
    retrievalLimit: retrievalLimitByDepth[policy.depth] || 3,
    flashcardsEnabled: canUseFeature(access.activePlanKey, FEATURE_KEYS.FLASHCARDS),
    visualNotesEnabled: canUseFeature(access.activePlanKey, FEATURE_KEYS.NOTES_VISUALS),
  };
}

export function getProductClassroomPolicy(state = {}) {
  const access = getResolvedProductAccess(state);
  return {
    ...getClassroomSyncPolicy(access.activePlanKey),
    planReady: access.planReady,
  };
}

export function getPublicProductCapabilities(state = {}) {
  const access = getResolvedProductAccess(state);
  const summary = getPublicEntitlementSummary(access.activePlanKey);
  const enabled = (featureKey) => access.workspaceReady && canUseFeature(access.activePlanKey, featureKey);
  return {
    status: access.workspaceReady ? "ready" : access.planReady ? "setup_pending" : "plan_setup_pending",
    message: access.workspaceReady ? "Your plan features are ready." : "Plan setup pending",
    workspaceReady: access.workspaceReady,
    assistant: {
      enabled: access.workspaceReady && summary.assistant.enabled,
      depth: summary.assistant.depth,
    },
    classroom: {
      manualChecksEnabled: access.planReady && summary.classroom.manualImportEnabled,
      automaticChecksEnabled: access.planReady && summary.classroom.automaticChecksEnabled,
      cadence: summary.classroom.cadence,
      readOnly: true,
    },
    features: {
      adaptiveRoadmap: enabled(FEATURE_KEYS.ROADMAP_ADAPTIVE),
      expandedAssessments: enabled(FEATURE_KEYS.ASSESSMENT_EXPANDED),
      notes: enabled(FEATURE_KEYS.NOTES_GENERATION),
      visualNotes: enabled(FEATURE_KEYS.NOTES_VISUALS),
      flashcards: enabled(FEATURE_KEYS.FLASHCARDS),
      learningLevel: enabled(FEATURE_KEYS.LEARNING_LEVEL),
      consistencyPoints: enabled(FEATURE_KEYS.CONSISTENCY_POINTS),
      assignmentCoach: enabled(FEATURE_KEYS.ASSIGNMENT_COACH),
      assignmentReview: enabled(FEATURE_KEYS.ASSIGNMENT_REVIEW),
    },
    assignment: {
      studentReviewRequired: true,
      writebackEnabled: false,
      automaticSubmissionEnabled: false,
    },
  };
}
