from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCOPES = ROOT / "backend/repository/stateScopes.js"
SERVER = ROOT / "backend/server.js"
TEST = ROOT / "backend/testH02NarrowStateRepositories.js"
DOC = ROOT / "docs/H02_NARROW_STATE_REPOSITORIES.md"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


scopes = SCOPES.read_text(encoding="utf-8")
scopes = replace_once(
    scopes,
    '''const TEST_SESSION_COLLECTIONS = Object.freeze([
  "courses",
  "topics",
  "assignments",
  "testSessions",
  "testResults",
  "creditLedger",
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "assignmentAutomationContracts",
  "auditLog",
]);''',
    '''const TEST_SESSION_COLLECTIONS = Object.freeze([
  "courses",
  "topics",
  "syllabi",
  "exams",
  "assignments",
  "timetable",
  "notes",
  "sourceMaterials",
  "testSessions",
  "testResults",
  "creditLedger",
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "assignmentAutomationContracts",
  "memoryItems",
  "backgroundJobs",
  "billingSubscriptions",
  "dataExportRequests",
  "dataExportJobs",
  "accountDeletionRequests",
  "classroomItems",
  "auditLog",
]);''',
    "test-session public workspace scope",
)
SCOPES.write_text(scopes, encoding="utf-8")

server = SERVER.read_text(encoding="utf-8")
server = replace_once(
    server,
    '''async function loadRequestState(session, scope) {
  if (scope === "dashboard") return repository.loadDashboardState(session);
  if (scope === "account_lifecycle") return repository.loadAccountLifecycle(session);
  if (scope === "recovery") return repository.loadRecoveryState(session);
  if (scope === "ai") return repository.loadAiState(session);
  return repository.loadAcademicContext(session);
}

async function getStateContext(req, { scope = null } = {}) {''',
    '''async function loadRequestState(session, scope, entityId = null) {
  if (scope === "dashboard") return repository.loadDashboardState(session);
  if (scope === "test_session") return repository.loadTestSession(session, entityId);
  if (scope === "account_lifecycle") return repository.loadAccountLifecycle(session);
  if (scope === "recovery") return repository.loadRecoveryState(session);
  if (scope === "ai") return repository.loadAiState(session);
  return repository.loadAcademicContext(session);
}

async function getStateContext(req, { scope = null, entityId = null } = {}) {''',
    "test-session loader dispatch",
)
server = replace_once(
    server,
    '''  const state = await loadRequestState(session, resolvedScope);''',
    '''  const state = await loadRequestState(session, resolvedScope, entityId);''',
    "state entity ID forwarding",
)

server = replace_once(
    server,
    '''  if (req.method === "POST" && studyTestStartMatch) {
    const body = await readJsonBody(req);
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const testSession = findStudyTestSession(state, { sessionId: decodeURIComponent(studyTestStartMatch[1]) });''',
    '''  if (req.method === "POST" && studyTestStartMatch) {
    const body = await readJsonBody(req);
    const testSessionId = decodeURIComponent(studyTestStartMatch[1]);
    const { session, state, persistence } = await getStateContext(req, { scope: "test_session", entityId: testSessionId });
    requireDashboardActive(state);
    const testSession = findStudyTestSession(state, { sessionId: testSessionId });''',
    "start test narrow loader",
)
server = replace_once(
    server,
    '''  if (req.method === "POST" && studyTestFinishMatch) {
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const testSession = findStudyTestSession(state, { sessionId: decodeURIComponent(studyTestFinishMatch[1]) });''',
    '''  if (req.method === "POST" && studyTestFinishMatch) {
    const testSessionId = decodeURIComponent(studyTestFinishMatch[1]);
    const { session, state, persistence } = await getStateContext(req, { scope: "test_session", entityId: testSessionId });
    requireDashboardActive(state);
    const testSession = findStudyTestSession(state, { sessionId: testSessionId });''',
    "finish test narrow loader",
)
server = replace_once(
    server,
    '''  if (req.method === "POST" && studyTestEvaluateMatch) {
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    assertProductFeatureAccess(state, FEATURE_KEYS.ASSISTANT);
    enforceRateLimit(req, session, "ai_call");
    const testSession = findStudyTestSession(state, { sessionId: decodeURIComponent(studyTestEvaluateMatch[1]) });''',
    '''  if (req.method === "POST" && studyTestEvaluateMatch) {
    const testSessionId = decodeURIComponent(studyTestEvaluateMatch[1]);
    const { session, state, persistence } = await getStateContext(req, { scope: "test_session", entityId: testSessionId });
    requireDashboardActive(state);
    assertProductFeatureAccess(state, FEATURE_KEYS.ASSISTANT);
    enforceRateLimit(req, session, "ai_call");
    const testSession = findStudyTestSession(state, { sessionId: testSessionId });''',
    "evaluate test narrow loader",
)
server = replace_once(
    server,
    '''  if (studyTestMatch && ["GET", "PATCH"].includes(req.method)) {
    const { session, state, persistence } = await getStateContext(req);
    requireDashboardActive(state);
    const testSession = findStudyTestSession(state, { sessionId: decodeURIComponent(studyTestMatch[1]) });''',
    '''  if (studyTestMatch && ["GET", "PATCH"].includes(req.method)) {
    const testSessionId = decodeURIComponent(studyTestMatch[1]);
    const { session, state, persistence } = await getStateContext(req, { scope: "test_session", entityId: testSessionId });
    requireDashboardActive(state);
    const testSession = findStudyTestSession(state, { sessionId: testSessionId });''',
    "read/save test narrow loader",
)
SERVER.write_text(server, encoding="utf-8")

test = TEST.read_text(encoding="utf-8")
test = replace_once(
    test,
    '''assert.match(serverSource, /repository\\.loadDashboardState/);
assert.match(serverSource, /repository\\.loadAccountLifecycle/);''',
    '''assert.match(serverSource, /repository\\.loadDashboardState/);
assert.match(serverSource, /repository\\.loadTestSession/);
assert.match(serverSource, /scope: "test_session", entityId: testSessionId/);
assert.match(serverSource, /repository\\.loadAccountLifecycle/);''',
    "test-session route assertions",
)
TEST.write_text(test, encoding="utf-8")

doc = DOC.read_text(encoding="utf-8")
doc += "\nPath-addressed test start, finish, evaluation, answer-save, and read operations now call `loadTestSession` with the server-decoded session ID. The test scope preserves the public workspace fields returned by those endpoints while filtering the test session and result rows to that entity and excluding AI, consent/legal, and recovery histories.\n"
DOC.write_text(doc, encoding="utf-8")
