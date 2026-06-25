import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSeedState, getAssignmentInsights, handleAssignmentLearningFlow } from "./domain/studentosDomain.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import {
  GOOGLE_CLASSROOM_READONLY_SCOPES,
  getGoogleClassroomConfig,
} from "./connectors/googleClassroom/config.js";
import { classifyClassroomError } from "./connectors/googleClassroom/apiClient.js";
import {
  getClassroomConnectorStatus,
  syncGoogleClassroomIntoState,
} from "./connectors/googleClassroom/syncService.js";
import {
  getPersistentClassroomToken,
  savePersistentClassroomToken,
} from "./connectors/googleClassroom/tokenStore.js";

const now = new Date("2026-06-08T04:00:00.000Z");
const config = getGoogleClassroomConfig({
  STUDENTOS_GOOGLE_CLASSROOM_MODE: "oauth",
  GOOGLE_CLIENT_ID: "1234567890-studentos.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:3101/api/classroom/oauth/callback",
  STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET: "state-secret",
  STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET: "token-secret",
});

function sessionFor(state) {
  return {
    authenticated: true,
    user: { id: state.studentProfile.id, email: "student@example.com" },
  };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

async function seedToken({ session, repository, accessToken = "access-token", refreshToken = "refresh-token", expiresIn = 3600 } = {}) {
  return savePersistentClassroomToken({
    session,
    repository,
    token: {
      access_token: accessToken,
      refresh_token: refreshToken,
      scope: GOOGLE_CLASSROOM_READONLY_SCOPES.join(" "),
      expires_in: expiresIn,
    },
    config,
    now,
    providerAccountEmail: "student@classroom.example",
  });
}

function classroomFetchForSnapshot({
  courses = [{
    id: "course_live_1",
    name: "Live Algebra",
    section: "Grade 10",
    alternateLink: "https://classroom.google.com/c/live-algebra",
    courseState: "ACTIVE",
  }],
  courseWork = [{
    id: "work_quad_1",
    title: "Quadratics worksheet",
    description: "Solve factoring and graphing questions.",
    state: "PUBLISHED",
    alternateLink: "https://classroom.google.com/c/live-algebra/a/work_quad_1",
    updateTime: "2026-06-08T04:05:00Z",
    dueDate: { year: 2026, month: 6, day: 10 },
    maxPoints: 20,
    workType: "ASSIGNMENT",
    materials: [{
      link: {
        url: "https://classroom.google.com/materials/quad",
        title: "Quadratics source note",
      },
    }],
  }],
  submissions = [{
    id: "sub_quad_1",
    state: "NEW",
    updateTime: "2026-06-08T04:06:00Z",
  }],
} = {}) {
  return async (url) => {
    const href = String(url);
    if (href.includes("/studentSubmissions")) {
      return jsonResponse({ studentSubmissions: submissions });
    }
    if (href.includes("/courseWork")) {
      return jsonResponse({ courseWork });
    }
    if (href.includes("/courses")) {
      return jsonResponse({ courses });
    }
    throw new Error(`unexpected classroom fetch ${href}`);
  };
}

const state = createSeedState(now);
const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const session = sessionFor(state);
await seedToken({ session, repository });

const persisted = await getPersistentClassroomToken({
  session,
  repository,
  config,
  now: new Date(now.getTime() + 1000),
});
assert.equal(persisted.accessToken, "access-token");
assert.equal(persisted.providerAccountEmail, "student@classroom.example");

const syncResult = await syncGoogleClassroomIntoState({
  state,
  session,
  repository,
  config,
  fetchImpl: classroomFetchForSnapshot(),
  now,
});
assert.equal(syncResult.summary.importedCourses, 1);
assert.equal(syncResult.summary.importedAssignments, 1);
assert.equal(syncResult.summary.importedTopics, 1);
assert.equal(syncResult.summary.importedMaterials, 1);
const importedAssignment = state.assignments.find((assignment) => assignment.providerCourseWorkId === "work_quad_1");
assert(importedAssignment);
assert.equal(importedAssignment.source, "google_classroom");
assert.equal(importedAssignment.readOnly, true);
assert.equal(importedAssignment.learningFlowReady, true);
assert.equal(importedAssignment.topicIds.length, 1);
let insights = getAssignmentInsights(state);
let importedInsight = insights.find((insight) => insight.assignmentId === importedAssignment.id);
assert.equal(importedInsight.status, "uncovered");
const flow = handleAssignmentLearningFlow(state, importedAssignment.id);
assert.equal(flow.action, "mastery_roadmap_before_test");
assert.equal(flow.realSubmissionAllowed, false);

const secondSync = await syncGoogleClassroomIntoState({
  state,
  session,
  repository,
  config,
  fetchImpl: classroomFetchForSnapshot(),
  now: new Date(now.getTime() + 1000),
});
assert.equal(secondSync.summary.importedCourses, 0);
assert.equal(secondSync.summary.updatedCourses, 1);
assert.equal(secondSync.summary.importedAssignments, 0);
assert.equal(secondSync.summary.updatedAssignments, 1);
assert.equal(state.assignments.filter((assignment) => assignment.providerCourseWorkId === "work_quad_1").length, 1);
assert.equal(state.topics.filter((topic) => topic.providerCourseWorkId === "work_quad_1").length, 1);
let history = await repository.listClassroomSyncRuns(session, { limit: 5 });
assert(history.some((run) => run.status === "completed" && run.importedAssignments === 1));
assert(history.some((run) => run.status === "completed" && run.updatedAssignments === 1));

const emptyState = createSeedState(now);
const emptyRepository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const emptySession = sessionFor(emptyState);
await seedToken({ session: emptySession, repository: emptyRepository });
const emptySync = await syncGoogleClassroomIntoState({
  state: emptyState,
  session: emptySession,
  repository: emptyRepository,
  config,
  fetchImpl: classroomFetchForSnapshot({ courses: [], courseWork: [], submissions: [] }),
  now,
});
assert.equal(emptySync.summary.emptyClassroom, true);
assert.equal(emptySync.summary.importedAssignments, 0);

const expiredState = createSeedState(now);
const expiredRepository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const expiredSession = sessionFor(expiredState);
await seedToken({
  session: expiredSession,
  repository: expiredRepository,
  accessToken: "expired-access",
  refreshToken: "refresh-ok",
  expiresIn: 1,
});
const refreshSync = await syncGoogleClassroomIntoState({
  state: expiredState,
  session: expiredSession,
  repository: expiredRepository,
  config,
  fetchImpl: async (url) => {
    const href = String(url);
    if (href.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({
        access_token: "refreshed-access",
        expires_in: 3600,
        scope: GOOGLE_CLASSROOM_READONLY_SCOPES.join(" "),
      });
    }
    return classroomFetchForSnapshot({ courses: [], courseWork: [], submissions: [] })(url);
  },
  now: new Date(now.getTime() + 2000),
});
assert.equal(refreshSync.summary.emptyClassroom, true);
const refreshed = await getPersistentClassroomToken({
  session: expiredSession,
  repository: expiredRepository,
  config,
  now: new Date(now.getTime() + 3000),
});
assert.equal(refreshed.accessToken, "refreshed-access");

const insufficientState = createSeedState(now);
const insufficientRepository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const insufficientSession = sessionFor(insufficientState);
await seedToken({ session: insufficientSession, repository: insufficientRepository });
await assert.rejects(() => syncGoogleClassroomIntoState({
  state: insufficientState,
  session: insufficientSession,
  repository: insufficientRepository,
  config,
  fetchImpl: async (url) => {
    if (String(url).includes("/courses")) {
      return jsonResponse({
        error: {
          status: "PERMISSION_DENIED",
          message: "Request had insufficient authentication scopes.",
          errors: [{ reason: "insufficientPermissions" }],
        },
      }, { ok: false, status: 403 });
    }
    throw new Error("unexpected fetch after insufficient scope");
  },
  now,
}), /Reconnect Classroom/);
const insufficientStatus = await getClassroomConnectorStatus({
  state: insufficientState,
  session: insufficientSession,
  repository: insufficientRepository,
  config,
  now,
});
assert.equal(insufficientStatus.state, "reconnect_required");
assert.equal(insufficientStatus.lastErrorCode, "google_classroom_insufficient_scope");
history = await insufficientRepository.listClassroomSyncRuns(insufficientSession, { limit: 3 });
assert.equal(history[0].status, "failed");
assert.equal(history[0].payload.errorCode, "google_classroom_insufficient_scope");

const classifiedQuota = classifyClassroomError(429, { error: { message: "Quota exceeded" } });
assert.equal(classifiedQuota.code, "google_classroom_rate_limited");
const classifiedRevoked = classifyClassroomError(401, { error: { message: "Invalid Credentials" } });
assert.equal(classifiedRevoked.connectorState, "reconnect_required");

const connectorFiles = [
  await readFile(new URL("./connectors/googleClassroom/apiClient.js", import.meta.url), "utf8"),
  await readFile(new URL("./connectors/googleClassroom/syncService.js", import.meta.url), "utf8"),
  await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8"),
];
for (const file of connectorFiles) {
  assert.equal(file.includes("turnIn"), false);
  assert.equal(file.includes("modifyAttachments"), false);
  assert.equal(file.includes("reclaimSubmission"), false);
}

console.log("PASS | StudentOS Pass 25 Classroom sync reliability tests passed");
