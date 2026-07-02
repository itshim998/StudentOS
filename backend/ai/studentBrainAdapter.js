import { answerFromStudentMaterials } from "../domain/studentosDomain.js";
import { buildGroundedMessages, buildInsufficientContextNote } from "./groundedPromptBuilder.js";
import { getAiProviderConfig } from "./providerConfig.js";
import { runProviderFallback } from "./providers.js";

class LocalStudentBrainProvider {
  constructor() {
    this.name = "studentos_local_policy_adapter";
  }

  async run({ verb, message, state, retrievalOverride, assistantPolicy }) {
    return {
      mode: "mock_studentos_brain",
      poweredBy: this.name,
      provider: "mock",
      modelUsed: "local_studentos_policy",
      ...answerFromStudentMaterials({ verb, message, state, retrievalOverride, assistantPolicy }),
    };
  }
}

class SentIQPatternBridgeProvider {
  constructor() {
    this.name = "sentiqgpt_pattern_bridge";
    this.baseUrl = process.env.SENTIQGPT_BRAIN_API_BASE?.trim() || "";
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async run({ verb, message, state, retrievalOverride, assistantPolicy }) {
    // Pass 2 keeps provider integration behind this server-side boundary.
    // A later pass can call a copied/adapted StudentOS brain service here.
    return {
      mode: "bridge_configured_not_called_in_pass2",
      poweredBy: this.name,
      provider: "bridge",
      modelUsed: "local_studentos_policy",
      ...answerFromStudentMaterials({ verb, message, state, retrievalOverride, assistantPolicy }),
    };
  }
}

function selectProvider(config = getAiProviderConfig()) {
  if (config.requestedMode !== "bridge") {
    return new LocalStudentBrainProvider();
  }
  const bridge = new SentIQPatternBridgeProvider();
  return bridge.isConfigured() ? bridge : new LocalStudentBrainProvider();
}

export function validateGeneratedCitations(text, snippets = []) {
  const allowedSourceRefs = new Set(snippets.map((_, index) => `S${index + 1}`));
  const allowedChunkIds = new Set(snippets.map((item) => item.chunkId).filter(Boolean));
  const inventedCitations = [];
  let cleaned = String(text || "").replace(/\[S(\d+)\]/g, (match, number) => {
    const ref = `S${number}`;
    if (allowedSourceRefs.has(ref)) return match;
    inventedCitations.push(match);
    return "";
  });
  cleaned = cleaned.replace(/\[(chunk_[^\]\s]+)\]/g, (match, chunkId) => {
    if (allowedChunkIds.has(chunkId)) return match;
    inventedCitations.push(match);
    return "";
  });
  return {
    text: cleaned.replace(/\s{2,}/g, " ").trim(),
    allowedChunkIds: [...allowedChunkIds],
    inventedCitations: [...new Set(inventedCitations)],
    strippedInventedCitations: inventedCitations.length > 0,
  };
}

function applyAssistantPolicy(result, assistantPolicy = {}) {
  if (!result || assistantPolicy.depth !== "guided") return result;
  return {
    ...result,
    nextActions: Array.isArray(result.nextActions) ? result.nextActions.slice(0, 2) : result.nextActions,
    studyPlan: result.studyPlan ? {
      ...result.studyPlan,
      blocks: Array.isArray(result.studyPlan.blocks) ? result.studyPlan.blocks.slice(0, 3) : result.studyPlan.blocks,
    } : result.studyPlan,
    artifacts: result.artifacts ? {
      ...result.artifacts,
      notes: Array.isArray(result.artifacts.notes) ? result.artifacts.notes.slice(0, 3) : result.artifacts.notes,
      quiz: Array.isArray(result.artifacts.quiz) ? result.artifacts.quiz.slice(0, 3) : result.artifacts.quiz,
    } : result.artifacts,
  };
}

function applyMissingContextGuidance(answer, baseAnswer, message) {
  let text = String(answer || "").trim();
  const grounding = baseAnswer?.grounding || {};
  const generalGuidance = "I can answer generally for now. Add your materials for more personalized help.";
  if (grounding.contextUnavailable && !grounding.requiresSpecificMaterial && !text.includes(generalGuidance)) {
    text = `${text}${text ? "\n\n" : ""}${generalGuidance}`;
  }
  const liveGuidance = "I may not have live information for that, but I can help with the study side.";
  if (/\b(?:latest|current news|right now|today’s|today's|live information|live score|current price)\b/i.test(String(message || "")) && !text.includes(liveGuidance)) {
    text = `${text}${text ? "\n\n" : ""}${liveGuidance}`;
  }
  return text;
}

export async function runStudentOsVerb({
  verb,
  message,
  state,
  retrievalOverride = null,
  assistantPolicy = {},
  fetchImpl = globalThis.fetch,
  providerConfig = getAiProviderConfig(),
}) {
  const config = providerConfig;
  const baseAnswer = answerFromStudentMaterials({ verb, message, state, retrievalOverride, assistantPolicy });
  const insufficientContext = buildInsufficientContextNote(baseAnswer);

  if (config.requestedMode === "mock" || config.requestedMode === "bridge") {
    const provider = selectProvider(config);
    const result = await provider.run({ verb, message, state, retrievalOverride, assistantPolicy });
    return applyAssistantPolicy({
      ...result,
      generationSucceeded: true,
      answer: applyMissingContextGuidance(insufficientContext || result.answer, baseAnswer, message),
      grounding: {
        ...result.grounding,
        insufficientContext: Boolean(insufficientContext),
        insufficiencyReason: insufficientContext,
      },
    }, assistantPolicy);
  }

  const messages = buildGroundedMessages({ verb, message, state, baseAnswer, assistantPolicy });
  const providerResult = await runProviderFallback({ messages, config, fetchImpl });
  if (providerResult.providerFailure) {
    return applyAssistantPolicy({
      ...baseAnswer,
      mode: "provider_unavailable",
      provider: providerResult.provider,
      modelUsed: providerResult.modelUsed,
      internalFailureCode: providerResult.fallbackReason || "provider_unavailable",
      generationSucceeded: false,
      retryable: true,
      answer: "I could not complete that answer right now. Please try again.",
      grounding: {
        ...baseAnswer.grounding,
        insufficientContext: false,
        insufficiencyReason: null,
        authoritativeCitationsOnly: true,
      },
    }, assistantPolicy);
  }
  const usedRealProvider = providerResult.provider !== "mock" && providerResult.text;
  const citationValidation = validateGeneratedCitations(providerResult.text || "", baseAnswer.grounding?.snippets || []);
  const answer = applyMissingContextGuidance(usedRealProvider
    ? insufficientContext
      ? insufficientContext
      : citationValidation.text
    : insufficientContext || baseAnswer.answer, baseAnswer, message);
  return applyAssistantPolicy({
    ...baseAnswer,
    mode: usedRealProvider ? "real_grounded_ai" : "mock_studentos_brain",
    poweredBy: usedRealProvider ? providerResult.provider : "studentos_local_policy_adapter",
    provider: providerResult.provider,
    modelUsed: providerResult.modelUsed,
    fallback: providerResult.provider === "mock"
      ? { used: true, reason: providerResult.fallbackReason || "mock_provider_selected" }
      : { used: false },
    generationSucceeded: true,
    answer,
    citationValidation,
    grounding: {
      ...baseAnswer.grounding,
      insufficientContext: Boolean(insufficientContext),
      insufficiencyReason: insufficientContext,
      authoritativeCitationsOnly: true,
    },
  }, assistantPolicy);
}
