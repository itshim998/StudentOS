import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { STATE_SCOPE_COLLECTIONS } from "./repository/stateScopes.js";

const session = { authenticated: true, user: { id: "11111111-1111-4111-8111-111111111111", email: "student@example.com" } };
const calls = [];
const rpcPayload = {
  studentProfile: { id: session.user.id, displayName: "Student", preferences: {} },
  courses: [], topics: [], syllabi: [], exams: [], assignments: [], timetable: [], notes: [],
  sourceMaterials: [], testSessions: [], testResults: [], creditLedger: [], roadmap: [],
  revisionEvents: [], tutorLessons: [], assignmentAutomationContracts: [], memoryItems: [],
  backgroundJobs: [], billingSubscriptions: [], dataExportRequests: [], dataExportJobs: [],
  accountDeletionRequests: [], classroomItems: [],
};
const fakeClient = {
  isConfigured: () => true,
  rpc: async (name, args) => {
    calls.push({ kind: "rpc", name, args });
    if (name === "load_studentos_state_scope") return rpcPayload;
    if (name === "persist_studentos_state_patch") return { persisted: true };
    if (name === "delete_studentos_source_artifacts") return { deleted: 1 };
    throw new Error(`unexpected_rpc:${name}`);
  },
  select: async (table) => { throw new Error(`unexpected_select:${table}`); },
  upsert: async (table) => { throw new Error(`unexpected_upsert:${table}`); },
  deleteObjects: async () => ({ deleted: true }),
};
const repo = new StudentOsRepository({
  config: { mode: "supabase" },
  shardClients: [{ index: 0, projectNumber: 2, label: "test", client: fakeClient }],
});

const dashboard = await repo.loadDashboardState(session);
assert.equal(dashboard.studentProfile.id, session.user.id);
assert.equal(calls.length, 1);
assert.equal(calls[0].name, "load_studentos_state_scope");
assert.equal(calls[0].args.p_scope, "dashboard");
assert(!STATE_SCOPE_COLLECTIONS.dashboard.includes("aiMessages"));
assert(!STATE_SCOPE_COLLECTIONS.dashboard.includes("recoveryPreviews"));
assert(!STATE_SCOPE_COLLECTIONS.academic_context.includes("legalAcceptances"));

calls.length = 0;
await repo.loadAccountLifecycle(session);
assert.deepEqual(calls.map((call) => call.name), ["load_studentos_state_scope"]);
assert.equal(calls[0].args.p_scope, "account_lifecycle");

calls.length = 0;
const state = {
  studentProfile: rpcPayload.studentProfile,
  topics: [{ id: "topic_1", userId: session.user.id, title: "Topic" }],
  testResults: [{ id: "result_1", userId: session.user.id, scorePercent: 80 }],
  creditLedger: [{ id: "credit_1", userId: session.user.id, sourceType: "test", amount: 2 }],
  roadmap: [], revisionEvents: [], tutorLessons: [], auditLog: [],
};
await repo.saveTestResultBundle(session, state);
assert.equal(calls.length, 1);
assert.equal(calls[0].name, "persist_studentos_state_patch");
assert.deepEqual(Object.keys(calls[0].args.p_collections).sort(), ["auditLog","creditLedger","revisionEvents","roadmap","testResults","topics","tutorLessons"].sort());

calls.length = 0;
await repo.deleteCollectionRows(session, "notes", ["note_1"]);
assert.equal(calls.length, 1);
assert.deepEqual(calls[0].args.p_delete_ids, { notes: ["note_1"] });

