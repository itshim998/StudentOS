import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";
import { StudentOsRepository } from "../backend/repository/studentOsRepository.js";
import { getDataExportConfig } from "../backend/account/exportService.js";
import {
  runDataExportWorkerDaemon,
  runDataExportWorkerOnce,
  safeExportWorkerError,
} from "../backend/account/exportWorkerRuntime.js";

function argValue(name, fallback = "") {
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1] || fallback;
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const limit = Math.min(Number(argValue("--limit", "10")) || 10, 100);
  const intervalMs = Math.min(Number(argValue("--interval-ms", "5000")) || 5000, 60_000);
  const lockTimeoutSeconds = Math.min(Number(argValue("--lock-timeout", "600")) || 600, 3600);
  const maxLoopsRaw = argValue("--max-loops", "");
  const maxLoops = maxLoopsRaw ? Math.max(1, Number(maxLoopsRaw) || 1) : Infinity;
  const daemon = process.argv.includes("--daemon");
  const config = getSupabaseEnvironment();
  const exportConfig = getDataExportConfig(process.env, config);
  const clients = createSupabaseClients(config);
  const repository = new StudentOsRepository({ config, shardClients: clients.shardClients });
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const args = {
    repository,
    config,
    exportConfig,
    limit,
    lockTimeoutSeconds,
  };
  const result = daemon
    ? await runDataExportWorkerDaemon({
        ...args,
        intervalMs,
        maxLoops,
        shouldStop: () => stopping,
      })
    : await runDataExportWorkerOnce(args);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: safeExportWorkerError(error),
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
