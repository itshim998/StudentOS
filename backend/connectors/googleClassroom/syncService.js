import { GoogleClassroomApiClient } from "./apiClient.js";
import {
  assertNoGoogleClassroomWriteScopes,
  getGoogleClassroomConfig,
  getSafeGoogleClassroomStatus,
} from "./config.js";
import { refreshClassroomOAuthToken } from "./oauth.js";
import { importClassroomSnapshotIntoState } from "./mapper.js";
import { MockGoogleClassroomReadOnlyConnector } from "./mockConnector.js";
import {
  deletePersistentClassroomToken,
  getPersistentClassroomToken,
  markPersistentClassroomTokenStatus,
  safeClassroomTokenMetadata,
  savePersistentClassroomToken,
} from "./tokenStore.js";

function nowIso(now = new Date()) {
  return now.toISOString();
}

function profileConnectorPrefs(state) {
  state.studentProfile.preferences = state.studentProfile.preferences || {};
  state.studentProfile.preferences.googleClassroom = state.studentProfile.preferences.googleClassroom || {};
  return state.studentProfile.preferences.googleClassroom;
}

function syncRunId(userId, now = new Date()) {
  return `classroom_sync_${String(userId || "user").replace(/[^A-Za-z0-9._-]/g, "_")}_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeErrorSummary(error) {
  return String(error?.message || error || "classroom_sync_failed")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/access[_-]?token[:=]\s*[A-Za-z0-9._-]+/gi, "access_token=[redacted]")
    .replace(/refresh[_-]?token[:=]\s*[A-Za-z0-9._-]+/gi, "refresh_token=[redacted]")
    .slice(0, 220);
}

function safeErrorCode(error) {
  return String(error?.code || error?.connectorState || "google_classroom_sync_failed")
    .replace(/[^a-z0-9_.-]+/gi, "_")
    .slice(0, 80);
}

function syncRunFromSummary({ session, config, summary = {}, status = "completed", startedAt, completedAt, error = null, providerAccountEmail = "" } = {}) {
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  return {
    id: syncRunId(session.user.id, new Date(startedAt || Date.now())),
    userId: session.user.id,
    provider: config.mode === "mock" ? "google_classroom_mock" : "google_classroom",
    status,
    startedAt,
    completedAt,
    importedCourses: summary.importedCourses || 0,
    updatedCourses: summary.updatedCourses || 0,
    importedAssignments: summary.importedAssignments || 0,
    updatedAssignments: summary.updatedAssignments || 0,
    importedMaterials: summary.importedMaterials || 0,
    updatedMaterials: summary.updatedMaterials || 0,
    skippedItems: summary.skippedItems || 0,
    errorCount: error ? 1 : errors.length,
    errorSummary: error ? safeErrorSummary(error) : errors.map(safeErrorSummary).join("; ").slice(0, 220) || null,
    readOnly: true,
    writebackEnabled: false,
    providerAccountEmail: providerAccountEmail || null,
    payload: {
      readOnlyScopes: config.scopes,
      writebackEnabled: false,
      secretsExposed: false,
      emptyClassroom: summary.emptyClassroom === true,
      importedTopics: summary.importedTopics || 0,
      updatedTopics: summary.updatedTopics || 0,
      errorCode: error ? safeErrorCode(error) : errors.length ? "google_classroom_partial_sync" : null,
      connectorState: error?.connectorState || null,
    },
  };
}

async function listRecentSyncRuns({ repository, session, limit = 5 } = {}) {
  if (!repository?.listClassroomSyncRuns) return [];
  return repository.listClassroomSyncRuns(session, { limit }).catch(() => []);
}

function classroomActionsForState(stateName) {
  return {
    connect: stateName === "disconnected",
    reconnect: stateName === "reconnect_required",
    sync: stateName === "connected",
    disconnect: stateName === "connected",
  };
}

function classroomUiForState(stateName, { mode = "", lastSyncAt = "", summary = null } = {}) {
  if (stateName === "connected") {
    return {
      title: mode === "mock" ? "Demo Classroom ready" : "Classroom connected",
      message: mode === "mock"
        ? "Demo assignments can be synced into your study plan."
        : "StudentOS can refresh coursework for your study plan. You stay in control of submissions.",
      badge: "planning import active",
      detail: lastSyncAt
        ? "Classroom assignments have been refreshed."
        : summary
          ? "Classroom coursework has been added to your study plan."
          : "Ready to refresh assignments.",
    };
  }
  if (stateName === "disconnected") {
    return {
      title: "Classroom can be connected",
      message: "Connect when you want StudentOS to include Classroom coursework in your study plan.",
      badge: "optional setup",
      detail: "No Classroom connection is active.",
    };
  }
  if (stateName === "reconnect_required") {
    return {
      title: "Reconnect Classroom",
      message: "Reconnect Classroom to refresh imported assignments.",
      badge: "reconnect needed",
      detail: "Existing StudentOS work was not changed.",
    };
  }
  if (stateName === "setup_required") {
    return {
      title: "Classroom setup is not active",
      message: "Your workspace is ready. Classroom importing can be turned on later.",
      badge: "workspace ready",
      detail: "Classroom actions are hidden until setup is complete.",
    };
  }
  if (stateName === "disabled") {
    return {
      title: "Classroom setup is not active",
      message: "Your workspace is ready. Classroom importing can be turned on later.",
      badge: "workspace ready",
      detail: "Classroom actions are hidden for this workspace.",
    };
  }
  return {
    title: "Classroom status pending",
    message: "Your workspace is ready. Classroom status will update when setup is available.",
    badge: "workspace ready",
    detail: "Classroom actions are hidden until status is ready.",
  };
}

function normalizeClassroomState({ config, safeStatus, token, prefs = {} } = {}) {
  if (config.mode === "disabled") return "disabled";
  if (config.mode === "mock") return "connected";
  if (config.mode === "oauth" && !safeStatus.oauthConfigured) return "setup_required";
  if (token?.expired || ["expired", "error", "reconnect_required"].includes(token?.status)) {
    return "reconnect_required";
  }
  if (token) return "connected";
  if (["connected", "expired", "error", "reconnect_required"].includes(prefs.state)) {
    return "reconnect_required";
  }
  return "disconnected";
}

export async function getClassroomConnectorStatus({ state, session, userId, repository, config = getGoogleClassroomConfig(), now = new Date() } = {}) {
  assertNoGoogleClassroomWriteScopes(config.scopes);
  const prefs = state ? profileConnectorPrefs(state) : {};
  const resolvedUserId = userId || session?.user?.id;
  const safeStatus = getSafeGoogleClassroomStatus(config);
  const token = config.mode === "oauth"
    ? await getPersistentClassroomToken({
      session: session || { user: { id: resolvedUserId } },
      repository,
      config,
      now,
    }).catch(() => null)
    : null;
  const syncHistory = session ? await listRecentSyncRuns({ repository, session, limit: 5 }) : [];
  const lastRun = syncHistory[0] || null;
  const stateName = normalizeClassroomState({ config, safeStatus, token, prefs });
  const actions = classroomActionsForState(stateName);
  const lastSyncAt = prefs.lastSyncAt || lastRun?.completedAt || null;
  const syncSummary = prefs.lastSyncSummary || null;
  const ui = classroomUiForState(stateName, {
    mode: config.mode,
    lastSyncAt,
    summary: syncSummary,
  });
  const safeLastErrorCode = prefs.lastErrorCode || lastRun?.payload?.errorCode || null;
  return {
    ...safeStatus,
    state: stateName,
    status: stateName,
    enabled: !["disabled", "setup_required", "status_pending"].includes(stateName),
    available: !["disabled", "setup_required", "status_pending"].includes(stateName),
    setupRequired: stateName === "setup_required",
    reconnectRequired: stateName === "reconnect_required",
    connected: stateName === "connected",
    actions,
    ui,
    tokenMetadata: token ? safeClassroomTokenMetadata(token) : prefs.tokenMetadata || null,
    providerAccountEmail: token?.providerAccountEmail || prefs.providerAccountEmail || null,
    lastSyncAt,
    syncSummary,
    syncHistory,
    lastError: stateName === "reconnect_required" ? ui.message : null,
    lastErrorCode: stateName === "reconnect_required" ? safeLastErrorCode : null,
    message: ui.message,
    syncBlockedReason: actions.sync ? null : ui.message,
  };
}

async function resolveOAuthToken({ session, repository, config, fetchImpl = fetch, now = new Date() }) {
  let token = await getPersistentClassroomToken({ session, repository, config, now });
  if (!token) {
    const error = new Error("Connect Classroom before syncing assignments.");
    error.status = 409;
    error.connectorState = "disconnected";
    throw error;
  }
  if (token.expired) {
    try {
      const refreshed = await refreshClassroomOAuthToken({
        refreshToken: token.refreshToken,
        config,
        fetchImpl,
      });
      const metadata = await savePersistentClassroomToken({
        session,
        repository,
        token: {
          ...refreshed,
          refresh_token: token.refreshToken,
          scope: refreshed.scope || token.scopes?.join(" "),
        },
        config,
        now,
        providerAccountEmail: token.providerAccountEmail,
        refreshed: true,
      });
      token = await getPersistentClassroomToken({ session, repository, config, now });
      token.refreshed = true;
      token.refreshMetadata = metadata;
    } catch (error) {
      await markPersistentClassroomTokenStatus({
        session,
        repository,
        status: "expired",
        lastError: "token_refresh_failed",
        now,
      });
      const wrapped = new Error("Reconnect Classroom to refresh imported assignments.");
      wrapped.status = 401;
      wrapped.connectorState = "reconnect_required";
      throw wrapped;
    }
  }
  return token;
}

async function fetchOAuthSnapshot({ session, repository, config, fetchImpl = fetch, now = new Date() }) {
  const token = await resolveOAuthToken({ session, repository, config, fetchImpl, now });
  const client = new GoogleClassroomApiClient({ accessToken: token.accessToken, fetchImpl });
  const courses = await client.listCourses();
  const courseWork = [];
  const submissions = [];
  const errors = [];
  for (const course of courses) {
    const workForCourse = await client.listCourseWork(course.providerCourseId);
    courseWork.push(...workForCourse);
    for (const work of workForCourse) {
      try {
        submissions.push(...await client.listOwnSubmissions(work.providerCourseId, work.providerCourseWorkId));
      } catch (error) {
        if (error.status === 401) throw error;
        errors.push(safeErrorSummary(error));
      }
    }
  }
  return { courses, courseWork, submissions, errors, providerAccountEmail: token.providerAccountEmail || null };
}

export async function syncGoogleClassroomIntoState({
  state,
  session,
  repository,
  config = getGoogleClassroomConfig(),
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  assertNoGoogleClassroomWriteScopes(config.scopes);
  const prefs = profileConnectorPrefs(state);
  if (config.mode === "disabled") {
    const error = new Error("Classroom setup is not active for this workspace.");
    error.status = 409;
    error.code = "google_classroom_disabled";
    error.connectorState = "disabled";
    throw error;
  }
  const safeStatus = getSafeGoogleClassroomStatus(config);
  if (config.mode === "oauth" && !safeStatus.oauthConfigured) {
    const error = new Error("Classroom setup is not active for this workspace.");
    error.status = 409;
    error.code = "google_classroom_setup_required";
    error.connectorState = "setup_required";
    throw error;
  }
  let snapshot;
  let connectorState = "connected";
  const startedAt = nowIso(now);
  if (config.mode === "mock") {
    snapshot = await new MockGoogleClassroomReadOnlyConnector(state).fetchSnapshot();
  } else {
    try {
      snapshot = await fetchOAuthSnapshot({ session, repository, config, fetchImpl, now });
    } catch (error) {
      prefs.state = error.connectorState || "connected";
      prefs.lastError = safeErrorSummary(error);
      prefs.lastErrorCode = safeErrorCode(error);
      prefs.updatedAt = nowIso(now);
      if (["expired", "error", "reconnect_required"].includes(prefs.state) && repository?.markClassroomTokenStatus) {
        await markPersistentClassroomTokenStatus({
          session,
          repository,
          status: prefs.state,
          lastError: prefs.lastErrorCode,
          now,
        }).catch(() => null);
      }
      if (repository?.saveClassroomSyncRun) {
        await repository.saveClassroomSyncRun(session, syncRunFromSummary({
          session,
          config,
          summary: {},
          status: "failed",
          startedAt,
          completedAt: nowIso(new Date()),
          error,
        })).catch(() => null);
      }
      throw error;
    }
  }
  const summary = importClassroomSnapshotIntoState(state, snapshot, { now, retention: config.retention });
  summary.errors.push(...(snapshot.errors || []));
  const completedAt = nowIso(now);
  const syncRun = syncRunFromSummary({
    session,
    config,
    summary,
    status: "completed",
    startedAt,
    completedAt,
    providerAccountEmail: snapshot.providerAccountEmail || prefs.providerAccountEmail || "",
  });
  if (repository?.saveClassroomSyncRun) {
    await repository.saveClassroomSyncRun(session, syncRun).catch(() => null);
  }
  prefs.state = connectorState;
  prefs.lastSyncAt = completedAt;
  prefs.lastSyncSummary = summary;
  prefs.mode = config.mode;
  prefs.readOnly = true;
  prefs.writebackEnabled = false;
  prefs.providerAccountEmail = snapshot.providerAccountEmail || prefs.providerAccountEmail || null;
  prefs.lastError = summary.errors.length ? summary.errors.join("; ").slice(0, 220) : null;
  prefs.lastErrorCode = summary.errors.length ? "google_classroom_partial_sync" : null;
  prefs.updatedAt = nowIso(now);
  return {
    connector: await getClassroomConnectorStatus({
      state,
      session,
      repository,
      userId: session.user.id,
      config,
      now,
    }),
    summary,
    syncRun,
    readOnly: true,
    writebackEnabled: false,
  };
}

export function markClassroomConnected(state, metadata, { mode = "oauth", now = new Date() } = {}) {
  const prefs = profileConnectorPrefs(state);
  Object.assign(prefs, {
    state: "connected",
    mode,
    tokenMetadata: metadata || null,
    providerAccountEmail: metadata?.providerAccountEmail || prefs.providerAccountEmail || null,
    readOnly: true,
    writebackEnabled: false,
    connectedAt: prefs.connectedAt || nowIso(now),
    updatedAt: nowIso(now),
    lastError: null,
  });
  state.auditLog = state.auditLog || [];
  state.auditLog.push({
    id: `audit_classroom_connected_${Date.now()}`,
    actorId: state.studentProfile.id,
    action: "google_classroom.connected",
    targetType: "google_classroom",
    targetId: state.studentProfile.id,
    riskLevel: "low",
    metadata: {
      readOnly: true,
      tokenStorage: metadata?.tokenStorage || "session_memory_only",
      encryptedAtRest: metadata?.encryptedAtRest === true,
      writebackEnabled: false,
    },
    createdAt: nowIso(now),
  });
  return prefs;
}

export async function disconnectGoogleClassroom(state, userId, { session, repository, now = new Date() } = {}) {
  await deletePersistentClassroomToken({
    session: session || { user: { id: userId } },
    repository,
  });
  const prefs = profileConnectorPrefs(state);
  Object.assign(prefs, {
    state: "disconnected",
    tokenMetadata: null,
    providerAccountEmail: null,
    updatedAt: nowIso(now),
    disconnectedAt: nowIso(now),
    readOnly: true,
    writebackEnabled: false,
  });
  state.auditLog = state.auditLog || [];
  state.auditLog.push({
    id: `audit_classroom_disconnected_${Date.now()}`,
    actorId: state.studentProfile.id,
    action: "google_classroom.disconnected",
    targetType: "google_classroom",
    targetId: state.studentProfile.id,
    riskLevel: "low",
    metadata: { writebackEnabled: false },
    createdAt: nowIso(now),
  });
  return prefs;
}
