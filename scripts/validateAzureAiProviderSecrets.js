import { pathToFileURL } from "node:url";
import { getAiProviderConfig } from "../backend/ai/providerConfig.js";
import { validateAzureGroqSecrets } from "./validateAzureGroqSecrets.js";

export const AZURE_GEMINI_SECRET_MAPPINGS = Object.freeze([
  Object.freeze({ envName: "GEMINI_API_KEY_1", secretName: "gemini-api-key-1" }),
  Object.freeze({ envName: "GEMINI_API_KEY_2", secretName: "gemini-api-key-2" }),
  Object.freeze({ envName: "GEMINI_API_KEY_3", secretName: "gemini-api-key-3" }),
  Object.freeze({ envName: "GEMINI_API_KEY_4", secretName: "gemini-api-key-4" }),
  Object.freeze({ envName: "GEMINI_API_KEY_5", secretName: "gemini-api-key-5" }),
]);

export const AZURE_GEMINI_SECRET_NAMES = Object.freeze(AZURE_GEMINI_SECRET_MAPPINGS.map((item) => item.envName));

export function validateAzureAiProviderSecrets(env = {}) {
  const config = getAiProviderConfig(env);
  const groq = validateAzureGroqSecrets(env);
  const cycleEnabled = config.routing.enabled;
  const geminiSlotIndexes = new Set(config.gemini.keys.map((key) => key.index));
  const geminiReady = config.gemini.keyCount === 5 && [1, 2, 3, 4, 5].every((slot) => geminiSlotIndexes.has(slot));
  const pollinationsReady = Boolean(config.pollinations.apiKey);
  const ok = groq.ok && (!cycleEnabled || (geminiReady && pollinationsReady));
  return {
    ok,
    cycleEnabled,
    groqConfigured: groq.ok,
    groqDistinctKeyCount: groq.keyCount,
    geminiConfigured: config.gemini.configured,
    geminiDistinctKeyCount: config.gemini.keyCount,
    geminiAllFiveSlotsConfigured: geminiReady,
    pollinationsConfigured: pollinationsReady,
    errorCode: ok
      ? null
      : !groq.ok
        ? "groq_backend_key_missing"
        : !geminiReady
          ? "gemini_five_distinct_slots_required"
          : "pollinations_backend_key_missing",
    secretsPrinted: false,
  };
}

export function reportAzureAiProviderValidation(env = {}, output = console) {
  const status = validateAzureAiProviderSecrets(env);
  if (status.ok) {
    output.log(`AI provider configuration ready (cycle=${status.cycleEnabled}, Groq slots=${status.groqDistinctKeyCount}, Gemini slots=${status.geminiDistinctKeyCount}, Pollinations=${status.pollinationsConfigured}).`);
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
