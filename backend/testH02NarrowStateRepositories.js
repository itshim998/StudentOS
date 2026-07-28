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

console.log("PASS | H-02 narrow state repositories and transactional mutation tests passed");
