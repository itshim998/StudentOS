import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";

const REQUIRED_TABLES = [
  "recovery_user_state",
  "academic_events",
  "academic_state_snapshots",
  "topic_recovery_states",
  "topic_recovery_state_history",
  "recovery_runs",
  "recovery_previews",
  "plan_versions",
];

function safeError(error) {
  return String(error?.message || error || "Unknown error")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted.jwt]")
    .replace(/service[_-]?role[A-Za-z0-9._-]*/gi, "[redacted.service-role]")
    .replace(/apikey[A-Za-z0-9._:= -]*/gi, "apikey=[redacted]")
    .slice(0, 240);
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const config = getSupabaseEnvironment();
  if (!config.shardsConfigured) throw new Error("StudentOS Supabase shard configuration is incomplete");
  const clients = createSupabaseClients(config);
  const shards = [];
  for (const shard of clients.shardClients) {
    const tables = [];
    for (const table of REQUIRED_TABLES) {
      await shard.client.select(table, { columns: "id,user_id,payload,created_at,updated_at", limit: 1 });
      tables.push({ table, verified: true });
    }
    await shard.client.select("background_jobs", {
      columns: "id,job_type",
      filters: { job_type: "eq.recovery_analysis" },
      limit: 1,
    });
    const schemaResponse = await fetch(`${shard.client.url}/rest/v1/`, {
      headers: shard.client.headers({ Accept: "application/openapi+json" }),
    });
    if (!schemaResponse.ok) throw new Error(`Recovery OpenAPI schema check failed with ${schemaResponse.status}`);
    const openapi = await schemaResponse.json();
    const requiredRpcs = ["acquire_recovery_mutation_lease", "release_recovery_mutation_lease", "apply_recovery_preview"];
    for (const rpc of requiredRpcs) {
      if (!openapi?.paths?.[`/rpc/${rpc}`]) throw new Error(`Required recovery RPC is missing: ${rpc}`);
    }
    shards.push({
      shard: shard.label,
      projectNumber: shard.projectNumber,
      tables,
      recoveryJobTypeQueryVerified: true,
      serviceRoleRpcPathsVerified: requiredRpcs,
    });
  }
  console.log(JSON.stringify({
    ok: true,
    migration: "202607190001_studentos_adaptive_recovery_engine.sql",
    shards,
    secretsPrinted: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: safeError(error), secretsPrinted: false }, null, 2));
  process.exit(1);
});
