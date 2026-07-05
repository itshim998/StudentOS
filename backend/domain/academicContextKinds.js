export const ACADEMIC_CONTEXT_KINDS = Object.freeze([
  "syllabus",
  "study_material",
  "assignment",
  "exam_schedule",
  "generated_study_material",
  "unknown",
]);

const KIND_ALIASES = Object.freeze({
  syllabus: "syllabus",
  course_outline: "syllabus",
  material: "study_material",
  study_material: "study_material",
  study_materials: "study_material",
  classroom_selected_material: "study_material",
  google_classroom_selected_material: "study_material",
  notes: "study_material",
  handout: "study_material",
  reading: "study_material",
  assignment: "assignment",
  coursework: "assignment",
  exam_schedule: "exam_schedule",
  exam_dates: "exam_schedule",
  generated_study_material: "generated_study_material",
  studentos_generated: "generated_study_material",
  unknown: "unknown",
});

function normalizeKindValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function recognizedKind(value) {
  return KIND_ALIASES[normalizeKindValue(value)] || null;
}

export function normalizeAcademicContextKind(item = {}) {
  const payload = item?.payload && typeof item.payload === "object" ? item.payload : {};
  const explicitValues = [
    item.contextKind,
    payload.contextKind,
    item.materialKind,
    payload.materialKind,
    item.artifactKind,
    payload.artifactKind,
    item.includedAs,
    payload.includedAs,
    item.kind,
    payload.kind,
    item.sourceType,
    payload.sourceType,
    item.source,
    item.origin,
  ];

  // Generated content must not be downgraded by the legacy artifactKind "material".
  if (explicitValues.some((value) => recognizedKind(value) === "generated_study_material")) {
    return "generated_study_material";
  }
  for (const value of explicitValues) {
    const kind = recognizedKind(value);
    if (kind) return kind;
  }

  // Title inference is compatibility-only for old records that never stored semantics.
  const legacyTitle = normalizeKindValue(item.title || item.filename || payload.title || payload.filename);
  if (/syllabus|course_outline/.test(legacyTitle)) return "syllabus";
  if (/exam_(?:schedule|dates?)|exam_timetable/.test(legacyTitle)) return "exam_schedule";
  if (/assignment|coursework/.test(legacyTitle)) return "assignment";
  if (/(?:^|_)notes?(?:_|$)|handout|reading|study_material/.test(legacyTitle)) return "study_material";
  return "unknown";
}

export function isReadableStudyMaterial(item = {}) {
  return ["study_material", "generated_study_material"].includes(normalizeAcademicContextKind(item));
}
