import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";

export const AI_ROUTER_V2_CENTRAL_SCHEMA_VERSION = "202607220001";
export const AI_ROUTER_V2_SHARD_SCHEMA_VERSION = "202607220002";

const MIGRATIONS = Object.freeze({
  centralBaseline: new URL("../supabase/migrations/202607210001_studentos_ai_router_v2_central.sql", import.meta.url),
  shardBaseline: new URL("../supabase/migrations/202607210002_studentos_ai_router_v2_shards.sql", import.meta.url),
  centralRemediation: new URL("../supabase/migrations/202607220001_studentos_ai_router_v2_remediation_central.sql", import.meta.url),
  shardRemediation: new URL("../supabase/migrations/202607220002_studentos_ai_router_v2_remediation_shards.sql", import.meta.url),
});

const REQUIRED_CENTRAL_CAPABILITIES = Object.freeze([
  "global_primary_ring",
  "central_slot_health",
  "claim_token_cas",
  "stale_result_observability",
  "pollinations_transition_cas",
  "isolated_database_concurrency_test",
  "service_role_only",
]);
const REQUIRED_SHARD_CAPABILITIES = Object.freeze([
  "routed_usage_ledger",
  "idempotent_settlement",
  "nvidia_settlement",
  "service_role_only",
]);
const REQUIRED_SETTLEMENT_PROVIDERS = Object.freeze(["groq", "gemini", "nvidia", "pollinations"]);

function verificationFailure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function firstRow(value) {
  if (Array.isArray(value)) return value[0] || {};
  return value && typeof value === "object" ? value : {};
}

function stringSet(value) {
  return new Set(Array.isArray(value) ? value.map((item) => String(item)) : []);
}

function includesAll(actual, expected) {
  const values = stringSet(actual);
  return expected.every((item) => values.has(item));
}

export async function verifyAiRouterV2MigrationSources() {
  const sourceEntries = await Promise.all(Object.entries(MIGRATIONS).map(async ([name, url]) => [name, await readFile(url, "utf8")]));
  const sources = Object.fromEntries(sourceEntries);
  const markers = {
    centralBaseline: [
      "Project 1 (AUTH/shared) only", "ai_router_global_state", "ai_router_slots", "ai_router_operation_claims",
      "claim_ai_router_primary", "claim_ai_router_nvidia", "claim_ai_router_slot", "record_ai_router_success",
      "record_ai_router_failure", "reset_ai_router_slot", "claim_ai_router_pollinations_probe", "enter_ai_router_pollinations_mode",
      "leave_ai_router_pollinations_mode", "complete_ai_router_operation", "pg_advisory_xact_lock", "service_role",
    ],
    shardBaseline: ["Projects 2, 3, and 4 only", "ai_usage_ledger_routing_provider_check", "'nvidia'", "complete_routed_ai_operation", "service_role"],
    centralRemediation: [
      "Project 1 (AUTH/shared) only", "health_version", "claim_token", "stale_slot_result",
      "p_expected_state_version", "ai_router_v2_test_runs", "verify_ai_router_v2_schema",
      AI_ROUTER_V2_CENTRAL_SCHEMA_VERSION, "service_role",
    ],
    shardRemediation: [
      "Projects 2, 3, and 4 only", "verify_ai_router_v2_shard_schema", "nvidia_settlement",
      AI_ROUTER_V2_SHARD_SCHEMA_VERSION, "service_role",
    ],
  };
  const missing = Object.entries(markers).flatMap(([name, expected]) => (
    expected.filter((marker) => !sources[name].includes(marker)).map((marker) => `${name}:${marker}`)
  ));
  return {
    ok: missing.length === 0,
    missing,
    centralTarget: "Project 1 AUTH only",
    shardTarget: "Projects 2, 3, and 4",
    expectedSchemaVersions: { central: AI_ROUTER_V2_CENTRAL_SCHEMA_VERSION, shards: AI_ROUTER_V2_SHARD_SCHEMA_VERSION },
    secretsPrinted: false,
  };
}

