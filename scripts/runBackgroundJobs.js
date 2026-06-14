import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";
import { StudentOsRepository } from "../backend/repository/studentOsRepository.js";
import { runWorkerDaemon, runWorkerOnce, safeWorkerError } from "../backend/jobs/workerRuntime.js";

function argValue(name, fallback = "") {
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1] || fallback;
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const limit = Math.min(Number(argValue("--limit", "25")) || 25, 100);
  const intervalMs = Math.min(Number(argValue("--interval-ms", "5000")) || 5000, 60_000);
  const lockTimeoutSeconds = Math.min(Number(argValue("--lock-timeout", "600")) || 600, 3600);
  const maxLoopsRaw = argValue("--max-loops", "");
  const maxLoops = maxLoopsRaw ? Math.max(1, Number(maxLoopsRaw) || 1) : Infinity;
  const daemon = process.argv.includes("--daemon");
  const config = getSupabaseEnvironment();
  const clients = createSupabaseClients(config);
  const repository = new StudentOsRepository({
    config,
    shardClients: clients.shardClients,
  });
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  if (daemon) {
    const result = await runWorkerDaemon({
      repository,
      config,
      intervalMs,
      limit,
      lockTimeoutSeconds,
      maxLoops,
      shouldStop: () => stopping,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = await runWorkerOnce({
    repository,
    config,
    limit,
    lockTimeoutSeconds,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: safeWorkerError(error),
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
