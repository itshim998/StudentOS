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

export async function getClassroomConnectorStatus({ state, session, userId, repository, config = getGoogleClassroomConfig(), now = new Date() } = {}) {
  assertNoGoogleClassroomWriteScopes(config.scopes);
  const prefs = state ? profileConnectorPrefs(state) : {};
  const resolvedUserId = userId || session?.user?.id;
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
  if (config.mode === "disabled") {
    return {
      ...getSafeGoogleClassroomStatus(config),
      state: "disconnected",
      connected: false,
      syncHistory,
      message: "Google Classroom import is disabled.",
    };
  }
  if (config.mode === "mock") {
    return {
      ...getSafeGoogleClassroomStatus(config),
      state: "connected",
      connected: true,
      lastSyncAt: prefs.lastSyncAt || null,
      syncSummary: prefs.lastSyncSummary || null,
      syncHistory,
      message: "Mock read-only Classroom import is available.",
    };
  }
  const stateName = token?.status === "error"
    ? "error"
    : token?.expired
      ? "expired"
      : token
        ? "connected"
        : prefs.state || "disconnected";
  return {
    ...getSafeGoogleClassroomStatus(config),
    state: stateName,
    connected: stateName === "connected",
    tokenMetadata: token ? safeClassroomTokenMetadata(token) : prefs.tokenMetadata || null,
    providerAccountEmail: token?.providerAccountEmail || prefs.providerAccountEmail || null,
    lastSyncAt: prefs.lastSyncAt || lastRun?.completedAt || null,
    syncSummary: prefs.lastSyncSummary || null,
    syncHistory,
    lastError: prefs.lastError || lastRun?.errorSummary || null,
    lastErrorCode: prefs.lastErrorCode || lastRun?.payload?.errorCode || null,
    message: token
      ? stateName === "expired"
        ? "Google Classroom needs reconnect or token refresh."
        : stateName === "error"
          ? "Google Classroom sync needs attention. Review the latest safe error and reconnect if needed."
        : "Google Classroom OAuth is connected with encrypted backend token storage when configured."
      : "Connect Google Classroom to import read-only coursework.",
  };
}

async function resolveOAuthToken({ session, repository, config, fetchImpl = fetch, now = new Date() }) {
  let token = await getPersistentClassroomToken({ session, repository, config, now });
  if (!token) {
    const error = new Error("Google Classroom is disconnected");
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
      const wrapped = new Error("Google Classroom token expired. Reconnect required.");
      wrapped.status = 401;
      wrapped.connectorState = "expired";
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
    const error = new Error("Google Classroom import is disabled");
    error.status = 404;
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
      prefs.state = error.connectorState || "error";
      prefs.lastError = safeErrorSummary(error);
      prefs.lastErrorCode = safeErrorCode(error);
      prefs.updatedAt = nowIso(now);
      if (["expired", "error"].includes(prefs.state) && repository?.markClassroomTokenStatus) {
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
  const summary = importClassroomSnapshotIntoState(state, snapshot, { now });
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
