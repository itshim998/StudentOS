import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyTestScore,
  buildExtensionDecisionDraft,
  createAssignmentAutomationContractForState,
  createTutorLesson,
  determineAssignmentCoverage,
  getAssignmentInsights,
  getCreditBalance,
  getGroundingContext,
  getSafeStudentProfile,
  getTodayNextActions,
  handleAssignmentLearningFlow,
} from "./domain/studentosDomain.js";
import {
  applyStudentOnboarding,
  bindProductOnboardingStep,
  hydrateSavedProductOnboarding,
  refreshAcademicRoadmap,
} from "./domain/onboardingService.js";
import { markPlanningStateCurrent, markPlanningStateStale } from "./domain/planningStateService.js";
import { publicTopicPerformance } from "./domain/topicPerformanceService.js";
import {
  addManualCourse,
  archiveManualCourse,
  updateManualCourse,
} from "./domain/courseManagementService.js";
import {
  applyProductLifecycleAction,
  getProductFlowConfig,
  getProductLifecycleSnapshot,
  markProductClassroomConnected,
  requireProductClassroomSyncAccess,
  requireProductMaterialAccess,
  requireDashboardActive,
} from "./domain/productLifecycleService.js";
import {
  FEATURE_KEYS,
  PLAN_KEYS,
  getPublicEntitlementSummary,
  getPublicPlanSummary,
  normalizePlanKey,
} from "./domain/planEntitlementService.js";
import {
  assertAcademicContextCanAdd,
  assertAcademicContextSelection,
  assertProductFeatureAccess,
  getAssistantExecutionPolicy,
  getProductClassroomPolicy,
  getPublicAcademicContextCapacity,
  getPublicProductCapabilities,
} from "./domain/productFeatureAccessService.js";
import {
  addManualExam,
  advanceAcademicContextPreparation,
  applyAcademicContextDeletion,
  beginAcademicContextPreparation,
  beginSelectedClassroomContentBackfill,
  buildAcademicContextDeletionPlan,
  getAcademicContextReadiness,
  linkManualAcademicContextUpload,
  markAcademicContextNeedsPreparation,
  removeManualExam,
  updateManualExam,
  validateManualAcademicContextContract,
} from "./domain/academicContextService.js";
import { getRequestSession } from "./auth/session.js";
import {
  getPublicAuthConfig,
  getSafeSupabaseStatus,
  getSupabaseEnvironment,
  loadDotEnv,
} from "./config/supabaseEnv.js";
import {
  getPublicSaasStatus,
  getSaasConfig,
  validateProductionReadiness,
} from "./config/saasConfig.js";
import { MockGoogleClassroomConnector } from "./connectors/googleClassroomMock.js";
import { getGoogleClassroomConfig } from "./connectors/googleClassroom/config.js";
import {
  buildClassroomOAuthUrl,
  createClassroomOAuthState,
  exchangeClassroomOAuthCode,
  fetchGoogleOAuthProfile,
  verifyClassroomOAuthState,
} from "./connectors/googleClassroom/oauth.js";
import {
  disconnectGoogleClassroom,
  backfillSelectedClassroomContentIntoState,
  getClassroomConnectorStatus,
  markClassroomConnected,
  shouldRunAutomaticClassroomCheck,
  syncGoogleClassroomIntoState,
} from "./connectors/googleClassroom/syncService.js";
import {
  getClassroomDueWork,
  getClassroomTodayAction,
  ignoreClassroomItemsForAcademicContext,
  isAcademicContextRecord,
  selectClassroomItemsForAcademicContext,
} from "./connectors/googleClassroom/mapper.js";
import { savePersistentClassroomToken } from "./connectors/googleClassroom/tokenStore.js";
import { runStudentOsVerb } from "./ai/studentBrainAdapter.js";
import { generateDailyTodoPlan } from "./ai/dailyTodoService.js";
import {
  completeCurrentMasteryTarget,
  activeMasteryTopic,
  ensureDailyTodoStudyState,
  ensureTopicMasteryQueue,
  findDailyTodoItem,
  generateStudyMaterial,
  isActiveTopicTestUnlocked,
  nextPendingMasteryTarget,
  updateDailyTodoStudyStatus,
} from "./ai/studyMaterialService.js";
import {
  findStudyTestSession,
  finishStudyTestSession,
  generateStudyTest,
  publicTestSession,
  saveStudyTestAnswers,
  startStudyTestSession,
  synchronizeTestSession,
} from "./ai/studyTestService.js";
import {
  ANSWER_SHEET_COPY,
  MAX_ANSWER_SHEET_BYTES,
  applyStudyTestEvaluation,
  evaluateStudyTest,
  extractStudyAnswerSheet,
} from "./ai/studyTestEvaluationService.js";
import { getSafeAiProviderStatus, getAiProviderConfig } from "./ai/providerConfig.js";
import { getRecoveryConfig } from "./recovery/recoveryConfig.js";
import {
  applyRecoveryPreview,
  createCurrentPlanVersion,
  publicRecoveryPreview,
  publicRecoveryRun,
  queueAutomaticRecovery,
  queueRecoveryAnalysis,
  rejectRecoveryPreview,
} from "./recovery/recoveryEngineService.js";
import { RecoveryAnalyzeInputSchema, EmptyRecoveryMutationSchema } from "./recovery/recoverySchemas.js";
import { RECOVERY_FAILURES, RecoveryError, assertRecoveryEnabled, recoveryErrorEnvelope } from "./recovery/recoveryErrors.js";
import { ensureRecoveryCollections, recordAcademicEvent } from "./recovery/academicStateBuilder.js";
import { markRecoveryTaskProgress } from "./recovery/recoveryPolicy.js";
import {
  AI_ALLOWANCE_COPY,
  buildPublicAiAllowance,
  classifyAiTask,
  getAiWeeklyAllowance,
  getAiWeeklyPeriod,
  getDeterministicAiResponse,
} from "./ai/aiWeeklyAllowanceService.js";
import {
  executeAuthorizedAiOperation,
  fingerprintAiOperation,
  getAiOperationId,
  isProviderCycleEnabledForUser,
} from "./ai/authorizedAiExecutionService.js";
import {
  contentHash,
  embedSourceChunks,
  getEmbeddingConfig,
  getSafeEmbeddingStatus,
  reindexSourceChunkEmbeddings,
} from "./embeddings/embeddingService.js";
import { createSupabaseClients } from "./supabase/clients.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import {
  createBackgroundJob,
  retryFailedJobs,
  summarizeJobsForSource,
} from "./jobs/jobService.js";
import { buildQueueHealth, recordJobEvent } from "./jobs/jobObservability.js";
import { getSourceStoragePlan } from "./storage/sourceStoragePlan.js";
import { readMultipartForm } from "./http/multipart.js";
import {
  createMemoryItemForSource,
  createEmbeddingMetadataForChunks,
  createSourceMaterialRecord,
  createSourceChunks,
  chunkExtractedText,
  extractSourceText,
  MAX_SOURCE_UPLOAD_BYTES,
  validateAcademicContextPdfUpload,
} from "./storage/sourceMaterialService.js";
import {
  buildSourceCleanupPlan,
  hardDeleteSourceState,
  softDeleteSourceState,
} from "./storage/sourceCleanupService.js";
import { createLogger, createRequestId, redactSecrets } from "./observability/logger.js";
import { InMemoryRateLimiter } from "./security/rateLimiter.js";
import { assertUsageAllowed, checkUsagePolicy } from "./security/usagePolicy.js";
import {
  OPERATOR_PERMISSIONS,
  createOperatorSession,
  getOperatorRbacConfig,
  getSafeOperatorRbacStatus,
  operatorHasPermission,
  refreshOperatorSession,
  verifyOperatorSession,
} from "./security/operatorRbac.js";
import {
  assertOperatorMfaSatisfied,
  createOperatorMfaChallenge,
  getOperatorMfaConfig,
  getSafeOperatorMfaStatus,
  verifyOperatorMfaChallenge,
} from "./security/operatorMfa.js";
import {
  buildBillingCancellationEvent,
  buildOperatorAuditEvent,
} from "./observability/operatorAuditService.js";
import {
  getAccountSnapshot,
  requestPasswordReset,
  requestVerificationResend,
  updateConsentPreferences,
} from "./account/accountService.js";
import {
  buildInternalOpsSnapshot,
  createConsentWithdrawalRequest,
  createDataExportWorkflow,
  createDeletionWorkflow,
  createRoleInvitationGroundwork,
  getAccountLifecycleConfig,
  getLifecycleSnapshot,
  getPublicLifecycleConfig,
  recordLegalAcceptance,
} from "./account/lifecycleService.js";
import {
  authorizeExportDownload,
  getDataExportConfig,
  getPublicDataExportConfig,
  recordExportDownloaded,
} from "./account/exportService.js";
import { buildDeletionDryRunReport } from "./account/deletionDryRunService.js";
import { runExportRetentionCleanup } from "./account/exportRetentionService.js";
import { recordDeletionApprovalScaffold } from "./account/operatorReviewService.js";
import {
  executeFinalDeletion,
  getFinalDeletionSafetyConfig,
  getPublicFinalDeletionSafetyStatus,
} from "./account/deletionExecutionService.js";
import { getBillingProviderConfig, getPublicBillingProviderStatus, getSafeBillingProviderStatus } from "./billing/providerConfig.js";
import { createBillingAdapter } from "./billing/providers.js";
import {
  evaluateBillingCancellation,
  getBillingCancellationConfig,
  getSafeBillingCancellationStatus,
} from "./billing/cancellationService.js";
import {
  ALERT_TYPES,
  createLogAlertSink,
  createMonitoringAlert,
  emitMonitoringAlert,
  getMonitoringAlertConfig,
  getSafeMonitoringAlertStatus,
} from "./monitoring/alertService.js";
import {
  ensureBillingState,
  getBillingSnapshot,
  normalizeProviderWebhook,
  processBillingWebhook,
  resolveEntitlements,
} from "./billing/billingService.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = normalize(join(__dirname, ".."));
const FRONTEND_ROOT = join(ROOT, "frontend");
loadDotEnv({ cwd: ROOT });

const supabaseConfig = getSupabaseEnvironment();
const aiProviderConfig = getAiProviderConfig();
const recoveryConfig = getRecoveryConfig();
const embeddingConfig = getEmbeddingConfig();
const billingProviderConfig = getBillingProviderConfig();
const googleClassroomConfig = getGoogleClassroomConfig();
const saasConfig = getSaasConfig({
  supabaseConfig,
  aiConfig: aiProviderConfig,
  embeddingConfig,
  billingConfig: billingProviderConfig,
});
const productFlowConfig = getProductFlowConfig(process.env, saasConfig.deployment);
const publicFrontendUrl = (() => {
  const configured = String(process.env.STUDENTOS_PUBLIC_FRONTEND_URL || "").trim();
  const fallback = saasConfig.deployment === "production"
    ? saasConfig.corsOrigins.find((origin) => origin.startsWith("https://")) || "https://studentos.sentiqlabs.com"
    : "/";
  if (!configured) return fallback;
  try {
    const parsed = new URL(configured);
    if (!["http:", "https:"].includes(parsed.protocol)) return fallback;
    return parsed.origin;
  } catch {
    return fallback;
  }
})();
const billingAdapter = createBillingAdapter(billingProviderConfig);
const lifecycleConfig = getAccountLifecycleConfig();
const dataExportConfig = getDataExportConfig(process.env, supabaseConfig);
const finalDeletionConfig = getFinalDeletionSafetyConfig();
const operatorRbacConfig = getOperatorRbacConfig();
const operatorMfaConfig = getOperatorMfaConfig();
const billingCancellationConfig = getBillingCancellationConfig();
const monitoringAlertConfig = getMonitoringAlertConfig();
const logger = createLogger({ env: saasConfig.deployment });
const alertSink = createLogAlertSink(logger);
const rateLimiter = new InMemoryRateLimiter(saasConfig.rateLimit);
const supabaseClients = createSupabaseClients(supabaseConfig);
const STUDENTOS_APP_PASS = "30";
const repository = new StudentOsRepository({
  config: supabaseConfig,
  shardClients: supabaseClients.shardClients,
});

const PORT = Number(process.env.STUDENTOS_PORT || process.env.PORT || 3101);
const DEPLOYMENT_TARGET = String(process.env.STUDENTOS_DEPLOYMENT || "local").trim() || "local";
const SERVE_FRONTEND = DEPLOYMENT_TARGET !== "azure-container-apps" && process.env.STUDENTOS_SERVE_FRONTEND !== "false";
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const SOURCE_UPLOAD_STAGE_TIMEOUT_MS = Number(process.env.STUDENTOS_SOURCE_UPLOAD_STAGE_TIMEOUT_MS || 20000);
const SOURCE_UPLOAD_PARSE_TIMEOUT_MS = Number(process.env.STUDENTOS_SOURCE_UPLOAD_PARSE_TIMEOUT_MS || 15000);
const studyTestEvaluationsInFlight = new Set();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function corsOriginForRequest(req) {
  const origin = req.headers.origin || "";
  if (saasConfig.deployment !== "production") return origin || "*";
  if (origin && saasConfig.corsOrigins.includes(origin)) return origin;
  return "";
}

function createStageTimeoutError(stage, timeoutMs) {
  const error = new Error(`StudentOS request did not finish during ${stage}. Try again after checking storage and shard connectivity.`);
  error.status = 504;
  error.uploadStage = stage;
  error.timeoutMs = timeoutMs;
  return error;
}

async function withUploadStageTimeout(stage, action, { timeoutMs = SOURCE_UPLOAD_STAGE_TIMEOUT_MS, onTimeout } = {}) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        if (typeof onTimeout === "function") onTimeout();
      } catch {
        // Timeout cleanup is best-effort only.
      }
      reject(createStageTimeoutError(stage, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(action), timeout]);
  } catch (error) {
    if (!error.uploadStage) error.uploadStage = stage;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function runUploadStage(req, stage, action, options = {}) {
  const startedAt = Date.now();
  logger.info("source_upload.stage.started", {
    requestId: req.requestId,
    stage,
  });
  try {
    const result = await withUploadStageTimeout(stage, action, options);
    logger.info("source_upload.stage.completed", {
      requestId: req.requestId,
      stage,
      ms: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.warn("source_upload.stage.failed", {
      requestId: req.requestId,
      stage,
      status: error.status || 500,
      ms: Date.now() - startedAt,
      error: error.message,
    });
    throw error;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Request-Id": res.requestId || "",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-StudentOS-Internal-Token",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };
  if (res.corsOrigin) headers["Access-Control-Allow-Origin"] = res.corsOrigin;
  res.writeHead(status, headers);
  res.end(body);
}

function sendPrivateDownload(res, bytes, filename = "studentos-export.json") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(bytes.length),
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": res.requestId || "",
    "Vary": "Origin",
  };
  if (res.corsOrigin) headers["Access-Control-Allow-Origin"] = res.corsOrigin;
  res.writeHead(200, headers);
  res.end(bytes);
}

function sendPrivateMaterial(res, bytes, filename = "study-material.pdf", mimeType = "application/pdf") {
  const safeFilename = String(filename || "study-material.pdf").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160);
  const headers = {
    "Content-Type": mimeType || "application/pdf",
    "Content-Disposition": `inline; filename="${safeFilename}"`,
    "Content-Length": String(bytes.length),
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": res.requestId || "",
    "Vary": "Origin",
  };
  if (res.corsOrigin) headers["Access-Control-Allow-Origin"] = res.corsOrigin;
  res.writeHead(200, headers);
  res.end(bytes);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": res.requestId || "",
  });
  res.end(html);
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

