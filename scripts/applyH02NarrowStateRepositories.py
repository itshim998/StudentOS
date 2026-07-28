from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT / "backend/repository/studentOsRepository.js"
SERVER = ROOT / "backend/server.js"
PACKAGE = ROOT / "package.json"
MIGRATION_PLAN = ROOT / "scripts/printMigrationPlan.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


state_scopes = r'''export const STATE_SCOPE_NAMES = Object.freeze({
  DASHBOARD: "dashboard",
  ACADEMIC_CONTEXT: "academic_context",
  TEST_SESSION: "test_session",
  ACCOUNT_LIFECYCLE: "account_lifecycle",
  RECOVERY: "recovery",
  AI: "ai",
  FULL: "full",
});

const DASHBOARD_COLLECTIONS = Object.freeze([
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
]);

const ACADEMIC_CONTEXT_COLLECTIONS = Object.freeze([
  "courses",
  "topics",
  "syllabi",
  "exams",
  "assignments",
  "timetable",
  "notes",
  "sourceMaterials",
  "sourceChunks",
  "testSessions",
  "testResults",
  "creditLedger",
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "assignmentAutomationContracts",
  "memoryItems",
  "embeddingsMetadata",
  "backgroundJobs",
  "jobEvents",
  "billingSubscriptions",
  "classroomItems",
]);

const TEST_SESSION_COLLECTIONS = Object.freeze([
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
]);

const ACCOUNT_LIFECYCLE_COLLECTIONS = Object.freeze([
  "billingSubscriptions",
  "billingWebhookEvents",
  "consentVersions",
  "userConsents",
  "legalAcceptances",
  "dataExportRequests",
  "dataExportJobs",
  "accountDeletionRequests",
  "accountDeletionReviews",
  "roleInvitations",
  "auditLog",
]);

const RECOVERY_COLLECTIONS = Object.freeze([
  "courses",
  "topics",
  "assignments",
  "timetable",
  "notes",
  "sourceMaterials",
  "testSessions",
  "testResults",
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "backgroundJobs",
  "auditLog",
  "recoveryUserStates",
  "academicEvents",
  "academicStateSnapshots",
  "topicRecoveryStates",
  "topicRecoveryStateHistory",
  "recoveryRuns",
  "recoveryPreviews",
  "planVersions",
]);

const AI_COLLECTIONS = Object.freeze([
  "courses",
  "topics",
  "assignments",
  "sourceMaterials",
  "sourceChunks",
  "testResults",
  "creditLedger",
  "roadmap",
  "memoryItems",
  "embeddingsMetadata",
  "billingSubscriptions",
  "classroomItems",
  "aiConversations",
  "aiMessages",
]);

export const STATE_SCOPE_COLLECTIONS = Object.freeze({
  [STATE_SCOPE_NAMES.DASHBOARD]: DASHBOARD_COLLECTIONS,
  [STATE_SCOPE_NAMES.ACADEMIC_CONTEXT]: ACADEMIC_CONTEXT_COLLECTIONS,
  [STATE_SCOPE_NAMES.TEST_SESSION]: TEST_SESSION_COLLECTIONS,
  [STATE_SCOPE_NAMES.ACCOUNT_LIFECYCLE]: ACCOUNT_LIFECYCLE_COLLECTIONS,
  [STATE_SCOPE_NAMES.RECOVERY]: RECOVERY_COLLECTIONS,
  [STATE_SCOPE_NAMES.AI]: AI_COLLECTIONS,
});

export function normalizeStateScope(scope) {
  const normalized = String(scope || STATE_SCOPE_NAMES.DASHBOARD).trim().toLowerCase();
  if (normalized === STATE_SCOPE_NAMES.FULL) return STATE_SCOPE_NAMES.FULL;
  return Object.prototype.hasOwnProperty.call(STATE_SCOPE_COLLECTIONS, normalized)
    ? normalized
    : STATE_SCOPE_NAMES.DASHBOARD;
}

export function collectionKeysForScope(scope, allCollectionKeys = []) {
  const normalized = normalizeStateScope(scope);
  if (normalized === STATE_SCOPE_NAMES.FULL) return [...allCollectionKeys];
  const allowed = new Set(allCollectionKeys);
  return (STATE_SCOPE_COLLECTIONS[normalized] || []).filter((key) => allowed.has(key));
}
'''
(ROOT / "backend/repository/stateScopes.js").write_text(state_scopes, encoding="utf-8")

repo = REPO.read_text(encoding="utf-8")
repo = replace_once(
    repo,
    'import { AiRouterV2Coordinator } from "../ai/routerV2State.js";\n',
    'import { AiRouterV2Coordinator } from "../ai/routerV2State.js";\nimport { STATE_SCOPE_NAMES, collectionKeysForScope, normalizeStateScope } from "./stateScopes.js";\n',
    "repository scope import",
)

repo = replace_once(
    repo,
    'const ALL_COLLECTIONS = [...COLLECTIONS, ...RECOVERY_COLLECTIONS];\nconst RECOVERY_PERSISTENCE_VERSION',
    '''const ALL_COLLECTIONS = [...COLLECTIONS, ...RECOVERY_COLLECTIONS];
const COLLECTION_TABLE_BY_KEY = new Map(ALL_COLLECTIONS);
const ALL_COLLECTION_KEYS = Object.freeze(ALL_COLLECTIONS.map(([key]) => key));
const RECOVERY_COLLECTION_KEY_SET = new Set(RECOVERY_COLLECTIONS.map(([key]) => key));
const RECOVERY_PERSISTENCE_VERSION''',
    "repository collection indexes",
)

