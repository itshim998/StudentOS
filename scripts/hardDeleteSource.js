import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";
import { StudentOsRepository } from "../backend/repository/studentOsRepository.js";
import { sanitizeLogText } from "../backend/jobs/jobObservability.js";
import { buildSourceCleanupPlan } from "../backend/storage/sourceCleanupService.js";

function argValue(name) {
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1] || "";
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const userId = argValue("--user-id");
  const sourceId = argValue("--source-id");
  if (!userId || !sourceId) throw new Error("usage: node scripts/hardDeleteSource.js --user-id=<uuid> --source-id=<source_id>");
  const config = getSupabaseEnvironment();
  const clients = createSupabaseClients(config);
  const repository = new StudentOsRepository({ config, shardClients: clients.shardClients });
  const session = {
    authenticated: config.mode === "supabase",
    mode: config.mode === "supabase" ? "supabase_cleanup" : "local_cleanup",
    user: { id: userId, email: "cleanup@studentos.local" },
  };
  const state = await repository.loadState(session);
  const plan = buildSourceCleanupPlan(state, sourceId);
  if (!plan) throw new Error("source_not_found");
  const result = await repository.hardDeleteSourceArtifacts(session, plan);
  console.log(JSON.stringify({
    ok: true,
    sourceId,
    mode: config.mode,
    cleanup: {
      chunks: plan.sourceChunkIds.length,
      memoryItems: plan.memoryItemIds.length,
      embeddings: plan.embeddingIds.length,
      jobs: plan.jobIds.length,
      jobEvents: plan.jobEventIds.length,
    },
    storageObjectDeleteRequested: result.storageObjectDeleteRequested,
    secretsPrinted: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: sanitizeLogText(error?.message || error),
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
