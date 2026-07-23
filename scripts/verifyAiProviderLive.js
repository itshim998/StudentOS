import { getAiProviderConfig, getSafeAiProviderStatus } from "../backend/ai/providerConfig.js";
import { GeminiTextProvider, GroqGroundedProvider, NvidiaTextProvider, PollinationsTextProvider } from "../backend/ai/providers.js";
import { loadDotEnv } from "../backend/config/supabaseEnv.js";

function redactError(error) {
  return String(error?.message || error || "unknown_error")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/key=([^&\s]+)/gi, "key=[redacted]")
    .replace(/api[_-]?key(?:_\d+)?[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .replace(/nvapi-[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .slice(0, 180);
}

function failureKind(error) {
  const status = Number(error?.status || 0);
  if (error?.policyBlocked) return "policy_rejection";
  if ([401, 403].includes(status)) return "invalid_key";
  if ([402, 429].includes(status)) return "quota_or_rate_limit";
  if ([400, 404, 422].includes(status)) return "model_or_payload_incompatible";
  if (error?.name === "AbortError" || status === 408 || status >= 500) return "transport_or_upstream";
  return "request_failed";
}

async function verifyNumberedPool({ providerCode, Provider, config, keys, model = null }) {
  const provider = new Provider({ config, fetchImpl: globalThis.fetch });
  const results = [];
  for (const keyRecord of keys) {
    try {
      const result = await provider.generate({
        keyRecord,
        manageRuntimeHealth: false,
        model,
        maxTokens: 8,
        messages: [{ role: "user", content: "Reply only: OK" }],
      });
      results.push({ provider: providerCode, slotNumber: keyRecord.index, ok: true, model: result.modelUsed, usageAvailable: Boolean(result.usage) });
    } catch (error) {
      results.push({ provider: providerCode, slotNumber: keyRecord.index, ok: false, failureKind: failureKind(error), status: Number(error?.status || 0) || null, error: redactError(error) });
    }
  }
  return results;
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const config = getAiProviderConfig();
  const safeStatus = getSafeAiProviderStatus(config);
  if (String(process.env.STUDENTOS_AI_LIVE_VERIFY || "").toLowerCase() !== "true") {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "set_STUDENTOS_AI_LIVE_VERIFY_true_to_run", aiProviders: safeStatus, secretsPrinted: false }, null, 2));
    return;
  }
  const liveConfig = {
    ...config,
    groq: { ...config.groq, enabled: true },
    gemini: { ...config.gemini, enabled: true },
    nvidia: { ...config.nvidia, enabled: true },
    pollinations: { ...config.pollinations, enabled: true },
  };
  const results = [
    ...await verifyNumberedPool({ providerCode: "groq", Provider: GroqGroundedProvider, config: liveConfig, keys: config.groq.keys }),
    ...await verifyNumberedPool({ providerCode: "gemini", Provider: GeminiTextProvider, config: liveConfig, keys: config.gemini.keys }),
    ...await verifyNumberedPool({ providerCode: "nvidia", Provider: NvidiaTextProvider, config: liveConfig, keys: config.nvidia.keys, model: config.nvidia.model }),
  ];
  if (config.pollinations.configured) {
    try {
      const result = await new PollinationsTextProvider({ config: liveConfig }).generate({ maxTokens: 8, messages: [{ role: "user", content: "Reply only: OK" }] });
      results.push({ provider: "pollinations", slotNumber: 1, ok: true, model: result.modelUsed, usageAvailable: Boolean(result.usage) });
    } catch (error) {
      results.push({ provider: "pollinations", slotNumber: 1, ok: false, failureKind: failureKind(error), status: Number(error?.status || 0) || null, error: redactError(error) });
    }
  }
  const result = { ok: results.length > 0 && results.every((item) => item.ok), skipped: false, results, aiProviders: safeStatus, secretsPrinted: false };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: redactError(error), secretsPrinted: false }, null, 2));
  process.exit(1);
});
