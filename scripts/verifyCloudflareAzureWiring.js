const frontendUrl = String(process.env.STUDENTOS_PUBLIC_FRONTEND_URL || "https://studentos.sentiqlabs.com").trim();
const backendUrl = String(process.env.STUDENTOS_AZURE_API_URL || process.env.STUDENTOS_PUBLIC_API_BASE_URL || "").trim();
const expectedOrigin = String(process.env.STUDENTOS_EXPECTED_FRONTEND_ORIGIN || frontendUrl).trim().replace(/\/+$/, "");

function parseRequiredUrl(name, value) {
  if (!value) throw new Error(`${name} is required.`);
  const parsed = new URL(value);
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error(`${name} must use http or https.`);
  return parsed;
}

function safeUrl(value) {
  const parsed = new URL(value);
  return `${parsed.protocol}//${parsed.host}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { parseError: true };
  }
  return { response, body };
}

async function main() {
  const frontend = parseRequiredUrl("STUDENTOS_PUBLIC_FRONTEND_URL", frontendUrl);
  const backend = parseRequiredUrl("STUDENTOS_AZURE_API_URL", backendUrl);
  const origin = parseRequiredUrl("STUDENTOS_EXPECTED_FRONTEND_ORIGIN", expectedOrigin).origin;
  const healthUrl = new URL("/api/health", backend);
  const configUrl = new URL("/api/config", backend);

  const health = await fetchJson(healthUrl, { headers: { Origin: origin } });
  const config = await fetchJson(configUrl, { headers: { Origin: origin } });
  const corsOrigin = health.response.headers.get("access-control-allow-origin") || "";
  const ok = health.response.ok && config.response.ok && corsOrigin === origin;
  const result = {
    ok,
    frontendOrigin: frontend.origin,
    backendOrigin: backend.origin,
    healthStatus: health.response.status,
    configStatus: config.response.status,
    corsOriginMatches: corsOrigin === origin,
    corsOrigin: corsOrigin ? safeUrl(corsOrigin) : "missing",
    deploymentTarget: config.body?.deploymentTarget || "unknown",
    frontendServedByBackend: Boolean(config.body?.frontendServedByBackend),
    secretsPrinted: false,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, secretsPrinted: false }, null, 2));
  process.exit(1);
});
