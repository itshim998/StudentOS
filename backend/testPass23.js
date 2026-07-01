import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleAssignmentLearningFlow } from "./domain/studentosDomain.js";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import {
  GOOGLE_CLASSROOM_READONLY_SCOPES,
  assertNoGoogleClassroomWriteScopes,
  getGoogleClassroomConfig,
  getMaskedGoogleClientIdStatus,
  getSafeGoogleClassroomStatus,
  validateGoogleClassroomOAuthConfig,
} from "./connectors/googleClassroom/config.js";
import {
  buildClassroomOAuthUrl,
  createClassroomOAuthState,
  verifyClassroomOAuthState,
} from "./connectors/googleClassroom/oauth.js";
import { importClassroomSnapshotIntoState, selectClassroomItemsForAcademicContext } from "./connectors/googleClassroom/mapper.js";
import { syncGoogleClassroomIntoState, getClassroomConnectorStatus } from "./connectors/googleClassroom/syncService.js";
import { saveClassroomToken, getClassroomToken, safeClassroomTokenMetadata } from "./connectors/googleClassroom/tokenStore.js";
import { redactSecrets } from "./observability/logger.js";

const now = new Date("2026-06-04T00:00:00.000Z");
const state = createSeedState(now);
const session = {
  authenticated: true,
  user: { id: state.studentProfile.id, email: "student@example.com" },
};

assert.equal(assertNoGoogleClassroomWriteScopes(GOOGLE_CLASSROOM_READONLY_SCOPES), true);
assert.deepEqual(GOOGLE_CLASSROOM_READONLY_SCOPES, [
  "openid",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
  "https://www.googleapis.com/auth/classroom.course-work.readonly",
  "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
]);
assert.throws(() => assertNoGoogleClassroomWriteScopes([
  ...GOOGLE_CLASSROOM_READONLY_SCOPES,
  "https://www.googleapis.com/auth/classroom.coursework.students",
]), /write scopes/);

const config = getGoogleClassroomConfig({
  STUDENTOS_GOOGLE_CLASSROOM_MODE: "oauth",
  GOOGLE_CLIENT_ID: "1234567890-studentos.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "https://studentos.example/api/classroom/oauth/callback",
  STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET: "state-secret",
});
assert.equal(getSafeGoogleClassroomStatus(config).writeScopesEnabled, false);
assert.equal(getMaskedGoogleClientIdStatus(config.clientId).endsWithAppsGoogleusercontentCom, true);
assert.equal(validateGoogleClassroomOAuthConfig(config), true);
assert.throws(() => validateGoogleClassroomOAuthConfig(getGoogleClassroomConfig({
  STUDENTOS_GOOGLE_CLASSROOM_MODE: "oauth",
  GOOGLE_CLIENT_ID: "https://1234567890-studentos.apps.googleusercontent.com/",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "https://studentos.example/api/classroom/oauth/callback",
  STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET: "state-secret",
})), /GOOGLE_CLIENT_ID/);
const stateToken = createClassroomOAuthState({ userId: session.user.id, config, now });
assert.equal(verifyClassroomOAuthState(stateToken, { config, now }).sub, session.user.id);
const authorizationUrl = buildClassroomOAuthUrl({ config, state: stateToken });
assert(authorizationUrl.includes("classroom.courses.readonly"));
assert(authorizationUrl.includes("classroom.course-work.readonly"));
assert(authorizationUrl.includes("classroom.courseworkmaterials.readonly"));
assert(authorizationUrl.includes("classroom.student-submissions.me.readonly"));
assert.equal(authorizationUrl.includes("coursework.students"), false);
assert.equal(authorizationUrl.includes("classroom.coursework.me"), false);