helpers_anchor = '''function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
'''
helpers_replacement = helpers_anchor + r'''
function isMissingDatabaseObject(error) {
  const label = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return error?.status === 404 || label.includes("42p01") || label.includes("42883") ||
    label.includes("does not exist") || label.includes("could not find the function");
}

function stateFromScopePayload(payload, user, scope, entityId = null) {
  const normalizedPayload = Array.isArray(payload) ? payload[0] : payload;
  const raw = normalizedPayload?.state || normalizedPayload?.result || normalizedPayload || {};
  const state = {
    studentProfile: raw.studentProfile || raw.student_profile || initialStateForUser(user).studentProfile,
  };
  const keys = collectionKeysForScope(scope, ALL_COLLECTION_KEYS);
  for (const key of keys) {
    const values = raw[key];
    state[key] = Array.isArray(values) ? values.filter(Boolean) : [];
  }
  if (entityId && Array.isArray(state.testSessions)) {
    state.testSessions = state.testSessions.filter((item) => item?.id === entityId);
  }
  if (entityId && Array.isArray(state.testResults)) {
    state.testResults = state.testResults.filter((item) => item?.testSessionId === entityId || item?.id === entityId);
  }
  return ensureStateShape(state);
}

function scopedClone(state, scope, entityId = null) {
  const result = { studentProfile: clone(state.studentProfile) };
  for (const key of collectionKeysForScope(scope, ALL_COLLECTION_KEYS)) {
    result[key] = clone(state[key] || []);
  }
  if (entityId && Array.isArray(result.testSessions)) {
    result.testSessions = result.testSessions.filter((item) => item?.id === entityId);
  }
  if (entityId && Array.isArray(result.testResults)) {
    result.testResults = result.testResults.filter((item) => item?.testSessionId === entityId || item?.id === entityId);
  }
  return ensureStateShape(result);
}

function transactionalPatchRequired(error) {
  const wrapped = new Error("StudentOS transactional state persistence is unavailable. Apply the H-02 shard migration before accepting this mutation.");
  wrapped.code = "H02_TRANSACTIONAL_STATE_PATCH_REQUIRED";
  wrapped.status = 503;
  wrapped.cause = error;
  return wrapped;
}
'''
repo = replace_once(repo, helpers_anchor, helpers_replacement, "repository helper insertion")

mock_load_anchor = '''  async loadState(session) {
    const user = session?.user || { id: "student_local_001" };
    if (!this.states.has(user.id)) {
      this.states.set(user.id, ensureStateShape(initialStateForUser(user)));
    }
    const state = clone(this.states.get(user.id));
    return markRecoveryPersistenceVersion(state);
  }

  async saveState(session, state) {'''
mock_load_replacement = '''  async loadState(session) {
    const user = session?.user || { id: "student_local_001" };
    if (!this.states.has(user.id)) {
      this.states.set(user.id, ensureStateShape(initialStateForUser(user)));
    }
    const state = clone(this.states.get(user.id));
    return markRecoveryPersistenceVersion(state);
  }

  async loadStateScope(session, scope, { entityId = null } = {}) {
    const state = await this.loadState(session);
    return markRecoveryPersistenceVersion(scopedClone(state, normalizeStateScope(scope), entityId));
  }

  async loadDashboardState(session) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.DASHBOARD);
  }

  async loadAcademicContext(session) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.ACADEMIC_CONTEXT);
  }

  async loadTestSession(session, testSessionId) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.TEST_SESSION, { entityId: testSessionId });
  }

  async loadAccountLifecycle(session) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.ACCOUNT_LIFECYCLE);
  }

  async loadRecoveryState(session) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.RECOVERY);
  }

  async loadAiState(session) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.AI);
  }

  async saveProfile(session, state) {
    const userId = session?.user?.id || state.studentProfile.id;
    const current = ensureStateShape(clone(this.states.get(userId) || initialStateForUser(session?.user || { id: userId })));
    current.studentProfile = clone(state.studentProfile);
    this.states.set(userId, current);
  }

  async deleteCollectionRows(session, key, ids = []) {
    if (!COLLECTION_TABLE_BY_KEY.has(key)) throw new Error("unknown_studentos_collection");
    const userId = session?.user?.id || "student_local_001";
    const state = ensureStateShape(clone(this.states.get(userId) || initialStateForUser(session?.user || { id: userId })));
    const remove = new Set(ids.filter(Boolean));
    state[key] = (state[key] || []).filter((item) => !remove.has(item?.id));
    this.states.set(userId, state);
    return { deleted: remove.size, mode: "mock" };
  }

  async archiveCollectionRows(session, key, ids = [], { reason = "explicit_archive", archivedAt = nowIso() } = {}) {
    if (!COLLECTION_TABLE_BY_KEY.has(key)) throw new Error("unknown_studentos_collection");
    const userId = session?.user?.id || "student_local_001";
    const state = ensureStateShape(clone(this.states.get(userId) || initialStateForUser(session?.user || { id: userId })));
    const targets = new Set(ids.filter(Boolean));
    let archived = 0;
    state[key] = (state[key] || []).map((item) => {
      if (!targets.has(item?.id)) return item;
      archived += 1;
      return { ...item, archived: true, archivedAt, archiveReason: reason, updatedAt: archivedAt };
    });
    this.states.set(userId, state);
    return { archived, mode: "mock" };
  }

  async saveState(session, state) {'''
repo = replace_once(repo, mock_load_anchor, mock_load_replacement, "mock narrow loaders")

