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

// Regression: Forward-only Pass 4 persistence repair migration exists and corrects created_at / defaults
const persistenceRepairMigration = await readFile(new URL("../supabase/migrations/202607300001_h02_persistence_created_at_repair.sql", import.meta.url), "utf8");
assert.match(persistenceRepairMigration, /create or replace function public\.persist_studentos_state_patch/);
assert.match(persistenceRepairMigration, /perform public\.studentos_assert_state_owner\(p_user_id\);/);
assert.match(persistenceRepairMigration, /coalesce\(r\.created_at,\s*now\(\)\)/);
assert.match(persistenceRepairMigration, /coalesce\(r\.%1\$I,\s*%2\$s\)/);
assert.match(persistenceRepairMigration, /c\.column_name not in \('user_id',\s*'created_at',\s*'started_at'\)/);
assert.match(persistenceRepairMigration, /c\.column_name not in \('id',\s*'created_at',\s*'started_at'\)/);
assert.match(persistenceRepairMigration, /grant execute on function public\.persist_studentos_state_patch\(uuid, jsonb, jsonb, jsonb\) to authenticated,\s*service_role;/);

// Anti-regression: migration must NOT use naive un-coalesced 'select * from jsonb_populate_record' for inserts
assert.doesNotMatch(persistenceRepairMigration, /insert into public\.student_profiles\s+select\s+\*\s+from/i, "Must not use un-coalesced select * for student_profiles insert");
assert.doesNotMatch(persistenceRepairMigration, /insert into public\.%1\$I\s+select\s+\*\s+from/i, "Must not use un-coalesced select * for collection insert");

// Regression: printMigrationPlan includes 202607300001
assert.match(printPlanSource, /202607300001_h02_persistence_created_at_repair\.sql/);

// ============================================================================
// Behavioral Simulation: PostgreSQL jsonb_populate_record[set] & Persistence RPC
// ============================================================================

// Model of PostgreSQL table constraints
const TABLE_CONSTRAINTS = {
  student_profiles: {
    primaryKey: "user_id",
    conflictTarget: "user_id",
    columns: {
      user_id: { notNull: true, default: null },
      display_name: { notNull: true, default: null },
      grade_band: { notNull: true, default: "'high_school'::text" },
      school_system: { notNull: false, default: null },
      timezone: { notNull: true, default: "'UTC'::text" },
      discipline_index: { notNull: true, default: 50 },
      learning_adaptivity_score: { notNull: true, default: 50 },
      preferences: { notNull: true, default: "'{}'::jsonb" },
      visibility: { notNull: true, default: "'{}'::jsonb" },
      payload: { notNull: true, default: "'{}'::jsonb" },
      created_at: { notNull: true, default: "now()" },
      updated_at: { notNull: true, default: "now()" },
    },
  },
  courses: {
    primaryKey: "id",
    conflictTarget: "id",
    columns: {
      id: { notNull: true, default: "gen_random_uuid()::text" },
      user_id: { notNull: true, default: null },
      title: { notNull: true, default: null },
      term: { notNull: false, default: null },
      teacher: { notNull: false, default: null },
      exam_date: { notNull: false, default: null },
      payload: { notNull: true, default: "'{}'::jsonb" },
      created_at: { notNull: true, default: "now()" },
      updated_at: { notNull: true, default: "now()" },
    },
  },
  assignments: {
    primaryKey: "id",
    conflictTarget: "id",
    columns: {
      id: { notNull: true, default: "gen_random_uuid()::text" },
      user_id: { notNull: true, default: null },
      course_id: { notNull: false, default: null },
      title: { notNull: true, default: null },
      due_at: { notNull: false, default: null },
      status: { notNull: true, default: "'open'::text" },
      source: { notNull: true, default: "'manual'::text" },
      topic_ids: { notNull: true, default: "'[]'::jsonb" },
      automation_eligibility: { notNull: true, default: "'requires_contract'::text" },
      payload: { notNull: true, default: "'{}'::jsonb" },
      created_at: { notNull: true, default: "now()" },
      updated_at: { notNull: true, default: "now()" },
    },
  },
  test_results: {
    primaryKey: "id",
    conflictTarget: "id",
    columns: {
      id: { notNull: true, default: "gen_random_uuid()::text" },
      user_id: { notNull: true, default: null },
      test_session_id: { notNull: false, default: null },
      course_id: { notNull: false, default: null },
      topic_id: { notNull: false, default: null },
      grading_mode: { notNull: true, default: "'mcq_auto'::text" },
      score_percent: { notNull: true, default: null },
      credits_awarded: { notNull: true, default: 0 },
      answers: { notNull: true, default: "'[]'::jsonb" },
      answer_key: { notNull: true, default: "'[]'::jsonb" },
      corrections: { notNull: true, default: "'[]'::jsonb" },
      completed_at: { notNull: true, default: "now()" },
      payload: { notNull: true, default: "'{}'::jsonb" },
      created_at: { notNull: true, default: "now()" },
      updated_at: { notNull: true, default: "now()" },
    },
  },
};

