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
  buildDemoOnboardingPayload,
} from "./domain/onboardingService.js";
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
  getClassroomConnectorStatus,
  markClassroomConnected,
  syncGoogleClassroomIntoState,
} from "./connectors/googleClassroom/syncService.js";
import { savePersistentClassroomToken } from "./connectors/googleClassroom/tokenStore.js";
import { runStudentOsVerb } from "./ai/studentBrainAdapter.js";
import { getSafeAiProviderStatus, getAiProviderConfig } from "./ai/providerConfig.js";
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
  validateSourceUpload,
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
  getBillingSnapshot,
  normalizeProviderWebhook,
  processBillingWebhook,
} from "./billing/billingService.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = normalize(join(__dirname, ".."));
const FRONTEND_ROOT = join(ROOT, "frontend");
loadDotEnv({ cwd: ROOT });

const supabaseConfig = getSupabaseEnvironment();
const aiProviderConfig = getAiProviderConfig();
const embeddingConfig = getEmbeddingConfig();
const billingProviderConfig = getBillingProviderConfig();
const googleClassroomConfig = getGoogleClassroomConfig();
const saasConfig = getSaasConfig({
  supabaseConfig,
  aiConfig: aiProviderConfig,
  embeddingConfig,
  billingConfig: billingProviderConfig,
});
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-StudentOS-Internal-Token",
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
  return {
    ...state,
    studentProfile: getSafeStudentProfile(state.studentProfile, creditBalance),
    sourceMaterials: (state.sourceMaterials || []).map((source) => {
      const {
        storageBucket,
        storagePath,
        storageMode,
        extractedText,
        extractionProvider,
        ...safeSource
      } = source;
      return {
        ...safeSource,
        isPrivate: Boolean(storageBucket || storagePath),
        extractedSnippet: extractedText ? String(extractedText).slice(0, 180) : "",
      };
    }),
    sourceChunks: (state.sourceChunks || []).map((chunk) => {
      const { text, chunkText, embeddingVector, embeddingProvider, embeddingModel, ...safeChunk } = chunk;
      return safeChunk;
    }),
    embeddingsMetadata: (state.embeddingsMetadata || []).map((embedding) => {
      const { embeddingValues, vectorRef, provider, model, ...safeEmbedding } = embedding;
      return safeEmbedding;
    }),
    backgroundJobs: (state.backgroundJobs || []).map((job) => {
      const { payload, ...safeJob } = job;
      return safeJob;
    }),
    jobEvents: [],
    auditLog: [],
    billingSubscriptions: (state.billingSubscriptions || []).map((subscription) => {
      const { providerCustomerId, providerSubscriptionId, payload, ...safeSubscription } = subscription;
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
    queueHealth: buildQueueHealth(state.backgroundJobs || []),
    persistence: publicRetrievalStatus(persistence),
    saas: getPublicSaasStatus(saasConfig),
    storagePlan: getSourceStoragePlan(supabaseConfig),
    internalMetricsHidden: true,
  };
}

function getPublicAiStatus(config) {
  const realConfigured = Boolean(config?.groq?.configured || config?.pollinations?.configured);
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
    poweredBy,
    provider,
    modelUsed,
    fallback,
    ...safeResult
  } = result;
  return {
    ...safeResult,
    engineLabel: "StudentOS AI",
    fallback: fallback?.used ? { used: true, reason: "limited_context" } : { used: false },
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
    importedCourses: summary.importedCourses || 0,
    updatedCourses: summary.updatedCourses || 0,
    importedAssignments: summary.importedAssignments || 0,
    updatedAssignments: summary.updatedAssignments || 0,
    importedMaterials: summary.importedMaterials || 0,
    updatedMaterials: summary.updatedMaterials || 0,
    importedTopics: summary.importedTopics || 0,
    updatedTopics: summary.updatedTopics || 0,
    skippedItems: summary.skippedItems || 0,
    emptyClassroom: summary.emptyClassroom === true,
  };
}