supabase_old = '''  async loadState(session) {
    const route = this.route(session);
    const user = session.user;
    const profileRows = await route.client.select("student_profiles", {
      columns: "payload",
      filters: { user_id: `eq.${user.id}` },
      limit: 1,
    });

    if (!profileRows.length) {
      const initialState = ensureStateShape(initialStateForUser(user));
      await this.saveState(session, initialState);
      return markRecoveryPersistenceVersion(initialState);
    }

    const storedProfile = fromPayload(profileRows[0]);
    const storedProfilePayload = JSON.stringify(storedProfile ?? null);
    const storedLifecycle = JSON.stringify(storedProfile?.productLifecycle ?? null);
    const state = {
      studentProfile: storedProfile,
    };
    for (const [key, table] of COLLECTIONS) {
      const rows = await route.client.select(table, {
        columns: "payload",
        filters: { user_id: `eq.${user.id}` },
        order: "created_at.asc",
      });
      state[key] = rows.map(fromPayload).filter(Boolean);
    }
    for (const [key, table] of RECOVERY_COLLECTIONS) {
      try {
        const rows = await route.client.select(table, {
          columns: "payload",
          filters: { user_id: `eq.${user.id}` },
          order: "created_at.asc",
        });
        state[key] = rows.map(fromPayload).filter(Boolean);
      } catch (error) {
        const label = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
        if (error?.status !== 404 && !label.includes("42p01") && !label.includes("does not exist")) throw error;
        state[key] = [];
      }
    }
    const classroomMigrationKeys = [
      "classroomItems",
      "assignments",
      "sourceMaterials",
      "sourceChunks",
      "memoryItems",
      "embeddingsMetadata",
      "backgroundJobs",
      "courses",
      "topics",
      "roadmap",
      "testSessions",
      "assignmentAutomationContracts",
      "tutorLessons",
      "revisionEvents",
    ];
    const beforeClassroomMigration = Object.fromEntries(classroomMigrationKeys.map((key) => [key, JSON.stringify(state[key] || [])]));
    const shaped = ensureStateShape(state);
    if (JSON.stringify(shaped.studentProfile) !== storedProfilePayload || JSON.stringify(shaped.studentProfile.productLifecycle) !== storedLifecycle) {
      await route.client.upsert("student_profiles", profileRow(shaped.studentProfile, user.id), {
        onConflict: "user_id",
        returning: "minimal",
      });
    }
    const changedClassroomKeys = classroomMigrationKeys.filter((key) => JSON.stringify(shaped[key] || []) !== beforeClassroomMigration[key]);
    if (changedClassroomKeys.length) {
      await this.saveChangedCollections(session, shaped, changedClassroomKeys);
    }
    return markRecoveryPersistenceVersion(shaped);
  }

  async saveState(session, state) {
    const route = this.route(session);
    const userId = session.user.id;
    const shaped = ensureStateShape(state);
    await route.client.upsert("student_profiles", profileRow(shaped.studentProfile, userId), {
      onConflict: "user_id",
      returning: "minimal",
    });
    for (const [key, table] of COLLECTIONS) {
      const items = shaped[key] || [];
      if (!items.length) continue;
      const rows = items.filter((item) => item?.id).map((item) => rowForCollection(key, item, userId));
      if (rows.length) {
        await route.client.upsert(table, rows, { onConflict: "id", returning: "minimal" });
      }
    }
  }
'''

supabase_new = r'''  async loadState(session) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.FULL);
  }

  async loadStateScope(session, scope, { entityId = null } = {}) {
    const route = this.route(session);
    const user = session.user;
    const normalizedScope = normalizeStateScope(scope);
    if (route.client?.rpc) {
      try {
        const payload = await route.client.rpc("load_studentos_state_scope", {
          p_user_id: user.id,
          p_scope: normalizedScope,
          p_entity_id: entityId || null,
        });
        const candidate = Array.isArray(payload) ? payload[0] : payload;
        const raw = candidate?.state || candidate?.result || candidate;
        if (raw?.studentProfile || raw?.student_profile) {
          return markRecoveryPersistenceVersion(stateFromScopePayload(raw, user, normalizedScope, entityId));
        }
      } catch (error) {
        if (!isMissingDatabaseObject(error)) throw error;
      }
    }

    const keys = collectionKeysForScope(normalizedScope, ALL_COLLECTION_KEYS);
    const profilePromise = route.client.select("student_profiles", {
      columns: "payload",
      filters: { user_id: `eq.${user.id}` },
      limit: 1,
    });
    const collectionPromises = keys.map(async (key) => {
      const table = COLLECTION_TABLE_BY_KEY.get(key);
      const filters = { user_id: `eq.${user.id}` };
      if (entityId && key === "testSessions") filters.id = `eq.${entityId}`;
      if (entityId && key === "testResults") filters.test_session_id = `eq.${entityId}`;
      try {
        const rows = await route.client.select(table, {
          columns: "payload",
          filters,
          order: "created_at.asc",
        });
        return [key, rows.map(fromPayload).filter(Boolean)];
      } catch (error) {
        if (RECOVERY_COLLECTION_KEY_SET.has(key) && isMissingDatabaseObject(error)) return [key, []];
        throw error;
      }
    });
    const [profileRows, collectionEntries] = await Promise.all([
      profilePromise,
      Promise.all(collectionPromises),
    ]);
    if (!profileRows.length) {
      const initialState = ensureStateShape(initialStateForUser(user));
      await this.saveProfile(session, initialState);
      return markRecoveryPersistenceVersion(scopedClone(initialState, normalizedScope, entityId));
    }
    const state = {
      studentProfile: fromPayload(profileRows[0]),
      ...Object.fromEntries(collectionEntries),
    };
    return markRecoveryPersistenceVersion(ensureStateShape(state));
  }

  async loadDashboardState(session) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.DASHBOARD);
  }

  async loadAcademicContext(session) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.ACADEMIC_CONTEXT);
  }

  async loadTestSession(session, testSessionId) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.TEST_SESSION, { entityId: testSessionId });
  }

  async loadAccountLifecycle(session) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.ACCOUNT_LIFECYCLE);
  }

  async loadRecoveryState(session) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.RECOVERY);
  }

  async loadAiState(session) {
    return this.loadStateScope(session, STATE_SCOPE_NAMES.AI);
  }

  async saveProfile(session, state) {
    const route = this.route(session);
    await route.client.upsert("student_profiles", profileRow(state.studentProfile, session.user.id), {
      onConflict: "user_id",
      returning: "minimal",
    });
  }

  async persistStatePatch(session, state, keys, { includeProfile = false, deleteIds = {} } = {}) {
    const route = this.route(session);
    const userId = session.user.id;
    const shaped = ensureStateShape(state);
    const uniqueKeys = [...new Set((keys || []).filter((key) => COLLECTION_TABLE_BY_KEY.has(key)))];
    const collections = {};
    for (const key of uniqueKeys) {
      collections[key] = (shaped[key] || [])
        .filter((item) => item?.id)
        .map((item) => rowForCollection(key, item, userId));
    }
    const normalizedDeletes = Object.fromEntries(
      Object.entries(deleteIds || {})
        .filter(([key, ids]) => COLLECTION_TABLE_BY_KEY.has(key) && Array.isArray(ids) && ids.some(Boolean))
        .map(([key, ids]) => [key, [...new Set(ids.filter(Boolean))]]),
    );
    try {
      return await route.client.rpc("persist_studentos_state_patch", {
        p_user_id: userId,
        p_profile: includeProfile ? profileRow(shaped.studentProfile, userId) : null,
        p_collections: collections,
        p_delete_ids: normalizedDeletes,
      });
    } catch (error) {
      const hasDeletes = Object.keys(normalizedDeletes).length > 0;
      if (!isMissingDatabaseObject(error)) throw error;
      if (uniqueKeys.length === 0 && includeProfile && !hasDeletes) {
        return this.saveProfile(session, shaped);
      }
      if (uniqueKeys.length === 1 && !includeProfile && !hasDeletes) {
        const key = uniqueKeys[0];
        const rows = collections[key] || [];
        if (!rows.length) return { persisted: true, fallback: "empty_single_collection" };
        await route.client.upsert(COLLECTION_TABLE_BY_KEY.get(key), rows, { onConflict: "id", returning: "minimal" });
        return { persisted: true, fallback: "single_collection" };
      }
      throw transactionalPatchRequired(error);
    }
  }

  async saveState(session, state) {
    const keys = COLLECTIONS.map(([key]) => key).filter((key) => Object.prototype.hasOwnProperty.call(state, key));
    return this.persistStatePatch(session, state, keys, { includeProfile: true });
  }
'''
repo = replace_once(repo, supabase_old, supabase_new, "supabase narrow loader and transaction patch")

