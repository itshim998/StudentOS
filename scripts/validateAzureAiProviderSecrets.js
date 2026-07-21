import { pathToFileURL } from "node:url";
import { getAiProviderConfig } from "../backend/ai/providerConfig.js";
import { validateAzureGroqSecrets } from "./validateAzureGroqSecrets.js";

export const AZURE_GEMINI_SECRET_MAPPINGS = Object.freeze([
  Object.freeze({ envName: "GEMINI_API_KEY", secretName: "gemini-api-key" }),
  Object.freeze({ envName: "GEMINI_API_KEY_1", secretName: "gemini-api-key-1" }),
  Object.freeze({ envName: "GEMINI_API_KEY_2", secretName: "gemini-api-key-2" }),
  Object.freeze({ envName: "GEMINI_API_KEY_3", secretName: "gemini-api-key-3" }),
  Object.freeze({ envName: "GEMINI_API_KEY_4", secretName: "gemini-api-key-4" }),
  Object.freeze({ envName: "GEMINI_API_KEY_5", secretName: "gemini-api-key-5" }),
  Object.freeze({ envName: "GEMINI_API_KEY_6", secretName: "gemini-api-key-6" }),
]);

export const AZURE_NVIDIA_SECRET_MAPPINGS = Object.freeze([
  Object.freeze({ envName: "NVIDIA_API_KEY", secretName: "nvidia-api-key" }),
  Object.freeze({ envName: "NVIDIA_API_KEY_1", secretName: "nvidia-api-key-1" }),
  Object.freeze({ envName: "NVIDIA_API_KEY_2", secretName: "nvidia-api-key-2" }),
  Object.freeze({ envName: "NVIDIA_API_KEY_3", secretName: "nvidia-api-key-3" }),
]);

export const AZURE_GEMINI_SECRET_NAMES = Object.freeze(AZURE_GEMINI_SECRET_MAPPINGS.map((item) => item.envName));

export function validateAzureAiProviderSecrets(env = {}) {
  const config = getAiProviderConfig(env);
  const groq = validateAzureGroqSecrets(env);
  const cycleEnabled = config.routing.enabled;
  const routerV2Enabled = config.routing.v2.enabled;
  const geminiSlotIndexes = new Set(config.gemini.keys.map((key) => key.index));
  const geminiFiveReady = [1, 2, 3, 4, 5].every((slot) => geminiSlotIndexes.has(slot));
  const geminiReady = config.gemini.keyCount === 6 && [1, 2, 3, 4, 5, 6].every((slot) => geminiSlotIndexes.has(slot));
  const nvidiaSlotIndexes = new Set(config.nvidia.keys.map((key) => key.index));
  const nvidiaReady = config.nvidia.keyCount === 3 && [1, 2, 3].every((slot) => nvidiaSlotIndexes.has(slot));
  const pollinationsReady = Boolean(config.pollinations.apiKey);
  const configuredProviders = [
    config.groq.enabled !== false && config.groq.configured ? "groq" : null,
    config.gemini.enabled !== false && config.gemini.configured ? "gemini" : null,
    config.nvidia.enabled !== false && config.nvidia.configured ? "nvidia" : null,
    config.pollinations.enabled !== false && config.pollinations.configured ? "pollinations" : null,
  ].filter(Boolean);
  const fallbackReady = configuredProviders.length >= 2;
  const allConfiguredKeyValues = [...config.groq.keys, ...config.gemini.keys, ...config.nvidia.keys].map((key) => key.value);
  const duplicateKeyDetected = config.groq.duplicateKeyDetected
    || config.gemini.duplicateKeyDetected
    || config.nvidia.duplicateKeyDetected
    || new Set(allConfiguredKeyValues).size !== allConfiguredKeyValues.length;
  const routerV2Ready = groq.keyCount === 5 && geminiReady && pollinationsReady
    && (!config.nvidia.enabled || nvidiaReady)
    && !duplicateKeyDetected;
  const ok = fallbackReady
    && (!cycleEnabled || (groq.ok && geminiFiveReady && pollinationsReady))
    && (!routerV2Enabled || routerV2Ready);
  return {
    ok,
    cycleEnabled,
    routerV2Enabled,
    configuredProviders,
    configuredProviderCount: configuredProviders.length,
    fallbackReady,
    groqConfigured: groq.ok,
    groqDistinctKeyCount: groq.keyCount,
    geminiConfigured: config.gemini.configured,
    geminiDistinctKeyCount: config.gemini.keyCount,
    geminiAllFiveSlotsConfigured: geminiFiveReady,
    geminiAllSixSlotsConfigured: geminiReady,
    nvidiaConfigured: config.nvidia.configured,
    nvidiaEnabled: config.nvidia.enabled,
    nvidiaDistinctKeyCount: config.nvidia.keyCount,
    nvidiaAllThreeSlotsConfigured: nvidiaReady,
    duplicateKeyDetected,
    pollinationsConfigured: pollinationsReady,
    errorCode: ok
      ? null
      : !fallbackReady
        ? "provider_redundancy_required"
        : routerV2Enabled && duplicateKeyDetected
          ? "duplicate_provider_key_value"
        : routerV2Enabled && groq.keyCount !== 5
          ? "groq_five_distinct_slots_required"
        : routerV2Enabled && !geminiReady
          ? "gemini_six_distinct_slots_required"
        : routerV2Enabled && config.nvidia.enabled && !nvidiaReady
          ? "nvidia_three_distinct_slots_required"
        : routerV2Enabled && !pollinationsReady
          ? "pollinations_backend_key_missing"
        : cycleEnabled && !groq.ok
          ? "groq_backend_key_missing"
          : cycleEnabled && !geminiReady
          ? "gemini_five_distinct_slots_required"
          : "pollinations_backend_key_missing",
    secretsPrinted: false,
  };
}

export function reportAzureAiProviderValidation(env = {}, output = console) {
  const status = validateAzureAiProviderSecrets(env);
  if (status.ok) {
    output.log(`AI provider configuration ready (providers=${status.configuredProviders.join(",")}, fallback=${status.fallbackReady}, cycle=${status.cycleEnabled}, routerV2=${status.routerV2Enabled}, Groq slots=${status.groqDistinctKeyCount}, Gemini slots=${status.geminiDistinctKeyCount}, NVIDIA slots=${status.nvidiaDistinctKeyCount}, Pollinations=${status.pollinationsConfigured}).`);
  } else {
    output.error(`AI provider configuration is incomplete (${status.errorCode}). No secret values were printed.`);
  }
  return status;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const status = reportAzureAiProviderValidation(process.env);
  if (!status.ok) process.exitCode = 1;
}
