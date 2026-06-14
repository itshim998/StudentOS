import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";
import { routeUserToShard } from "../backend/supabase/shardRouter.js";

const DISPOSABLE_E2E_EMAIL_RE = /^studentos\.e2e\.[^@]+@example\.com$/i;
const DELETE_ENABLED = ["1", "true", "yes"].includes(String(process.env.STUDENTOS_E2E_DELETE_STALE_USERS || "").toLowerCase());
const MIN_AGE_HOURS = Number(process.env.STUDENTOS_E2E_STALE_USER_MIN_AGE_HOURS || 24);
const USER_TABLES_FOR_CLEANUP = [
  "monitoring_alert_events",
  "billing_cancellation_events",
  "operator_audit_events",
  "deletion_execution_evidence",
  "data_export_jobs",
  "data_export_requests",
  "account_deletion_reviews",
  "account_deletion_requests",
  "role_invitations",
  "legal_acceptances",
  "user_consents",
  "billing_webhook_events",
  "billing_subscriptions",
  "job_events",
  "background_jobs",
  "embeddings_metadata",
  "memory_items",
  "ai_messages",
  "ai_conversations",
  "audit_logs",
  "assignment_automation_contracts",
  "tutor_lessons",
  "revision_events",
  "roadmap_items",
  "credit_ledger",
  "test_results",
  "test_sessions",
  "source_chunks",
  "source_materials",
  "notes",
  "timetable_events",
  "assignments",
  "exams",
  "syllabi",
  "topics",
  "courses",
  "student_profiles",
];

function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(access[_-]?token|refresh[_-]?token|service[_-]?role|client[_-]?secret|api[_-]?key|password)([=:]\s*)[^\s"']+/gi, "$1$2[redacted]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted.jwt]");
}

function maskEmail(email) {
  const value = String(email || "");
  const match = value.match(/^([^@]+)@(.+)$/);
  if (!match) return "[masked-email]";
  return `${match[1].slice(0, 15)}...[masked]...${match[1].slice(-4)}@${match[2]}`;
}

function maskId(id) {
  const value = String(id || "");
  return value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : "[masked-id]";
}

function isDisposableUser(user) {
  return Boolean(user?.id && DISPOSABLE_E2E_EMAIL_RE.test(String(user.email || "")));
}

function isOlderThanMinimum(user) {
  const created = Date.parse(user.created_at || user.createdAt || "");
  if (!Number.isFinite(created)) return true;
  return Date.now() - created >= MIN_AGE_HOURS * 60 * 60 * 1000;
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${redact(body?.message || body?.error || text)}`);
  }
  return body;
}

async function listAuthUsers(config) {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(`${config.auth.url.replace(/\/+$/, "")}/auth/v1/admin/users?page=${page}&per_page=100`, {
      method: "GET",
      headers: {
        apikey: config.auth.serviceRoleKey,
        Authorization: `Bearer ${config.auth.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
    });
    const body = await parseJsonResponse(response, "list disposable Supabase users");
    const pageUsers = Array.isArray(body?.users) ? body.users : Array.isArray(body) ? body : [];
    users.push(...pageUsers);
    if (pageUsers.length < 100) break;
  }
  return users;
}

async function safeSelect(client, table, userId, columns = "id,storage_bucket,storage_path", limit = 500) {
  try {
    return await client.select(table, { columns, filters: { user_id: `eq.${userId}` }, limit });
  } catch {
    return [];
  }
}

async function cleanupShardRows(route, user) {
  if (!isDisposableUser(user)) return { skipped: true, reason: "not_disposable_test_user", rowTablesAttempted: 0, storage: [] };
  const client = route?.client;
  if (!client) return { skipped: true, reason: "missing_shard_client", rowTablesAttempted: 0, storage: [] };
  const sourceRows = await safeSelect(client, "source_materials", user.id);
  const exportRows = await safeSelect(client, "data_export_requests", user.id);
  const storageByBucket = new Map();
  for (const row of [...sourceRows, ...exportRows]) {
    if (!row?.storage_bucket || !row?.storage_path) continue;
    const paths = storageByBucket.get(row.storage_bucket) || [];
    paths.push(row.storage_path);
    storageByBucket.set(row.storage_bucket, paths);
  }
  const storage = [];
  for (const [bucket, paths] of storageByBucket.entries()) {
    try {
      await client.deleteObjects(bucket, paths);
      storage.push({ bucket, count: paths.length, deleted: true });
    } catch (error) {
      storage.push({ bucket, count: paths.length, deleted: false, error: redact(error?.message) });
    }
  }
  let rowErrors = 0;
  for (const table of USER_TABLES_FOR_CLEANUP) {
    const column = ["operator_audit_events", "monitoring_alert_events", "billing_cancellation_events", "deletion_execution_evidence"].includes(table) ? "target_user_id" : "user_id";
    try {
      await client.deleteRows(table, { filters: { [column]: `eq.${user.id}` } });
    } catch {
      rowErrors += 1;
    }
  }
  return { skipped: false, reason: rowErrors ? "completed_with_row_errors" : "completed", rowTablesAttempted: USER_TABLES_FOR_CLEANUP.length, storage, rowErrors };
}

loadDotEnv({ cwd: process.cwd() });
const config = getSupabaseEnvironment(process.env);
if (config.mode !== "supabase" || !config.auth.serviceRoleKey) {
  console.log(JSON.stringify({ ok: false, reason: "supabase_service_role_not_configured", deleteEnabled: DELETE_ENABLED }, null, 2));
  process.exit(DELETE_ENABLED ? 1 : 0);
}

const clients = createSupabaseClients(config);
const users = (await listAuthUsers(config))
  .filter(isDisposableUser)
  .filter(isOlderThanMinimum)
  .map((user) => ({ id: user.id, email: user.email, created_at: user.created_at }));

const summary = {
  ok: true,
  deleteEnabled: DELETE_ENABLED,
  minAgeHours: MIN_AGE_HOURS,
  matchedUsers: users.length,
  users: [],
};

for (const user of users) {
  const route = routeUserToShard(user.id, clients.shardClients);
  const item = {
    emailMasked: maskEmail(user.email),
    userIdMasked: maskId(user.id),
    shardLabel: route.label,
    cleanup: { skipped: true, reason: DELETE_ENABLED ? "not_started" : "delete_flag_not_set" },
    authDeleted: false,
  };
  if (DELETE_ENABLED) {
    item.cleanup = await cleanupShardRows(route, user);
    try {
      await clients.authClient.adminDeleteUser(user.id);
      item.authDeleted = true;
    } catch (error) {
      item.authDeleted = false;
      item.authDeleteError = redact(error?.message || error);
    }
  }
  summary.users.push(item);
}

console.log(JSON.stringify(summary, null, 2));