save_changed_old = '''  async saveChangedCollections(session, state, keys) {
    const route = this.route(session);
    const userId = session.user.id;
    const shaped = ensureStateShape(state);
    for (const key of keys) {
      const table = ALL_COLLECTIONS.find(([collectionKey]) => collectionKey === key)?.[1];
      if (!table) continue;
      const rows = (shaped[key] || []).filter((item) => item?.id).map((item) => rowForCollection(key, item, userId));
      if (rows.length) {
        await route.client.upsert(table, rows, { onConflict: "id", returning: "minimal" });
      }
    }
  }
'''
save_changed_new = '''  async saveChangedCollections(session, state, keys, options = {}) {
    return this.persistStatePatch(session, state, keys, options);
  }

  async saveAcademicContext(session, state) {
    return this.saveChangedCollections(session, state, collectionKeysForScope(STATE_SCOPE_NAMES.ACADEMIC_CONTEXT, ALL_COLLECTION_KEYS), { includeProfile: true });
  }

  async deleteCollectionRows(session, key, ids = []) {
    if (!COLLECTION_TABLE_BY_KEY.has(key)) throw new Error("unknown_studentos_collection");
    const state = ensureStateShape({ studentProfile: initialStateForUser(session.user).studentProfile });
    await this.persistStatePatch(session, state, [], { deleteIds: { [key]: ids } });
    return { deleted: [...new Set(ids.filter(Boolean))].length, mode: "supabase" };
  }

  async archiveCollectionRows(session, key, records = [], { reason = "explicit_archive", archivedAt = nowIso() } = {}) {
    if (!COLLECTION_TABLE_BY_KEY.has(key)) throw new Error("unknown_studentos_collection");
    const archivedRecords = (records || []).filter((item) => item?.id).map((item) => ({
      ...item,
      archived: true,
      archivedAt,
      archiveReason: reason,
      updatedAt: archivedAt,
    }));
    const state = ensureStateShape({
      studentProfile: initialStateForUser(session.user).studentProfile,
      [key]: archivedRecords,
    });
    await this.persistStatePatch(session, state, [key]);
    return { archived: archivedRecords.length, mode: "supabase" };
  }
'''
repo = replace_once(repo, save_changed_old, save_changed_new, "transactional saveChangedCollections")

repo = replace_once(
    repo,
    '''  async saveAccountLifecycle(session, state) {
    await this.saveChangedCollections(session, state, [
      "consentVersions",
      "userConsents",
      "legalAcceptances",
      "dataExportRequests",
      "dataExportJobs",
      "accountDeletionRequests",
      "accountDeletionReviews",
      "roleInvitations",
      "auditLog",
    ]);
  }
''',
    '''  async saveAccountLifecycle(session, state) {
    await this.saveChangedCollections(session, state, [
      "billingSubscriptions",
      "billingWebhookEvents",
      "consentVersions",
      "userConsents",
      "legalAcceptances",
      "dataExportRequests",
      "dataExportJobs",
      "accountDeletionRequests",
      "accountDeletionReviews",
      "roleInvitations",
      "auditLog",
    ], { includeProfile: true });
  }
''',
    "account lifecycle transaction profile",
)

