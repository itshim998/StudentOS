import { normalizePlanKey } from "../domain/planEntitlementService.js";

export const AI_WEEKLY_ALLOWANCE_DEFAULTS = Object.freeze({
  trial: 15,
  starter: 35,
  essential: 90,
  plus: 220,
  pro: 500,
});

export const AI_CREDIT_COSTS = Object.freeze({
  deterministic_help: 0,
  general_ask: 1,
  academic_context_answer: 2,
  tutoring_explanation: 3,
  planning: 5,
  assignment_analysis: 8,
});

export const AI_ALLOWANCE_COPY = Object.freeze({
  exhausted: "You have used this week’s AI help for your current plan. Your weekly AI help refreshes soon.",
  exhaustedNextStep: "You can still update your courses and academic context.",
  low: "You are close to this week’s AI help limit.",
  unavailable: "I could not complete that answer right now. Please try again.",
});

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getAiWeeklyAllowanceConfig(env = process.env) {
  return Object.fromEntries(Object.entries(AI_WEEKLY_ALLOWANCE_DEFAULTS).map(([planKey, fallback]) => [
    planKey,
    positiveInteger(env[`STUDENTOS_AI_WEEKLY_ALLOWANCE_${planKey.toUpperCase()}`], fallback),
  ]));
}

export function getAiWeeklyAllowance(planKey, env = process.env) {
  const normalized = normalizePlanKey(planKey);
  return normalized ? getAiWeeklyAllowanceConfig(env)[normalized] : 0;
}

export function getAiWeeklyPeriod(now = new Date()) {
  const value = new Date(now);
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid weekly AI allowance date");
  const start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return {
    periodKey: `week_${start.toISOString().slice(0, 10)}`,
    startsAt: start.toISOString(),
    refreshesAt: end.toISOString(),
  };
}

function normalizedMessage(message) {
  return String(message || "").trim().toLowerCase();
}

export function getDeterministicAiResponse(message) {
  const text = normalizedMessage(message);
  if (!text) {
    return {
      actionType: "deterministic_help",
      answer: "Ask me a study question, or tell me what you want to understand, plan, or revise.",
    };
  }
  if (/^(?:hi|hello|hey|good morning|good afternoon|good evening)[!.?\s]*$/.test(text)) {
    return {
      actionType: "deterministic_help",
      answer: "Hello. I’m StudentOS, your academic study assistant. What would you like to understand, plan, or revise?",
    };
  }
  if (/^(?:who are you|what are you)[?.!\s]*$/.test(text)) {
    return {
      actionType: "deterministic_help",
      answer: "I’m StudentOS, a calm academic study assistant for explanations, planning, revision, and managing academic work.",
    };
  }
  if (/^(?:what can you do|how can you help|help)[?.!\s]*$/.test(text)) {
    return {
      actionType: "deterministic_help",
      answer: "I can explain study topics, help plan revision, review understanding, and use the academic context you choose. I never submit work for you.",
    };
  }
  if (/\b(?:where|how)\b.*\b(?:add|upload)\b.*\b(?:pdf|material|assignment)\b/.test(text)) {
    return {
      actionType: "deterministic_help",
      answer: "Open Academic Context, choose Add PDF, select a course, and add the assignment or material. If no course appears, refresh the course list or open Setup.",
    };
  }
  return null;
}

export function classifyAiTask({ verb = "Ask", message = "", retrieval = null } = {}) {
  const text = normalizedMessage(message);
  const normalizedVerb = ["Ask", "Plan", "Make", "Review"].includes(verb) ? verb : "Ask";
  const assignmentRequest = /\b(?:assignment|homework|essay|coursework|rubric)\b/.test(text) &&
    /\b(?:analyse|analyze|check|review|mark|improve|evaluate|feedback)\b/.test(text);
  if (assignmentRequest) return { actionType: "assignment_analysis", creditCost: AI_CREDIT_COSTS.assignment_analysis };
  if (normalizedVerb === "Plan") return { actionType: "planning", creditCost: AI_CREDIT_COSTS.planning };
  if (normalizedVerb === "Make" || normalizedVerb === "Review" || /\b(?:explain|teach|tutor|why|walk me through|help me understand)\b/.test(text)) {
    return { actionType: "tutoring_explanation", creditCost: AI_CREDIT_COSTS.tutoring_explanation };
  }
  if (retrieval?.hasUploadedMaterial || retrieval?.chunks?.length || retrieval?.sources?.length || retrieval?.memories?.length) {
    return { actionType: "academic_context_answer", creditCost: AI_CREDIT_COSTS.academic_context_answer };
  }
  return { actionType: "general_ask", creditCost: AI_CREDIT_COSTS.general_ask };
}

export function buildPublicAiAllowance({ allowance = 0, used = 0, remaining = 0, refreshesAt = null, blocked = false } = {}) {
  const lowThreshold = Math.max(2, Math.ceil(Number(allowance || 0) * 0.1));
  return {
    remaining: Math.max(0, Number(remaining || 0)),
    refreshesAt,
    low: !blocked && Number(remaining || 0) <= lowThreshold,
    blocked: blocked === true,
  };
}
