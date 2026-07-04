import { pathToFileURL } from "node:url";
import { getAiProviderConfig } from "../backend/ai/providerConfig.js";

export const AZURE_GROQ_SECRET_NAMES = Object.freeze([
  "GROQ_API_KEY",
  "GROQ_API_KEY_1",
  "GROQ_API_KEY_2",
  "GROQ_API_KEY_3",
  "GROQ_API_KEY_4",
  "GROQ_API_KEY_5",
]);

export function validateAzureGroqSecrets(env = {}) {
  const config = getAiProviderConfig(env);
  return {
    ok: config.groq.configured,
    keyCount: config.groq.keyCount,
    configuredEnvNames: config.groq.keys.map((key) => key.name),
    errorCode: config.groq.configured ? null : "groq_backend_key_missing",
    secretsPrinted: false,
  };
}

export function reportAzureGroqValidation(env = {}, output = console) {
  const status = validateAzureGroqSecrets(env);
  if (status.ok) {
    output.log(`Groq backend key configuration detected (${status.keyCount} unique key(s)).`);
  } else {
    output.error("Missing required Azure backend Groq secret. Configure GROQ_API_KEY or at least one of GROQ_API_KEY_1 through GROQ_API_KEY_5.");
  }
  return status;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const status = reportAzureGroqValidation(process.env);
  if (!status.ok) process.exitCode = 1;
}
