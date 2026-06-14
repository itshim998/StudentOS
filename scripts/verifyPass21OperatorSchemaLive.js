import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";

const REQUIRED_TABLES = [
  {
    table: "operator_audit_events",
    columns: "id,target_user_id,request_id,operator_id,operator_role,action,note,metadata,created_at",
  },
  {
    table: "billing_cancellation_events",
    columns: "id,target_user_id,deletion_request_id,request_id,operator_id,provider,status,note,metadata,created_at",
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
  if (!config.shardsConfigured) throw new Error("StudentOS Supabase shard configuration is incomplete");
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
      mutationExpected: false,
    });
  }
  console.log(JSON.stringify({
    ok: true,
    migration: "202605250018_studentos_pass21_operator_rbac_monitoring.sql",
    shards,
    mutationExpected: false,
    outputMasked: true,
    secretsPrinted: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: safeError(error),
    outputMasked: true,
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