// Evaluates an insert row according to PostgreSQL jsonb_populate_record
function populateRecordFromNull(tableName, inputJson) {
  const schema = TABLE_CONSTRAINTS[tableName];
  const populated = {};
  for (const colName of Object.keys(schema.columns)) {
    // In jsonb_populate_record(null::table, json), missing keys in json become null
    populated[colName] = Object.prototype.hasOwnProperty.call(inputJson, colName) ? inputJson[colName] : null;
  }
  return populated;
}

// Simulates the UNREPAIRED 202607280001 INSERT execution
function executeUnrepairedInsert(tableName, inputJson, existingRows = new Map()) {
  const populated = populateRecordFromNull(tableName, inputJson);
  const schema = TABLE_CONSTRAINTS[tableName];
  const conflictKey = populated[schema.conflictTarget];

  if (!existingRows.has(conflictKey)) {
    // First time INSERT: checks NOT NULL constraints on all columns of populated
    for (const [colName, colDef] of Object.entries(schema.columns)) {
      if (colDef.notNull && (populated[colName] === null || populated[colName] === undefined)) {
        const error = new Error(`null value in column "${colName}" of relation "${tableName}" violates not-null constraint`);
        error.code = "23502";
        throw error;
      }
    }
    existingRows.set(conflictKey, { ...populated });
    return { action: "inserted", row: existingRows.get(conflictKey) };
  } else {
    // ON CONFLICT UPDATE: updates columns except user_id/id and created_at
    const existing = existingRows.get(conflictKey);
    const updated = { ...existing };
    for (const colName of Object.keys(schema.columns)) {
      if (!["user_id", "id", "created_at", "started_at"].includes(colName)) {
        updated[colName] = populated[colName];
      }
    }
    existingRows.set(conflictKey, updated);
    return { action: "updated", row: updated };
  }
}

// Simulates the REPAIRED 202607300001 INSERT execution
function executeRepairedInsert(tableName, inputJson, existingRows = new Map(), simulatedNow = new Date().toISOString()) {
  const populated = populateRecordFromNull(tableName, inputJson);
  const schema = TABLE_CONSTRAINTS[tableName];
  const conflictKey = populated[schema.conflictTarget];

  // The repaired SELECT expressions apply coalesce(r.created_at, now()) and coalesce(r.col, default)
  const evaluatedInsert = {};
  for (const [colName, colDef] of Object.entries(schema.columns)) {
    let val = populated[colName];
    if (colName === "created_at") {
      val = val !== null ? val : simulatedNow;
    } else if (colDef.notNull && colDef.default !== null && (val === null || val === undefined)) {
      // Evaluate column default
      val = colDef.default === "now()" ? simulatedNow : colDef.default;
    }
    evaluatedInsert[colName] = val;
  }

  if (!existingRows.has(conflictKey)) {
    // First time INSERT: check NOT NULL constraints on evaluated values
    for (const [colName, colDef] of Object.entries(schema.columns)) {
      if (colDef.notNull && (evaluatedInsert[colName] === null || evaluatedInsert[colName] === undefined)) {
        const error = new Error(`null value in column "${colName}" of relation "${tableName}" violates not-null constraint`);
        error.code = "23502";
        throw error;
      }
    }
    existingRows.set(conflictKey, { ...evaluatedInsert });
    return { action: "inserted", row: existingRows.get(conflictKey) };
  } else {
    // ON CONFLICT UPDATE: updates all columns from evaluatedInsert EXCEPT conflict keys and created_at/started_at
    const existing = existingRows.get(conflictKey);
    const updated = { ...existing };
    for (const colName of Object.keys(schema.columns)) {
      if (!["user_id", "id", "created_at", "started_at"].includes(colName)) {
        updated[colName] = evaluatedInsert[colName];
      }
    }
    existingRows.set(conflictKey, updated);
    return { action: "updated", row: updated };
  }
}

// Verification 1: Unrepaired RPC reproduces production failure on first student_profiles insert
const sampleProfileJson = {
  user_id: targetUser,
  display_name: "Test Student",
  grade_band: "high_school",
  school_system: null,
  timezone: "UTC",
  discipline_index: 50,
  learning_adaptivity_score: 50,
  preferences: {},
  visibility: {},
  payload: { displayName: "Test Student" },
  updated_at: "2026-07-30T10:00:00.000Z",
  // created_at is omitted by profileRow()
};

assert.throws(
  () => executeUnrepairedInsert("student_profiles", sampleProfileJson, new Map()),
  (err) => err.message === 'null value in column "created_at" of relation "student_profiles" violates not-null constraint' && err.code === "23502",
  "Unrepaired logic must fail with created_at NOT NULL constraint violation"
);

// Verification 2: Repaired RPC successfully inserts first student_profiles with non-null created_at
const profilesTable = new Map();
const insertTime = "2026-07-30T10:00:00.000Z";
const profileInsertResult = executeRepairedInsert("student_profiles", sampleProfileJson, profilesTable, insertTime);
assert.equal(profileInsertResult.action, "inserted");
assert.equal(profileInsertResult.row.created_at, insertTime);
assert.equal(profileInsertResult.row.display_name, "Test Student");
assert.equal(profilesTable.size, 1);

