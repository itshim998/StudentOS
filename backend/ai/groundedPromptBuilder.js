import { isAcademicContextRecord } from "../connectors/googleClassroom/mapper.js";
import { isEvidenceDerivedWeakTopic } from "../domain/topicPerformanceService.js";

function compact(value, limit = 1400) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function formatSnippets(snippets = []) {
  return snippets
    .slice(0, 5)
    .map((item, index) => {
      const label = item.citationLabel || item.sourceTitle || `Source ${index + 1}`;
      const confidence = item.confidenceLabel ? ` (${item.confidenceLabel} confidence)` : "";
      return `[S${index + 1}] ${label}${confidence}\n${compact(item.snippet, 900)}`;
    })
    .join("\n\n");
}

function formatStudyState(state, baseAnswer) {
  const course = (state.courses || []).find((item) => item.id === baseAnswer.courseId && isAcademicContextRecord(item)) || state.courses?.find(isAcademicContextRecord);
  const topic = (state.topics || []).find((item) => item.id === baseAnswer.topicId && isAcademicContextRecord(item)) || state.topics?.find(isAcademicContextRecord);
  const preferences = state.studentProfile?.preferences || {};
  const assignments = (state.assignments || [])
    .filter((item) => isAcademicContextRecord(item) && (!course?.id || item.courseId === course.id))
    .slice(0, 4)
    .map((item) => `${item.title} due ${item.dueDate || item.dueAt || "soon"} (${item.status || "open"})`)
    .join("; ");
  const weakTopics = (state.topics || [])
    .filter((item) => isAcademicContextRecord(item) && item.courseId === course?.id && isEvidenceDerivedWeakTopic(item))
    .slice(0, 5)
    .map((item) => `${item.title}: ${item.performance.status} (${item.performance.latestPercentage}%)`)
    .join("; ");
  const timetable = (state.timetable || [])
    .filter((item) => !course?.id || item.courseId === course.id)
    .slice(0, 4)
    .map((item) => `${item.title} at ${item.startsAt || "planned"}`)
    .join("; ");
  const exams = (state.exams || [])
    .filter((item) => !course?.id || item.courseId === course.id)
    .slice(0, 3)
    .map((item) => `${item.title} on ${item.examDate}`)
    .join("; ");
  return [
    `Academic goal: ${preferences.academicGoal || "exam_prep"}`,
    `Student context: ${preferences.stream || "general"} ${preferences.classLevel || state.studentProfile?.gradeBand || ""}`.trim(),
    `Study availability: ${preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || 90} minutes/day, ${preferences.studyBreakPattern || `${preferences.breakCycleMinutes || 25}/${preferences.breakMinutes || 5}`} break cycle`,
    `Course: ${course?.title || "Unknown course"}`,
    `Topic: ${topic?.title || "Unknown topic"}`,
    `Coverage: ${baseAnswer.coverage?.status || "unknown"}`,
    `Exams: ${exams || "none listed"}`,
    `Timetable: ${timetable || "none listed"}`,
    `Upcoming work: ${assignments || "none listed"}`,
    `Weak topics: ${weakTopics || "none recorded"}`,
  ].join("\n");
}

export function buildGroundedMessages({ verb, message, state, baseAnswer, assistantPolicy = {} }) {
  const normalizedVerb = baseAnswer.verb || verb || "Ask";
  const snippets = baseAnswer.grounding?.snippets || [];
  const lowConfidence = baseAnswer.grounding?.confidence?.lowConfidence === true;
  const hasUploadedSnippets = Boolean(baseAnswer.grounding?.uploadedMaterialUsed && snippets.length && !lowConfidence);
  const contextBlock = hasUploadedSnippets ? formatSnippets(snippets) : "";
  const needsSpecificMaterial = /\b(?:this|my|the attached|the uploaded|selected)\b.{0,40}\b(?:pdf|file|material|notes?|assignment|rubric)\b/i.test(String(message || ""));
  const fallbackInstruction = hasUploadedSnippets
    ? "Use the uploaded source snippets as the primary evidence. Do not add citations beyond the supplied source labels."
    : needsSpecificMaterial
      ? "The requested material is not available. Say what is missing and offer one clear next step."
      : "Answer generally without pretending material is available. Include: 'I can answer generally for now. Add your materials for more personalized help.'";

  const verbInstructions = {
    Ask: "Answer the request directly. Use supplied source snippets when they are relevant and available.",
    Plan: "Create a compact study plan using exam pressure, due work, weak topics, and any supplied source snippets.",
    Make: "Generate structured notes, flashcards, quiz prompts, or a summary scaffold from the supplied source snippets.",
    Review: "Check understanding, identify weak points, and recommend the next test or revision action from the source context.",
  };

  return [
    {
      role: "system",
      content: [
        "You are StudentOS, a calm academic study assistant. Help the student understand, plan, revise, and manage academic work.",
        "Use the student’s selected academic context when relevant, but answer general questions safely when context is missing or not needed.",
        "Do not claim to have read material that is not available. Do not expose providers, models, tokens, storage, backend details, or implementation details.",
        "Encourage responsible learning and do not submit work or impersonate the student.",
        "If current facts are required and no current source is available, say: 'I may not have live information for that, but I can help with the study side.'",
        "Never claim a citation unless it appears in the supplied source snippets.",
        assistantPolicy.responseGuidance || "Keep the response clear, concise, and focused on one useful next step.",
        fallbackInstruction,
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Verb: ${normalizedVerb}`,
        `Student request: ${message || "(no request text)"}`,
        "",
        "Study state:",
        formatStudyState(state, baseAnswer),
        "",
        "Source snippets:",
        contextBlock || "No uploaded source snippets retrieved.",
        "",
        `Task: ${verbInstructions[normalizedVerb] || verbInstructions.Ask}`,
        "Return a concise answer. If using sources, refer to labels like [S1] in prose; the backend will attach the authoritative citations separately.",
      ].join("\n"),
    },
  ];
}

export function buildInsufficientContextNote(baseAnswer) {
  const labels = baseAnswer.sourceLabels || [];
  const requiresSpecificMaterial = baseAnswer.grounding?.requiresSpecificMaterial === true;
  const canAnswerGenerally = baseAnswer.verb === "Ask" && !requiresSpecificMaterial;
  if (baseAnswer.grounding?.contextUnavailable) {
    return requiresSpecificMaterial
      ? "Not enough material yet. I don’t have that material available. Add or select it in Academic Context, then ask again."
      : null;
  }
  if (baseAnswer.grounding?.confidence?.lowConfidence) {
    return canAnswerGenerally
      ? null
      : "Not enough material yet. Add or choose more relevant material, then ask again.";
  }
  if (baseAnswer.grounding?.uploadedMaterialUsed && baseAnswer.grounding?.snippets?.length) {
    return null;
  }
  if (canAnswerGenerally) return null;
  return labels.length
    ? "Not enough material yet. The selected material did not cover this request clearly enough."
    : "Not enough material yet. Add a source for this topic, then ask again.";
}
