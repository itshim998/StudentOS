import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";

const REQUIRED_TABLES = ["billing_subscriptions", "billing_webhook_events"];

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
  if (config.mode !== "supabase" || !config.shardsConfigured) {
    throw new Error("StudentOS Supabase shard configuration is incomplete");
  }
  const clients = createSupabaseClients(config);
  const shards = [];
  for (const shard of clients.shardClients) {
    const tables = [];
    for (const table of REQUIRED_TABLES) {
      await shard.client.select(table, { columns: "id", limit: 1 });
      tables.push({ table, verified: true });
    }
    shards.push({
      shard: shard.label,
      projectNumber: shard.projectNumber,
      tables,
    });
  }
  console.log(JSON.stringify({
    ok: true,
    migration: "202605250013_studentos_pass16_billing_entitlements.sql",
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
