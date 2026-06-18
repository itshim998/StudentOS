import { existsSync, readFileSync } from "node:fs";

const KEEPALIVE_PATH = "/rest/v1/studentos_keepalive?select=id,name&limit=1";
const AUTH_HEALTH_PATH = "/auth/v1/health";

const PROJECTS = [
  {
    label: "auth",
    urlVars: ["STUDENTOS_SUPABASE_URL_1", "STUDENTOS_AUTH_SUPABASE_URL"],
    keyVars: ["STUDENTOS_SUPABASE_ANON_KEY_1", "STUDENTOS_AUTH_SUPABASE_ANON_KEY"],
    authHealth: true,
  },
  {
    label: "data-shard-1",
    urlVars: ["STUDENTOS_SUPABASE_URL_2", "STUDENTOS_DATA_SHARD_1_URL"],
    keyVars: ["STUDENTOS_SUPABASE_ANON_KEY_2", "STUDENTOS_DATA_SHARD_1_ANON_KEY"],
  },
  {
    label: "data-shard-2",
    urlVars: ["STUDENTOS_SUPABASE_URL_3", "STUDENTOS_DATA_SHARD_2_URL"],
    keyVars: ["STUDENTOS_SUPABASE_ANON_KEY_3", "STUDENTOS_DATA_SHARD_2_ANON_KEY"],
  },
  {
    label: "data-shard-3",
    urlVars: ["STUDENTOS_SUPABASE_URL_4", "STUDENTOS_DATA_SHARD_3_URL"],
    keyVars: ["STUDENTOS_SUPABASE_ANON_KEY_4", "STUDENTOS_DATA_SHARD_3_ANON_KEY"],
  },
];

function loadDotEnv() {
  if (process.env.STUDENTOS_KEEPALIVE_SKIP_DOTENV === "true") return;

  try {
    const dotenvPath = ".env";
    if (!existsSync(dotenvPath)) return;

    for (const line of readFileSync(dotenvPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // GitHub Actions provides env directly; dotenv loading is only for local convenience.
  }
}

function firstValue(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return { name, value: value.trim() };
  }
  return { name: names[0], value: "" };
}

function redact(value) {
  return String(value || "")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted.jwt]")
    .replace(/apikey[=:][^\s]+/gi, "apikey=[redacted]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]");
}

function safeUrl(baseUrl, path) {
  try {
    return new URL(path, baseUrl.replace(/\/+$/, "")).toString();
  } catch {
    throw new Error("invalid_url");
  }
}

async function ping(path, project) {
  const url = safeUrl(project.url, path);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: project.anonKey,
        Authorization: `Bearer ${project.anonKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new Error("request_timeout");
    }
    throw new Error("request_failed");
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

async function verifyProject(project) {
  await ping(KEEPALIVE_PATH, project);
  if (project.authHealth) {
    await ping(AUTH_HEALTH_PATH, project);
  }
}

async function main() {
  loadDotEnv();

  const configured = PROJECTS.map((project) => {
    const url = firstValue(project.urlVars);
    const key = firstValue(project.keyVars);
    return {
      ...project,
      url: url.value,
      anonKey: key.value,
      missing: [
        !url.value ? url.name : null,
        !key.value ? key.name : null,
      ].filter(Boolean),
    };
  });

  const missing = configured.flatMap((project) => project.missing);
  if (missing.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      error: "Missing required keepalive environment variables",
      missing,
      secretsPrinted: false,
    }, null, 2));
    process.exit(1);
  }

  const results = [];
  for (const project of configured) {
    try {
      await verifyProject(project);
      console.log(`${project.label}: ok`);
      results.push({ label: project.label, ok: true });
    } catch (error) {
      console.error(`${project.label}: failed (${redact(error?.message || error)})`);
      results.push({ label: project.label, ok: false });
    }
  }

  const ok = results.every((result) => result.ok);
  console.log(JSON.stringify({
    ok,
    projects: results,
    authHealthChecked: true,
    secretsPrinted: false,
  }, null, 2));

  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: redact(error?.message || error),
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