export async function verifyAiRouterV2Live({ env = process.env, clientFactory = createSupabaseClients } = {}) {
  const config = getSupabaseEnvironment(env);
  if (config.requestedMode !== "supabase" || config.mode !== "supabase") {
    throw verificationFailure("live_requires_studentos_mode_supabase");
  }
  if (!config.auth.url || !config.auth.serviceRoleKey) throw verificationFailure("project_1_service_role_configuration_missing");
  if (config.shards.length !== 3 || config.shards.some((shard) => !shard.url || !shard.serviceRoleKey)) {
    throw verificationFailure("project_2_4_service_role_configuration_incomplete");
  }

  const clients = clientFactory(config);
  if (!clients?.routerClient?.isConfigured?.()) throw verificationFailure("project_1_service_role_client_unavailable");
  if (!Array.isArray(clients.shardClients) || clients.shardClients.length !== 3
    || clients.shardClients.some((shard) => !shard?.client?.isConfigured?.())) {
    throw verificationFailure("project_2_4_service_role_clients_unavailable");
  }

  let centralRow;
  try {
    centralRow = firstRow(await clients.routerClient.rpc("verify_ai_router_v2_schema"));
  } catch {
    throw verificationFailure("project_1_router_schema_verification_rpc_failed");
  }
  if (centralRow.schema_version !== AI_ROUTER_V2_CENTRAL_SCHEMA_VERSION
    || centralRow.target !== "project_1_auth_shared"
    || !includesAll(centralRow.capabilities, REQUIRED_CENTRAL_CAPABILITIES)) {
    throw verificationFailure("project_1_router_schema_capabilities_incomplete");
  }

  const shardRows = [];
  for (const shard of clients.shardClients) {
    let row;
    try {
      row = firstRow(await shard.client.rpc("verify_ai_router_v2_shard_schema"));
    } catch {
      throw verificationFailure(`project_${Number(shard.projectNumber || 0)}_router_schema_verification_rpc_failed`);
    }
    if (row.schema_version !== AI_ROUTER_V2_SHARD_SCHEMA_VERSION
      || row.target !== "data_shard"
      || !includesAll(row.capabilities, REQUIRED_SHARD_CAPABILITIES)
      || !includesAll(row.settlement_providers, REQUIRED_SETTLEMENT_PROVIDERS)) {
      throw verificationFailure(`project_${Number(shard.projectNumber || 0)}_router_schema_capabilities_incomplete`);
    }
    shardRows.push({ projectNumber: Number(shard.projectNumber), confirmed: true, schemaVersion: row.schema_version, nvidiaSettlement: true });
  }

  return {
    checked: true,
    ok: true,
    sourceOnlyFallback: false,
    central: { confirmed: true, projectNumber: 1, schemaVersion: centralRow.schema_version, capabilitiesConfirmed: true },
    shards: shardRows,
    shardCount: shardRows.length,
    allDataShardsConfirmed: shardRows.length === 3 && shardRows.every((shard) => shard.confirmed),
    nvidiaSettlementConfirmed: shardRows.length === 3 && shardRows.every((shard) => shard.nvidiaSettlement),
  };
}

export async function verifyAiRouterV2Migrations({ liveRequested = false, env = process.env, clientFactory = createSupabaseClients } = {}) {
  const source = await verifyAiRouterV2MigrationSources();
  let live = { checked: false, ok: true, reason: "live_check_not_requested", sourceOnlyFallback: true };
  if (liveRequested) {
    try {
      live = await verifyAiRouterV2Live({ env, clientFactory });
    } catch (error) {
      live = { checked: false, ok: false, reason: error?.code || "live_schema_verification_failed", sourceOnlyFallback: false };
    }
  }
  return {
    ...source,
    ok: source.ok && (!liveRequested || (
      live.checked === true
      && live.ok === true
      && live.central?.confirmed === true
      && live.allDataShardsConfirmed === true
      && live.shardCount === 3
      && live.nvidiaSettlementConfirmed === true
      && live.sourceOnlyFallback === false
    )),
    live,
  };
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const result = await verifyAiRouterV2Migrations({ liveRequested: process.argv.includes("--live") });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(() => {
    console.error(JSON.stringify({ ok: false, error: "migration_verification_failed", secretsPrinted: false }, null, 2));
    process.exit(1);
  });
}