repo = replace_once(
    repo,
    '''  async saveAiConversation(session, conversation, messages) {
    const state = await this.loadState(session);
    const conversationIndex = state.aiConversations.findIndex((item) => item.id === conversation.id);
    if (conversationIndex >= 0) state.aiConversations[conversationIndex] = conversation;
    else state.aiConversations.push(conversation);
    for (const message of messages) {
      const messageIndex = state.aiMessages.findIndex((item) => item.id === message.id);
      if (messageIndex >= 0) state.aiMessages[messageIndex] = message;
      else state.aiMessages.push(message);
    }
    await this.saveChangedCollections(session, state, ["aiConversations", "aiMessages"]);
  }
''',
    '''  async saveAiConversation(session, conversation, messages) {
    const state = ensureStateShape({
      studentProfile: initialStateForUser(session.user).studentProfile,
      aiConversations: conversation?.id ? [conversation] : [],
      aiMessages: (messages || []).filter((message) => message?.id),
    });
    await this.saveChangedCollections(session, state, ["aiConversations", "aiMessages"]);
  }
''',
    "AI persistence narrow write",
)

old_hard_delete = '''    const userFilter = `eq.${session.user.id}`;
    const deletes = sourceId ? [
      ["job_events", { user_id: userFilter, source_id: `eq.${sourceId}` }],
      ["background_jobs", { user_id: userFilter, source_id: `eq.${sourceId}` }],
      ["source_chunks", { user_id: userFilter, source_material_id: `eq.${sourceId}` }],
      ["embeddings_metadata", { user_id: userFilter, source_material_id: `eq.${sourceId}` }],
      ["source_materials", { user_id: userFilter, id: `eq.${sourceId}` }],
    ] : [];
    const memoryFilter = inFilter(memoryItemIds);
    if (memoryFilter) deletes.unshift(["memory_items", { user_id: userFilter, id: memoryFilter }]);
    const chunkFilter = inFilter(sourceChunkIds);
    if (chunkFilter) deletes.unshift(["source_chunks", { user_id: userFilter, id: chunkFilter }]);
    const embeddingFilter = inFilter(embeddingIds);
    if (embeddingFilter) deletes.unshift(["embeddings_metadata", { user_id: userFilter, id: embeddingFilter }]);
    const jobFilter = inFilter(jobIds);
    if (jobFilter) deletes.unshift(["background_jobs", { user_id: userFilter, id: jobFilter }]);
    const eventFilter = inFilter(jobEventIds);
    if (eventFilter) deletes.unshift(["job_events", { user_id: userFilter, id: eventFilter }]);
    const assignmentFilter = inFilter(assignmentIds);
    if (assignmentFilter) deletes.unshift(["assignments", { user_id: userFilter, id: assignmentFilter }]);
    const syllabusFilter = inFilter(syllabusIds);
    if (syllabusFilter) deletes.unshift(["syllabi", { user_id: userFilter, id: syllabusFilter }]);
    for (const [table, filters] of deletes) {
      await route.client.deleteRows(table, { filters });
    }
'''
new_hard_delete = '''    try {
      await route.client.rpc("delete_studentos_source_artifacts", {
        p_user_id: session.user.id,
        p_source_id: sourceId || null,
        p_memory_item_ids: memoryItemIds,
        p_source_chunk_ids: sourceChunkIds,
        p_embedding_ids: embeddingIds,
        p_job_ids: jobIds,
        p_job_event_ids: jobEventIds,
        p_assignment_ids: assignmentIds,
        p_syllabus_ids: syllabusIds,
      });
    } catch (error) {
      if (isMissingDatabaseObject(error)) throw transactionalPatchRequired(error);
      throw error;
    }
'''
repo = replace_once(repo, old_hard_delete, new_hard_delete, "transactional source artifact deletion")

wrapper_anchor = '''  async loadState(session) {
    return this.useSupabase(session) ? this.supabase.loadState(session) : this.mock.loadState(session);
  }

  async saveState(session, state) {'''
wrapper_replacement = '''  async loadState(session) {
    return this.useSupabase(session) ? this.supabase.loadState(session) : this.mock.loadState(session);
  }

  async loadDashboardState(session) {
    return this.useSupabase(session) ? this.supabase.loadDashboardState(session) : this.mock.loadDashboardState(session);
  }

  async loadAcademicContext(session) {
    return this.useSupabase(session) ? this.supabase.loadAcademicContext(session) : this.mock.loadAcademicContext(session);
  }

  async loadTestSession(session, testSessionId) {
    return this.useSupabase(session)
      ? this.supabase.loadTestSession(session, testSessionId)
      : this.mock.loadTestSession(session, testSessionId);
  }

  async loadAccountLifecycle(session) {
    return this.useSupabase(session) ? this.supabase.loadAccountLifecycle(session) : this.mock.loadAccountLifecycle(session);
  }

  async loadRecoveryState(session) {
    return this.useSupabase(session) ? this.supabase.loadRecoveryState(session) : this.mock.loadRecoveryState(session);
  }

  async loadAiState(session) {
    return this.useSupabase(session) ? this.supabase.loadAiState(session) : this.mock.loadAiState(session);
  }

  async saveProfile(session, state) {
    return this.useSupabase(session) ? this.supabase.saveProfile(session, state) : this.mock.saveProfile(session, state);
  }

  async saveState(session, state) {'''
repo = replace_once(repo, wrapper_anchor, wrapper_replacement, "repository public narrow methods")

wrapper_save_anchor = '''  async saveSourceIngestion(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveSourceIngestion(session, state)
      : this.mock.saveSourceIngestion(session, state);
  }

  async saveBackgroundJobs(session, state) {'''
wrapper_save_replacement = '''  async saveSourceIngestion(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveSourceIngestion(session, state)
      : this.mock.saveSourceIngestion(session, state);
  }

  async saveAcademicContext(session, state) {
    return this.useSupabase(session)
      ? this.supabase.saveAcademicContext(session, state)
      : this.mock.saveState(session, state);
  }

  async deleteCollectionRows(session, key, ids) {
    return this.useSupabase(session)
      ? this.supabase.deleteCollectionRows(session, key, ids)
      : this.mock.deleteCollectionRows(session, key, ids);
  }

  async archiveCollectionRows(session, key, records, options) {
    return this.useSupabase(session)
      ? this.supabase.archiveCollectionRows(session, key, records, options)
      : this.mock.archiveCollectionRows(session, key, records.map((item) => item?.id).filter(Boolean), options);
  }

  async saveBackgroundJobs(session, state) {'''
