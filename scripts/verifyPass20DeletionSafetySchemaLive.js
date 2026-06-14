import { randomUUID } from "node:crypto";
import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";

const REQUIRED_TABLES = [
  {
    table: "account_deletion_requests",
    columns: "id,final_execution_status,last_execution_evidence_id",
  },
  {
    table: "deletion_execution_evidence",
    columns: "id,deletion_request_id,evidence_type,status,approvals,dry_run_diff,affected_counts,billing_policy,auth_deletion",
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
    const rpcRows = await shard.client.rpc("claim_data_export_job_by_id", {
      p_job_id: `pass20_schema_probe_${randomUUID()}`,
      p_user_id: randomUUID(),
      p_worker_id: "studentos-pass20-schema-verifier",
    });
    shards.push({
      shard: shard.label,
      projectNumber: shard.projectNumber,
      tables,
      targetedClaimRpcRepairVerified: Array.isArray(rpcRows),
      mutationExpected: false,
    });
  }
  console.log(JSON.stringify({
    ok: true,
    migration: "202605250017_studentos_pass20_final_deletion_safety.sql",
    shards,
    finalDeletionEnabledByVerifier: false,
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
