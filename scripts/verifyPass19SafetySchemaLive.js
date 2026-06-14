import { randomUUID } from "node:crypto";
import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";

const REQUIRED_TABLES = [
  {
    table: "data_export_requests",
    columns: "id,retention_expires_at,package_deleted_at,cleanup_status",
  },
  {
    table: "account_deletion_reviews",
    columns: "id,deletion_request_id,review_type,decision,operator_id,operator_note,dry_run_diff",
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
    let targetedClaimRpcVerified = false;
    let targetedClaimRpcStatus = "verified";
    try {
      const rpcRows = await shard.client.rpc("claim_data_export_job_by_id", {
        p_job_id: `pass19_schema_probe_${randomUUID()}`,
        p_user_id: randomUUID(),
        p_worker_id: "studentos-pass19-schema-verifier",
      });
      targetedClaimRpcVerified = Array.isArray(rpcRows);
    } catch (error) {
      targetedClaimRpcStatus = safeError(error);
    }
    shards.push({
      shard: shard.label,
      projectNumber: shard.projectNumber,
      tables,
      targetedClaimRpcVerified,
      targetedClaimRpcStatus,
      mutationExpected: false,
    });
  }
  console.log(JSON.stringify({
    ok: shards.every((shard) => shard.tables.every((table) => table.verified)),
    migration: "202605250016_studentos_pass19_operator_review_retention.sql",
    shards,
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
