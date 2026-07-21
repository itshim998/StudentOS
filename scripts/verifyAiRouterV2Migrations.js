import { readFile } from "node:fs/promises";
import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";

const CENTRAL_PATH = new URL("../supabase/migrations/202607210001_studentos_ai_router_v2_central.sql", import.meta.url);
const SHARD_PATH = new URL("../supabase/migrations/202607210002_studentos_ai_router_v2_shards.sql", import.meta.url);

export async function verifyAiRouterV2MigrationSources() {
  const [central, shards] = await Promise.all([readFile(CENTRAL_PATH, "utf8"), readFile(SHARD_PATH, "utf8")]);
  const centralMarkers = [
    "Project 1 (AUTH/shared) only", "ai_router_global_state", "ai_router_slots", "ai_router_operation_claims",
    "claim_ai_router_primary", "claim_ai_router_nvidia", "claim_ai_router_slot", "record_ai_router_success",
    "record_ai_router_failure", "reset_ai_router_slot", "claim_ai_router_pollinations_probe", "enter_ai_router_pollinations_mode",
    "leave_ai_router_pollinations_mode", "complete_ai_router_operation", "pg_advisory_xact_lock", "service_role",
  ];
  const shardMarkers = ["Projects 2, 3, and 4 only", "ai_usage_ledger_routing_provider_check", "'nvidia'", "complete_routed_ai_operation", "service_role"];
  const missing = [
    ...centralMarkers.filter((marker) => !central.includes(marker)).map((marker) => `central:${marker}`),
    ...shardMarkers.filter((marker) => !shards.includes(marker)).map((marker) => `shards:${marker}`),
  ];
  return { ok: missing.length === 0, missing, centralTarget: "Project 1 AUTH only", shardTarget: "Projects 2, 3, and 4", secretsPrinted: false };
}

async function verifyLive() {
  const config = getSupabaseEnvironment();
  const clients = createSupabaseClients(config);
  if (config.mode !== "supabase" || !clients.routerClient.isConfigured()) return { checked: false, reason: "supabase_service_roles_not_configured" };
  await clients.routerClient.select("ai_router_global_state", { columns: "singleton,primary_cursor,nvidia_cursor,version", limit: 1 });
  await Promise.all(clients.shardClients.map((shard) => shard.client.select("ai_usage_ledger", { columns: "routing_primary_provider,routing_final_provider", limit: 1 })));
  return { checked: true, central: true, shardCount: clients.shardClients.length };
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const source = await verifyAiRouterV2MigrationSources();
  const live = process.argv.includes("--live") ? await verifyLive() : { checked: false, reason: "live_check_not_requested" };
  const result = { ...source, live };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || "migration_verification_failed").slice(0, 160), secretsPrinted: false }, null, 2));
  process.exit(1);
});
