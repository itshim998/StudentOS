import { getAiProviderConfig, getSafeAiProviderStatus } from "../backend/ai/providerConfig.js";
import { runProviderFallback } from "../backend/ai/providers.js";
import { loadDotEnv } from "../backend/config/supabaseEnv.js";

function redactError(error) {
  return String(error?.message || error || "unknown_error")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/key=([A-Za-z0-9._-]+)/gi, "key=[redacted]")
    .replace(/api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .slice(0, 240);
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const config = getAiProviderConfig();
  const safeStatus = getSafeAiProviderStatus(config);
  if (!config.groq.configured && !config.pollinations.configured) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: "no_ai_provider_keys_configured",
      aiProviders: safeStatus,
      secretsPrinted: false,
    }, null, 2));
    return;
  }

  const result = await runProviderFallback({
    config,
    messages: [
      {
        role: "system",
        content: "You are verifying StudentOS provider connectivity. Do not mention secrets.",
      },
      {
        role: "user",
        content: "Use only this source: [S1] Quadratic roots are values where the expression equals zero. Reply in one short sentence with [S1].",
      },
    ],
  });

  console.log(JSON.stringify({
    ok: result.provider !== "mock",
    provider: result.provider,
    modelUsed: result.modelUsed,
    textPreview: String(result.text || "").slice(0, 180),
    aiProviders: safeStatus,
    secretsPrinted: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: redactError(error),
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
