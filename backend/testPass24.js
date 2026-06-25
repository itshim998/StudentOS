import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSeedState } from "./domain/studentosDomain.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { buildDataExportPackage } from "./account/exportService.js";
import {
  GOOGLE_CLASSROOM_READONLY_SCOPES,
  assertNoGoogleClassroomWriteScopes,
  getGoogleClassroomConfig,
  getSafeGoogleClassroomStatus,
} from "./connectors/googleClassroom/config.js";
import {
  decryptClassroomTokenValue,
  encryptClassroomTokenValue,
  getPersistentClassroomToken,
  safeClassroomTokenMetadata,
  savePersistentClassroomToken,
} from "./connectors/googleClassroom/tokenStore.js";
import {
  getClassroomConnectorStatus,
  syncGoogleClassroomIntoState,
} from "./connectors/googleClassroom/syncService.js";
import { redactSecrets } from "./observability/logger.js";

const now = new Date("2026-06-05T08:00:00.000Z");
const config = getGoogleClassroomConfig({
  STUDENTOS_GOOGLE_CLASSROOM_MODE: "oauth",
  GOOGLE_CLIENT_ID: "1234567890-studentos.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "https://studentos.example/api/classroom/oauth/callback",
  STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET: "state-secret",
  STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET: "token-encryption-secret",
});
const repository = new StudentOsRepository({ config: { mode: "mock" }, shardClients: [] });
const state = createSeedState(now);
const session = {
  authenticated: true,
  user: { id: state.studentProfile.id, email: "student@example.com" },
};

assert.equal(assertNoGoogleClassroomWriteScopes(GOOGLE_CLASSROOM_READONLY_SCOPES), true);
assert.equal(GOOGLE_CLASSROOM_READONLY_SCOPES.includes("https://www.googleapis.com/auth/classroom.course-work.readonly"), true);
assert.equal(GOOGLE_CLASSROOM_READONLY_SCOPES.includes("https://www.googleapis.com/auth/classroom.coursework.me.readonly"), false);
assert.equal(getSafeGoogleClassroomStatus(config).tokenPersistence, "encrypted_shard_storage");

const encrypted = encryptClassroomTokenValue("raw-access-token", config);
assert.notEqual(encrypted, "raw-access-token");
assert.equal(encrypted.includes("raw-access-token"), false);
assert.equal(decryptClassroomTokenValue(encrypted, config), "raw-access-token");

const metadata = await savePersistentClassroomToken({
  session,
  repository,
  token: {
    access_token: "raw-access-token",
    refresh_token: "raw-refresh-token",
    scope: GOOGLE_CLASSROOM_READONLY_SCOPES.join(" "),
    expires_in: 1,
  },
  config,
  now,
  providerAccountEmail: "student@classroom.example",
});
assert.equal(metadata.encryptedAtRest, true);
assert.equal(metadata.providerAccountEmail, "student@classroom.example");
const storedRow = await repository.getClassroomToken(session);
const storedJson = JSON.stringify(storedRow);
assert.equal(storedJson.includes("raw-access-token"), false);
assert.equal(storedJson.includes("raw-refresh-token"), false);
const loadedToken = await getPersistentClassroomToken({ session, repository, config, now });
assert.equal(loadedToken.accessToken, "raw-access-token");
assert.equal(loadedToken.refreshToken, "raw-refresh-token");
assert.equal(JSON.stringify(safeClassroomTokenMetadata(loadedToken)).includes("raw-access-token"), false);

const calls = [];
const fetchImpl = async (url, options = {}) => {
  const href = String(url);
  calls.push({ url: href, method: options.method || "GET" });
  if (href.includes("oauth2.googleapis.com/token")) {
    assert.equal(String(options.body).includes("raw-refresh-token"), true);
    return {
      ok: true,
      async json() {
        return {
          access_token: "refreshed-access-token",
          expires_in: 3600,
          scope: GOOGLE_CLASSROOM_READONLY_SCOPES.join(" "),
        };
      },
    };
  }
  if (href.includes("/courses/course_1/courseWork/work_1/studentSubmissions")) {
    return {
      ok: true,
      async json() {
        return {
          studentSubmissions: [{
            id: "submission_1",
            state: "NEW",
            updateTime: "2026-06-05T08:05:00Z",
          }],
        };
      },
    };
  }
  if (href.includes("/courses/course_1/courseWork")) {
    return {
      ok: true,
      async json() {
        return {
          courseWork: [{
            id: "work_1",
            title: "Read-only Classroom worksheet",
            description: "Imported only as metadata.",
            state: "PUBLISHED",
            alternateLink: "https://classroom.google.com/work_1",
            updateTime: "2026-06-05T08:04:00Z",
            dueDate: { year: 2026, month: 6, day: 7 },
            maxPoints: 20,
            workType: "ASSIGNMENT",
          }],
        };
      },
    };
  }
  if (href.includes("/courses")) {
    return {
      ok: true,
      async json() {
        return {
          courses: [{
            id: "course_1",
            name: "Read-only Algebra",
            section: "Grade 10",
            alternateLink: "https://classroom.google.com/course_1",
            courseState: "ACTIVE",
          }],
        };
      },
    };
  }
  throw new Error(`unexpected fetch ${href}`);
};

