import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";
import { StudentOsRepository } from "../backend/repository/studentOsRepository.js";
import { runExportRetentionCleanup } from "../backend/account/exportRetentionService.js";

function safeError(error) {
  return String(error?.message || error || "export_retention_cleanup_failed")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .replace(/apikey[A-Za-z0-9._:= -]*/gi, "apikey=[redacted]")
    .slice(0, 180);
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const config = getSupabaseEnvironment();
  const clients = createSupabaseClients(config);
  const repository = new StudentOsRepository({ config, shardClients: clients.shardClients });
  const result = await runExportRetentionCleanup({
    repository,
    config,
    limit: Math.min(Number(process.argv[2]) || 100, 500),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: safeError(error),
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