repo = replace_once(repo, wrapper_save_anchor, wrapper_save_replacement, "repository explicit mutations wrappers")
REPO.write_text(repo, encoding="utf-8")

server = SERVER.read_text(encoding="utf-8")
old_context = '''async function getStateContext(req) {
  const session = await getRequestSession(req, {
    config: supabaseConfig,
    authClient: supabaseClients.authClient,
  });
  const state = await repository.loadState(session);
  if (hydrateSavedProductOnboarding(state)) {
    await repository.saveState(session, state);
  }
  await ensureIndexedChunkEmbeddings(session, state);
  return {
    session,
    state,
    persistence: repository.getInfo(session),
  };
}
'''
new_context = '''function requestStateScope(req) {
  const pathname = new URL(req.url || "/", "http://studentos.local").pathname;
  if (pathname === "/api/state" || pathname.startsWith("/api/dashboard")) return "dashboard";
  if (pathname.startsWith("/api/account") || pathname.startsWith("/api/billing")) return "account_lifecycle";
  if (pathname.startsWith("/api/recovery")) return "recovery";
  if (pathname.startsWith("/api/ai")) return "ai";
  return "academic_context";
}

async function loadRequestState(session, scope) {
  if (scope === "dashboard") return repository.loadDashboardState(session);
  if (scope === "account_lifecycle") return repository.loadAccountLifecycle(session);
  if (scope === "recovery") return repository.loadRecoveryState(session);
  if (scope === "ai") return repository.loadAiState(session);
  return repository.loadAcademicContext(session);
}

async function getStateContext(req, { scope = null } = {}) {
  const session = await getRequestSession(req, {
    config: supabaseConfig,
    authClient: supabaseClients.authClient,
  });
  const resolvedScope = scope || requestStateScope(req);
  const state = await loadRequestState(session, resolvedScope);
  if (hydrateSavedProductOnboarding(state)) {
    await repository.saveProfile(session, state);
  }
  if (["academic_context", "ai"].includes(resolvedScope)) {
    await ensureIndexedChunkEmbeddings(session, state);
  }
  return {
    session,
    state,
    stateScope: resolvedScope,
    persistence: repository.getInfo(session),
  };
}
'''
server = replace_once(server, old_context, new_context, "server request scope loader")
server = server.replace('await repository.saveState(session, state);\n    return result;\n  } catch (error) {', 'await repository.saveAcademicContext(session, state);\n    return result;\n  } catch (error) {', 1)
server = replace_once(
    server,
    '''    const state = await repository.loadState(session);
    const result = processBillingWebhook({ state, event });
    await repository.saveState(session, state);''',
    '''    const state = await repository.loadAccountLifecycle(session);
    const result = processBillingWebhook({ state, event });
    await repository.saveAccountLifecycle(session, state);''',
    "billing webhook narrow state",
)
SERVER.write_text(server, encoding="utf-8")

