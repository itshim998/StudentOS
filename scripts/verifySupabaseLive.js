import { randomUUID } from "node:crypto";
import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";
import { publicShardRoute, routeUserToShard } from "../backend/supabase/shardRouter.js";

const REQUIRED_TABLES = [
  "student_profiles",
  "courses",
  "topics",
  "syllabi",
  "exams",
  "assignments",
  "timetable_events",
  "notes",
  "source_materials",
  "source_chunks",
  "test_sessions",
  "test_results",
  "credit_ledger",
  "ai_usage_ledger",
  "roadmap_items",
  "revision_events",
  "tutor_lessons",
  "assignment_automation_contracts",
  "audit_logs",
  "ai_conversations",
  "ai_messages",
  "memory_items",
  "embeddings_metadata",
];

function redactError(error) {
  return String(error?.message || error || "Unknown error")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted.jwt]")
    .replace(/service_role[A-Za-z0-9._-]*/gi, "[redacted.service-role]")
    .replace(/apikey[A-Za-z0-9._:= -]*/gi, "apikey=[redacted]");
}

function assertOk(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.safe = true;
    throw error;
  }
}

async function parseJson(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body?.message || body?.error_description || body?.error || `HTTP ${response.status}`);
  }
  return body;
}

async function authAdminRequest(config, path, { method = "GET", body } = {}) {
  const response = await fetch(`${config.auth.url.replace(/\/+$/, "")}/auth/v1${path}`, {
    method,
    headers: {
      apikey: config.auth.serviceRoleKey,
      Authorization: `Bearer ${config.auth.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseJson(response);
}

async function signIn(config, email, password) {
  const response = await fetch(`${config.auth.url.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.auth.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  return parseJson(response);
}

async function apiRequest(apiBase, path, token, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBase.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseJson(response);
}

async function verifyTables(shardClients) {
  const verified = [];
  for (const shard of shardClients) {
    const tables = [];
    for (const table of REQUIRED_TABLES) {
      await shard.client.select(table, { columns: "*", limit: 1 });
      tables.push(table);
    }
    verified.push({
      shard: shard.label,
      projectNumber: shard.projectNumber,
      tableCount: tables.length,
      tables,
    });
  }
  return verified;
}

async function verifyPersistedRows(route, userId) {
  const checks = [
    ["student_profiles", "profile"],
    ["test_results", "test result"],
    ["credit_ledger", "credit ledger entry"],
    ["ai_usage_ledger", "AI usage entry"],
    ["assignment_automation_contracts", "assignment contract"],
    ["ai_conversations", "AI conversation"],
    ["ai_messages", "AI message"],
  ];
  const found = {};
  for (const [table, label] of checks) {
    const rows = await route.client.select(table, {
      columns: "*",
      filters: { user_id: `eq.${userId}` },
      limit: 1,
    });
    assertOk(rows.length > 0, `Missing persisted ${label} in ${table}`);
    found[table] = rows.length;
  }
  return found;
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const config = getSupabaseEnvironment();
  assertOk(config.mode === "supabase", "STUDENTOS_MODE must resolve to supabase for live verification");
  assertOk(config.authConfigured, "Auth project env is incomplete");
  assertOk(config.shardsConfigured, "Data shard env is incomplete");
  assertOk(Boolean(config.auth.serviceRoleKey), "Auth project service role key is required for live test user creation");

  const clients = createSupabaseClients(config);
  const apiBase = process.env.STUDENTOS_API_BASE || "http://127.0.0.1:3101";

  await authAdminRequest(config, "/admin/users?page=1&per_page=1");
  const tableVerification = await verifyTables(clients.shardClients);

  const email = `studentos-live-${Date.now()}-${randomUUID().slice(0, 8)}@example.invalid`;
  const password = `${randomUUID()}A1!`;
  const adminUser = await authAdminRequest(config, "/admin/users", {
    method: "POST",
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        studentos_live_verifier: true,
      },
    },
  });
  assertOk(adminUser?.id, "Could not create live verification auth user");

  const session = await signIn(config, email, password);
  assertOk(session?.access_token, "Could not exchange test credentials for Supabase access token");

  const firstRoute = routeUserToShard(adminUser.id, clients.shardClients);
  const secondRoute = routeUserToShard(adminUser.id, clients.shardClients);
  assertOk(firstRoute.label === secondRoute.label, "Shard routing was not stable for the test user");

  const appConfig = await apiRequest(apiBase, "/api/config", session.access_token);
  assertOk(appConfig.storageMode === "supabase", "StudentOS API is not running in Supabase mode");
  assertOk(appConfig.auth?.enabled === true, "StudentOS API did not expose Auth project login config in Supabase mode");

  const bootstrap = await apiRequest(apiBase, "/api/bootstrap", session.access_token);
  assertOk(bootstrap.persistence?.mode === "supabase", "Bootstrap did not use Supabase persistence");
  assertOk(bootstrap.persistence?.shard?.label === firstRoute.label, "Bootstrap shard label did not match router");

  const score = await apiRequest(apiBase, "/api/tests/score", session.access_token, {
    method: "POST",
    body: {
      courseId: "course_alg2",
      topicId: "topic_quadratics",
      type: "mcq",
      answers: ["A", "B", "C", "D"],
      answerKey: ["A", "B", "C", "X"],
    },
  });
  assertOk(score.result?.scorePercent === 75, "Test scoring endpoint did not return expected MCQ score");
  assertOk(score.creditEntry?.amount === 1, "Credit ledger entry was not created by test scoring");

  const contract = await apiRequest(apiBase, "/api/assignment-contract", session.access_token, {
    method: "POST",
    body: {
      assignmentId: "assign_quad_ws",
    },
  });
  assertOk(contract.contract?.studentReviewRequired === true, "Assignment contract did not require student review");
  assertOk(contract.contract?.realSubmissionAllowed === false, "Assignment contract allowed real submission");

  const ai = await apiRequest(apiBase, "/api/ai/verb", session.access_token, {
    method: "POST",
    body: {
      verb: "Plan",
      message: "Build a safe plan from my due work and weak topics.",
    },
  });
  assertOk(ai.verb === "Plan", "AI verb endpoint did not return Plan output");

  const persisted = await verifyPersistedRows(firstRoute, adminUser.id);

  console.log(JSON.stringify({
    ok: true,
    mode: "supabase",
    authProject: {
      connectivity: "verified",
      testUserCreated: true,
      email: "[redacted-test-email]",
    },
    routedShard: publicShardRoute(firstRoute),
    stableRouting: {
      verified: true,
      repeatedRoute: secondRoute.label,
    },
    tablesVerified: tableVerification,
    endpointsVerified: [
      "GET /api/config",
      "GET /api/bootstrap",
      "POST /api/tests/score",
      "POST /api/assignment-contract",
      "POST /api/ai/verb",
    ],
    persistedRowsVerified: persisted,
    secretsPrinted: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: redactError(error),
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