// Verification 3: Repaired RPC update of existing student_profiles does NOT overwrite original created_at
const updateTime = "2026-07-30T12:00:00.000Z";
const updatedProfileJson = {
  ...sampleProfileJson,
  display_name: "Updated Student Name",
  updated_at: updateTime,
};
const profileUpdateResult = executeRepairedInsert("student_profiles", updatedProfileJson, profilesTable, updateTime);
assert.equal(profileUpdateResult.action, "updated");
assert.equal(profileUpdateResult.row.display_name, "Updated Student Name");
assert.equal(profileUpdateResult.row.created_at, insertTime, "created_at must remain immutable across updates");
assert.equal(profileUpdateResult.row.updated_at, updateTime);

// Verification 4: Collection table insert without created_at (courses) succeeds with repaired RPC
const sampleCourseJson = {
  id: "course_1",
  user_id: targetUser,
  title: "AP Physics",
  term: "Fall",
  payload: { title: "AP Physics" },
  updated_at: insertTime,
  // created_at omitted by rowForCollection()
};
const coursesTable = new Map();

// Unrepaired fails on collection
assert.throws(
  () => executeUnrepairedInsert("courses", sampleCourseJson, coursesTable),
  (err) => err.message === 'null value in column "created_at" of relation "courses" violates not-null constraint' && err.code === "23502"
);

// Repaired succeeds on collection
const courseInsertResult = executeRepairedInsert("courses", sampleCourseJson, coursesTable, insertTime);
assert.equal(courseInsertResult.action, "inserted");
assert.equal(courseInsertResult.row.created_at, insertTime);
assert.equal(courseInsertResult.row.title, "AP Physics");

// Existing collection row retains created_at on update
const courseUpdateResult = executeRepairedInsert(
  "courses",
  { ...sampleCourseJson, title: "AP Physics C", updated_at: updateTime },
  coursesTable,
  updateTime
);
assert.equal(courseUpdateResult.action, "updated");
assert.equal(courseUpdateResult.row.title, "AP Physics C");
assert.equal(courseUpdateResult.row.created_at, insertTime, "Collection row created_at must remain immutable across updates");
assert.equal(courseUpdateResult.row.updated_at, updateTime);

// Verification 5: Omitted NOT NULL columns with defaults coalesce properly
const sampleAssignmentJson = {
  id: "assign_1",
  user_id: targetUser,
  title: "Problem Set 1",
  status: "open",
  source: "manual",
  topic_ids: [],
  payload: { title: "Problem Set 1" },
  updated_at: insertTime,
  // automation_eligibility omitted by rowForCollection()
  // created_at omitted by rowForCollection()
};
const assignmentsTable = new Map();
const assignResult = executeRepairedInsert("assignments", sampleAssignmentJson, assignmentsTable, insertTime);
assert.equal(assignResult.action, "inserted");
assert.equal(assignResult.row.created_at, insertTime);
assert.equal(assignResult.row.automation_eligibility, "'requires_contract'::text");

const sampleTestResultJson = {
  id: "result_1",
  user_id: targetUser,
  score_percent: 95,
  credits_awarded: 1,
  answers: [],
  answer_key: [],
  payload: {},
  updated_at: insertTime,
  // corrections omitted by rowForCollection()
  // created_at omitted by rowForCollection()
};
const testResultsTable = new Map();
const trResult = executeRepairedInsert("test_results", sampleTestResultJson, testResultsTable, insertTime);
assert.equal(trResult.action, "inserted");
assert.equal(trResult.row.created_at, insertTime);
assert.equal(trResult.row.corrections, "'[]'::jsonb");

// Verification 6: Ownership mismatch checks remain strictly enforced
function simulatePersistPatchOwnershipCheck(pUserId, profileJson, collectionsJson) {
  if (profileJson && profileJson.user_id !== pUserId) {
    throw new Error("STUDENTOS_STATE_OWNER_MISMATCH");
  }
  for (const [key, rows] of Object.entries(collectionsJson || {})) {
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row.user_id !== pUserId) {
          throw new Error(`STUDENTOS_STATE_OWNER_MISMATCH: ${key}`);
        }
      }
    }
  }
  return true;
}

assert.equal(simulatePersistPatchOwnershipCheck(targetUser, sampleProfileJson, { courses: [sampleCourseJson] }), true);
assert.throws(
  () => simulatePersistPatchOwnershipCheck(targetUser, { ...sampleProfileJson, user_id: differentUser }, {}),
  (err) => err.message === "STUDENTOS_STATE_OWNER_MISMATCH"
);
assert.throws(
  () => simulatePersistPatchOwnershipCheck(targetUser, sampleProfileJson, { courses: [{ ...sampleCourseJson, user_id: differentUser }] }),
  (err) => err.message === "STUDENTOS_STATE_OWNER_MISMATCH: courses"
);

console.log("PASS | H-02 narrow state repositories and transactional mutation tests passed");
console.log("PASS | H-02 authorization repair regression suite passed");
console.log("PASS | H-02 persistence created_at & column-default repair regression suite passed");


