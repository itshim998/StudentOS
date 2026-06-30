import assert from "node:assert/strict";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import {
  GOOGLE_CLASSROOM_READONLY_SCOPES,
  assertNoGoogleClassroomWriteScopes,
  getGoogleClassroomConfig,
} from "./connectors/googleClassroom/config.js";
import {
  getClassroomConnectorStatus,
  syncGoogleClassroomIntoState,
} from "./connectors/googleClassroom/syncService.js";
import { savePersistentClassroomToken } from "./connectors/googleClassroom/tokenStore.js";

const now = new Date("2026-06-25T06:00:00.000Z");
const later = new Date("2026-06-25T06:00:03.000Z");

function sessionFor(id) {
  return {
    authenticated: true,
    user: {
      id,
      email: `${id}@studentos.local`,
    },
  };
}

function oauthConfig() {
  return getGoogleClassroomConfig({
    STUDENTOS_GOOGLE_CLASSROOM_MODE: "oauth",
    GOOGLE_CLIENT_ID: "1234567890-studentos.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "client-secret",
    GOOGLE_REDIRECT_URI: "https://studentos.example/api/classroom/oauth/callback",
    STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET: "state-secret",
  });
}

function assertActions(connector, expected) {
  assert.deepEqual(connector.actions, {
    connect: false,
    reconnect: false,
    sync: false,
    disconnect: false,
    ...expected,
  });
}

function assertNoStudentFacingDeveloperCopy(connector) {
  const visible = JSON.stringify({
    state: connector.state,
    message: connector.message,
    ui: connector.ui,
  });
  assert.doesNotMatch(visible, /Classroom import unavailable/i);
  assert.doesNotMatch(visible, /Google Classroom import is disabled/i);
  assert.doesNotMatch(visible, /no write scopes/i);
  assert.doesNotMatch(visible, /no writeback/i);
  assert.doesNotMatch(visible, /try again/i);
  assert.doesNotMatch(visible, /token|scope|oauth|backend|provider/i);
}

const disabledSession = sessionFor("pass348_disabled");
const disabledState = createSeedState(now);
const disabledConfig = getGoogleClassroomConfig({
  STUDENTOS_GOOGLE_CLASSROOM_MODE: "disabled",
});
const disabledStatus = await getClassroomConnectorStatus({
  state: disabledState,
  session: disabledSession,
  config: disabledConfig,
  now,
});
assert.equal(disabledStatus.state, "disabled");
assert.equal(disabledStatus.connected, false);
assert.equal(disabledStatus.enabled, false);
assertActions(disabledStatus, {});
assertNoStudentFacingDeveloperCopy(disabledStatus);
await assert.rejects(() => syncGoogleClassroomIntoState({
  state: disabledState,
  session: disabledSession,
  config: disabledConfig,
  now,
}), /Classroom setup is not active/);

const setupSession = sessionFor("pass348_setup_required");
const setupState = createSeedState(now);
const setupConfig = getGoogleClassroomConfig({
  STUDENTOS_GOOGLE_CLASSROOM_MODE: "oauth",
});
const setupStatus = await getClassroomConnectorStatus({
  state: setupState,
  session: setupSession,
  config: setupConfig,
  now,
});
assert.equal(setupStatus.state, "setup_required");
assert.equal(setupStatus.setupRequired, true);
assertActions(setupStatus, {});
assertNoStudentFacingDeveloperCopy(setupStatus);
await assert.rejects(() => syncGoogleClassroomIntoState({
  state: setupState,
  session: setupSession,
  config: setupConfig,
  now,
}), /Classroom setup is not active/);

const disconnectedSession = sessionFor("pass348_disconnected");
const disconnectedState = createSeedState(now);
const liveConfig = oauthConfig();
const disconnectedStatus = await getClassroomConnectorStatus({
  state: disconnectedState,
  session: disconnectedSession,
  config: liveConfig,
  now,
});
assert.equal(disconnectedStatus.state, "disconnected");
assertActions(disconnectedStatus, { connect: true });
assertNoStudentFacingDeveloperCopy(disconnectedStatus);
await assert.rejects(() => syncGoogleClassroomIntoState({
  state: disconnectedState,
  session: disconnectedSession,
  config: liveConfig,
  now,
}), /Connect Classroom before syncing assignments/);

const connectedSession = sessionFor("pass348_connected");
const connectedState = createSeedState(now);
await savePersistentClassroomToken({
  session: connectedSession,
  token: {
    access_token: "access-pass348-connected",
    refresh_token: "refresh-pass348-connected",
    expires_in: 3600,
    scope: liveConfig.scopes.join(" "),
    token_type: "Bearer",
  },
  config: liveConfig,
  now,
});
const connectedStatus = await getClassroomConnectorStatus({
  state: connectedState,
  session: connectedSession,
  config: liveConfig,
  now,
});
assert.equal(connectedStatus.state, "connected");
assert.equal(connectedStatus.connected, true);
assertActions(connectedStatus, { sync: true, disconnect: true });
assertNoStudentFacingDeveloperCopy(connectedStatus);

const expiredSession = sessionFor("pass348_expired");
const expiredState = createSeedState(now);
await savePersistentClassroomToken({
  session: expiredSession,
  token: {
    access_token: "access-pass348-expired",
    refresh_token: "refresh-pass348-expired",
    expires_in: 1,
    scope: liveConfig.scopes.join(" "),
    token_type: "Bearer",
  },
  config: liveConfig,
  now,
});
const expiredStatus = await getClassroomConnectorStatus({
  state: expiredState,
  session: expiredSession,
  config: liveConfig,
  now: later,
});
assert.equal(expiredStatus.state, "reconnect_required");
assert.equal(expiredStatus.reconnectRequired, true);
assertActions(expiredStatus, { reconnect: true });
assertNoStudentFacingDeveloperCopy(expiredStatus);

assert.equal(assertNoGoogleClassroomWriteScopes(GOOGLE_CLASSROOM_READONLY_SCOPES), true);
assert.equal(GOOGLE_CLASSROOM_READONLY_SCOPES.some((scope) => /coursework\.students|rosters|turnIn|modify/i.test(scope)), false);

console.log("PASS | StudentOS Pass 34.8 Classroom state regression tests passed");
