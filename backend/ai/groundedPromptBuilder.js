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
  const course = (state.courses || []).find((item) => item.id === baseAnswer.courseId) || state.courses?.[0];
  const topic = (state.topics || []).find((item) => item.id === baseAnswer.topicId) || state.topics?.[0];
  const preferences = state.studentProfile?.preferences || {};
  const assignments = (state.assignments || [])
    .filter((item) => !course?.id || item.courseId === course.id)
    .slice(0, 4)
    .map((item) => `${item.title} due ${item.dueDate || item.dueAt || "soon"} (${item.status || "open"})`)
    .join("; ");
  const weakTopics = (state.topics || [])
    .filter((item) => item.courseId === course?.id && (item.weakSignals?.length || ["revision_required", "not_started"].includes(item.mastery)))
    .slice(0, 5)
    .map((item) => `${item.title}: ${item.weakSignals?.join(", ") || item.mastery}`)
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
  const contextBlock = formatSnippets(snippets);
  const fallbackInstruction = hasUploadedSnippets
    ? "Use the uploaded source snippets as the primary evidence. Do not add citations beyond the supplied source labels."
    : "The retrieved uploaded material is insufficient. Say 'Not enough material yet' clearly and give one safe next action.";

  const verbInstructions = {
    Ask: "Teach the concept clearly from the supplied source snippets. Keep it concrete and student-safe.",
    Plan: "Create a compact study plan using exam pressure, due work, weak topics, and any supplied source snippets.",
    Make: "Generate structured notes, flashcards, quiz prompts, or a summary scaffold from the supplied source snippets.",
    Review: "Check understanding, identify weak points, and recommend the next test or revision action from the source context.",
  };

  return [
    {
      role: "system",
      content: [
        "You are StudentOS, a calm source-grounded academic tutor for high-school students.",
        "Never claim a citation unless it appears in the supplied source snippets.",
        "Never imply StudentOS submitted, emailed, posted, or completed school work for the student.",
        "Essential learning help is always allowed; convenience automation remains review-first.",
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
  if (baseAnswer.grounding?.confidence?.lowConfidence) {
    return "Not enough material yet. Add or choose more relevant material, then ask again.";
  }
  if (baseAnswer.grounding?.uploadedMaterialUsed && baseAnswer.grounding?.snippets?.length) {
    return null;
  }
  return labels.length
    ? "Not enough material yet. The selected material did not cover this request clearly enough."
    : "Not enough material yet. Add a source for this topic, then ask again.";
}