migration = r'''-- H-02: narrow state loading and transactional state patches.
-- Apply identically to every StudentOS data shard.

create or replace function public.studentos_assert_state_owner(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and auth.uid() is distinct from p_user_id then
    raise exception 'STUDENTOS_STATE_UNAUTHORIZED' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.studentos_collection_table(p_collection text)
returns text
language sql
immutable
as $$
  select case p_collection
    when 'courses' then 'courses'
    when 'topics' then 'topics'
    when 'syllabi' then 'syllabi'
    when 'exams' then 'exams'
    when 'assignments' then 'assignments'
    when 'timetable' then 'timetable_events'
    when 'notes' then 'notes'
    when 'sourceMaterials' then 'source_materials'
    when 'sourceChunks' then 'source_chunks'
    when 'testSessions' then 'test_sessions'
    when 'testResults' then 'test_results'
    when 'creditLedger' then 'credit_ledger'
    when 'roadmap' then 'roadmap_items'
    when 'revisionEvents' then 'revision_events'
    when 'tutorLessons' then 'tutor_lessons'
    when 'assignmentAutomationContracts' then 'assignment_automation_contracts'
    when 'auditLog' then 'audit_logs'
    when 'aiConversations' then 'ai_conversations'
    when 'aiMessages' then 'ai_messages'
    when 'memoryItems' then 'memory_items'
    when 'embeddingsMetadata' then 'embeddings_metadata'
    when 'backgroundJobs' then 'background_jobs'
    when 'jobEvents' then 'job_events'
    when 'billingSubscriptions' then 'billing_subscriptions'
    when 'billingWebhookEvents' then 'billing_webhook_events'
    when 'consentVersions' then 'consent_versions'
    when 'userConsents' then 'user_consents'
    when 'legalAcceptances' then 'legal_acceptances'
    when 'dataExportRequests' then 'data_export_requests'
    when 'dataExportJobs' then 'data_export_jobs'
    when 'accountDeletionRequests' then 'account_deletion_requests'
    when 'accountDeletionReviews' then 'account_deletion_reviews'
    when 'roleInvitations' then 'role_invitations'
    when 'classroomItems' then 'classroom_items'
    when 'recoveryUserStates' then 'recovery_user_state'
    when 'academicEvents' then 'academic_events'
    when 'academicStateSnapshots' then 'academic_state_snapshots'
    when 'topicRecoveryStates' then 'topic_recovery_states'
    when 'topicRecoveryStateHistory' then 'topic_recovery_state_history'
    when 'recoveryRuns' then 'recovery_runs'
    when 'recoveryPreviews' then 'recovery_previews'
    when 'planVersions' then 'plan_versions'
    else null
  end;
$$;

create or replace function public.load_studentos_state_scope(
  p_user_id uuid,
  p_scope text,
  p_entity_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb := '{}'::jsonb;
  profile_payload jsonb;
  collection_key text;
  table_name text;
  values_payload jsonb;
  scope_keys text[];
begin
  perform public.studentos_assert_state_owner(p_user_id);
  select payload into profile_payload from public.student_profiles where user_id = p_user_id limit 1;
  result := jsonb_build_object('studentProfile', profile_payload);

  case lower(coalesce(p_scope, 'dashboard'))
    when 'dashboard' then scope_keys := array['courses','topics','syllabi','exams','assignments','timetable','notes','sourceMaterials','testSessions','testResults','creditLedger','roadmap','revisionEvents','tutorLessons','assignmentAutomationContracts','memoryItems','backgroundJobs','billingSubscriptions','dataExportRequests','dataExportJobs','accountDeletionRequests','classroomItems'];
    when 'academic_context' then scope_keys := array['courses','topics','syllabi','exams','assignments','timetable','notes','sourceMaterials','sourceChunks','testSessions','testResults','creditLedger','roadmap','revisionEvents','tutorLessons','assignmentAutomationContracts','memoryItems','embeddingsMetadata','backgroundJobs','jobEvents','billingSubscriptions','classroomItems'];
    when 'test_session' then scope_keys := array['courses','topics','assignments','testSessions','testResults','creditLedger','roadmap','revisionEvents','tutorLessons','assignmentAutomationContracts','auditLog'];
    when 'account_lifecycle' then scope_keys := array['billingSubscriptions','billingWebhookEvents','consentVersions','userConsents','legalAcceptances','dataExportRequests','dataExportJobs','accountDeletionRequests','accountDeletionReviews','roleInvitations','auditLog'];
    when 'recovery' then scope_keys := array['courses','topics','assignments','timetable','notes','sourceMaterials','testSessions','testResults','roadmap','revisionEvents','tutorLessons','backgroundJobs','auditLog','recoveryUserStates','academicEvents','academicStateSnapshots','topicRecoveryStates','topicRecoveryStateHistory','recoveryRuns','recoveryPreviews','planVersions'];
    when 'ai' then scope_keys := array['courses','topics','assignments','sourceMaterials','sourceChunks','testResults','creditLedger','roadmap','memoryItems','embeddingsMetadata','billingSubscriptions','classroomItems','aiConversations','aiMessages'];
    when 'full' then scope_keys := array['courses','topics','syllabi','exams','assignments','timetable','notes','sourceMaterials','sourceChunks','testSessions','testResults','creditLedger','roadmap','revisionEvents','tutorLessons','assignmentAutomationContracts','auditLog','aiConversations','aiMessages','memoryItems','embeddingsMetadata','backgroundJobs','jobEvents','billingSubscriptions','billingWebhookEvents','consentVersions','userConsents','legalAcceptances','dataExportRequests','dataExportJobs','accountDeletionRequests','accountDeletionReviews','roleInvitations','classroomItems','recoveryUserStates','academicEvents','academicStateSnapshots','topicRecoveryStates','topicRecoveryStateHistory','recoveryRuns','recoveryPreviews','planVersions'];
    else raise exception 'STUDENTOS_STATE_SCOPE_INVALID';
  end case;

  foreach collection_key in array scope_keys loop
    table_name := public.studentos_collection_table(collection_key);
    if table_name is null or to_regclass(format('public.%I', table_name)) is null then
      result := result || jsonb_build_object(collection_key, '[]'::jsonb);
      continue;
    end if;
    if p_entity_id is not null and collection_key = 'testSessions' then
      execute format('select coalesce(jsonb_agg(payload order by created_at), ''[]''::jsonb) from public.%I where user_id = $1 and id = $2', table_name)
        into values_payload using p_user_id, p_entity_id;
    elsif p_entity_id is not null and collection_key = 'testResults' then
      execute format('select coalesce(jsonb_agg(payload order by created_at), ''[]''::jsonb) from public.%I where user_id = $1 and (test_session_id = $2 or id = $2)', table_name)
        into values_payload using p_user_id, p_entity_id;
    else
      execute format('select coalesce(jsonb_agg(payload order by created_at), ''[]''::jsonb) from public.%I where user_id = $1', table_name)
        into values_payload using p_user_id;
    end if;
    result := result || jsonb_build_object(collection_key, coalesce(values_payload, '[]'::jsonb));
  end loop;
  return result;
end;
$$;

create or replace function public.persist_studentos_state_patch(
  p_user_id uuid,
  p_profile jsonb default null,
  p_collections jsonb default '{}'::jsonb,
  p_delete_ids jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  collection_key text;
  rows_payload jsonb;
  ids_payload jsonb;
  table_name text;
  update_assignments text;
  affected integer := 0;
begin
  perform public.studentos_assert_state_owner(p_user_id);
  if p_profile is not null then
    if p_profile->>'user_id' is distinct from p_user_id::text then raise exception 'STUDENTOS_STATE_OWNER_MISMATCH'; end if;
    select string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ' order by c.ordinal_position)
      into update_assignments
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'student_profiles' and c.column_name not in ('user_id','created_at');
    execute format('insert into public.student_profiles select * from jsonb_populate_record(null::public.student_profiles, $1) on conflict (user_id) do update set %s', update_assignments)
      using p_profile;
  end if;

  for collection_key, rows_payload in select key, value from jsonb_each(coalesce(p_collections, '{}'::jsonb)) loop
    table_name := public.studentos_collection_table(collection_key);
    if table_name is null or to_regclass(format('public.%I', table_name)) is null then raise exception 'STUDENTOS_COLLECTION_INVALID: %', collection_key; end if;
    if jsonb_typeof(rows_payload) <> 'array' then raise exception 'STUDENTOS_COLLECTION_ROWS_INVALID: %', collection_key; end if;
    if exists (select 1 from jsonb_array_elements(rows_payload) row_value where row_value->>'user_id' is distinct from p_user_id::text) then
      raise exception 'STUDENTOS_STATE_OWNER_MISMATCH: %', collection_key;
    end if;
    if jsonb_array_length(rows_payload) = 0 then continue; end if;
    select string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ' order by c.ordinal_position)
      into update_assignments
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = table_name and c.column_name not in ('id','created_at');
    execute format('insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (id) do update set %2$s', table_name, update_assignments)
      using rows_payload;
    affected := affected + jsonb_array_length(rows_payload);
  end loop;

  for collection_key, ids_payload in select key, value from jsonb_each(coalesce(p_delete_ids, '{}'::jsonb)) loop
    table_name := public.studentos_collection_table(collection_key);
    if table_name is null or to_regclass(format('public.%I', table_name)) is null then raise exception 'STUDENTOS_COLLECTION_INVALID: %', collection_key; end if;
    if jsonb_typeof(ids_payload) <> 'array' then raise exception 'STUDENTOS_DELETE_IDS_INVALID: %', collection_key; end if;
    execute format('delete from public.%I where user_id = $1 and id in (select jsonb_array_elements_text($2))', table_name)
      using p_user_id, ids_payload;
    get diagnostics affected = affected + row_count;
  end loop;
  return jsonb_build_object('persisted', true, 'affected', affected);
end;
$$;

create or replace function public.delete_studentos_source_artifacts(
  p_user_id uuid,
  p_source_id text default null,
  p_memory_item_ids text[] default '{}',
  p_source_chunk_ids text[] default '{}',
  p_embedding_ids text[] default '{}',
  p_job_ids text[] default '{}',
  p_job_event_ids text[] default '{}',
  p_assignment_ids text[] default '{}',
  p_syllabus_ids text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare deleted_count integer := 0; n integer;
begin
  perform public.studentos_assert_state_owner(p_user_id);
  delete from public.job_events where user_id = p_user_id and (source_id = p_source_id or id = any(p_job_event_ids)); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.background_jobs where user_id = p_user_id and (source_id = p_source_id or id = any(p_job_ids)); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.embeddings_metadata where user_id = p_user_id and (source_material_id = p_source_id or id = any(p_embedding_ids)); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.memory_items where user_id = p_user_id and id = any(p_memory_item_ids); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.source_chunks where user_id = p_user_id and (source_material_id = p_source_id or id = any(p_source_chunk_ids)); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.assignments where user_id = p_user_id and id = any(p_assignment_ids); get diagnostics n = row_count; deleted_count := deleted_count + n;
  delete from public.syllabi where user_id = p_user_id and id = any(p_syllabus_ids); get diagnostics n = row_count; deleted_count := deleted_count + n;
  if p_source_id is not null then delete from public.source_materials where user_id = p_user_id and id = p_source_id; get diagnostics n = row_count; deleted_count := deleted_count + n; end if;
  return jsonb_build_object('deleted', deleted_count);
end;
$$;

grant execute on function public.load_studentos_state_scope(uuid, text, text) to authenticated, service_role;
grant execute on function public.persist_studentos_state_patch(uuid, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.delete_studentos_source_artifacts(uuid, text, text[], text[], text[], text[], text[], text[], text[]) to authenticated, service_role;
'''
(ROOT / "supabase/migrations/202607280001_h02_narrow_state_repositories.sql").write_text(migration, encoding="utf-8")

