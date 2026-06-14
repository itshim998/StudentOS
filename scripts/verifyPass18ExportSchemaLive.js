import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";

const REQUIRED_TABLES = [
  {
    table: "data_export_requests",
    columns: "id,package_size_bytes,package_sha256,ready_at,downloaded_at",
  },
  {
    table: "account_deletion_requests",
    columns: "id,dry_run_generated_at,dry_run_report",
  },
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
  if (!config.shardsConfigured) {
    throw new Error("StudentOS Supabase shard configuration is incomplete");
  }
  const clients = createSupabaseClients(config);
  const shards = [];
  for (const shard of clients.shardClients) {
    const tables = [];
    for (const definition of REQUIRED_TABLES) {
      await shard.client.select(definition.table, { columns: definition.columns, limit: 1 });
      tables.push({ table: definition.table, verified: true });
    }
    shards.push({
      shard: shard.label,
      projectNumber: shard.projectNumber,
      tables,
      claimRpcVerification: "deferred_to_isolated_live_export_verifier",
    });
  }
  console.log(JSON.stringify({
    ok: true,
    migration: "202605250015_studentos_pass18_export_worker_dry_run.sql",
    shards,
    secretsPrinted: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: safeError(error),
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