async function readJsonBody(req) {
  const raw = await readTextBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

async function readTextBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error("JSON body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw;
}

async function getStateContext(req) {
  const session = await getRequestSession(req, {
    config: supabaseConfig,
    authClient: supabaseClients.authClient,
  });
  const state = await repository.loadState(session);
  if (hydrateSavedProductOnboarding(state)) {
    await repository.saveState(session, state);
  }
  await ensureIndexedChunkEmbeddings(session, state);
  return {
    session,
    state,
    persistence: repository.getInfo(session),
  };
}

async function ensureIndexedChunkEmbeddings(session, state) {
  const candidates = (state.sourceChunks || []).filter((chunk) => {
    if (chunk.deletedAt || chunk.status === "deleted") return false;
    const text = chunk.text || chunk.chunkText || "";
    if (!text || chunk.status !== "indexed") return false;
    return chunk.embeddingStatus !== "embedded" ||
      chunk.embeddingHash !== contentHash(text) ||
      !Array.isArray(chunk.embeddingVector);
  });
  if (!candidates.length) return;
  await embedSourceChunks({ sourceChunks: candidates });
  const metadataById = new Map((state.embeddingsMetadata || []).map((item) => [item.id, item]));
  for (const row of createEmbeddingMetadataForChunks({
    material: { id: null, userId: state.studentProfile.id },
    sourceChunks: candidates,
  })) {
    const existing = metadataById.get(row.id);
    if (existing) {
      Object.assign(existing, row);
    } else {
      state.embeddingsMetadata.push(row);
    }
  }
  await repository.saveSourceIngestion(session, state);
}

function publicState(state, persistence) {
  const creditBalance = getCreditBalance(state);
  const lifecycle = getLifecycleSnapshot(state, lifecycleConfig);
  const productLifecycle = getProductLifecycleSnapshot(state);
  const resolvedPlan = resolveEntitlements(state);
  const selectedPlanKey = normalizePlanKey(productLifecycle.selectedPlanId) || resolvedPlan.selectedPlanKey;
  const activePlanKey = resolvedPlan.activePlanKey;
  const classroomPolicy = getProductClassroomPolicy(state);
  const courses = (state.courses || []).filter(isAcademicContextRecord);
  const topics = (state.topics || []).filter(isAcademicContextRecord).map((topic) => {
    const { legacyWeakSignals, legacyWeakTopicSource, ...safeTopic } = topic;
    return { ...safeTopic, performance: publicTopicPerformance(topic) };
  });
  const assignments = (state.assignments || []).filter(isAcademicContextRecord);
  const roadmap = (state.roadmap || []).filter((item) => !item.archived && item.status !== "archived").map((item) => {
    const { supportingTestResultIds, ...safeItem } = item;
    return safeItem;
  });
  const dueWork = getClassroomDueWork(state, {
    includeDiscoveredReview: classroomPolicy.courseworkReviewEnabled === true && classroomPolicy.autoCheckEnabled === true,
  });
  return {
    ...state,
    courses,
    topics,
    assignments,
    roadmap,
    testResults: (state.testResults || []).map((result) => {
      const { topicEvidence, ...safeResult } = result;
      return safeResult;
    }),
    testSessions: (state.testSessions || []).filter(isAcademicContextRecord).map((session) => publicTestSession(session)),
    revisionEvents: (state.revisionEvents || []).filter(isAcademicContextRecord),
    tutorLessons: (state.tutorLessons || []).filter(isAcademicContextRecord),
    assignmentAutomationContracts: (state.assignmentAutomationContracts || []).filter(isAcademicContextRecord),
    memoryItems: (state.memoryItems || []).filter(isAcademicContextRecord),
    classroomItems: (state.classroomItems || [])
      .filter((item) => item.selectionState !== "archived")
      .filter((item) => classroomPolicy.courseworkReviewEnabled === true || item.academicContextIncluded === true)
      .map((item) => ({
        id: item.id,
        itemType: item.itemType,
        title: item.title,
        courseTitle: item.courseTitle,
        dueAt: item.dueAt || null,
        postedAt: item.postedAt || null,
        providerUpdatedAt: item.providerUpdatedAt || null,
        submissionState: item.submissionState || null,
        handedIn: item.handedIn === true,
        pendingClassroomWork: item.pendingClassroomWork === true,
        selectionState: item.selectionState,
        academicContextIncluded: item.academicContextIncluded === true,
        readOnly: true,
      })),
    studentProfile: getSafeStudentProfile(state.studentProfile, creditBalance),
    sourceMaterials: (state.sourceMaterials || []).filter(isAcademicContextRecord).map((source) => {
      const {
        storageBucket,
        storagePath,
        storageMode,
        sizeBytes,
        chunkCount,
        embeddingStatus,
        extractedText,
        extractionProvider,
        ...safeSource
      } = source;
      return {
        ...safeSource,
        isPrivate: Boolean(storageBucket || storagePath),
        readyForStudy: source.status === "indexed" || source.status === "ready" || Number(chunkCount || 0) > 0,
        extractedSnippet: extractedText ? String(extractedText).slice(0, 180) : "",
      };
    }),
    sourceChunks: [],
    embeddingsMetadata: [],
    backgroundJobs: (state.backgroundJobs || []).map((job) => {
      const { payload, ...safeJob } = job;
      return safeJob;
    }),
    jobEvents: [],
    auditLog: [],
    billingSubscriptions: (state.billingSubscriptions || []).map((subscription) => {
      const { provider, providerCustomerId, providerSubscriptionId, payload, ...safeSubscription } = subscription;
      return safeSubscription;
    }),
    billingWebhookEvents: [],
    dataExportRequests: lifecycle.exportRequests,
    dataExportJobs: lifecycle.exportJobs,
    accountDeletionRequests: lifecycle.deletionRequests,
    accountDeletionReviews: [],
    creditBalance,
    assignmentInsights: getAssignmentInsights(state),
    todayNextActions: getTodayNextActions(state),
    academicContext: getAcademicContextReadiness(state),
    todayPlan: ensureDailyTodoStudyState(state.studentProfile?.dailyTodoPlan) || null,
    classroomDueWork: dueWork,
    todayDoNow: getClassroomTodayAction(state, {
      includeDiscoveredReview: classroomPolicy.courseworkReviewEnabled === true && classroomPolicy.autoCheckEnabled === true,
    }),
    queueHealth: buildQueueHealth(state.backgroundJobs || []),
    persistence: publicRetrievalStatus(persistence),
    productLifecycle,
    planAccess: {
      selectedPlanKey,
      activePlanKey,
      accessMode: productLifecycle.accessMode || null,
      selectedPlan: getPublicPlanSummary(selectedPlanKey),
      entitlements: getPublicEntitlementSummary(activePlanKey),
      capabilities: getPublicProductCapabilities(state),
      academicContext: getPublicAcademicContextCapacity(state),
      dashboardAccess: productLifecycle.dashboardActive === true && Boolean(activePlanKey),
    },
    saas: getPublicSaasStatus(saasConfig),
    storagePlan: getSourceStoragePlan(supabaseConfig),
    internalMetricsHidden: true,
  };
}

async function readRecoveryBody(req, schema) {
  const parsed = schema.safeParse(await readJsonBody(req));
  if (parsed.success) return parsed.data;
  throw new RecoveryError(RECOVERY_FAILURES.INPUT_INVALID, "Recovery request input is invalid.", { correlationId: req.requestId });
}

const RECOVERY_DELTA_COLLECTIONS = Object.freeze([
  "academicEvents",
  "academicStateSnapshots",
  "topicRecoveryStates",
  "topicRecoveryStateHistory",
  "recoveryRuns",
  "recoveryPreviews",
  "planVersions",
]);

function captureRecoveryBaseline(state) {
  const baseline = {};
  for (const key of ["recoveryUserStates", ...RECOVERY_DELTA_COLLECTIONS, "backgroundJobs"]) {
    baseline[key] = new Map((state[key] || []).filter((item) => item?.id).map((item) => [item.id, JSON.stringify(item)]));
  }
  return baseline;
}

function recoveryChangesSince(state, baseline) {
  const changes = {};
  for (const key of RECOVERY_DELTA_COLLECTIONS) {
    changes[key] = (state[key] || []).filter((item) => item?.id && baseline?.[key]?.get(item.id) !== JSON.stringify(item));
  }
  changes.backgroundJobs = (state.backgroundJobs || []).filter((item) => (
    item?.id && item.jobType === "recovery_analysis" && item.status === "queued" && Number(item.attempts || 0) === 0
    && baseline?.backgroundJobs?.get(item.id) !== JSON.stringify(item)
  ));
  const userState = ensureRecoveryCollections(state);
  changes.userState = baseline?.recoveryUserStates?.get(userState.id) !== JSON.stringify(userState) ? userState : null;
  return changes;
}

function copyPersistedRecoveryState(target, source) {
  target.recoveryUserStates = source.recoveryUserStates;
  for (const key of RECOVERY_DELTA_COLLECTIONS) target[key] = source[key];
  const ordinaryJobs = (target.backgroundJobs || []).filter((job) => job.jobType !== "recovery_analysis");
  target.backgroundJobs = [...ordinaryJobs, ...(source.backgroundJobs || []).filter((job) => job.jobType === "recovery_analysis")];
}

function rebuildRecoveryChangesOnLatest(latest, originalChanges) {
  const userState = ensureRecoveryCollections(latest);
  const academicEvents = [];
  for (const event of originalChanges.academicEvents || []) {
    const existing = latest.academicEvents.find((item) => item.idempotencyKey === event.idempotencyKey);
    if (existing) continue;
    latest.academicEvents.push(event);
    academicEvents.push(event);
    userState.academicRevision += 1;
  }
  const topicRecoveryStates = [];
  for (const candidate of originalChanges.topicRecoveryStates || []) {
    const index = latest.topicRecoveryStates.findIndex((item) => item.id === candidate.id);
    if (index >= 0 && Number(latest.topicRecoveryStates[index].version || 0) >= Number(candidate.version || 0)) continue;
    if (index >= 0) latest.topicRecoveryStates[index] = candidate;
    else latest.topicRecoveryStates.push(candidate);
    topicRecoveryStates.push(candidate);
  }
  const topicRecoveryStateHistory = [];
  for (const history of originalChanges.topicRecoveryStateHistory || []) {
    if (latest.topicRecoveryStateHistory.some((item) => item.id === history.id)) continue;
    latest.topicRecoveryStateHistory.push(history);
    topicRecoveryStateHistory.push(history);
  }
  const planVersions = [];
  if ((originalChanges.planVersions || []).length) {
    const source = originalChanges.planVersions.at(-1)?.source || "recovery_reconciled_change";
    const before = latest.planVersions.length;
    createCurrentPlanVersion(latest, { source });
    planVersions.push(...latest.planVersions.slice(before));
  }
  const run = academicEvents.length ? queueAutomaticRecovery(latest, {
    correlationId: originalChanges.recoveryRuns?.[0]?.correlationId || null,
  }) : null;
  const backgroundJob = run
    ? latest.backgroundJobs.find((job) => job.jobType === "recovery_analysis" && job.payload?.runId === run.id && job.status === "queued")
    : null;
  userState.updatedAt = new Date().toISOString();
  return {
    userState: academicEvents.length || planVersions.length ? userState : null,
    academicEvents,
    topicRecoveryStates,
    topicRecoveryStateHistory,
    recoveryRuns: run ? [run] : [],
    planVersions,
    backgroundJobs: backgroundJob && Number(backgroundJob.attempts || 0) === 0 ? [backgroundJob] : [],
  };
}

async function persistRecoveryAwareMutation({ repository, session, state, baseline, ordinarySave, correlationId }) {
  await ordinarySave();
  if (!baseline) return;
  const changes = recoveryChangesSince(state, baseline);
  try {
    await repository.saveRecoveryChanges(session, state, changes);
    return;
  } catch (error) {
    if (error?.code === RECOVERY_FAILURES.CONCURRENCY_CONFLICT) {
      try {
        const latest = await repository.loadState(session);
        const retryChanges = rebuildRecoveryChangesOnLatest(latest, changes);
        await repository.saveRecoveryChanges(session, latest, retryChanges);
        copyPersistedRecoveryState(state, latest);
        return;
      } catch {
        // The ordinary mutation is authoritative and already persisted. Recovery remains auxiliary.
      }
    }
    const latest = await repository.loadState(session).catch(() => null);
    if (latest) copyPersistedRecoveryState(state, latest);
    console.warn(JSON.stringify({
      event: "adaptive_recovery.hook_persistence_failed",
      correlationId: String(correlationId || "").slice(0, 180),
      retryable: true,
      secretsPrinted: false,
    }));
  }
}

function getPublicAiStatus(config) {
  const realConfigured = Boolean(config?.groq?.configured || config?.gemini?.configured || config?.pollinations?.configured);
  return {
    label: "StudentOS AI",
    configured: realConfigured,
    fallbackAvailable: true,
    secretsExposed: false,
  };
}

function getPublicEmbeddingStatus(config) {
  return {
    label: "Study context",
    configured: Boolean(config?.realConfigured),
    indexedSectionsReady: true,
    secretsExposed: false,
  };
}

function publicAiResult(result = {}) {
  const {
    mode,
    poweredBy,
    provider,
    modelUsed,
    fallback,
    citationValidation,
    webFallback,
    internalFailureCode,
    grounding = {},
    ...safeResult
  } = result;
  const authoritativeSnippets = grounding.uploadedMaterialUsed === true &&
    grounding.confidence?.lowConfidence !== true
    ? grounding.snippets || []
    : [];
  return {
    ...safeResult,
    sourceLabels: authoritativeSnippets.length ? safeResult.sourceLabels || [] : [],
    engineLabel: "StudentOS AI",
    grounding: {
      uploadedMaterialUsed: authoritativeSnippets.length > 0,
      insufficientContext: grounding.insufficientContext === true,
      insufficiencyReason: grounding.insufficiencyReason || null,
      snippets: authoritativeSnippets.map((item) => ({
        citationLabel: item.citationLabel || null,
        sourceTitle: item.sourceTitle || null,
        snippet: item.snippet || "",
      })),
    },
  };
}

function publicRetrievalStatus(info = {}) {
  const mode = String(info?.mode || "").toLowerCase();
  return {
    mode: mode === "supabase" ? "private_cloud_sync" : "local_preview",
    shard: info?.shard ? { label: "StudentOS workspace" } : null,
  };
}

function publicBillingPreview(result = {}, action = "checkout") {
  const { provider, message, ...safeResult } = result;
  return {
    ...safeResult,
    status: result.status === "provider_configuration_ready" ? "payment_setup_ready" : result.status,
    billingLabel: "StudentOS billing",
    message: result.redirectAllowed
      ? "A payment preview is ready. No payment is completed from StudentOS until checkout is active."
      : action === "manage"
        ? "Payments are not active yet, so no billing portal was opened."
        : "Payments are not active yet, so no checkout was opened.",
  };
}

function publicClassroomSummary(summary = null) {
  if (!summary) return null;
  return {
    discoveredCourses: summary.discoveredCourses || 0,
    discoveredAssignments: summary.discoveredAssignments || 0,
    updatedAssignments: summary.updatedAssignments || 0,
    discoveredMaterials: summary.discoveredMaterials || 0,
    updatedMaterials: summary.updatedMaterials || 0,
    removedAssignmentCandidates: summary.removedAssignmentCandidates || 0,
    deactivatedImportedAssignments: summary.deactivatedImportedAssignments || 0,
    reconciliationApplied: summary.reconciliationApplied === true,
    selectedItems: summary.selectedItems || 0,
    skippedItems: summary.skippedItems || 0,
    evictedAssignments: summary.evictedAssignments || 0,
    evictedMaterials: summary.evictedMaterials || 0,
    retentionApplied: summary.retentionApplied === true,
    googleClassroomDeleted: false,
    emptyClassroom: summary.emptyClassroom === true,
    courseOnly: summary.courseOnly === true,
  };
}

function publicClassroomSyncRun(run = {}) {
  return {
    status: run.status || "unknown",
    startedAt: run.startedAt || null,
    completedAt: run.completedAt || null,
    discoveredCourses: run.payload?.discoveredCourses || 0,
    discoveredAssignments: run.payload?.discoveredAssignments || 0,
    updatedAssignments: run.updatedAssignments || 0,
    discoveredMaterials: run.payload?.discoveredMaterials || 0,
    updatedMaterials: run.updatedMaterials || 0,
    skippedItems: run.skippedItems || 0,
    errorCount: run.errorCount || 0,
    emptyClassroom: run.payload?.emptyClassroom === true,
    courseOnly: run.payload?.courseOnly === true,
    removedAssignmentCandidates: run.payload?.removedAssignmentCandidates || 0,
    deactivatedImportedAssignments: run.payload?.deactivatedImportedAssignments || 0,
    reconciliationApplied: run.payload?.reconciliationApplied === true,
  };
}

function publicClassroomActions(actions = {}) {
  return {
    connect: actions.connect === true,
    reconnect: actions.reconnect === true,
    sync: actions.sync === true,
    disconnect: actions.disconnect === true,
  };
}

function publicClassroomUi(ui = {}) {
  return {
    title: ui.title || "Classroom status pending",
    message: ui.message || "Your workspace is ready. Classroom status will update when setup is available.",
    badge: ui.badge || "workspace ready",
    detail: ui.detail || "",
  };
}

function publicClassroomConnector(connector = {}) {
  const syncHistory = Array.isArray(connector.syncHistory)
    ? connector.syncHistory.map(publicClassroomSyncRun)
    : [];
  const publicMode = connector.mode === "mock"
    ? "preview"
    : ["disabled", "setup_required"].includes(connector.state || connector.status)
      ? "inactive"
      : "classroom";
  return {
    mode: publicMode,
    state: connector.state || connector.status || "status_pending",
    status: connector.status || connector.state || "status_pending",
    connected: connector.connected === true,
    enabled: connector.enabled === true,
    available: connector.available === true,
    setupRequired: connector.setupRequired === true,
    reconnectRequired: connector.reconnectRequired === true,
    readOnlyImport: connector.readOnlyImport !== false,
    writeScopesEnabled: connector.writeScopesEnabled === true,
    postingEnabled: false,
    submissionEnabled: false,
    actions: publicClassroomActions(connector.actions),
    ui: publicClassroomUi(connector.ui),
    providerAccountEmail: connector.connected ? connector.providerAccountEmail || "" : "",
    lastSyncAt: connector.lastSyncAt || syncHistory[0]?.completedAt || null,
    syncSummary: publicClassroomSummary(connector.syncSummary),
    syncHistory,
    message: connector.message || connector.ui?.message || "",
    syncBlockedReason: connector.syncBlockedReason || connector.message || connector.ui?.message || null,
    secretsExposed: false,
  };
}

async function maybeRunAutomaticClassroomCheck({ state, session } = {}) {
  const lifecycle = getProductLifecycleSnapshot(state);
  const policy = getProductClassroomPolicy(state);
  if (!lifecycle.dashboardActive || lifecycle.classroomChoice !== "classroom" || !lifecycle.classroomConnectedAt) return null;
  const schedule = shouldRunAutomaticClassroomCheck({ state, policy });
  if (!schedule.due) return null;
  const connector = await getClassroomConnectorStatus({
    state,
    session,
    repository,
    userId: session.user.id,
    config: googleClassroomConfig,
  });
  if (!connector.connected || !connector.actions.sync) return null;
  try {
    const result = await syncGoogleClassroomIntoState({
      state,
      session,
      repository,
      config: googleClassroomConfig,
      courseOnly: policy.courseOnly === true,
    });
    await repository.saveState(session, state);
    return result;
  } catch (error) {
    logger.warn("classroom_automatic_check.failed", {
      status: error.status || 500,
      code: error.code || "classroom_check_failed",
    });
    return null;
  }
}

function publicErrorMessage(error, fallback = "We couldn’t complete that request. Please try again.") {
  const message = redactSecrets(error?.message || fallback);
  if ((error?.status || 0) === 429 || /429|too many|rate limit/i.test(message)) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (/supabase|groq|pollinations|gemini|openai|gpt|gpt-oss|anthropic|claude|provider|model|pgvector|rpc|postgrest|postgres/i.test(message)) {
    return fallback;
  }
  if (/cannot read properties|is not iterable|undefined is not|null is not|referenceerror|typeerror/i.test(message)) {
    return fallback;
  }
  return message || fallback;
}

function findAssignment(state, id) {
  return state.assignments.find((assignment) => assignment.id === id && isAcademicContextRecord(assignment));
}

function findCourse(state, id) {
  return state.courses.find((course) => course.id === id && isAcademicContextRecord(course));
}

function findTopics(state, ids) {
  return state.topics.filter((topic) => ids.includes(topic.id) && isAcademicContextRecord(topic));
}

function requireUploadSession(session) {
  if (supabaseConfig.mode === "supabase" && !session.authenticated) {
    const error = new Error("Source uploads require a signed-in StudentOS account");
    error.status = 401;
    throw error;
  }
}

function requireAccountSession(session) {
  if (supabaseConfig.mode === "supabase" && !session.authenticated) {
    const error = new Error("Account management requires a signed-in StudentOS account");
    error.status = 401;
    throw error;
  }
}

function safeTokenMatches(expected, actual) {
  const expectedBytes = Buffer.from(String(expected || ""));
  const actualBytes = Buffer.from(String(actual || ""));
  return expectedBytes.length > 0 &&
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes);
}

function requireInternalOpsBootstrap(req) {
  if (!operatorRbacConfig.enabled) {
    const error = new Error("Not found");
    error.status = 404;
    throw error;
  }
  const configuredToken = operatorRbacConfig.bootstrapToken;
  const suppliedToken = req.headers["x-studentos-internal-token"] || "";
  if (!safeTokenMatches(configuredToken, suppliedToken)) {
    const error = new Error("Operator bootstrap authorization failed");
    error.status = 403;
    throw error;
  }
}

async function recordFailedOperatorAuthorization(req, {
  operatorId = "unknown",
  permission = "unknown",
  reason = "authorization_failed",
} = {}) {
  try {
    await recordOperatorAction({
      req,
      operator: {
        sub: String(operatorId || "unknown").slice(0, 120) || "unknown",
        role: "read_only_auditor",
        permissions: [],
      },
      action: "operator.authorization.failed",
      note: "Operator authorization failed before action was allowed.",
      metadata: { permission, reason },
    });
  } catch (auditError) {
    logger.warn("operator.authorization.audit_failed", {
      requestId: req.requestId,
      reason: auditError?.message || "audit_failed",
    });
  }
}