const syncResult = await syncGoogleClassroomIntoState({
  state,
  session,
  repository,
  config,
  fetchImpl,
  now: new Date(now.getTime() + 2000),
});
assert.equal(syncResult.summary.importedCourses, 1);
assert.equal(syncResult.summary.importedAssignments, 1);
assert.equal(state.assignments.filter((item) => item.providerCourseWorkId === "work_1").length, 1);
assert(calls.some((call) => call.url.includes("oauth2.googleapis.com/token") && call.method === "POST"));
const refreshedToken = await getPersistentClassroomToken({ session, repository, config, now: new Date(now.getTime() + 3000) });
assert.equal(refreshedToken.accessToken, "refreshed-access-token");
assert(refreshedToken.lastRefreshAt);
const history = await repository.listClassroomSyncRuns(session, { limit: 5 });
assert.equal(history.length, 1);
assert.equal(history[0].status, "completed");
assert.equal(history[0].writebackEnabled, false);

const secondSync = await syncGoogleClassroomIntoState({
  state,
  session,
  repository,
  config,
  fetchImpl,
  now: new Date(now.getTime() + 5000),
});
assert.equal(secondSync.summary.importedAssignments, 0);
assert.equal(secondSync.summary.updatedAssignments, 1);
assert.equal(state.assignments.filter((item) => item.providerCourseWorkId === "work_1").length, 1);

await savePersistentClassroomToken({
  session,
  repository,
  token: {
    access_token: "soon-expired-token",
    refresh_token: "failing-refresh-token",
    scope: GOOGLE_CLASSROOM_READONLY_SCOPES.join(" "),
    expires_in: 1,
  },
  config,
  now,
  providerAccountEmail: "student@classroom.example",
});
await assert.rejects(() => syncGoogleClassroomIntoState({
  state,
  session,
  repository,
  config,
  fetchImpl: async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return { ok: false, async json() { return { error: "invalid_grant" }; } };
    }
    return fetchImpl(url);
  },
  now: new Date(now.getTime() + 3000),
}), /Reconnect Classroom/);
const expiredStatus = await getClassroomConnectorStatus({
  state,
  session,
  repository,
  config,
  now: new Date(now.getTime() + 3000),
});
assert.equal(expiredStatus.state, "reconnect_required");
assert.equal(expiredStatus.writeScopesEnabled, false);
assert(expiredStatus.syncHistory.length >= 1);

const exportPackage = buildDataExportPackage(state, { id: "export_1" }, now);
const exportJson = JSON.stringify(exportPackage);
assert.equal(exportJson.includes("raw-access-token"), false);
assert.equal(exportJson.includes("raw-refresh-token"), false);
assert.equal(exportJson.includes("failing-refresh-token"), false);
assert.equal(exportJson.includes("encryptedAccessToken"), false);

const safeLog = JSON.stringify(redactSecrets({
  STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET: "token-encryption-secret",
  access_token: "raw-access-token",
  refresh_token: "raw-refresh-token",
}));
assert.equal(safeLog.includes("token-encryption-secret"), false);
assert.equal(safeLog.includes("raw-access-token"), false);
assert.equal(safeLog.includes("raw-refresh-token"), false);

const server = await readFile(new URL("../backend/server.js", import.meta.url), "utf8");
const frontend = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/202605250020_studentos_pass24_classroom_tokens_sync_history.sql", import.meta.url), "utf8");
for (const file of [server, frontend, migration]) {
  assert.equal(file.includes("classroom.coursework.students"), false);
  assert.equal(file.includes("classroom.coursework.me"), false);
  assert.equal(file.includes("turnIn"), false);
  assert.equal(file.includes("modifyAttachments"), false);
}
assert(frontend.includes("You stay in control of submissions"));
assert(migration.includes("classroom_tokens"));
assert(migration.includes("revoke all on public.classroom_tokens from authenticated"));

console.log("PASS | StudentOS Pass 24 Google Classroom encrypted token and sync history tests passed");
