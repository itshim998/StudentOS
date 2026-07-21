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
const baseline001Only = process.argv.includes("--baseline-001");

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
    if (!baseline001Only) requiredRpcs.push("persist_recovery_changes", "recovery_permission_posture");
    for (const rpc of requiredRpcs) {
      if (!openapi?.paths?.[`/rpc/${rpc}`]) throw new Error(`Required recovery RPC is missing: ${rpc}`);
    }
    let permissionPosture = null;
    if (!baseline001Only) {
      permissionPosture = await shard.client.rpc("recovery_permission_posture", {});
      const rows = Array.isArray(permissionPosture) ? permissionPosture : [];
      if (rows.length !== REQUIRED_TABLES.length) throw new Error("Recovery permission posture did not cover every authority table");
      for (const row of rows) {
        if (row.authenticated_select || row.authenticated_insert || row.authenticated_update || row.authenticated_delete ||
            !row.service_role_select || !row.service_role_insert || !row.service_role_update || !row.service_role_delete) {
          throw new Error(`Recovery permission posture is unsafe for ${row.recovery_table}`);
        }
      }
    }
    shards.push({
      shard: shard.label,
      projectNumber: shard.projectNumber,
      tables,
      recoveryJobTypeQueryVerified: true,
      serviceRoleRpcPathsVerified: requiredRpcs,
      permissionHardeningVerified: !baseline001Only,
    });
  }
  console.log(JSON.stringify({
    ok: true,
    verificationMode: baseline001Only ? "migration_001_baseline_only" : "migration_002_hardened",
    migration: baseline001Only
      ? "202607190001_studentos_adaptive_recovery_engine.sql"
      : "202607190002_studentos_adaptive_recovery_hardening.sql",
    hardeningDeployed: !baseline001Only,
    shards,
    secretsPrinted: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: safeError(error), secretsPrinted: false }, null, 2));
  process.exit(1);
});
