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
  const contentType = response.headers.get("content-type") || "";
  const returnedHtml = contentType.includes("text/html") || /^\s*<!doctype\s+html/i.test(text) || /^\s*<html[\s>]/i.test(text);
  let body = {};
  try {
    body = text && !returnedHtml ? JSON.parse(text) : {};
  } catch {
    body = { parseError: true };
  }
  return { response, body, returnedHtml };
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { response, text };
}

async function main() {
  const frontend = parseRequiredUrl("STUDENTOS_PUBLIC_FRONTEND_URL", frontendUrl);
  const backend = parseRequiredUrl("STUDENTOS_AZURE_API_URL", backendUrl);
  const origin = parseRequiredUrl("STUDENTOS_EXPECTED_FRONTEND_ORIGIN", expectedOrigin).origin;
  const healthUrl = new URL("/api/health", backend);
  const configUrl = new URL("/api/config", backend);
  const aiUrl = new URL("/api/ai/verb", backend);
  const runtimeConfigUrl = new URL("/runtime-config.js", frontend);
  const authCompletionUrl = new URL("/auth/complete", frontend);

  const frontendPage = await fetchText(frontend);
  const runtimeConfig = await fetchText(runtimeConfigUrl);
  const authCompletion = await fetchText(authCompletionUrl);
  const health = await fetchJson(healthUrl, { headers: { Origin: origin } });
  const config = await fetchJson(configUrl, { headers: { Origin: origin } });
  const ai = await fetchJson(aiUrl, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      verb: "Ask",
      message: "Return a short StudentOS wiring verification response.",
    }),
  });
  const corsOrigin = health.response.headers.get("access-control-allow-origin") || "";
  const configCorsOrigin = config.response.headers.get("access-control-allow-origin") || "";
  const aiCorsOrigin = ai.response.headers.get("access-control-allow-origin") || "";
  const runtimeConfigReferenced = frontendPage.text.includes("runtime-config.js");
  const runtimeConfigPointsToBackend = runtimeConfig.text.includes(backend.origin);
  const authCompletionIsStyledRoute = authCompletion.response.ok &&
    authCompletion.text.includes("recovery-complete-form") &&
    authCompletion.text.includes("/styles/main.css") &&
    authCompletion.text.includes("/scripts/auth-complete.js") &&
    !authCompletion.text.includes("scripts/app.js") &&
    !/["']\/auth\/(?:runtime-config\.js|styles\/main\.css|scripts\/)/.test(authCompletion.text);
  const ok = frontendPage.response.ok &&
    runtimeConfig.response.ok &&
    authCompletionIsStyledRoute &&
    runtimeConfigReferenced &&
    runtimeConfigPointsToBackend &&
    health.response.ok &&
    config.response.ok &&
    ai.response.ok &&
    corsOrigin === origin &&
    configCorsOrigin === origin &&
    aiCorsOrigin === origin &&
    !health.returnedHtml &&
    !config.returnedHtml &&
    !ai.returnedHtml &&
    !config.body?.frontendServedByBackend;
  const result = {
    ok,
    frontendOrigin: frontend.origin,
    backendOrigin: backend.origin,
    frontendStatus: frontendPage.response.status,
    runtimeConfigStatus: runtimeConfig.response.status,
    authCompletionStatus: authCompletion.response.status,
    runtimeConfigReferenced,
    runtimeConfigPointsToBackend,
    authCompletionIsStyledRoute,
    healthStatus: health.response.status,
    configStatus: config.response.status,
    aiStatus: ai.response.status,
    corsOriginMatches: corsOrigin === origin,
    configCorsOriginMatches: configCorsOrigin === origin,
    aiCorsOriginMatches: aiCorsOrigin === origin,
    corsOrigin: corsOrigin ? safeUrl(corsOrigin) : "missing",
    responsesWereJson: {
      health: !health.returnedHtml && !health.body?.parseError,
      config: !config.returnedHtml && !config.body?.parseError,
      ai: !ai.returnedHtml && !ai.body?.parseError,
    },
    deploymentTarget: config.body?.deploymentTarget || "unknown",
    frontendServedByBackend: Boolean(config.body?.frontendServedByBackend),
    backendMode: config.body?.persistence?.mode || config.body?.storageMode || "unknown",
    backendSupabaseConfigured: {
      auth: Boolean(config.body?.persistence?.authConfigured),
      shards: Boolean(config.body?.persistence?.shardsConfigured),
      jwt: Boolean(config.body?.persistence?.jwtConfigured),
      missing: config.body?.persistence?.missing || {},
    },
    aiReturnedHtml: ai.returnedHtml,
    secretsPrinted: false,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, secretsPrinted: false }, null, 2));
  process.exit(1);
});