h02_test = r'''import assert from "node:assert/strict";
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
assert.match(serverSource, /repository\.loadAccountLifecycle/);
assert.match(serverSource, /repository\.loadRecoveryState/);
assert.match(serverSource, /repository\.loadAcademicContext/);

const migration = await readFile(new URL("../supabase/migrations/202607280001_h02_narrow_state_repositories.sql", import.meta.url), "utf8");
assert.match(migration, /load_studentos_state_scope/);
assert.match(migration, /persist_studentos_state_patch/);
assert.match(migration, /delete_studentos_source_artifacts/);
assert.match(migration, /jsonb_populate_recordset/);

console.log("PASS | H-02 narrow state repositories and transactional mutation tests passed");
'''
(ROOT / "backend/testH02NarrowStateRepositories.js").write_text(h02_test, encoding="utf-8")

package = json.loads(PACKAGE.read_text(encoding="utf-8"))
package["scripts"]["test:h02-state-repositories"] = "node backend/testH02NarrowStateRepositories.js"
package["scripts"]["test"] = package["scripts"]["test"].replace("npm run test:h01-public-dto &&", "npm run test:h01-public-dto && npm run test:h02-state-repositories &&")
PACKAGE.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

plan = MIGRATION_PLAN.read_text(encoding="utf-8")
plan = replace_once(plan, '  "supabase/migrations/202607270001_c02_embedding_space_integrity.sql",\n', '  "supabase/migrations/202607270001_c02_embedding_space_integrity.sql",\n  "supabase/migrations/202607280001_h02_narrow_state_repositories.sql",\n', "migration plan")
MIGRATION_PLAN.write_text(plan, encoding="utf-8")

(ROOT / "docs/H02_NARROW_STATE_REPOSITORIES.md").write_text(r'''# H-02 Narrow state repositories

Normal HTTP requests no longer reconstruct the entire StudentOS account from every table. The repository exposes dashboard, academic-context, test-session, account-lifecycle, recovery, and AI scopes. In migrated Supabase shards each scope is returned by one RPC; before migration, the compatibility path queries only the selected tables and issues those reads concurrently.

Multi-collection writes use `persist_studentos_state_patch`, so the profile and all supplied collection rows commit or roll back together. Removing an item from an in-memory array is deliberately not treated as a database deletion. Call `deleteCollectionRows`, `archiveCollectionRows`, or a domain-specific delete operation explicitly.

Source-artifact database deletion is performed by a dedicated transactional RPC. Private object storage remains an external system and is deleted separately after the database transaction.

Apply `202607280001_h02_narrow_state_repositories.sql` identically to every StudentOS data shard before relying on transactional multi-collection writes in Supabase mode.
''', encoding="utf-8")