async function requireOperatorPermission(req, permission) {
  const token = operatorBearerToken(req);
  try {
    const operator = verifyOperatorSession(token, {
      config: operatorRbacConfig,
      permission,
    });
    assertOperatorMfaSatisfied({
      operator,
      permission,
      config: operatorMfaConfig,
    });
    return operator;
  } catch (error) {
    await recordFailedOperatorAuthorization(req, {
      permission,
      reason: error?.mfaRequired ? "mfa_required" : error?.message,
    });
    throw error;
  }
}

function operatorBearerToken(req) {
  const authorization = String(req.headers.authorization || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function internalOpsSession(url) {
  const userId = String(url.searchParams.get("userId") || "").trim();
  if (!userId) {
    const error = new Error("Internal account operations require userId");
    error.status = 400;
    throw error;
  }
  return {
    authenticated: true,
    mode: "internal_ops",
    user: { id: userId, email: "" },
  };
}

async function recordOperatorAction({
  req,
  operator,
  targetUserId = null,
  session = null,
  action,
  note,
  metadata = {},
}) {
  const event = buildOperatorAuditEvent({
    requestId: req.requestId,
    operator,
    targetUserId,
    action,
    note,
    metadata,
  });
  await repository.insertOperatorAuditEvent(session, event);
  logger.info("operator.action", {
    requestId: event.requestId,
    operatorId: event.operatorId,
    operatorRole: event.operatorRole,
    targetUserId: event.targetUserId,
    action: event.action,
  });
  return event;
}

async function emitAlert(session, alert) {
  return emitMonitoringAlert({
    repository,
    session,
    sink: alertSink,
    alert,
    config: monitoringAlertConfig,
  });
}

function requestKey(req, session = null) {
  return session?.user?.id || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "anonymous";
}

function enforceRateLimit(req, session = null, action = "api") {
  const result = rateLimiter.check(`${action}:${requestKey(req, session)}`);
  if (result.allowed) return result;
  const error = new Error("Rate limit exceeded");
  error.status = 429;
  error.rateLimit = result;
  throw error;
}

function enforceUsage(state, action, context = {}) {
  const result = checkUsagePolicy({
    saasConfig,
    state,
    action,
    context,
  });
  assertUsageAllowed(result);
  return result;
}

function createAiPersistencePayload({ session, body, result, operationId = "" }) {
  const now = new Date().toISOString();
  const stableSuffix = operationId ? fingerprintAiOperation({ userId: session.user.id, operationId }).slice(0, 24) : "";
  const idSuffix = stableSuffix || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const conversation = {
    id: `conv_${idSuffix}`,
    userId: session.user.id,
    title: `${result.verb || body.verb || "Ask"} with StudentOS`,
    verb: result.verb || body.verb || "Ask",
    courseId: result.courseId || null,
    topicId: result.topicId || null,
    createdAt: now,
  };
  const messages = [
    {
      id: `msg_user_${idSuffix}`,
      conversationId: conversation.id,
      userId: session.user.id,
      role: "user",
      verb: conversation.verb,
      content: body.message || "",
      sourceLabels: [],
      createdAt: now,
    },
    {
      id: `msg_assistant_${idSuffix}`,
      conversationId: conversation.id,
      userId: session.user.id,
      role: "assistant",
      verb: conversation.verb,
      content: result.answer || "",
      sourceLabels: result.sourceLabels || [],
      payload: result,
      createdAt: now,
    },
  ];
  return { conversation, messages };
}

function aiOperationIdentity(req, workflow, input) {
  const operationId = getAiOperationId({
    idempotencyKey: req.headers["idempotency-key"],
    requestId: req.requestId,
  });
  return {
    operationId,
    requestFingerprint: fingerprintAiOperation({ workflow, input }),
  };
}

function weeklyAiHelpForExecution({ execution, allowance, creditCost, refreshesAt, blocked = false }) {
  const reservation = execution?.reservation || {};
  const used = execution?.settlement?.used
    ?? (execution?.replay || execution?.blocked || execution?.success
      ? Number(reservation.used || 0)
      : Math.max(0, Number(reservation.used || 0) - Number(creditCost || 0)));
  return buildPublicAiAllowance({
    allowance,
    used,
    remaining: Math.max(0, allowance - used),
    refreshesAt,
    blocked,
  });
}

function routedOperationBusyPayload(state, persistence, kind = "generated") {
  return {
    [kind]: false,
    retryable: true,
    message: "StudentOS is finishing another study request. Please try again in a moment.",
    state: publicState(state, persistence),
    secretsPrinted: false,
  };
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/recovery/analyze") {
    assertRecoveryEnabled(recoveryConfig, req.requestId);
    const body = await readRecoveryBody(req, RecoveryAnalyzeInputSchema);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const queued = await queueRecoveryAnalysis({
      repository,
      session,
      state,
      input: body,
      idempotencyKey: req.headers["idempotency-key"],
      correlationId: req.requestId,
      config: recoveryConfig,
    });
    sendJson(res, 202, {
      runId: queued.run.id,
      run: publicRecoveryRun(queued.run),
      replayed: queued.replayed,
      correlationId: req.requestId,
      secretsPrinted: false,
    });
    return;
  }

  const recoveryRunMatch = url.pathname.match(/^\/api\/recovery\/runs\/([^/]+)$/);
  if (req.method === "GET" && recoveryRunMatch) {
    assertRecoveryEnabled(recoveryConfig, req.requestId);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const id = decodeURIComponent(recoveryRunMatch[1]);
    const run = (state.recoveryRuns || []).find((item) => item.id === id && item.userId === session.user.id);
    if (!run) throw new RecoveryError("RECOVERY_UNAUTHORIZED", "Recovery run is not available for this account.", { correlationId: req.requestId });
    sendJson(res, 200, { run: publicRecoveryRun(run), correlationId: req.requestId, secretsPrinted: false });
    return;
  }

  const recoveryPreviewMatch = url.pathname.match(/^\/api\/recovery\/previews\/([^/]+)$/);
  if (req.method === "GET" && recoveryPreviewMatch) {
    assertRecoveryEnabled(recoveryConfig, req.requestId);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const id = decodeURIComponent(recoveryPreviewMatch[1]);
    const preview = (state.recoveryPreviews || []).find((item) => item.id === id && item.userId === session.user.id);
    if (!preview) throw new RecoveryError("RECOVERY_UNAUTHORIZED", "Recovery preview is not available for this account.", { correlationId: req.requestId });
    sendJson(res, 200, { preview: publicRecoveryPreview(preview, state), correlationId: req.requestId, secretsPrinted: false });
    return;
  }

  const recoveryApplyMatch = url.pathname.match(/^\/api\/recovery\/previews\/([^/]+)\/apply$/);
  if (req.method === "POST" && recoveryApplyMatch) {
    assertRecoveryEnabled(recoveryConfig, req.requestId);
    await readRecoveryBody(req, EmptyRecoveryMutationSchema);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const result = await applyRecoveryPreview({
      repository,
      session,
      state,
      previewId: decodeURIComponent(recoveryApplyMatch[1]),
      idempotencyKey: req.headers["idempotency-key"],
      config: recoveryConfig,
      correlationId: req.requestId,
    });
    sendJson(res, 200, {
      preview: publicRecoveryPreview(result.preview, state),
      planVersion: result.planVersion ? { id: result.planVersion.id, version: result.planVersion.version } : null,
      replayed: result.replayed,
      correlationId: req.requestId,
      secretsPrinted: false,
    });
    return;
  }

  const recoveryRejectMatch = url.pathname.match(/^\/api\/recovery\/previews\/([^/]+)\/reject$/);
  if (req.method === "POST" && recoveryRejectMatch) {
    assertRecoveryEnabled(recoveryConfig, req.requestId);
    await readRecoveryBody(req, EmptyRecoveryMutationSchema);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const result = await rejectRecoveryPreview({
      repository,
      session,
      state,
      previewId: decodeURIComponent(recoveryRejectMatch[1]),
      idempotencyKey: req.headers["idempotency-key"],
      config: recoveryConfig,
      correlationId: req.requestId,
    });
    sendJson(res, 200, { preview: publicRecoveryPreview(result.preview, state), replayed: result.replayed, correlationId: req.requestId, secretsPrinted: false });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      product: "StudentOS",
      brand: "SentIQ AI Labs",
      deploymentTarget: DEPLOYMENT_TARGET,
      mode: supabaseConfig.mode,
      sourceSystemsReadOnly: true,
      persistence: publicRetrievalStatus({ mode: supabaseConfig.mode }),
      productionReadiness: validateProductionReadiness({ supabaseConfig, saasConfig }),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    let queueHealth = null;
    try {
      const { state } = await getStateContext(req);
      queueHealth = buildQueueHealth(state.backgroundJobs || []);
    } catch {
      queueHealth = { unavailable: true };
    }
    sendJson(res, 200, {
      ok: true,
      requestId: res.requestId,
      product: saasConfig.product,
      deploymentTarget: DEPLOYMENT_TARGET,
      deployment: saasConfig.deployment,
      cors: {
        originPolicy: saasConfig.deployment === "production" ? "exact_origin_allowlist" : "local_development",
        configuredOrigins: saasConfig.corsOrigins.length,
      },
      authProject: {
        configured: supabaseConfig.authConfigured,
        mode: supabaseConfig.authConfigured ? "studentos_sign_in" : "not_configured",
      },
      dataShards: getSafeSupabaseStatus(supabaseConfig).shards,
      workerQueue: queueHealth,
      aiProviderMode: getPublicAiStatus(aiProviderConfig),
      embeddingMode: getPublicEmbeddingStatus(embeddingConfig),
      billingProviderMode: getPublicBillingProviderStatus(billingProviderConfig),
      billingCancellationSafety: getSafeBillingCancellationStatus(billingCancellationConfig),
      operatorRbac: getSafeOperatorRbacStatus(operatorRbacConfig),
      operatorMfa: getSafeOperatorMfaStatus(operatorMfaConfig),
      monitoringAlerts: getSafeMonitoringAlertStatus(monitoringAlertConfig),
      finalDeletionSafety: getPublicFinalDeletionSafetyStatus(finalDeletionConfig),
      storage: {
        sourceBucketConfigured: Boolean(process.env.STUDENTOS_STORAGE_BUCKET),
        exportBucketConfigured: Boolean(process.env.STUDENTOS_EXPORT_STORAGE_BUCKET),
        privateByDefault: true,
        publicUrlsEnabled: false,
      },
      dataExports: getPublicDataExportConfig(dataExportConfig),
      productionReadiness: validateProductionReadiness({ supabaseConfig, saasConfig }),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    const classroomConfigStatus = await getClassroomConnectorStatus({
      config: googleClassroomConfig,
    });
    sendJson(res, 200, {
      product: "StudentOS",
      pass: STUDENTOS_APP_PASS,
      frontend: "pure_html_css_js",
      brand: saasConfig.product,
      deploymentTarget: DEPLOYMENT_TARGET,
      frontendServedByBackend: SERVE_FRONTEND,
      storageMode: supabaseConfig.mode,
      aiProviders: getPublicAiStatus(aiProviderConfig),
      embeddings: getPublicEmbeddingStatus(embeddingConfig),
      shardingPrepared: true,
      auth: getPublicAuthConfig(supabaseConfig),
      persistence: publicRetrievalStatus({ mode: supabaseConfig.mode }),
      saas: getPublicSaasStatus(saasConfig),
      storagePlan: getSourceStoragePlan(supabaseConfig),
      classroom: publicClassroomConnector(classroomConfigStatus),
      featuresRequireWorkspaceReadiness: true,
      convenienceCreditsEnabled: true,
      realSubmissionEnabled: false,
      assignmentStudentReviewRequired: true,
      onboarding: {
        enabled: true,
      },
      productFlow: productFlowConfig,
      accountManagement: {
        enabled: true,
        passwordResetScaffolded: true,
        emailVerificationReady: true,
        exportRequestScaffolded: true,
        deletionRequestScaffolded: true,
        directDeletionEnabled: false,
        paymentsEnabled: false,
        lifecycle: getPublicLifecycleConfig(lifecycleConfig),
        dataExports: getPublicDataExportConfig(dataExportConfig),
        operatorConsoleEnabled: lifecycleConfig.internalOpsEnabled,
        operatorRbac: getSafeOperatorRbacStatus(operatorRbacConfig),
        operatorMfa: getSafeOperatorMfaStatus(operatorMfaConfig),
        finalDeletionSafety: getPublicFinalDeletionSafetyStatus(finalDeletionConfig),
        secretsExposed: false,
      },
      billing: {
        ...getPublicBillingProviderStatus(billingProviderConfig),
        cancellationSafety: getSafeBillingCancellationStatus(billingCancellationConfig),
        plans: saasConfig.billing.plans,
        trialMode: getPublicPlanSummary(PLAN_KEYS.TRIAL),
        realChargesActive: false,
      },
      monitoringAlerts: getSafeMonitoringAlertStatus(monitoringAlertConfig),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/password-reset") {
    enforceRateLimit(req, null, "password_reset");
    const body = await readJsonBody(req);
    const result = await requestPasswordReset({
      email: body.email,
      authClient: supabaseClients.authClient,
      supabaseConfig,
      redirectTo: process.env.STUDENTOS_AUTH_REDIRECT_URL || "",
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/verification/resend") {
    enforceRateLimit(req, null, "verification_resend");
    const body = await readJsonBody(req);
    const result = await requestVerificationResend({
      email: body.email,
      authClient: supabaseClients.authClient,
      supabaseConfig,
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/account") {
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    sendJson(res, 200, getAccountSnapshot({ session, state, saasConfig, lifecycleConfig }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/account/lifecycle") {
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    sendJson(res, 200, {
      lifecycle: getLifecycleSnapshot(state, lifecycleConfig),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/billing/plans") {
    sendJson(res, 200, {
      plans: saasConfig.billing.plans,
      provider: getPublicBillingProviderStatus(billingProviderConfig),
      realChargesActive: false,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/billing/status") {
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    sendJson(res, 200, getBillingSnapshot({
      state,
      saasConfig,
      providerStatus: getPublicBillingProviderStatus(billingProviderConfig),
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/billing/checkout-preview") {
    const body = await readJsonBody(req);
    const { session } = await getStateContext(req);
    requireAccountSession(session);
    sendJson(res, 200, publicBillingPreview(billingAdapter.createCheckoutPreview({
      planId: body.planId || "pro",
      userId: session.user.id,
    }), "checkout"));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/billing/demo-upgrade") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    if (productFlowConfig.proDemoUpgradeEnabled !== true) {
      sendJson(res, 403, { error: "Plan upgrade is not available in this mode.", secretsPrinted: false });
      return;
    }
    const requestedPlan = normalizePlanKey(body.planId);
    if (requestedPlan !== PLAN_KEYS.PRO) {
      sendJson(res, 400, { error: "Only the Pro plan is available for selection in this mode.", secretsPrinted: false });
      return;
    }
    const now = new Date();
    const timestamp = now.toISOString();
    ensureBillingState(state);
    const subscriptionId = `billing_subscription_${session.user.id}`;
    const demoSubscription = {
      id: subscriptionId,
      userId: session.user.id,
      planId: PLAN_KEYS.PRO,
      status: "active",
      provider: "mock",
      providerCustomerId: null,
      providerSubscriptionId: null,
      renewalAt: null,
      cancelAtPeriodEnd: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const existingIndex = state.billingSubscriptions.findIndex((s) => s.id === subscriptionId);
    if (existingIndex >= 0) state.billingSubscriptions[existingIndex] = demoSubscription;
    else state.billingSubscriptions.push(demoSubscription);
    state.studentProfile.productLifecycle = state.studentProfile.productLifecycle || {};
    state.studentProfile.productLifecycle.selectedPlanId = PLAN_KEYS.PRO;
    state.studentProfile.productLifecycle.accessMode = "paid_plan";
    state.studentProfile.preferences = state.studentProfile.preferences || {};
    state.studentProfile.preferences.billingPlan = PLAN_KEYS.PRO;
    await repository.saveState(session, state);
    logger.info("billing.demo_upgrade.completed", { planId: PLAN_KEYS.PRO, userId: session.user.id });
    sendJson(res, 200, {
      ok: true,
      planId: PLAN_KEYS.PRO,
      status: "active",
      mode: "demo_override",
      account: getAccountSnapshot({ session, state, saasConfig, lifecycleConfig }),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/billing/manage-preview") {
    const { session } = await getStateContext(req);
    requireAccountSession(session);
    sendJson(res, 200, publicBillingPreview(billingAdapter.createManageBillingPreview({
      userId: session.user.id,
    }), "manage"));
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/billing/webhooks/")) {
    const provider = decodeURIComponent(url.pathname.split("/")[4] || "").toLowerCase();
    if (!billingProviderConfig.supportedProviders.includes(provider) || provider === "none") {
      sendJson(res, 404, { error: "Unsupported billing webhook provider" });
      return;
    }
    const providerAllowed = provider === billingProviderConfig.provider ||
      (saasConfig.deployment !== "production" && provider === "mock");
    if (!providerAllowed) {
      sendJson(res, 404, { error: "Billing webhook provider is not active" });
      return;
    }
    const rawBody = await readTextBody(req);
    const providerAdapter = createBillingAdapter(billingProviderConfig, provider);
    if (!providerAdapter.verifyWebhook({ rawBody, headers: req.headers })) {
      sendJson(res, 401, { error: "Invalid billing webhook signature", secretsPrinted: false });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      sendJson(res, 400, { error: "Invalid billing webhook JSON", secretsPrinted: false });
      return;
    }
    const event = normalizeProviderWebhook({ provider, payload });
    if (!event.userId) {
      sendJson(res, 400, { error: "Billing webhook missing user id", secretsPrinted: false });
      return;
    }
    const session = {
      authenticated: true,
      mode: "billing_webhook",
      user: { id: event.userId, email: "" },
    };
    const state = await repository.loadState(session);
    const result = processBillingWebhook({ state, event });
    await repository.saveState(session, state);
    logger.info("billing.webhook.processed", {
      provider,
      providerEventId: event.id,
      eventType: event.type,
      duplicate: result.duplicate,
    });
    sendJson(res, 200, {
      ok: true,
      duplicate: result.duplicate,
      eventType: event.type,
      planId: result.subscription.planId,
      status: result.subscription.status,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/account/consent") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const consent = updateConsentPreferences(state, body, new Date(), lifecycleConfig);
    await repository.saveState(session, state);
    sendJson(res, 200, {
      consent,
      account: getAccountSnapshot({ session, state, saasConfig, lifecycleConfig }),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/account/consent/withdrawal-request") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const request = createConsentWithdrawalRequest(state, body, lifecycleConfig);
    await withUploadStageTimeout("account_lifecycle_persist", () => repository.saveAccountLifecycle(session, state), {
      timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
    });
    sendJson(res, 200, {
      request,
      account: getAccountSnapshot({ session, state, saasConfig, lifecycleConfig }),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/account/legal/accept") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const acceptance = recordLegalAcceptance(state, body, lifecycleConfig);
    await withUploadStageTimeout("account_lifecycle_persist", () => repository.saveAccountLifecycle(session, state), {
      timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
    });
    sendJson(res, 200, {
      acceptance,
      account: getAccountSnapshot({ session, state, saasConfig, lifecycleConfig }),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/account/export-request") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const { request, job } = createDataExportWorkflow(state, body, lifecycleConfig);
    await withUploadStageTimeout("account_lifecycle_persist", () => repository.saveAccountLifecycle(session, state), {
      timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
    });
    sendJson(res, 200, {
      request,
      job,
      account: getAccountSnapshot({ session, state, saasConfig, lifecycleConfig }),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/account/export-requests") {
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const lifecycle = getLifecycleSnapshot(state, lifecycleConfig);
    sendJson(res, 200, {
      requests: lifecycle.exportRequests,
      jobs: lifecycle.exportJobs,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/account/exports/") && url.pathname.endsWith("/download")) {
    const requestId = decodeURIComponent(url.pathname.split("/")[4] || "");
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const request = authorizeExportDownload(state, requestId);
    const download = await repository.downloadExportPackage(session, {
      bucket: request.storageBucket,
      path: request.storagePath,
    });
    recordExportDownloaded(state, request);
    await withUploadStageTimeout("account_lifecycle_persist", () => repository.saveAccountLifecycle(session, state), {
      timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
    });
    sendPrivateDownload(res, Buffer.from(download.bytes), "studentos-export.json");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/account/deletion-request") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const request = createDeletionWorkflow(state, body, lifecycleConfig);
    await withUploadStageTimeout("account_lifecycle_persist", () => repository.saveAccountLifecycle(session, state), {
      timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
    });
    sendJson(res, 200, {
      request,
      directDeletion: false,
      account: getAccountSnapshot({ session, state, saasConfig, lifecycleConfig }),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/account/deletion-requests") {
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    sendJson(res, 200, {
      requests: getLifecycleSnapshot(state, lifecycleConfig).deletionRequests,
      directDeletion: false,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/account/deletion-requests/") && url.pathname.endsWith("/dry-run")) {
    const requestId = decodeURIComponent(url.pathname.split("/")[4] || "");
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const report = buildDeletionDryRunReport(state, requestId);
    await withUploadStageTimeout("account_lifecycle_persist", () => repository.saveAccountLifecycle(session, state), {
      timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
    });
    sendJson(res, 200, {
      report,
      account: getAccountSnapshot({ session, state, saasConfig, lifecycleConfig }),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/account/invitations/guardian-preview") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireAccountSession(session);
    const invitation = createRoleInvitationGroundwork(state, {
      ...body,
      role: "guardian_future",
    }, lifecycleConfig);
    await withUploadStageTimeout("account_lifecycle_persist", () => repository.saveAccountLifecycle(session, state), {
      timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
    });
    sendJson(res, 200, {
      invitation,
      message: invitation.enabled
        ? "Guardian invitation request recorded for future review."
        : "Guardian invitations remain disabled until role launch and explicit student consent review.",
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/internal/operator/session") {
    const body = await readJsonBody(req);
    try {
      requireInternalOpsBootstrap(req);
    } catch (error) {
      await recordFailedOperatorAuthorization(req, {
        operatorId: body.operatorId || "unknown",
        permission: "operator:bootstrap",
        reason: error?.message || "bootstrap_failed",
      });
      throw error;
    }
    const issued = createOperatorSession({
      operatorId: body.operatorId,
      bootstrapToken: req.headers["x-studentos-internal-token"] || "",
      config: operatorRbacConfig,
    });
    await recordOperatorAction({
      req,
      operator: issued.operator,
      action: "operator.session.created",
      note: "Short-lived operator session issued.",
      metadata: { expiresAt: issued.expiresAt },
    });
    sendJson(res, 200, {
      sessionToken: issued.token,
      operator: {
        id: issued.operator.sub,
        role: issued.operator.role,
        permissions: issued.operator.permissions,
        mfa: issued.operator.mfa,
      },
      expiresAt: issued.expiresAt,
      operatorMfa: getSafeOperatorMfaStatus(operatorMfaConfig),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/internal/operator/mfa/challenge") {
    let operator;
    try {
      operator = verifyOperatorSession(operatorBearerToken(req), {
        config: operatorRbacConfig,
      });
    } catch (error) {
      await recordFailedOperatorAuthorization(req, {
        permission: "operator:mfa",
        reason: error?.message || "mfa_challenge_failed",
      });
      throw error;
    }
    const challenge = createOperatorMfaChallenge({
      operator,
      config: operatorMfaConfig,
    });
    await recordOperatorAction({
      req,
      operator,
      action: "operator.mfa.challenge.created",
      note: "Operator MFA challenge scaffold created.",
      metadata: { status: challenge.status },
    });
    const { signature, ...safeChallenge } = challenge;
    sendJson(res, 200, {
      challenge: safeChallenge,
      operatorMfa: getSafeOperatorMfaStatus(operatorMfaConfig),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/internal/operator/mfa/verify") {
    const body = await readJsonBody(req);
    const operator = verifyOperatorSession(operatorBearerToken(req), {
      config: operatorRbacConfig,
    });
    let mfa;
    try {
      mfa = verifyOperatorMfaChallenge({
        operator,
        challengeId: body.challengeId,
        code: body.code,
        config: operatorMfaConfig,
      });
    } catch (error) {
      await recordFailedOperatorAuthorization(req, {
        operatorId: operator.sub,
        permission: "operator:mfa",
        reason: error?.message || "mfa_failed",
      });
      throw error;
    }
    const refreshed = refreshOperatorSession({
      operator,
      config: operatorRbacConfig,
      mfa,
    });
    await recordOperatorAction({
      req,
      operator: refreshed.operator,
      action: "operator.mfa.verified",
      note: "Operator MFA verification scaffold accepted.",
      metadata: { mfaExpiresAt: mfa.expiresAt, mockVerified: mfa.mockVerified },
    });
    sendJson(res, 200, {
      sessionToken: refreshed.token,
      operator: {
        id: refreshed.operator.sub,
        role: refreshed.operator.role,
        permissions: refreshed.operator.permissions,
        mfa: refreshed.operator.mfa,
      },
      expiresAt: refreshed.expiresAt,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/internal/monitoring/status") {
    const operator = await requireOperatorPermission(req, OPERATOR_PERMISSIONS.MONITORING_READ);
    let queueHealth = { scope: "target_user_required" };
    const userId = String(url.searchParams.get("userId") || "").trim();
    const session = userId ? internalOpsSession(url) : null;
    if (session) {
      const state = await repository.loadState(session);
      queueHealth = buildQueueHealth(state.backgroundJobs || []);
    }
    await recordOperatorAction({
      req,
      operator,
      targetUserId: userId || null,
      session,
      action: "monitoring.status.read",
      note: "Production-safe monitoring status reviewed.",
      metadata: { queueScope: userId ? "target_user" : "global" },
    });
    sendJson(res, 200, {
      ok: true,
      requestId: req.requestId,
      authProject: {
        configured: supabaseConfig.authConfigured,
        mode: supabaseConfig.authConfigured ? "studentos_sign_in" : "not_configured",
      },
      dataShards: getSafeSupabaseStatus(supabaseConfig).shards,
      storage: {
        sourceBucketConfigured: Boolean(process.env.STUDENTOS_STORAGE_BUCKET),
        exportBucketConfigured: Boolean(process.env.STUDENTOS_EXPORT_STORAGE_BUCKET),
        privateByDefault: true,
        publicUrlsEnabled: false,
      },
      workerQueue: queueHealth,
      aiProviderMode: getSafeAiProviderStatus(aiProviderConfig),
      billingProviderMode: getSafeBillingProviderStatus(billingProviderConfig),
      billingCancellationSafety: getSafeBillingCancellationStatus(billingCancellationConfig),
      operatorRbac: getSafeOperatorRbacStatus(operatorRbacConfig),
      operatorMfa: getSafeOperatorMfaStatus(operatorMfaConfig),
      monitoringAlerts: getSafeMonitoringAlertStatus(monitoringAlertConfig),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/internal/monitoring/alerts") {
    const operator = await requireOperatorPermission(req, OPERATOR_PERMISSIONS.MONITORING_READ);
    const session = internalOpsSession(url);
    const alerts = await repository.listMonitoringAlertEvents(session);
    await recordOperatorAction({
      req,
      operator,
      targetUserId: session.user.id,
      session,
      action: "monitoring.alerts.read",
      note: "Operator reviewed monitoring alert events.",
      metadata: { alertCount: alerts.length },
    });
    sendJson(res, 200, {
      alerts,
      monitoringAlerts: getSafeMonitoringAlertStatus(monitoringAlertConfig),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/internal/account-ops") {
    const operator = await requireOperatorPermission(req, OPERATOR_PERMISSIONS.READ_OPERATIONS);
    const session = internalOpsSession(url);
    const state = await repository.loadState(session);
    await recordOperatorAction({
      req,
      operator,
      targetUserId: session.user.id,
      session,
      action: "account.operations.read",
      note: "Operator account lifecycle review opened.",
    });
    const evidence = await repository.listDeletionExecutionEvidence(session);
    const operatorAuditEvents = await repository.listOperatorAuditEvents(session);
    const billingCancellationEvents = await repository.listBillingCancellationEvents(session);
    const monitoringAlertEvents = await repository.listMonitoringAlertEvents(session);
    sendJson(res, 200, {
      ...buildInternalOpsSnapshot(state, lifecycleConfig),
      deletionEvidence: evidence,
      operatorAuditEvents,
      billingCancellationEvents,
      monitoringAlertEvents,
      operator: {
        id: operator.sub,
        role: operator.role,
        permissions: operator.permissions,
      },
      finalDeletionSafety: getPublicFinalDeletionSafetyStatus(finalDeletionConfig),
      billingCancellationSafety: getSafeBillingCancellationStatus(billingCancellationConfig),
      operatorMfa: getSafeOperatorMfaStatus(operatorMfaConfig),
      monitoringAlerts: getSafeMonitoringAlertStatus(monitoringAlertConfig),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/internal/exports/retention-cleanup") {
    const operator = await requireOperatorPermission(req, OPERATOR_PERMISSIONS.EXPORT_CLEANUP);
    const body = await readJsonBody(req);
    const result = await runExportRetentionCleanup({
      repository,
      config: supabaseConfig,
      limit: Math.min(Number(body.limit) || 100, 500),
    });
    await recordOperatorAction({
      req,
      operator,
      action: "exports.retention.cleanup",
      note: body.note || "Expired export retention cleanup requested.",
      metadata: { cleanedCount: result.cleaned?.length || 0 },
    });
    await emitAlert(null, createMonitoringAlert({
      requestId: req.requestId,
      alertType: ALERT_TYPES.HIGH_RISK_OPERATOR_ACTION,
      severity: "warn",
      message: "Operator export retention cleanup requested.",
      metadata: { cleanedCount: result.cleaned?.length || 0 },
    }));
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/internal/account-deletions/") && url.pathname.endsWith("/review")) {
    const operator = await requireOperatorPermission(req, OPERATOR_PERMISSIONS.DELETION_REVIEW);
    const body = await readJsonBody(req);
    const session = internalOpsSession(url);
    const state = await repository.loadState(session);
    const requestId = decodeURIComponent(url.pathname.split("/")[4] || "");
    const result = recordDeletionApprovalScaffold(state, requestId, {
      decision: body.decision,
      note: body.note,
      operatorId: operator.sub,
    }, body.now ? new Date(body.now) : new Date());
    await withUploadStageTimeout("account_lifecycle_persist", () => repository.saveAccountLifecycle(session, state), {
      timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
    });
    await recordOperatorAction({
      req,
      operator,
      targetUserId: session.user.id,
      session,
      action: `account.deletion.review.${result.review.decision}`,
      note: body.note,
      metadata: { deletionRequestId: requestId },
    });
    if (result.review.decision === "approve_scaffold") {
      await emitAlert(session, createMonitoringAlert({
        targetUserId: session.user.id,
        requestId: req.requestId,
        alertType: ALERT_TYPES.DELETION_APPROVAL_RECORDED,
        severity: "warn",
        message: "Operator deletion approval scaffold recorded.",
        metadata: { deletionRequestId: requestId },
      }));
    }
    sendJson(res, 200, {
      ...result,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/internal/account-deletions/") && url.pathname.endsWith("/execute")) {
    const operator = await requireOperatorPermission(req, OPERATOR_PERMISSIONS.DELETION_EXECUTE);
    const body = await readJsonBody(req);
    const session = internalOpsSession(url);
    const state = await repository.loadState(session);
    const requestId = decodeURIComponent(url.pathname.split("/")[4] || "");
    const cancellation = evaluateBillingCancellation({
      state,
      adapter: billingAdapter,
      config: billingCancellationConfig,
      waiver: body.billingWaiver || {},
      canWaive: operatorHasPermission(operator, OPERATOR_PERMISSIONS.BILLING_WAIVE),
    });
    await recordOperatorAction({
      req,
      operator,
      targetUserId: session.user.id,
      session,
      action: "account.deletion.execution.requested",
      note: body.note,
      metadata: {
        deletionRequestId: requestId,
        billingCancellationStatus: cancellation.status,
        billingCancellationSatisfied: cancellation.satisfied,
      },
    });
    await repository.insertBillingCancellationEvent(session, buildBillingCancellationEvent({
      requestId: req.requestId,
      operator,
      targetUserId: session.user.id,
      deletionRequestId: requestId,
      cancellation,
      note: body.billingWaiver?.note || body.note,
    }));
    await emitAlert(session, createMonitoringAlert({
      targetUserId: session.user.id,
      requestId: req.requestId,
      alertType: ALERT_TYPES.HIGH_RISK_OPERATOR_ACTION,
      severity: "critical",
      message: "Operator requested guarded final deletion execution check.",
      metadata: {
        deletionRequestId: requestId,
        cancellationStatus: cancellation.status,
      },
    }));
    if (cancellation.blocksExecution) {
      await emitAlert(session, createMonitoringAlert({
        targetUserId: session.user.id,
        requestId: req.requestId,
        alertType: ALERT_TYPES.BILLING_CANCELLATION_FAILURE,
        severity: "error",
        message: "Billing cancellation reconciliation blocks deletion execution.",
        metadata: {
          deletionRequestId: requestId,
          provider: cancellation.provider,
          status: cancellation.status,
        },
      }));
    }
    const result = await executeFinalDeletion({
      state,
      requestId,
      operatorId: operator.sub,
      acknowledgeLargeDiff: body.acknowledgeLargeDiff === true,
      billingCancellation: cancellation,
      config: finalDeletionConfig,
      repository,
      session,
      authClient: supabaseClients.authClient,
    });
    if (!result.executed) await repository.saveAccountLifecycle(session, state);
    sendJson(res, 200, {
      executed: result.executed,
      authorized: result.authorized,
      blockers: result.blockers,
      dryRun: result.dryRun,
      evidence: result.evidence,
      finalDeletionSafety: getPublicFinalDeletionSafetyStatus(finalDeletionConfig),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const { session, state, persistence } = await getStateContext(req);
    await maybeRunAutomaticClassroomCheck({ state, session });
    const preparation = advanceAcademicContextPreparation(state);
    if (preparation.changed) await repository.saveState(session, state);
    sendJson(res, 200, publicState(state, persistence));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/academic-context/status") {
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const preparation = advanceAcademicContextPreparation(state);
    if (preparation.changed) await repository.saveState(session, state);
    sendJson(res, 200, {
      academicContext: preparation.readiness,
      state: publicState(state, persistence),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/academic-context/prepare") {
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const activePlanKey = resolveEntitlements(state).activePlanKey;
    const classroomPolicy = getProductClassroomPolicy(state);
    const oneClickTodo = activePlanKey !== "starter" && classroomPolicy.courseworkReviewEnabled === true;
    let selectedContentCheck = null;
    if (oneClickTodo) {
      const backfill = beginSelectedClassroomContentBackfill(state);
      if (backfill.started) {
        await repository.saveState(session, state);
        selectedContentCheck = await backfillSelectedClassroomContentIntoState({
          state,
          session,
          repository,
          items: backfill.items,
          config: googleClassroomConfig,
        });
        markAcademicContextNeedsPreparation(state, "selected_classroom_content_checked");
      }
    }
    beginAcademicContextPreparation(state);
    const academicContext = oneClickTodo
      ? advanceAcademicContextPreparation(state, { force: true }).readiness
      : getAcademicContextReadiness(state);
    await repository.saveState(session, state);
    sendJson(res, oneClickTodo ? 200 : 202, {
      academicContext,
      selectedContentCheck,
      autoGenerateTodo: oneClickTodo && academicContext.canGenerateTodo,
      state: publicState(state, persistence),
      message: academicContext.manualUploadGuidance || (oneClickTodo ? "Academic Context is ready for today’s plan." : "Setting things up for you."),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/academic-context/exams") {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
    const exam = addManualExam(state, body);
    if (recoveryConfig.enabled) recordAcademicEvent(state, {
      eventType: "exam_date_changed",
      sourceEntityType: "exam",
      sourceEntityId: exam.id,
      idempotencyKey: `exam_created:${exam.id}`,
      correlationId: req.requestId,
      payload: { previousDate: null, newDate: exam.examDate || null },
    });
    if (recoveryConfig.enabled) queueAutomaticRecovery(state, { correlationId: req.requestId });
    await persistRecoveryAwareMutation({ repository, session, state, baseline: recoveryBaseline, ordinarySave: () => repository.saveOrdinaryState(session, state), correlationId: req.requestId });
    sendJson(res, 201, {
      exam,
      state: publicState(state, persistence),
      message: "Exam date added to Academic Context.",
      secretsPrinted: false,
    });
    return;
  }

  const manualExamPath = url.pathname.match(/^\/api\/academic-context\/exams\/([^/]+)$/);
  if (manualExamPath && ["PATCH", "DELETE"].includes(req.method)) {
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
    const examId = decodeURIComponent(manualExamPath[1]);
    const previousExam = state.exams.find((item) => item.id === examId);
    const previousDate = previousExam?.examDate || null;
    const exam = req.method === "PATCH"
      ? updateManualExam(state, examId, await readJsonBody(req))
      : removeManualExam(state, examId);
    if (req.method === "DELETE") await repository.deleteAcademicExam(session, examId);
    if (recoveryConfig.enabled && ((req.method === "PATCH" && previousDate !== exam?.examDate) || req.method === "DELETE")) {
      recordAcademicEvent(state, {
        eventType: "exam_date_changed",
        sourceEntityType: "exam",
        sourceEntityId: examId,
        idempotencyKey: `exam_date:${examId}:${req.method === "DELETE" ? "removed" : exam?.examDate || "removed"}`,
        correlationId: req.requestId,
        payload: { previousDate, newDate: exam?.examDate || null },
      });
      queueAutomaticRecovery(state, { correlationId: req.requestId });
    }
    await persistRecoveryAwareMutation({ repository, session, state, baseline: recoveryBaseline, ordinarySave: () => repository.saveOrdinaryState(session, state), correlationId: req.requestId });
    sendJson(res, 200, {
      exam,
      state: publicState(state, persistence),
      message: req.method === "PATCH" ? "Exam details saved." : "Exam removed from Academic Context.",
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/today/todo") {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    assertProductFeatureAccess(state, FEATURE_KEYS.ASSISTANT);
    enforceRateLimit(req, session, "ai_call");
    const readiness = getAcademicContextReadiness(state);
    if (!readiness.canGenerateTodo) {
      const error = new Error("Prepare Academic Context before generating today’s TO-DO list.");
      error.status = 409;
      error.code = "academic_context_not_ready";
      throw error;
    }
    const activePlanKey = resolveEntitlements(state).activePlanKey;
    refreshAcademicRoadmap(state);
    const allowance = getAiWeeklyAllowance(activePlanKey);
    const period = getAiWeeklyPeriod();
    const task = classifyAiTask({ verb: "Plan", message: "Generate today's TO-DO list" });
    const operation = aiOperationIdentity(req, "daily_todo", {
      currentDate: body.currentDate || null,
      currentTime: body.currentTime || null,
      timezone: body.timezone || null,
    });
    let execution;
    try {
      execution = await executeAuthorizedAiOperation({
        repository,
        session,
        config: aiProviderConfig,
        requestFingerprint: operation.requestFingerprint,
        workflow: "daily_todo",
        responseMode: "json",
        logger,
        allowanceRequest: {
          planTier: activePlanKey,
          periodKey: period.periodKey,
          allowance,
          actionType: task.actionType,
          creditCost: task.creditCost,
          requestId: operation.operationId,
          metadata: { workflow: "daily_todo" },
        },
        run: ({ providerExecutor, routed }) => generateDailyTodoPlan({
          state,
          currentDate: body.currentDate,
          currentTime: body.currentTime,
          timezone: body.timezone,
          planTier: activePlanKey,
          providerExecutor,
          providerConfig: routed ? { ...aiProviderConfig, requestedMode: "auto" } : aiProviderConfig,
        }),
        isLogicalSuccess: (result) => result?.generationSucceeded === true && Boolean(result?.plan),
        outcomeForReplay: (result) => ({ generationSucceeded: true, plan: result.plan }),
      });
    } catch (error) {
      if (error.code === "idempotency_conflict") throw error;
      logger.warn("daily_todo.execution_failed", { requestId: req.requestId, status: error.status || 500 });
      sendJson(res, 200, {
        generated: false,
        retryable: true,
        message: AI_ALLOWANCE_COPY.unavailable,
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    if (execution.busy) {
      sendJson(res, 200, routedOperationBusyPayload(state, persistence));
      return;
    }
    if (execution.blocked) {
      sendJson(res, 200, {
        generated: false,
        allowanceLimited: true,
        message: `${AI_ALLOWANCE_COPY.exhausted} ${AI_ALLOWANCE_COPY.exhaustedNextStep}`,
        weeklyAiHelp: weeklyAiHelpForExecution({ execution, allowance, creditCost: task.creditCost, refreshesAt: period.refreshesAt, blocked: true }),
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    const result = execution.result || {};
    const generated = execution.success === true;
    const weeklyAiHelp = weeklyAiHelpForExecution({ execution, allowance, creditCost: task.creditCost, refreshesAt: period.refreshesAt });
    if (!generated) {
      sendJson(res, 200, {
        generated: false,
        retryable: true,
        message: "StudentOS could not generate today’s plan. Please try again.",
        weeklyAiHelp,
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
    const previousDailyPlan = state.studentProfile.dailyTodoPlan;
    if (recoveryConfig.enabled && previousDailyPlan?.date && previousDailyPlan.date !== result.plan?.date) {
      for (const item of (previousDailyPlan.items || []).filter((candidate) => !["done", "completed"].includes(candidate.study_status))) {
        recordAcademicEvent(state, {
          eventType: "study_task_missed",
          sourceEntityType: "study_task",
          sourceEntityId: item.id,
          idempotencyKey: `task_rollover:${previousDailyPlan.date}:${result.plan?.date || "unknown"}:${item.id}`,
          correlationId: req.requestId,
          payload: { previousPlanDate: previousDailyPlan.date, nextPlanDate: result.plan?.date || null, courseId: item.courseId || null, topicId: item.topicId || null },
        });
      }
      queueAutomaticRecovery(state, { correlationId: req.requestId });
    }
    state.studentProfile.dailyTodoPlan = result.plan;
    markPlanningStateCurrent(state, result.plan);
    if (recoveryConfig.enabled) createCurrentPlanVersion(state, { source: "today_generation" });
    await persistRecoveryAwareMutation({ repository, session, state, baseline: recoveryBaseline, ordinarySave: () => repository.saveOrdinaryState(session, state), correlationId: req.requestId });
    sendJson(res, 200, {
      generated: true,
      plan: result.plan,
      weeklyAiHelp,
      state: publicState(state, persistence),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/study/status") {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const item = findDailyTodoItem(state, body.itemId);
    if (!item) {
      const error = new Error("That item is no longer in today’s study queue.");
      error.status = 404;
      throw error;
    }
    const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
    ensureTopicMasteryQueue(state, item);
    let completion = null;
    if (body.status === "done") completion = completeCurrentMasteryTarget(state, item);
    else updateDailyTodoStudyStatus(state, body.itemId, body.status);
    if (recoveryConfig.enabled) {
      markRecoveryTaskProgress(state, item, body.status);
      if (body.status === "done") {
        recordAcademicEvent(state, {
          eventType: "study_task_completed",
          sourceEntityType: "study_task",
          sourceEntityId: item.id,
          idempotencyKey: `study_task_completed:${item.id}`,
          correlationId: req.requestId,
          payload: { status: body.status, topicId: item.topicId || null, courseId: item.courseId || null },
        });
        queueAutomaticRecovery(state, { correlationId: req.requestId });
      }
      createCurrentPlanVersion(state, { source: "study_status_changed" });
    }
    await persistRecoveryAwareMutation({ repository, session, state, baseline: recoveryBaseline, ordinarySave: () => repository.saveOrdinaryState(session, state), correlationId: req.requestId });
    sendJson(res, 200, {
      item,
      completion,
      message: body.status === "done"
        ? (completion.topicComplete ? "Topic notes complete. You can generate its test." : "Note marked done. Generate the next note when you are ready.")
        : "Study started.",
      state: publicState(state, persistence),
      testSessionStarted: false,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/study/material") {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    assertProductFeatureAccess(state, FEATURE_KEYS.ASSISTANT);
    enforceRateLimit(req, session, "ai_call");
    const item = findDailyTodoItem(state, body.itemId);
    if (!item) {
      const error = new Error("That item is no longer in today’s study queue.");
      error.status = 404;
      throw error;
    }
    ensureTopicMasteryQueue(state, item);
    const pendingTarget = nextPendingMasteryTarget(item);
    const existing = pendingTarget?.materialId
      ? (state.sourceMaterials || []).find((material) => material.id === pendingTarget.materialId && !material.deletedAt)
      : null;
    if (existing) {
      item.generated_material_id = existing.id;
      await repository.saveState(session, state);
      sendJson(res, 200, {
        generated: true,
        reused: true,
        material: publicState(state, persistence).sourceMaterials.find((source) => source.id === existing.id),
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    const activePlanKey = resolveEntitlements(state).activePlanKey;
    const allowance = getAiWeeklyAllowance(activePlanKey);
    const period = getAiWeeklyPeriod();
    const task = classifyAiTask({ verb: "Make", message: `Create study material for ${item.title}` });
    const operation = aiOperationIdentity(req, "study_material", {
      todoItemId: item.id,
      targetId: pendingTarget?.id || null,
      targetTitle: pendingTarget?.title || null,
    });
    let execution;
    try {
      execution = await executeAuthorizedAiOperation({
        repository,
        session,
        config: aiProviderConfig,
        requestFingerprint: operation.requestFingerprint,
        workflow: "study_material",
        responseMode: "text",
        logger,
        allowanceRequest: {
          planTier: activePlanKey,
          periodKey: period.periodKey,
          allowance,
          actionType: task.actionType,
          creditCost: task.creditCost,
          requestId: operation.operationId,
          metadata: { workflow: "study_material", todoItemId: item.id },
        },
        run: ({ providerExecutor, routed }) => generateStudyMaterial({
          state,
          item,
          providerExecutor,
          providerConfig: routed ? { ...aiProviderConfig, requestedMode: "auto" } : aiProviderConfig,
        }),
        isLogicalSuccess: (result) => result?.generationSucceeded === true && Boolean(result?.material),
        outcomeForReplay: (result) => ({
          generationSucceeded: true,
          material: result.material,
          reused: result.reused === true,
        }),
      });
    } catch (error) {
      if (error.code === "idempotency_conflict") throw error;
      logger.warn("study_material.execution_failed", { requestId: req.requestId, status: error.status || 500 });
      sendJson(res, 200, {
        generated: false,
        retryable: true,
        message: AI_ALLOWANCE_COPY.unavailable,
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    if (execution.busy) {
      sendJson(res, 200, routedOperationBusyPayload(state, persistence));
      return;
    }
    if (execution.blocked) {
      sendJson(res, 200, {
        generated: false,
        allowanceLimited: true,
        message: `${AI_ALLOWANCE_COPY.exhausted} ${AI_ALLOWANCE_COPY.exhaustedNextStep}`,
        weeklyAiHelp: weeklyAiHelpForExecution({ execution, allowance, creditCost: task.creditCost, refreshesAt: period.refreshesAt, blocked: true }),
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    const result = execution.result || {};
    const generated = execution.success === true;
    const weeklyAiHelp = weeklyAiHelpForExecution({ execution, allowance, creditCost: task.creditCost, refreshesAt: period.refreshesAt });
    if (!generated) {
      sendJson(res, 200, {
        generated: false,
        retryable: true,
        message: "StudentOS could not create this study material right now. Please try again.",
        weeklyAiHelp,
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    if (!result.reused && !(state.sourceMaterials || []).some((material) => material.id === result.material.id)) state.sourceMaterials.push(result.material);
    if (pendingTarget?.subpart) {
      pendingTarget.subpart.generatedMaterialId = result.material.id;
      pendingTarget.subpart.status = "studying";
    } else if (pendingTarget?.topic) {
      pendingTarget.topic.generatedMaterialId = result.material.id;
      pendingTarget.topic.status = "studying";
    }
    item.generated_material_id = result.material.id;
    if (item.study_status === "not_started") item.study_status = "studying";
    await repository.saveState(session, state);
    const safeState = publicState(state, persistence);
    sendJson(res, 200, {
      generated: true,
      material: safeState.sourceMaterials.find((source) => source.id === result.material.id),
      weeklyAiHelp,
      state: safeState,
      message: "Study note created and saved to Academic Context.",
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/study/test") {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    assertProductFeatureAccess(state, FEATURE_KEYS.ASSISTANT);
    enforceRateLimit(req, session, "ai_call");
    const item = findDailyTodoItem(state, body.itemId);
    if (!item) {
      const error = new Error("That item is no longer in today’s study queue.");
      error.status = 404;
      throw error;
    }
    ensureTopicMasteryQueue(state, item);
    if (!isActiveTopicTestUnlocked(item)) {
      const error = new Error("Complete every note in this syllabus topic before generating its test.");
      error.status = 409;
      throw error;
    }
    const existing = findStudyTestSession(state, { todoItemId: item.id, parentTopicId: activeMasteryTopic(item)?.id });
    if (existing) {
      const previousStatus = existing.status;
      synchronizeTestSession(existing);
      if (existing.status !== previousStatus) await repository.saveState(session, state);
      sendJson(res, 200, {
        generated: true,
        reused: true,
        testSession: publicTestSession(existing),
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    const activePlanKey = resolveEntitlements(state).activePlanKey;
    const allowance = getAiWeeklyAllowance(activePlanKey);
    const period = getAiWeeklyPeriod();
    const task = classifyAiTask({ verb: "Make", message: `Create a test for ${item.title}` });
    const operation = aiOperationIdentity(req, "study_test", {
      todoItemId: item.id,
      parentTopicId: activeMasteryTopic(item)?.id || null,
    });
    let execution;
    try {
      execution = await executeAuthorizedAiOperation({
        repository,
        session,
        config: aiProviderConfig,
        requestFingerprint: operation.requestFingerprint,
        workflow: "study_test",
        responseMode: "json",
        logger,
        allowanceRequest: {
          planTier: activePlanKey,
          periodKey: period.periodKey,
          allowance,
          actionType: task.actionType,
          creditCost: task.creditCost,
          requestId: operation.operationId,
          metadata: { workflow: "study_test", todoItemId: item.id },
        },
        run: ({ providerExecutor, routed }) => generateStudyTest({
          state,
          item,
          providerExecutor,
          providerConfig: routed ? { ...aiProviderConfig, requestedMode: "auto" } : aiProviderConfig,
        }),
        isLogicalSuccess: (result) => result?.generationSucceeded === true && Boolean(result?.session),
        outcomeForReplay: (result) => ({ generationSucceeded: true, session: result.session }),
      });
    } catch (error) {
      if (error.code === "idempotency_conflict") throw error;
      logger.warn("study_test.execution_failed", { requestId: req.requestId, status: error.status || 500 });
      sendJson(res, 200, {
        generated: false,
        retryable: true,
        message: AI_ALLOWANCE_COPY.unavailable,
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    if (execution.busy) {
      sendJson(res, 200, routedOperationBusyPayload(state, persistence));
      return;
    }
    if (execution.blocked) {
      sendJson(res, 200, {
        generated: false,
        allowanceLimited: true,
        message: `${AI_ALLOWANCE_COPY.exhausted} ${AI_ALLOWANCE_COPY.exhaustedNextStep}`,
        weeklyAiHelp: weeklyAiHelpForExecution({ execution, allowance, creditCost: task.creditCost, refreshesAt: period.refreshesAt, blocked: true }),
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    const result = execution.result || {};
    const generated = execution.success === true;
    const weeklyAiHelp = weeklyAiHelpForExecution({ execution, allowance, creditCost: task.creditCost, refreshesAt: period.refreshesAt });
    if (!generated) {
      sendJson(res, 200, {
        generated: false,
        retryable: true,
        message: "StudentOS could not create this test right now. Please try again.",
        weeklyAiHelp,
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    const existingSessionIndex = state.testSessions.findIndex((sessionItem) => sessionItem.id === result.session.id);
    if (existingSessionIndex >= 0) state.testSessions[existingSessionIndex] = result.session;
    else state.testSessions.push(result.session);
    await repository.saveState(session, state);
    sendJson(res, 200, {
      generated: true,
      testSession: publicTestSession(result.session),
      weeklyAiHelp,
      state: publicState(state, persistence),
      message: "Your test is ready. Review the warning before you start.",
      secretsPrinted: false,
    });
    return;
  }

  const studyTestStartMatch = url.pathname.match(/^\/api\/study\/tests\/([^/]+)\/start$/);
  if (req.method === "POST" && studyTestStartMatch) {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const testSession = findStudyTestSession(state, { sessionId: decodeURIComponent(studyTestStartMatch[1]) });
    if (!testSession) {
      const error = new Error("This test is no longer available.");
      error.status = 404;
      throw error;
    }
    startStudyTestSession(testSession, body.answerMode);
    await repository.saveState(session, state);
    sendJson(res, 200, {
      testSession: publicTestSession(testSession),
      state: publicState(state, persistence),
      message: "Test started. The timer cannot be paused.",
      secretsPrinted: false,
    });
    return;
  }

  const studyTestFinishMatch = url.pathname.match(/^\/api\/study\/tests\/([^/]+)\/finish$/);
  if (req.method === "POST" && studyTestFinishMatch) {
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const testSession = findStudyTestSession(state, { sessionId: decodeURIComponent(studyTestFinishMatch[1]) });
    if (!testSession) {
      const error = new Error("This test is no longer available.");
      error.status = 404;
      throw error;
    }
    finishStudyTestSession(testSession);
    await repository.saveState(session, state);
    sendJson(res, 200, {
      testSession: publicTestSession(testSession),
      state: publicState(state, persistence),
      message: testSession.status === "time_expired"
        ? "Time is up. This attempt is locked."
        : testSession.answerMode === "handwritten"
          ? "Your test is ready for handwritten submission."
          : "Submitted for evaluation.",
      secretsPrinted: false,
    });
    return;
  }

  const studyTestEvaluateMatch = url.pathname.match(/^\/api\/study\/tests\/([^/]+)\/evaluate$/);
  if (req.method === "POST" && studyTestEvaluateMatch) {
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    assertProductFeatureAccess(state, FEATURE_KEYS.ASSISTANT);
    enforceRateLimit(req, session, "ai_call");
    const testSession = findStudyTestSession(state, { sessionId: decodeURIComponent(studyTestEvaluateMatch[1]) });
    if (!testSession) {
      const error = new Error("This test is no longer available.");
      error.status = 404;
      throw error;
    }
    synchronizeTestSession(testSession);
    if (testSession.status === "evaluated" && testSession.evaluation) {
      sendJson(res, 200, {
        evaluated: true,
        reused: true,
        testSession: publicTestSession(testSession),
        state: publicState(state, persistence),
        secretsPrinted: false,
      });
      return;
    }
    if (!["submitted_pending_evaluation", "ready_for_evaluation", "time_expired"].includes(testSession.status)) {
      const error = new Error("This test is not ready for evaluation.");
      error.status = 409;
      throw error;
    }
    const inFlightKey = `${session.user.id}:${testSession.id}`;
    const routedEvaluation = isProviderCycleEnabledForUser(aiProviderConfig, session.user.id);
    if (!routedEvaluation && studyTestEvaluationsInFlight.has(inFlightKey)) {
      const error = new Error("This test is already being evaluated. Please wait for the result.");
      error.status = 409;
      throw error;
    }
    if (!routedEvaluation) studyTestEvaluationsInFlight.add(inFlightKey);
    try {
      let answerSheet = testSession.answerSheetDraft || null;
      if (testSession.answerMode === "handwritten") {
        const contentType = String(req.headers["content-type"] || "");
        if (contentType.toLowerCase().startsWith("multipart/form-data")) {
          const form = await readMultipartForm(req, { maxBytes: MAX_ANSWER_SHEET_BYTES + 512 * 1024 });
          const file = form.files.answerSheet;
          if (file) {
            answerSheet = await extractStudyAnswerSheet(file);
            testSession.answerSheetDraft = answerSheet;
            testSession.updatedAt = new Date().toISOString();
            await repository.saveState(session, state);
          }
        } else {
          await readJsonBody(req);
        }
        if (!answerSheet?.extractedText) {
          const error = new Error(ANSWER_SHEET_COPY);
          error.status = 400;
          throw error;
        }
      } else {
        await readJsonBody(req);
      }

      const item = findDailyTodoItem(state, testSession.todoItemId);
      if (!item) {
        const error = new Error("The related study item is no longer available.");
        error.status = 404;
        throw error;
      }
      const activePlanKey = resolveEntitlements(state).activePlanKey;
      const allowance = getAiWeeklyAllowance(activePlanKey);
      const period = getAiWeeklyPeriod();
      const task = classifyAiTask({ verb: "Review", message: `Evaluate completed test for ${testSession.testPaper.topic}` });
      const operation = aiOperationIdentity(req, "study_test_evaluation", {
        todoItemId: item.id,
        testSessionId: testSession.id,
        answers: testSession.answers || {},
        answerSheetText: answerSheet?.extractedText || "",
      });
      let execution;
      try {
        execution = await executeAuthorizedAiOperation({
          repository,
          session,
          config: aiProviderConfig,
          requestFingerprint: operation.requestFingerprint,
          workflow: "study_test_evaluation",
          responseMode: "json",
          logger,
          allowanceRequest: {
            planTier: activePlanKey,
            periodKey: period.periodKey,
            allowance,
            actionType: task.actionType,
            creditCost: task.creditCost,
            requestId: operation.operationId,
            metadata: { workflow: "study_test_evaluation", todoItemId: item.id, testSessionId: testSession.id },
          },
          run: ({ providerExecutor, routed }) => evaluateStudyTest({
            state,
            item,
            session: testSession,
            answerSheetText: answerSheet?.extractedText || "",
            providerExecutor,
            providerConfig: routed ? { ...aiProviderConfig, requestedMode: "auto" } : aiProviderConfig,
          }),
          isLogicalSuccess: (result) => result?.evaluationSucceeded === true && Boolean(result?.evaluation),
          outcomeForReplay: (result) => ({
            evaluationSucceeded: true,
            evaluation: result.evaluation,
            reused: result.reused === true,
          }),
        });
      } catch (error) {
        if (error.code === "idempotency_conflict") throw error;
        logger.warn("study_test_evaluation.execution_failed", { requestId: req.requestId, status: error.status || 500 });
        sendJson(res, 200, {
          evaluated: false,
          retryable: true,
          message: AI_ALLOWANCE_COPY.unavailable,
          state: publicState(state, persistence),
          secretsPrinted: false,
        });
        return;
      }
      if (execution.busy) {
        sendJson(res, 200, routedOperationBusyPayload(state, persistence, "evaluated"));
        return;
      }
      if (execution.blocked) {
        sendJson(res, 200, {
          evaluated: false,
          allowanceLimited: true,
          message: `${AI_ALLOWANCE_COPY.exhausted} ${AI_ALLOWANCE_COPY.exhaustedNextStep}`,
          weeklyAiHelp: weeklyAiHelpForExecution({ execution, allowance, creditCost: task.creditCost, refreshesAt: period.refreshesAt, blocked: true }),
          state: publicState(state, persistence),
          secretsPrinted: false,
        });
        return;
      }
      const result = execution.result || {};
      const evaluated = execution.success === true;
      const weeklyAiHelp = weeklyAiHelpForExecution({ execution, allowance, creditCost: task.creditCost, refreshesAt: period.refreshesAt });
      if (!evaluated) {
        sendJson(res, 200, {
          evaluated: false,
          retryable: true,
          message: "StudentOS could not evaluate this test right now. Your answers are safe. Please try again.",
          weeklyAiHelp,
          state: publicState(state, persistence),
          secretsPrinted: false,
        });
        return;
      }
      const assessedTopicIds = new Set((testSession.testPaper?.questions || []).map((question) => question.topic_id || question.topicId).filter(Boolean));
      const priorEvidenceCount = (state.testResults || []).filter((testResult) => (testResult.topicEvidence || []).some((evidence) => assessedTopicIds.has(evidence.topicId))).length;
      const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
      applyStudyTestEvaluation({ state, item, session: testSession, evaluation: result.evaluation, answerSheet });
      if (recoveryConfig.enabled) {
        const persistedResult = (state.testResults || []).find((testResult) => testResult.testSessionId === testSession.id);
        recordAcademicEvent(state, {
          eventType: priorEvidenceCount > 0 ? "reassessment_completed" : "assessment_completed",
          sourceEntityType: "test_result",
          sourceEntityId: persistedResult?.id || testSession.id,
          idempotencyKey: `assessment:${persistedResult?.id || testSession.id}`,
          correlationId: req.requestId,
          payload: {
            testSessionId: testSession.id,
            testResultId: persistedResult?.id || null,
            topicIds: (persistedResult?.topicEvidence || []).map((evidence) => evidence.topicId).filter(Boolean),
          },
        });
        queueAutomaticRecovery(state, { correlationId: req.requestId });
      }
      await persistRecoveryAwareMutation({
        repository,
        session,
        state,
        baseline: recoveryBaseline,
        ordinarySave: () => repository.saveOrdinaryState(session, state),
        correlationId: req.requestId,
      });
      sendJson(res, 200, {
        evaluated: true,
        testSession: publicTestSession(testSession),
        evaluation: result.evaluation,
        weeklyAiHelp,
        state: publicState(state, persistence),
        message: "Your result is ready.",
        secretsPrinted: false,
      });
      return;
    } finally {
      if (!routedEvaluation) studyTestEvaluationsInFlight.delete(inFlightKey);
    }
  }

  const studyTestMatch = url.pathname.match(/^\/api\/study\/tests\/([^/]+)$/);
  if (studyTestMatch && ["GET", "PATCH"].includes(req.method)) {
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const testSession = findStudyTestSession(state, { sessionId: decodeURIComponent(studyTestMatch[1]) });
    if (!testSession) {
      const error = new Error("This test is no longer available.");
      error.status = 404;
      throw error;
    }
    const previousStatus = testSession.status;
    synchronizeTestSession(testSession);
    if (req.method === "PATCH") {
      if (testSession.status === "time_expired") {
        await repository.saveState(session, state);
        sendJson(res, 409, {
          error: "Time is up. This attempt is locked.",
          testSession: publicTestSession(testSession),
          state: publicState(state, persistence),
          secretsPrinted: false,
        });
        return;
      }
      const body = await readJsonBody(req);
      saveStudyTestAnswers(testSession, body.answers);
    }
    if (req.method === "PATCH" || testSession.status !== previousStatus) await repository.saveState(session, state);
    sendJson(res, 200, {
      testSession: publicTestSession(testSession),
      state: publicState(state, persistence),
      message: req.method === "PATCH" ? "Answers saved." : null,
      secretsPrinted: false,
    });
    return;
  }

  const studyMaterialOpenMatch = url.pathname.match(/^\/api\/(?:academic-context|study)\/materials\/([^/]+)\/open$/);
  if (req.method === "GET" && studyMaterialOpenMatch) {
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    const materialId = decodeURIComponent(studyMaterialOpenMatch[1]);
    const material = (state.sourceMaterials || []).find((source) => source.id === materialId && !source.deletedAt && isAcademicContextRecord(source));
    if (!material || !material.storageBucket || !material.storagePath) {
      const error = new Error("This material is not available to open here.");
      error.status = 404;
      throw error;
    }
    const download = await repository.downloadStorageObject(session, {
      bucket: material.storageBucket,
      path: material.storagePath,
    });
    if (!download?.bytes) {
      const error = new Error("This material is not available to open here.");
      error.status = 404;
      throw error;
    }
    sendPrivateMaterial(res, download.bytes, material.filename || `${material.title || "study-material"}.pdf`, material.mimeType || "application/pdf");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/product-flow") {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    requireAccountSession(session);
    if (body.action === "save_materials") {
      assertAcademicContextSelection(state, body.payload?.materialIds || []);
      const classroomPolicy = getProductClassroomPolicy(state);
      if (classroomPolicy.courseworkReviewEnabled === true) {
        const classroomIds = new Set((state.classroomItems || []).map((item) => String(item.id)));
        const selectedClassroomIds = (body.payload?.materialIds || []).map(String).filter((id) => classroomIds.has(id));
        const selected = selectClassroomItemsForAcademicContext(state, selectedClassroomIds, { replace: true });
        if (selected.imported.length) markAcademicContextNeedsPreparation(state, "classroom_context_selected");
      } else {
        const classroomIds = new Set((state.classroomItems || []).map((item) => String(item.id)));
        body.payload.materialIds = (body.payload?.materialIds || []).map(String).filter((id) => !classroomIds.has(id));
      }
    }
    const lifecycle = applyProductLifecycleAction(state, body.action, body.payload || {}, {
      config: productFlowConfig,
    });
    if (body.action === "save_onboarding_step") {
      bindProductOnboardingStep(state, body.payload?.step);
      state.studentProfile.preferences.onboardingDataVersion = 1;
    }
    if (body.action === "complete_legal") {
      recordLegalAcceptance(state, {
        accepted: true,
        acceptanceSource: "required_product_flow",
      }, lifecycleConfig);
    }
    await repository.saveState(session, state);
    sendJson(res, 200, {
      lifecycle: getProductLifecycleSnapshot(state),
      state: publicState(state, persistence),
      payment: {
        verificationMode: lifecycle.paymentMethodVerificationMode,
        realPaymentCompleted: false,
        chargeCreated: false,
        mandateCreated: false,
      },
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/onboarding") {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
    const previousSchedule = state.studentProfile?.preferences?.scheduleText || state.studentProfile?.preferences?.timetableText || "";
    const previousAcademicProfile = JSON.stringify({
      gradeBand: state.studentProfile?.gradeBand || null,
      schoolSystem: state.studentProfile?.schoolSystem || null,
      academicGoal: state.studentProfile?.preferences?.academicGoal || null,
      dailyStudyAvailabilityMinutes: state.studentProfile?.preferences?.dailyStudyAvailabilityMinutes || null,
      schedule: previousSchedule,
    });
    const onboarding = applyStudentOnboarding(state, body);
    markAcademicContextNeedsPreparation(state, "profile_or_academic_context_updated");
    const nextSchedule = state.studentProfile?.preferences?.scheduleText || state.studentProfile?.preferences?.timetableText || "";
    const nextAcademicProfile = JSON.stringify({
      gradeBand: state.studentProfile?.gradeBand || null,
      schoolSystem: state.studentProfile?.schoolSystem || null,
      academicGoal: state.studentProfile?.preferences?.academicGoal || null,
      dailyStudyAvailabilityMinutes: state.studentProfile?.preferences?.dailyStudyAvailabilityMinutes || null,
      schedule: nextSchedule,
    });
    if (recoveryConfig.enabled && previousAcademicProfile !== nextAcademicProfile) {
      recordAcademicEvent(state, {
        eventType: previousSchedule !== nextSchedule ? "availability_changed" : "academic_context_updated",
        sourceEntityType: "student_profile",
        sourceEntityId: session.user.id,
        idempotencyKey: `onboarding:${req.headers["idempotency-key"] || req.requestId}`,
        correlationId: req.requestId,
        payload: previousSchedule !== nextSchedule ? { availabilityChanged: true } : { contextUpdated: true },
      });
      queueAutomaticRecovery(state, { correlationId: req.requestId });
    }
    await persistRecoveryAwareMutation({ repository, session, state, baseline: recoveryBaseline, ordinarySave: () => repository.saveOrdinaryState(session, state), correlationId: req.requestId });
    sendJson(res, 200, {
      onboarding,
      state: publicState(state, persistence),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/courses") {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
    const course = addManualCourse(state, body);
    if (recoveryConfig.enabled) {
      recordAcademicEvent(state, {
        eventType: "academic_context_updated",
        sourceEntityType: "course",
        sourceEntityId: course.id,
        idempotencyKey: `course_created:${course.id}`,
        correlationId: req.requestId,
        payload: { change: "created" },
      });
      queueAutomaticRecovery(state, { correlationId: req.requestId });
    }
    await persistRecoveryAwareMutation({ repository, session, state, baseline: recoveryBaseline, ordinarySave: () => repository.saveOrdinaryState(session, state), correlationId: req.requestId });
    sendJson(res, 201, {
      course,
      state: publicState(state, persistence),
      message: "This course can now be used when uploading academic context.",
      secretsPrinted: false,
    });
    return;
  }

  const manualCoursePath = url.pathname.match(/^\/api\/courses\/([^/]+)$/);
  if (manualCoursePath && ["PATCH", "DELETE"].includes(req.method)) {
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
    const courseId = decodeURIComponent(manualCoursePath[1]);
    const course = req.method === "PATCH"
      ? updateManualCourse(state, courseId, await readJsonBody(req))
      : archiveManualCourse(state, courseId);
    if (recoveryConfig.enabled) {
      recordAcademicEvent(state, {
        eventType: "academic_context_updated",
        sourceEntityType: "course",
        sourceEntityId: courseId,
        idempotencyKey: `course_${req.method === "PATCH" ? "updated" : "archived"}:${courseId}:${course.updatedAt || req.requestId}`,
        correlationId: req.requestId,
        payload: { change: req.method === "PATCH" ? "updated" : "archived" },
      });
      queueAutomaticRecovery(state, { correlationId: req.requestId });
    }
    await persistRecoveryAwareMutation({ repository, session, state, baseline: recoveryBaseline, ordinarySave: () => repository.saveOrdinaryState(session, state), correlationId: req.requestId });
    sendJson(res, 200, {
      course,
      state: publicState(state, persistence),
      message: req.method === "PATCH"
        ? "Course details saved."
        : "Course archived.",
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/classroom/mock/assignments") {
    const { state } = await getStateContext(req);
    const classroomConnector = new MockGoogleClassroomConnector(state);
    sendJson(res, 200, {
      connector: classroomConnector.getCapabilities(),
      assignments: await classroomConnector.listAssignments(),
      writebackEnabled: false,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/classroom/status") {
    const { session, state } = await getStateContext(req);
    const connector = await getClassroomConnectorStatus({
      state,
      session,
      repository,
      userId: session.user.id,
      config: googleClassroomConfig,
    });
    sendJson(res, 200, {
      connector: publicClassroomConnector(connector),
      policy: getPublicEntitlementSummary(resolveEntitlements(state).activePlanKey).classroom,
      readOnly: true,
      writebackEnabled: false,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/classroom/oauth/start") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    const productLifecycle = getProductLifecycleSnapshot(state);
    const courseRecovery = body.purpose === "course_recovery";
    if (courseRecovery) {
      requireDashboardActive(state);
      if (!getProductClassroomPolicy(state).planReady) {
        const error = new Error("Finish plan setup before connecting Classroom.");
        error.status = 403;
        throw error;
      }
    } else if (!productLifecycle.paymentMethodVerified || !productLifecycle.legalConsentComplete || productLifecycle.classroomChoice !== "classroom") {
      const error = new Error("Choose Classroom during setup after completing the access and agreement steps.");
      error.status = 403;
      throw error;
    }
    const connector = await getClassroomConnectorStatus({
      state,
      session,
      repository,
      userId: session.user.id,
      config: googleClassroomConfig,
    });
    if (!connector.actions.connect && !connector.actions.reconnect) {
      if (connector.connected) {
        markProductClassroomConnected(state);
        await repository.saveState(session, state);
      }
      sendJson(res, connector.connected ? 200 : 409, {
        connector: publicClassroomConnector(connector),
        authorizationUrl: null,
        message: connector.message,
        secretsPrinted: false,
      });
      return;
    }
    requireAccountSession(session);
    const stateToken = createClassroomOAuthState({
      userId: session.user.id,
      config: googleClassroomConfig,
      purpose: courseRecovery ? "course_recovery" : "setup",
    });
    const authorizationUrl = buildClassroomOAuthUrl({
      config: googleClassroomConfig,
      state: stateToken,
    });
    sendJson(res, 200, {
      authorizationUrl,
      connector: publicClassroomConnector(connector),
      readOnly: true,
      writebackEnabled: false,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/classroom/oauth/callback") {
    const code = String(url.searchParams.get("code") || "");
    const stateToken = String(url.searchParams.get("state") || "");
    if (!code || !stateToken) {
      sendHtml(res, 400, "<!doctype html><title>StudentOS Classroom</title><p>Classroom connection details are missing. Return to StudentOS and try again.</p>");
      return;
    }
    try {
      const claims = verifyClassroomOAuthState(stateToken, { config: googleClassroomConfig });
      const token = await exchangeClassroomOAuthCode({ code, config: googleClassroomConfig });
      const session = {
        authenticated: true,
        mode: "google_classroom_oauth",
        user: { id: claims.sub, email: "" },
      };
      const state = await repository.loadState(session);
      const profile = await fetchGoogleOAuthProfile({
        accessToken: token.access_token,
      }).catch(() => ({}));
      const metadata = await savePersistentClassroomToken({
        session,
        repository,
        token,
        config: googleClassroomConfig,
        providerAccountEmail: profile.email || "",
      });
      markClassroomConnected(state, metadata, { mode: "oauth" });
      const courseRecovery = claims.purpose === "course_recovery";
      if (!courseRecovery) markProductClassroomConnected(state);
      const classroomPolicy = getProductClassroomPolicy(state);
      await syncGoogleClassroomIntoState({
        state,
        session,
        repository,
        config: googleClassroomConfig,
        courseOnly: courseRecovery || classroomPolicy.courseOnly === true,
      }).catch((error) => {
        logger.warn("classroom_onboarding_sync.failed", {
          requestId: req.requestId,
          status: error.status || 500,
          error: error.message,
        });
      });
      await repository.saveState(session, state);
      sendHtml(res, 200, `<!doctype html>
        <title>StudentOS Classroom Connected</title>
        <body>
          <h1>Google Classroom connected</h1>
          <p>${courseRecovery
            ? "StudentOS refreshed your course names only. It did not import assignments or materials."
            : classroomPolicy.courseOnly === true
              ? "Starter uses Classroom only to help set up your course list. Upload PDFs manually to add assignments or materials."
              : "Classroom connection is ready. Choose the work you want to add to your academic context."}</p>
          <script>setTimeout(() => { location.href = ${JSON.stringify(publicFrontendUrl).replace(/</g, "\\u003c")}; }, 1200);</script>
        </body>`);
    } catch {
      sendHtml(res, 400, "<!doctype html><title>StudentOS Classroom</title><p>Classroom connection could not finish. Return to StudentOS and reconnect when ready.</p>");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/classroom/disconnect") {
    const { session, state } = await getStateContext(req);
    const connector = await getClassroomConnectorStatus({
      state,
      session,
      repository,
      userId: session.user.id,
      config: googleClassroomConfig,
    });
    if (!connector.actions.disconnect) {
      sendJson(res, 200, {
        connector: publicClassroomConnector(connector),
        disconnected: connector.state !== "connected",
        message: connector.message,
        secretsPrinted: false,
      });
      return;
    }
    if (googleClassroomConfig.mode === "oauth") requireAccountSession(session);
    await disconnectGoogleClassroom(state, session.user.id, { session, repository });
    await repository.saveState(session, state);
    const updatedConnector = await getClassroomConnectorStatus({
      state,
      session,
      repository,
      userId: session.user.id,
      config: googleClassroomConfig,
    });
    sendJson(res, 200, {
      connector: publicClassroomConnector(updatedConnector),
      disconnected: true,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/classroom/courses/refresh") {
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const classroomPolicy = getProductClassroomPolicy(state);
    if (!classroomPolicy.planReady) {
      const error = new Error("Finish plan setup before refreshing your course list.");
      error.status = 403;
      throw error;
    }
    const connector = await getClassroomConnectorStatus({
      state,
      session,
      repository,
      userId: session.user.id,
      config: googleClassroomConfig,
    });
    if (!connector.connected || !connector.actions.sync) {
      sendJson(res, 409, {
        error: connector.reconnectRequired
          ? "Reconnect Classroom to refresh your course list."
          : "Connect Classroom to refresh your course list.",
        connector: publicClassroomConnector(connector),
        syncBlocked: true,
        readOnly: true,
        writebackEnabled: false,
        secretsPrinted: false,
      });
      return;
    }
    if (googleClassroomConfig.mode === "oauth") requireAccountSession(session);
    const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
    const result = await syncGoogleClassroomIntoState({
      state,
      session,
      repository,
      config: googleClassroomConfig,
      courseOnly: true,
    });
    if ((result.summary?.importedCourses || 0) + (result.summary?.updatedCourses || 0) > 0) {
      markAcademicContextNeedsPreparation(state, "classroom_courses_updated");
    }
    if (recoveryConfig.enabled) {
      const meaningfulChanges = Number(result.summary?.importedAssignments || result.summary?.discoveredAssignments || 0) + Number(result.summary?.updatedAssignments || 0) + Number(result.summary?.importedCourses || 0) + Number(result.summary?.updatedCourses || 0);
      if (meaningfulChanges > 0) {
        recordAcademicEvent(state, {
          eventType: "classroom_sync_completed",
          sourceEntityType: "classroom_sync_run",
          sourceEntityId: result.syncRun?.id || req.requestId,
          idempotencyKey: `classroom_sync:${result.syncRun?.id || req.requestId}`,
          correlationId: req.requestId,
          payload: { meaningfulChanges, importedAssignments: result.summary?.importedAssignments || result.summary?.discoveredAssignments || 0, updatedAssignments: result.summary?.updatedAssignments || 0 },
        });
        queueAutomaticRecovery(state, { correlationId: req.requestId });
      }
    }
    await persistRecoveryAwareMutation({ repository, session, state, baseline: recoveryBaseline, ordinarySave: () => repository.saveOrdinaryState(session, state), correlationId: req.requestId });
    sendJson(res, 200, {
      ...result,
      connector: publicClassroomConnector(result.connector),
      summary: publicClassroomSummary(result.summary),
      syncRun: publicClassroomSyncRun(result.syncRun),
      state: publicState(state, persistence),
      message: "Courses refreshed.",
      policy: getPublicEntitlementSummary(resolveEntitlements(state).activePlanKey).classroom,
      readOnly: true,
      writebackEnabled: false,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/classroom/sync") {
    const { session, state, persistence } = await getStateContext(req);
    requireProductClassroomSyncAccess(state);
    const classroomPolicy = getProductClassroomPolicy(state);
    if (!classroomPolicy.planReady || classroomPolicy.manualImportEnabled !== true) {
      const error = new Error("Plan setup pending. Finish setup before checking Classroom coursework.");
      error.status = 403;
      throw error;
    }
    const connector = await getClassroomConnectorStatus({
      state,
      session,
      repository,
      userId: session.user.id,
      config: googleClassroomConfig,
    });
    if (!connector.actions.sync) {
      sendJson(res, 409, {
        error: connector.syncBlockedReason || connector.message || "Classroom is not ready to sync.",
        connector: publicClassroomConnector(connector),
        syncBlocked: true,
        readOnly: true,
        writebackEnabled: false,
        secretsPrinted: false,
      });
      return;
    }
    if (googleClassroomConfig.mode === "oauth") requireAccountSession(session);
    const result = await syncGoogleClassroomIntoState({
      state,
      session,
      repository,
      config: googleClassroomConfig,
      courseOnly: classroomPolicy.courseOnly === true,
    });
    if ((result.summary?.importedCourses || 0) + (result.summary?.updatedCourses || 0) > 0) {
      markAcademicContextNeedsPreparation(state, "classroom_courses_updated");
    }
    await repository.saveState(session, state);
    sendJson(res, 200, {
      ...result,
      connector: publicClassroomConnector(result.connector),
      summary: publicClassroomSummary(result.summary),
      syncRun: publicClassroomSyncRun(result.syncRun),
      state: publicState(state, persistence),
      assignmentInsights: getAssignmentInsights(state),
      todayNextActions: getTodayNextActions(state),
      policy: getPublicEntitlementSummary(resolveEntitlements(state).activePlanKey).classroom,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/classroom/selection") {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    requireAccountSession(session);
    requireProductMaterialAccess(state);
    const policy = getProductClassroomPolicy(state);
    if (!policy.planReady || policy.manualImportEnabled !== true || policy.courseworkReviewEnabled !== true) {
      const error = new Error("Your current plan is not ready to add Classroom work.");
      error.status = 403;
      throw error;
    }
    const ignoredIds = Array.isArray(body.ignoreIds) ? body.ignoreIds.map(String) : [];
    if (ignoredIds.length) {
      const ignored = ignoreClassroomItemsForAcademicContext(state, ignoredIds);
      await repository.saveState(session, state);
      sendJson(res, 200, {
        state: publicState(state, persistence),
        ignoredCount: ignored.length,
        message: ignored.length ? "Classroom work was left out of your academic context." : "No Classroom work changed.",
        readOnly: true,
        writebackEnabled: false,
        secretsPrinted: false,
      });
      return;
    }
    const requestedIds = Array.isArray(body.itemIds) ? body.itemIds.map(String) : [];
    const lifecycle = getProductLifecycleSnapshot(state);
    const currentlyImportedIds = (state.classroomItems || [])
      .filter((item) => item.academicContextIncluded && item.selectionState === "imported")
      .map((item) => item.id);
    const mergedIds = [...new Set([...(lifecycle.selectedMaterialIds || []), ...currentlyImportedIds, ...requestedIds])];
    assertAcademicContextSelection(state, mergedIds);
    const selection = selectClassroomItemsForAcademicContext(state, requestedIds, { replace: false });
    if (selection.imported.length) markAcademicContextNeedsPreparation(state, "classroom_context_selected");
    const importedLabels = selection.imported.map((item) => item.title);
    state.studentProfile.productLifecycle.selectedMaterialIds = mergedIds;
    state.studentProfile.productLifecycle.selectedMaterialLabels = [...new Set([
      ...(lifecycle.selectedMaterialLabels || []),
      ...importedLabels,
    ])];
    await repository.saveState(session, state);
    sendJson(res, 200, {
      state: publicState(state, persistence),
      selectedCount: selection.imported.length,
      message: selection.imported.length
        ? "Selected Classroom work was added to your academic context."
        : "Choose Classroom work to include in your academic context.",
      readOnly: true,
      writebackEnabled: false,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/classroom/sync-history") {
    const { session, state } = await getStateContext(req);
    const connector = await getClassroomConnectorStatus({
      state,
      session,
      repository,
      userId: session.user.id,
      config: googleClassroomConfig,
    });
    const history = await repository.listClassroomSyncRuns(session, { limit: 12 });
    sendJson(res, 200, {
      connector: publicClassroomConnector(connector),
      syncHistory: history.map(publicClassroomSyncRun),
      readOnly: true,
      writebackEnabled: false,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ai/verb") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    assertProductFeatureAccess(state, FEATURE_KEYS.ASSISTANT);
    const requestedVerb = ["Ask", "Plan", "Make", "Review"].includes(body.verb) ? body.verb : "Ask";
    const verbFeature = {
      Plan: FEATURE_KEYS.ROADMAP_BASIC,
      Make: FEATURE_KEYS.NOTES_GENERATION,
      Review: FEATURE_KEYS.ASSESSMENT_BASIC,
    }[requestedVerb];
    if (verbFeature) {
      assertProductFeatureAccess(state, verbFeature, {
        message: requestedVerb === "Make"
          ? "Study material creation is available with Starter or higher. You can still ask StudentOS for guided help."
          : "This study workflow is available on a different StudentOS plan. Review plans to continue.",
      });
    }
    const assistantPolicy = getAssistantExecutionPolicy(state);
    enforceRateLimit(req, session, "ai_call");
    const deterministic = getDeterministicAiResponse(body.message || "");
    if (deterministic) {
      const result = {
        verb: requestedVerb,
        answer: deterministic.answer,
        sourceLabels: [],
        nextActions: [],
        deterministic: true,
        generationSucceeded: true,
        grounding: {
          uploadedMaterialUsed: false,
          insufficientContext: false,
          insufficiencyReason: null,
          snippets: [],
        },
      };
      const { conversation, messages } = createAiPersistencePayload({ session, body, result });
      await repository.saveAiConversation(session, conversation, messages).catch((error) => {
        logger.warn("ai_conversation.persistence_failed", { requestId: req.requestId, status: error.status || 500 });
      });
      sendJson(res, 200, publicAiResult(result));
      return;
    }
    const activePlanKey = resolveEntitlements(state).activePlanKey;
    const starterContextReady = activePlanKey !== "starter" || getAcademicContextReadiness(state).canGenerateTodo;
    const assistantState = starterContextReady ? state : {
      ...state,
      sourceMaterials: [],
      sourceChunks: [],
      memoryItems: [],
    };
    const groundingContext = getGroundingContext(assistantState, body.message || "");
    const retrievalOverride = await repository.retrieveGroundedChunks(session, {
      state: assistantState,
      message: body.message || "",
      topic: groundingContext.topic,
      course: groundingContext.course,
      limit: assistantPolicy.retrievalLimit,
    });
    const allowance = getAiWeeklyAllowance(activePlanKey);
    const period = getAiWeeklyPeriod();
    const task = classifyAiTask({ verb: requestedVerb, message: body.message || "", retrieval: retrievalOverride });
    const operation = aiOperationIdentity(req, "assistant", {
      verb: requestedVerb,
      message: body.message || "",
    });
    let execution;
    try {
      execution = await executeAuthorizedAiOperation({
        repository,
        session,
        config: aiProviderConfig,
        requestFingerprint: operation.requestFingerprint,
        workflow: "assistant",
        responseMode: "text",
        logger,
        allowanceRequest: {
          planTier: activePlanKey,
          periodKey: period.periodKey,
          allowance,
          actionType: task.actionType,
          creditCost: task.creditCost,
          requestId: operation.operationId,
          metadata: { workflow: "assistant", verb: requestedVerb },
        },
        run: async ({ providerExecutor, routed }) => {
          try {
            return await runStudentOsVerb({
              verb: requestedVerb,
              message: body.message || "",
              state: assistantState,
              retrievalOverride,
              assistantPolicy,
              providerExecutor,
              providerConfig: routed ? { ...aiProviderConfig, requestedMode: "auto" } : aiProviderConfig,
            });
          } catch (error) {
            logger.warn("ai_generation.failed", { requestId: req.requestId, status: error.status || 500 });
            return {
              verb: requestedVerb,
              answer: AI_ALLOWANCE_COPY.unavailable,
              sourceLabels: [],
              nextActions: [],
              generationSucceeded: false,
              retryable: true,
              grounding: { uploadedMaterialUsed: false, insufficientContext: false, insufficiencyReason: null, snippets: [] },
            };
          }
        },
        isLogicalSuccess: (result) => result?.generationSucceeded !== false && Boolean(String(result?.answer || "").trim()),
      });
    } catch (error) {
      if (error.code === "idempotency_conflict") throw error;
      logger.warn("ai_operation.failed", { requestId: req.requestId, status: error.status || 500 });
      sendJson(res, 200, publicAiResult({
        verb: requestedVerb,
        answer: AI_ALLOWANCE_COPY.unavailable,
        sourceLabels: [],
        nextActions: [],
        generationSucceeded: false,
        retryable: true,
        grounding: { uploadedMaterialUsed: false, insufficientContext: false, insufficiencyReason: null, snippets: [] },
      }));
      return;
    }
    if (execution.busy) {
      sendJson(res, 200, publicAiResult({
        verb: requestedVerb,
        answer: "StudentOS is finishing another study request. Please try again in a moment.",
        sourceLabels: [],
        nextActions: [],
        generationSucceeded: false,
        retryable: true,
        grounding: { uploadedMaterialUsed: false, insufficientContext: false, insufficiencyReason: null, snippets: [] },
      }));
      return;
    }
    if (execution.blocked) {
      sendJson(res, 200, publicAiResult({
        verb: requestedVerb,
        answer: `${AI_ALLOWANCE_COPY.exhausted} ${AI_ALLOWANCE_COPY.exhaustedNextStep}`,
        sourceLabels: [],
        nextActions: ["Update your courses or academic context"],
        generationSucceeded: false,
        allowanceLimited: true,
        weeklyAiHelp: weeklyAiHelpForExecution({ execution, allowance, creditCost: task.creditCost, refreshesAt: period.refreshesAt, blocked: true }),
        grounding: { uploadedMaterialUsed: false, insufficientContext: false, insufficiencyReason: null, snippets: [] },
      }));
      return;
    }
    const result = execution.result || {
      verb: requestedVerb,
      answer: AI_ALLOWANCE_COPY.unavailable,
      sourceLabels: [],
      nextActions: [],
      generationSucceeded: false,
      retryable: true,
      grounding: { uploadedMaterialUsed: false, insufficientContext: false, insufficiencyReason: null, snippets: [] },
    };
    const generated = execution.success === true;
    if (!generated) {
      logger.warn("ai_generation.provider_unavailable", {
        requestId: req.requestId,
        failureCode: result.internalFailureCode || "provider_unavailable",
      });
    }
    result.weeklyAiHelp = weeklyAiHelpForExecution({ execution, allowance, creditCost: task.creditCost, refreshesAt: period.refreshesAt });
    const { conversation, messages } = createAiPersistencePayload({ session, body, result, operationId: operation.operationId });
    await repository.saveAiConversation(session, conversation, messages).catch((error) => {
      logger.warn("ai_conversation.persistence_failed", { requestId: req.requestId, status: error.status || 500 });
    });
    sendJson(res, 200, publicAiResult(result));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/embeddings/reindex") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    requireUploadSession(session);
    const summary = await reindexSourceChunkEmbeddings({
      sourceChunks: state.sourceChunks,
      limit: Math.min(Number(body.limit) || 50, 250),
      includeEmbedded: body.force === true,
    });
    const metadataById = new Map((state.embeddingsMetadata || []).map((item) => [item.id, item]));
    for (const row of createEmbeddingMetadataForChunks({
      material: { id: null, userId: state.studentProfile.id },
      sourceChunks: state.sourceChunks.filter((chunk) => summary.chunkIds.includes(chunk.id)),
    })) {
      const existing = metadataById.get(row.id);
      if (existing) Object.assign(existing, row);
      else state.embeddingsMetadata.push(row);
    }
    state.auditLog.push({
      id: `audit_reindex_${Date.now()}`,
      actorId: state.studentProfile.id,
      action: "source_embeddings.reindexed",
      targetType: "source_chunks",
      riskLevel: "low",
      metadata: {
        selected: summary.selected,
        embedded: summary.embedded,
        failed: summary.failed,
        mode: summary.mode,
      },
      createdAt: new Date().toISOString(),
    });
    await repository.saveSourceIngestion(session, state);
    sendJson(res, 200, {
      summary,
      retrievalModeStatus: publicRetrievalStatus(repository.getInfo(session)),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/jobs/retry-failed") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    requireUploadSession(session);
    enforceRateLimit(req, session, "worker_retry");
    enforceUsage(state, "worker_retry");
    const retried = retryFailedJobs(state.backgroundJobs || [], {
      sourceId: body.sourceId || null,
    });
    for (const job of retried) {
      recordJobEvent(state, {
        job,
        eventType: "retry",
        message: "Failed background job returned to queue.",
        metadata: { sourceId: job.sourceId },
      });
    }
    await repository.saveBackgroundJobs(session, state);
    sendJson(res, 200, {
      retried: retried.length,
      jobIds: retried.map((job) => job.id),
      queueHealth: buildQueueHealth(state.backgroundJobs || []),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/jobs/health") {
    const { session, state } = await getStateContext(req);
    sendJson(res, 200, {
      queueHealth: buildQueueHealth(state.backgroundJobs || []),
      retrievalModeStatus: publicRetrievalStatus(repository.getInfo(session)),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tests/score") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
    const result = applyTestScore(state, body);
    markPlanningStateStale(state, "test_result_updated", { clearPlan: false });
    refreshAcademicRoadmap(state);
    if (recoveryConfig.enabled) recordAcademicEvent(state, {
      eventType: "assessment_completed",
      sourceEntityType: "test_result",
      sourceEntityId: result?.testResult?.id || result?.id || req.requestId,
      idempotencyKey: `legacy_assessment:${result?.testResult?.id || result?.id || req.requestId}`,
      correlationId: req.requestId,
      payload: { testResultId: result?.testResult?.id || result?.id || null },
    });
    if (recoveryConfig.enabled) queueAutomaticRecovery(state, { correlationId: req.requestId });
    await persistRecoveryAwareMutation({ repository, session, state, baseline: recoveryBaseline, ordinarySave: () => repository.saveOrdinaryState(session, state), correlationId: req.requestId });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/assignment-flow") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    try {
      const flow = handleAssignmentLearningFlow(state, body.assignmentId);
      await repository.saveAssignmentFlow(session, state);
      sendJson(res, 200, {
        flow,
        assignmentInsights: getAssignmentInsights(state),
        todayNextActions: getTodayNextActions(state),
        secretsPrinted: false,
      });
    } catch (error) {
      sendJson(res, error.status || 500, {
        error: error.status === 404
          ? "Assignment not found"
          : "StudentOS could not prepare this assignment. Check Classroom work and try again.",
        assignmentFlowError: true,
        requestId: req.requestId,
        secretsPrinted: false,
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/assignments/") && url.pathname.endsWith("/coverage")) {
    const { state } = await getStateContext(req);
    const assignmentId = url.pathname.split("/")[3];
    const assignment = findAssignment(state, assignmentId);
    if (!assignment) {
      sendJson(res, 404, { error: "Assignment not found" });
      return;
    }
    sendJson(res, 200, determineAssignmentCoverage(state, assignment));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/assignment-contract") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    assertProductFeatureAccess(state, FEATURE_KEYS.ASSIGNMENT_COACH, {
      message: "Assignment Coach is available with Plus or Pro. Student review is always required.",
    });
    const assignment = findAssignment(state, body.assignmentId);
    if (!assignment) {
      sendJson(res, 404, { error: "Assignment not found" });
      return;
    }
    const course = findCourse(state, assignment.courseId);
    const topics = findTopics(state, assignment.topicIds);
    const contract = createAssignmentAutomationContractForState({
      state,
      assignment,
      course,
      topics,
      creditBalance: getCreditBalance(state),
    });
    state.assignmentAutomationContracts.push(contract);
    state.auditLog.push({
      id: `audit_${contract.id}`,
      actorId: state.studentProfile.id,
      action: "assignment_automation_contract.created",
      riskLevel: "medium",
      createdAt: new Date().toISOString(),
    });
    await repository.saveAssignmentContract(session, state);
    sendJson(res, 200, { contract, creditBalance: getCreditBalance(state) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/extension/draft") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    assertProductFeatureAccess(state, FEATURE_KEYS.ASSIGNMENT_COACH, {
      message: "Assignment preparation is available with Plus or Pro. Student review is always required.",
    });
    const assignment = findAssignment(state, body.assignmentId) || state.assignments.find(isAcademicContextRecord);
    const draft = buildExtensionDecisionDraft({
      profile: state.studentProfile,
      assignment,
      reason: body.reason || "",
    });
    state.auditLog.push({
      id: `audit_${draft.id}`,
      actorId: state.studentProfile.id,
      action: "extension_decision_draft.created",
      riskLevel: "medium",
      createdAt: new Date().toISOString(),
    });
    await repository.saveState(session, state);
    sendJson(res, 200, { draft });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tutor/lesson") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    const topic = state.topics.find((item) => item.id === body.topicId && isAcademicContextRecord(item)) || state.topics.find(isAcademicContextRecord);
    if (!topic) {
      const error = new Error("Add a course topic before starting a tutor lesson.");
      error.status = 400;
      throw error;
    }
    const course = findCourse(state, topic.courseId);
    const sources = (state.sourceMaterials || []).filter((source) => isAcademicContextRecord(source) && (topic.sourceMaterialIds || []).includes(source.id));
    const lesson = createTutorLesson({
      course,
      topic,
      sources,
      trigger: body.trigger || "manual",
      coverageStatus: body.coverageStatus || "partially_covered",
      wrongConcepts: body.wrongConcepts || [],
    });
    state.tutorLessons.push(lesson);
    await repository.saveTutorLesson(session, state);
    sendJson(res, 200, { lesson });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/sources/status") {
    const { state } = await getStateContext(req);
    const safeSnapshot = publicState(state, { mode: supabaseConfig.mode });
    const safeSources = safeSnapshot.sourceMaterials;
    const safeSourceIds = new Set(safeSources.map((source) => source.id));
    sendJson(res, 200, {
      sources: safeSources,
      chunks: (state.sourceChunks || []).filter((chunk) => safeSourceIds.has(chunk.sourceMaterialId || chunk.sourceId)).map((chunk) => ({
        id: chunk.id,
        sourceId: chunk.sourceId,
        courseId: chunk.courseId,
        chunkIndex: chunk.chunkIndex,
        status: chunk.status || "indexed",
        embeddingStatus: chunk.embeddingStatus || "pending_embedding",
        charCount: chunk.charCount || chunk.characterCount || 0,
        citationLabel: chunk.citationLabel || null,
      })),
      storagePlan: getSourceStoragePlan(supabaseConfig),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sources/upload") {
    let uploadStage = "initializing";
    try {
      uploadStage = "session_context";
      const { session, state, persistence } = await runUploadStage(req, uploadStage, () => getStateContext(req), {
        timeoutMs: 10000,
      });
      requireProductMaterialAccess(state);
      assertAcademicContextCanAdd(state);
      requireUploadSession(session);
      enforceRateLimit(req, session, "upload");

      uploadStage = "multipart_parse";
      const form = await runUploadStage(req, uploadStage, () => readMultipartForm(req, { maxBytes: MAX_SOURCE_UPLOAD_BYTES + 512 * 1024 }), {
        timeoutMs: SOURCE_UPLOAD_PARSE_TIMEOUT_MS,
        onTimeout: () => req.destroy?.(createStageTimeoutError("multipart_parse", SOURCE_UPLOAD_PARSE_TIMEOUT_MS)),
      });
      const file = form.files.file;
      if (!file) {
        sendJson(res, 400, {
          error: "Please upload a PDF for Academic Context.",
          code: "academic_context_pdf_required",
          uploadError: true,
          uploadStage: "validation",
          secretsPrinted: false,
        });
        return;
      }
      const validation = validateAcademicContextPdfUpload({
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.bytes.length,
        bytes: file.bytes,
      });
      const contract = validateManualAcademicContextContract({
        state,
        fields: form.fields,
        file,
        pdfValidation: validation,
      });
      const course = contract.course;
      enforceUsage(state, "upload", { fileSizeBytes: validation.sizeBytes });

      uploadStage = "text_extraction";
      const extraction = await runUploadStage(req, uploadStage, () => extractSourceText({
        bytes: file.bytes,
        mimeType: validation.mimeType,
        filename: validation.filename,
      }));
      const material = createSourceMaterialRecord({
        session,
        course,
        courseId: course?.id || null,
        title: contract.title,
        file: {
          ...file,
          filename: validation.filename,
          mimeType: validation.mimeType,
        },
        config: supabaseConfig,
        extraction: {
          ...extraction,
          status: "extracting",
        },
        artifactKind: contract.kind,
        contextKind: contract.kind === "material" ? "study_material" : contract.kind,
      });
      uploadStage = "storage_upload";
      await runUploadStage(req, uploadStage, () => repository.uploadStorageObject(session, {
        bucket: material.storageBucket,
        path: material.storagePath,
        bytes: file.bytes,
        mimeType: material.mimeType,
      }), {
        timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
      });

      uploadStage = "chunk_embed";
      const chunks = extraction.status === "indexed" ? chunkExtractedText(extraction.extractedText) : [];
      const sourceChunks = await runUploadStage(req, uploadStage, () => embedSourceChunks({
        sourceChunks: createSourceChunks({ material, chunks }),
      }));
      const embeddingRows = createEmbeddingMetadataForChunks({ material, sourceChunks });
      material.status = extraction.status;
      material.extractionStatus = material.status;
      material.extractedText = extraction.extractedText;
      material.extractionSummary = extraction.extractionSummary;
      material.extractionError = extraction.extractionError || null;
      material.extractionPages = extraction.extractionPages ?? null;
      material.extractionProvider = extraction.extractionProvider || null;
      material.ocrRequired = extraction.ocrRequired === true || extraction.status === "needs_ocr";
      material.indexedAt = material.status === "indexed" ? new Date().toISOString() : null;
      material.failedAt = material.status === "failed" || material.status === "needs_ocr" ? new Date().toISOString() : null;
      material.chunkCount = sourceChunks.length;
      const { assignment, syllabus } = linkManualAcademicContextUpload(state, material, contract);
      const memoryItem = material.status === "indexed"
        ? createMemoryItemForSource({ material, course })
        : null;
      state.sourceMaterials.push(material);
      state.sourceChunks.push(...sourceChunks);
      if (memoryItem) state.memoryItems.push(memoryItem);
      state.embeddingsMetadata.push(...embeddingRows);
      markAcademicContextNeedsPreparation(state, `${contract.kind}_uploaded`);
      const completedUploadJob = {
        ...createBackgroundJob({
          userId: session.user.id,
          sourceId: material.id,
          jobType: "source_ingestion",
          status: "completed",
          payload: {
            chunks: sourceChunks.length,
            extractionProvider: material.extractionProvider,
          },
        }),
        attempts: 1,
      };
      state.backgroundJobs.push(completedUploadJob);
      recordJobEvent(state, {
        job: completedUploadJob,
        eventType: "queued",
        message: "Source ingestion job created during upload.",
        metadata: { immediate: true },
      });
      recordJobEvent(state, {
        job: completedUploadJob,
        eventType: material.status === "indexed" ? "completed" : "failed",
        severity: material.status === "indexed" ? "info" : "warn",
        message: material.status === "indexed" ? "Source indexed during upload." : "Source extraction did not finish during upload.",
        metadata: {
          status: material.status,
          extractionError: material.extractionError,
          chunks: sourceChunks.length,
        },
      });
      state.auditLog.push({
        id: `audit_${material.id}`,
        actorId: state.studentProfile.id,
          action: "source_material.uploaded",
        targetType: "source_material",
        targetId: material.id,
        riskLevel: "low",
        metadata: {
          privateBucket: true,
          mimeType: material.mimeType,
          sizeBytes: material.sizeBytes,
        },
        createdAt: new Date().toISOString(),
      });
      const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
      if (recoveryConfig.enabled) {
        recordAcademicEvent(state, {
          eventType: assignment ? "assignment_deadline_changed" : "academic_context_updated",
          sourceEntityType: assignment ? "assignment" : contract.kind,
          sourceEntityId: assignment?.id || syllabus?.id || material.id,
          idempotencyKey: `academic_context_upload:${material.id}`,
          correlationId: req.requestId,
          payload: assignment
            ? { previousDueAt: null, newDueAt: assignment.dueAt || null, courseId: assignment.courseId || null }
            : { contextKind: contract.kind, courseId: material.courseId || null },
        });
        queueAutomaticRecovery(state, { correlationId: req.requestId });
      }

      uploadStage = "source_persist";
      await runUploadStage(req, uploadStage, () => persistRecoveryAwareMutation({
        repository,
        session,
        state,
        baseline: recoveryBaseline,
        ordinarySave: () => recoveryConfig.enabled ? repository.saveOrdinaryState(session, state) : repository.saveSourceIngestion(session, state),
        correlationId: req.requestId,
      }), {
        timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
      });
      sendJson(res, 200, {
        material: {
          id: material.id,
          courseId: material.courseId,
          title: material.title,
          filename: material.filename,
          mimeType: material.mimeType,
          sizeBytes: material.sizeBytes,
          contextKind: material.contextKind,
          assignmentId: assignment?.id || null,
          status: material.status,
          chunkCount: material.chunkCount,
          extractionSummary: material.extractionSummary,
          extractionError: material.extractionError,
          extractionPages: material.extractionPages,
          ocrRequired: material.ocrRequired === true,
          citationLabel: material.citationLabel,
          isPrivate: true,
          publicUrlAllowed: false,
          artifactKind: material.artifactKind,
          origin: material.origin,
          dueDate: material.dueDate || null,
          dueAt: material.dueAt || null,
        },
        assignment: assignment ? {
          id: assignment.id,
          courseId: assignment.courseId,
          title: assignment.title,
          dueDate: assignment.dueDate,
          dueAt: assignment.dueAt,
          status: assignment.status,
          source: assignment.source,
          sourceMaterialId: assignment.sourceMaterialId,
          handedIn: false,
        } : null,
        syllabus: syllabus ? {
          id: syllabus.id,
          courseId: syllabus.courseId,
          title: syllabus.title,
          sourceMaterialId: syllabus.sourceMaterialId,
        } : null,
        memoryItem: memoryItem
          ? {
              id: memoryItem.id,
              title: memoryItem.title,
              sourceMaterialIds: memoryItem.sourceMaterialIds,
            }
          : null,
        status: material.status,
        chunkCount: material.chunkCount,
        extractionSummary: material.extractionSummary,
        extractionError: material.extractionError,
        uploadStage: "completed",
        chunks: sourceChunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          charCount: chunk.charCount,
          tokenEstimate: chunk.tokenEstimate,
          citationLabel: chunk.citationLabel,
          embeddingStatus: chunk.embeddingStatus,
        })),
        retrievalModeStatus: publicRetrievalStatus(repository.getInfo(session)),
        privateStorage: {
          public: false,
        },
        state: publicState(state, persistence),
        academicContext: getPublicAcademicContextCapacity(state),
        secretsPrinted: false,
      });
    } catch (error) {
      const stage = error.uploadStage || uploadStage || "unknown";
      logger.warn("source_upload.failed", {
        requestId: req.requestId,
        stage,
        status: error.status || 500,
        error: error.message,
      });
      sendJson(res, error.status || 500, {
        error: publicErrorMessage(error, "Source upload failed safely."),
        uploadError: true,
        uploadStage: stage,
        requestId: req.requestId,
        retrySafe: true,
        secretsPrinted: false,
      });
    }
    return;
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/api/academic-context/items/")) {
    const itemId = decodeURIComponent(url.pathname.split("/")[4] || "");
    const kind = String(url.searchParams.get("kind") || "");
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    requireUploadSession(session);
    const deletionPlan = buildAcademicContextDeletionPlan(state, { kind, itemId });
    if (!deletionPlan) {
      sendJson(res, 404, { error: "Academic context item not found.", secretsPrinted: false });
      return;
    }

    const cleanupPlans = deletionPlan.sourceIds
      .map((sourceId) => buildSourceCleanupPlan(state, sourceId))
      .filter(Boolean);
    const deletedAssignmentIds = new Set();
    for (const cleanupPlan of cleanupPlans) {
      (cleanupPlan.assignmentIds || []).forEach((id) => deletedAssignmentIds.add(id));
      await repository.hardDeleteSourceArtifacts(session, cleanupPlan);
    }
    const assignmentIdsWithoutSource = (deletionPlan.assignmentIds || []).filter((id) => !deletedAssignmentIds.has(id));
    if (assignmentIdsWithoutSource.length) {
      await repository.hardDeleteSourceArtifacts(session, { assignmentIds: assignmentIdsWithoutSource });
    }
    const recoveryBaseline = recoveryConfig.enabled ? captureRecoveryBaseline(state) : null;
    applyAcademicContextDeletion(state, deletionPlan);
    if (recoveryConfig.enabled) {
      recordAcademicEvent(state, {
        eventType: deletionPlan.assignmentIds?.length ? "assignment_deadline_changed" : "academic_context_updated",
        sourceEntityType: deletionPlan.assignmentIds?.length ? "assignment" : deletionPlan.kind,
        sourceEntityId: deletionPlan.itemId,
        idempotencyKey: `academic_context_deleted:${deletionPlan.kind}:${deletionPlan.itemId}`,
        correlationId: req.requestId,
        payload: { removed: true, courseId: deletionPlan.courseId || null },
      });
      queueAutomaticRecovery(state, { correlationId: req.requestId });
    }
    await persistRecoveryAwareMutation({ repository, session, state, baseline: recoveryBaseline, ordinarySave: () => repository.saveOrdinaryState(session, state), correlationId: req.requestId });
    sendJson(res, 200, {
      deleted: true,
      hardDeleted: true,
      kind: deletionPlan.kind,
      itemId: deletionPlan.itemId,
      classroomUnchanged: true,
      state: publicState(state, persistence),
      message: "This item was permanently deleted from StudentOS.",
      secretsPrinted: false,
    });
    return;
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/api/sources/")) {
    const sourceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    const { session, state } = await getStateContext(req);
    requireDashboardActive(state);
    requireUploadSession(session);
    const cleanupPlan = buildSourceCleanupPlan(state, sourceId);
    if (!cleanupPlan) {
      sendJson(res, 404, { error: "Source material not found" });
      return;
    }
    const hardDelete = url.searchParams.get("mode") === "hard" || url.searchParams.get("hard") === "true";
    const material = cleanupPlan.material;
    if (hardDelete) {
      await repository.hardDeleteSourceArtifacts(session, cleanupPlan);
      hardDeleteSourceState(state, sourceId);
      markAcademicContextNeedsPreparation(state, "material_removed");
      await repository.saveState(session, state);
      sendJson(res, 200, {
        deleted: true,
        hardDeleted: true,
        sourceId,
        storageObjectDeleteRequested: Boolean(cleanupPlan.storagePath),
        cleanup: {
          chunks: cleanupPlan.sourceChunkIds.length,
          memoryItems: cleanupPlan.memoryItemIds.length,
          embeddings: cleanupPlan.embeddingIds.length,
          jobs: cleanupPlan.jobIds.length,
          jobEvents: cleanupPlan.jobEventIds.length,
        },
        secretsPrinted: false,
      });
      return;
    }
    if (material.storagePath && material.storageBucket) {
      await repository.deleteStorageObject(session, {
        bucket: material.storageBucket,
        path: material.storagePath,
      });
    }
    softDeleteSourceState(state, sourceId);
    markAcademicContextNeedsPreparation(state, "material_removed");
    state.auditLog.push({
      id: `audit_delete_${material.id}_${Date.now()}`,
      actorId: state.studentProfile.id,
      action: "source_material.deleted",
      targetType: "source_material",
      targetId: material.id,
      riskLevel: "medium",
      metadata: {
        storageObjectDeleteRequested: Boolean(material.storagePath),
        privateBucket: true,
        hardDeleted: false,
      },
      createdAt: new Date().toISOString(),
    });
    recordJobEvent(state, {
      userId: state.studentProfile.id,
      sourceId: material.id,
      eventType: "cleanup",
      message: "Source soft-deleted and private storage delete requested.",
      metadata: { hardDeleted: false },
    });
    await repository.saveSourceIngestion(session, state);
    sendJson(res, 200, {
      deleted: true,
      sourceId: material.id,
      storageObjectDeleteRequested: Boolean(material.storagePath),
    });
    return;
  }

  notFound(res);
}

async function serveStatic(req, res, url) {
  if (!SERVE_FRONTEND) {
    notFound(res);
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/auth/complete") pathname = "/auth-complete.html";
  if (pathname === "/auth/callback" || pathname === "/auth/callback/") pathname = "/index.html";
  if (pathname === "/operator" || pathname === "/operator.html") {
    if (!operatorRbacConfig.enabled) {
      notFound(res);
      return;
    }
    pathname = "/operator.html";
  }
  const safePath = normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = normalize(join(FRONTEND_ROOT, safePath));
  if (!filePath.startsWith(FRONTEND_ROOT)) {
    notFound(res);
    return;
  }
  try {
    const body = await readFile(filePath);
    const type = MIME_TYPES[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  } catch {
    notFound(res);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const requestId = createRequestId();
  req.requestId = requestId;
  res.requestId = requestId;
  res.corsOrigin = corsOriginForRequest(req);
  const startedAt = Date.now();
  try {
    enforceRateLimit(req, null, "request");
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      logger.info("request.completed", {
        requestId,
        method: req.method,
        path: url.pathname,
        ms: Date.now() - startedAt,
      });
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    if (url.pathname.startsWith("/api/account/exports/") && url.pathname.endsWith("/download")) {
      logger.warn("monitoring.alert", {
        requestId,
        alertType: ALERT_TYPES.EXPORT_DOWNLOAD_ANOMALY,
        severity: "warn",
        path: "/api/account/exports/:id/download",
        status: error.status || 500,
      });
    }
    logger.error("request.failed", {
      requestId,
      method: req.method,
      path: url.pathname,
      status: error.status || 500,
      error: error.message,
      policy: error.policy,
      rateLimit: error.rateLimit,
    });
    if (url.pathname.startsWith("/api/recovery/")) {
      sendJson(res, error.status || 500, {
        ...recoveryErrorEnvelope(error, requestId),
        secretsPrinted: false,
      });
      return;
    }
    if (url.pathname === "/api/ai/verb") {
      const setupRequired = /setup|dashboard|workspace/i.test(String(error.message || ""));
      const rateLimited = (error.status || 0) === 429;
      const answer = setupRequired
        ? "Complete StudentOS setup before using Ask StudentOS."
        : rateLimited
          ? "AI help is busy right now. Please wait a moment and try again."
          : AI_ALLOWANCE_COPY.unavailable;
      sendJson(res, error.status || 500, {
        error: answer,
        answer,
        retryable: !setupRequired,
        grounding: { uploadedMaterialUsed: false, insufficientContext: false, insufficiencyReason: null, snippets: [] },
        requestId,
      });
      return;
    }
    sendJson(res, error.status || 500, {
      error: publicErrorMessage(error, "StudentOS server error"),
      requestId,
      policy: error.policy ? publicErrorMessage({ message: error.policy }, "StudentOS policy check failed") : undefined,
      rateLimit: error.rateLimit ? publicErrorMessage({ message: error.rateLimit }, "Too many attempts. Please wait a minute and try again.") : undefined,
    });
  }
});

server.listen(PORT, () => {
  logger.info("server.started", {
    product: "StudentOS by SentIQ AI Labs",
    pass: STUDENTOS_APP_PASS,
    port: PORT,
    mode: supabaseConfig.mode,
    deployment: saasConfig.deployment,
    deploymentTarget: DEPLOYMENT_TARGET,
  });
});
