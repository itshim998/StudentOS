import { z } from "zod";

const boundedId = z.string().trim().min(1).max(180);
const boundedText = (limit) => z.string().trim().min(1).max(limit);

function isIanaTimezone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

export const RECOVERY_ACTIVITY_TYPES = Object.freeze([
  "concept_review",
  "worked_examples",
  "targeted_practice",
  "retrieval_practice",
  "reassessment",
  "resume_unfinished",
]);

export const RecoveryTopicRecommendationSchema = z.object({
  syllabusTopicId: boundedId,
  evidenceIds: z.array(boundedId).max(30),
  evidenceStrength: z.enum(["strong", "moderate", "weak", "insufficient"]),
  observedGap: boundedText(240).optional(),
  priorityChange: z.enum(["increase", "decrease", "maintain", "resolve_candidate", "none"]),
  activityType: z.enum(RECOVERY_ACTIVITY_TYPES).optional(),
  recommendedMinutes: z.number().int().min(20).max(60).optional(),
  reasonCode: boundedText(80),
  explanation: boundedText(360),
}).strict();

export const RecoveryReasoningOutputSchema = z.object({
  topicRecommendations: z.array(RecoveryTopicRecommendationSchema).max(40),
  replanRequired: z.boolean(),
  urgency: z.enum(["none", "low", "medium", "high", "critical"]),
  summary: boundedText(500),
}).strict().superRefine((value, context) => {
  const topics = new Set();
  for (const [index, recommendation] of value.topicRecommendations.entries()) {
    if (topics.has(recommendation.syllabusTopicId)) {
      context.addIssue({
        code: "custom",
        path: ["topicRecommendations", index, "syllabusTopicId"],
        message: "duplicate_topic_recommendation",
      });
    }
    topics.add(recommendation.syllabusTopicId);
    if (new Set(recommendation.evidenceIds).size !== recommendation.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["topicRecommendations", index, "evidenceIds"],
        message: "duplicate_evidence_reference",
      });
    }
  }
});

/** @typedef {z.infer<typeof RecoveryReasoningOutputSchema>} RecoveryReasoningOutput */

export const RecoveryAnalyzeInputSchema = z.object({
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currentTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  timezone: z.string().trim().min(1).max(80).refine(isIanaTimezone, "invalid_iana_timezone").optional(),
}).strict();

/** @typedef {z.infer<typeof RecoveryAnalyzeInputSchema>} RecoveryAnalyzeInput */

export const EmptyRecoveryMutationSchema = z.object({}).strict();

export function parseRecoveryReasoningJson(text) {
  return RecoveryReasoningOutputSchema.parse(JSON.parse(String(text || "").trim()));
}