function publicClassroomSyncRun(run = {}) {
  return {
    status: run.status || "unknown",
    startedAt: run.startedAt || null,
    completedAt: run.completedAt || null,
    importedCourses: run.importedCourses || 0,
    updatedCourses: run.updatedCourses || 0,
    importedAssignments: run.importedAssignments || 0,
    updatedAssignments: run.updatedAssignments || 0,
    importedMaterials: run.importedMaterials || 0,
    updatedMaterials: run.updatedMaterials || 0,
    skippedItems: run.skippedItems || 0,
    errorCount: run.errorCount || 0,
    emptyClassroom: run.payload?.emptyClassroom === true,
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
    ? "demo"
    : ["disabled", "setup_required"].includes(connector.state || connector.status)
      ? "inactive"
      : "classroom_import";
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

function publicErrorMessage(error, fallback = "We couldn’t complete that request. Please try again.") {
  const message = redactSecrets(error?.message || fallback);
  if ((error?.status || 0) === 429 || /429|too many|rate limit/i.test(message)) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (/supabase|groq|pollinations|gemini|openai|gpt|gpt-oss|anthropic|claude|provider|model|pgvector|rpc|postgrest|postgres/i.test(message)) {
    return fallback;
  }
  return message || fallback;
}

function findAssignment(state, id) {
  return state.assignments.find((assignment) => assignment.id === id);
}

function findCourse(state, id) {
  return state.courses.find((course) => course.id === id);
}

function findTopics(state, ids) {
  return state.topics.filter((topic) => ids.includes(topic.id));
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

function createAiPersistencePayload({ session, body, result }) {
  const now = new Date().toISOString();
  const idSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
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
      essentialLearningUngated: true,
      convenienceCreditsEnabled: true,
      realSubmissionEnabled: false,
      learningAdaptivityVisible: false,
      intelligenceLoop: ["ask", "plan", "make", "review", "coverage", "test_credit", "corrections", "tutor_lesson", "roadmap"],
      onboarding: {
        enabled: true,
        demoSeedEnabled: saasConfig.demoSeedEnabled,
      },
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
    const { state, persistence } = await getStateContext(req);
    sendJson(res, 200, publicState(state, persistence));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/onboarding") {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    const onboarding = applyStudentOnboarding(state, body, { demo: false });
    await repository.saveState(session, state);
    sendJson(res, 200, {
      onboarding,
      state: publicState(state, persistence),
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/demo/seed") {
    if (!saasConfig.demoSeedEnabled) {
      sendJson(res, 403, {
        error: "Demo seed is disabled in this environment",
        demoSeedEnabled: false,
        secretsPrinted: false,
      });
      return;
    }
    const { session, state, persistence } = await getStateContext(req);
    const onboarding = applyStudentOnboarding(state, buildDemoOnboardingPayload(), { demo: true });
    await repository.saveState(session, state);
    sendJson(res, 200, {
      onboarding,
      state: publicState(state, persistence),
      demoReady: true,
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
      readOnly: true,
      writebackEnabled: false,
      secretsPrinted: false,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/classroom/oauth/start") {
    const { session, state } = await getStateContext(req);
    const connector = await getClassroomConnectorStatus({
      state,
      session,
      repository,
      userId: session.user.id,
      config: googleClassroomConfig,
    });
    if (!connector.actions.connect && !connector.actions.reconnect) {
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
      sendHtml(res, 400, "<!doctype html><title>StudentOS Classroom</title><p>Missing Google Classroom OAuth code or state.</p>");
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
      await repository.saveState(session, state);
      sendHtml(res, 200, `<!doctype html>
        <title>StudentOS Classroom Connected</title>
        <body>
          <h1>Google Classroom connected</h1>
          <p>Classroom connection is ready. StudentOS will add coursework to your study plan only.</p>
          <script>setTimeout(() => { location.href = "/"; }, 1200);</script>
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

  if (req.method === "POST" && url.pathname === "/api/classroom/sync") {
    const { session, state, persistence } = await getStateContext(req);
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
    });
    await repository.saveState(session, state);
    sendJson(res, 200, {
      ...result,
      connector: publicClassroomConnector(result.connector),
      summary: publicClassroomSummary(result.summary),
      syncRun: publicClassroomSyncRun(result.syncRun),
      state: publicState(state, persistence),
      assignmentInsights: getAssignmentInsights(state),
      todayNextActions: getTodayNextActions(state),
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
    enforceRateLimit(req, session, "ai_call");
    enforceUsage(state, "ai_call");
    const groundingContext = getGroundingContext(state, body.message || "");
    const retrievalOverride = await repository.retrieveGroundedChunks(session, {
      state,
      message: body.message || "",
      topic: groundingContext.topic,
      course: groundingContext.course,
      limit: 5,
    });
    const result = await runStudentOsVerb({
      verb: body.verb || "Ask",
      message: body.message || "",
      state,
      retrievalOverride,
    });
    const { conversation, messages } = createAiPersistencePayload({ session, body, result });
    await repository.saveAiConversation(session, conversation, messages);
    sendJson(res, 200, publicAiResult(result));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/embeddings/reindex") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
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
    const result = applyTestScore(state, body);
    await repository.saveTestResultBundle(session, state);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/assignment-flow") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
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
          : "StudentOS could not analyze this assignment flow. Refresh synced data and try again.",
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
    const assignment = findAssignment(state, body.assignmentId) || state.assignments[0];
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
    const topic = state.topics.find((item) => item.id === body.topicId) || state.topics[0];
    const course = findCourse(state, topic.courseId);
    const sources = state.sourceMaterials.filter((source) => topic.sourceMaterialIds.includes(source.id));
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

  if (req.method === "POST" && url.pathname === "/api/files/mock") {
    const body = await readJsonBody(req);
    const { session, state } = await getStateContext(req);
    const material = {
      id: `src_mock_${Date.now()}`,
      courseId: body.courseId || state.courses[0].id,
      title: body.title || "Demo source material",
      kind: body.kind || "uploaded_file_metadata",
      storageMode: "mock_metadata",
      storageBucket: supabaseConfig.storage.bucket,
      storagePath: null,
      citationLabel: body.citationLabel || body.title || "Demo source material",
      webFallbackAllowed: body.webFallbackAllowed !== false,
      createdAt: new Date().toISOString(),
    };
    state.sourceMaterials.push(material);
    await repository.saveSourceMaterial(session, state);
    const { storageBucket, storagePath, storageMode, ...safeMaterial } = material;
    sendJson(res, 200, {
      material: {
        ...safeMaterial,
        storageMode: "local_preview",
        isPrivate: true,
      },
      storagePrepared: true,
      bytesStored: false,
      plan: getSourceStoragePlan(supabaseConfig),
      note: "StudentOS saved private source details for this preview. File bytes remain disabled.",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/sources/status") {
    const { state } = await getStateContext(req);
    const safeSnapshot = publicState(state, { mode: supabaseConfig.mode });
    const safeSources = safeSnapshot.sourceMaterials;
    sendJson(res, 200, {
      sources: safeSources,
      chunks: (state.sourceChunks || []).map((chunk) => ({
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
      const { session, state } = await runUploadStage(req, uploadStage, () => getStateContext(req), {
        timeoutMs: 10000,
      });
      requireUploadSession(session);
      enforceRateLimit(req, session, "upload");

      uploadStage = "multipart_parse";
      const form = await runUploadStage(req, uploadStage, () => readMultipartForm(req, { maxBytes: MAX_SOURCE_UPLOAD_BYTES + 512 * 1024 }), {
        timeoutMs: SOURCE_UPLOAD_PARSE_TIMEOUT_MS,
        onTimeout: () => req.destroy?.(createStageTimeoutError("multipart_parse", SOURCE_UPLOAD_PARSE_TIMEOUT_MS)),
      });
      const file = form.files.file;
      if (!file) {
        sendJson(res, 400, { error: "Missing file field", uploadError: true, uploadStage, secretsPrinted: false });
        return;
      }
      const course = findCourse(state, form.fields.courseId) || state.courses[0];
      const validation = validateSourceUpload({
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.bytes.length,
      });
      if (!validation.ok) {
        sendJson(res, 400, {
          error: "Invalid source upload",
          uploadError: true,
          uploadStage: "validation",
          validation: {
            errors: validation.errors,
            maxBytes: validation.maxBytes,
          },
          secretsPrinted: false,
        });
        return;
      }
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
        courseId: course.id,
        title: form.fields.title || validation.filename,
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
      });
      if (repository.useSupabase(session)) {
        uploadStage = "storage_upload";
        await runUploadStage(req, uploadStage, () => repository.uploadStorageObject(session, {
          bucket: material.storageBucket,
          path: material.storagePath,
          bytes: file.bytes,
          mimeType: material.mimeType,
        }), {
          timeoutMs: SOURCE_UPLOAD_STAGE_TIMEOUT_MS,
        });
      }

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
      const memoryItem = material.status === "indexed"
        ? createMemoryItemForSource({ material, course })
        : null;
      state.sourceMaterials.push(material);
      state.sourceChunks.push(...sourceChunks);
      if (memoryItem) state.memoryItems.push(memoryItem);
      state.embeddingsMetadata.push(...embeddingRows);
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

      uploadStage = "source_persist";
      await runUploadStage(req, uploadStage, () => repository.saveSourceIngestion(session, state), {
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
          status: material.status,
          chunkCount: material.chunkCount,
          extractionSummary: material.extractionSummary,
          extractionError: material.extractionError,
          extractionPages: material.extractionPages,
          ocrRequired: material.ocrRequired === true,
          citationLabel: material.citationLabel,
          isPrivate: true,
          publicUrlAllowed: false,
        },
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
  if (req.method === "DELETE" && url.pathname.startsWith("/api/sources/")) {
    const sourceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    const { session, state } = await getStateContext(req);
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
