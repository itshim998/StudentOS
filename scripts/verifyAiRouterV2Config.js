import { getAiProviderConfig, getSafeAiProviderStatus } from "../backend/ai/providerConfig.js";
import { loadDotEnv } from "../backend/config/supabaseEnv.js";

function modelIds(body) {
  return new Set(Array.isArray(body?.data) ? body.data.map((model) => String(model?.id || "")).filter(Boolean) : []);
}

async function fetchRegistry(url, timeoutMs = 15_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`registry_http_${response.status}`);
  return modelIds(await response.json());
}

export async function verifyAiRouterV2Config(env = process.env, { liveRegistries = false } = {}) {
  const config = getAiProviderConfig(env);
  const errors = [];
  const warnings = [];
  if (config.routing.v2.enabled) {
    if (config.groq.keyCount !== 5) errors.push("groq_five_distinct_slots_required");
    if (config.gemini.keyCount !== 6) errors.push("gemini_six_distinct_slots_required");
    if (config.nvidia.enabled && config.nvidia.keyCount !== 3) errors.push("nvidia_three_distinct_slots_required");
    if (!config.pollinations.apiKey) errors.push("pollinations_authenticated_key_required");
    if (config.pollinations.textModel !== "gpt-oss") errors.push("pollinations_required_model_must_be_gpt_oss");
    if (config.groq.duplicateKeyDetected || config.gemini.duplicateKeyDetected || config.nvidia.duplicateKeyDetected) errors.push("duplicate_provider_key_value");
  }
  const registry = {
    checked: liveRegistries,
    pollinationsTextModelAvailable: null,
    nvidiaTextModelAvailable: null,
    nvidiaStructuredModelAvailable: config.nvidia.structuredModel ? null : false,
    nvidiaStructuredCapabilityRegistryConfirmed: false,
  };
  if (liveRegistries) {
    const [pollinationsIds, nvidiaIds] = await Promise.all([
      fetchRegistry("https://gen.pollinations.ai/v1/models"),
      fetchRegistry("https://integrate.api.nvidia.com/v1/models"),
    ]);
    registry.pollinationsTextModelAvailable = pollinationsIds.has(config.pollinations.textModel);
    registry.nvidiaTextModelAvailable = nvidiaIds.has(config.nvidia.model);
    registry.nvidiaStructuredModelAvailable = config.nvidia.structuredModel ? nvidiaIds.has(config.nvidia.structuredModel) : false;
    if (!registry.pollinationsTextModelAvailable) errors.push("pollinations_configured_model_unavailable");
    if (config.nvidia.enabled && !registry.nvidiaTextModelAvailable) errors.push("nvidia_configured_text_model_unavailable");
    if (config.nvidia.structuredModel && !registry.nvidiaStructuredModelAvailable) errors.push("nvidia_configured_structured_model_unavailable");
  }
  if (config.nvidia.structuredModel) {
    warnings.push("nvidia_structured_model_is_explicit_but_registry_does_not_publish_per_model_structured_capability");
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    registry,
    aiProviders: getSafeAiProviderStatus(config),
    secretsPrinted: false,
  };
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const result = await verifyAiRouterV2Config(process.env, { liveRegistries: process.argv.includes("--live-registries") });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || "registry_verification_failed").slice(0, 160), secretsPrinted: false }, null, 2));
  process.exit(1);
});