const snapshot = {
  courses: [{
    providerCourseId: "google_course_math",
    title: "Google Math",
    section: "Grade 10",
    teacher: "Teacher",
    alternateLink: "https://classroom.google.com/c/math",
  }],
  courseWork: [{
    providerCourseId: "google_course_math",
    providerCourseWorkId: "work_1",
    title: "Classroom Linear Equations",
    description: "Solve the worksheet.",
    dueAt: "2026-06-05T23:59:00Z",
    maxPoints: 100,
    workType: "ASSIGNMENT",
    alternateLink: "https://classroom.google.com/c/math/a/work_1",
    materials: [{
      providerMaterialId: "mat_1",
      title: "Worksheet link",
      rawType: "link",
      kind: "link_metadata",
      linkUrl: "https://classroom.google.com/material",
    }],
  }],
  courseWorkMaterials: [{
    providerCourseId: "google_course_math",
    providerCourseWorkMaterialId: "material_post_1",
    title: "Revision pack",
    updateTime: "2026-06-03T10:00:00.000Z",
    materials: [{
      providerMaterialId: "standalone_mat_1",
      title: "Revision pack PDF",
      rawType: "drive_file",
      linkUrl: "https://classroom.google.com/material/revision",
    }],
  }],
  submissions: [{
    providerCourseId: "google_course_math",
    providerCourseWorkId: "work_1",
    providerSubmissionId: "sub_1",
    state: "NEW",
  }],
};
const firstSummary = importClassroomSnapshotIntoState(state, snapshot, { now });
assert.equal(firstSummary.discoveredCourses, 1);
assert.equal(firstSummary.discoveredAssignments, 1);
assert.equal(firstSummary.discoveredMaterials, 2);
const secondSummary = importClassroomSnapshotIntoState(state, snapshot, { now });
assert.equal(secondSummary.importedCourses, 0);
assert.equal(secondSummary.updatedAssignments, 1);
assert.equal(state.assignments.filter((item) => item.providerCourseWorkId === "work_1").length, 0);
assert(state.classroomItems.some((item) => item.providerCourseWorkMaterialId === "material_post_1"));
selectClassroomItemsForAcademicContext(state, [state.classroomItems.find((item) => item.providerCourseWorkId === "work_1" && item.itemType === "assignment").id], { now });
const importedAssignment = state.assignments.find((item) => item.providerCourseWorkId === "work_1");
assert.equal(importedAssignment.source, "google_classroom");
assert.equal(importedAssignment.readOnly, true);
assert.equal(importedAssignment.automationEligibility, "requires_contract");
const flow = handleAssignmentLearningFlow(state, importedAssignment.id);
assert.equal(flow.assignmentId, importedAssignment.id);

const mockState = createSeedState(now);
const syncResult = await syncGoogleClassroomIntoState({
  state: mockState,
  session: { user: { id: mockState.studentProfile.id } },
  config: getGoogleClassroomConfig({ STUDENTOS_GOOGLE_CLASSROOM_MODE: "mock" }),
  now,
});
assert(syncResult.summary.discoveredAssignments + syncResult.summary.updatedAssignments > 0);
assert(mockState.auditLog.some((event) => event.action === "google_classroom.discovery_completed"));

const disabledStatus = await getClassroomConnectorStatus({
  state: mockState,
  userId: mockState.studentProfile.id,
  config: getGoogleClassroomConfig({ STUDENTOS_GOOGLE_CLASSROOM_MODE: "disabled" }),
  now,
});
assert.equal(disabledStatus.state, "disabled");
assert.equal(disabledStatus.writeScopesEnabled, false);
assert.deepEqual(disabledStatus.actions, {
  connect: false,
  reconnect: false,
  sync: false,
  disconnect: false,
});

const metadata = saveClassroomToken("classroom-token-user", {
  access_token: "access-secret",
  refresh_token: "refresh-secret",
  expires_in: 1,
}, now);
assert.equal(metadata.hasAccessToken, true);
assert.equal(metadata.secretsExposed, false);
assert.equal(getClassroomToken("classroom-token-user", new Date(now.getTime() + 2000)).expired, true);
assert.equal(JSON.stringify(safeClassroomTokenMetadata(getClassroomToken("classroom-token-user"))).includes("access-secret"), false);

const safeLog = JSON.stringify(redactSecrets({
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET: "state-secret",
  accessToken: "access-secret",
}));
assert.equal(safeLog.includes("google-client-secret"), false);
assert.equal(safeLog.includes("state-secret"), false);

const server = await readFile(new URL("../backend/server.js", import.meta.url), "utf8");
const frontend = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
for (const file of [server, frontend]) {
  assert.equal(file.includes("classroom.coursework.students"), false);
  assert.equal(file.includes("classroom.coursework.me"), false);
  assert.equal(file.includes("turnIn"), false);
  assert.equal(file.includes("modifyAttachments"), false);
}
assert(frontend.includes("You choose what gets added"));

console.log("PASS | StudentOS Pass 23 Google Classroom read-only connector tests passed");