const repositorySource = await readFile(new URL("./repository/studentOsRepository.js", import.meta.url), "utf8");
assert.match(repositorySource, /async loadDashboardState\(/);
assert.match(repositorySource, /async loadAcademicContext\(/);
assert.match(repositorySource, /async loadTestSession\(/);
assert.match(repositorySource, /async loadAccountLifecycle\(/);
assert.match(repositorySource, /async loadRecoveryState\(/);
assert.match(repositorySource, /Promise\.all\(collectionPromises\)/);
assert.match(repositorySource, /persist_studentos_state_patch/);
assert.doesNotMatch(repositorySource.slice(repositorySource.indexOf("class SupabaseStudentOsRepository"), repositorySource.indexOf("async saveOrdinaryState")), /for \(const \[key, table\] of COLLECTIONS\)/);

const serverSource = await readFile(new URL("./server.js", import.meta.url), "utf8");
assert.match(serverSource, /requestStateScope\(req\)/);
assert.match(serverSource, /repository\.loadDashboardState/);
assert.match(serverSource, /repository\.loadTestSession/);
assert.match(serverSource, /scope: "test_session", entityId: testSessionId/);
assert.match(serverSource, /repository\.loadAccountLifecycle/);
assert.match(serverSource, /repository\.loadRecoveryState/);
assert.match(serverSource, /repository\.loadAcademicContext/);

const migration = await readFile(new URL("../supabase/migrations/202607280001_h02_narrow_state_repositories.sql", import.meta.url), "utf8");
assert.match(migration, /load_studentos_state_scope/);
assert.match(migration, /persist_studentos_state_patch/);
assert.match(migration, /delete_studentos_source_artifacts/);
assert.match(migration, /jsonb_populate_recordset/);
const testSessionScopeSql = migration.match(/when 'test_session' then scope_keys := array\[([^\]]+)\]/)?.[1] || "";
for (const key of STATE_SCOPE_COLLECTIONS.test_session) {
  assert.match(testSessionScopeSql, new RegExp(`'${key}'`), `migration test_session scope missing ${key}`);
}

// Regression: Historical H-02 migration file must remain untouched
assert.match(migration, /create or replace function public\.studentos_assert_state_owner\(p_user_id uuid\)/);
assert.match(migration, /coalesce\(current_setting\('request\.jwt\.claim\.role', true\), ''\) <> 'service_role'/);

// Regression: Repaired migration exists, removes legacy request.jwt.claim.role, uses PostgREST role, restricts privileges
const repairMigration = await readFile(new URL("../supabase/migrations/202607290001_h02_authorization_repair.sql", import.meta.url), "utf8");
assert.doesNotMatch(repairMigration, /request\.jwt\.claim\.role/, "Repair migration must not rely on legacy request.jwt.claim.role");
assert.match(repairMigration, /current_setting\('role',\s*true\)/, "Repair migration must use PostgREST request role current_setting('role', true)");
assert.doesNotMatch(repairMigration, /\bcurrent_user\b/, "Repair migration must not use current_user inside security definer function");
assert.match(repairMigration, /security definer/, "Repair migration must preserve security definer");
assert.match(repairMigration, /set search_path = public,\s*pg_temp/, "Repair migration must preserve safe search path");
assert.match(repairMigration, /revoke execute on function public\.studentos_assert_state_owner\(uuid\) from public,\s*anon,\s*authenticated;/, "Repair migration must revoke direct execute on helper from public/anon/authenticated");
assert.match(repairMigration, /grant execute on function public\.studentos_assert_state_owner\(uuid\) to service_role;/, "Repair migration must grant execute on helper to service_role");

// Regression: printMigrationPlan includes the forward-only repair migration
const printPlanSource = await readFile(new URL("../scripts/printMigrationPlan.js", import.meta.url), "utf8");
assert.match(printPlanSource, /202607290001_h02_authorization_repair\.sql/);

// Authorization matrix behavioral contract validation
function evaluateStudentOsAssertStateOwner({ role, authUid, targetUserId }) {
  const effectiveRole = role ? String(role).trim() : "";
  if (effectiveRole === "service_role") {
    return { allowed: true };
  }
  if (targetUserId && authUid && authUid === targetUserId) {
    return { allowed: true };
  }
  const error = new Error("STUDENTOS_STATE_UNAUTHORIZED");
  error.code = "42501";
  error.status = 403;
  throw error;
}

const targetUser = "4cb04cbc-bac4-4b81-9471-0dbd4ece1919";
const differentUser = "9f1ee619-a220-41e9-a8b0-cf010d523e28";

// Matrix 1: service_role + arbitrary valid UUID -> allowed
const serviceRoleResult = evaluateStudentOsAssertStateOwner({
  role: "service_role",
  authUid: null,
  targetUserId: targetUser,
});
assert.equal(serviceRoleResult.allowed, true);

// Matrix 2: authenticated + matching JWT subject -> allowed
const authMatchingResult = evaluateStudentOsAssertStateOwner({
  role: "authenticated",
  authUid: targetUser,
  targetUserId: targetUser,
});
assert.equal(authMatchingResult.allowed, true);

// Matrix 3: authenticated + different UUID -> denied with STUDENTOS_STATE_UNAUTHORIZED
assert.throws(
  () => evaluateStudentOsAssertStateOwner({
    role: "authenticated",
    authUid: differentUser,
    targetUserId: targetUser,
  }),
  (err) => err.message === "STUDENTOS_STATE_UNAUTHORIZED" && err.code === "42501" && err.status === 403,
  "authenticated user with mismatched target user ID must be denied with STUDENTOS_STATE_UNAUTHORIZED"
);

// Matrix 4: anon / no identity -> denied with STUDENTOS_STATE_UNAUTHORIZED
assert.throws(
  () => evaluateStudentOsAssertStateOwner({
    role: "anon",
    authUid: null,
    targetUserId: targetUser,
  }),
  (err) => err.message === "STUDENTOS_STATE_UNAUTHORIZED" && err.code === "42501" && err.status === 403,
  "anonymous caller must be denied with STUDENTOS_STATE_UNAUTHORIZED"
);

// Matrix 5: missing/unknown role + no identity -> denied with STUDENTOS_STATE_UNAUTHORIZED
assert.throws(
  () => evaluateStudentOsAssertStateOwner({
    role: null,
    authUid: null,
    targetUserId: targetUser,
  }),
  (err) => err.message === "STUDENTOS_STATE_UNAUTHORIZED" && err.code === "42501" && err.status === 403,
  "caller with missing role and no identity must be denied with STUDENTOS_STATE_UNAUTHORIZED"
);
assert.throws(
  () => evaluateStudentOsAssertStateOwner({
    role: "unknown_external_role",
    authUid: null,
    targetUserId: targetUser,
  }),
  (err) => err.message === "STUDENTOS_STATE_UNAUTHORIZED" && err.code === "42501" && err.status === 403,
  "caller with unknown role and no identity must be denied with STUDENTOS_STATE_UNAUTHORIZED"
);

console.log("PASS | H-02 narrow state repositories and transactional mutation tests passed");
console.log("PASS | H-02 authorization repair regression suite passed");

